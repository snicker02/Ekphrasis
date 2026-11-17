// Ekphrasis — seeded procedural demo images. Each generator is tuned to give the scanner something musical:
// ridgelines and contours become melodies, repeated structure (windows, stripes, petals) becomes rhythm,
// color fields set key and harmony.

export const DEMO_TYPES = [
  ['random', 'Random (new type each time)'],
  ['landscape', 'Landscape'],
  ['nebula', 'Nebula'],
  ['city', 'Night city'],
  ['abstract', 'Bauhaus abstract'],
  ['opart', 'Op-art waves'],
  ['flowfield', 'Flow field'],
  ['mandala', 'Mandala'],
  ['aurora', 'Aurora'],
  ['fractal', 'Julia fractal'],
  ['pixel', 'Pixel art'],
];

const W = 1280, H = 720, TAU = Math.PI * 2;

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w = W, h = H) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return cv;
}

const hs = (h, s, l, a = 1) => `hsla(${((h % 360) + 360) % 360},${s}%,${l}%,${a})`;

// iq-style cosine palette, t in [0,1] → [r,g,b] 0..255
function cosPal(rnd) {
  const a = [0.5, 0.5, 0.5], b = [0.5, 0.5, 0.5];
  const c = [1, 1, 1].map(() => 0.6 + rnd() * 0.8);
  const d = [rnd(), rnd(), rnd()];
  return (t) => [0, 1, 2].map((i) => Math.max(0, Math.min(255, 255 * (a[i] + b[i] * Math.cos(TAU * (c[i] * t + d[i]))))));
}

// Seeded value noise + fbm.
function makeNoise(rnd) {
  const P = new Uint8Array(512), G = new Float32Array(256);
  for (let i = 0; i < 256; i++) { P[i] = i; G[i] = rnd(); }
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = P[i]; P[i] = P[j]; P[j] = t; }
  for (let i = 0; i < 256; i++) P[i + 256] = P[i];
  const sm = (t) => t * t * (3 - 2 * t);
  const n2 = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const a = G[P[P[X] + Y]], b = G[P[P[X + 1] + Y]], c = G[P[P[X] + Y + 1]], d = G[P[P[X + 1] + Y + 1]];
    const u = sm(xf), v = sm(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x, y, oct = 5) => { let s = 0, amp = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += amp * n2(x * f, y * f); f *= 2.03; amp *= 0.5; } return s; };
  return { n2, fbm };
}

function stars(c, rnd, n, maxY = H, bright = 1) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * W, y = Math.pow(rnd(), 1.3) * maxY, a = (0.2 + rnd() * 0.8) * bright;
    const s = rnd() < 0.06 ? 2.2 : rnd() < 0.3 ? 1.4 : 1;
    c.fillStyle = `rgba(255,${235 + Math.floor(rnd() * 20)},${215 + Math.floor(rnd() * 40)},${a})`;
    c.fillRect(x, y, s, s);
    if (s > 2) { c.fillStyle = `rgba(255,255,255,${a * 0.35})`; c.fillRect(x - 3, y + 0.6, 8, 1); c.fillRect(x + 0.6, y - 3, 1, 8); }
  }
}

