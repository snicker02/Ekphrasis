// Ekphrasis — audio-reactive post-processing (WebGL1): effect library, presets, and the score-derived audio
// features that drive it. The passes run inside SceneRenderer (scene.js): every enabled effect is one full-screen
// pass, chained in the fixed order of FX_LIST. Features come from the score, not an analyser, so the live view and
// the offline MP4 export react identically.

// [id, label, group, mode id]. Order = application order.
export const FX_LIST = [
  ['zoompunch', 'Zoom punch', 'Space', 1],
  ['ripple', 'Kick ripples', 'Space', 2],
  ['warp', 'Liquid warp', 'Space', 3],
  ['tunnel', 'Tunnel', 'Space', 4],
  ['kaleido', 'Kaleidoscope', 'Space', 5],
  ['mirror', 'Mirror folds', 'Space', 6],
  ['pixelate', 'Pixelate', 'Space', 7],
  ['feedback', 'Feedback trails', 'Time', 8],
  ['rgbsplit', 'RGB split', 'Color', 9],
  ['hueshift', 'Hue shift', 'Color', 10],
  ['duotone', 'Duotone', 'Color', 11],
  ['posterize', 'Posterize', 'Color', 12],
  ['edges', 'Neon edges', 'Texture', 13],
  ['halftone', 'Halftone print', 'Texture', 14],
  ['glitch', 'Glitch', 'Texture', 15],
  ['bloom', 'Bloom', 'Finish', 16],
  ['vignette', 'Vignette (bass)', 'Finish', 17],
  ['crt', 'CRT / film grain', 'Finish', 18],
  ['strobe', 'Strobe (kick)', 'Finish', 19],
];
export const FX_MODE = Object.fromEntries(FX_LIST.map(([id, , , m]) => [id, m]));

// Presets: { id: amount }. Anything not listed is switched off.
export const FX_PRESETS = {
  none: ['None', {}],
  pulse: ['Pulse', { zoompunch: 0.6, rgbsplit: 0.5, bloom: 0.6, vignette: 0.6 }],
  dream: ['Dream', { warp: 0.5, feedback: 0.4, hueshift: 0.4, bloom: 0.7, vignette: 0.4 }],
  club: ['Club', { zoompunch: 0.8, rgbsplit: 0.6, bloom: 0.5, strobe: 0.6, vignette: 0.5 }],
  trip: ['Trip', { kaleido: 0.8, feedback: 0.6, hueshift: 0.5, bloom: 0.5 }],
  catoptron: ['Catoptron', { mirror: 0.9, ripple: 0.5, bloom: 0.4, vignette: 0.4 }],
  neon: ['Neon', { edges: 0.9, feedback: 0.3, bloom: 0.7 }],
  tunnel: ['Tunnel', { tunnel: 0.8, feedback: 0.35, rgbsplit: 0.3, bloom: 0.5 }],
  retro: ['Retro', { pixelate: 0.35, posterize: 0.6, crt: 0.8 }],
  print: ['Print', { duotone: 0.8, halftone: 0.75 }],
  glitch: ['Glitch', { glitch: 0.8, rgbsplit: 0.6, crt: 0.4 }],
};

export function emptyStack(amt = 0.6) { return Object.fromEntries(FX_LIST.map(([id]) => [id, { on: false, amt }])); }

export function applyPreset(stack, name) {
  const p = FX_PRESETS[name];
  if (!p) return stack;
  for (const [id] of FX_LIST) { const a = p[1][id]; stack[id].on = a != null; if (a != null) stack[id].amt = a; }
  return stack;
}

// Enabled effects in application order: [{ id, mode, amt }]
export function activeEffects(stack) {
  return FX_LIST.filter(([id]) => stack[id] && stack[id].on && stack[id].amt > 0).map(([id, , , mode]) => ({ id, mode, amt: stack[id].amt }));
}

export const VERT = `attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

export const FRAG = `precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform sampler2D uPrev;
uniform vec2 uRes;
uniform float uTime, uMode, uAmt, uKick, uSnare, uHat, uBass, uLead, uPitch, uHue, uInt, uKickAge, uSnareAge;

const mat3 TO_YIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
const mat3 TO_RGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);

