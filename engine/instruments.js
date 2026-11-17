// Ekphrasis — melodic, bass and atmosphere instruments.
// Every patch is data for one of six engines:
//   sub    subtractive: oscillators (incl. pulse waves) → filter or formant bank → amp envelope
//   fm     two-operator-style FM with decaying modulation index
//   modal  sum of decaying sine partials (mallets, bells, metallophones, piano-ish)
//   add    additive sustained sines (organ) with tremolo
//   ks     Karplus-Strong plucked string, rendered once per pitch and cached
//   atmos  vinyl crackle, drone, noise riser, shimmer
// play(x, ev, t, dur): x = { ctx, out, noise, wave(osc, type), ksBuffer(midi, patch), crackle() }

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const cl = (x, a, b) => (x < a ? a : x > b ? b : x);

function ampEnv(param, t, dur, A, peak) {
  const a = A.a ?? 0.005, d = A.d ?? 0.2, s = A.s ?? 0.7, r = A.r ?? 0.15;
  const dd = Math.max(dur, a + 0.02);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + a);
  param.setTargetAtTime(peak * s, t + a, Math.max(0.004, d / 3));
  param.setTargetAtTime(0, t + dd, Math.max(0.004, r / 4));
  return t + dd + r * 1.6 + 0.02;
}

function noiseSrc(x, t, dest, offset = 0) {
  const s = x.ctx.createBufferSource();
  s.buffer = x.noise; s.loop = true;
  s.connect(dest); s.start(t, offset);
  return s;
}

// ------------------------------------------------------------------ engines
function sub(x, ev, t, dur, P) {
  const c = x.ctx, f = mtof(ev.midi);
  const g = c.createGain();
  g.connect(x.out);
  let head;
  if (P.formants) {
    head = c.createGain();
    for (const [ff, q, fg] of P.formants) {
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = ff; bp.Q.value = q;
      const gg = c.createGain(); gg.gain.value = fg;
      head.connect(bp); bp.connect(gg); gg.connect(g);
    }
  } else {
    const fl = c.createBiquadFilter();
    fl.type = P.ft || 'lowpass'; fl.Q.value = P.q ?? 0.7;
    const base = typeof P.cut === 'function' ? P.cut(ev, f) : (P.cut ?? 6000);
    if (P.fenv) {
      fl.frequency.setValueAtTime(Math.min(18000, base * P.fenv), t);
      fl.frequency.setTargetAtTime(base, t + (P.fa || 0.002), P.fd || 0.1);
    } else if (P.swell) {
      fl.frequency.setValueAtTime(base * 0.5, t);
      fl.frequency.linearRampToValueAtTime(base, t + Math.max(0.05, dur * 0.6));
    } else fl.frequency.setValueAtTime(base, t);
    fl.connect(g);
    head = fl;
  }
  let lfo = null, lfoG = null;
  if (P.vib) {
    lfo = c.createOscillator(); lfo.frequency.value = P.vib[0];
    lfoG = c.createGain();
    lfoG.gain.setValueAtTime(0, t);
    lfoG.gain.linearRampToValueAtTime(P.vib[1], t + (P.vib[2] || 0.25));
    lfo.connect(lfoG);
  }
  const oscs = [];
  for (const [type, det, gain, ratio = 1] of P.osc) {
    if (oscs.length && f * ratio > 18000) continue;
    const o = c.createOscillator();
    x.wave(o, type);
    const og = c.createGain(); og.gain.value = gain;
    o.connect(og); og.connect(head);
    const fr = f * ratio;
    if (ev.glideFrom != null && P.glide) {
      o.frequency.setValueAtTime(mtof(ev.glideFrom) * ratio, t);
      o.frequency.exponentialRampToValueAtTime(fr, t + P.glide);
    } else if (P.punch) {
      o.frequency.setValueAtTime(fr * P.punch[0], t);
      o.frequency.exponentialRampToValueAtTime(fr, t + P.punch[1]);
    } else o.frequency.setValueAtTime(fr, t);
    o.detune.value = det;
    if (lfoG) lfoG.connect(o.detune);
    oscs.push(o);
  }
  let nz = null;
  if (P.noise) {
    const [ng, mult, q] = P.noise;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = Math.min(12000, f * mult); bp.Q.value = q;
    const gg = c.createGain(); gg.gain.value = ng;
    bp.connect(gg); gg.connect(head);
    nz = noiseSrc(x, t, bp, (ev.midi * 0.017) % 0.8);
  }
  const end = ampEnv(g.gain, t, dur, P.amp, P.level * ev.vel);
  for (const o of oscs) { o.start(t); o.stop(end); }
  if (lfo) { lfo.start(t); lfo.stop(end); }
  if (nz) nz.stop(end);
  oscs[0].onended = () => g.disconnect();
}

