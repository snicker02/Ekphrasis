// Ekphrasis — app wiring: sources, transport, panel, rendering, exports.

import { initPanelTabs } from './tabs.js';
import { Analyzer, SCAN_MODES, mapUV, mergeGlobals } from './engine/analysis.js';
import { resolveKey, NOTE_NAMES, MODES } from './engine/theory.js';
import { Composer, composeImage, composeSong, VOICES } from './engine/composer.js';
import { buildArrangement, describe, sectionAt, shapeSettings, arrangeStep, intensityAt } from './engine/arranger.js';
import { GENRES, GENRE_ORDER, autoGenre } from './engine/genres.js';
import { PATCHES, MELODIC, BASSES, ATMOS } from './engine/instruments.js';
import { KITS, KIT_ORDER } from './engine/drums.js';
import { Synth } from './engine/synth.js';
import { Sequencer, scoreFromSteps, renderScore } from './engine/sequencer.js';
import { encodeWAV, buildMIDI, pickVideoMime, download } from './engine/export.js';
import { makeDemo, DEMO_TYPES } from './engine/demo.js';
import { buildPanel } from './ui.js';
import { drawFrame, COLORS, MAX_LIFE } from './render.js';
import { encodeMP4, mp4Supported, MemorySink, FileSink, videoBitrate } from './engine/mp4.js';
import { FX_LIST, FX_PRESETS, emptyStack, applyPreset, activeEffects, audioFeatures } from './fx.js';
import { SceneRenderer, cameraAt } from './scene.js';
import { VideoStepper, resolveDuration } from './engine/videostep.js';
import { DecodedVideo } from './engine/demux.js';

export const VERSION = '1.6.0';
const ROWS = 24;
const VIDEO_COLS = 16;

const S = {
  genre: 'auto',
  scan: 'horizontal', bars: 8, overlay: 'full',
  key: 'auto', mode: 'auto', harmony: 'triads', keyFollow: false,
  autoTempo: true, tempo: 100, swing: 0.12, density: 0.5, rhythm: 0.5, humanize: 0.35, range: 2, loop: true,
  voices: {
    lead: { on: true, vol: 0.8, inst: 'saw' },
    arp: { on: true, vol: 0.6, inst: 'bell' },
    chords: { on: true, vol: 0.6, inst: 'warmPad' },
    bass: { on: true, vol: 0.75, inst: 'synth' },
    drums: { on: true, vol: 0.7, inst: 'studio' },
    atmos: { on: true, vol: 0.6, inst: 'off' },
  },
  reverb: 0.35, reverbSize: 3, delay: 0.22, master: 0.8, srcAudio: 0,
  mp4size: 1080, exAspect: 'source', exFit: 'fill', exFps: 30, exQuality: 'high', exFade: true, exDisk: true,
  camera: 'drift',
  form: 'medium', fxPreset: 'pulse', fxStack: applyPreset(emptyStack(), 'pulse'), fxAmount: 0.8,
  demoType: 'random',
};

const $ = (id) => document.getElementById(id);
const view = $('view'), vctx = view.getContext('2d');
const roll = $('roll'), rctx = roll.getContext('2d');
const vid = $('vid'), playBtn = $('play'), recBtn = $('rec'), viewgl = $('viewgl');
// GPU scene renderer for the live view (media, playhead, notes, camera, FX). Falls back to the 2D canvas renderer.
let glv = null;
try { glv = new SceneRenderer(viewgl); } catch (e) { console.warn('WebGL unavailable, using the 2D renderer:', e.message); }
let glvMediaKey = null;
// GPU path when the GPU is real, or when an FX mode is on (FX need GL). Software GL without FX → 2D canvas.
const fxOn = () => activeEffects(S.fxStack).length > 0 && S.fxAmount > 0;
const fxParams = (features) => ({ stack: activeEffects(S.fxStack), master: S.fxAmount, features });
const useGL = () => !!glv && (!glv.software || fxOn());
// Software GL: default to the fast 2D path; effects remain selectable.
if (glv && glv.software) { S.fxPreset = 'none'; applyPreset(S.fxStack, 'none'); }
let lastStep = null;
const analyzer = new Analyzer(), composer = new Composer();

let actx = null, synth = null, seq = null, mediaNode = null, recorder = null;
let demoSeed = 1 + Math.floor(Math.random() * 9999), exporting = null, exStats = null;
let dpr = 1, playToken = 0;

const src = { kind: null, el: null, w: 0, h: 0, name: '', grid: null, score: null, key: null, keyRef: null, stream: null, url: null, genre: 'ekphrasis', videoSteps: null, arr: null, file: null };
let appliedGenre = null;

// ------------------------------------------------------------------ helpers
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const safeName = (s) => (s || 'untitled').replace(/[^\w.-]+/g, '_').slice(0, 60);
let toastTimer = 0;
function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function currentTempo() { return S.autoTempo ? (src.key ? src.key.tempo : 100) : S.tempo; }
function genreObj() { return GENRES[src.genre] || GENRES.ekphrasis; }
function globalStats() { return src.kind === 'image' ? (src.grid && src.grid.g) : src.keyRef; }
function gridCols() { return src.kind === 'image' ? (src.grid ? src.grid.cols : S.bars * 16) : VIDEO_COLS; }
function seedOf(g) { return Math.floor((g.avgL * 7919 + g.avgS * 104729 + g.contrast * 1299709) * 1000) | 0; }

function ensureAudio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    actx = new AC({ latencyHint: 'interactive' });
    synth = new Synth(actx);
    seq = new Sequencer(actx, synth);
    seq.onEnd = () => setPlaying(false);
    synth.setParams(S, currentTempo(), true, genreObj());
  }
  if (actx.state === 'suspended') actx.resume();
  if (!mediaNode) {
    try {
      mediaNode = actx.createMediaElementSource(vid);
      mediaNode.connect(synth.ext);
      vid.muted = false;
    } catch (e) { mediaNode = null; }
  }
}

// ------------------------------------------------------------------ sources
function releaseSource() {
  if (src.stream) { src.stream.getTracks().forEach((t) => t.stop()); src.stream = null; }
  if (src.url) { URL.revokeObjectURL(src.url); src.url = null; }
  vid.pause();
  vid.srcObject = null;
  vid.removeAttribute('src');
  vid.load();
  if (seq) seq.score = [];
}

function loadFile(file) {
  if (!file) return;
  const name = file.name.replace(/\.[^.]+$/, '');
  if (file.type.startsWith('video/')) return loadVideo(file, name);
  if (file.type.startsWith('image/')) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { stop(); releaseSource(); src.url = url; setImage(img, img.naturalWidth, img.naturalHeight, name); };
    img.onerror = () => { URL.revokeObjectURL(url); toast('Could not decode that image'); };
    img.src = url;
    return;
  }
  toast('Unsupported file type — use an image or a video');
}

