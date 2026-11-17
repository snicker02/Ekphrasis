// Ekphrasis — WebGL1 scene renderer (live view + MP4 export).
// The whole frame is built on the GPU:
//   pass 1  compose : media texture through the camera + analytic playhead glow  → scene FBO
//   pass 2  notes   : note particles as additive quads                         → scene FBO
//   pass 3+ fx      : the enabled effects, one pass each, in FX_LIST order       → ping-pong FBOs
//                     (feedback writes into its own history pair, so it can read its previous frame)
//   final   copy    : last result × fade                                       → canvas
// For still images the media texture is uploaded once; video frames are uploaded per frame straight from the
// <video> element. Nothing is read back to the CPU except by the encoder.

import { mapUV } from './engine/analysis.js';
import { FRAG as FX_FRAG, VERT, COPY } from './fx.js';
import { COLORS, MAX_LIFE, lifeOf } from './render.js';

const SCAN_ID = { horizontal: 0, vertical: 1, radial: 2, rings: 3 };
const TAU = Math.PI * 2;

export const COMPOSE = `precision highp float;
varying vec2 vUv;
uniform sampler2D uMedia;
uniform vec2 uRes;
uniform vec4 uRect;
uniform vec3 uCam;
uniform float uHasMedia, uScan, uU, uFlash, uDpr;

vec2 mediaToPx(vec2 m) { return uRect.xy + ((m - uCam.xy) * uCam.z + 0.5) * uRect.zw; }

void main() {
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uRes;
  vec2 q = (px - uRect.xy) / uRect.zw;
  vec3 col = vec3(0.043, 0.043, 0.051);
  if (uHasMedia > 0.5 && q.x >= 0.0 && q.y >= 0.0 && q.x <= 1.0 && q.y <= 1.0) {
    vec2 m = uCam.xy + (q - 0.5) / uCam.z;
    col = texture2D(uMedia, vec2(m.x, 1.0 - m.y)).rgb;
    if (uU >= 0.0) {
      float d = 1e5;
      if (uScan < 0.5) {
        d = abs(px.x - mediaToPx(vec2(uU, 0.0)).x);
      } else if (uScan < 1.5) {
        d = abs(px.y - mediaToPx(vec2(0.0, uU)).y);
      } else if (uScan < 2.5) {
        float a = uU * 6.2831853 - 1.5707963;
        vec2 c = mediaToPx(vec2(0.5));
        vec2 e = mediaToPx(vec2(0.5) + 0.5 * vec2(cos(a), sin(a)));
        vec2 pa = px - c, ba = e - c;
        float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
        d = length(pa - ba * h);
      } else {
        vec2 c = mediaToPx(vec2(0.5));
        vec2 ab = max(vec2(0.5), 0.5 * uU * uCam.z * uRect.zw);
        vec2 dd = px - c;
        float k = length(dd / ab);
        float g = length(dd / (ab * ab));
        d = abs(k - 1.0) * k / max(g, 1e-4);
      }
      float lw = (0.75 + uFlash * 1.75) * uDpr;
      float core = 1.0 - smoothstep(lw, lw + uDpr, d);
      float glow = exp(-d / ((6.0 + uFlash * 14.0) * uDpr)) * (0.3 + 0.4 * uFlash);
      col = mix(col, vec3(1.0, 0.925, 0.784), core * (0.55 + 0.45 * uFlash));
      col += vec3(1.0, 0.78, 0.47) * glow;
    }
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

export const NOTE_VERT = `attribute vec2 aPos;
attribute vec2 aLocal;
attribute vec4 aCol;
attribute vec3 aShape;
varying vec2 vL;
varying vec4 vC;
varying vec3 vS;
void main() {
  vL = aLocal; vC = aCol; vS = aShape;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

// aShape: x = ring (1) or glow (0), y = radius px, z = quad half-size px
export const NOTE_FRAG = `precision mediump float;
varying vec2 vL;
varying vec4 vC;
varying vec3 vS;
uniform float uDpr;
void main() {
  float d = length(vL);
  if (d > 1.0) discard;
  vec3 c;
  float a;
  if (vS.x > 0.5) {
    float dist = abs(d * vS.z - vS.y);
    a = 1.0 - smoothstep(0.75 * uDpr, 1.5 * uDpr, dist);
    c = vC.rgb;
  } else {
    float r = d * vS.z / max(vS.y, 1.0);
    if (r > 1.0) discard;
    c = mix(vec3(1.0), vC.rgb, smoothstep(0.0, 0.25, r));
    a = 1.0 - smoothstep(0.25, 1.0, r);
  }
  gl_FragColor = vec4(c * a * vC.a, 1.0);
}
`;

// ------------------------------------------------------------------ camera
function h2(a, b) {
  let h = Math.imul(a | 0, 0x9E3779B1) ^ Math.imul((b | 0) + 0x7F4A7C15, 0x85EBCA77);
  h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const ease = (x) => x * x * (3 - 2 * x);

function clampCam(c) {
  const m = 0.5 / c.z;
  c.cx = clamp(c.cx, m, 1 - m); c.cy = clamp(c.cy, m, 1 - m);
  return c;
}

export function scanPoint(scan, u) {
  switch (scan) {
    case 'vertical': return [0.5, u];
    case 'radial': { const a = u * TAU - Math.PI / 2; return [0.5 + 0.32 * Math.cos(a), 0.5 + 0.32 * Math.sin(a)]; }
    case 'rings': return [0.5, 0.5];
    default: return [u, 0.5];
  }
}

// Deterministic camera for time t (seconds). o: { scan, playheadAt(t) → u|null, intensity, barDur, seed }
//   static : full frame
//   drift  : slow Ken Burns moves between seeded keyframes every 8 bars (eased, continuous)
//   follow : zoomed in, tracking the scan position (smoothed over 0.6 s), zoom grows with section intensity
export function cameraAt(mode, t, o) {
  if (mode === 'drift') {
    const seg = Math.max(2, o.barDur * 8), k = Math.floor(t / seg), ph = ease((t - k * seg) / seg);
    const key = (n) => {
      const z = 1.06 + 0.24 * h2(n, o.seed);
      return clampCam({ z, cx: 0.5 + (h2(n, o.seed + 1) - 0.5) * (1 - 1 / z), cy: 0.5 + (h2(n, o.seed + 2) - 0.5) * (1 - 1 / z) });
    };
    const a = key(k), b = key(k + 1);
    return clampCam({ z: a.z + (b.z - a.z) * ph, cx: a.cx + (b.cx - a.cx) * ph, cy: a.cy + (b.cy - a.cy) * ph });
  }
  if (mode === 'follow') {
    let sx = 0, sy = 0, n = 0, uLast = null;
    for (let i = 0; i < 6; i++) {
      const u = o.playheadAt(t - i * 0.12);
      if (u == null) continue;
      if (uLast == null) uLast = u;
      const [x, y] = scanPoint(o.scan, u);
      sx += x; sy += y; n++;
    }
    if (!n) return { z: 1, cx: 0.5, cy: 0.5 };
    let z = 1.45 + 0.3 * (o.intensity ?? 0.6);
    if (o.scan === 'rings') z = clamp(2.2 - 1.2 * uLast, 1, 2.2);
    return clampCam({ z, cx: sx / n, cy: sy / n });
  }
  return { z: 1, cx: 0.5, cy: 0.5 };
}

// Media rect inside the output: fit (letterbox) or fill (cover, cropped).
export function mediaRect(W, H, mw, mh, fill = false) {
  if (!mw || !mh) return { x: 0, y: 0, w: W, h: H };
  const s = fill ? Math.max(W / mw, H / mh) : Math.min(W / mw, H / mh), w = mw * s, h = mh * s;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

// ------------------------------------------------------------------ GL helpers
function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(sh));
  return sh;
}
function program(gl, vs, fs, attribs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}
function makeTex(gl, w, h) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (w) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  return t;
}
function makeTarget(gl, w, h) {
  const tex = makeTex(gl, w, h), fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fb };
}
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
const RGB = Object.fromEntries(Object.entries(COLORS).map(([k, v]) => [k, hexRgb(v)]));

