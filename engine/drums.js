// Ekphrasis — drum kits.
// Pieces are small synthesis recipes; a kit maps General MIDI drum notes to a piece + parameters.
// GM notes used by the composer: 36 kick, 37 rim, 38 snare, 39 clap, 41 timpani/floor tom, 42 closed hat,
// 45 tom, 46 open hat, 48 high tom, 49 crash, 51 ride, 52 gong, 56 bell/cowbell, 70 shaker.

const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800]; // TR-808 cymbal oscillator bank

function noise(x, t, dest, off = 0) {
  const s = x.ctx.createBufferSource();
  s.buffer = x.noise; s.loop = true;
  s.connect(dest); s.start(t, off);
  return s;
}
function filt(c, type, f, q = 0.7) { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
function decayGain(c, dest, t, peak, tau) {
  const g = c.createGain(); g.connect(dest);
  g.gain.setValueAtTime(peak, t);
  g.gain.setTargetAtTime(0, t + 0.001, tau);
  return g;
}
function metalBank(x, t, dest, end, scale = 1) {
  const c = x.ctx;
  const os = METAL.map((f) => { const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f * scale; o.connect(dest); o.start(t); o.stop(end); return o; });
  return os[0];
}

const P = {
  kick(x, ev, t, p) {
    const c = x.ctx, g = c.createGain(); g.connect(x.out);
    const o = c.createOscillator(); o.connect(g);
    o.frequency.setValueAtTime(p.f0 ?? 150, t);
    o.frequency.exponentialRampToValueAtTime(p.f1 ?? 46, t + (p.pd ?? 0.11));
    const ad = p.ad ?? 0.42, pk = (p.level ?? 0.9) * ev.vel;
    g.gain.setValueAtTime(pk, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + ad);
    o.start(t); o.stop(t + ad + 0.02);
    o.onended = () => g.disconnect();
    if (p.click) {
      const hp = filt(c, 'highpass', 3000), cg = decayGain(c, x.out, t, p.click * ev.vel, 0.004);
      hp.connect(cg);
      const n = noise(x, t, hp, 0.1); n.stop(t + 0.03);
    }
  },
  snare(x, ev, t, p) {
    const c = x.ctx;
    const hp = filt(c, 'highpass', p.nhp ?? 900);
    const g = c.createGain(); hp.connect(g); g.connect(x.out);
    const ng = (p.ng ?? 0.45) * ev.vel;
    g.gain.setValueAtTime(ng, t);
    if (p.gate) {
      g.gain.setTargetAtTime(ng * 0.55, t + 0.001, 0.08);
      g.gain.setTargetAtTime(0, t + p.gate, 0.006);
    } else g.gain.setTargetAtTime(0, t + 0.001, p.nd ?? 0.045);
    const len = p.gate ? p.gate + 0.06 : (p.nd ?? 0.045) * 7;
    const n = noise(x, t, hp, (ev.vel * 0.37) % 0.5); n.stop(t + len);
    n.onended = () => g.disconnect();
    const tg = decayGain(c, x.out, t, (p.tg ?? 0.25) * ev.vel, p.td ?? 0.03);
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = p.tone ?? 190; o.connect(tg);
    o.start(t); o.stop(t + (p.td ?? 0.03) * 7);
    o.onended = () => tg.disconnect();
  },
  clap(x, ev, t, p) {
    const c = x.ctx, bp = filt(c, 'bandpass', p.f ?? 1150, 1.2), g = c.createGain();
    bp.connect(g); g.connect(x.out);
    const pk = (p.level ?? 0.7) * ev.vel;
    g.gain.setValueAtTime(0, t);
    for (let k = 0; k < 3; k++) {
      const tk = t + k * 0.011;
      g.gain.setValueAtTime(pk, tk);
      g.gain.setTargetAtTime(pk * 0.2, tk + 0.0005, 0.003);
    }
    g.gain.setValueAtTime(pk * 0.8, t + 0.034);
    g.gain.setTargetAtTime(0, t + 0.035, p.tail ?? 0.06);
    const n = noise(x, t, bp, 0.2); n.stop(t + 0.5);
    n.onended = () => g.disconnect();
  },
  hat(x, ev, t, p) {
    const c = x.ctx, hp = filt(c, 'highpass', p.hp ?? 7500), g = c.createGain();
    hp.connect(g); g.connect(x.out);
    const d = p.d ?? 0.012, pk = (p.level ?? 0.2) * ev.vel;
    g.gain.setValueAtTime(pk, t);
    g.gain.setTargetAtTime(0, t + 0.001, d);
    const end = t + d * 8 + 0.02;
    if (p.metal) {
      const bp = filt(c, 'bandpass', 10000, 1); bp.connect(hp);
      const g2 = c.createGain(); g2.gain.value = 0.5; g2.connect(bp);
      metalBank(x, t, g2, end).onended = () => g.disconnect();
    } else {
      const n = noise(x, t, hp, 0.3); n.stop(end);
      n.onended = () => g.disconnect();
    }
  },
  ride(x, ev, t, p) {
    const c = x.ctx, bp = filt(c, 'bandpass', p.f ?? 7000, 0.8), g = c.createGain();
    bp.connect(g); g.connect(x.out);
    const pk = (p.level ?? 0.12) * ev.vel, d = p.d ?? 0.35;
    g.gain.setValueAtTime(pk, t);
    g.gain.setTargetAtTime(0, t + 0.001, d);
    const end = t + d * 7;
    const mg = c.createGain(); mg.gain.value = 0.6; mg.connect(bp);
    metalBank(x, t, mg, end, 1.6).onended = () => g.disconnect();
    const bell = c.createOscillator(); bell.frequency.value = 3150;
    const bg = decayGain(c, x.out, t, pk * 0.25 * (p.bell ?? 1), 0.12);
    bell.connect(bg); bell.start(t); bell.stop(t + 0.8);
    bell.onended = () => bg.disconnect();
  },
  crash(x, ev, t, p) {
    const c = x.ctx, hp = filt(c, 'highpass', p.hp ?? 3500), g = c.createGain();
    hp.connect(g); g.connect(x.out);
    const pk = (p.level ?? 0.25) * ev.vel, d = p.d ?? 0.55;
    g.gain.setValueAtTime(pk, t);
    g.gain.setTargetAtTime(0, t + 0.001, d);
    const end = t + d * 7;
    const n = noise(x, t, hp, 0.6); n.stop(end);
    const mg = c.createGain(); mg.gain.value = 0.3; mg.connect(hp);
    metalBank(x, t, mg, end, 2.1);
    n.onended = () => g.disconnect();
  },
  rim(x, ev, t, p) {
    const c = x.ctx, g = decayGain(c, x.out, t, (p.level ?? 0.35) * ev.vel, 0.008);
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = p.f ?? 1700; o.connect(g);
    o.start(t); o.stop(t + 0.07);
    o.onended = () => g.disconnect();
    const bp = filt(c, 'bandpass', 2200, 2), ng = decayGain(c, x.out, t, (p.level ?? 0.35) * 0.6 * ev.vel, 0.006);
    bp.connect(ng);
    const n = noise(x, t, bp, 0.7); n.stop(t + 0.05);
  },
  tom(x, ev, t, p) {
    const c = x.ctx, f = p.f ?? 110, d = p.d ?? 0.35;
    const g = c.createGain(); g.connect(x.out);
    const o = c.createOscillator(); o.connect(g);
    o.frequency.setValueAtTime(f * 1.5, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
    const pk = (p.level ?? 0.6) * ev.vel;
    g.gain.setValueAtTime(pk, t);
    g.gain.setTargetAtTime(0, t + 0.001, d / 5);
    o.start(t); o.stop(t + d * 1.5);
    o.onended = () => g.disconnect();
  },
  timpani(x, ev, t, p) {
    const c = x.ctx, f = p.f ?? 80, g = c.createGain(); g.connect(x.out);
    const pk = (p.level ?? 0.5) * ev.vel;
    g.gain.setValueAtTime(pk, t);
    g.gain.setTargetAtTime(0, t + 0.001, 0.45);
    const os = [[1, 1], [1.5, 0.45], [1.98, 0.3], [2.44, 0.15]].map(([r, a]) => {
      const o = c.createOscillator(), og = c.createGain();
      o.frequency.setValueAtTime(f * r * 1.03, t);
      o.frequency.exponentialRampToValueAtTime(f * r, t + 0.12);
      og.gain.value = a; o.connect(og); og.connect(g);
      o.start(t); o.stop(t + 3.2);
      return o;
    });
    os[0].onended = () => g.disconnect();
    const lp = filt(c, 'lowpass', 900), ng = decayGain(c, x.out, t, pk * 0.4, 0.02);
    lp.connect(ng);
    const n = noise(x, t, lp, 0.9); n.stop(t + 0.15);
  },
  shaker(x, ev, t, p) {
    const c = x.ctx, bp = filt(c, 'bandpass', p.f ?? 6500, 1.2), g = c.createGain();
    bp.connect(g); g.connect(x.out);
    const pk = (p.level ?? 0.22) * ev.vel;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(pk, t + 0.012);
    g.gain.setTargetAtTime(0, t + 0.012, 0.025);
    const n = noise(x, t, bp, 0.45); n.stop(t + 0.2);
    n.onended = () => g.disconnect();
  },
  cowbell(x, ev, t, p) {
    const c = x.ctx, bp = filt(c, 'bandpass', 2640, 1), g = decayGain(c, x.out, t, (p.level ?? 0.18) * ev.vel, 0.07);
    bp.connect(g);
    const os = [540, 800].map((f) => { const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(bp); o.start(t); o.stop(t + 0.6); return o; });
    os[0].onended = () => g.disconnect();
  },
  gong(x, ev, t, p) {
    const c = x.ctx, f = p.f ?? 70, g = c.createGain(); g.connect(x.out);
    const pk = (p.level ?? 0.35) * ev.vel;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(pk, t + 0.02);
    g.gain.setTargetAtTime(0, t + 0.02, 1.2);
    const os = [[1, 1], [1.48, 0.5], [2.09, 0.4], [2.9, 0.25], [4.12, 0.12]].map(([r, a], i) => {
      const o = c.createOscillator(), og = c.createGain();
      o.frequency.setValueAtTime(f * r * 1.01, t);
      o.frequency.exponentialRampToValueAtTime(f * r, t + 1.5);
      o.detune.value = i % 2 ? 6 : -6;
      og.gain.value = a; o.connect(og); og.connect(g);
      o.start(t); o.stop(t + 7);
      return o;
    });
    os[0].onended = () => g.disconnect();
  },
  bonang(x, ev, t, p) {
    const c = x.ctx, f = p.f ?? 260, g = c.createGain(); g.connect(x.out);
    const pk = (p.level ?? 0.25) * ev.vel;
    const os = [];
    for (const [r, a, d] of [[1, 1, 1.6], [2.76, 0.35, 0.5], [5.4, 0.15, 0.2]]) {
      for (const bd of [-1.5, 1.5]) {
        const o = c.createOscillator(), og = c.createGain();
        o.frequency.value = f * r + bd; o.connect(og); og.connect(g);
        og.gain.setValueAtTime(pk * a * 0.5, t);
        og.gain.setTargetAtTime(0, t + 0.001, d / 6.9);
        o.start(t); o.stop(t + d + 0.05);
        os.push(o);
      }
    }
    os[0].onended = () => g.disconnect();
  },
  brush(x, ev, t, p) {
    const c = x.ctx, bp = filt(c, 'bandpass', p.f ?? 3200, 0.7), g = c.createGain();
    bp.connect(g); g.connect(x.out);
    const pk = (p.level ?? 0.3) * ev.vel;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(pk, t + 0.025);
    g.gain.setTargetAtTime(0, t + 0.025, p.d ?? 0.07);
    const n = noise(x, t, bp, 0.15); n.stop(t + 0.6);
    n.onended = () => g.disconnect();
  },
  chipKick(x, ev, t, p) {
    const c = x.ctx, g = c.createGain(); g.connect(x.out);
    const o = c.createOscillator(); o.type = 'square'; o.connect(g);
    o.frequency.setValueAtTime(p.f0 ?? 140, t);
    o.frequency.exponentialRampToValueAtTime(p.f1 ?? 38, t + 0.06);
    g.gain.setValueAtTime((p.level ?? 0.35) * ev.vel, t);
    g.gain.setTargetAtTime(0, t + 0.001, 0.05);
    o.start(t); o.stop(t + 0.3);
    o.onended = () => g.disconnect();
  },
  chipNoise(x, ev, t, p) {
    const c = x.ctx, hp = filt(c, 'highpass', p.hp ?? 1000), g = c.createGain();
    hp.connect(g); g.connect(x.out);
    const d = p.d ?? 0.05;
    g.gain.setValueAtTime((p.level ?? 0.3) * ev.vel, t);
    g.gain.setTargetAtTime(0, t + 0.001, d);
    const n = noise(x, t, hp, 0.25); n.stop(t + d * 8);
    n.onended = () => g.disconnect();
  },
};

const STUDIO = {
  36: ['kick', { f0: 150, f1: 46, pd: 0.11, ad: 0.42, click: 0.15 }],
  37: ['rim', {}],
  38: ['snare', { tone: 190, nhp: 900, nd: 0.045, ng: 0.45, td: 0.03, tg: 0.25 }],
  39: ['clap', {}],
  41: ['tom', { f: 82, d: 0.5 }],
  42: ['hat', { hp: 7500, d: 0.012 }],
  45: ['tom', { f: 110 }],
  46: ['hat', { hp: 7000, d: 0.08 }],
  48: ['tom', { f: 160, d: 0.3 }],
  49: ['crash', {}],
  51: ['ride', {}],
  52: ['crash', { d: 0.9, hp: 1500 }],
  56: ['cowbell', {}],
  70: ['shaker', {}],
};

export const KITS = {
  studio: { label: 'Studio', map: {} },
  retro: {
    label: 'Retro (gated)', send: [0.35, 0.04],
    map: {
      36: ['kick', { f0: 170, f1: 48, pd: 0.07, ad: 0.38, click: 0.25 }],
      38: ['snare', { tone: 200, nhp: 700, ng: 0.6, gate: 0.2, tg: 0.3, td: 0.05 }],
      45: ['tom', { f: 95, d: 0.55, level: 0.7 }],
      48: ['tom', { f: 140, d: 0.45, level: 0.7 }],
    },
  },
  '808': {
    label: '808', insert: { drive: 0.15 },
    map: {
      36: ['kick', { f0: 120, f1: 42, pd: 0.06, ad: 1.1, click: 0.05, level: 0.85 }],
      38: ['snare', { tone: 240, tg: 0.35, nhp: 1800, nd: 0.03, ng: 0.3 }],
      39: ['clap', { level: 0.8, tail: 0.07 }],
      42: ['hat', { metal: true, hp: 7000, d: 0.012, level: 0.3 }],
      46: ['hat', { metal: true, hp: 6500, d: 0.09, level: 0.28 }],
      45: ['tom', { f: 100, d: 0.6 }],
      48: ['tom', { f: 150, d: 0.5 }],
    },
  },
  '909': {
    label: '909',
    map: {
      36: ['kick', { f0: 210, f1: 50, pd: 0.05, ad: 0.36, click: 0.3, level: 0.95 }],
      38: ['snare', { tone: 200, nhp: 1200, nd: 0.07, ng: 0.55, tg: 0.22 }],
      39: ['clap', { level: 0.75 }],
      42: ['hat', { metal: true, hp: 8000, d: 0.015, level: 0.26 }],
      46: ['hat', { metal: true, hp: 7500, d: 0.12, level: 0.24 }],
      51: ['ride', { f: 8000, level: 0.1 }],
    },
  },
  breaks: {
    label: 'Breaks', insert: { drive: 0.2, lp: 9000 },
    map: {
      36: ['kick', { f0: 170, f1: 55, pd: 0.04, ad: 0.25, click: 0.3 }],
      38: ['snare', { tone: 210, nhp: 800, nd: 0.06, ng: 0.6, tg: 0.3 }],
      42: ['hat', { hp: 8000, d: 0.01, level: 0.22 }],
      51: ['ride', { level: 0.1, d: 0.25 }],
    },
  },
  lofi: {
    label: 'Lo-fi', insert: { lp: 3600, drive: 0.35, bits: 9 },
    map: {
      36: ['kick', { f0: 110, f1: 45, pd: 0.09, ad: 0.35, click: 0.02, level: 1 }],
      38: ['snare', { tone: 180, nhp: 700, nd: 0.05, ng: 0.4, tg: 0.22 }],
      42: ['hat', { hp: 6000, d: 0.015, level: 0.18 }],
      46: ['hat', { hp: 5500, d: 0.07, level: 0.16 }],
    },
  },
  brushes: {
    label: 'Brushes', insert: { lp: 7000 },
    map: {
      36: ['kick', { f0: 95, f1: 48, pd: 0.08, ad: 0.3, click: 0, level: 0.6 }],
      38: ['brush', { level: 0.3 }],
      42: ['hat', { hp: 6000, d: 0.02, level: 0.12 }],
      51: ['ride', { f: 6000, level: 0.09, d: 0.4, bell: 0.4 }],
    },
  },
  chip: {
    label: 'Chip', insert: { bits: 4 },
    map: {
      36: ['chipKick', {}],
      38: ['chipNoise', { d: 0.06, hp: 1200, level: 0.3 }],
      39: ['chipNoise', { d: 0.05, hp: 1500, level: 0.3 }],
      42: ['chipNoise', { d: 0.015, hp: 4000, level: 0.18 }],
      46: ['chipNoise', { d: 0.08, hp: 4000, level: 0.16 }],
      45: ['chipKick', { f0: 300, f1: 120 }],
      48: ['chipKick', { f0: 420, f1: 180 }],
    },
  },
  orchestral: {
    label: 'Orchestral', send: [0.4, 0.02],
    map: {
      36: ['kick', { f0: 80, f1: 50, pd: 0.15, ad: 0.9, click: 0, level: 0.8 }],
      38: ['snare', { tone: 220, nhp: 600, nd: 0.08, ng: 0.4, tg: 0.2 }],
      41: ['timpani', { f: 65 }],
      45: ['timpani', { f: 87 }],
      48: ['timpani', { f: 110 }],
      49: ['crash', { d: 0.9, level: 0.22 }],
      52: ['gong', { f: 55 }],
    },
  },
  gamelan: {
    label: 'Gamelan', send: [0.3, 0],
    map: {
      52: ['gong', { f: 70, level: 0.4 }],
      56: ['bonang', { f: 262 }],
      45: ['tom', { f: 180, d: 0.18, level: 0.5 }],
      48: ['tom', { f: 260, d: 0.12, level: 0.45 }],
      37: ['rim', { f: 1200, level: 0.3 }],
    },
  },
};

export const KIT_ORDER = ['studio', 'retro', '808', '909', 'breaks', 'lofi', 'brushes', 'chip', 'orchestral', 'gamelan'];

export function playDrum(x, kitName, ev, t) {
  const kit = KITS[kitName] || KITS.studio;
  const m = kit.map[ev.midi] || STUDIO[ev.midi];
  if (!m) return;
  P[m[0]](x, ev, t, m[1]);
}