// ------------------------------------------------------------------ generators
function landscape(rnd) {
  const cv = canvas(), c = cv.getContext('2d'), h0 = rnd() * 360;
  const sky = c.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, hs(h0, 55, 8 + rnd() * 14));
  sky.addColorStop(0.5, hs(h0 + 30 + rnd() * 70, 70, 38 + rnd() * 25));
  sky.addColorStop(1, hs(h0 + 90 + rnd() * 40, 55, 22));
  c.fillStyle = sky; c.fillRect(0, 0, W, H);
  stars(c, rnd, 260, H * 0.5);
  const suns = 1 + Math.floor(rnd() * 2);
  for (let i = 0; i < suns; i++) {
    const x = W * (0.15 + rnd() * 0.7), y = H * (0.15 + rnd() * 0.3), r = 30 + rnd() * 80;
    const g = c.createRadialGradient(x, y, 0, x, y, r * 3), hh = h0 + 180 + rnd() * 60;
    g.addColorStop(0, hs(hh, 90, 92)); g.addColorStop(0.3, hs(hh, 90, 70, 0.9)); g.addColorStop(1, hs(hh, 90, 50, 0));
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r * 3, 0, TAU); c.fill();
  }
  const layers = 4 + Math.floor(rnd() * 3);
  for (let L = 0; L < layers; L++) {
    const k = L / (layers - 1), baseY = H * (0.42 + k * 0.38), amp = H * (0.18 - k * 0.1), rough = 0.6 + rnd() * 1.4;
    let y = baseY - rnd() * amp, vy = 0;
    c.beginPath(); c.moveTo(0, H); c.lineTo(0, y);
    const pts = [];
    for (let x = 0; x <= W; x += 6) {
      vy += (rnd() - 0.5) * rough * 2.2 + (baseY - amp * 0.5 - y) * 0.004; vy *= 0.94; y += vy;
      pts.push([x, y]); c.lineTo(x, y);
    }
    c.lineTo(W, H); c.closePath();
    const hl = h0 + 160 + L * 18 + rnd() * 30;
    c.fillStyle = hs(hl, 35 + rnd() * 30, 32 - k * 24 + rnd() * 8); c.fill();
    if (L === layers - 1) {
      c.fillStyle = hs(hl, 30, 4);
      for (const [x, py] of pts) if (rnd() < 0.09) { const th = 20 + rnd() * 90; c.beginPath(); c.moveTo(x - 7, py + 2); c.lineTo(x, py - th); c.lineTo(x + 7, py + 2); c.fill(); }
    }
  }
  return cv;
}

function nebula(rnd) {
  const cv = canvas(), c = cv.getContext('2d');
  c.fillStyle = '#020207'; c.fillRect(0, 0, W, H);
  // Domain-warped fbm at low resolution, upscaled smoothly: soft gas clouds.
  const lw = 320, lh = 180, low = canvas(lw, lh), lc = low.getContext('2d'), img = lc.createImageData(lw, lh);
  const N = makeNoise(rnd), pal = cosPal(rnd), sc = 2.2 + rnd() * 1.5, ox = rnd() * 50, oy = rnd() * 50;
  for (let y = 0; y < lh; y++) {
    for (let x = 0; x < lw; x++) {
      const u = x / lw * sc * 1.78 + ox, v = y / lh * sc + oy;
      const wx = N.fbm(u + 3.1, v - 1.7, 4), wy = N.fbm(u - 5.2, v + 2.3, 4);
      const d = N.fbm(u + 2.4 * wx, v + 2.4 * wy, 6);
      const dens = Math.pow(Math.max(0, d - 0.32) * 2.1, 1.6);
      const [r, g, b] = pal(d * 1.3 + wx * 0.4);
      const i = (y * lw + x) * 4;
      img.data[i] = r * dens; img.data[i + 1] = g * dens; img.data[i + 2] = b * dens; img.data[i + 3] = 255;
    }
  }
  lc.putImageData(img, 0, 0);
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.globalCompositeOperation = 'lighter';
  c.drawImage(low, 0, 0, W, H);
  c.globalCompositeOperation = 'source-over';
  stars(c, rnd, 900, H, 0.9);
  c.globalCompositeOperation = 'lighter';
  const cores = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < cores; i++) {
    const x = W * (0.15 + rnd() * 0.7), y = H * (0.15 + rnd() * 0.7), r = 6 + rnd() * 18, hh = rnd() * 360;
    const g = c.createRadialGradient(x, y, 0, x, y, r * 8);
    g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.15, hs(hh, 80, 75, 0.5)); g.addColorStop(1, hs(hh, 80, 50, 0));
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r * 8, 0, TAU); c.fill();
  }
  c.globalCompositeOperation = 'source-over';
  return cv;
}