function fm(x, ev, t, dur, P) {
  const c = x.ctx, f = mtof(ev.midi);
  const g = c.createGain(); g.connect(x.out);
  const car = c.createOscillator(); car.frequency.value = f; car.connect(g);
  const mods = [];
  for (const [ratio, index, decay, sus] of P.mods) {
    if (f * ratio > 18000) continue;
    const m = c.createOscillator(), mg = c.createGain();
    m.frequency.value = f * ratio;
    m.connect(mg); mg.connect(car.frequency);
    const i0 = f * index * (0.5 + 0.5 * ev.vel);
    mg.gain.setValueAtTime(i0, t);
    mg.gain.setTargetAtTime(i0 * sus, t, Math.max(0.004, decay / 3));
    mods.push(m);
  }
  const end = P.ring
    ? (() => {
      const pk = P.level * ev.vel, a = P.amp.a ?? 0.004;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + a);
      g.gain.setTargetAtTime(0, t + a, P.amp.d / 6.9 * 2);
      return t + a + P.amp.d * 2;
    })()
    : ampEnv(g.gain, t, dur, P.amp, P.level * ev.vel);
  car.start(t); car.stop(end);
  for (const m of mods) { m.start(t); m.stop(end); }
  car.onended = () => g.disconnect();
}

function modal(x, ev, t, dur, P) {
  const c = x.ctx, f = mtof(ev.midi);
  const g = c.createGain(); g.gain.value = P.level * ev.vel;
  let tail = g;
  let lfo = null;
  if (P.trem) {
    const tg = c.createGain(); tg.gain.value = 1 - P.trem[1];
    lfo = c.createOscillator(); lfo.frequency.value = P.trem[0];
    const lg = c.createGain(); lg.gain.value = P.trem[1];
    lfo.connect(lg); lg.connect(tg.gain);
    g.connect(tg); tail = tg;
  }
  tail.connect(x.out);
  const reg = cl(Math.pow(2, -(ev.midi - 60) / 24), 0.35, 2.2);
  const a = P.a ?? 0.002;
  let end = t + 0.1, last = null;
  for (const [ratio, gain, decay] of P.partials) {
    const fr = f * ratio;
    if (fr > 16000) continue;
    const copies = P.beat ? [-P.beat / 2, P.beat / 2] : [0];
    const dk = decay * reg;
    for (const bd of copies) {
      const o = c.createOscillator(), pg = c.createGain();
      o.frequency.value = fr + bd;
      o.connect(pg); pg.connect(g);
      pg.gain.setValueAtTime(0, t);
      pg.gain.linearRampToValueAtTime(gain / copies.length, t + a);
      pg.gain.setTargetAtTime(0, t + a, dk / 6.9);
      let e = t + a + dk;
      if (P.damp && dur + 0.02 < dk) { pg.gain.setTargetAtTime(0, t + Math.max(dur, a + 0.01), P.damp / 4); e = Math.min(e, t + dur + P.damp * 1.6); }
      o.start(t); o.stop(e + 0.02);
      if (e + 0.02 >= end || !last) { end = Math.max(end, e + 0.02); last = o; }
    }
  }
  if (P.click) {
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
    const cg = c.createGain(); hp.connect(cg); cg.connect(tail);
    cg.gain.setValueAtTime(P.click / Math.max(0.01, P.level), t);
    cg.gain.setTargetAtTime(0, t, 0.004);
    const n = noiseSrc(x, t, hp, 0.2); n.stop(t + 0.04);
  }
  if (lfo) { lfo.start(t); lfo.stop(end); }
  if (last) last.onended = () => tail.disconnect();
}

