// Ekphrasis — offline MP4 export: WebCodecs H.264 + AAC (Opus fallback) and a streaming ISO-BMFF muxer.
// No dependencies.
//
// File layout: [ftyp][mdat (64-bit size)][audio samples][video samples][moov]
// Audio is encoded first (its size is then known), video samples are appended as the encoder emits them, and
// moov is written last. With a file sink (File System Access API) samples go straight to disk and the mdat size
// is patched at the end, so memory use stays flat for long/4K exports; otherwise parts collect into a Blob.

// ------------------------------------------------------------------ box helpers
const enc = new TextEncoder();
function cat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
const u8 = (v) => new Uint8Array([v & 255]);
const u16 = (v) => new Uint8Array([(v >> 8) & 255, v & 255]);
const u24 = (v) => new Uint8Array([(v >> 16) & 255, (v >> 8) & 255, v & 255]);
const u32 = (v) => new Uint8Array([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]);
const u64 = (v) => cat([u32(Math.floor(v / 4294967296)), u32(v >>> 0)]);
const i32 = (v) => u32(v >>> 0);
const str = (s) => enc.encode(s);
const zeros = (n) => new Uint8Array(n);
function box(type, ...payload) { const body = cat(payload); return cat([u32(body.length + 8), str(type), body]); }
function fbox(type, version, flags, ...payload) { return box(type, u8(version), u24(flags), ...payload); }
const MATRIX = cat([u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000)]);
const toU8 = (d) => (d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)));

function runLength(values) {
  const runs = [];
  for (const v of values) {
    const last = runs[runs.length - 1];
    if (last && last[1] === v) last[0]++; else runs.push([1, v]);
  }
  return runs;
}

// ------------------------------------------------------------------ sinks
// Memory sink: collects parts, returns a Blob.
export class MemorySink {
  constructor() { this.parts = []; this.size = 0; }
  write(data) { this.parts.push(data); this.size += data.length; }
  async flush() {}
  async patch(pos, data) {
    // Only the mdat header is ever patched; it is always part index 1.
    let off = 0;
    for (let i = 0; i < this.parts.length; i++) {
      if (off === pos && this.parts[i].length === data.length) { this.parts[i] = data; return; }
      off += this.parts[i].length;
    }
    throw new Error('patch position not found');
  }
  async close() { return new Blob(this.parts, { type: 'video/mp4' }); }
  async abort() { this.parts = []; }
}

// File sink: streams to a FileSystemWritableFileStream, buffering ~8 MB between writes.
export class FileSink {
  constructor(writable) { this.w = writable; this.buf = []; this.bufBytes = 0; this.size = 0; }
  write(data) { this.buf.push(data); this.bufBytes += data.length; this.size += data.length; }
  async flush(force = false) {
    if (!this.bufBytes || (!force && this.bufBytes < 8 * 1024 * 1024)) return;
    const data = cat(this.buf);
    this.buf = []; this.bufBytes = 0;
    await this.w.write(data);
  }
  async patch(pos, data) { await this.flush(true); await this.w.write({ type: 'write', position: pos, data }); }
  async close() { await this.flush(true); await this.w.close(); return null; }
  async abort() { try { await this.w.abort(); } catch (e) { /* already closed */ } }
}

// ------------------------------------------------------------------ muxer
class Mp4Muxer {
  constructor(sink) {
    this.sink = sink;
    this.v = { sizes: [], pts: [], keys: [], desc: null, bytes: 0 };
    this.a = { sizes: [], durs: [], desc: null, bytes: 0 };
    this.ftyp = box('ftyp', str('isom'), u32(0x200), str('isom'), str('iso2'), str('avc1'), str('mp41'));
    sink.write(this.ftyp);
    sink.write(cat([u32(1), str('mdat'), u64(0)])); // 64-bit size, patched at the end
    this.dataStart = this.ftyp.length + 16;
  }

  addAudio(chunk, meta) {
    if (meta && meta.decoderConfig && !this.a.cfgSeen) {
      this.a.cfgSeen = true;
      if (meta.decoderConfig.description) this.a.desc = toU8(meta.decoderConfig.description);
    }
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    this.sink.write(data);
    this.a.sizes.push(data.length); this.a.durs.push(chunk.duration || 0); this.a.bytes += data.length;
  }