function setImage(el, w, h, name) {
  src.kind = 'image'; src.el = el; src.w = w; src.h = h; src.name = name; src.keyRef = null;
  analyzeImage();
  playBtn.disabled = false;
  updateSourceInfo();
}

function imageCols() {
  const arr = buildArrangement(src.genre, S.form, 'image');
  return arr ? arr.uniqueBars * 16 : S.bars * 16;
}

function analyzeImage() {
  analyzer.reset();
  src.grid = analyzer.analyze(src.el, src.w, src.h, { mode: S.scan, cols: imageCols(), rows: ROWS, maxDim: 400 });
  recompose();
}

// Video: the song form is stretched over the clip's length (null for loop mode or clips shorter than the form).
function videoArr() {
  if (src.kind !== 'video' || S.form === 'loop' || !isFinite(vid.duration)) return null;
  const sd = 60 / currentTempo() / 4;
  return buildArrangement(src.genre, S.form, 'timeline', Math.floor(vid.duration / (16 * sd)));
}

function updateArrInfo() {
  let t = '';
  if (S.form === 'loop') t = 'Loop: the image is scanned once per pass, no sections.';
  else if (src.kind === 'image' && src.arr) t = describe(src.arr, currentTempo());
  else if (src.kind === 'video') { const a = videoArr(); t = a ? describe(a, currentTempo()) + ' (stretched over the clip)' : 'Clip too short for a song form; looping.'; }
  else if (src.kind === 'webcam') t = 'Webcam has no fixed length; looping.';
  $('arrinfo').textContent = t;
}

// Genre: resolve (auto picks from image stats), and load its instrument/harmony/swing defaults
// whenever the resolved genre changes or the user picks one explicitly.
function applyGenreDefaults(id) {
  const G = GENRES[id];
  for (const r of VOICES) {
    S.voices[r].inst = G.inst[r];
    S.voices[r].on = !G.off.includes(r);
  }
  S.harmony = G.harmony;
  S.swing = G.swing;
  appliedGenre = id;
  panel.sync();
}

function updateGenre(force) {
  const g = globalStats();
  const id = S.genre === 'auto' ? (g ? autoGenre(g) : 'ekphrasis') : S.genre;
  if (force || id !== appliedGenre) applyGenreDefaults(id);
  src.genre = id;
  composer.setGenre(id);
  const G = GENRES[id];
  $('genreinfo').textContent = (S.genre === 'auto' ? `Auto → ${G.label}. ` : '') + G.blurb;
}

function recompose(forceGenre = false) {
  src.videoSteps = null;
  updateGenre(forceGenre);
  if (src.kind === 'image' && src.grid) {
    src.key = resolveKey(src.grid.g, S, genreObj());
    composer.setKey(src.key);
    composer.seed = seedOf(src.grid.g);
    src.arr = buildArrangement(src.genre, S.form, 'image');
    const need = src.arr ? src.arr.uniqueBars * 16 : S.bars * 16;
    if (src.grid.cols !== need) src.grid = analyzer.analyze(src.el, src.w, src.h, { mode: S.scan, cols: need, rows: ROWS, maxDim: 400 });
    src.score = src.arr ? composeSong(composer, src.grid, S, src.arr) : composeImage(composer, src.grid, S);
  } else if (src.keyRef) {
    const tempo = src.key ? src.key.tempo : null;
    src.key = resolveKey(src.keyRef, S, genreObj());
    if (tempo && seq && seq.playing) src.key.tempo = tempo; // keep tempo stable mid-play
    composer.setKey(src.key);
  }
  if (synth) synth.setParams(S, currentTempo(), false, genreObj());
  syncTempoControl();
  updateArrInfo();
  updateReadout();
}

function seekTo(v, t) {
  return new Promise((res) => {
    const done = () => { v.removeEventListener('seeked', done); clearTimeout(to); res(); };
    const to = setTimeout(done, 2000);
    v.addEventListener('seeked', done);
    v.currentTime = t;
  });
}

async function loadVideo(file, name) {
  stop(); releaseSource();
  const url = URL.createObjectURL(file);
  src.url = url;
  src.file = file;
  const token = ++playToken;
  vid.src = url;
  vid.loop = S.loop;
  vid.muted = !mediaNode;
  try {
    await new Promise((res, rej) => {
      vid.onloadeddata = () => res();
      vid.onerror = () => rej(new Error('decode'));
    });
  } catch (e) { toast('Could not decode that video in this browser'); return; }
  if (token !== playToken) return;
  await resolveDuration(vid); // MediaRecorder WebM reports Infinity until scanned
  if (token !== playToken) return;
  src.kind = 'video'; src.el = vid; src.w = vid.videoWidth; src.h = vid.videoHeight; src.name = name;
  src.grid = null; src.score = null; src.videoSteps = null;
  playBtn.disabled = true;
  toast('Reading video color…', 1500);
  // Sample several frames across the clip so the key reflects the whole video.
  const gs = [];
  if (isFinite(vid.duration) && vid.duration > 0.5) {
    for (const p of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      await seekTo(vid, vid.duration * p);
      if (token !== playToken) return;
      gs.push(analyzer.analyze(vid, src.w, src.h, { mode: S.scan, cols: VIDEO_COLS, rows: ROWS, maxDim: 160 }).g);
    }
    await seekTo(vid, 0);
  } else gs.push(analyzer.analyze(vid, src.w, src.h, { mode: S.scan, cols: VIDEO_COLS, rows: ROWS, maxDim: 160 }).g);
  if (token !== playToken) return;
  src.keyRef = mergeGlobals(gs);
  src.key = null;
  composer.seed = seedOf(src.keyRef);
  recompose();
  playBtn.disabled = false;
  updateSourceInfo();
}

async function startWebcam() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('Webcam not available in this browser'); return; }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  } catch (e) { toast('Webcam unavailable: ' + (e.message || e.name)); return; }
  stop(); releaseSource();
  const token = ++playToken;
  src.stream = stream;
  vid.srcObject = stream;
  vid.muted = true;
  try { await vid.play(); } catch (e) { /* will start on Play */ }
  await new Promise((res) => { if (vid.videoWidth) res(); else vid.onloadedmetadata = () => res(); });
  if (token !== playToken) return;
  src.kind = 'webcam'; src.el = vid; src.w = vid.videoWidth; src.h = vid.videoHeight; src.name = 'webcam';
  src.grid = null; src.score = null;
  analyzer.reset();
  src.keyRef = analyzer.analyze(vid, src.w, src.h, { mode: S.scan, cols: VIDEO_COLS, rows: ROWS, maxDim: 160 }).g;
  src.key = null;
  composer.seed = 4242;
  recompose();
  playBtn.disabled = false;
  updateSourceInfo();
}