function city(rnd) {
  const cv = canvas(), c = cv.getContext('2d'), h0 = 220 + rnd() * 60, horizon = H * (0.7 + rnd() * 0.08);
  const sky = c.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, hs(h0, 60, 6)); sky.addColorStop(0.65, hs(h0 + 40, 55, 18)); sky.addColorStop(1, hs(h0 + 110 + rnd() * 40, 70, 40));
  c.fillStyle = sky; c.fillRect(0, 0, W, horizon);
  stars(c, rnd, 180, horizon * 0.55, 0.7);
  const mx = W * (0.1 + rnd() * 0.8), my = H * (0.12 + rnd() * 0.15), mr = 22 + rnd() * 18;
  const mg = c.createRadialGradient(mx, my, mr * 0.8, mx, my, mr * 5);
  mg.addColorStop(0, 'rgba(255,245,220,0.35)'); mg.addColorStop(1, 'rgba(255,245,220,0)');
  c.fillStyle = mg; c.beginPath(); c.arc(mx, my, mr * 5, 0, TAU); c.fill();
  c.fillStyle = '#fbf3df'; c.beginPath(); c.arc(mx, my, mr, 0, TAU); c.fill();
  const warm = ['#ffd27a', '#ffb347', '#fff0b8'], cool = ['#9fd8ff', '#c7f0ff', '#7affd6'];
  for (let L = 0; L < 3; L++) {
    const near = L / 2, tone = 8 + (1 - near) * 14;
    let x = -20 - rnd() * 40;
    while (x < W + 20) {
      const bw = 34 + rnd() * (60 + near * 60), bh = (0.12 + rnd() * (0.32 + near * 0.18)) * H * (0.6 + near * 0.5);
      const top = horizon - bh;
      c.fillStyle = hs(h0 + 10, 25, tone); c.fillRect(x, top, bw, bh + 2);
      if (rnd() < 0.25) { c.fillRect(x + bw * 0.45, top - 18 - rnd() * 30, 2, 40); }
      if (rnd() < 0.2) { c.beginPath(); c.moveTo(x, top); c.lineTo(x + bw / 2, top - bw * 0.35); c.lineTo(x + bw, top); c.fill(); }
      const cols = Math.max(2, Math.floor(bw / (7 + rnd() * 4))), rows = Math.floor(bh / 11), litP = 0.15 + rnd() * 0.5 * (0.5 + near);
      const pal = rnd() < 0.7 ? warm : cool, ww = (bw - 6) / cols;
      for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
        if (rnd() > litP) continue;
        c.fillStyle = pal[Math.floor(rnd() * pal.length)];
        c.globalAlpha = 0.45 + 0.55 * near * rnd();
        c.fillRect(x + 3 + k * ww + 1, top + 6 + r * 11, ww - 2.5, 5);
      }
      c.globalAlpha = 1;
      x += bw + rnd() * 6;
    }
  }
  // water: mirrored, rippled reflection
  const refl = canvas(W, Math.ceil(horizon)), rc = refl.getContext('2d');
  rc.drawImage(cv, 0, 0, W, horizon, 0, 0, W, horizon);
  c.fillStyle = hs(h0, 50, 5); c.fillRect(0, horizon, W, H - horizon);
  for (let y = 0; y < H - horizon; y += 2) {
    const sy = horizon - 1 - y * (horizon / (H - horizon)) * 0.6, off = Math.sin(y * 0.35 + rnd() * 0.5) * (2 + y * 0.04);
    c.globalAlpha = 0.55 * (1 - y / (H - horizon)) + 0.1;
    c.drawImage(refl, 0, Math.max(0, sy), W, 2, off, horizon + y, W, 2);
  }
  c.globalAlpha = 1;
  return cv;
}