function add(x, ev, t, dur, P) {
  const c = x.ctx, f = mtof(ev.midi);
  const g = c.createGain();
  let tail = g, lfo = null;
  if (P.trem) {
    const tg = c.createGain(); tg.gain.value = 1 - P.trem[1];
    lfo = c.createOscillator(); lfo.frequency.value = P.trem[0];
    const lg = c.createGain(); lg.gain.value = P.trem[1];
    lfo.connect(lg); lg.connect(tg.gain);
    g.connect(tg); tail = tg;
  }
  tail.connect(x.out);
  const oscs = [];
  for (const [ratio, gain] of P.harm) {
    if (f * ratio > 16000) continue;
    const o = c.createOscillator(), og = c.createGain();
    o.frequency.value = f * ratio; og.gain.value = gain;
    o.connect(og); og.connect(g);
    oscs.push(o);
  }
  const end = ampEnv(g.gain, t, dur, P.amp, P.level * ev.vel);
  for (const o of oscs) { o.start(t); o.stop(end); }
  if (lfo) { lfo.start(t); lfo.stop(end); }
  if (P.click) {
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
    const cg = c.createGain(); hp.connect(cg); cg.connect(tail);
    cg.gain.setValueAtTime(P.click * ev.vel, t); cg.gain.setTargetAtTime(0, t, 0.003);
    const n = noiseSrc(x, t, hp, 0.4); n.stop(t + 0.03);
  }
  oscs[0].onended = () => tail.disconnect();
}

function ks(x, ev, t, dur, P) {
  const c = x.ctx, kb = x.ksBuffer(ev.midi, P);
  const src = c.createBufferSource();
  src.buffer = kb.buffer; src.playbackRate.value = kb.rate;
  const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = P.tone; fl.Q.value = 0.5;
  const g = c.createGain();
  src.connect(fl); fl.connect(g); g.connect(x.out);
  g.gain.setValueAtTime(P.level * ev.vel, t);
  let end = t + kb.buffer.duration / kb.rate;
  if (P.damp) {
    const off = t + Math.max(dur, 0.04);
    if (off < end) { g.gain.setTargetAtTime(0, off, P.damp / 4); end = Math.min(end, off + P.damp * 1.6); }
  }
  src.start(t); src.stop(end);
  src.onended = () => g.disconnect();
}

function atmos(x, ev, t, dur, P) {
  const c = x.ctx, g = c.createGain();
  g.connect(x.out);
  const f = mtof(ev.midi || 48);
  switch (P.kind) {
    case 'vinyl': {
      const s = c.createBufferSource(); s.buffer = x.crackle(); s.loop = true;
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 400;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000;
      s.connect(hp); hp.connect(lp); lp.connect(g);
      const pk = P.level * ev.vel;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + 0.05);
      g.gain.setValueAtTime(pk, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.1);
      s.start(t, (ev.midi * 0.37) % 2.5); s.stop(t + dur + 0.12);
      s.onended = () => g.disconnect();
      return;
    }
    case 'drone': {
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 2;
      const lfo = c.createOscillator(); lfo.frequency.value = 0.07;
      const lg = c.createGain(); lg.gain.value = 450;
      lfo.connect(lg); lg.connect(lp.frequency); lp.connect(g);
      const parts = [['triangle', 1, -4, 0.5], ['triangle', 1.5, 4, 0.3], ['sine', 2, 0, 0.3], ['sine', 0.5, 0, 0.35]];
      const os = parts.map(([ty, r, dt, gn]) => {
        const o = c.createOscillator(), og = c.createGain();
        o.type = ty; o.frequency.value = f * r; o.detune.value = dt; og.gain.value = gn;
        o.connect(og); og.connect(lp); return o;
      });
      const end = ampEnv(g.gain, t, dur, { a: 2.5, d: 1, s: 1, r: 3 }, P.level * ev.vel);
      for (const o of os) { o.start(t); o.stop(end); }
      lfo.start(t); lfo.stop(end);
      os[0].onended = () => g.disconnect();
      return;
    }
    case 'wash': {
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
      bp.frequency.setValueAtTime(300, t);
      bp.frequency.exponentialRampToValueAtTime(7500, t + dur);
      bp.connect(g);
      const pk = P.level * ev.vel;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(pk, t + Math.max(0.1, dur - 0.04));
      g.gain.linearRampToValueAtTime(0, t + dur + 0.03);
      const n = noiseSrc(x, t, bp, 0.1); n.stop(t + dur + 0.05);
      n.onended = () => g.disconnect();
      return;
    }
    case 'shimmer': {
      const tg = c.createGain(); tg.gain.value = 0.6;
      const lfo = c.createOscillator(); lfo.frequency.value = 3.3;
      const lg = c.createGain(); lg.gain.value = 0.4;
      lfo.connect(lg); lg.connect(tg.gain);
      tg.connect(g);
      const os = [1, 2.001].map((r) => { const o = c.createOscillator(); o.frequency.value = f * r; o.connect(tg); return o; });
      const end = ampEnv(g.gain, t, dur, { a: 1.2, d: 1, s: 1, r: 2 }, P.level * ev.vel);
      for (const o of os) { o.start(t); o.stop(end); }
      lfo.start(t); lfo.stop(end);
      os[0].onended = () => g.disconnect();
      return;
    }
  }
}