function loadDemo() {
  stop(); releaseSource();
  playToken++;
  demoSeed++;
  const d = makeDemo(S.demoType, demoSeed);
  setImage(d.canvas, d.canvas.width, d.canvas.height, d.name);
}

// Step providers for the sequencer.
const imageSource = {
  get stepCount() { return src.score ? src.score.length : 0; },
  eventsForStep(step) { const sc = src.score; return sc[step % sc.length]; },
};

// One step of a video/webcam score: compose from the grid, then apply the song form (if any).
function videoStepEvents(comp, grid, step, arr) {
  const col = step % VIDEO_COLS, bar = Math.floor(step / VIDEO_COLS);
  let sa = null, s2 = S;
  if (arr) { sa = sectionAt(arr, bar); s2 = shapeSettings(S, sa.sec); }
  if (col === 0) comp.beginBar(bar, comp.barStatsFromGlobal(grid), src.keyRef, s2, false, grid.g.energy);
  let events = comp.stepEvents(step, grid, col, s2);
  if (sa) events = arrangeStep(events, { sec: sa.sec, inSec: sa.inSec, sib: col, col, rows: ROWS });
  return {
    events, col, bar, chord: comp.chordLabel, rootPc: comp.chordRootPc(),
    intensity: sa ? intensityAt(sa.sec, sa.inSec, col) : 0.7, section: sa ? sa.sec.name : '',
  };
}

const liveSource = {
  stepCount: Infinity,
  arr: null,
  eventsForStep(step) {
    const col = step % VIDEO_COLS, bar = Math.floor(step / VIDEO_COLS);
    if (vid.readyState < 2 || !vid.videoWidth) return { events: [], col, bar, chord: composer.chordLabel };
    const grid = analyzer.analyze(vid, vid.videoWidth, vid.videoHeight, { mode: S.scan, cols: VIDEO_COLS, rows: ROWS, maxDim: 160, live: true });
    src.grid = grid;
    if (col === 0) {
      if (S.keyFollow && bar > 0 && bar % 4 === 0) {
        src.keyRef = mergeGlobals([src.keyRef, grid.g], [0.6, 0.4]);
        const tempo = src.key.tempo;
        src.key = resolveKey(src.keyRef, S, genreObj());
        src.key.tempo = tempo;
        composer.setKey(src.key);
      }
    }
    return videoStepEvents(composer, grid, step, this.arr);
  },
};

// ------------------------------------------------------------------ transport
function setPlaying(on) {
  playBtn.textContent = on ? '■ Stop' : '▶ Play';
  playBtn.classList.toggle('playing', on);
  if (!on && recorder && recorder.state === 'recording') stopRecording();
}

function play() {
  if (!src.kind) return;
  ensureAudio();
  const opts = { getTempo: currentTempo, getSwing: () => S.swing, getSwingGrid: () => genreObj().swingGrid, getLoop: () => S.loop };
  if (src.kind === 'image') {
    if (!src.score) return;
    seq.start(imageSource, opts);
  } else {
    analyzer.reset();
    composer.reset();
    composer.setKey(src.key);
    liveSource.arr = videoArr();
    if (src.kind === 'video') {
      vid.loop = S.loop;
      if (vid.ended) vid.currentTime = 0;
      vid.play().catch(() => toast('Video could not start'));
    }
    seq.start(liveSource, opts);
  }
  synth.setParams(S, currentTempo(), false, genreObj());
  synth.resetFilters();
  if (glv) glv.clearHistory();
  setPlaying(true);
}

function stop() {
  if (seq && seq.playing) { seq.stop(); synth.panic(); }
  if (src.kind === 'video') vid.pause();
  setPlaying(false);
}

function togglePlay() { if (seq && seq.playing) stop(); else play(); }

vid.addEventListener('ended', () => {
  if (src.kind === 'video' && seq && seq.playing && !S.loop) { seq.stop(); setPlaying(false); }
});

// ------------------------------------------------------------------ exports
// Video files are composed offline by stepping through the clip one 16th at a time (deterministic, no playthrough
// needed). Uses its own Analyzer/Composer so live playback state is untouched; frames are fetched sequentially
// with VideoStepper (play/pause stepping) instead of a seek per step.
async function composeVideoOffline(onProgress, cancelled) {
  const tempo = currentTempo(), sd = 60 / tempo / 4, D = vid.duration;
  const n = Math.max(VIDEO_COLS, Math.floor(D / sd));
  const an = new Analyzer(), comp = new Composer();
  comp.setGenre(src.genre); comp.setKey(src.key); comp.seed = composer.seed;
  const arr = videoArr();
  const steps = [];
  const muted = vid.muted;
  vid.muted = true;
  // Fast path: decode the file with WebCodecs. Fallback: step the <video> element.
  const dv = await DecodedVideo.open(src.file, vid.videoWidth, vid.videoHeight).catch(() => null);
  const stepper = dv ? null : new VideoStepper(vid, { rate: 2 }); // analysis only: ±2 frames is irrelevant
  try {
    if (stepper) await stepper.start(0);
    for (let st = 0; st < n; st++) {
      if (cancelled && cancelled()) throw new Error('cancelled');
      const t = Math.min(D - 0.01, st * sd);
      const frameSrc = dv ? await dv.frameAt(t) : (await stepper.frameAt(t), vid);
      const grid = an.analyze(frameSrc, vid.videoWidth, vid.videoHeight, { mode: S.scan, cols: VIDEO_COLS, rows: ROWS, maxDim: 160, live: true });
      steps.push(videoStepEvents(comp, grid, st, arr));
      if (onProgress && st % 8 === 0) onProgress(st / n);
    }
  } finally {
    if (stepper) await stepper.stop();
    if (dv) dv.close();
    vid.muted = muted;
  }
  return steps;
}

async function stepsForExport(onProgress, cancelled) {
  if (src.kind === 'image') return src.score;
  if (src.kind === 'video') {
    if (!src.videoSteps) {
      stop();
      src.videoSteps = await composeVideoOffline(onProgress, cancelled);
      await seekTo(vid, 0);
    }
    return src.videoSteps;
  }
  return null;
}

async function currentScore(onProgress) {
  if (!src.kind) { toast('Load something first'); return null; }
  const tempo = currentTempo(), G = genreObj();
  if (src.kind === 'webcam') {
    if (seq && seq.score.length) return { events: seq.score, tempo };
    toast('Play the webcam first — its score is captured as it plays');
    return null;
  }
  const steps = await stepsForExport(onProgress);
  return { events: scoreFromSteps(steps, tempo, S.swing, G.swingGrid), tempo, steps };
}

