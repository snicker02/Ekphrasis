// Ekphrasis — audio-reactive post-processing shaders (WebGL1) and the score-derived audio features that drive them.
// The pass itself runs inside SceneRenderer (scene.js). Features come from the score, not an analyser, so the
// live view and the offline MP4 export react identically.

export const FX_MODES = [
  ['off', 'Off'], ['pulse', 'Pulse (zoom, aberration, glow)'], ['kaleido', 'Kaleidoscope'], ['warp', 'Liquid warp'],
  ['feedback', 'Feedback trails'], ['glitch', 'Glitch'], ['mirror', 'Mirror folds'],
];
const MODE_ID = { off: 0, pulse: 1, kaleido: 2, warp: 3, feedback: 4, glitch: 5, mirror: 6 };

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
uniform float uTime, uMode, uAmt, uKick, uSnare, uHat, uBass, uLead, uPitch, uHue, uInt, uFade;

vec3 hue2rgb(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
float aspect() { return uRes.x / uRes.y; }
vec2 toAsp(vec2 uv) { return (uv - 0.5) * vec2(aspect(), 1.0); }
vec2 fromAsp(vec2 p) { return p / vec2(aspect(), 1.0) + 0.5; }
vec2 mirrorUv(vec2 uv) { return 1.0 - abs(1.0 - mod(uv, 2.0)); }
vec3 tex(vec2 uv) { return texture2D(uTex, mirrorUv(uv)).rgb; }

void main() {
  vec2 uv = vUv;
  float A = uAmt;
  vec3 col;
  if (uMode < 0.5) {
    col = tex(uv);
  } else if (uMode < 1.5) {
    // pulse: kick zoom punch, snare chromatic aberration, bass-breathing vignette, bright-pass glow
    vec2 p = toAsp(uv) / (1.0 + 0.08 * A * uKick);
    vec2 q = fromAsp(p);
    vec2 d = normalize(p + 1e-5) * A * (0.002 + 0.012 * uSnare + 0.004 * uKick);
    col = vec3(tex(q + d).r, tex(q).g, tex(q - d).b);
    vec3 b = (tex(q + vec2(0.004, 0.0)) + tex(q - vec2(0.004, 0.0)) + tex(q + vec2(0.0, 0.006)) + tex(q - vec2(0.0, 0.006))) * 0.25;
    col += max(b - 0.55, 0.0) * A * (0.6 + 1.6 * uKick);
    float v = smoothstep(1.0, 0.25 - 0.15 * uBass * A, length(p));
    col *= mix(1.0, v, 0.6 * A);
  } else if (uMode < 2.5) {
    // kaleidoscope: segment count follows section intensity, spin follows time + kick
    vec2 p = toAsp(uv);
    float segs = 4.0 + 2.0 * floor(uInt * 4.0 + 0.5);
    float s = 6.2831853 / segs;
    float a = atan(p.y, p.x) + uTime * 0.08 + uKick * 0.15 * A;
    float r = length(p) * (1.0 - 0.12 * uBass * A);
    a = abs(mod(a, s) - s * 0.5);
    vec2 q = fromAsp(vec2(cos(a), sin(a)) * r);
    col = mix(tex(uv), tex(q), clamp(A * 1.25, 0.0, 1.0));
  } else if (uMode < 3.5) {
    // liquid warp: bass drives displacement, lead tints toward the chord color
    float t = uTime;
    float amp = A * (0.008 + 0.03 * uBass + 0.01 * uKick);
    vec2 w = vec2(sin(uv.y * 9.0 + t * 1.3 + sin(uv.x * 6.0 - t * 0.7) * 1.5),
                  cos(uv.x * 8.0 - t * 1.1 + cos(uv.y * 5.0 + t * 0.9) * 1.5));
    col = tex(uv + w * amp);
    col = mix(col, col * hue2rgb(uHue) * 1.5, 0.2 * A * uLead);
  } else if (uMode < 4.5) {
    // feedback trails: previous frame zoomed/rotated (lead pitch steers rotation), bright parts persist
    vec2 p = rot(toAsp(uv), 0.012 * A * (uPitch - 0.5) + 0.003) * (0.985 - 0.02 * uKick * A);
    vec3 prev = texture2D(uPrev, clamp(fromAsp(p), 0.0, 1.0)).rgb;
    vec3 cur = tex(uv);
    float decay = 0.8 + 0.15 * A;
    col = mix(cur, max(cur, prev * decay * mix(vec3(1.0), hue2rgb(uHue), 0.1)), clamp(A * 1.2, 0.0, 1.0));
  } else if (uMode < 5.5) {
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
  } else {
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
  }
  col += hue2rgb(uHue) * 0.12 * A * uKick;
  gl_FragColor = vec4(col * uFade, 1.0);
}
`;

export const COPY = `precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
void main() { gl_FragColor = texture2D(uTex, vUv); }
`;

// ------------------------------------------------------------------ audio features from the score
// events: score events with t <= now (any order); step: current step record ({ intensity, rootPc }) or null.
export function audioFeatures(events, t, step) {
  const f = { kick: 0, snare: 0, hat: 0, bass: 0, lead: 0, pitch: 0.5, hue: 0, int: step ? step.intensity ?? 0.7 : 0.7 };
  let leadT = -1;
  for (const e of events) {
    const age = t - e.t;
    if (age < 0) continue;
    if (e.voice === 'drums') {
      if (e.midi === 36 || e.midi === 41) f.kick = Math.max(f.kick, e.vel * Math.exp(-age / 0.15));
      else if (e.midi === 38 || e.midi === 39) f.snare = Math.max(f.snare, e.vel * Math.exp(-age / 0.12));
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
