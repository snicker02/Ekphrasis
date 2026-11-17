// Ekphrasis — section arranger: turns the loop into a song.
//
// Each genre gets a song form (EDM drop form, verse/chorus song form, classical sonata-ish form, ambient arc).
// For still images, every *unique* section is given its own slice of the image; repeated sections (a second
// chorus, a second drop) re-scan the same slice, so the material genuinely comes back. The whole image is
// covered once across the unique sections. For video the form is stretched over the clip's timeline.
//
// Each section type decides which voices play and how hard, scales density/groove, and adds transitions:
// filter sweeps (master low/high-pass), risers, snare rolls, crashes, the pre-drop gap and fades.

export const FORM_OF = {
  ekphrasis: 'song', lofi: 'song', jazz: 'song', chiptune: 'song',
  house: 'edm', dnb: 'edm', synthwave: 'edm', trap: 'edm',
  classical: 'classical', ambient: 'arc', gamelan: 'arc',
};

// [type, display name, bars at "medium"]
const FORMS = {
  edm: [['intro', 'Intro', 8], ['build', 'Build', 4], ['drop', 'Drop', 16], ['break', 'Breakdown', 8], ['build', 'Build', 4], ['drop', 'Drop', 16], ['outro', 'Outro', 8]],
  song: [['intro', 'Intro', 4], ['verse', 'Verse', 8], ['chorus', 'Chorus', 8], ['verse', 'Verse', 8], ['bridge', 'Bridge', 4], ['chorus', 'Chorus', 8], ['outro', 'Outro', 4]],
  classical: [['intro', 'Introduction', 4], ['themeA', 'Theme A', 8], ['themeB', 'Theme B', 8], ['develop', 'Development', 8], ['themeA', 'Recapitulation', 8], ['coda', 'Coda', 4]],
  arc: [['emerge', 'Emergence', 8], ['bloom', 'Bloom', 8], ['peak', 'Peak', 8], ['dissolve', 'Dissolve', 8]],
};

const LP_LO = 180, LP_HI = 20000, HP_LO = 10, HP_HI = 900;
const lpf = (x) => LP_LO * Math.pow(LP_HI / LP_LO, x);
const hpf = (x) => HP_LO * Math.pow(HP_HI / HP_LO, x);

// voices: gain per role (0 = silent). drums: full | lite | hats | build | off.
// int: visual/energy intensity (number or [start, end] ramp). lp/hp: sweep [from, to] in 0..1.
const ALL = { lead: 1, arp: 1, chords: 1, bass: 1, atmos: 1 };
export const TYPES = {
  intro:    { voices: { lead: 0, arp: 0.7, chords: 1, bass: 0.5, atmos: 1 }, drums: 'hats', dens: 0.6, rhy: 0.7, int: 0.3, fadeIn: true, lp: [0.6, 1] },
  verse:    { voices: { lead: 0.85, arp: 0.45, chords: 0.85, bass: 1, atmos: 1 }, drums: 'full', dens: 0.8, rhy: 0.85, int: 0.6 },
  chorus:   { voices: ALL, drums: 'full', dens: 1.1, rhy: 1.1, int: 0.95, crash: true },
  bridge:   { voices: { lead: 0.8, arp: 0.8, chords: 0.9, bass: 0.6, atmos: 1 }, drums: 'lite', dens: 0.8, rhy: 0.6, int: 0.5 },
  outro:    { voices: { lead: 0.6, arp: 0.5, chords: 0.9, bass: 0.7, atmos: 1 }, drums: 'hats', dens: 0.6, rhy: 0.6, int: 0.3, fadeOut: true, lp: [1, 0.4] },
  build:    { voices: { lead: 0, arp: 1, chords: 0.9, bass: 0.8, atmos: 1 }, drums: 'build', dens: 0.9, rhy: 1, int: [0.55, 0.92], riser: true, hp: [0, 1], gap: true },
  drop:     { voices: ALL, drums: 'full', dens: 1.15, rhy: 1.15, int: 1, crash: true },
  break:    { voices: { lead: 0.9, arp: 0.7, chords: 1, bass: 0, atmos: 1 }, drums: 'off', dens: 0.7, rhy: 0.5, int: 0.4, lp: [0.55, 0.8] },
  themeA:   { voices: { lead: 1, arp: 0.7, chords: 0.9, bass: 1, atmos: 1 }, drums: 'lite', dens: 0.85, rhy: 0.8, int: 0.6 },
  themeB:   { voices: { lead: 0.9, arp: 0.9, chords: 0.9, bass: 0.9, atmos: 1 }, drums: 'lite', dens: 0.9, rhy: 0.8, int: 0.65 },
  develop:  { voices: ALL, drums: 'full', dens: 1.1, rhy: 1.05, int: 0.9, crash: true },
  coda:     { voices: { lead: 0.7, arp: 0.6, chords: 1, bass: 0.8, atmos: 1 }, drums: 'hats', dens: 0.6, rhy: 0.5, int: 0.3, fadeOut: true, lp: [1, 0.5] },
  emerge:   { voices: { lead: 0, arp: 0.5, chords: 1, bass: 0.6, atmos: 1 }, drums: 'off', dens: 0.5, rhy: 0.4, int: 0.25, fadeIn: true, lp: [0.5, 0.95] },
  bloom:    { voices: { lead: 0.7, arp: 0.9, chords: 1, bass: 0.9, atmos: 1 }, drums: 'hats', dens: 0.8, rhy: 0.7, int: 0.55 },
  peak:     { voices: ALL, drums: 'full', dens: 1.05, rhy: 1, int: 0.9 },
  dissolve: { voices: { lead: 0.6, arp: 0.6, chords: 1, bass: 0.6, atmos: 1 }, drums: 'off', dens: 0.5, rhy: 0.4, int: 0.25, fadeOut: true, lp: [0.9, 0.35] },
};

