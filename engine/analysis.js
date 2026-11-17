// Ekphrasis — visual analysis
// Samples a source (image, video frame, canvas) along a scan path into a
// cols × rows grid of cells. Each column is one 16th-note step; each row is a
// pitch band (row 0 = highest). Produces per-cell color/texture/edge/motion,
// per-column summaries and global statistics used for key, mode and tempo.

const TAU = Math.PI * 2;

export const SCAN_MODES = [
  ['horizontal', 'Left → right'],
  ['vertical', 'Top → bottom'],
  ['radial', 'Radar sweep'],
  ['rings', 'Rings outward'],
];

// (u = position along the scan, v = pitch band 0 top/high … 1 bottom/low) → normalized image xy.
export function mapUV(mode, u, v, out) {
  let x, y;
  switch (mode) {
    case 'vertical': x = v; y = u; break;
    case 'radial': {
      const a = u * TAU - Math.PI / 2, r = (1 - v) * 0.5;
      x = 0.5 + r * Math.cos(a); y = 0.5 + r * Math.sin(a); break;
    }
    case 'rings': {
      const a = v * TAU - Math.PI / 2, r = u * 0.5;
      x = 0.5 + r * Math.cos(a); y = 0.5 + r * Math.sin(a); break;
    }
    default: x = u; y = v;
  }
  out[0] = x; out[1] = y;
  return out;
}

function hueOf(r, g, b, mx, d) {
  if (d < 1e-6) return 0;
  let h;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h /= 6;
  return h < 0 ? h + 1 : h;
}

function peakHue(hist) {
  let best = -1, bi = 0;
  for (let k = 0; k < 12; k++) {
    const v = 0.5 * hist[k] + 0.25 * (hist[(k + 11) % 12] + hist[(k + 1) % 12]);
    if (v > best) { best = v; bi = k; }
  }
  return bi / 12;
}

const NUM_FIELDS = ['avgL', 'avgS', 'contrast', 'colorfulness', 'warmth', 'edgeMean', 'motionMean', 'energy'];

// Average several global stat objects (used for multi-frame video key detection and key-follow).
export function mergeGlobals(list, weights) {
  const w = weights || list.map(() => 1);
  const ws = w.reduce((a, b) => a + b, 0) || 1;
  const g = { hist: new Float32Array(12) };
  for (const f of NUM_FIELDS) g[f] = 0;
  let hx = 0, hy = 0, hw = 0;
  list.forEach((s, i) => {
    const k = w[i] / ws;
    for (const f of NUM_FIELDS) g[f] += (s[f] || 0) * k;
    for (let b = 0; b < 12; b++) g.hist[b] += s.hist[b] * k;
    const ww = s.hueStrength * s.colorfulness * k;
    hx += ww * Math.cos(s.meanHue * TAU); hy += ww * Math.sin(s.meanHue * TAU); hw += s.colorfulness * k;
  });
  g.dominantHue = peakHue(g.hist);
  g.meanHue = ((Math.atan2(hy, hx) / TAU) + 1) % 1;
  g.hueStrength = hw > 1e-6 ? Math.min(1, Math.hypot(hx, hy) / hw) : 0;
  return g;
}

const FEATS = ['flux', 'edge', 'lowFlux', 'highTex', 'motion'];
const FLOOR = { flux: 0.004, edge: 0.004, lowFlux: 0.004, highTex: 0.004, motion: 0.02 };

export class Analyzer {
  constructor() {
    this.cv = document.createElement('canvas');
    this.cx = this.cv.getContext('2d', { willReadFrequently: true });
    this.reset();
  }

  reset() { this.prevL = null; this.prevMode = null; this.ema = null; }