// ------------------------------------------------------------------ renderer
export class SceneRenderer {
  constructor(canvas, { preserve = false } = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: preserve, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    // Software rasterizers (SwiftShader, llvmpipe, Microsoft Basic Render) make every full-screen pass expensive;
    // callers use the 2D renderer there unless FX (which need GL) are on.
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.rendererName = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    this.software = /swiftshader|llvmpipe|softpipe|software|basic render|mesa offscreen/i.test(this.rendererName);
    this.compose = program(gl, VERT, COMPOSE, ['aPos']);
    this.fx = program(gl, VERT, FX_FRAG, ['aPos']);
    this.copy = program(gl, VERT, COPY, ['aPos']);
    this.notes = program(gl, NOTE_VERT, NOTE_FRAG, ['aPos', 'aLocal', 'aCol', 'aShape']);
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.noteBuf = gl.createBuffer();
    this.noteData = new Float32Array(6 * 11 * 512);
    this.media = makeTex(gl, 0, 0);
    this.mediaEl = null; this.mediaVideo = false; this.mediaW = 0; this.mediaH = 0;
    this.w = 0; this.h = 0; this.scene = null; this.chain = null; this.hist = null; this.hcur = 0;
    this._tmp = [0, 0];
  }

  resize(w, h) {
    if (w === this.w && h === this.h) return;
    const gl = this.gl;
    this.canvas.width = w; this.canvas.height = h;
    this.w = w; this.h = h;
    for (const t of [this.scene, ...(this.chain || []), ...(this.hist || [])]) if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
    this.scene = makeTarget(gl, w, h);
    this.chain = [makeTarget(gl, w, h), makeTarget(gl, w, h)];
    this.hist = [makeTarget(gl, w, h), makeTarget(gl, w, h)];
    this.hcur = 0;
  }

