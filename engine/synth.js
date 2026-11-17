// Ekphrasis — Web Audio engine: role buses, inserts, sidechain pump, reverb/echo, instrument dispatch.
// Works on both a realtime AudioContext and an OfflineAudioContext (for WAV rendering).
//
// role chain: notes → inp (panic gate) → shaper → lowpass → duck (sidechain) → bus → master (+ sends)

import { VOICES } from './composer.js';
import { PATCHES, playPatch, makePeriodicWaves, renderKS, renderCrackle } from './instruments.js';
import { KITS, playDrum } from './drums.js';

// [reverb send, delay send] per role
const SENDS = { lead: [0.3, 0.28], arp: [0.45, 0.35], chords: [0.6, 0.12], bass: [0.06, 0], drums: [0.12, 0.04], atmos: [0.5, 0.1] };
const DUCKED = ['chords', 'bass', 'atmos', 'arp'];

function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

function shaperCurve(drive, bits) {
  const N = 2048, curve = new Float32Array(N);
  const k = 1 + drive * 8, norm = Math.tanh(k);
  const steps = bits ? Math.pow(2, bits - 1) : 0;
  for (let i = 0; i < N; i++) {
    let x = (i / (N - 1)) * 2 - 1;
    if (drive > 0) x = Math.tanh(k * x) / norm;
    if (steps) x = Math.round(x * steps) / steps;
    curve[i] = x;
  }
  return curve;
}

export class Synth {
  constructor(ctx) {
    this.ctx = ctx;
    const c = ctx;
    this.master = c.createGain(); this.master.gain.value = 0.8;
    this.comp = c.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.knee.value = 12; this.comp.ratio.value = 3;
    this.comp.attack.value = 0.005; this.comp.release.value = 0.2;
    // Master sweep filters (arranger builds / breakdowns / intros / outros).
    this.mhp = c.createBiquadFilter(); this.mhp.type = 'highpass'; this.mhp.frequency.value = 10; this.mhp.Q.value = 0.9;
    this.mlp = c.createBiquadFilter(); this.mlp.type = 'lowpass'; this.mlp.frequency.value = 20000; this.mlp.Q.value = 1.1;
    this.master.connect(this.mhp); this.mhp.connect(this.mlp); this.mlp.connect(this.comp); this.comp.connect(c.destination);
    this.analyser = c.createAnalyser(); this.analyser.fftSize = 2048;
    this.comp.connect(this.analyser);

    this.revIn = c.createGain(); this.conv = c.createConvolver(); this.revOut = c.createGain();
    this.revIn.connect(this.conv); this.conv.connect(this.revOut); this.revOut.connect(this.master);

    this.dlyIn = c.createGain(); this.dly = c.createDelay(2); this.dly.delayTime.value = 0.375;
    this.dlyLp = c.createBiquadFilter(); this.dlyLp.type = 'lowpass'; this.dlyLp.frequency.value = 2800;
    this.dlyFb = c.createGain(); this.dlyFb.gain.value = 0.35; this.dlyOut = c.createGain();
    this.dlyIn.connect(this.dly); this.dly.connect(this.dlyLp); this.dlyLp.connect(this.dlyFb); this.dlyFb.connect(this.dly);
    this.dlyLp.connect(this.dlyOut); this.dlyOut.connect(this.master);

    this.ext = c.createGain(); this.ext.gain.value = 0; this.ext.connect(this.master); // source-video audio

    this.buses = {};
    for (const v of VOICES) {
      const shaper = c.createWaveShaper(), lp = c.createBiquadFilter(), duck = c.createGain();
      const g = c.createGain(), rs = c.createGain(), ds = c.createGain();
      lp.type = 'lowpass'; lp.frequency.value = 20000; lp.Q.value = 0.5;
      shaper.oversample = '2x';
      shaper.connect(lp); lp.connect(duck); duck.connect(g);
      rs.gain.value = SENDS[v][0]; ds.gain.value = SENDS[v][1];
      g.connect(this.master); g.connect(rs); rs.connect(this.revIn); g.connect(ds); ds.connect(this.dlyIn);
      this.buses[v] = { shaper, lp, duck, g, rs, ds, insertKey: '' };
    }
    this._newInputs();

    const sr = c.sampleRate, nb = c.createBuffer(1, sr, sr), nd = nb.getChannelData(0), rnd = lcg(12345);
    for (let i = 0; i < nd.length; i++) nd[i] = rnd() * 2 - 1;
    this.noise = nb;

    this.waves = makePeriodicWaves(c);
    this.ksCache = new Map();
    this._crackle = null;
    this.on = Object.fromEntries(VOICES.map((v) => [v, true]));
    this.en = Object.fromEntries(VOICES.map((v) => [v, true]));
    this.inst = { lead: 'saw', arp: 'bell', chords: 'warmPad', bass: 'synth', drums: 'studio', atmos: 'off' };
    this.pump = 0;
    this.irSize = 0;
    this.streamDest = null;

    const self = this;
    this._x = {
      ctx: c, out: null, noise: nb,
      wave(o, type) { if (self.waves[type]) o.setPeriodicWave(self.waves[type]); else o.type = type; },
      ksBuffer(midi, P) {
        const key = P.label + '|' + midi;
        let b = self.ksCache.get(key);
        if (!b) { b = renderKS(c, midi, P, lcg(midi * 7919 + 13)); self.ksCache.set(key, b); }
        return b;
      },
      crackle() { if (!self._crackle) self._crackle = renderCrackle(c, lcg(4242)); return self._crackle; },
    };
  }

