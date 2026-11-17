// Ekphrasis — lookahead scheduler, score building and offline rendering.

import { Synth } from './synth.js';

const LOOKAHEAD = 0.15;   // seconds scheduled ahead of the audio clock
const INTERVAL = 25;      // ms between scheduler ticks
const SWING_FRAC = 0.66;  // fraction of the unit that full swing delays the off-beat

// grid 16: delay odd 16ths. grid 8: delay the off-beat 8ths (jazz), odd 16ths shift proportionally.
export function swingOffset(step, sd, swing, grid) {
  if (!swing) return 0;
  if (grid === 8) {
    const q = step % 4;
    if (q === 2) return swing * 2 * sd * SWING_FRAC;
    if (q === 1 || q === 3) return swing * sd * SWING_FRAC * 0.5;
    return 0;
  }
  return step % 2 === 1 ? swing * sd * SWING_FRAC : 0;
}

export class Sequencer {
  constructor(ctx, synth) {
    this.ctx = ctx; this.synth = synth;
    this.playing = false; this.timer = null;
    this.visual = []; this.steps = []; this.score = [];
    this.startTime = 0; this.onEnd = null;
  }

  // source: { stepCount, eventsForStep(step) → { events, col, bar, chord } }
  // opts:   { getTempo(), getSwing(), getSwingGrid(), getLoop() }
  start(source, opts) {
    this.stop();
    this.source = source; this.opts = opts;
    this.step = 0;
    this.startTime = this.ctx.currentTime + 0.08;
    this.nextTime = this.startTime;
    this.score = []; this.visual = []; this.steps = [];
    this.playing = true; this.ending = false; this.endTime = 0;
    this._tick();
    this.timer = setInterval(() => this._tick(), INTERVAL);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null; this.playing = false; this.ending = false;
  }

  _tick() {
    const now = this.ctx.currentTime;
    if (this.ending) {
      if (now > this.endTime) { this.stop(); if (this.onEnd) this.onEnd(); }
      return;
    }
    // If the tab was throttled, skip ahead instead of firing a burst of late notes.
    if (this.nextTime < now - 0.3) this.nextTime = now + 0.02;
    while (this.nextTime < now + LOOKAHEAD) {
      const n = this.source.stepCount;
      if (isFinite(n) && (n === 0 || (this.step >= n && !this.opts.getLoop()))) {
        this.ending = true; this.endTime = this.nextTime + 0.05;
        break;
      }
      const tempo = this.opts.getTempo(), sd = 60 / tempo / 4;
      const res = this.source.eventsForStep(this.step);
      const base = this.nextTime + swingOffset(this.step, sd, this.opts.getSwing(), this.opts.getSwingGrid());
      for (const ev of res.events) {
        const t = Math.max(now, base + (ev.sub || 0) * sd + ev.off), dur = ev.durSteps * sd;
        this.synth.play(ev, t, dur);
        const rec = { ...ev, t: t - this.startTime, dur };
        if (this.score.length < 400000) this.score.push(rec);
        this.visual.push({ at: t, ev: rec });
      }
      this.steps.push({ step: this.step, t: this.nextTime, dur: sd, col: res.col, bar: res.bar, chord: res.chord, section: res.section || '', intensity: res.intensity ?? 0.7, rootPc: res.rootPc ?? 0 });
      if (this.steps.length > 256) this.steps.splice(0, 128);
      this.nextTime += sd;
      this.step++;
    }
  }

  currentStep(now) {
    for (let i = this.steps.length - 1; i >= 0; i--) if (this.steps[i].t <= now) return this.steps[i];
    return null;
  }

  drain(now) {
    const ready = [], keep = [];
    for (const v of this.visual) (v.at <= now ? ready : keep).push(v);
    this.visual = keep;
    return ready;
  }
}

// Deterministic timed score from a precomposed step array (same timing rules as the live scheduler).
export function scoreFromSteps(steps, tempo, swing, swingGrid) {
  const sd = 60 / tempo / 4, out = [];
  steps.forEach((st, i) => {
    const base = i * sd + swingOffset(i, sd, swing, swingGrid);
    for (const ev of st.events) out.push({ ...ev, t: Math.max(0, base + (ev.sub || 0) * sd + ev.off), dur: ev.durSteps * sd });
  });
  return out;
}

export async function renderScore(score, S, tempo, genre, sampleRate = 44100) {
  let end = 0;
  for (const e of score) end = Math.max(end, e.t + e.dur);
  const total = end + S.reverbSize + 3;
  const ctx = new OfflineAudioContext(2, Math.ceil(total * sampleRate), sampleRate);
  const syn = new Synth(ctx);
  syn.setParams({ ...S, srcAudio: 0 }, tempo, true, genre);
  const lead = 0.02;
  // Time order matters for the master-filter automation (each sweep cancels later automation).
  const sorted = score.slice().sort((a, b) => a.t - b.t);
  for (const ev of sorted) syn.play(ev, ev.t + lead, ev.dur);
  return ctx.startRendering();
}
