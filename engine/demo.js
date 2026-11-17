// Ekphrasis — seeded procedural demo landscapes, so the app has something to play before you load media.
// Ridgelines become melodic contours, stars and trees become texture/hats, the sun becomes a bright accent.

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeDemo(seed = 1, W = 1280, H = 720) {
  const rnd = mulberry32(seed * 9973 + 17);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  const h0 = rnd() * 360;
  const hs = (h, s, l, a = 1) => `hsla(${((h % 360) + 360) % 360},${s}%,${l}%,${a})`;

  const sky = c.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, hs(h0, 55, 8 + rnd() * 14));
  sky.addColorStop(0.5, hs(h0 + 30 + rnd() * 70, 70, 38 + rnd() * 25));
  sky.addColorStop(1, hs(h0 + 90 + rnd() * 40, 55, 22));
  c.fillStyle = sky; c.fillRect(0, 0, W, H);

  for (let i = 0; i < 260; i++) {
    const y = Math.pow(rnd(), 1.6) * H * 0.5;
    c.fillStyle = `rgba(255,255,255,${(0.15 + rnd() * 0.7) * (1 - y / (H * 0.5))})`;
    const s = rnd() < 0.08 ? 2.4 : 1.2;
    c.fillRect(rnd() * W, y, s, s);
  }

  const suns = 1 + Math.floor(rnd() * 2);
  for (let i = 0; i < suns; i++) {
    const x = W * (0.15 + rnd() * 0.7), y = H * (0.15 + rnd() * 0.3), r = 30 + rnd() * 80;
    const g = c.createRadialGradient(x, y, 0, x, y, r * 3);
    const hh = h0 + 180 + rnd() * 60;
    g.addColorStop(0, hs(hh, 90, 92)); g.addColorStop(0.3, hs(hh, 90, 70, 0.9)); g.addColorStop(1, hs(hh, 90, 50, 0));
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r * 3, 0, Math.PI * 2); c.fill();
  }

  const layers = 4 + Math.floor(rnd() * 3);
  for (let L = 0; L < layers; L++) {
    const k = L / (layers - 1);
    const baseY = H * (0.42 + k * 0.38), amp = H * (0.18 - k * 0.1), rough = 0.6 + rnd() * 1.4;
    let y = baseY - rnd() * amp, vy = 0;
    c.beginPath(); c.moveTo(0, H); c.lineTo(0, y);
    const pts = [];
    for (let x = 0; x <= W; x += 6) {
      vy += (rnd() - 0.5) * rough * 2.2 + (baseY - amp * 0.5 - y) * 0.004;
      vy *= 0.94; y += vy;
      pts.push([x, y]); c.lineTo(x, y);
    }
    c.lineTo(W, H); c.closePath();
    const hl = h0 + 160 + L * 18 + rnd() * 30;
    c.fillStyle = hs(hl, 35 + rnd() * 30, 32 - k * 24 + rnd() * 8); c.fill();
    if (L === layers - 1) {
      // foreground trees: vertical spikes = rhythmic edges
      c.fillStyle = hs(hl, 30, 4);
      for (const [x, py] of pts) {
        if (rnd() < 0.09) {
          const th = 20 + rnd() * 90;
          c.beginPath(); c.moveTo(x - 7, py + 2); c.lineTo(x, py - th); c.lineTo(x + 7, py + 2); c.fill();
        }
      }
    }
  }
  return cv;
}