  // Per-role input gates; replaced on panic() so scheduled notes can be silenced instantly.
  _newInputs() {
    this.inp = {};
    for (const v of VOICES) { const g = this.ctx.createGain(); g.connect(this.buses[v].shaper); this.inp[v] = g; }
  }

  panic() {
    const t = this.ctx.currentTime, old = this.inp;
    for (const v of VOICES) old[v].gain.setTargetAtTime(0, t, 0.015);
    setTimeout(() => { for (const v of VOICES) { try { old[v].disconnect(); } catch (e) { /* already gone */ } } }, 400);
    this._newInputs();
    for (const v of DUCKED) { this.buses[v].duck.gain.cancelScheduledValues(t); this.buses[v].duck.gain.setValueAtTime(1, t); }
    this.resetFilters(t);
  }

  resetFilters(t = this.ctx.currentTime) {
    for (const [p, v] of [[this.mlp.frequency, 20000], [this.mhp.frequency, 10]]) { p.cancelScheduledValues(t); p.setValueAtTime(v, t); }
  }

  _fx(ev, t, dur) {
    const sweep = (p, [a, b]) => {
      p.cancelScheduledValues(t);
      p.setValueAtTime(a, t);
      if (Math.abs(b - a) > 0.5) p.exponentialRampToValueAtTime(b, t + Math.max(0.05, dur));
    };
    sweep(this.mlp.frequency, ev.lp || [20000, 20000]);
    sweep(this.mhp.frequency, ev.hp || [10, 10]);
  }

  setIR(size) {
    const c = this.ctx, sr = c.sampleRate, len = Math.max(1, Math.floor(sr * size));
    const b = c.createBuffer(2, len, sr), rnd = lcg(777);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const decay = Math.pow(1 - t, 2.2) * Math.exp(-t * 3);
        lp += (rnd() * 2 - 1 - lp) * (0.12 + 0.8 * (1 - t));
        const fadeIn = Math.min(1, i / (sr * 0.008));
        d[i] = lp * decay * fadeIn;
      }
    }
    this.conv.buffer = b;
    this.irSize = size;
  }

  _configureInsert(role, ins, send, t, set) {
    const b = this.buses[role];
    const key = JSON.stringify(ins || null) + JSON.stringify(send || null);
    if (key !== b.insertKey) {
      b.insertKey = key;
      const drive = (ins && ins.drive) || 0, bits = (ins && ins.bits) || 0;
      b.shaper.curve = drive || bits ? shaperCurve(drive, bits) : null;
      b.lp.frequency.setValueAtTime((ins && ins.lp) || 20000, t);
    }
    const sd = send || SENDS[role];
    set(b.rs.gain, sd[0]);
    set(b.ds.gain, sd[1]);
  }

  // S = app settings, genre = resolved genre object (for sidechain pump).
  setParams(S, tempo, immediate = false, genre = null) {
    const t = this.ctx.currentTime;
    const set = (p, v) => { if (immediate) p.setValueAtTime(v, t); else p.setTargetAtTime(v, t, 0.03); };
    set(this.master.gain, S.master);
    set(this.revOut.gain, S.reverb * 1.6);
    set(this.dlyOut.gain, S.delay * 1.4);
    set(this.dlyFb.gain, 0.25 + S.delay * 0.35);
    set(this.ext.gain, S.srcAudio || 0);
    if (tempo) set(this.dly.delayTime, Math.min(1.9, 0.75 * 60 / tempo));
    for (const v of VOICES) {
      const vs = S.voices[v];
      this.on[v] = !!vs.on && vs.inst !== 'off';
      this.en[v] = !!vs.on;
      this.inst[v] = vs.inst;
      set(this.buses[v].g.gain, vs.on ? vs.vol : 0);
      const src = v === 'drums' ? KITS[vs.inst] : PATCHES[vs.inst];
      this._configureInsert(v, src && src.insert, src && src.send, t, set);
    }
    if (genre) this.pump = genre.pump || 0;
    if (Math.abs(S.reverbSize - this.irSize) > 0.01) this.setIR(S.reverbSize);
  }

  getStreamDest() {
    if (!this.streamDest) { this.streamDest = this.ctx.createMediaStreamDestination(); this.comp.connect(this.streamDest); }
    return this.streamDest;
  }

  _duck(t, amt) {
    for (const v of DUCKED) {
      const p = this.buses[v].duck.gain;
      p.setValueAtTime(1 - amt, t);
      p.setTargetAtTime(1, t + 0.01, 0.07);
    }
  }

  play(ev, t, dur) {
    const role = ev.voice;
    if (role === 'fx') return this._fx(ev, t, dur);
    if (ev.patch ? !this.en[role] : !this.on[role]) return;
    const x = this._x;
    x.out = this.inp[role];
    if (role === 'drums') {
      playDrum(x, this.inst.drums, ev, t);
      if (ev.midi === 36 && this.pump > 0) this._duck(t, this.pump * Math.min(1, ev.vel + 0.1));
      return;
    }
    playPatch(x, ev.patch || this.inst[role], ev, t, dur);
  }
}
