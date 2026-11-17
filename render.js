// Ekphrasis — 2D canvas frame renderer (no-WebGL / software-GL path).
// Draws the media through the camera, the playhead and note particles for time t from the score alone, so the
// live view and the offline export produce identical frames. Mirrors SceneRenderer (scene.js) minus the FX pass.

import { mapUV } from './engine/analysis.js';

const TAU = Math.PI * 2;
export const COLORS = { lead: '#ffd166', arp: '#7fe3f0', chords: '#b79cff', bass: '#ff7a6b', drums: '#e8e4da', atmos: '#8fd18b' };
export const MAX_LIFE = 3;

export function lifeOf(e) {
  return e.voice === 'chords' ? 1.8 : e.voice === 'atmos' ? 2.5 : e.voice === 'drums' ? 0.35 : 0.9 + Math.min(1.5, e.dur);
}

export function mediaRect(W, H, mw, mh, fill = false) {
  if (!mw || !mh) return { x: 0, y: 0, w: W, h: H };
  const s = fill ? Math.max(W / mw, H / mh) : Math.min(W / mw, H / mh), w = mw * s, h = mh * s;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

const ID_CAM = { z: 1, cx: 0.5, cy: 0.5 };

// Playhead as three stacked strokes (wide faint halo, mid glow, bright core) — no shadowBlur, which is slow.
function drawPlayhead(c, R, cam, u, scan, flash, dpr) {
  const mx = (x) => R.x + ((x - cam.cx) * cam.z + 0.5) * R.w;
  const my = (y) => R.y + ((y - cam.cy) * cam.z + 0.5) * R.h;
  const path = () => {
    c.beginPath();
    switch (scan) {
      case 'vertical': { const y = my(u); c.moveTo(R.x, y); c.lineTo(R.x + R.w, y); break; }
      case 'radial': {
        const a = u * TAU - Math.PI / 2;
        c.moveTo(mx(0.5), my(0.5)); c.lineTo(mx(0.5 + 0.5 * Math.cos(a)), my(0.5 + 0.5 * Math.sin(a))); break;
      }
      case 'rings': c.ellipse(mx(0.5), my(0.5), Math.max(0.5, u * 0.5 * cam.z * R.w), Math.max(0.5, u * 0.5 * cam.z * R.h), 0, 0, TAU); break;
      default: { const x = mx(u); c.moveTo(x, R.y); c.lineTo(x, R.y + R.h); }
    }
  };
  c.save();
  c.lineCap = 'round';
  const passes = [
    [(14 + flash * 28) * dpr, `rgba(255,200,120,${0.06 + 0.08 * flash})`],
    [(5 + flash * 9) * dpr, `rgba(255,214,150,${0.16 + 0.18 * flash})`],
    [(1.5 + flash * 3.5) * dpr, `rgba(255,236,200,${0.55 + flash * 0.45})`],
  ];
  for (const [lw, col] of passes) { c.lineWidth = lw; c.strokeStyle = col; path(); c.stroke(); }
  c.restore();
}

const tmp = [0, 0];
function drawParticles(c, R, cam, o) {
  const base = Math.min(R.w, R.h) / 60 * Math.sqrt(cam.z);
  c.save();
  c.globalCompositeOperation = 'lighter';
  for (const e of o.events) {
    if (!COLORS[e.voice]) continue;
    const age = o.t - e.t;
    if (age < 0) continue;
    const life = lifeOf(e);
    if (age >= life) continue;
    mapUV(o.scan, (e.col + 0.5) / o.cols, ((e.row == null ? o.rows / 2 : e.row) + 0.5) / o.rows, tmp);
    const x = R.x + ((tmp[0] - cam.cx) * cam.z + 0.5) * R.w, y = R.y + ((tmp[1] - cam.cy) * cam.z + 0.5) * R.h;
    const size = e.voice === 'chords' ? base * 3.2 : e.voice === 'atmos' ? base * 6 : e.voice === 'bass' ? base * 2.2 : e.voice === 'drums' ? base * 0.9 : base * (1 + e.vel);
    const k = 1 - age / life;
    const r = size * (e.voice === 'drums' ? 1 + age * 8 : 1 + (1 - k) * 1.5);
    const col = COLORS[e.voice];
    c.globalAlpha = k * (0.35 + 0.65 * e.vel);
    if (e.voice === 'chords' || e.voice === 'bass' || e.voice === 'atmos') {
      c.strokeStyle = col; c.lineWidth = 1.5 * o.dpr;
      c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke();
    } else {
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, '#fff'); g.addColorStop(0.25, col); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    }
  }
  c.restore();
}

// o: { media, mw, mh, scan, overlay, cols, rows, t, events (t-MAX_LIFE < e.t <= t), u (0..1 or null), dpr,
//      cam ({ z, cx, cy } in media coords), fill (cover framing), fade (0..1) }
export function drawFrame(c, W, H, o) {
  c.fillStyle = '#0b0b0d';
  c.fillRect(0, 0, W, H);
  if (!o.media) return;
  const cam = o.cam || ID_CAM;
  const R = mediaRect(W, H, o.mw, o.mh, o.fill);
  // Camera: draw only the visible crop of the source, scaled to the media rect.
  const sw = o.mw / cam.z, sh = o.mh / cam.z, sx = (cam.cx - 0.5 / cam.z) * o.mw, sy = (cam.cy - 0.5 / cam.z) * o.mh;
  c.save();
  c.beginPath(); c.rect(R.x, R.y, R.w, R.h); c.clip();
  c.imageSmoothingQuality = 'high';
  try { c.drawImage(o.media, sx, sy, sw, sh, R.x, R.y, R.w, R.h); } catch (e) { /* frame not ready */ }
  if (o.overlay !== 'none') {
    let flash = 0;
    for (const e of o.events) {
      if (e.voice === 'drums' && e.midi === 36 && e.t <= o.t) {
        const f = e.vel * Math.pow(0.02, o.t - e.t);
        if (f > flash) flash = f;
      }
    }
    if (o.u != null) drawPlayhead(c, R, cam, o.u, o.scan, flash, o.dpr);
    if (o.overlay === 'full') drawParticles(c, R, cam, o);
  }
  c.restore();
  const fade = o.fade ?? 1;
  if (fade < 1) { c.fillStyle = `rgba(0,0,0,${1 - Math.max(0, fade)})`; c.fillRect(0, 0, W, H); }
}