function abstract(rnd) {
  const cv = canvas(), c = cv.getContext('2d');
  const paper = hs(40 + rnd() * 15, 35, 88 + rnd() * 6);
  c.fillStyle = paper; c.fillRect(0, 0, W, H);
  for (let i = 0; i < 9000; i++) { c.fillStyle = `rgba(80,60,40,${rnd() * 0.05})`; c.fillRect(rnd() * W, rnd() * H, 2, 2); }
  const pals = [['#d7263d', '#f4c430', '#1b4f9c', '#111111', '#2a9d8f'], ['#e63946', '#f1a208', '#1d3557', '#222222', '#a8dadc'], ['#ef476f', '#ffd166', '#06d6a0', '#118ab2', '#073b4c']];
  const pal = pals[Math.floor(rnd() * pals.length)], pick = () => pal[Math.floor(rnd() * pal.length)];
  const n = 16 + Math.floor(rnd() * 12);
  for (let i = 0; i < n; i++) {
    const x = rnd() * W, y = rnd() * H, s = 20 + Math.pow(rnd(), 1.8) * 220;
    c.globalAlpha = 0.75 + rnd() * 0.25;
    switch (Math.floor(rnd() * 7)) {
      case 0: { const rings = 1 + Math.floor(rnd() * 4); for (let k = rings; k > 0; k--) { c.fillStyle = pick(); c.beginPath(); c.arc(x, y, s * k / rings, 0, TAU); c.fill(); } break; }
      case 1: { c.strokeStyle = pick(); c.lineWidth = 2 + rnd() * 10; c.lineCap = 'round'; c.beginPath(); c.moveTo(x, y); const a = rnd() * TAU; c.lineTo(x + Math.cos(a) * s * 3, y + Math.sin(a) * s * 3); c.stroke(); break; }
      case 2: { c.fillStyle = pick(); c.beginPath(); const a = rnd() * TAU; for (let k = 0; k < 3; k++) c.lineTo(x + Math.cos(a + k * TAU / 3) * s, y + Math.sin(a + k * TAU / 3) * s); c.fill(); break; }
      case 3: { c.fillStyle = pick(); c.beginPath(); const a = rnd() * TAU; c.arc(x, y, s, a, a + Math.PI); c.fill(); break; }
      case 4: { const k = 3 + Math.floor(rnd() * 5), cs = s / k * 1.4; for (let i2 = 0; i2 < k; i2++) for (let j = 0; j < k; j++) if ((i2 + j) % 2 === 0) { c.fillStyle = pick(); c.fillRect(x + i2 * cs, y + j * cs, cs, cs); } break; }
      case 5: { c.strokeStyle = pick(); c.lineWidth = 1.5 + rnd() * 3; const k = 4 + Math.floor(rnd() * 8); for (let i2 = 0; i2 < k; i2++) { c.beginPath(); c.moveTo(x, y + i2 * 9); c.lineTo(x + s * 2, y + i2 * 9); c.stroke(); } break; }
      default: { c.fillStyle = pick(); c.save(); c.translate(x, y); c.rotate(rnd() * TAU); c.fillRect(-s / 2, -s / 6, s, s / 3); c.restore(); }
    }
  }
  c.globalAlpha = 1;
  return cv;
}