const ENGINES = { sub, fm, modal, add, ks, atmos };

// ------------------------------------------------------------------ patches
const brightCut = (lo, span) => (ev) => lo + (ev.bright ?? 0.5) * span;
const padCut = (mul = 1) => (ev) => Math.min(6000, (ev.cut || 1200) * mul);

export const PATCHES = {
  // ---- melodic (lead / arp / chords)
  saw:       { label: 'Saw lead', gm: 81, eng: 'sub', osc: [['sawtooth', -7, 0.5], ['sawtooth', 7, 0.5]], cut: brightCut(500, 2600), q: 3, fenv: 4, fd: 0.09, amp: { a: 0.008, d: 0.36, s: 0.6, r: 0.15 }, level: 0.2, glide: 0.06 },
  square:    { label: 'Square lead', gm: 80, eng: 'sub', osc: [['square', -5, 0.5], ['square', 5, 0.5]], cut: brightCut(700, 2200), q: 2, fenv: 3, fd: 0.12, amp: { a: 0.006, d: 0.3, s: 0.7, r: 0.12 }, level: 0.15, glide: 0.05 },
  pulse:     { label: 'Pulse (chip)', gm: 80, eng: 'sub', osc: [['pulse25', 0, 1]], cut: 12000, q: 0.5, amp: { a: 0.002, d: 0.1, s: 0.85, r: 0.03 }, level: 0.12, vib: [6, 12, 0.18], glide: 0.04 },
  chip:      { label: 'Chip square', gm: 80, eng: 'sub', osc: [['pulse50', 0, 1]], cut: 10000, q: 0.5, amp: { a: 0.002, d: 0.08, s: 0.7, r: 0.03 }, level: 0.09 },
  flute:     { label: 'Flute', gm: 73, eng: 'sub', osc: [['sine', 0, 0.8], ['triangle', 0, 0.25]], noise: [0.5, 2, 1.5], cut: 5000, amp: { a: 0.06, d: 0.2, s: 0.85, r: 0.12 }, vib: [5, 10, 0.3], level: 0.12 },
  bowed:     { label: 'Bowed string', gm: 40, eng: 'sub', osc: [['sawtooth', -4, 0.5], ['sawtooth', 4, 0.5]], formants: [[500, 2, 0.8], [1500, 2, 1], [3200, 3, 0.5]], amp: { a: 0.12, d: 0.3, s: 0.85, r: 0.25 }, vib: [5.5, 14, 0.25], level: 0.3 },
  brass:     { label: 'Brass', gm: 61, eng: 'sub', osc: [['sawtooth', -6, 0.5], ['sawtooth', 6, 0.5]], cut: (ev) => 900 + ev.vel * 1600, q: 1.5, fenv: 2.2, fa: 0.06, fd: 0.12, amp: { a: 0.04, d: 0.3, s: 0.8, r: 0.15 }, vib: [5, 8, 0.35], level: 0.17 },
  organ:     { label: 'Organ', gm: 16, eng: 'add', harm: [[0.5, 0.5], [1, 1], [2, 0.6], [3, 0.3], [4, 0.25], [6, 0.12]], amp: { a: 0.006, d: 0.1, s: 1, r: 0.06 }, trem: [6.2, 0.25], click: 0.05, level: 0.07 },
  epiano:    { label: 'Electric piano', gm: 4, eng: 'fm', mods: [[1, 1.8, 0.9, 0.15], [14, 0.5, 0.04, 0]], amp: { a: 0.003, d: 2.4, s: 0, r: 0.3 }, level: 0.15 },
  keys:      { label: 'Piano', gm: 0, eng: 'modal', partials: [[1, 1, 3], [2, 0.55, 2], [3, 0.3, 1.2], [4, 0.18, 0.8], [5.01, 0.1, 0.5], [6.03, 0.06, 0.35]], damp: 0.15, click: 0.02, level: 0.17 },
  pluck:     { label: 'Guitar pluck', gm: 25, eng: 'ks', t60: 1.6, bright: 0.65, tone: 4200, damp: 0.3, level: 0.5 },
  harp:      { label: 'Harp', gm: 46, eng: 'ks', t60: 3.2, bright: 0.85, tone: 7000, level: 0.42 },
  marimba:   { label: 'Marimba', gm: 12, eng: 'modal', partials: [[1, 1, 0.7], [3.99, 0.35, 0.15], [10.65, 0.12, 0.04]], click: 0.02, level: 0.32 },
  vibes:     { label: 'Vibraphone', gm: 11, eng: 'modal', partials: [[1, 1, 2.8], [4, 0.3, 0.8], [10.1, 0.08, 0.15]], trem: [5, 0.35], level: 0.2 },
  bell:      { label: 'FM bell', gm: 14, eng: 'fm', mods: [[3.5, 2.2, 0.55, 0.07]], amp: { a: 0.004, d: 1.3 }, ring: true, level: 0.14 },
  musicbox:  { label: 'Music box', gm: 10, eng: 'modal', partials: [[1, 1, 1.4], [2, 0.25, 0.5], [3, 0.12, 0.25], [5.4, 0.08, 0.12]], click: 0.01, level: 0.2 },
  kalimba:   { label: 'Kalimba', gm: 108, eng: 'modal', partials: [[1, 1, 1.2], [5.4, 0.25, 0.12], [11.2, 0.1, 0.04]], click: 0.03, level: 0.3 },
  gamelan:   { label: 'Gamelan metal', gm: 13, eng: 'modal', partials: [[1, 1, 3.5], [2.76, 0.45, 1.4], [5.4, 0.25, 0.6], [8.93, 0.12, 0.3]], beat: 4.5, level: 0.17 },
  glass:     { label: 'Glass', gm: 92, eng: 'sub', osc: [['sine', 0, 0.8], ['sine', 0, 0.25, 3]], cut: 8000, amp: { a: 0.03, d: 1.2, s: 0.4, r: 0.6 }, level: 0.14 },
  warmPad:   { label: 'Warm pad', gm: 89, eng: 'sub', osc: [['sawtooth', -11, 0.34], ['sawtooth', 0, 0.33], ['sawtooth', 11, 0.33]], cut: padCut(1), swell: true, q: 0.6, amp: { a: 0.6, d: 0.5, s: 1, r: 1.4 }, level: 0.15 },
  strings:   { label: 'Strings', gm: 48, eng: 'sub', osc: [['sawtooth', -14, 0.25], ['sawtooth', -5, 0.25], ['sawtooth', 5, 0.25], ['sawtooth', 14, 0.25]], cut: padCut(1.4), q: 0.5, vib: [5.2, 7, 0.4], amp: { a: 0.35, d: 0.5, s: 0.9, r: 0.8 }, level: 0.19 },
  choir:     { label: 'Choir', gm: 52, eng: 'sub', osc: [['sawtooth', -8, 0.5], ['sawtooth', 8, 0.5]], formants: [[730, 8, 1], [1090, 10, 0.5], [2440, 12, 0.25]], vib: [4.8, 10, 0.4], amp: { a: 0.45, d: 0.5, s: 0.9, r: 1 }, level: 0.6 },
  glassPad:  { label: 'Glass pad', gm: 92, eng: 'sub', osc: [['sine', -6, 0.5], ['triangle', 6, 0.4], ['sine', 0, 0.15, 2]], cut: 6000, amp: { a: 0.9, d: 1, s: 0.9, r: 2 }, vib: [0.4, 6, 1], level: 0.13 },
  polySynth: { label: 'Poly synth', gm: 90, eng: 'sub', osc: [['sawtooth', -9, 0.4], ['sawtooth', 9, 0.4], ['square', 0, 0.2, 0.5]], cut: padCut(1), q: 2, fenv: 2, fa: 0.15, fd: 0.4, amp: { a: 0.08, d: 0.6, s: 0.75, r: 0.6 }, level: 0.12 },
  stab:      { label: 'Synth stab', gm: 62, eng: 'sub', osc: [['sawtooth', -8, 0.4], ['sawtooth', 8, 0.4], ['square', 0, 0.2]], cut: 900, q: 4, fenv: 5, fd: 0.08, amp: { a: 0.003, d: 0.18, s: 0.25, r: 0.08 }, level: 0.17 },
  // ---- bass
  synth:     { label: 'Synth bass', gm: 38, eng: 'sub', osc: [['sine', 0, 0.7], ['sawtooth', 0, 0.35]], cut: (ev) => 260 + ev.vel * 600, q: 5, amp: { a: 0.006, d: 0.3, s: 0.7, r: 0.08 }, level: 0.32 },
  sub:       { label: 'Sub bass', gm: 38, eng: 'sub', osc: [['sine', 0, 1], ['sine', 0, 0.15, 2]], cut: 2000, amp: { a: 0.01, d: 0.4, s: 0.85, r: 0.1 }, level: 0.36 },
  acid:      { label: 'Acid (303)', gm: 87, eng: 'sub', osc: [['sawtooth', 0, 1]], cut: (ev) => 250 + ev.vel * 500, q: 14, fenv: 6, fd: 0.14, amp: { a: 0.003, d: 0.25, s: 0.6, r: 0.06 }, level: 0.11, glide: 0.07, insert: { drive: 0.5 } },
  reese:     { label: 'Reese', gm: 39, eng: 'sub', osc: [['sawtooth', -18, 0.5], ['sawtooth', 18, 0.5], ['sine', 0, 0.6]], cut: 650, q: 2, amp: { a: 0.02, d: 0.4, s: 0.9, r: 0.12 }, level: 0.22 },
  '808':     { label: '808', gm: 38, eng: 'sub', osc: [['sine', 0, 1], ['triangle', 0, 0.15]], cut: 3000, punch: [2.2, 0.035], glide: 0.09, amp: { a: 0.002, d: 1.8, s: 0, r: 0.1 }, level: 0.2, insert: { drive: 0.35 } },
  upright:   { label: 'Upright bass', gm: 32, eng: 'ks', t60: 1.3, bright: 0.35, tone: 1100, damp: 0.12, level: 1.4 },
  fmBass:    { label: 'FM bass', gm: 38, eng: 'fm', mods: [[1, 2.5, 0.25, 0.4]], amp: { a: 0.003, d: 0.4, s: 0.6, r: 0.07 }, level: 0.3 },
  chipTri:   { label: 'Chip triangle', gm: 38, eng: 'sub', osc: [['triangle', 0, 1]], cut: 8000, amp: { a: 0.002, d: 0.1, s: 0.95, r: 0.02 }, level: 0.4 },
  pizz:      { label: 'Pizzicato', gm: 45, eng: 'ks', t60: 0.55, bright: 0.55, tone: 2400, level: 1.2 },
  // ---- atmosphere
  off:       { label: 'Off', gm: -1, eng: null },
  vinyl:     { label: 'Vinyl crackle', gm: -1, eng: 'atmos', kind: 'vinyl', level: 0.9 },
  drone:     { label: 'Drone', gm: 95, eng: 'atmos', kind: 'drone', level: 0.08 },
  wash:      { label: 'Noise riser', gm: -1, eng: 'atmos', kind: 'wash', level: 0.14 },
  shimmer:   { label: 'Shimmer', gm: 92, eng: 'atmos', kind: 'shimmer', level: 0.035 },
};