const SCALE = { short: 0.5, medium: 1, long: 1.5 };
const HATS = new Set([42, 46, 51, 70, 37, 56]);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

function finish(sections) {
  const bars = [];
  const segOf = new Map();
  let unique = 0;
  sections.forEach((s, i) => {
    s.startBar = bars.length;
    if (!segOf.has(s.type)) { segOf.set(s.type, unique); unique += s.bars; }
    s.segStart = segOf.get(s.type);
    for (let b = 0; b < s.bars; b++) bars.push({ sec: i, inSec: b, imgBar: s.segStart + Math.min(b, s.bars - 1) });
  });
  return { sections, bars, totalBars: bars.length, uniqueBars: unique };
}

// mode 'image': form lengths from the size setting; repeats share image slices.
// mode 'timeline': form stretched to exactly totalBars (video); no repetition of material.
export function buildArrangement(genreId, size, mode = 'image', totalBars = 0) {
  if (!size || size === 'loop') return null;
  const form = FORMS[FORM_OF[genreId] || 'song'];
  if (mode === 'timeline') {
    if (totalBars < form.length * 2) return null;
    // Largest-remainder allocation with a 2-bar minimum per section, summing exactly to totalBars.
    const medium = form.reduce((n, f) => n + f[2], 0);
    const raw = form.map((f) => (f[2] * totalBars) / medium);
    const n = raw.map((r) => Math.max(2, Math.floor(r)));
    let diff = totalBars - n.reduce((x, y) => x + y, 0);
    const byFrac = raw.map((r, i) => [r - Math.floor(r), i]).sort((p, q) => q[0] - p[0]);
    for (let k = 0; diff > 0; k = (k + 1) % n.length, diff--) n[byFrac[k][1]]++;
    while (diff < 0) {
      let big = -1;
      n.forEach((v, i) => { if (v > 2 && (big < 0 || v > n[big])) big = i; });
      if (big < 0) return null;
      n[big]--; diff++;
    }
    const secs = form.map(([type, name], i) => ({ type, name, bars: n[i] }));
    const arr = finish(secs);
    arr.bars.forEach((b, i) => { b.imgBar = i; }); // timeline: no slice sharing
    return arr;
  }
  const k = SCALE[size] || 1;
  // A type that repeats must keep the same length so its slice can be re-scanned exactly.
  const len = {};
  const secs = form.map(([type, name, b]) => {
    if (len[type] == null) len[type] = Math.max(type === 'build' ? 2 : 2, Math.round((b * k) / 2) * 2);
    return { type, name, bars: len[type] };
  });
  return finish(secs);
}