function opart(rnd) {
  const cv = canvas(), c = cv.getContext('2d'), img = c.createImageData(W, H), d = img.data;
  const pal = cosPal(rnd), variant = Math.floor(rnd() * 3);
  const f1 = 0.02 + rnd() * 0.04, f2 = 0.003 + rnd() * 0.01, warp = 20 + rnd() * 60, ph = rnd() * TAU;
  const cx = W * (0.3 + rnd() * 0.4), cy = H * (0.3 + rnd() * 0.4);
  const c0 = pal(0.1), c1 = pal(0.6);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v;
      if (variant === 0) v = Math.sin(x * f1 + warp * Math.sin(y * f2 + ph) * 0.05 + Math.sin(x * f2 * 2) * 3);
      else if (variant === 1) { const r = Math.hypot(x - cx, y - cy); v = Math.sin(r * f1 * 0.8 + Math.sin(Math.atan2(y - cy, x - cx) * 6 + ph) * 1.5); }
      else v = Math.sin(x * f1 + Math.sin(y * f1 * 0.7) * 2) * Math.sin(y * f1 * 0.9 + Math.sin(x * f2 * 3 + ph) * 2);
      const t = Math.max(0, Math.min(1, 0.5 + v * 3));          // crisp but anti-aliased bands
      const shade = 0.75 + 0.25 * Math.sin(y * f2 * 1.5 + x * f2);
      const i = (y * W + x) * 4;
      d[i] = (c0[0] + (c1[0] - c0[0]) * t) * shade; d[i + 1] = (c0[1] + (c1[1] - c0[1]) * t) * shade; d[i + 2] = (c0[2] + (c1[2] - c0[2]) * t) * shade; d[i + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  return cv;
}

function flowfield(rnd) {
  const cv = canvas(), c = cv.getContext('2d'), dark = rnd() < 0.6;
  c.fillStyle = dark ? '#0c0c12' : '#f2ece0'; c.fillRect(0, 0, W, H);
  const N = makeNoise(rnd), pal = cosPal(rnd), sc = 0.0018 + rnd() * 0.002, turns = 2 + rnd() * 3;
  c.lineCap = 'round';
  c.globalCompositeOperation = dark ? 'lighter' : 'multiply';
  const count = 2600;
  for (let i = 0; i < count; i++) {
    let x = rnd() * W, y = rnd() * H;
    const [r, g, b] = pal(N.n2(x * 0.002, y * 0.002) + rnd() * 0.15);
    c.strokeStyle = `rgba(${r | 0},${g | 0},${b | 0},${dark ? 0.35 : 0.5})`;
    c.lineWidth = 0.6 + rnd() * 2.2;
    c.beginPath(); c.moveTo(x, y);
    const len = 20 + Math.floor(rnd() * 60);
    for (let s = 0; s < len; s++) {
      const a = N.fbm(x * sc, y * sc, 3) * TAU * turns;
      x += Math.cos(a) * 3; y += Math.sin(a) * 3;
      if (x < 0 || y < 0 || x > W || y > H) break;
      c.lineTo(x, y);
    }
    c.stroke();
  }
  c.globalCompositeOperation = 'source-over';
  return cv;
}

function mandala(rnd) {
  const cv = canvas(), c = cv.getContext('2d'), h0 = rnd() * 360;
  const bg = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.6);
  bg.addColorStop(0, hs(h0, 40, 14)); bg.addColorStop(1, hs(h0 + 30, 50, 4));
  c.fillStyle = bg; c.fillRect(0, 0, W, H);
  const n = [6, 8, 10, 12, 16][Math.floor(rnd() * 5)], R = H * 0.47;
  c.translate(W / 2, H / 2);
  const rings = 6 + Math.floor(rnd() * 4);
  for (let k = rings; k >= 1; k--) {
    const r = R * k / rings, hh = h0 + k * (25 + rnd() * 30), petal = r * (0.25 + rnd() * 0.25), kind = Math.floor(rnd() * 3);
    for (let i = 0; i < n * (kind === 2 ? 2 : 1); i++) {
      c.save();
      c.rotate(i * TAU / (n * (kind === 2 ? 2 : 1)) + (k % 2) * Math.PI / n);
      c.fillStyle = hs(hh, 65 + rnd() * 20, 35 + (k / rings) * 30);
      c.strokeStyle = hs(hh + 40, 80, 75, 0.8); c.lineWidth = 1.2;
      c.beginPath();
      if (kind === 0) { c.moveTo(0, r - petal); c.quadraticCurveTo(petal * 0.6, r - petal * 0.4, 0, r + petal * 0.2); c.quadraticCurveTo(-petal * 0.6, r - petal * 0.4, 0, r - petal); }
      else if (kind === 1) c.arc(0, r - petal * 0.3, petal * 0.35, 0, TAU);
      else { c.moveTo(-petal * 0.15, r - petal); c.lineTo(petal * 0.15, r - petal); c.lineTo(0, r + petal * 0.1); }
      c.fill(); c.stroke();
      c.restore();
    }
    c.strokeStyle = hs(hh, 60, 70, 0.5); c.lineWidth = 1;
    c.beginPath(); c.arc(0, 0, r - petal * 1.1, 0, TAU); c.stroke();
  }
  const core = c.createRadialGradient(0, 0, 0, 0, 0, R * 0.12);
  core.addColorStop(0, '#fff8e0'); core.addColorStop(1, hs(h0 + 180, 80, 50, 0));
  c.fillStyle = core; c.beginPath(); c.arc(0, 0, R * 0.12, 0, TAU); c.fill();
  c.setTransform(1, 0, 0, 1, 0, 0);
  return cv;
}

