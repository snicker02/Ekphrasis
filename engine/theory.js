// Ekphrasis — music theory helpers
// Keys, modes, chords and the color → key mappings.

export const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

export const MODES = {
  lydian:        { label: 'Lydian',           iv: [0, 2, 4, 6, 7, 9, 11] },
  ionian:        { label: 'Ionian (major)',   iv: [0, 2, 4, 5, 7, 9, 11] },
  mixolydian:    { label: 'Mixolydian',       iv: [0, 2, 4, 5, 7, 9, 10] },
  dorian:        { label: 'Dorian',           iv: [0, 2, 3, 5, 7, 9, 10] },
  aeolian:       { label: 'Aeolian (minor)',  iv: [0, 2, 3, 5, 7, 8, 10] },
  phrygian:      { label: 'Phrygian',         iv: [0, 1, 3, 5, 7, 8, 10] },
  harmonicMinor: { label: 'Harmonic minor',   iv: [0, 2, 3, 5, 7, 8, 11] },
  majPent:       { label: 'Major pentatonic', iv: [0, 2, 4, 7, 9] },
  minPent:       { label: 'Minor pentatonic', iv: [0, 3, 5, 7, 10] },
  hirajoshi:     { label: 'Hirajōshi',        iv: [0, 2, 3, 7, 8] },
  pelog:         { label: 'Pelog (approx.)',  iv: [0, 1, 3, 7, 8] },
  slendro:       { label: 'Slendro (approx.)', iv: [0, 2, 5, 7, 9] },
  wholeTone:     { label: 'Whole tone',       iv: [0, 2, 4, 6, 8, 10] },
};

// Diatonic modes ordered dark → bright (by number of raised degrees).
const AUTO_ORDER = ['phrygian', 'aeolian', 'dorian', 'mixolydian', 'ionian', 'lydian'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// Hue wheel → circle of fifths (Scriabin-style): red = C, orange = G, yellow = D,
// green = A, cyan = E, azure = B, blue = F♯, violet = D♭ … magenta = F.
export function hueToRoot(h) {
  const bin = ((Math.round((((h % 1) + 1) % 1) * 12)) % 12);
  return (bin * 7) % 12;
}

// list: allowed modes ordered dark → bright (genre), or null for the full diatonic set.
export function autoMode(g, list) {
  if (!list && g.colorfulness < 0.05) return g.avgL > 0.45 ? 'majPent' : 'minPent';
  const order = list && list.length ? list : AUTO_ORDER;
  const score = 0.6 * g.warmth + 0.8 * (g.avgL - 0.45);
  const i = clamp(Math.floor(((score + 0.6) / 1.2) * order.length), 0, order.length - 1);
  return order[i];
}

export function autoTempo(g, range) {
  const [lo, hi] = range || [58, 160];
  const x = clamp(0.15 + g.energy * 0.9 + (g.avgL - 0.5) * 0.2, 0, 1);
  return Math.round(lo + x * (hi - lo));
}

export function resolveKey(g, s, genre) {
  let root;
  if (s.key === 'auto') {
    root = g.colorfulness < 0.05 ? ((Math.round(g.avgL * 11) * 7) % 12) : hueToRoot(g.dominantHue);
  } else root = (+s.key) % 12;
  const mode = s.mode === 'auto' ? autoMode(g, genre && genre.modes) : (MODES[s.mode] ? s.mode : 'ionian');
  const tempo = autoTempo(g, genre && genre.tempo);
  return { root, mode, iv: MODES[mode].iv, tempo, name: `${NOTE_NAMES[root]} ${MODES[mode].label}` };
}

export function degToMidi(root, iv, deg, oct) {
  const n = iv.length;
  const o = Math.floor(deg / n);
  const i = deg - o * n;
  return 12 * (oct + 1) + root + iv[i] + 12 * o;
}

export function chordTones(deg, harmony) {
  switch (harmony) {
    case 'sevenths': return [deg, deg + 2, deg + 4, deg + 6];
    case 'add9':     return [deg, deg + 2, deg + 4, deg + 8];
    case 'sus':      return [deg, deg + 3, deg + 4];
    case 'quartal':  return [deg, deg + 3, deg + 6];
    default:         return [deg, deg + 2, deg + 4];
  }
}

export function chordName(key, deg, harmony) {
  const n = key.iv.length;
  const pc = (d) => (degToMidi(key.root, key.iv, d, 0)) % 12;
  const r = pc(deg);
  const third = (pc(deg + 2) - r + 12) % 12;
  const fifth = (pc(deg + 4) - r + 12) % 12;
  let q = '';
  if (third === 3) q = fifth === 6 ? '°' : 'm';
  else if (third === 4) q = fifth === 8 ? '+' : '';
  else if (third === 5) q = 'sus4';
  else if (third === 2) q = 'sus2';
  let ext = '';
  if (harmony === 'sevenths') {
    const sev = (pc(deg + 6) - r + 12) % 12;
    ext = sev === 11 ? 'maj7' : sev === 10 ? '7' : sev === 9 ? '6' : '';
    if (q === '°' && sev === 10) { q = 'ø'; ext = '7'; }
  } else if (harmony === 'add9') ext = 'add9';
  else if (harmony === 'sus') { q = ''; ext = 'sus4'; }
  else if (harmony === 'quartal') { q = ''; ext = '(4ths)'; }
  const idx = ((deg % n) + n) % n;
  let roman = ROMAN[idx] || String(idx + 1);
  if (q === 'm' || q === '°' || q === 'ø') roman = roman.toLowerCase();
  return `${NOTE_NAMES[r]}${q}${ext} · ${roman}`;
}

export function snapToChord(deg, chord, n) {
  const set = new Set(chord.map((c) => ((c % n) + n) % n));
  const m = (d) => ((d % n) + n) % n;
  for (let d = 0; d <= n; d++) {
    if (set.has(m(deg + d))) return deg + d;
    if (set.has(m(deg - d))) return deg - d;
  }
  return deg;
}