export function describe(arr, tempo) {
  if (!arr) return '';
  const sec = arr.totalBars * 16 * 60 / tempo / 4;
  const mm = Math.floor(sec / 60), ss = String(Math.round(sec % 60)).padStart(2, '0');
  return arr.sections.map((s) => `${s.name} ${s.bars}`).join(' · ') + `  —  ${arr.totalBars} bars, ${mm}:${ss}`;
}

export function sectionAt(arr, bar) {
  const b = arr.bars[((bar % arr.totalBars) + arr.totalBars) % arr.totalBars];
  return { sec: arr.sections[b.sec], inSec: b.inSec, info: b };
}

export function shapeSettings(s, sec) {
  const T = TYPES[sec.type];
  return { ...s, density: clamp(s.density * T.dens, 0, 1), rhythm: clamp(s.rhythm * T.rhy, 0, 1) };
}

export function intensityAt(sec, inSec, sib) {
  const T = TYPES[sec.type];
  if (!Array.isArray(T.int)) return T.int;
  const p = (inSec * 16 + sib) / (sec.bars * 16);
  return T.int[0] + (T.int[1] - T.int[0]) * p;
}

// Filter/shape the composer's events for this step and add section transitions.
// ctx: { sec, inSec, sib, col, rows, prevType }
export function arrangeStep(events, ctx) {
  const { sec, inSec, sib, col, rows } = ctx;
  const T = TYPES[sec.type];
  const secSteps = sec.bars * 16, pos = inSec * 16 + sib, prog = pos / secSteps;
  let fade = 1;
  if (T.fadeIn) fade *= 0.55 + 0.45 * prog;
  if (T.fadeOut) fade *= 1 - 0.75 * prog;
  const lastBar = inSec === sec.bars - 1, rollBars = sec.bars >= 4 ? 2 : 1;
  const inRoll = T.drums === 'build' && inSec >= sec.bars - rollBars;
  const out = [];
  const mk = (ev) => Object.assign({ col, off: 0, sub: 0, durSteps: 1, row: rows >> 1 }, ev);

  for (const ev of events) {
    let gain = 1;
    if (ev.voice === 'drums') {
      const m = ev.midi;
      switch (T.drums) {
        case 'off': continue;
        case 'hats': if (!HATS.has(m)) continue; gain = 0.8; break;
        case 'lite':
          if (m === 36 && sib !== 0) continue;
          if (m === 38 || m === 39) gain = 0.6;
          break;
        case 'build':
          if (m === 38 || m === 39) continue;            // replaced by the roll
          if (m === 36 && sib % 4 !== 0) continue;       // straight quarter kicks
          break;
      }
    } else {
      gain = T.voices[ev.voice] ?? 1;
      if (gain <= 0) continue;
    }
    ev.vel = clamp(ev.vel * gain * fade, 0.03, 1);
    out.push(ev);
  }

  if (pos === 0) {
    const lp = T.lp ? [lpf(T.lp[0]), lpf(T.lp[1])] : [LP_HI, LP_HI];
    const hp = T.hp ? [hpf(T.hp[0]), hpf(T.hp[1])] : [HP_LO, HP_LO];
    out.push(mk({ voice: 'fx', kind: 'filters', lp, hp, durSteps: secSteps, midi: 0, vel: 1 }));
    if (T.crash) out.push(mk({ voice: 'drums', midi: 49, vel: 0.85, row: 0 }));
    if (T.riser) out.push(mk({ voice: 'atmos', patch: 'wash', midi: 60, vel: 0.85, durSteps: secSteps, row: rows >> 1 }));
  }
  if (inRoll) {
    const rollPos = (inSec - (sec.bars - rollBars)) * 16 + sib, rollLen = rollBars * 16, rp = rollPos / rollLen;
    const rate = rp < 0.5 ? (rollBars > 1 ? 4 : 2) : rp < 0.875 ? 2 : 1;
    if (sib % rate === 0) out.push(mk({ voice: 'drums', midi: 38, vel: 0.3 + 0.6 * rp, row: rows >> 1 }));
    if (rp >= 0.875) out.push(mk({ voice: 'drums', midi: 38, vel: 0.35 + 0.6 * rp, sub: 0.5, row: rows >> 1 }));
  }
  if (T.gap && lastBar && sib >= 14) return out.filter((e) => e.voice === 'atmos' || e.voice === 'fx');
  return out;
}