function aurora(rnd) {
  const cv = canvas(), c = cv.getContext('2d'), horizon = H * (0.72 + rnd() * 0.08);
  const sky = c.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#02030a'); sky.addColorStop(1, hs(200 + rnd() * 40, 50, 10));
  c.fillStyle = sky; c.fillRect(0, 0, W, H);
  stars(c, rnd, 500, horizon, 0.8);
  const N = makeNoise(rnd);
  c.globalCompositeOperation = 'lighter';
  const bands = 2 + Math.floor(rnd() * 3);
  for (let b = 0; b < bands; b++) {
    const baseY = H * (0.25 + rnd() * 0.3), amp = 40 + rnd() * 90, hgt = 120 + rnd() * 200, hA = 120 + rnd() * 50, hB = hA + 120 + rnd() * 80, off = rnd() * 100;
    for (let x = 0; x < W; x += 2) {
      const y = baseY + (N.fbm(x * 0.003 + off, b * 3.7, 4) - 0.5) * amp * 2;
      const hh = hgt * (0.5 + N.fbm(x * 0.01 + off, 9.1 + b, 3));
      const g = c.createLinearGradient(0, y, 0, y - hh);
      // rays: brightness varies quickly along x (curtain folds), slowly along the band
      const ray = Math.pow(N.fbm(x * 0.045 + off, 4.4 + b, 3), 2) * 2.2;
      const a = Math.min(0.9, (0.12 + 0.35 * N.fbm(x * 0.008 + off, 2.2, 3)) * (0.5 + ray));
      g.addColorStop(0, hs(hA, 95, 62, Math.min(1, a * 1.5))); g.addColorStop(0.35, hs(hA + 15, 95, 60, a)); g.addColorStop(1, hs(hB, 90, 60, 0));
      c.fillStyle = g; c.fillRect(x, y - hh, 2, hh);
    }
  }
  c.globalCompositeOperation = 'source-over';
  // mountains + snow
  let y = horizon - 80;
  c.beginPath(); c.moveTo(0, H);
  const ridge = [];
  for (let x = 0; x <= W; x += 8) { y = horizon - 30 - N.fbm(x * 0.004 + 50, 1, 5) * 180; ridge.push([x, y]); c.lineTo(x, y); }
  c.lineTo(W, H); c.closePath(); c.fillStyle = '#05070c'; c.fill();
  c.strokeStyle = 'rgba(200,230,255,0.25)'; c.lineWidth = 1.5; c.beginPath();
  ridge.forEach(([x, yy], i) => (i ? c.lineTo(x, yy) : c.moveTo(x, yy))); c.stroke();
  return cv;
}

function fractal(rnd) {
  const lw = 640, lh = 360, low = canvas(lw, lh), lc = low.getContext('2d'), img = lc.createImageData(lw, lh), d = img.data;
  const presets = [[-0.8, 0.156], [0.285, 0.01], [-0.4, 0.6], [-0.70176, -0.3842], [-0.835, -0.2321], [0.355, 0.355], [-0.54, 0.54]];
  const [cr0, ci0] = presets[Math.floor(rnd() * presets.length)];
  const cr = cr0 + (rnd() - 0.5) * 0.01, ci = ci0 + (rnd() - 0.5) * 0.01;
  const pal = cosPal(rnd), zoom = 1.3 + rnd() * 0.8, rotA = rnd() * TAU, ca = Math.cos(rotA), sa = Math.sin(rotA), MAX = 160;
  for (let y = 0; y < lh; y++) {
    for (let x = 0; x < lw; x++) {
      const u = ((x - lw / 2) / lh) * 3 / zoom, v = ((y - lh / 2) / lh) * 3 / zoom;
      let zr = u * ca - v * sa, zi = u * sa + v * ca, i = 0;
      while (i < MAX && zr * zr + zi * zi < 64) { const t = zr * zr - zi * zi + cr; zi = 2 * zr * zi + ci; zr = t; i++; }
      const k = (y * lw + x) * 4;
      if (i >= MAX) { d[k] = 6; d[k + 1] = 4; d[k + 2] = 12; }
      else {
        const sm = i + 1 - Math.log2(Math.log2(zr * zr + zi * zi) * 0.5);
        const [r, g, b] = pal(sm * 0.035);
        const glow = Math.min(1, 0.35 + sm / 40);
        d[k] = r * glow; d[k + 1] = g * glow; d[k + 2] = b * glow;
      }
      d[k + 3] = 255;
    }
  }
  lc.putImageData(img, 0, 0);
  const cv = canvas(), c = cv.getContext('2d');
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.drawImage(low, 0, 0, W, H);
  return cv;
}

