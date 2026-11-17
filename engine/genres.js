// Ekphrasis — genres
// A genre reshapes the composer (drum patterns, bass line, chord rhythm, arp, lead articulation),
// the key choice (allowed modes, tempo range, swing) and the default instrument set.
//
// Drum pattern strings are 16 steps (one bar of 16ths):
//   x accent   o normal   . ghost (only when Groove > 35%)
//   ? optional — plays when the image feature for that piece is strong
//   r roll     — hat ratchet when upper-band texture is strong, otherwise a single hit
//   - rest

export const PIECES = {
  kick: 36, rim: 37, snare: 38, clap: 39, timp: 41, chh: 42, tom: 45, ohh: 46,
  htom: 48, crash: 49, ride: 51, gong: 52, bell: 56, shaker: 70,
};

export const GENRES = {
  ekphrasis: {
    label: 'Ekphrasis (free)', blurb: 'No style rules: groove comes from edges and onsets, melody from salience.',
    tempo: [60, 160], swing: 0.12, swingGrid: 16, harmony: 'triads', modes: null,
    inst: { lead: 'saw', arp: 'bell', chords: 'warmPad', bass: 'synth', drums: 'studio', atmos: 'off' }, off: [],
    drums: 'free', bass: 'root', chords: 'pad',
    arp: { rate: 2, pattern: 'hue', gate: 'color' },
    lead: { oct: 4, maxDur: 8, density: 1 }, pump: 0,
    proto: null,
  },
  ambient: {
    label: 'Ambient', blurb: 'Slow, wide and beatless. Long tones, drones and glassy arpeggios.',
    tempo: [56, 84], swing: 0, swingGrid: 16, harmony: 'add9', modes: ['aeolian', 'dorian', 'majPent', 'ionian', 'lydian'],
    inst: { lead: 'flute', arp: 'glass', chords: 'glassPad', bass: 'sub', drums: 'studio', atmos: 'drone' }, off: ['drums'],
    drums: { variants: [{ kick: 'x---------------', shaker: '?---?---?---?---' }] },
    bass: 'drone', chords: 'pad',
    arp: { rate: 4, pattern: 'random', gate: 'color' },
    lead: { oct: 4, maxDur: 16, minDur: 2, density: 0.7 }, pump: 0,
    proto: [0.15, 0.2, 0.55, 0.0],
  },
  lofi: {
    label: 'Lo-fi hip hop', blurb: 'Lazy swung boom-bap, strummed seventh chords on electric piano, vinyl crackle.',
    tempo: [70, 90], swing: 0.4, swingGrid: 16, harmony: 'sevenths', modes: ['aeolian', 'dorian', 'mixolydian', 'ionian'],
    inst: { lead: 'pluck', arp: 'vibes', chords: 'epiano', bass: 'upright', drums: 'lofi', atmos: 'vinyl' }, off: [],
    drums: {
      variants: [
        { kick: 'x------x--x-----', snare: '----x-------x---', chh: 'o-o-o-o-o-o-o-o-' },
        { kick: 'x------x--x--?--', snare: '----x--.----x--.', chh: 'o-o-o-o-o-o-o-o?', ohh: '--------------?-' },
      ], fill: false,
    },
    bass: 'lofi', chords: 'lofi',
    arp: { rate: 4, pattern: 'up', gate: 'color' },
    lead: { oct: 4, maxDur: 6, density: 0.9 }, pump: 0,
    proto: [0.3, 0.12, 0.45, 0.4],
  },
  jazz: {
    label: 'Jazz', blurb: 'Swung ride and brushes, walking bass, rootless piano comping, vibraphone lead.',
    tempo: [96, 168], swing: 0.55, swingGrid: 8, harmony: 'sevenths', modes: ['aeolian', 'dorian', 'mixolydian', 'ionian', 'lydian'],
    inst: { lead: 'vibes', arp: 'epiano', chords: 'keys', bass: 'upright', drums: 'brushes', atmos: 'off' }, off: [],
    drums: {
      variants: [
        { ride: 'x---o-o-x---o-o-', chh: '----o-------o---', kick: '.-------.-------', snare: '------?-------?-' },
        { ride: 'x---o-o-x---o-o-', chh: '----o-------o---', kick: '.---.---.---.---', snare: '--?--?.--?--?-.-' },
      ], fill: false,
    },
    bass: 'walking', chords: 'comp',
    arp: { rate: 2, pattern: 'random', gate: 'texture' },
    lead: { oct: 4, maxDur: 4, density: 1.1 }, pump: 0,
    proto: [0.45, 0.08, 0.35, 0.5],
  },
  synthwave: {
    label: 'Synthwave', blurb: 'Neon 80s: octave-bass eighths, 16th arpeggios, gated snare, pumping pads.',
    tempo: [84, 118], swing: 0, swingGrid: 16, harmony: 'triads', modes: ['phrygian', 'aeolian', 'dorian', 'mixolydian'],
    inst: { lead: 'saw', arp: 'pulse', chords: 'polySynth', bass: 'synth', drums: 'retro', atmos: 'wash' }, off: [],
    drums: {
      variants: [
        { kick: 'x-------x-------', snare: '----x-------x---', chh: 'o-o-o-o-o-o-o-o-' },
        { kick: 'x---x---x---x---', snare: '----x-------x---', chh: 'o.o.o.o.o.o.o.o.' },
      ], fill: true, crash: true,
    },
    bass: 'octave8', chords: 'pad',
    arp: { rate: 1, pattern: 'updown', gate: 'always' },
    lead: { oct: 4, maxDur: 8, density: 1, glide: true }, pump: 0.3,
    proto: [0.45, 0.35, 0.3, -0.3],
  },
  house: {
    label: 'House', blurb: 'Four on the floor, offbeat open hats and bass, chord stabs, sidechain pump.',
    tempo: [118, 128], swing: 0.08, swingGrid: 16, harmony: 'sevenths', modes: ['aeolian', 'dorian', 'mixolydian', 'ionian'],
    inst: { lead: 'square', arp: 'marimba', chords: 'stab', bass: 'fmBass', drums: '909', atmos: 'wash' }, off: [],
    drums: {
      variants: [
        { kick: 'x---x---x---x---', clap: '----x-------x---', ohh: '--o---o---o---o-' },
        { kick: 'x---x---x---x---', clap: '----x-------x---', ohh: '--o---o---o---o-', shaker: '?o?o?o?o?o?o?o?o' },
        { kick: 'x---x---x---x---', clap: '----x-------x--?', ohh: '--o---o---o---o-', chh: '?-.-?-.-?-.-?-.-', rim: '---o--o----o--?-' },
      ], fill: true, crash: true,
    },
    bass: 'offbeat', chords: 'stabs',
    arp: { rate: 2, pattern: 'up', gate: 'texture' },
    lead: { oct: 4, maxDur: 3, density: 1 }, pump: 0.55,
    proto: [0.6, 0.3, 0.5, 0.2],
  },
  dnb: {
    label: 'Drum & bass', blurb: 'Fast two-step breaks, rolling ghost snares, a long reese bass under strings.',
    tempo: [164, 176], swing: 0, swingGrid: 16, harmony: 'sevenths', modes: ['phrygian', 'aeolian', 'dorian'],
    inst: { lead: 'flute', arp: 'bell', chords: 'strings', bass: 'reese', drums: 'breaks', atmos: 'wash' }, off: [],
    drums: {
      variants: [
        { kick: 'x---------x-----', snare: '----x-------x---', chh: 'o-o-o-o-o-o-o-o-' },
        { kick: 'x---------x--?--', snare: '----x--.-.--x--.', ride: 'o-o-o-o-o-o-o-o-', chh: '-?-?-?-?-?-?-?-?' },
      ], fill: true, crash: true,
    },
    bass: 'long', chords: 'pad',
    arp: { rate: 1, pattern: 'random', gate: 'color' },
    lead: { oct: 4, maxDur: 8, density: 0.8 }, pump: 0.2,
    proto: [0.8, 0.25, 0.35, -0.2],
  },
  trap: {
    label: 'Trap', blurb: 'Half-time claps, hi-hat rolls, gliding 808 bass that follows the kick.',
    tempo: [130, 150], swing: 0, swingGrid: 16, harmony: 'triads', modes: ['harmonicMinor', 'phrygian', 'aeolian', 'minPent'],
    inst: { lead: 'flute', arp: 'bell', chords: 'choir', bass: '808', drums: '808', atmos: 'off' }, off: [],
    drums: {
      variants: [
        { kick: 'x------?--x-----', clap: '--------x-------', chh: 'o-o-o-o-o-o-o-o-' },
        { kick: 'x------x-?x-----', clap: '--------x-------', chh: 'o-o-o-r-o-o-o-r-', ohh: '----------?-----' },
        { kick: 'x-?----x-?x---?-', clap: '--------x-------', chh: 'o-oro-o-o-roo-r-', ohh: '------?-------?-' },
      ], fill: false,
    },
    bass: '808', chords: 'pad',
    arp: { rate: 2, pattern: 'up', gate: 'color' },
    lead: { oct: 4, maxDur: 4, density: 1 }, pump: 0,
    proto: [0.6, 0.12, 0.2, 0.0],
  },
  chiptune: {
    label: 'Chiptune', blurb: '8-bit console: pulse leads, triangle bass, noise drums, fast arpeggios.',
    tempo: [120, 160], swing: 0, swingGrid: 16, harmony: 'triads', modes: ['aeolian', 'dorian', 'mixolydian', 'ionian', 'majPent'],
    inst: { lead: 'pulse', arp: 'chip', chords: 'chip', bass: 'chipTri', drums: 'chip', atmos: 'off' }, off: [],
    drums: {
      variants: [
        { kick: 'x-------x-------', snare: '----x-------x---', chh: 'o-o-o-o-o-o-o-o-' },
        { kick: 'x-----x-x-------', snare: '----x-------x-?-', chh: 'o.o.o.o.o.o.o.o.' },
      ], fill: true,
    },
    bass: 'octave8', chords: 'pulse8',
    arp: { rate: 1, pattern: 'up', gate: 'always' },
    lead: { oct: 4, maxDur: 3, density: 1.2 }, pump: 0,
    proto: [0.5, 0.45, 0.6, 0.3],
  },
  classical: {
    label: 'Classical', blurb: 'String section, harp arpeggios, pizzicato bass, timpani and cymbals at the peaks.',
    tempo: [66, 112], swing: 0, swingGrid: 16, harmony: 'triads', modes: ['harmonicMinor', 'aeolian', 'ionian', 'lydian'],
    inst: { lead: 'bowed', arp: 'harp', chords: 'strings', bass: 'pizz', drums: 'orchestral', atmos: 'off' }, off: [],
    drums: {
      variants: [
        { timp: 'x---------------' },
        { timp: 'x-------o-------' },
        { timp: 'x-----o-x---o---', tom: '?-------?-------' },
      ], fill: false, crash: true,
    },
    bass: 'pizz', chords: 'pad',
    arp: { rate: 2, pattern: 'broken', gate: 'always' },
    lead: { oct: 4, maxDur: 8, density: 0.9 }, pump: 0,
    proto: [0.3, 0.18, 0.6, 0.6],
  },
  gamelan: {
    label: 'Gamelan', blurb: 'Pelog/slendro tunings, interlocking metallophones, gongs marking the cycle.',
    tempo: [70, 110], swing: 0, swingGrid: 16, harmony: 'quartal', modes: ['pelog', 'slendro'],
    inst: { lead: 'gamelan', arp: 'gamelan', chords: 'glassPad', bass: 'sub', drums: 'gamelan', atmos: 'drone' }, off: [],
    drums: {
      variants: [
        { gong: 'x---------------', bell: '--------o-------', tom: '?--o--?-o--?-o--' },
        { gong: 'x---------------', bell: '----o-------o---', tom: 'x-?o-?x-o-?ox-?-', rim: '..?...?...?...?.' },
      ], fill: false, gongEvery: 2,
    },
    bass: 'drone', chords: 'pad',
    arp: { rate: 1, pattern: 'kotekan', gate: 'always' },
    lead: { oct: 4, maxDur: 4, density: 1 }, pump: 0,
    proto: [0.35, 0.25, 0.45, 0.8],
  },
};

export const GENRE_ORDER = ['ekphrasis', 'ambient', 'lofi', 'jazz', 'synthwave', 'house', 'dnb', 'trap', 'chiptune', 'classical', 'gamelan'];

// Nearest-prototype pick on [energy, colorfulness, brightness, warmth].
export function autoGenre(g) {
  const v = [g.energy, g.colorfulness, g.avgL, g.warmth];
  const w = [1.4, 1.6, 1.0, 0.5];
  let best = 'ekphrasis', bd = Infinity;
  for (const id of GENRE_ORDER) {
    const p = GENRES[id].proto;
    if (!p) continue;
    let d = 0;
    for (let i = 0; i < 4; i++) d += w[i] * (v[i] - p[i]) ** 2;
    if (d < bd) { bd = d; best = id; }
  }
  return best;
}