  // Still images are uploaded once (pre-scaled to `maxDim` with high-quality resampling so camera moves don't
  // shimmer); video is re-uploaded every frame in render().
  setMedia(el, w, h, isVideo, maxDim = 4096) {
    this.mediaEl = el; this.mediaVideo = !!isVideo; this.mediaW = w; this.mediaH = h;
    if (!el) return;
    if (isVideo) return;
    const lim = Math.min(this.maxTex, Math.max(256, Math.round(maxDim)));
    let srcEl = el;
    if (Math.max(w, h) > lim) {
      const s = lim / Math.max(w, h);
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(w * s)); cv.height = Math.max(1, Math.round(h * s));
      const c = cv.getContext('2d');
      c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
      c.drawImage(el, 0, 0, cv.width, cv.height);
      srcEl = cv;
    }
    this._upload(srcEl);
  }

  _upload(el) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.media);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  clearHistory() {
    const gl = this.gl;
    if (!this.hist) return;
    for (const b of this.hist) { gl.bindFramebuffer(gl.FRAMEBUFFER, b.fb); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  _bindQuad(prog) {
    const gl = this.gl;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    for (let i = 1; i < 4; i++) gl.disableVertexAttribArray(i);
  }

  // o: { t, u, scan, overlay, cols, rows, events, cam, fill, dpr, fx:{ stack:[{id,mode,amt}], master, features }, fade }
  render(o) {
    const gl = this.gl, W = this.w, H = this.h;
    const R = mediaRect(W, H, this.mediaW, this.mediaH, o.fill);
    const cam = o.cam || { z: 1, cx: 0.5, cy: 0.5 };
    const hasMedia = !!this.mediaEl && this.mediaW > 0;
    // <video> needs a decoded frame; canvases (decoded WebCodecs frames) have no readyState and are always ready.
    if (hasMedia && this.mediaVideo && (this.mediaEl.readyState === undefined || this.mediaEl.readyState >= 2)) this._upload(this.mediaEl);

    let flash = 0;
    for (const e of o.events) if (e.voice === 'drums' && (e.midi === 36) && e.t <= o.t) flash = Math.max(flash, e.vel * Math.pow(0.02, o.t - e.t));
    const showOverlay = o.overlay !== 'none';

    // ---- pass 1: compose
    gl.viewport(0, 0, W, H);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fb);
    gl.disable(gl.BLEND);
    const C = this.compose;
    this._bindQuad(C.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.media); gl.uniform1i(C.u.uMedia, 0);
    gl.uniform2f(C.u.uRes, W, H);
    gl.uniform4f(C.u.uRect, R.x, R.y, R.w, R.h);
    gl.uniform3f(C.u.uCam, cam.cx, cam.cy, cam.z);
    gl.uniform1f(C.u.uHasMedia, hasMedia ? 1 : 0);
    gl.uniform1f(C.u.uScan, SCAN_ID[o.scan] ?? 0);
    gl.uniform1f(C.u.uU, showOverlay && o.u != null ? o.u : -1);
    gl.uniform1f(C.u.uFlash, flash);
    gl.uniform1f(C.u.uDpr, o.dpr);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // ---- pass 2: note particles (additive)
    if (hasMedia && o.overlay === 'full') {
      const n = this._buildNotes(o, R, cam);
      if (n) {
        const N = this.notes;
        gl.useProgram(N.p);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.noteBuf);
        gl.bufferData(gl.ARRAY_BUFFER, this.noteData.subarray(0, n * 66), gl.DYNAMIC_DRAW);
        const st = 11 * 4;
        [[0, 2, 0], [1, 2, 2], [2, 4, 4], [3, 3, 8]].forEach(([loc, size, off]) => {
          gl.enableVertexAttribArray(loc);
          gl.vertexAttribPointer(loc, size, gl.FLOAT, false, st, off * 4);
        });
        gl.uniform1f(N.u.uDpr, o.dpr);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.drawArrays(gl.TRIANGLES, 0, n * 6);
        gl.disable(gl.BLEND);
      }
    }

    // ---- pass 3+: effect chain (one pass per enabled effect, in FX_LIST order)
    const fx = o.fx || { stack: [], master: 0, features: null };
    const f = fx.features || { kick: 0, snare: 0, hat: 0, bass: 0, lead: 0, pitch: 0.5, hue: 0, int: 0.7, kickAge: 99, snareAge: 99 };
    const effects = fx.stack || [];
    const F = this.fx, scale = (fx.master ?? 1) * (0.35 + 0.65 * f.int);
    const common = {
      uTime: o.t, uKick: f.kick, uSnare: f.snare, uHat: f.hat, uBass: f.bass, uLead: f.lead, uPitch: f.pitch,
      uHue: f.hue, uInt: f.int, uKickAge: Math.min(f.kickAge ?? 99, 99), uSnareAge: Math.min(f.snareAge ?? 99, 99),
    };
    let src = this.scene.tex, k = 0, usedFeedback = false;
    for (const e of effects) {
      const fb = e.id === 'feedback';
      const dst = fb ? this.hist[this.hcur] : this.chain[k];
      this._bindQuad(F.p);
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src); gl.uniform1i(F.u.uTex, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.hist[1 - this.hcur].tex); gl.uniform1i(F.u.uPrev, 1);
      gl.uniform2f(F.u.uRes, W, H);
      for (const key in common) if (F.u[key]) gl.uniform1f(F.u[key], common[key]);
      gl.uniform1f(F.u.uMode, e.mode);
      gl.uniform1f(F.u.uAmt, e.amt * scale);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      src = dst.tex;
      if (fb) usedFeedback = true; else k = 1 - k;
    }
    if (usedFeedback) this.hcur = 1 - this.hcur;

    // ---- final: copy to the canvas with the fade
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this._bindQuad(this.copy.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src); gl.uniform1i(this.copy.u.uTex, 0);
    gl.uniform1f(this.copy.u.uFade, o.fade ?? 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // Same particle look as the 2D renderer: glows for lead/arp/drums, rings for chords/bass/atmos.
  _buildNotes(o, R, cam) {
    const W = this.w, H = this.h, d = this.noteData, tmp = this._tmp;
    const base = Math.min(R.w, R.h) / 60 * Math.sqrt(cam.z);
    let n = 0;
    const max = d.length / 66;
    for (const e of o.events) {
      if (n >= max) break;
      const rgb = RGB[e.voice];
      if (!rgb) continue;
      const age = o.t - e.t;
      if (age < 0) continue;
      const life = lifeOf(e);
      if (age >= life || age > MAX_LIFE) continue;
      mapUV(o.scan, (e.col + 0.5) / o.cols, ((e.row == null ? o.rows / 2 : e.row) + 0.5) / o.rows, tmp);
      const x = R.x + ((tmp[0] - cam.cx) * cam.z + 0.5) * R.w, y = R.y + ((tmp[1] - cam.cy) * cam.z + 0.5) * R.h;
      const size = e.voice === 'chords' ? base * 3.2 : e.voice === 'atmos' ? base * 6 : e.voice === 'bass' ? base * 2.2 : e.voice === 'drums' ? base * 0.9 : base * (1 + e.vel);
      const k = 1 - age / life;
      const r = size * (e.voice === 'drums' ? 1 + age * 8 : 1 + (1 - k) * 1.5);
      const ring = e.voice === 'chords' || e.voice === 'bass' || e.voice === 'atmos';
      const half = r + 2 * o.dpr;
      if (x + half < 0 || y + half < 0 || x - half > W || y - half > H) continue;
      const a = k * (0.35 + 0.65 * e.vel);
      const x0 = ((x - half) / W) * 2 - 1, x1 = ((x + half) / W) * 2 - 1;
      const y0 = 1 - ((y - half) / H) * 2, y1 = 1 - ((y + half) / H) * 2;
      const corners = [[x0, y0, -1, -1], [x1, y0, 1, -1], [x0, y1, -1, 1], [x0, y1, -1, 1], [x1, y0, 1, -1], [x1, y1, 1, 1]];
      let o2 = n * 66;
      for (const [px, py, lx, ly] of corners) {
        d[o2++] = px; d[o2++] = py; d[o2++] = lx; d[o2++] = ly;
        d[o2++] = rgb[0]; d[o2++] = rgb[1]; d[o2++] = rgb[2]; d[o2++] = a;
        d[o2++] = ring ? 1 : 0; d[o2++] = r; d[o2++] = half;
      }
      n++;
    }
    return n;
  }
}