export const MELODIC = ['saw', 'square', 'pulse', 'chip', 'flute', 'bowed', 'brass', 'organ', 'epiano', 'keys', 'pluck', 'harp', 'marimba', 'vibes', 'bell', 'musicbox', 'kalimba', 'gamelan', 'glass', 'warmPad', 'strings', 'choir', 'glassPad', 'polySynth', 'stab'];
export const BASSES = ['synth', 'sub', 'acid', 'reese', '808', 'upright', 'fmBass', 'chipTri', 'pizz'];
export const ATMOS = ['off', 'vinyl', 'drone', 'wash', 'shimmer'];

export function playPatch(x, name, ev, t, dur) {
  const P = PATCHES[name];
  if (!P || !P.eng) return;
  ENGINES[P.eng](x, ev, t, dur, P);
}

// ------------------------------------------------------------------ cached resources
export function makePeriodicWaves(ctx) {
  const pulse = (d) => {
    const N = 64, re = new Float32Array(N), im = new Float32Array(N);
    for (let n = 1; n < N; n++) {
      re[n] = Math.sin(2 * Math.PI * n * d) / (n * Math.PI);
      im[n] = (2 / (n * Math.PI)) * Math.sin(Math.PI * n * d) ** 2;
    }
    return ctx.createPeriodicWave(re, im);
  };
  return { pulse25: pulse(0.25), pulse12: pulse(0.125), pulse50: pulse(0.5) };
}