async function busyButton(btn, label, fn) {
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = label;
  try { await fn((p) => { btn.textContent = `${label} ${Math.round(p * 100)}%`; }); }
  catch (e) { if (e.message !== 'cancelled') { console.error(e); toast('Export failed: ' + e.message, 5000); } else toast('Export cancelled'); }
  finally { btn.disabled = false; btn.textContent = old; }
}

function renderWav(btn) {
  return busyButton(btn, 'Rendering…', async (prog) => {
    const sc = await currentScore(prog);
    if (!sc) return;
    const buf = await renderScore(sc.events, S, sc.tempo, genreObj());
    download(encodeWAV(buf), `ekphrasis_${safeName(src.name)}.wav`);
    toast(`WAV rendered (${buf.duration.toFixed(1)} s)`);
  });
}

function exportMidi(btn) {
  return busyButton(btn, 'Composing…', async (prog) => {
    const sc = await currentScore(prog);
    if (!sc) return;
    download(buildMIDI(sc.events, sc.tempo, S.voices), `ekphrasis_${safeName(src.name)}.mid`);
    toast('MIDI exported');
  });
}

// Output size: the short side is the chosen resolution; aspect is the source's or a fixed format.
const ASPECTS = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5 };
function exportSize() {
  const a = S.exAspect === 'source' ? src.w / src.h : ASPECTS[S.exAspect];
  const short = S.mp4size;
  let w, h;
  if (a >= 1) { h = short; w = Math.round(short * a); } else { w = short; h = Math.round(short / a); }
  const cap = 4096;
  if (Math.max(w, h) > cap) { const k = cap / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
  return { w: Math.max(16, w - (w % 2)), h: Math.max(16, h - (h % 2)) };
}

const fmtTime = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

const exUI = {
  panel: $('exportpanel'), phase: $('exphase'), bar: $('exbar'), stats: $('exstats'), preview: $('expreview'), cancel: $('excancel'),
  show(on) { this.panel.hidden = !on; if (on) { this.failed = false; this.cancel.textContent = 'Cancel'; this.panel.classList.remove('failed'); } },
  // Failures stay on screen (with the stage they happened in) until dismissed, instead of a toast that vanishes.
  fail(msg) { this.failed = true; this.panel.classList.add('failed'); this.stats.textContent = msg; this.cancel.textContent = 'Close'; },
  set(phase, frac, stats = '') { this.phase.textContent = phase; this.bar.style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`; this.stats.textContent = stats; },
  thumb(canvas) {
    const c = this.preview.getContext('2d'), W = this.preview.width, H = this.preview.height;
    const k = Math.min(W / canvas.width, H / canvas.height), w = canvas.width * k, h = canvas.height * k;
    c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
    try { c.drawImage(canvas, (W - w) / 2, (H - h) / 2, w, h); } catch (e) { /* not ready */ }
  },
};
exUI.cancel.addEventListener('click', () => {
  if (exporting) { exporting.cancel = true; exUI.set('Cancelling…', 0); return; }
  exUI.show(false);
});

// Offline, frame-accurate MP4. Audio: OfflineAudioContext. Frames: SceneRenderer on the GPU (media texture uploaded
// once for images; video stepped sequentially), FX and camera included, fade in/out. Encode: WebCodecs H.264
// (hardware when available) + AAC/Opus. Mux: engine/mp4.js, streamed straight to disk where the browser allows.
async function exportMp4() {
  if (exporting) { exporting.cancel = true; return; }
  if (!src.kind) { toast('Load something first'); return; }
  if (src.kind === 'webcam') { toast('Webcam can’t be rendered offline — use ● Rec, which records MP4 live', 4500); return; }
  if (!mp4Supported()) { toast('This browser has no WebCodecs — use ● Rec instead', 4500); return; }
  const fileName = `ekphrasis_${safeName(src.name)}.mp4`;
  // Ask for the destination first, while we still have the click's user activation.
  let sink = null, savedTo = null;
  if (S.exDisk && window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: fileName, types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }] });
      sink = new FileSink(await handle.createWritable());
      savedTo = handle.name;
    } catch (e) {
      if (e.name === 'AbortError') return;
      sink = null;
    }
  }
  stop();
  const job = { cancel: false };
  exporting = job;
  const cancelled = () => job.cancel;
  exUI.show(true);
  exUI.set('Composing score…', 0);
  const isVideo = src.kind === 'video';
  const muted = vid.muted;
  let stepper = null, dv = null;
  try {
    const steps = await stepsForExport((p) => exUI.set('Composing score…', p), cancelled);
    const tempo = currentTempo(), G = genreObj(), sd = 60 / tempo / 4;
    const events = scoreFromSteps(steps, tempo, S.swing, G.swingGrid).sort((a, b) => a.t - b.t);
    exUI.set('Rendering audio…', 0);
    const audio = await renderScore(events, S, tempo, G, 48000);
    if (job.cancel) throw new Error('cancelled');

    const { w, h } = exportSize(), fps = S.exFps, cols = gridCols(), barDur = 16 * sd;
    const odpr = Math.min(w, h) / 720;
    let lastNote = 0;
    for (const e of events) if (e.voice !== 'fx') lastNote = Math.max(lastNote, e.t + e.dur);
    const D = audio.duration;
    const fade = (t) => {
      if (!S.exFade) return 1;
      const fin = Math.min(1, t / 0.6);
      const fout = t <= lastNote ? 1 : Math.max(0, 1 - (t - lastNote) / Math.max(0.5, D - lastNote - 0.1));
      return fin * fout;
    };
    const playheadAt = (tt) => {
      if (tt < 0) return null;
      const st = Math.floor(tt / sd);
      return st < steps.length ? (steps[st].col + (tt / sd - st)) / cols : null;
    };

    // GPU path (falls back to the 2D renderer without WebGL).
    // Video frames: WebCodecs decode of the file (fast, frame-exact) or <video> stepping as the fallback.
    if (isVideo) dv = await DecodedVideo.open(src.file, src.w, src.h).catch(() => null);
    const mediaEl = isVideo ? (dv ? dv.canvas : vid) : src.el;
    const canvas = document.createElement('canvas');
    let scene = null, c2d = null, cv2d = null;
    if (useGL()) {
      try {
        scene = new SceneRenderer(canvas, { preserve: true });
        scene.resize(w, h);
        scene.setMedia(mediaEl, src.w, src.h, isVideo, Math.max(w, h) * 2);
      } catch (e) { scene = null; }
    }
    if (!scene) {
      cv2d = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
      c2d = cv2d.getContext('2d');
      if (fxOn()) toast('WebGL unavailable — exporting without reactive FX', 4000);
    }
    const pathName = scene ? (scene.software ? 'GPU (software)' : 'GPU') : '2D';
    if (isVideo && !dv) { vid.muted = true; stepper = new VideoStepper(vid, { rate: 1 }); await stepper.start(0); } // rate 1: ≤1 source frame error

    let lo = 0;
    const vd = isVideo ? vid.duration : 0;
    const prof = { step: 0, render: 0, frames: 0 };
    const draw = async (t, i) => {
      const p0 = performance.now();
      if (dv) await dv.frameAt(t);
      else if (isVideo) await stepper.frameAt(Math.min(t, vd - 0.02));
      const p1 = performance.now();
      prof.step += p1 - p0; prof.frames++;
      try { return renderExportFrame(t, i); } finally { prof.render += performance.now() - p1; }
    };
    const renderExportFrame = (t, i) => {
      while (lo < events.length && events[lo].t < t - MAX_LIFE) lo++;
      const win = [];
      for (let k = lo; k < events.length && events[k].t <= t; k++) win.push(events[k]);
      const st = Math.floor(t / sd), stepInfo = steps[Math.min(st, steps.length - 1)];
      const u = playheadAt(t);
      if (scene) {
        const cam = cameraAt(S.camera, t, { scan: S.scan, playheadAt, intensity: stepInfo.intensity, barDur, seed: composer.seed });
        scene.render({
          t, u, scan: S.scan, overlay: S.overlay, cols, rows: ROWS, events: win, cam, fill: S.exFit === 'fill', dpr: odpr,
          fx: fxParams(audioFeatures(win, t, stepInfo)), fade: fade(t),
        });
        if (i % 10 === 0) exUI.thumb(canvas);
        return canvas;
      }
      const cam = cameraAt(S.camera, t, { scan: S.scan, playheadAt, intensity: stepInfo.intensity, barDur, seed: composer.seed });
      drawFrame(c2d, w, h, { media: mediaEl, mw: src.w, mh: src.h, scan: S.scan, overlay: S.overlay, cols, rows: ROWS, t, events: win, u, dpr: odpr, cam, fill: S.exFit === 'fill', fade: fade(t) });
      if (i % 10 === 0) exUI.thumb(cv2d);
      return cv2d;
    };

    const label = `Encoding ${w}×${h} · ${fps} fps · ${pathName} renderer`;
    const res = await encodeMP4({
      width: w, height: h, fps, quality: S.exQuality, audio, draw, isCancelled: cancelled, sink: sink || new MemorySink(),
      onProgress: (p) => exUI.set(label, p.frac, `frame ${p.frame}/${p.frames} · ${p.fps.toFixed(0)} fps (${(p.fps / fps).toFixed(1)}× real time) · ${fmtTime(p.eta)} left`),
    });
    if (res.blob) download(res.blob, fileName);
    console.info(`[export] ${prof.frames} frames · video stepping ${(prof.step / prof.frames).toFixed(1)} ms/frame · render ${(prof.render / prof.frames).toFixed(1)} ms/frame · encode+mux ${((res.seconds * 1000 - prof.step - prof.render) / prof.frames).toFixed(1)} ms/frame (incl. audio) · ${scene ? 'GPU' : '2D'}${dv ? ` · WebCodecs ${dv.codec}${dv.hardware ? ' (hw)' : ''} · ${dv.decoded} decoded / ${dv.resets} resets` : ''}${stepper ? ` · stepper ${stepper.steps} steps / ${stepper.seeks} seeks` : ''}`);
    exStats = { frames: prof.frames, decode: dv ? dv.codec : null };
    if (dv && dv.endIssue) console.warn(`[export] video decoder at end of stream: ${dv.endIssue} (handled; final frame held)`);
    const hw = res.hardware === 'prefer-hardware' ? 'hardware' : 'software';
    toast(`MP4 ${savedTo ? 'saved to ' + savedTo : 'exported'} — ${w}×${h} · ${fps} fps · ${fmtTime(D)} · rendered in ${fmtTime(res.seconds)} (${(D / res.seconds).toFixed(1)}× real time) · H.264 ${hw} + ${res.audioCodec === 'aac' ? 'AAC' : 'Opus'} · ${pathName} renderer`, 7000);
  } catch (e) {
    if (e.message === 'cancelled') toast('Export cancelled');
    else {
      console.error(e);
      const at = exUI.phase.textContent;
      exUI.fail(`Failed during "${at}" — ${e.name && e.name !== 'Error' ? e.name + ': ' : ''}${e.message}`);
      exUI.phase.textContent = 'Export failed';
    }
    if (sink && e.message !== 'cancelled') { try { await sink.abort(); } catch (e2) { /* ignore */ } }
  } finally {
    exporting = null;
    if (!exUI.failed) exUI.show(false);
    if (stepper) await stepper.stop();
    if (dv) dv.close();
    vid.muted = muted;
    if (isVideo) seekTo(vid, 0);
  }
}

function startRecording() {
  const recCanvas = useGL() ? viewgl : view;
  if (typeof MediaRecorder === 'undefined' || !recCanvas.captureStream) { toast('Recording is not supported in this browser'); return; }
  if (!src.kind) { toast('Load something first'); return; }
  ensureAudio();
  const mime = pickVideoMime();
  const vs = recCanvas.captureStream(30);
  const ad = synth.getStreamDest();
  const stream = new MediaStream([...vs.getVideoTracks(), ...ad.stream.getAudioTracks()]);
  const chunks = [];
  let rec;
  try { rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 8000000 } : {}); }
  catch (e) { toast('Recorder failed: ' + e.message); return; }
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    const type = rec.mimeType || mime || 'video/webm';
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    download(new Blob(chunks, { type }), `ekphrasis_${safeName(src.name)}.${ext}`);
    vs.getTracks().forEach((t) => t.stop());
    recBtn.classList.remove('on');
    toast('Recording saved');
  };
  rec.start(250);
  recorder = rec;
  recBtn.classList.add('on');
  if (!seq.playing) play();
}

function stopRecording() { if (recorder && recorder.state === 'recording') recorder.stop(); recorder = null; }

// ------------------------------------------------------------------ panel
const keyOpts = [['auto', 'Auto (from color)'], ...NOTE_NAMES.map((n, i) => [String(i), n])];
const modeOpts = [['auto', 'Auto (from mood)'], ...Object.entries(MODES).map(([k, v]) => [k, v.label])];
const pct = (v) => Math.round(v * 100) + '%';

const genreOpts = [['auto', 'Auto (from image)'], ...GENRE_ORDER.map((id) => [id, GENRES[id].label])];
const mel = MELODIC.map((n) => [n, PATCHES[n].label]);
const bas = BASSES.map((n) => [n, PATCHES[n].label]);
const atm = ATMOS.map((n) => [n, PATCHES[n].label]);
const kits = KIT_ORDER.map((n) => [n, KITS[n].label]);

const spec = [
  { sec: 'Source' },
  { type: 'buttons', items: [['open', 'Open image / video'], ['webcam', 'Webcam']] },
  { type: 'select', key: 'demoType', label: 'Demo image', options: DEMO_TYPES },
  { type: 'buttons', items: [['demo', 'New demo']] },
  { type: 'info', id: 'srcinfo' },
  { sec: 'Style' },
  { type: 'select', key: 'genre', label: 'Genre', options: genreOpts },
  { type: 'info', id: 'genreinfo' },
  { sec: 'Arrangement' },
  { type: 'select', key: 'form', label: 'Song form', options: [['loop', 'Loop (no sections)'], ['short', 'Short song'], ['medium', 'Medium song'], ['long', 'Long song']] },
  { type: 'info', id: 'arrinfo' },
  { sec: 'Scan' },
  { type: 'select', key: 'scan', label: 'Scan path', options: SCAN_MODES },
  { type: 'select', key: 'bars', label: 'Loop length', num: true, options: [[4, '4 bars'], [8, '8 bars'], [16, '16 bars'], [32, '32 bars']] },
  { sec: 'Harmony' },
  { type: 'select', key: 'key', label: 'Key', options: keyOpts },
  { type: 'select', key: 'mode', label: 'Mode', options: modeOpts },
  { type: 'select', key: 'harmony', label: 'Chords', options: [['triads', 'Triads'], ['sevenths', 'Sevenths'], ['add9', 'Add 9'], ['sus', 'Sus 4'], ['quartal', 'Quartal']] },
  { type: 'range', key: 'range', label: 'Melody range', min: 1, max: 3, step: 0.5, fmt: (v) => v + ' oct' },
  { type: 'check', key: 'keyFollow', label: 'Key drifts with video' },
  { sec: 'Rhythm' },
  { type: 'check', key: 'autoTempo', label: 'Auto tempo (genre range × energy)' },
  { type: 'range', key: 'tempo', label: 'Tempo', min: 50, max: 180, step: 1, fmt: (v) => v + ' BPM' },
  { type: 'range', key: 'density', label: 'Note density', min: 0, max: 1, step: 0.01, fmt: pct },
  { type: 'range', key: 'rhythm', label: 'Groove amount', min: 0, max: 1, step: 0.01, fmt: pct },
  { type: 'range', key: 'swing', label: 'Swing', min: 0, max: 0.6, step: 0.01, fmt: pct },
  { type: 'range', key: 'humanize', label: 'Humanize', min: 0, max: 1, step: 0.01, fmt: pct },
  { type: 'check', key: 'loop', label: 'Loop' },
  { sec: 'Instruments' },
  { type: 'voice', voice: 'lead', label: 'Lead — salient band', color: COLORS.lead, insts: mel },
  { type: 'voice', voice: 'arp', label: 'Arpeggio — color & texture', color: COLORS.arp, insts: mel },
  { type: 'voice', voice: 'chords', label: 'Chords — bar color', color: COLORS.chords, insts: mel },
  { type: 'voice', voice: 'bass', label: 'Bass — low band', color: COLORS.bass, insts: bas },
  { type: 'voice', voice: 'drums', label: 'Drums — edges & motion', color: COLORS.drums, insts: kits },
  { type: 'voice', voice: 'atmos', label: 'Atmosphere', color: COLORS.atmos, insts: atm },
  { sec: 'Space' },
  { type: 'range', key: 'reverb', label: 'Reverb', min: 0, max: 1, step: 0.01, fmt: pct },
  { type: 'range', key: 'reverbSize', label: 'Reverb size', min: 0.8, max: 6, step: 0.1, fmt: (v) => v.toFixed(1) + ' s' },
  { type: 'range', key: 'delay', label: 'Echo', min: 0, max: 1, step: 0.01, fmt: pct },
  { type: 'range', key: 'srcAudio', label: 'Original video audio', min: 0, max: 1, step: 0.01, fmt: pct },
  { type: 'range', key: 'master', label: 'Master', min: 0, max: 1, step: 0.01, fmt: pct },
  { sec: 'Visuals' },
  { type: 'select', key: 'overlay', label: 'Overlay', options: [['full', 'Playhead + notes'], ['playhead', 'Playhead only'], ['none', 'None']] },
  { type: 'select', key: 'camera', label: 'Camera', options: [['static', 'Static'], ['drift', 'Drift (slow pan & zoom)'], ['follow', 'Follow the scan']] },
  { type: 'select', key: 'fxPreset', label: 'FX preset', options: [...Object.entries(FX_PRESETS).map(([k, v]) => [k, v[0]]), ['custom', 'Custom']] },
  { type: 'range', key: 'fxAmount', label: 'FX master', min: 0, max: 1, step: 0.01, fmt: pct },
  ...FX_LIST.flatMap(([id, label, group], i) => [
    ...(i === 0 || FX_LIST[i - 1][2] !== group ? [{ type: 'sub', text: group }] : []),
    { type: 'fxrow', key: 'fxStack.' + id, label },
  ]),
  { sec: 'Export' },
  { type: 'select', key: 'mp4size', label: 'Resolution', num: true, options: [[720, '720p'], [1080, '1080p'], [1440, '1440p'], [2160, '2160p (4K)']] },
  { type: 'select', key: 'exAspect', label: 'Aspect', options: [['source', 'Source'], ['16:9', '16:9 landscape'], ['9:16', '9:16 vertical'], ['1:1', '1:1 square'], ['4:5', '4:5 portrait']] },
  { type: 'select', key: 'exFit', label: 'Framing', options: [['fill', 'Fill (crop)'], ['fit', 'Fit (letterbox)']] },
  { type: 'select', key: 'exFps', label: 'Frame rate', num: true, options: [[24, '24 fps'], [30, '30 fps'], [60, '60 fps']] },
  { type: 'select', key: 'exQuality', label: 'Quality', options: [['standard', 'Standard'], ['high', 'High'], ['max', 'Maximum']] },
  { type: 'check', key: 'exFade', label: 'Fade in / out' },
  { type: 'check', key: 'exDisk', label: 'Save straight to disk (no memory limit)' },
  { type: 'info', id: 'exinfo' },
  { type: 'buttons', items: [['mp4', 'Export MP4'], ['wav', 'Render WAV'], ['midi', 'Export MIDI'], ['rec', 'Record live']] },
  { type: 'note', text: 'Export MP4 renders offline and frame-accurately, with camera, FX and overlay, on the GPU when one is available. Video files are decoded with WebCodecs (H.264, HEVC, VP8, VP9, AV1 where the browser supports them) and fall back to stepping the player. Saving straight to disk avoids holding the file in memory. Record live captures the view in real time; use it for webcam.' },
];

let irTimer = 0;
// ---------------------------------------------------- confirm before applying
// Composition settings (genre, key, harmony, rhythm, form…) rewrite the whole
// score, so dragging a slider would restart the music on every step. With
// "Confirm changes" on (the default) they wait for Apply / Enter; mixer, FX and
// visual settings stay live. The choice is remembered.
const pend = { analyze: false, recompose: false, forceGenre: false };
let confirmMode = true;
try { const v = localStorage.getItem('ekphrasis.confirm'); if (v !== null) confirmMode = v === '1'; } catch (_) {}
function holdChange(what) {
  if (!confirmMode) return false;
  if (what.analyze) pend.analyze = true;
  if (what.recompose) pend.recompose = true;
  if (what.forceGenre) pend.forceGenre = true;
  updateApply();
  return true;
}
function updateApply() {
  const b = $('apply'); if (!b) return;
  const on = pend.analyze || pend.recompose;
  b.hidden = !on;
}
function applyPending() {
  const { analyze, recompose: rc, forceGenre } = pend;
  pend.analyze = pend.recompose = pend.forceGenre = false;
  updateApply();
  if (analyze && src.kind === 'image') { if (forceGenre) updateGenre(true); analyzeImage(); }
  else if (rc || analyze) recompose(forceGenre);
}

function onChange(key) {
  if (key.startsWith('fxStack.')) {
    // Hand edits turn the preset into "Custom".
    if (S.fxPreset !== 'custom') { S.fxPreset = 'custom'; panel.ctrls.fxPreset.value = 'custom'; }
    if (fxOn() && !glv) toast('WebGL is unavailable, so reactive FX are off');
    return;
  }
  switch (key) {
    case 'fxPreset':
      if (S.fxPreset !== 'custom') { applyPreset(S.fxStack, S.fxPreset); panel.sync(); }
      if (fxOn() && !glv) toast('WebGL is unavailable, so reactive FX are off');
      if (glv) glv.clearHistory();
      return;
    case 'demoType':
      loadDemo();
      return;
    case 'genre':
      if (holdChange({ recompose: true, forceGenre: true })) return;
      recompose(true);
      break;
    case 'scan':
      if (src.kind === 'image') { if (holdChange({ analyze: true })) return; analyzeImage(); }
      else { analyzer.reset(); src.videoSteps = null; }
      break;
    case 'bars': case 'form':
      if (holdChange(src.kind === 'image' ? { analyze: true } : { recompose: true })) return;
      if (src.kind === 'image') analyzeImage(); else recompose();
      break;
    case 'key': case 'mode': case 'harmony': case 'range': case 'density':
    case 'rhythm': case 'humanize': case 'autoTempo': case 'tempo': case 'voices.atmos.inst':
      if (holdChange({ recompose: true })) return;
      recompose();
      break;
    case 'loop':
      vid.loop = S.loop;
      break;
    case 'reverbSize':
      clearTimeout(irTimer);
      irTimer = setTimeout(() => { if (synth) synth.setParams(S, currentTempo(), false, genreObj()); }, 180);
      return;
    case 'mp4size': case 'exAspect': case 'exFps': case 'exQuality':
      updateExInfo();
      return;
    case 'overlay': case 'keyFollow': case 'swing': case 'fxAmount': case 'camera': case 'exFit': case 'exFade': case 'exDisk':
      return;
    default:
      if (synth) synth.setParams(S, currentTempo(), false, genreObj());
  }
}

function onButton(id, btn) {
  switch (id) {
    case 'open': $('file').click(); break;
    case 'webcam': startWebcam(); break;
    case 'demo': loadDemo(); break;
    case 'wav': renderWav(btn); break;
    case 'midi': exportMidi(btn); break;
    case 'mp4': exportMp4(); break;
    case 'rec': recorder ? stopRecording() : startRecording(); break;
  }
}

const panel = buildPanel($('panel'), spec, S, onChange, onButton);
{
  const credit = document.createElement('p');
  credit.className = 'credit';
  credit.textContent = `Ekphrasis v${VERSION}`;
  $('panel').appendChild(credit);
}
$('ver').textContent = 'v' + VERSION;
{
  // "Confirm changes" toggle at the top of the Source section.
  const first = $('panel').querySelector('.sec');
  const row = document.createElement('label');
  row.className = 'row check';
  row.innerHTML = '<input type="checkbox" id="confirmMode"> <span class="lbl">Confirm changes before applying</span>';
  first.appendChild(row);
  const note = document.createElement('p');
  note.className = 'note';
  note.textContent = 'When on, composition settings (genre, key, harmony, rhythm, form…) wait until you press Apply or Enter. Mixer, effects and visuals stay live.';
  first.appendChild(note);
  const c = $('confirmMode');
  c.checked = confirmMode;
  c.addEventListener('change', () => {
    confirmMode = c.checked;
    try { localStorage.setItem('ekphrasis.confirm', confirmMode ? '1' : '0'); } catch (_) {}
    if (!confirmMode) applyPending();
  });
  $('apply').addEventListener('click', applyPending);
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.repeat || !(pend.analyze || pend.recompose)) return;
    const t = e.target;
    if (t && (t.tagName === 'BUTTON' || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && t.type === 'text'))) return;
    e.preventDefault(); applyPending();
  });
}
initPanelTabs($('panel'));

function syncTempoControl() {
  const r = panel.ctrls.tempo, val = panel.ctrls['tempo:val'];
  r.disabled = S.autoTempo;
  if (S.autoTempo) { r.value = currentTempo(); val.textContent = currentTempo() + ' BPM (auto)'; }
  else val.textContent = S.tempo + ' BPM';
}

function updateSourceInfo() {
  setTimeout(updateExInfo, 0);
  const kind = src.kind === 'image' ? 'image' : src.kind === 'video' ? `video · ${vid.duration.toFixed(1)} s` : 'live webcam';
  $('srcinfo').textContent = src.kind ? `${src.name} · ${src.w}×${src.h} · ${kind}` : '';
}

let lastReadout = '';
function updateReadout(st) {
  if (!src.key) { $('readout').textContent = src.kind ? '' : 'Load an image or video'; return; }
  let s = `${genreObj().label} · <b>${src.key.name}</b> · ${currentTempo()} BPM`;
  if (st) s += ` · bar ${st.bar + 1}${st.section ? ' · ' + st.section : ''} · <b>${st.chord}</b>`;
  if (s !== lastReadout) { $('readout').innerHTML = s; lastReadout = s; }
}

// ------------------------------------------------------------------ input
playBtn.addEventListener('click', togglePlay);
recBtn.addEventListener('click', () => (recorder ? stopRecording() : startRecording()));
$('file').addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = ''; });
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && (e.target === document.body || e.target === view)) { e.preventDefault(); togglePlay(); }
});
const stage = $('stage');
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; stage.classList.add('dragging'); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; stage.classList.remove('dragging'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault(); dragDepth = 0; stage.classList.remove('dragging');
  const f = e.dataTransfer && e.dataTransfer.files[0];
  if (f) loadFile(f);
});

// ------------------------------------------------------------------ rendering
function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  for (const cv of [view, roll]) {
    const r = cv.parentElement.getBoundingClientRect();
    const w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  }
}
window.addEventListener('resize', resize);

// Live playhead position (0..1 across the grid) at score time tt, from the sequencer's step history.
function livePlayheadAt(tt) {
  if (!seq || !seq.playing) return null;
  const at = seq.startTime + tt, steps = seq.steps;
  for (let i = steps.length - 1; i >= 0; i--) {
    const s = steps[i];
    if (s.t <= at) return (s.col + clamp((at - s.t) / s.dur, 0, 1)) / gridCols();
  }
  return null;
}

function drawView() {
  const now = actx ? actx.currentTime : 0;
  let u = null, st = null, events = [], t = performance.now() / 1000;
  if (seq && seq.score.length) {
    t = now - seq.startTime;
    const sc = seq.score;
    for (let i = sc.length - 1; i >= 0 && sc[i].t > t - MAX_LIFE - 0.5; i--) if (sc[i].t <= t) events.push(sc[i]);
    seq.drain(now);
  }
  if (seq && seq.playing) {
    st = seq.currentStep(now);
    if (st) { u = (st.col + clamp((now - st.t) / st.dur, 0, 1)) / gridCols(); lastStep = st; }
  }
  if (useGL()) {
    const key = src.kind ? `${src.kind}|${src.name}|${src.w}x${src.h}` : null;
    if (key !== glvMediaKey) { glv.setMedia(src.kind ? src.el : null, src.w, src.h, src.kind !== 'image', 4096); glvMediaKey = key; }
    glv.resize(view.width, view.height);
    const stepInfo = st || lastStep;
    const sd = 60 / currentTempo() / 4;
    const cam = cameraAt(S.camera, t, { scan: S.scan, playheadAt: livePlayheadAt, intensity: stepInfo ? stepInfo.intensity : 0.6, barDur: 16 * sd, seed: composer.seed });
    glv.render({
      t, u, scan: S.scan, overlay: S.overlay, cols: gridCols(), rows: ROWS, events, cam, fill: false, dpr,
      fx: fxParams(audioFeatures(events, t, stepInfo)), fade: 1,
    });
    viewgl.style.display = 'block';
  } else {
    if (glv) viewgl.style.display = 'none';
    const stepInfo = st || lastStep;
    const sd = 60 / currentTempo() / 4;
    const cam = cameraAt(S.camera, t, { scan: S.scan, playheadAt: livePlayheadAt, intensity: stepInfo ? stepInfo.intensity : 0.6, barDur: 16 * sd, seed: composer.seed });
    drawFrame(vctx, view.width, view.height, {
      media: src.kind ? src.el : null, mw: src.w, mh: src.h, scan: S.scan, overlay: S.overlay,
      cols: gridCols(), rows: ROWS, t, events, u, dpr, cam, fill: false, fade: 1,
    });
  }
  updateReadout(st);
}

function updateExInfo() {
  const el = $('exinfo');
  if (!el) return;
  if (!src.kind) { el.textContent = ''; return; }
  const { w, h } = exportSize();
  const mbps = videoBitrate(w, h, S.exFps, S.exQuality) / 1e6;
  const disk = S.exDisk && window.showSaveFilePicker ? 'streams to disk' : 'built in memory';
  el.textContent = `${w}×${h} · ${S.exFps} fps · ~${mbps.toFixed(0)} Mbps · ${disk}`;
}

function drawRoll() {
  const W = roll.width, H = roll.height, c = rctx;
  c.fillStyle = '#0e0e11'; c.fillRect(0, 0, W, H);
  const lo = 28, hi = 98, drumH = H * 0.16, noteArea = H - drumH, nh = noteArea / (hi - lo);
  c.fillStyle = 'rgba(255,255,255,0.04)';
  for (let m = 36; m < hi; m += 12) c.fillRect(0, noteArea - (m - lo) * nh, W, 1);
  c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(0, noteArea, W, 1);
  const nowX = W * 0.82;
  c.fillStyle = 'rgba(242,180,90,0.5)'; c.fillRect(nowX, 0, 1 * dpr, H);
  if (!seq || !actx || !seq.score.length) return;
  const now = actx.currentTime, pps = nowX / 7;
  const sc = seq.score;
  for (let i = sc.length - 1; i >= 0; i--) {
    const e = sc[i], at = seq.startTime + e.t;
    if (at < now - 9) break;
    const x0 = nowX + (at - now) * pps;
    const active = at <= now && now <= at + e.dur;
    c.globalAlpha = (active ? 1 : 0.55) * (0.4 + 0.6 * e.vel);
    if (!COLORS[e.voice]) continue;
    c.fillStyle = COLORS[e.voice];
    if (e.voice === 'drums') {
      const y = noteArea + (e.midi === 36 ? 0.72 : e.midi === 38 ? 0.42 : 0.12) * drumH;
      c.fillRect(x0, y, 2 * dpr, drumH * 0.22);
    } else {
      const y = noteArea - (e.midi - lo + 1) * nh;
      c.fillRect(x0, y, Math.max(2 * dpr, e.dur * pps - 1), Math.max(2 * dpr, nh - 0.5));
    }
  }
  c.globalAlpha = 1;
}

function frame() {
  requestAnimationFrame(frame);
  if (exporting) return; // the export owns the media element and the GPU; keep the last live frame
  resize();
  drawView();
  drawRoll();
}

// ------------------------------------------------------------------ boot
resize();
loadDemo();
requestAnimationFrame(frame);

// Exposed for debugging and headless tests.
window.ekphrasis = { S, src, composer, applyGenreDefaults, get seq() { return seq; }, get synth() { return synth; }, play, stop, loadDemo, recompose, analyzeImage, currentScore, VERSION };