function pixel(rnd) {
  const pw = 160, ph = 90, low = canvas(pw, ph), c = low.getContext('2d'), h0 = rnd() * 360;
  const bands = 6;
  for (let i = 0; i < bands; i++) { c.fillStyle = hs(h0 + i * 8, 60, 22 + i * 9); c.fillRect(0, Math.floor(i * ph * 0.6 / bands), pw, Math.ceil(ph * 0.6 / bands) + 1); }
  for (let y = 0; y < ph * 0.6; y++) for (let x = 0; x < pw; x++) if ((x + y) % 2 === 0 && rnd() < 0.08) { c.fillStyle = 'rgba(255,255,255,0.08)'; c.fillRect(x, y, 1, 1); }
  for (let i = 0; i < 25; i++) { c.fillStyle = '#fff'; c.fillRect(Math.floor(rnd() * pw), Math.floor(rnd() * ph * 0.35), 1, 1); }
  const sx = 20 + Math.floor(rnd() * 120), sy = 12 + Math.floor(rnd() * 20), sr = 6 + Math.floor(rnd() * 5);
  c.fillStyle = hs(h0 + 180, 90, 70);
  for (let y = -sr; y <= sr; y++) for (let x = -sr; x <= sr; x++) if (x * x + y * y <= sr * sr) c.fillRect(sx + x, sy + y, 1, 1);
  for (let k = 0; k < 4; k++) {
    let cx = Math.floor(rnd() * pw), cy = 8 + Math.floor(rnd() * 25);
    c.fillStyle = 'rgba(255,255,255,0.75)';
    for (let i = 0; i < 4; i++) { c.fillRect(cx + i * 3, cy - (i % 2), 6, 3); }
  }
  const layers = [[0.45, 25, 55], [0.6, 18, 38], [0.75, 12, 24]];
  layers.forEach(([base, amp, light], L) => {
    let y = ph * base;
    c.fillStyle = hs(h0 + 120 + L * 15, 40, light - 10);
    for (let x = 0; x < pw; x++) {
      if (x % 3 === 0) y += Math.round((rnd() - 0.5) * 3);
      y = Math.max(ph * base - amp, Math.min(ph * base + amp * 0.3, y));
      c.fillRect(x, Math.floor(y), 1, ph - Math.floor(y));
    }
  });
  c.fillStyle = hs(h0 + 100, 50, 10);
  for (let x = 0; x < pw; x += 4 + Math.floor(rnd() * 6)) {
    const base = Math.floor(ph * 0.82 + rnd() * 6), th = 5 + Math.floor(rnd() * 8);
    for (let i = 0; i < th; i++) { const w = Math.max(1, Math.floor((th - i) / 2)); c.fillRect(x - Math.floor(w / 2), base - i, w, 1); }
  }
  c.fillStyle = hs(h0 + 200, 45, 18); c.fillRect(0, Math.floor(ph * 0.9), pw, ph);
  const cv = canvas(), cc = cv.getContext('2d');
  cc.imageSmoothingEnabled = false;
  cc.drawImage(low, 0, 0, W, H);
  return cv;
}

const GEN = { landscape, nebula, city, abstract, opart, flowfield, mandala, aurora, fractal, pixel };

// type: one of DEMO_TYPES (or 'random'); returns { canvas, type, name }
export function makeDemo(type = 'random', seed = 1) {
  const rnd = mulberry32(seed * 9973 + 17);
  let t = type;
  if (!GEN[t]) { const keys = Object.keys(GEN); t = keys[Math.floor(mulberry32(seed * 31 + 7)() * keys.length)]; }
  return { canvas: GEN[t](rnd), type: t, name: `${t}-${seed}` };
}