  addVideo(chunk, meta) {
    if (meta && meta.decoderConfig && meta.decoderConfig.description && !this.v.desc) this.v.desc = toU8(meta.decoderConfig.description);
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    this.sink.write(data);
    this.v.sizes.push(data.length); this.v.pts.push(chunk.timestamp); this.v.keys.push(chunk.type === 'key'); this.v.bytes += data.length;
  }

  async finalize({ width, height, fps, audio }) {
    const VTS = 90000, frameDur = Math.round(VTS / fps);
    const aOff = this.dataStart, vOff = aOff + this.a.bytes;
    const big = vOff + this.v.bytes > 0xffffffff;
    const nv = this.v.sizes.length, na = this.a.sizes.length;

    const ptsTicks = this.v.pts.map((p) => Math.round(p * VTS / 1e6));
    const offs = ptsTicks.map((p, i) => p - i * frameDur);
    const minOff = Math.min(0, ...offs);
    const needCtts = offs.some((o) => o !== offs[0]) || offs[0] !== 0;
    const vDurTicks = nv * frameDur;
    const movieDurV = Math.round(vDurTicks / VTS * 1000);

    const sr = audio.sampleRate;
    const aDurs = this.a.durs.map((d) => Math.max(1, Math.round(d * sr / 1e6)));
    const aDurTicks = aDurs.reduce((a, b) => a + b, 0);
    const movieDurA = Math.round(aDurTicks / sr * 1000);
    const movieDur = Math.max(movieDurV, movieDurA);

    const hdlr = (t, name) => fbox('hdlr', 0, 0, u32(0), str(t), zeros(12), str(name + '\0'));
    const dinf = box('dinf', fbox('dref', 0, 0, u32(1), fbox('url ', 0, 1)));
    const tkhd = (id, dur, isAudio) => fbox('tkhd', 0, 3, u32(0), u32(0), u32(id), u32(0), u32(dur), zeros(8),
      u16(0), u16(0), u16(isAudio ? 0x0100 : 0), u16(0), MATRIX, u32(isAudio ? 0 : width << 16), u32(isAudio ? 0 : height << 16));
    const mdhd = (ts, dur) => fbox('mdhd', 0, 0, u32(0), u32(0), u32(ts), u32(dur), u16(0x55c4), u16(0));
    const stts = (durs) => { const r = runLength(durs); return fbox('stts', 0, 0, u32(r.length), ...r.flatMap(([n, d]) => [u32(n), u32(d)])); };
    const stsz = (sizes) => fbox('stsz', 0, 0, u32(0), u32(sizes.length), ...sizes.map(u32));
    const stsc = (n) => fbox('stsc', 0, 0, u32(1), u32(1), u32(n), u32(1));
    const stco = (off) => (big ? fbox('co64', 0, 0, u32(1), u64(off)) : fbox('stco', 0, 0, u32(1), u32(off)));

    // ---- video track
    const avc1 = box('avc1', zeros(6), u16(1), u16(0), u16(0), zeros(12), u16(width), u16(height),
      u32(0x00480000), u32(0x00480000), u32(0), u16(1), zeros(32), u16(0x0018), u16(0xffff),
      box('avcC', this.v.desc || new Uint8Array(0)));
    const vStbl = [fbox('stsd', 0, 0, u32(1), avc1), stts(new Array(nv).fill(frameDur))];
    if (needCtts) {
      const r = runLength(offs.map((o) => o - minOff));
      vStbl.push(fbox('ctts', 0, 0, u32(r.length), ...r.flatMap(([n, o]) => [u32(n), u32(o)])));
    }
    const keys = this.v.keys.map((k, i) => (k ? i + 1 : 0)).filter(Boolean);
    vStbl.push(fbox('stss', 0, 0, u32(keys.length), ...keys.map(u32)));
    vStbl.push(stsc(nv), stsz(this.v.sizes), stco(vOff));
    const vEdts = needCtts ? [box('edts', fbox('elst', 0, 0, u32(1), u32(movieDurV), i32(-minOff), u16(1), u16(0)))] : [];
    const vTrak = box('trak', tkhd(1, movieDurV, false), ...vEdts,
      box('mdia', mdhd(VTS, vDurTicks), hdlr('vide', 'VideoHandler'),
        box('minf', fbox('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0)), dinf, box('stbl', ...vStbl))));

    // ---- audio track
    const ch = audio.channels;
    let entry;
    if (audio.codec === 'aac') {
      const asc = this.a.desc || new Uint8Array([0x11, 0x90]);
      const dsi = cat([u8(0x05), u8(asc.length), asc]);
      const dcd = cat([u8(0x04), u8(13 + dsi.length), u8(0x40), u8(0x15), u24(0), u32(audio.bitrate), u32(audio.bitrate), dsi]);
      const sl = cat([u8(0x06), u8(1), u8(0x02)]);
      const es = cat([u8(0x03), u8(3 + dcd.length + sl.length), u16(1), u8(0), dcd, sl]);
      entry = box('mp4a', zeros(6), u16(1), zeros(8), u16(ch), u16(16), u16(0), u16(0), u32(sr << 16), fbox('esds', 0, 0, es));
    } else {
      let preSkip = 312;
      const d = this.a.desc;
      if (d && d.length >= 12 && String.fromCharCode(...d.slice(0, 8)) === 'OpusHead') preSkip = d[10] | (d[11] << 8);
      const dOps = box('dOps', u8(0), u8(ch), u16(preSkip), u32(48000), u16(0), u8(0));
      entry = box('Opus', zeros(6), u16(1), zeros(8), u16(ch), u16(16), u16(0), u16(0), u32(48000 << 16), dOps);
    }
    const aTrak = box('trak', tkhd(2, movieDurA, true),
      box('mdia', mdhd(sr, aDurTicks), hdlr('soun', 'SoundHandler'),
        box('minf', fbox('smhd', 0, 0, u16(0), u16(0)), dinf,
          box('stbl', fbox('stsd', 0, 0, u32(1), entry), stts(aDurs), stsc(na), stsz(this.a.sizes), stco(aOff)))));

    const mvhd = fbox('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(movieDur), u32(0x00010000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(3));
    const moov = box('moov', mvhd, vTrak, ...(na ? [aTrak] : []));
    this.sink.write(moov);
    const mdatSize = 16 + this.a.bytes + this.v.bytes;
    await this.sink.patch(this.ftyp.length, cat([u32(1), str('mdat'), u64(mdatSize)]));
    return this.sink.close();
  }
}

// ------------------------------------------------------------------ codec selection
function avcLevel(w, h, fps) {
  const mbs = Math.ceil(w / 16) * Math.ceil(h / 16), rate = mbs * fps;
  if (mbs <= 3600 && rate <= 108000) return '1f';   // 3.1
  if (mbs <= 8192 && rate <= 245760) return '28';   // 4.0
  if (mbs <= 8704 && rate <= 522240) return '2a';   // 4.2
  if (mbs <= 22080 && rate <= 589824) return '32';  // 5.0
  if (mbs <= 36864 && rate <= 983040) return '33';  // 5.1
  return '34';                                       // 5.2
}

const BPP = { standard: 0.07, high: 0.12, max: 0.22 }; // bits per pixel per frame

export function videoBitrate(width, height, fps, quality) {
  return Math.round(Math.min(80e6, Math.max(2e6, width * height * fps * (BPP[quality] || BPP.high))));
}

export async function pickVideoConfig(width, height, fps, quality = 'high') {
  if (typeof VideoEncoder === 'undefined') return null;
  const lvl = avcLevel(width, height, fps);
  const bitrate = videoBitrate(width, height, fps, quality);
  for (const hw of ['prefer-hardware', 'no-preference']) {
    for (const prof of ['6400', '4d00', '4200']) {
      const cfg = { codec: `avc1.${prof}${lvl}`, width, height, bitrate, framerate: fps, avc: { format: 'avc' }, hardwareAcceleration: hw, latencyMode: 'quality', bitrateMode: 'variable' };
      try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg; } catch (e) { /* try next */ }
    }
  }
  return null;
}

export async function pickAudioConfig(channels) {
  if (typeof AudioEncoder === 'undefined') return null;
  for (const [codec, name] of [['mp4a.40.2', 'aac'], ['opus', 'opus']]) {
    const cfg = { codec, sampleRate: 48000, numberOfChannels: channels, bitrate: 192000 };
    try { if ((await AudioEncoder.isConfigSupported(cfg)).supported) return { cfg, name }; } catch (e) { /* try next */ }
  }
  return null;
}

export function mp4Supported() { return typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined' && typeof VideoFrame !== 'undefined'; }

// Yield to the event loop without timers (setTimeout is clamped to ≥1 s in background tabs; messages are not).
export function yieldNow() {
  return new Promise((res) => { const ch = new MessageChannel(); ch.port1.onmessage = () => res(); ch.port2.postMessage(0); });
}

async function waitQueue(encoder, max) {
  while (encoder.encodeQueueSize > max) {
    if ('ondequeue' in encoder) await new Promise((res) => encoder.addEventListener('dequeue', res, { once: true }));
    else await yieldNow();
  }
}

// draw(t) → canvas to encode (may be async, e.g. video stepping). audio: AudioBuffer at 48 kHz.
// sink: MemorySink | FileSink. Returns { blob (null for file sinks), audioCodec, videoCodec, hardware, frames, seconds }.
export async function encodeMP4({ width, height, fps = 30, quality = 'high', audio, draw, onProgress, isCancelled, sink }) {
  const vcfg = await pickVideoConfig(width, height, fps, quality);
  if (!vcfg) throw new Error(`No H.264 encoder for ${width}×${height} @ ${fps} fps in this browser`);
  const ach = Math.min(2, audio.numberOfChannels);
  const acfg = await pickAudioConfig(ach);
  if (!acfg) throw new Error('No AAC or Opus encoder available in this browser');
  sink = sink || new MemorySink();

  const mux = new Mp4Muxer(sink);
  let failure = null;
  const t0 = performance.now();

  // ---- audio (encoded first; its samples sit at the start of mdat)
  const aenc = new AudioEncoder({ output: (c, m) => mux.addAudio(c, m), error: (e) => { failure = e; } });
  aenc.configure(acfg.cfg);
  const sr = audio.sampleRate, total = audio.length, block = 4800;
  const chans = [];
  for (let c = 0; c < ach; c++) chans.push(audio.getChannelData(c));
  let peak = 0;
  for (const d of chans) for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; }
  const gain = peak > 1e-6 ? Math.min(4, 0.89 / peak) : 1;
  for (let i = 0; i < total; i += block) {
    const n = Math.min(block, total - i);
    const buf = new Float32Array(n * ach);
    for (let c = 0; c < ach; c++) {
      const src = chans[c];
      for (let j = 0; j < n; j++) buf[c * n + j] = Math.max(-1, Math.min(1, src[i + j] * gain));
    }
    const ad = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: n, numberOfChannels: ach, timestamp: Math.round(i * 1e6 / sr), data: buf });
    aenc.encode(ad);
    ad.close();
    if (failure) throw failure;
  }
  await aenc.flush();
  aenc.close();

  // ---- video
  const venc = new VideoEncoder({ output: (c, m) => mux.addVideo(c, m), error: (e) => { failure = e; } });
  venc.configure(vcfg);
  const frames = Math.ceil(audio.duration * fps);
  const fdur = Math.round(1e6 / fps);
  const tv = performance.now();
  try {
    for (let i = 0; i < frames; i++) {
      if (isCancelled && isCancelled()) throw new Error('cancelled');
      if (failure) throw failure;
      const out = await draw(i / fps, i);
      const vf = new VideoFrame(out, { timestamp: i * fdur, duration: fdur });
      venc.encode(vf, { keyFrame: i % (fps * 2) === 0 });
      vf.close();
      await waitQueue(venc, 4);
      await sink.flush();
      if (onProgress && (i % 3 === 0 || i === frames - 1)) {
        const el = (performance.now() - tv) / 1000, rate = (i + 1) / Math.max(el, 1e-3);
        onProgress({ frac: (i + 1) / frames, frame: i + 1, frames, fps: rate, eta: (frames - i - 1) / rate });
      }
      await yieldNow();
    }
    await venc.flush();
  } catch (e) {
    try { venc.close(); } catch (e2) { /* closed */ }
    await sink.abort();
    throw e;
  }
  venc.close();
  if (failure) { await sink.abort(); throw failure; }
  const blob = await mux.finalize({ width, height, fps, audio: { sampleRate: sr, channels: ach, codec: acfg.name, bitrate: 192000 } });
  return {
    blob, audioCodec: acfg.name, videoCodec: vcfg.codec, hardware: vcfg.hardwareAcceleration, frames,
    seconds: (performance.now() - t0) / 1000, bitrate: vcfg.bitrate,
  };
}