vec3 hue2rgb(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
float aspect() { return uRes.x / uRes.y; }
vec2 toAsp(vec2 uv) { return (uv - 0.5) * vec2(aspect(), 1.0); }
vec2 fromAsp(vec2 p) { return p / vec2(aspect(), 1.0) + 0.5; }
vec2 mirrorUv(vec2 uv) { return 1.0 - abs(1.0 - mod(uv, 2.0)); }
vec3 tex(vec2 uv) { return texture2D(uTex, mirrorUv(uv)).rgb; }
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 hueRotate(vec3 c, float a) {
  vec3 y = TO_YIQ * c;
  y.yz = rot(y.yz, a);
  return clamp(TO_RGB * y, 0.0, 1.0);
}

void main() {
  vec2 uv = vUv;
  float A = uAmt;
  float M = uMode;
  vec3 col;
  if (M < 0.5) {
    col = tex(uv);
  } else if (M < 1.5) {
    // zoom punch: kick zooms and nudges rotation, bass breathes
    vec2 p = toAsp(uv);
    p = rot(p, A * 0.03 * uKick * sin(uTime * 1.7)) / (1.0 + A * (0.12 * uKick + 0.03 * uBass));
    col = tex(fromAsp(p)) + hue2rgb(uHue) * 0.1 * A * uKick;
  } else if (M < 2.5) {
    // kick ripples: a ring expands from the center after every kick, plus a slow bass swell
    vec2 p = toAsp(uv);
    float r = length(p), w0 = uKickAge * 0.9, env = exp(-uKickAge * 1.5);
    float w = sin((r - w0) * 28.0) * exp(-abs(r - w0) * 7.0) * env;
    float slow = sin(r * 22.0 - uTime * 3.0) * 0.004 * uBass;
    col = tex(fromAsp(p + normalize(p + 1e-5) * (w * 0.05 + slow) * A * 1.5)) * (1.0 + w * 0.35 * A);
  } else if (M < 3.5) {
    // liquid warp: bass drives displacement, lead tints toward the chord color
    float t = uTime;
    float amp = A * (0.008 + 0.03 * uBass + 0.01 * uKick);
    vec2 w = vec2(sin(uv.y * 9.0 + t * 1.3 + sin(uv.x * 6.0 - t * 0.7) * 1.5),
                  cos(uv.x * 8.0 - t * 1.1 + cos(uv.y * 5.0 + t * 0.9) * 1.5));
    col = tex(uv + w * amp);
    col = mix(col, col * hue2rgb(uHue) * 1.5, 0.2 * A * uLead);
  } else if (M < 4.5) {
    // tunnel: log-polar fly-through, speed follows the bass, mirrored angle avoids a seam
    vec2 p = toAsp(uv);
    float r = max(length(p), 1e-3);
    float a = atan(p.y, p.x);
    vec2 q = vec2(abs(a) / 3.14159265, fract(0.35 / r + uTime * (0.12 + 0.25 * uBass)));
    vec3 tc = tex(q) * smoothstep(0.0, 0.25, r) * (1.0 + 0.3 * uKick);
    col = mix(tex(uv), tc, clamp(A * 1.2, 0.0, 1.0));
  } else if (M < 5.5) {
    // kaleidoscope: segment count follows section intensity, spin follows time + kick
    vec2 p = toAsp(uv);
    float segs = 4.0 + 2.0 * floor(uInt * 4.0 + 0.5);
    float s = 6.2831853 / segs;
    float a = atan(p.y, p.x) + uTime * 0.08 + uKick * 0.15 * A;
    float r = length(p) * (1.0 - 0.12 * uBass * A);
    a = abs(mod(a, s) - s * 0.5);
    col = mix(tex(uv), tex(fromAsp(vec2(cos(a), sin(a)) * r)), clamp(A * 1.25, 0.0, 1.0));
  } else if (M < 6.5) {
    // mirror folds (Catoptron-style): fold count follows intensity, bass pushes the fold planes
    vec2 p = toAsp(uv);
    float folds = 1.0 + floor(uInt * 3.0 + 0.5);
    float ang = uTime * 0.05 + uKick * 0.1 * A;
    for (int i = 0; i < 4; i++) {
      if (float(i) >= folds) break;
      p = rot(p, ang + float(i) * 1.0471976);
      p.x = abs(p.x) - 0.05 * uBass * A;
    }
    col = mix(tex(uv), tex(fromAsp(p)), clamp(A * 1.25, 0.0, 1.0));
  } else if (M < 7.5) {
    // pixelate: cell size jumps on snares and kicks
    float px = 2.0 + A * (6.0 + 24.0 * uSnare + 10.0 * uKick);
    vec2 cells = uRes / px;
    col = tex((floor(uv * cells) + 0.5) / cells);
  } else if (M < 8.5) {
    // feedback trails: previous output of this pass zoomed/rotated (lead pitch steers rotation)
    vec2 p = rot(toAsp(uv), 0.012 * A * (uPitch - 0.5) + 0.003) * (0.985 - 0.02 * uKick * A);
    vec3 prev = texture2D(uPrev, clamp(fromAsp(p), 0.0, 1.0)).rgb;
    vec3 cur = tex(uv);
    float decay = 0.8 + 0.15 * A;
    col = mix(cur, max(cur, prev * decay * mix(vec3(1.0), hue2rgb(uHue), 0.1)), clamp(A * 1.2, 0.0, 1.0));
  } else if (M < 9.5) {
    // RGB split: radial + slowly rotating, widened by snare, kick and hats
    vec2 dir = normalize(toAsp(uv) + 1e-5) * 0.6 + vec2(cos(uTime * 0.7), sin(uTime * 0.7)) * 0.4;
    float s = A * (0.002 + 0.016 * uSnare + 0.008 * uKick + 0.004 * uHat);
    col = vec3(tex(uv + dir * s).r, tex(uv).g, tex(uv - dir * s).b);
  } else if (M < 10.5) {
    // hue shift: slow drift + lead melody + kick nudges
    col = hueRotate(tex(uv), A * (2.0 * sin(uTime * 0.2) + 3.0 * uLead * (uPitch - 0.3) + 0.8 * uKick));
  } else if (M < 11.5) {
    // duotone: luminance mapped between the chord color and its complement
    vec3 c = tex(uv);
    vec3 dark = hue2rgb(uHue) * 0.18 + 0.02;
    vec3 light = mix(hue2rgb(fract(uHue + 0.45)), vec3(1.0), 0.35);
    vec3 d = mix(dark, light, smoothstep(0.05, 0.95, lum(c))) * (1.0 + 0.2 * uKick);
    col = mix(c, d, clamp(A * 1.2, 0.0, 1.0));
  } else if (M < 12.5) {
    // posterize: fewer levels in more intense sections
    vec3 c = tex(uv);
    float lv = mix(24.0, 2.5, clamp(A * (0.6 + 0.4 * uInt), 0.0, 1.0));
    col = mix(c, floor(c * lv + 0.5) / lv, clamp(A * 1.5, 0.0, 1.0));
  } else if (M < 13.5) {
    // neon edges: Sobel luminance edges glowing in the chord color, brighter on hats/kicks
    vec2 o = (1.0 + A) / uRes;
    float tl = lum(tex(uv + vec2(-o.x, o.y))), tc = lum(tex(uv + vec2(0.0, o.y))), tr = lum(tex(uv + vec2(o.x, o.y)));
    float ml = lum(tex(uv + vec2(-o.x, 0.0))), mr = lum(tex(uv + vec2(o.x, 0.0)));
    float bl = lum(tex(uv + vec2(-o.x, -o.y))), bc = lum(tex(uv + vec2(0.0, -o.y))), br = lum(tex(uv + vec2(o.x, -o.y)));
    float gx = tr + 2.0 * mr + br - tl - 2.0 * ml - bl;
    float gy = tl + 2.0 * tc + tr - bl - 2.0 * bc - br;
    float e = length(vec2(gx, gy));
    vec3 base = tex(uv);
    vec3 neon = hue2rgb(fract(uHue + 0.15 * sin(uTime * 0.3))) * e * (2.5 + 4.0 * (uHat + uKick));
    col = mix(base, base * 0.2 + neon, clamp(A, 0.0, 1.0));
  } else if (M < 14.5) {
    // halftone: 45° dot screen sampled per cell, dots tighten on kicks
    float cell = (6.0 + 8.0 * (1.0 - 0.4 * uKick)) * (0.75 + 0.5 * (1.0 - A));
    vec2 g = rot(uv * uRes, 0.785398) / cell;
    vec2 f = fract(g) - 0.5;
    vec2 cp = rot((floor(g) + 0.5) * cell, -0.785398) / uRes;
    vec3 c = tex(cp);
    float rad = sqrt(1.0 - clamp(lum(c), 0.0, 1.0)) * 0.62;
    float dotv = 1.0 - smoothstep(rad - 0.08, rad + 0.08, length(f));
    vec3 ht = mix(vec3(0.96, 0.94, 0.88), c * 0.55, dotv);
    col = mix(tex(uv), ht, clamp(A * 1.2, 0.0, 1.0));
  } else if (M < 15.5) {
    // glitch: block shifts on snare/kick, RGB split on hats, scanlines, kick inverts a few blocks
    float tq = floor(uTime * 15.0);
    vec2 blk = floor(uv * vec2(16.0, 36.0));
    float r = hash(blk + tq);
    vec2 q = uv;
    if (r < (0.04 + 0.5 * uSnare + 0.2 * uKick) * A) q.x += (hash(blk * 1.7 + tq) - 0.5) * 0.25 * A;
    float sp = A * (0.003 + 0.02 * uHat + 0.01 * uSnare);
    col = vec3(tex(q + vec2(sp, 0.0)).r, tex(q).g, tex(q - vec2(sp, 0.0)).b);
    col *= 1.0 - 0.18 * A * step(0.5, fract(uv.y * uRes.y * 0.5));
    if (r > 1.0 - 0.15 * uKick * A) col = 1.0 - col;
  } else if (M < 16.5) {
    // bloom: two rings of bright-pass taps, swelling on kicks
    vec3 c = tex(uv), b = vec3(0.0);
    float r1 = 0.004 * (1.0 + A), r2 = 0.011 * (1.0 + A);
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.785398;
      vec2 o = vec2(cos(a), sin(a)) / vec2(aspect(), 1.0);
      b += max(tex(uv + o * r1) - 0.5, 0.0) + 0.7 * max(tex(uv + o * r2) - 0.5, 0.0);
    }
    col = c + b / 13.6 * A * (1.2 + 2.0 * uKick);
  } else if (M < 17.5) {
    // vignette that breathes with the bass
    float v = smoothstep(1.0, 0.2 - 0.15 * uBass, length(toAsp(uv)) * (1.0 + 0.4 * A));
    col = tex(uv) * mix(1.0, v, clamp(A, 0.0, 1.0));
  } else if (M < 18.5) {
    // CRT / film: barrel curvature, scanlines, aperture mask, fringing, grain
    vec2 p = uv - 0.5;
    vec2 q = 0.5 + p * (1.0 + 0.24 * A * dot(p, p));
    vec3 c = vec3(tex(q + vec2(0.0012 * A, 0.0)).r, tex(q).g, tex(q - vec2(0.0012 * A, 0.0)).b);
    c *= mix(1.0, 0.72 + 0.28 * (0.5 + 0.5 * sin(q.y * uRes.y * 3.14159)), A);
    float m = mod(gl_FragCoord.x, 3.0);
    vec3 mk = vec3(m < 1.0 ? 1.0 : 0.82, (m >= 1.0 && m < 2.0) ? 1.0 : 0.82, m >= 2.0 ? 1.0 : 0.82);
    c *= mix(vec3(1.0), mk, A * 0.6);
    c += (hash(uv * uRes + fract(uTime) * 91.7) - 0.5) * 0.08 * A;
    if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) c = vec3(0.0);
    col = c;
  } else {
    // strobe: kicks flash toward white/chord color, hard snares half-invert
    vec3 c = tex(uv);
    col = mix(c, mix(vec3(1.0), hue2rgb(uHue), 0.35), A * pow(uKick, 3.0) * 0.7);
    if (uSnare * A > 0.7) col = mix(col, 1.0 - col, 0.5);
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

// Final copy to the canvas, with the export fade.
export const COPY = `precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uFade;
void main() { gl_FragColor = vec4(texture2D(uTex, vUv).rgb * uFade, 1.0); }
`;

// ------------------------------------------------------------------ audio features from the score
// events: score events with t <= now (any order); step: current step record ({ intensity, rootPc }) or null.
export function audioFeatures(events, t, step) {
  const f = { kick: 0, snare: 0, hat: 0, bass: 0, lead: 0, pitch: 0.5, hue: 0, int: step ? step.intensity ?? 0.7 : 0.7, kickAge: 99, snareAge: 99 };
  let leadT = -1;
  for (const e of events) {
    const age = t - e.t;
    if (age < 0) continue;
    if (e.voice === 'drums') {
      if (e.midi === 36 || e.midi === 41) { f.kick = Math.max(f.kick, e.vel * Math.exp(-age / 0.15)); f.kickAge = Math.min(f.kickAge, age); }
      else if (e.midi === 38 || e.midi === 39) { f.snare = Math.max(f.snare, e.vel * Math.exp(-age / 0.12)); f.snareAge = Math.min(f.snareAge, age); }
      else f.hat = Math.max(f.hat, e.vel * Math.exp(-age / 0.06));
    } else if (e.voice === 'bass') {
      if (age < e.dur + 0.1) f.bass = Math.max(f.bass, e.vel * Math.exp(-age / 0.6));
    } else if (e.voice === 'lead') {
      if (age < e.dur + 0.15) { f.lead = Math.max(f.lead, e.vel * Math.exp(-age / 0.8)); if (e.t > leadT) { leadT = e.t; f.pitch = Math.min(1, Math.max(0, (e.midi - 48) / 48)); } }
    }
  }
  // Chord root → hue, inverse of the hue→circle-of-fifths key mapping (7 is its own inverse mod 12).
  if (step) f.hue = ((step.rootPc * 7) % 12) / 12;
  return f;
}