  analyze(src, sw, sh, o = {}) {
    const mode = o.mode || 'horizontal';
    const cols = o.cols || 128, rows = o.rows || 24;
    const live = !!o.live, maxDim = o.maxDim || 320;
    const sc = Math.min(1, maxDim / Math.max(sw, sh, 1));
    const w = Math.max(2, Math.round(sw * sc)), h = Math.max(2, Math.round(sh * sc));
    if (this.cv.width !== w || this.cv.height !== h) { this.cv.width = w; this.cv.height = h; }
    this.cx.drawImage(src, 0, 0, w, h);
    const px = this.cx.getImageData(0, 0, w, h).data;

    const N = cols * rows;
    const H = new Float32Array(N), S = new Float32Array(N), L = new Float32Array(N);
    const C = new Float32Array(N), T = new Float32Array(N), E = new Float32Array(N), M = new Float32Array(N);
    const SS = 3, inv = 1 / (SS * SS), p = [0, 0];

    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        let R = 0, G = 0, B = 0, ls = 0, ls2 = 0;
        for (let i = 0; i < SS; i++) {
          const u = (c + (i + 0.5) / SS) / cols;
          for (let j = 0; j < SS; j++) {
            const v = (r + (j + 0.5) / SS) / rows;
            mapUV(mode, u, v, p);
            let x = (p[0] * w) | 0, y = (p[1] * h) | 0;
            x = x < 0 ? 0 : x >= w ? w - 1 : x;
            y = y < 0 ? 0 : y >= h ? h - 1 : y;
            const k = (y * w + x) << 2;
            const rr = px[k] / 255, gg = px[k + 1] / 255, bb = px[k + 2] / 255;
            R += rr; G += gg; B += bb;
            const l = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
            ls += l; ls2 += l * l;
          }
        }
        R *= inv; G *= inv; B *= inv;
        const lm = ls * inv;
        const mx = Math.max(R, G, B), mn = Math.min(R, G, B), d = mx - mn, hl = (mx + mn) / 2;
        const idx = c * rows + r;
        H[idx] = hueOf(R, G, B, mx, d);
        S[idx] = d < 1e-6 ? 0 : Math.min(1, d / (1 - Math.abs(2 * hl - 1) + 1e-6));
        C[idx] = d;
        L[idx] = lm;
        T[idx] = Math.sqrt(Math.max(0, ls2 * inv - lm * lm));
      }
    }

    // Edge = vertical structure within the column + sub-cell texture.
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const i = c * rows + r;
        const up = r > 0 ? L[i - 1] : L[i], dn = r < rows - 1 ? L[i + 1] : L[i];
        E[i] = 0.5 * (Math.abs(L[i] - up) + Math.abs(L[i] - dn)) + T[i];
      }
    }

    // Motion (live sources only): frame difference against the previous analyzed frame.
    let hasMotion = false;
    if (live && this.prevL && this.prevL.length === N && this.prevMode === mode) {
      for (let i = 0; i < N; i++) M[i] = Math.abs(L[i] - this.prevL[i]);
      hasMotion = true;
    }
    if (live) { this.prevL = L.slice(); this.prevMode = mode; }

    // Column summaries. Flux = change from the previous column (an "onset" measure).
    const third = Math.max(1, Math.floor(rows / 3));
    const col = new Array(cols);
    for (let c = 0; c < cols; c++) {
      const cp = (c - 1 + cols) % cols;
      let sL = 0, sS = 0, sC = 0, hx = 0, hy = 0, fl = 0, ed = 0, low = 0, lowFl = 0, hiT = 0, mo = 0;
      for (let r = 0; r < rows; r++) {
        const i = c * rows + r, j = cp * rows + r;
        sL += L[i]; sS += S[i]; sC += C[i];
        const a = H[i] * TAU;
        hx += C[i] * Math.cos(a); hy += C[i] * Math.sin(a);
        const dl = Math.abs(L[i] - L[j]) + 0.5 * Math.abs(C[i] - C[j]);
        fl += dl; ed += E[i]; mo += M[i];
        if (r >= rows - third) { low += L[i]; lowFl += dl; }
        if (r < third) hiT += E[i];
      }
      col[c] = {
        L: sL / rows, S: sS / rows, C: sC / rows,
        hue: ((Math.atan2(hy, hx) / TAU) + 1) % 1,
        hueStrength: sC > 1e-6 ? Math.hypot(hx, hy) / sC : 0,
        flux: fl / rows, edge: ed / rows, low: low / third, lowFlux: lowFl / third,
        highTex: hiT / third, motion: mo / rows,
      };
    }

    // Global statistics.
    let sL = 0, sS = 0, sC = 0, sL2 = 0, sE = 0, sM = 0, wx = 0, wy = 0, warmN = 0;
    const hist = new Float32Array(12);
    for (let i = 0; i < N; i++) {
      sL += L[i]; sL2 += L[i] * L[i]; sS += S[i]; sC += C[i]; sE += E[i]; sM += M[i];
      const a = H[i] * TAU;
      wx += C[i] * Math.cos(a); wy += C[i] * Math.sin(a);
      warmN += C[i] * Math.cos(TAU * (H[i] - 0.08));
      hist[Math.round(H[i] * 12) % 12] += C[i];
    }
    const avgL = sL / N;
    const g = {
      avgL, avgS: sS / N,
      contrast: Math.sqrt(Math.max(0, sL2 / N - avgL * avgL)),
      colorfulness: sC / N,
      warmth: sC > 1e-6 ? warmN / sC : 0,
      edgeMean: sE / N,
      motionMean: hasMotion ? sM / N : 0,
      hist,
      dominantHue: peakHue(hist),
      meanHue: ((Math.atan2(wy, wx) / TAU) + 1) % 1,
      hueStrength: sC > 1e-6 ? Math.hypot(wx, wy) / sC : 0,
    };
    g.energy = Math.max(0, Math.min(1, (g.contrast - 0.08) * 2 + g.edgeMean * 4 + g.motionMean * 6));

    // Normalization: 85th percentile per feature (EMA-smoothed across frames when live).
    const norm = {};
    if (live && !this.ema) this.ema = {};
    for (const f of FEATS) {
      const arr = col.map((x) => x[f]).sort((a, b) => a - b);
      const pv = arr[Math.floor(0.85 * (cols - 1))];
      if (live) {
        const e = this.ema[f];
        this.ema[f] = e == null ? pv : e * 0.92 + pv * 0.08;
        norm[f] = Math.max(this.ema[f], FLOOR[f]);
      } else norm[f] = Math.max(pv, FLOOR[f]);
    }
    for (const cs of col) {
      cs.fluxN = cs.flux / norm.flux;
      cs.edgeN = cs.edge / norm.edge;
      cs.lowFluxN = cs.lowFlux / norm.lowFlux;
      cs.highTexN = cs.highTex / norm.highTex;
      cs.motionN = hasMotion ? cs.motion / norm.motion : 0;
    }

    return { cols, rows, mode, H, S, L, C, T, E, M, hasMotion, col, g, norm };
  }
}
