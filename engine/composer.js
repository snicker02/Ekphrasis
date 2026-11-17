// Ekphrasis — composer
// Turns analysis grids into note events, one 16th-note step (= one grid column) at a time.
// What the image controls is the same in every genre; the genre decides how it is phrased:
//   lead   : the most salient band in the column (color + contrast + edges + motion) → melody pitch
//   arp    : arpeggio over the bar chord (pattern/rate from genre; gated by color or texture)
//   chords : the bar chord (pad, stabs, comping, strums or pulses per genre)
//   bass   : root/fifth/walking/808 lines per genre; extra notes on low-band onsets
//   drums  : genre pattern variants chosen by how busy the bar looks; '?' hits gated by image features
//   atmos  : vinyl, drone, riser or shimmer at bar/phrase boundaries

import { chordTones, chordName, degToMidi, snapToChord } from './theory.js';
import { GENRES, PIECES } from './genres.js';
import { sectionAt, shapeSettings, arrangeStep, intensityAt } from './arranger.js';

export const VOICES = ['lead', 'arp', 'chords', 'bass', 'drums', 'atmos'];
const TAU = Math.PI * 2;

export function hash3(a, b, c) {
  let h = Math.imul(a | 0, 0x9E3779B1) ^ Math.imul((b | 0) + 0x632BE5AB, 0x85EBCA77) ^ Math.imul((c | 0) + 0x1B873593, 0xC2B2AE3D);
  h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D);
  h ^= h >>> 12; h = Math.imul(h, 0x297A2D39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const circDiff = (a, b) => { let d = a - b; d -= Math.round(d); return d; };
const fold = (m, lo, hi) => { while (m < lo) m += 12; while (m > hi) m -= 12; return m; };
const foldNear = (m, ref) => { while (m - ref > 6) m -= 12; while (ref - m > 6) m += 12; return m; };

const STAB_PATTERNS = ['--x---x---x---x-', '---x--x----x--x-', '--x--x--x---x-x-'];
const COMP_SLOTS = [0, 3, 6, 10, 14];

export class Composer {
  constructor() { this.key = null; this.seed = 1; this.genre = GENRES.ekphrasis; this.reset(); }

  reset() {
    this.lastDeg = null; this.lastLeadMidi = null; this.leadHold = -1; this.bassHold = -1;
    this.last808 = null; this.lastBass = null;
    this.bar = -1; this.chordDeg = 0; this.chord = [0, 2, 4]; this.chordLabel = '';
    this.hist = []; this.barStats = null; this.nextDeg = 0; this.busy = 0.5; this.variant = 0; this.compCount = 0;
  }

  setKey(k) { this.key = k; }
  setGenre(id) { this.genre = GENRES[id] || GENRES.ekphrasis; }

  barStatsFromCols(grid, c0, n) {
    let hx = 0, hy = 0, w = 0, L = 0, S = 0, C = 0, fl = 0;
    const end = Math.min(grid.cols, c0 + n), m = Math.max(1, end - c0);
    for (let c = c0; c < end; c++) {
      const cs = grid.col[c], a = cs.hue * TAU, ww = cs.C * cs.hueStrength;
      hx += ww * Math.cos(a); hy += ww * Math.sin(a); w += cs.C;
      L += cs.L; S += cs.S; C += cs.C; fl += cs.fluxN;
    }
    return {
      hue: ((Math.atan2(hy, hx) / TAU) + 1) % 1,
      hueStrength: w > 1e-6 ? Math.min(1, Math.hypot(hx, hy) / w) : 0,
      L: L / m, S: S / m, C: C / m, fluxN: fl / m,
    };
  }

  barStatsFromGlobal(grid) {
    const g = grid.g;
    return { hue: g.meanHue, hueStrength: g.hueStrength, L: g.avgL, S: g.avgS, C: g.colorfulness, fluxN: 1 };
  }

  // Chord choice: how far the bar's color drifts from the key color picks the distance from the tonic;
  // the direction of the hue drift picks the subdominant/dominant side or the relative-minor side.
  planDegree(bar, st, ref, isLast) {
    const n = this.key.iv.length;
    let deg = 0;
    if (bar > 0 && !isLast) {
      const shift = circDiff(st.hue, ref.dominantHue);
      const mag = clamp(Math.abs(shift) * 3.5 * st.hueStrength + Math.abs(st.L - ref.avgL) * 2.5, 0, 0.999);
      const list = shift >= 0 ? [0, 3, 4, 1] : [0, 5, 1, 2];
      const idx = Math.floor(mag * 4);
      deg = list[idx];
      if (deg === 0 && bar % 4 === 3) deg = 4;
      const h = this.hist;
      if (h.length >= 2 && h[h.length - 1] === deg && h[h.length - 2] === deg) deg = list[(idx + 1) % 4];
    }
    deg %= n;
    this.hist.push(deg); if (this.hist.length > 8) this.hist.shift();
    return deg;
  }

  setChord(bar, deg, st, s, nextDeg, energy) {
    this.bar = bar; this.chordDeg = deg;
    this.chord = chordTones(deg, s.harmony);
    this.chordLabel = chordName(this.key, deg, s.harmony);
    this.barStats = st; this.nextDeg = nextDeg;
    this.busy = clamp(0.35 * Math.min(2, st.fluxN) + 0.5 * energy + 0.6 * s.rhythm - 0.35, 0, 0.999);
    const D = this.genre.drums;
    this.variant = D && D.variants ? Math.floor(this.busy * D.variants.length) : 0;
    this.compCount = 0;
  }

  // Live sources: plan and set in one go (next chord unknown → assume the same).
  beginBar(bar, st, ref, s, isLast, energy) {
    const deg = this.planDegree(bar, st, ref, isLast);
    this.setChord(bar, deg, st, s, deg, energy);
  }

  cellSalience(grid, col, r) {
    const i = col * grid.rows + r, cs = grid.col[col];
    let sal = 0.9 * grid.C[i] + 1.3 * Math.abs(grid.L[i] - cs.L) + 0.35 * Math.min(2, grid.E[i] / (grid.norm.edge * 2));
    if (grid.hasMotion) sal += 0.5 * Math.min(2, grid.M[i] / (Math.max(grid.norm.motion, 0.02) * 2));
    return sal;
  }

  leadMetric(grid, col, sib) {
    const rows = grid.rows, cs = grid.col[col];
    let best = -1, br = 0;
    for (let r = 0; r < rows; r++) {
      const sal = this.cellSalience(grid, col, r);
      if (sal > best) { best = sal; br = r; }
    }
    const bias = sib % 4 === 0 ? 0.25 : sib % 2 === 0 ? 0.08 : -0.05;
    const motion = grid.hasMotion ? 0.3 * Math.min(2, cs.motionN) : 0;
    const rel = best / this.salNorm(grid);
    return { score: 0.5 * Math.min(2.2, cs.fluxN) + 0.5 * Math.min(2.2, rel) + bias + motion, row: br, sal: best };
  }

  // Median per-column peak salience (cached), plus the vertical span the salient band travels
  // (10th–90th percentile row) so a skyline that only moves a little still uses the whole melody range.
  salNorm(grid) {
    if (grid._salNorm) return grid._salNorm;
    const peaks = [], rowsAt = [];
    for (let c = 0; c < grid.cols; c++) {
      let b = 0, br = 0;
      for (let r = 0; r < grid.rows; r++) { const v = this.cellSalience(grid, c, r); if (v > b) { b = v; br = r; } }
      peaks.push(b); rowsAt.push(br);
    }
    peaks.sort((a, b) => a - b); rowsAt.sort((a, b) => a - b);
    const n = rowsAt.length;
    let lo = rowsAt[Math.floor(0.1 * (n - 1))], hi = rowsAt[Math.ceil(0.9 * (n - 1))];
    const minSpan = grid.rows * 0.35;
    if (hi - lo < minSpan) { const mid = (hi + lo) / 2; lo = mid - minSpan / 2; hi = mid + minSpan / 2; }
    grid._rowLo = lo; grid._rowHi = hi;
    grid._salNorm = Math.max(0.05, peaks[Math.floor(peaks.length / 2)]);
    return grid._salNorm;
  }

  chordRootPc() { const k = this.key, n = k.iv.length; return (k.root + k.iv[((this.chordDeg % n) + n) % n]) % 12; }

  // hashStep: the step used for deterministic randomness and arp phase. Repeated song sections pass the image
  // column here so a returning chorus is note-for-note the same, while `step` stays monotonic for note holds.
  stepEvents(step, grid, col, s, hashStep = step) {
    const k = this.key, out = [];
    const sib = ((step % 16) + 16) % 16, seed = this.seed, hum = s.humanize;
    const H = (v) => hash3(hashStep, v, seed);
    const push = (ev, vid) => {
      ev.off = (H(vid * 11 + 1) - 0.5) * (ev.voice === 'drums' ? 0.008 : 0.02) * hum;
      ev.vel = clamp(ev.vel * (1 + (H(vid * 11 + 2) - 0.5) * 0.3 * hum), 0.05, 1);
      ev.col = col;
      if (ev.sub == null) ev.sub = 0;
      out.push(ev);
    };
    const X = { step, hashStep, sib, bar: this.bar, grid, col, cs: grid.col[col], g: grid.g, s, k, n: k.iv.length, rows: grid.rows, H, push };
    this._lead(X);
    this._arp(X);
    this._chords(X);
    const kicks = this._drums(X);
    this._bass(X, kicks);
    this._atmos(X);
    return out;
  }

  // ------------------------------------------------------------ lead
  _lead(X) {
    const { step, sib, grid, col, s, k, n, push } = X, L = this.genre.lead;
    const th = 1.42 - 0.85 * clamp(s.density * (L.density ?? 1), 0, 1.25);
    const m = this.leadMetric(grid, col, sib);
    if (!(m.score > th && (step >= this.leadHold || m.score > th + 0.5))) return;
    const span = Math.max(n, Math.round(s.range * n));
    const v = clamp((m.row - grid._rowLo) / Math.max(1, grid._rowHi - grid._rowLo), 0, 1);
    let deg = Math.round((1 - v) * span);
    if (sib % 4 === 0) deg = snapToChord(deg, this.chord, n);
    if (this.lastDeg != null) {
      while (deg - this.lastDeg > n) deg -= n;
      while (this.lastDeg - deg > n) deg += n;
    }
    deg = clamp(deg, -2, span + 2);
    if (deg === this.lastDeg && step < this.leadHold) return;
    // Hold while the feature persists along the scan and nothing new takes over; rest when it fades.
    const maxD = L.maxDur ?? 8, minD = L.minDur ?? 1;
    let d = 1;
    while (d < maxD && col + d < grid.cols) {
      if (d >= minD) {
        if (this.cellSalience(grid, col + d, m.row) < 0.6 * m.sal) break;
        if (this.leadMetric(grid, col + d, (sib + d) % 16).score > th) break;
      }
      d++;
    }
    const midi = degToMidi(k.root, k.iv, deg, (L.oct ?? 4) - (k.root >= 6 ? 1 : 0));
    const i = col * grid.rows + m.row;
    const ev = {
      voice: 'lead', midi, durSteps: d, row: m.row,
      vel: 0.5 + 0.35 * Math.min(1, m.sal) + (sib % 4 === 0 ? 0.1 : 0),
      bright: clamp(grid.S[i] * 0.7 + grid.L[i] * 0.5, 0, 1),
    };
    if (L.glide && this.lastLeadMidi != null && step === this.leadHold && midi !== this.lastLeadMidi && Math.abs(midi - this.lastLeadMidi) <= 7) ev.glideFrom = this.lastLeadMidi;
    this.leadHold = step + d; this.lastDeg = deg; this.lastLeadMidi = midi;
    push(ev, 1);
  }

  // ------------------------------------------------------------ arpeggio
  _arp(X) {
    const A = this.genre.arp;
    if (!A) return;
    const { hashStep, sib, grid, col, cs, s, k, n, rows, H, push } = X;
    if (sib % A.rate) return;
    let pr;
    if (A.gate === 'always') pr = 0.45 + 0.55 * s.density;
    else if (A.gate === 'texture') pr = (0.35 * Math.min(2, cs.highTexN) + cs.C * 1.5) * (0.3 + s.density) - 0.2;
    else pr = (cs.C * 2.4 + 0.25 * Math.min(2, cs.highTexN)) * (0.35 + s.density) - 0.3;
    if (H(21) >= pr) return;
    const kk = Math.floor(hashStep / A.rate), ch = this.chord, len = ch.length;
    const two = (i) => ch[i % len] + n * Math.floor(i / len);
    let deg;
    switch (A.pattern) {
      case 'up': deg = two(kk % (len * 2)); break;
      case 'down': deg = two(len * 2 - 1 - (kk % (len * 2))); break;
      case 'updown': {
        const L2 = len * 2, cyc = Math.max(1, L2 * 2 - 2);
        let i = kk % cyc;
        if (i >= L2) i = cyc - i;
        deg = two(i); break;
      }
      case 'random': deg = two(Math.floor(H(23) * len * 2)); break;
      case 'broken': deg = ch[[0, 2, 1, 2][kk % 4] % len]; break;
      case 'kotekan': deg = ch[Math.floor(kk / 2) % len] + (kk % 2); break;
      default: deg = ch[(kk + Math.floor(cs.hue * 7)) % len];
    }
    let br = 0, bv = -1;
    for (let r = 0; r < rows / 2; r++) { const v = grid.C[col * rows + r]; if (v > bv) { bv = v; br = r; } }
    push({
      voice: 'arp', midi: degToMidi(k.root, k.iv, deg + n, 4),
      vel: 0.38 + Math.min(0.45, cs.C * 1.3 + cs.L * 0.15),
      durSteps: A.gate === 'always' ? A.rate : Math.max(2, A.rate), row: br,
    }, 2);
  }

  // ------------------------------------------------------------ chords
  _chords(X) {
    const style = this.genre.chords;
    const { sib, hashStep, g, cs, k, rows, H, push } = X;
    const bs = this.barStats || { S: g.avgS, L: g.avgL };
    const cut = 350 + bs.S * 2400 + bs.L * 1400;
    const voice = (degs, lo, hi, vel, dur, strum = 0) => {
      const seen = new Set();
      degs.forEach((cd, i) => {
        const mm = fold(degToMidi(k.root, k.iv, cd, 3), lo, hi);
        if (seen.has(mm)) return;
        seen.add(mm);
        push({
          voice: 'chords', midi: mm, vel, durSteps: dur, cut, sub: strum * (seen.size - 1),
          pan: degs.length > 1 ? (i / (degs.length - 1) - 0.5) * 0.8 : 0,
          row: Math.round(rows * (0.25 + 0.5 * i / degs.length)),
        }, 30 + i);
      });
    };
    switch (style) {
      case 'none': return;
      case 'stabs': {
        const pat = STAB_PATTERNS[this.variant % STAB_PATTERNS.length];
        if (pat[sib] === 'x') voice(this.chord, 55, 74, 0.6 + 0.3 * Math.min(1, cs.fluxN / 2), 1.2);
        else if (sib % 2 === 0 && cs.fluxN > 1.8 && H(71) < 0.3) voice(this.chord, 55, 74, 0.45, 1);
        return;
      }
      case 'comp': {
        if (!COMP_SLOTS.includes(sib)) return;
        const d = this.chordDeg;
        const play = hash3(hashStep >> 4, sib, this.seed + 7) < 0.25 + 0.45 * this.busy || (sib === 14 && this.compCount === 0);
        if (!play) return;
        this.compCount++;
        voice([d + 2, d + 4, d + 6, d + 8], 52, 74, 0.45 + 0.2 * cs.L, 3);
        return;
      }
      case 'lofi': {
        if (sib === 0) voice(this.chord, 50, 72, 0.6 + 0.2 * bs.L, 7, 0.08);
        else if (sib === (this.variant ? 7 : 10) && this.busy > 0.3) voice(this.chord, 50, 72, 0.45, 6, 0.06);
        return;
      }
      case 'pulse8': {
        if (sib % 2 === 0) voice(this.chord, 55, 74, sib % 4 === 0 ? 0.6 : 0.42, 1.6);
        return;
      }
      default:
        if (sib === 0) voice(this.chord, 50, 69, 0.55 + 0.25 * bs.L, 16);
    }
  }

  // ------------------------------------------------------------ drums
  _nextKick(sib) {
    const D = this.genre.drums;
    const pat = D && D.variants ? D.variants[Math.min(D.variants.length - 1, this.variant)].kick : null;
    if (!pat) return 16 - sib;
    for (let j = sib + 1; j < 16; j++) if (pat[j] === 'x' || pat[j] === 'o') return j - sib;
    return 16 - sib;
  }

  _drums(X) {
    const D = this.genre.drums;
    const { sib, bar, cs, g, s, rows, H, push } = X;
    const hits = [];
    const rowOf = { 36: rows - 1, 41: rows - 2, 45: rows - 3, 48: rows - 5, 38: rows >> 1, 39: rows >> 1, 37: (rows >> 1) + 2, 42: 1, 46: 2, 51: 3, 49: 0, 52: rows - 1, 56: rows >> 2, 70: 4 };
    const add = (midi, vel, sub = 0) => {
      hits.push(midi);
      push({ voice: 'drums', midi, vel, durSteps: 1, row: rowOf[midi] ?? (rows >> 1), sub }, 5 + midi + Math.round(sub * 10));
    };

    if (D === 'free') {
      const amt = s.rhythm * (0.3 + g.energy * 1.1);
      if (amt <= 0.1) return hits;
      if (sib === 0) add(36, 0.95);
      else if (sib === 8 && amt > 0.3) add(36, 0.8);
      else if (sib % 2 === 0 && cs.lowFluxN * amt > 0.8) add(36, 0.5 + 0.2 * Math.min(1, cs.lowFluxN - 1));
      if ((sib === 4 || sib === 12) && amt > 0.4) add(38, 0.75);
      else if (sib % 2 === 1 && cs.edgeN * amt > 0.9 && H(51) < 0.45) add(38, 0.22);
      if (sib % 2 === 0 && amt > 0.22) {
        if (sib === 14 && amt > 0.55 && H(61) < 0.5) add(46, 0.35);
        else add(42, 0.22 + 0.3 * Math.min(1, cs.highTexN * 0.6));
      } else if (sib % 2 === 1 && cs.highTexN * amt > 0.6) add(42, 0.16 + 0.15 * Math.min(1, cs.highTexN * 0.5));
      return hits;
    }
    if (!D || !D.variants || s.rhythm < 0.08) return hits;

    const v = D.variants[Math.min(D.variants.length - 1, this.variant)];
    const amt = 0.4 + s.rhythm;
    const fillNow = D.fill && bar % 4 === 3 && sib >= 12 && this.busy > 0.55;
    for (const piece in v) {
      const ch = v[piece][sib];
      if (!ch || ch === '-') continue;
      const midi = PIECES[piece];
      if (piece === 'gong' && D.gongEvery && bar % D.gongEvery) continue;
      if (fillNow && (piece === 'snare' || piece === 'chh' || piece === 'clap' || piece === 'ohh')) continue;
      const metric = (midi === 36 || midi === 41) ? cs.lowFluxN
        : (midi === 42 || midi === 46 || midi === 51 || midi === 70) ? cs.highTexN
          : (midi === 52 || midi === 56) ? cs.fluxN : cs.edgeN;
      const mod = 0.85 + 0.3 * Math.min(1, metric / 2);
      if (ch === 'x') add(midi, 0.95 * mod);
      else if (ch === 'o') add(midi, 0.7 * mod);
      else if (ch === '.') { if (s.rhythm > 0.35) add(midi, 0.3); }
      else if (ch === '?') { if (metric * amt > 1.05 && H(80 + midi) < 0.8) add(midi, 0.5 * mod); }
      else if (ch === 'r') {
        if (cs.highTexN * amt > 0.95) {
          const nn = H(90) < 0.5 ? 3 : 4;
          for (let i = 0; i < nn; i++) add(midi, (0.55 - 0.08 * i) * mod, i / nn);
        } else add(midi, 0.7 * mod);
      }
    }
    if (fillNow) {
      const tm = [48, 48, 45, 45][sib - 12];
      add(sib === 15 ? 38 : tm, 0.55 + 0.1 * (sib - 12));
      if (sib % 2 === 1 && this.busy > 0.8) add(38, 0.4, 0.5);
    }
    if (D.crash && sib === 0 && bar > 0 && bar % 8 === 0 && g.energy > 0.35) add(49, 0.8);
    return hits;
  }

  // ------------------------------------------------------------ bass
  _bass(X, kicks) {
    const style = this.genre.bass;
    const { step, sib, bar, cs, s, k, rows, H, push } = X;
    const rootM = fold(degToMidi(k.root, k.iv, this.chord[0], 2), 33, 47);
    const fifthM = fold(degToMidi(k.root, k.iv, this.chord.length > 2 ? this.chord[2] : this.chord[0], 2), rootM, rootM + 12);
    const thirdM = fold(degToMidi(k.root, k.iv, this.chord[1] ?? this.chord[0], 2), rootM, rootM + 12);
    const lowRow = rows - 1 - Math.floor(rows / 6);
    const P = (midi, vel, dur, extra) => push({ voice: 'bass', midi, vel, durSteps: dur, row: lowRow, ...(extra || {}) }, 4);

    switch (style) {
      case 'drone':
        if (sib === 0 && bar % 2 === 0) P(rootM, 0.6, 32);
        return;
      case 'walking': {
        if (sib % 4) return;
        const beat = sib / 4;
        let m;
        if (beat === 0) m = rootM;
        else if (beat === 1) m = H(43) < 0.5 ? thirdM : degToMidi(k.root, k.iv, this.chord[0] + 1, 2);
        else if (beat === 2) m = fifthM;
        else m = degToMidi(k.root, k.iv, this.nextDeg, 2) + (H(44) < 0.6 ? -1 : 1);
        m = fold(foldNear(m, this.lastBass ?? rootM), 31, 55);
        this.lastBass = m;
        P(m, 0.7 + (beat === 0 ? 0.1 : 0), 3.6);
        return;
      }
      case 'octave8': {
        if (sib % 2) return;
        const hi = (sib / 2) % 2 === 1;
        let m = hi ? rootM + 12 : rootM;
        if (sib >= 12 && cs.lowFluxN > 1.2) m = hi ? fifthM + 12 : fifthM;
        P(m, hi ? 0.55 : 0.7, 1.8);
        return;
      }
      case 'offbeat': {
        if (sib % 4 !== 2) return;
        let m = rootM;
        if (cs.lowFluxN > 1.3) m = fifthM; else if (H(45) < 0.25) m = rootM + 12;
        P(m, 0.75, 1.5);
        return;
      }
      case 'lofi':
        if (sib === 0) P(rootM, 0.8, 6);
        else if (sib === (this.variant ? 7 : 10) && this.busy > 0.3) P(cs.lowFluxN > 1 ? fifthM : rootM, 0.6, 3);
        else if (sib === 14 && cs.lowFluxN > 1.4) P(rootM + 12, 0.45, 2);
        return;
      case 'long':
        if (sib === 0) P(rootM, 0.8, 10);
        else if (sib === 10) P(cs.lowFluxN > 1 ? fifthM : rootM, 0.7, 6);
        return;
      case '808': {
        if (kicks.includes(36)) {
          let m = rootM;
          const h = H(46);
          if (cs.lowFluxN > 1.4 && h < 0.5) m = rootM + 12; else if (h < 0.2) m = fifthM;
          const extra = {};
          if (this.last808 != null && this.last808 !== m && H(47) < 0.5) extra.glideFrom = this.last808;
          this.last808 = m;
          P(m, 0.9, this._nextKick(sib), extra);
        } else if (sib === 0 && !kicks.length) P(rootM, 0.85, 16);
        return;
      }
      case 'pizz':
        if (sib % 4 === 0) P([rootM, fifthM, thirdM, fifthM][sib / 4], 0.7, 1);
        return;
      default: {
        if (sib === 0) { P(rootM, 0.85, 6); this.bassHold = step + 6; }
        else if (sib === 8) { P(cs.lowFluxN > 0.9 ? fifthM : rootM, 0.7, 4); this.bassHold = step + 4; }
        else if (sib % 2 === 0 && step >= this.bassHold && cs.lowFluxN * (0.4 + s.rhythm) > 1.1) {
          P(H(41) < 0.3 ? rootM + 12 : rootM, 0.55, 2); this.bassHold = step + 2;
        }
      }
    }
  }

  // ------------------------------------------------------------ atmosphere
  _atmos(X) {
    const { sib, bar, g, s, k, rows, push } = X;
    if (sib !== 0) return;
    switch (s.voices.atmos.inst) {
      case 'vinyl': push({ voice: 'atmos', midi: 60 + (bar % 12), vel: 0.4 + 0.5 * Math.min(1, g.edgeMean * 8), durSteps: 16, row: 0 }, 6); break;
      case 'drone': if (bar % 2 === 0) push({ voice: 'atmos', midi: degToMidi(k.root, k.iv, 0, 2), vel: 0.8, durSteps: 32, row: rows - 2 }, 6); break;
      case 'wash': if (bar % 4 === 3) push({ voice: 'atmos', midi: 60, vel: 0.5 + 0.5 * g.energy, durSteps: 16, row: rows >> 1 }, 6); break;
      case 'shimmer':
        this.chord.forEach((cd, i) => push({ voice: 'atmos', midi: degToMidi(k.root, k.iv, cd, 5), vel: 0.7, durSteps: 16, row: i }, 60 + i));
        break;
    }
  }
}

// Compose a whole still image: plan every bar's chord first (so walking bass can approach the next root),
// then one step per grid column.
export function composeImage(composer, grid, s) {
  composer.reset();
  const steps = grid.cols, bars = Math.ceil(steps / 16);
  const stats = [], degs = [];
  for (let b = 0; b < bars; b++) {
    const st = composer.barStatsFromCols(grid, b * 16, 16);
    stats.push(st);
    degs.push(composer.planDegree(b, st, grid.g, bars > 1 && b === bars - 1));
  }
  const out = new Array(steps);
  for (let step = 0; step < steps; step++) {
    if (step % 16 === 0) {
      const b = step / 16;
      composer.setChord(b, degs[b], stats[b], s, degs[(b + 1) % bars], grid.g.energy);
    }
    out[step] = { events: composer.stepEvents(step, grid, step, s), bar: composer.bar, chord: composer.chordLabel, col: step, rootPc: composer.chordRootPc(), intensity: 0.7, section: '' };
  }
  return out;
}

// Compose a still image as a song. arr comes from buildArrangement(…, 'image'); grid.cols must equal
// arr.uniqueBars × 16. Chords are planned per unique bar so repeated sections reuse the same progression.
export function composeSong(composer, grid, s, arr) {
  composer.reset();
  const U = arr.uniqueBars, B = arr.totalBars;
  const stats = [], udeg = [];
  for (let u = 0; u < U; u++) {
    const st = composer.barStatsFromCols(grid, u * 16, 16);
    stats.push(st);
    udeg.push(composer.planDegree(u, st, grid.g, false));
  }
  const deg = arr.bars.map((b) => udeg[b.imgBar]);
  deg[0] = 0; deg[B - 1] = 0;
  const out = new Array(B * 16);
  let s2 = s, sa = null;
  for (let step = 0; step < B * 16; step++) {
    const b = step >> 4, sib = step & 15;
    if (sib === 0) {
      sa = sectionAt(arr, b);
      s2 = shapeSettings(s, sa.sec);
      composer.setChord(b, deg[b], stats[sa.info.imgBar], s2, deg[(b + 1) % B], grid.g.energy);
    }
    const col = sa.info.imgBar * 16 + sib;
    const evs = composer.stepEvents(step, grid, col, s2, col);
    out[step] = {
      events: arrangeStep(evs, { sec: sa.sec, inSec: sa.inSec, sib, col, rows: grid.rows }),
      bar: b, chord: composer.chordLabel, col, rootPc: composer.chordRootPc(),
      intensity: intensityAt(sa.sec, sa.inSec, sib), section: sa.sec.name,
    };
  }
  return out;
}