export function renderKS(ctx, midi, P, rnd) {
  const sr = ctx.sampleRate, f = mtof(midi);
  const N = Math.max(2, Math.floor(sr / f - 0.5));
  const rate = f * (N + 0.5) / sr;
  const t60 = P.t60 * cl(Math.pow(2, -(midi - 48) / 36), 0.4, 2);
  const len = Math.min(sr * 4, Math.ceil(sr * (t60 + 0.05) * rate) + N + 2);
  const buf = ctx.createBuffer(1, len, sr), y = buf.getChannelData(0);
  const loss = Math.pow(10, -3 / (t60 * f));
  let lp = 0, mean = 0;
  for (let i = 0; i <= N; i++) { lp += ((rnd() * 2 - 1) - lp) * P.bright; y[i] = lp; mean += lp; }
  mean /= N + 1;
  for (let i = 0; i <= N; i++) y[i] -= mean;
  for (let i = N + 1; i < len; i++) y[i] = loss * 0.5 * (y[i - N] + y[i - N - 1]);
  return { buffer: buf, rate };
}

export function renderCrackle(ctx, rnd) {
  const sr = ctx.sampleRate, len = sr * 3, b = ctx.createBuffer(1, len, sr), d = b.getChannelData(0);
  let hiss = 0;
  for (let i = 0; i < len; i++) {
    hiss += ((rnd() * 2 - 1) - hiss) * 0.15;
    d[i] = hiss * 0.05;
  }
  const pops = Math.floor(3 * 26);
  for (let k = 0; k < pops; k++) {
    const p = Math.floor(rnd() * (len - 200)), amp = Math.pow(rnd(), 3) * 0.9 + 0.05, sign = rnd() < 0.5 ? -1 : 1;
    const w = 2 + Math.floor(rnd() * 30);
    for (let j = 0; j < w; j++) d[p + j] += sign * amp * Math.exp(-j / (w * 0.3)) * (j % 2 ? -0.6 : 1);
  }
  return b;
}
