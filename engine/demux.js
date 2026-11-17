// Ekphrasis — minimal video demuxers (no dependencies) + a WebCodecs frame source for offline rendering.
//
// demuxVideo(blob) → { codec, description, codedWidth, codedHeight, rotation, samples[], reader } or null
//   MP4 / MOV / M4V: progressive (moov sample tables) and fragmented (moof/traf/trun) files, edit-list offset.
//   WebM / MKV: EBML, SimpleBlock and BlockGroup, unknown-size Segment/Cluster (MediaRecorder output).
//   Codecs: H.264 (avcC), HEVC (hvcC), VP8, VP9 (vpcC), AV1 (av1C).
// samples are in decode order: { off, size, pts (seconds, presentation), dur, key }.
//
// DecodedVideo decodes sequentially with VideoDecoder (hardware where available) and hands out frames for an
// output time t as a canvas in display orientation. Backward requests reset to the previous keyframe.

// ------------------------------------------------------------------ blob reader with a sliding window
class BlobReader {
  constructor(blob) { this.blob = blob; this.size = blob.size; this.start = 0; this.buf = null; }
  async read(off, len) {
    if (this.buf && off >= this.start && off + len <= this.start + this.buf.byteLength) return new Uint8Array(this.buf, off - this.start, len);
    const end = Math.min(this.size, off + Math.max(len, 8 << 20));
    this.buf = await this.blob.slice(off, end).arrayBuffer();
    this.start = off;
    return new Uint8Array(this.buf, 0, Math.min(len, end - off));
  }
}

const u16 = (b, o) => (b[o] << 8) | b[o + 1];
const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const i32 = (b, o) => (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
const u64 = (b, o) => u32(b, o) * 4294967296 + u32(b, o + 4);
const i64 = (b, o) => i32(b, o) * 4294967296 + u32(b, o + 4);
const fourcc = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
const hex2 = (n) => n.toString(16).padStart(2, '0');
const pad2 = (n) => String(n).padStart(2, '0');

// ------------------------------------------------------------------ codec strings
function avcCodec(avcC) { return `avc1.${hex2(avcC[1])}${hex2(avcC[2])}${hex2(avcC[3])}`; }

function hevcCodec(h, fourCC = 'hvc1') {
  const space = h[1] >> 6, tier = (h[1] >> 5) & 1, idc = h[1] & 31;
  let compat = u32(h, 2), rev = 0;
  for (let i = 0; i < 32; i++) { rev = (rev << 1) | (compat & 1); compat >>>= 1; }
  const cons = Array.from(h.slice(6, 12));
  while (cons.length && cons[cons.length - 1] === 0) cons.pop();
  return `${fourCC}.${['', 'A', 'B', 'C'][space]}${idc}.${(rev >>> 0).toString(16)}.${tier ? 'H' : 'L'}${h[12]}${cons.length ? '.' + cons.map((c) => c.toString(16)).join('.') : ''}`;
}

function av1Codec(c) {
  const profile = c[1] >> 5, level = c[1] & 31, tier = c[2] >> 7, high = (c[2] >> 6) & 1, twelve = (c[2] >> 5) & 1;
  return `av01.${profile}.${pad2(level)}${tier ? 'H' : 'M'}.${pad2(twelve ? 12 : high ? 10 : 8)}`;
}

function vp9Codec(vpcC) {
  // vpcC is a FullBox: version/flags (4) then profile, level, bitDepth(4)|chroma(3)|range(1)
  return `vp09.${pad2(vpcC[4])}.${pad2(vpcC[5])}.${pad2(vpcC[6] >> 4)}`;
}

// ------------------------------------------------------------------ MP4
function children(b, start, end) {
  const out = [];
  let o = start;
  while (o + 8 <= end) {
    let size = u32(b, o), hdr = 8;
    const type = fourcc(b, o + 4);
    if (size === 1) { size = u64(b, o + 8); hdr = 16; } else if (size === 0) size = end - o;
    if (size < hdr || o + size > end) break;
    out.push({ type, start: o + hdr, end: o + size });
    o += size;
  }
  return out;
}
const find = (b, box, path) => {
  let cur = box;
  for (const t of path) { cur = children(b, cur.start, cur.end).find((c) => c.type === t); if (!cur) return null; }
  return cur;
};

function rotationFromMatrix(b, o) {
  const a = i32(b, o) / 65536, bb = i32(b, o + 4) / 65536;
  const deg = Math.round(Math.atan2(bb, a) * 180 / Math.PI);
  return ((deg % 360) + 360) % 360;
}

function sampleEntry(b, stsd) {
  const entry = { start: stsd.start + 8, end: stsd.end };
  const e = children(b, entry.start, entry.end)[0];
  if (!e) return null;
  const w = u16(b, e.start + 24), h = u16(b, e.start + 26);
  const kids = children(b, e.start + 78, e.end);
  const get = (t) => { const k = kids.find((c) => c.type === t); return k ? b.slice(k.start, k.end) : null; };
  let codec = null, description;
  switch (e.type) {
    case 'avc1': case 'avc3': { const d = get('avcC'); if (d) { codec = avcCodec(d); description = d; } break; }
    case 'hvc1': case 'hev1': { const d = get('hvcC'); if (d) { codec = hevcCodec(d, e.type); description = d; } break; }
    case 'vp09': { const d = get('vpcC'); codec = d ? vp9Codec(d) : 'vp09.00.10.08'; break; }
    case 'vp08': codec = 'vp8'; break;
    case 'av01': { const d = get('av1C'); if (d) { codec = av1Codec(d); description = d; } break; }
  }
  return codec ? { codec, description, codedWidth: w, codedHeight: h } : null;
}

function parseTrak(b, trak) {
  const hd = find(b, trak, ['mdia', 'hdlr']);
  if (!hd || fourcc(b, hd.start + 8) !== 'vide') return null;
  const tk = find(b, trak, ['tkhd']);
  const tkv = b[tk.start];
  const trackId = u32(b, tk.start + (tkv === 1 ? 20 : 12));
  const rotation = rotationFromMatrix(b, tk.start + (tkv === 1 ? 52 : 40));
  const md = find(b, trak, ['mdia', 'mdhd']);
  const mdv = b[md.start];
  const timescale = u32(b, md.start + (mdv === 1 ? 20 : 12));
  let mediaTime = 0;
  const el = find(b, trak, ['edts', 'elst']);
  if (el) {
    const v = b[el.start], n = u32(b, el.start + 4);
    let o = el.start + 8;
    for (let i = 0; i < n; i++) {
      const mt = v === 1 ? i64(b, o + 8) : i32(b, o + 4);
      if (mt !== -1) { mediaTime = mt; break; }
      o += v === 1 ? 20 : 12;
    }
  }
  const stbl = find(b, trak, ['mdia', 'minf', 'stbl']);
  const kid = (t) => children(b, stbl.start, stbl.end).find((c) => c.type === t);
  const cfg = sampleEntry(b, kid('stsd'));
  if (!cfg) return { unsupported: true };
  // sizes
  const stsz = kid('stsz'), fixed = u32(b, stsz.start + 4), count = u32(b, stsz.start + 8);
  const sizes = new Array(count);
  for (let i = 0; i < count; i++) sizes[i] = fixed || u32(b, stsz.start + 12 + i * 4);
  // offsets via stsc + stco/co64
  const co = kid('stco') || kid('co64'), big = co && co.type === 'co64';
  const nch = co ? u32(b, co.start + 4) : 0;
  const chunkOff = (i) => (big ? u64(b, co.start + 8 + i * 8) : u32(b, co.start + 8 + i * 4));
  const stsc = kid('stsc'), nsc = u32(b, stsc.start + 4);
  const sc = [];
  for (let i = 0; i < nsc; i++) sc.push([u32(b, stsc.start + 8 + i * 12) - 1, u32(b, stsc.start + 12 + i * 12)]);
  const offs = new Array(count);
  let s = 0;
  for (let e = 0; e < sc.length && s < count; e++) {
    const [first, per] = sc[e], next = e + 1 < sc.length ? sc[e + 1][0] : nch;
    for (let c = first; c < next && s < count; c++) {
      let o = chunkOff(c);
      for (let k = 0; k < per && s < count; k++) { offs[s] = o; o += sizes[s]; s++; }
    }
  }
  // timing
  const dts = new Array(count), durs = new Array(count);
  const stts = kid('stts'), nst = u32(b, stts.start + 4);
  let t = 0; s = 0;
  for (let i = 0; i < nst; i++) {
    const n = u32(b, stts.start + 8 + i * 8), d = u32(b, stts.start + 12 + i * 8);
    for (let k = 0; k < n && s < count; k++) { dts[s] = t; durs[s] = d; t += d; s++; }
  }
  const cto = new Array(count).fill(0), ctts = kid('ctts');
  if (ctts) {
    const v = b[ctts.start], n = u32(b, ctts.start + 4);
    s = 0;
    for (let i = 0; i < n; i++) {
      const c = u32(b, ctts.start + 8 + i * 8), o = v === 1 ? i32(b, ctts.start + 12 + i * 8) : u32(b, ctts.start + 12 + i * 8);
      for (let k = 0; k < c && s < count; k++) cto[s++] = o;
    }
  }
  const stss = kid('stss');
  let keys = null;
  if (stss) { keys = new Set(); const n = u32(b, stss.start + 4); for (let i = 0; i < n; i++) keys.add(u32(b, stss.start + 8 + i * 4) - 1); }
  const samples = [];
  for (let i = 0; i < count; i++) {
    samples.push({ off: offs[i], size: sizes[i], pts: (dts[i] + cto[i] - mediaTime) / timescale, dur: durs[i] / timescale, key: keys ? keys.has(i) : true });
  }
  return { ...cfg, rotation, trackId, timescale, mediaTime, samples };
}

async function demuxMp4(r) {
  const top = [];
  let off = 0;
  while (off + 8 <= r.size) {
    const h = await r.read(off, Math.min(16, r.size - off));
    let size = u32(h, 0), hdr = 8;
    const type = fourcc(h, 4);
    if (size === 1) { size = u64(h, 8); hdr = 16; } else if (size === 0) size = r.size - off;
    if (size < 8) break;
    top.push({ type, off, size, hdr });
    off += size;
  }
  const mb = top.find((b) => b.type === 'moov');
  if (!mb) return null;
  const moov = (await r.read(mb.off, mb.size)).slice();
  const root = { start: mb.hdr, end: mb.size };
  let track = null;
  for (const trak of children(moov, root.start, root.end).filter((c) => c.type === 'trak')) {
    track = parseTrak(moov, trak);
    if (track) break;
  }
  if (!track || track.unsupported) return track && track.unsupported ? { unsupported: true } : null;
  // Fragmented MP4: samples live in moof/traf/trun.
  if (!track.samples.length && top.some((b) => b.type === 'moof')) {
    let defDur = 0, defSize = 0, defFlags = 0;
    const trex = children(moov, root.start, root.end).filter((c) => c.type === 'mvex').flatMap((mv) => children(moov, mv.start, mv.end)).find((c) => c.type === 'trex' && u32(moov, c.start + 4) === track.trackId);
    if (trex) { defDur = u32(moov, trex.start + 12); defSize = u32(moov, trex.start + 16); defFlags = u32(moov, trex.start + 20); }
    for (const mf of top.filter((b) => b.type === 'moof')) {
      const m = (await r.read(mf.off, mf.size)).slice();
      for (const traf of children(m, mf.hdr, mf.size).filter((c) => c.type === 'traf')) {
        const kids = children(m, traf.start, traf.end);
        const tfhd = kids.find((c) => c.type === 'tfhd');
        if (!tfhd || u32(m, tfhd.start + 4) !== track.trackId) continue;
        const tf = u32(m, tfhd.start) & 0xffffff;
        let p = tfhd.start + 8, base = mf.off;
        if (tf & 1) { base = u64(m, p); p += 8; }
        if (tf & 2) p += 4;
        let dDur = defDur, dSize = defSize, dFlags = defFlags;
        if (tf & 8) { dDur = u32(m, p); p += 4; }
        if (tf & 0x10) { dSize = u32(m, p); p += 4; }
        if (tf & 0x20) { dFlags = u32(m, p); p += 4; }
        const tfdt = kids.find((c) => c.type === 'tfdt');
        let dts = tfdt ? (m[tfdt.start] === 1 ? u64(m, tfdt.start + 4) : u32(m, tfdt.start + 4)) : 0;
        for (const trun of kids.filter((c) => c.type === 'trun')) {
          const v = m[trun.start], fl = u32(m, trun.start) & 0xffffff, n = u32(m, trun.start + 4);
          let q = trun.start + 8, dataOff = base;
          if (fl & 1) { dataOff = base + i32(m, q); q += 4; }
          let firstFlags = null;
          if (fl & 4) { firstFlags = u32(m, q); q += 4; }
          for (let i = 0; i < n; i++) {
            const dur = fl & 0x100 ? u32(m, (q += 4) - 4) : dDur;
            const size = fl & 0x200 ? u32(m, (q += 4) - 4) : dSize;
            let flags = fl & 0x400 ? u32(m, (q += 4) - 4) : dFlags;
            if (i === 0 && firstFlags != null) flags = firstFlags;
            const c = fl & 0x800 ? (v === 1 ? i32(m, (q += 4) - 4) : u32(m, (q += 4) - 4)) : 0;
            track.samples.push({ off: dataOff, size, pts: (dts + c - track.mediaTime) / track.timescale, dur: dur / track.timescale, key: !((flags >> 16) & 1) });
            dataOff += size; dts += dur;
          }
        }
      }
    }
  }
  return track.samples.length ? track : null;
}

// ------------------------------------------------------------------ WebM / Matroska
const ID = { EBML: 0x1a45dfa3, Segment: 0x18538067, Info: 0x1549a966, TimecodeScale: 0x2ad7b1, Tracks: 0x1654ae6b, TrackEntry: 0xae,
  TrackNumber: 0xd7, TrackType: 0x83, CodecID: 0x86, CodecPrivate: 0x63a2, Video: 0xe0, PixelWidth: 0xb0, PixelHeight: 0xba,
  Cluster: 0x1f43b675, Timecode: 0xe7, SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1, ReferenceBlock: 0xfb };
const TOP_LEVEL = new Set([0x1f43b675, 0x1c53bb6b, 0x1654ae6b, 0x1549a966, 0x114d9b74, 0x1254c367, 0x1941a469, 0x1043a770]);

function vint(b, o, keepMarker) {
  const first = b[o];
  let len = 1, mask = 0x80;
  while (len <= 8 && !(first & mask)) { len++; mask >>= 1; }
  if (len > 8) return null;
  let v = keepMarker ? first : first & (mask - 1), allOnes = (first & (mask - 1)) === mask - 1;
  for (let i = 1; i < len; i++) { v = v * 256 + b[o + i]; if (b[o + i] !== 255) allOnes = false; }
  return { v, len, unknown: !keepMarker && allOnes };
}

async function demuxWebm(r) {
  const head = await r.read(0, Math.min(r.size, 64));
  if (u32(head, 0) !== ID.EBML) return null;
  let timecodeScale = 1e6;
  let track = null;
  const samples = [];
  const readHeader = async (o) => {
    const b = await r.read(o, Math.min(12, r.size - o));
    const id = vint(b, 0, true); if (!id) return null;
    const sz = vint(b, id.len, false); if (!sz) return null;
    return { id: id.v, dataStart: o + id.len + sz.len, size: sz.unknown ? Infinity : sz.v };
  };
  const readUint = (b) => { let v = 0; for (const x of b) v = v * 256 + x; return v; };
  const parseTracks = (b) => {
    let o = 0;
    while (o < b.length) {
      const id = vint(b, o, true), sz = vint(b, o + id.len, false), ds = o + id.len + sz.len;
      if (id.v === ID.TrackEntry) {
        const e = { number: 0, type: 0, codecId: '', priv: null, w: 0, h: 0 };
        let p = ds;
        while (p < ds + sz.v) {
          const i2 = vint(b, p, true), s2 = vint(b, p + i2.len, false), d2 = p + i2.len + s2.len, body = b.subarray(d2, d2 + s2.v);
          if (i2.v === ID.TrackNumber) e.number = readUint(body);
          else if (i2.v === ID.TrackType) e.type = readUint(body);
          else if (i2.v === ID.CodecID) e.codecId = String.fromCharCode(...body);
          else if (i2.v === ID.CodecPrivate) e.priv = body.slice();
          else if (i2.v === ID.Video) {
            let q = d2;
            while (q < d2 + s2.v) {
              const i3 = vint(b, q, true), s3 = vint(b, q + i3.len, false), d3 = q + i3.len + s3.len;
              if (i3.v === ID.PixelWidth) e.w = readUint(b.subarray(d3, d3 + s3.v));
              if (i3.v === ID.PixelHeight) e.h = readUint(b.subarray(d3, d3 + s3.v));
              q = d3 + s3.v;
            }
          }
          p = d2 + s2.v;
        }
        if (e.type === 1 && !track) track = e;
      }
      o = ds + sz.v;
    }
  };
  const blockHeader = async (o, size, key, clusterTc) => {
    const b = await r.read(o, Math.min(16, size));
    const tn = vint(b, 0, false);
    if (!track || tn.v !== track.number) return;
    const rel = (b[tn.len] << 24 >> 16) | b[tn.len + 1];
    const flags = b[tn.len + 2];
    if (flags & 0x06) return; // laced video blocks are not produced by real encoders; skip safely
    const hdr = tn.len + 3;
    samples.push({ off: o + hdr, size: size - hdr, pts: ((clusterTc + rel) * timecodeScale) / 1e9, dur: 0, key: key ?? !!(flags & 0x80) });
  };

  const ebml = await readHeader(0);
  let o = ebml.dataStart + ebml.size;
  const seg = await readHeader(o);
  if (!seg || seg.id !== ID.Segment) return null;
  const segEnd = seg.size === Infinity ? r.size : Math.min(r.size, seg.dataStart + seg.size);
  o = seg.dataStart;
  while (o < segEnd) {
    const el = await readHeader(o);
    if (!el) break;
    if (el.id === ID.Info) {
      const b = await r.read(el.dataStart, el.size);
      let p = 0;
      while (p < b.length) { const i = vint(b, p, true), s = vint(b, p + i.len, false), d = p + i.len + s.len; if (i.v === ID.TimecodeScale) timecodeScale = readUint(b.subarray(d, d + s.v)); p = d + s.v; }
      o = el.dataStart + el.size;
    } else if (el.id === ID.Tracks) {
      parseTracks((await r.read(el.dataStart, el.size)).slice());
      o = el.dataStart + el.size;
    } else if (el.id === ID.Cluster) {
      const cEnd = el.size === Infinity ? segEnd : el.dataStart + el.size;
      let p = el.dataStart, tc = 0;
      while (p < cEnd) {
        const c = await readHeader(p);
        if (!c) { p = cEnd; break; }
        if (el.size === Infinity && TOP_LEVEL.has(c.id)) break; // next cluster/top-level element ends an unknown-size cluster
        if (c.id === ID.Timecode) tc = readUint(await r.read(c.dataStart, c.size));
        else if (c.id === ID.SimpleBlock) await blockHeader(c.dataStart, c.size, null, tc);
        else if (c.id === ID.BlockGroup) {
          let q = c.dataStart, blk = null, ref = false;
          while (q < c.dataStart + c.size) {
            const g = await readHeader(q);
            if (g.id === ID.Block) blk = g;
            if (g.id === ID.ReferenceBlock) ref = true;
            q = g.dataStart + g.size;
          }
          if (blk) await blockHeader(blk.dataStart, blk.size, !ref, tc);
        }
        if (c.size === Infinity) { p = cEnd; break; }
        p = c.dataStart + c.size;
      }
      o = p;
    } else {
      if (el.size === Infinity) break;
      o = el.dataStart + el.size;
    }
  }
  if (!track || !samples.length) return null;
  let codec = null, description;
  const pv = track.priv;
  switch (track.codecId) {
    case 'V_VP8': codec = 'vp8'; break;
    case 'V_VP9': codec = 'vp09.00.10.08'; break;
    case 'V_AV1': if (pv && pv.length >= 4) { codec = av1Codec(pv); description = pv; } else codec = 'av01.0.08M.08'; break;
    case 'V_MPEG4/ISO/AVC': if (pv) { codec = avcCodec(pv); description = pv; } break;
    case 'V_MPEGH/ISO/HEVC': if (pv) { codec = hevcCodec(pv); description = pv; } break;
  }
  if (!codec) return { unsupported: true };
  // Durations from successive presentation times (blocks carry none).
  const byPts = samples.map((s, i) => [s.pts, i]).sort((a, b) => a[0] - b[0]);
  for (let k = 0; k < byPts.length; k++) {
    const nx = byPts[k + 1];
    samples[byPts[k][1]].dur = nx ? Math.max(0, nx[0] - byPts[k][0]) : (k ? samples[byPts[k - 1][1]].dur : 1 / 30);
  }
  return { codec, description, codedWidth: track.w, codedHeight: track.h, rotation: 0, samples };
}

export async function demuxVideo(blob) {
  const r = new BlobReader(blob);
  let t = null;
  try { t = await demuxWebm(r); } catch (e) { t = null; }
  if (!t) { try { t = await demuxMp4(r); } catch (e) { t = null; } }
  if (!t || t.unsupported) return null;
  t.reader = r;
  return t;
}

// ------------------------------------------------------------------ decoded frame source
export class DecodedVideo {
  // Returns null when the file can't be demuxed or the codec isn't decodable here (caller falls back).
  static async open(blob, displayW, displayH) {
    if (typeof VideoDecoder === 'undefined' || !blob) return null;
    const t = await demuxVideo(blob);
    if (!t) return null;
    const cfg = { codec: t.codec, codedWidth: t.codedWidth, codedHeight: t.codedHeight, optimizeForLatency: false };
    if (t.description) cfg.description = t.description;
    let ok = null;
    for (const hw of ['prefer-hardware', 'no-preference']) {
      try { const s = await VideoDecoder.isConfigSupported({ ...cfg, hardwareAcceleration: hw }); if (s.supported) { ok = { ...cfg, hardwareAcceleration: hw }; break; } } catch (e) { /* next */ }
    }
    if (!ok) return null;
    return new DecodedVideo(t, ok, displayW, displayH);
  }

  constructor(track, cfg, displayW, displayH) {
    this.t = track; this.cfg = cfg; this.samples = track.samples;
    this.w = displayW; this.h = displayH;
    this.canvas = document.createElement('canvas');
    this.canvas.width = displayW; this.canvas.height = displayH;
    this.ctx = this.canvas.getContext('2d');
    this.frames = []; this.shown = null; this.err = null;
    this.decoded = 0; this.resets = 0; this.endIssue = null;
    this.lastTu = -Infinity;
    // Presentation time of the final frame: once it is on screen, later requests never touch the decoder again.
    this.endTu = Math.round(this.samples.reduce((m, s) => Math.max(m, s.pts), 0) * 1e6);
    this._wake = null;
    this.dec = new VideoDecoder({
      output: (f) => { this.frames.push(f); this.decoded++; this._prune(); this._notify(); },
      // An error after every sample has been submitted only loses the tail; earlier errors are real failures.
      error: (e) => { if (this.next >= this.samples.length) { this.endIssue = String(e && e.message || e); this.done = true; } else this.err = e; this._notify(); },
    });
    this._start(0);
  }

  get codec() { return this.cfg.codec; }
  get hardware() { return this.cfg.hardwareAcceleration === 'prefer-hardware'; }

  _notify() { if (this._wake) { const w = this._wake; this._wake = null; w(); } }

  // Hardware decoders have small output-frame pools and stall (flush never resolves) if frames are held.
  // Release every frame that can no longer be shown: all but the newest one at or before the last requested time.
  _prune() {
    this.frames.sort((a, b) => a.timestamp - b.timestamp);
    while (this.frames.length >= 2 && this.frames[1].timestamp <= this.lastTu) this.frames.shift().close();
  }

  _start(index) {
    if (this.dec.state === 'configured') this.dec.reset();
    if (this.dec.state !== 'closed') this.dec.configure(this.cfg);
    for (const f of this.frames) f.close();
    this.frames = [];
    this.next = index; this.flushed = false; this.done = false;
  }

  // Keyframe at or before presentation time t, in decode order.
  _keyBefore(t) {
    let best = 0;
    for (let i = 0; i < this.samples.length; i++) if (this.samples[i].key && this.samples[i].pts <= t + 1e-6) best = i;
    return best;
  }

  async _pump() {
    if (this.err) throw this.err;
    if (this.next < this.samples.length) {
      // Keep at most ~4 frames in flight (queued + decoded-but-unshown) so the decoder's pool never runs dry.
      while (this.dec.decodeQueueSize < 4 && this.frames.length < 4 && this.next < this.samples.length) {
        const s = this.samples[this.next++];
        const data = await this.t.reader.read(s.off, s.size);
        this.dec.decode(new EncodedVideoChunk({ type: s.key ? 'key' : 'delta', timestamp: Math.round(s.pts * 1e6), duration: Math.round(s.dur * 1e6), data }));
      }
      // Wait for an output frame or for the decoder to consume input (events, so not throttled in background tabs).
      // The timer is only a stall guard.
      await new Promise((res) => {
        this._wake = res;
        const done = () => { if (this._wake === res) { this._wake = null; res(); } };
        if (this.dec.decodeQueueSize > 0) {
          if ('ondequeue' in this.dec) this.dec.addEventListener('dequeue', done, { once: true });
          setTimeout(done, 250);
        } else {
          const ch = new MessageChannel(); ch.port1.onmessage = done; ch.port2.postMessage(0);
        }
      });
    } else if (!this.flushed) {
      // End of stream: start the flush but don't block on it. The reordered tail frames arrive while frameAt keeps
      // consuming (and closing) frames, so a decoder with a small output pool can always finish.
      this.flushed = true;
      this._flushT0 = performance.now();
      this.dec.flush().then(
        () => { this.done = true; this._notify(); },
        (e) => { this.endIssue = String(e && e.message || e); this.done = true; this._notify(); },
      );
    } else if (!this.done) {
      const before = this.decoded;
      await new Promise((res) => {
        this._wake = res;
        setTimeout(() => { if (this._wake === res) { this._wake = null; res(); } }, 250);
      });
      // Stall guard: no output for 3 s after the flush started → finish with the frames we have.
      if (this.decoded !== before) this._flushT0 = performance.now();
      else if (!this.done && performance.now() - this._flushT0 > 3000) { this.endIssue = 'decoder flush stalled'; this.done = true; }
    }
  }

  // Draw the latest frame with presentation time ≤ t into this.canvas (display orientation) and return it.
  // Requests past the end of the video hold the final frame.
  async frameAt(t) {
    const tu = Math.min(Math.round(t * 1e6), this.endTu);
    if (this.shown && tu < this.shown.timestamp - 1) {
      // backward: restart from the keyframe before t
      this.resets++;
      this.shown.close(); this.shown = null;
      this._start(this._keyBefore(t));
    }
    this.lastTu = tu;
    if (this.shown && this.shown.timestamp >= this.endTu - 1) return this.canvas; // final frame already shown
    for (;;) {
      this._prune();
      if (this.frames.some((f) => f.timestamp > tu || f.timestamp >= this.endTu - 1) || this.done) break;
      await this._pump();
    }
    let pick = null;
    while (this.frames.length && this.frames[0].timestamp <= tu) {
      if (pick) pick.close();
      pick = this.frames.shift();
    }
    if (pick) {
      if (this.shown) this.shown.close();
      this.shown = pick;
      this._draw(pick);
    } else if (!this.shown && this.frames.length) {
      // t before the first presented frame: show the first one
      this.shown = this.frames.shift();
      this._draw(this.shown);
    }
    return this.canvas;
  }

  _draw(f) {
    const c = this.ctx, W = this.w, H = this.h, rot = this.t.rotation;
    c.save();
    c.translate(W / 2, H / 2);
    c.rotate((rot * Math.PI) / 180);
    const sw = rot % 180 ? H : W, sh = rot % 180 ? W : H;
    c.drawImage(f, -sw / 2, -sh / 2, sw, sh);
    c.restore();
  }

  close() {
    try { if (this.dec.state !== 'closed') this.dec.close(); } catch (e) { /* closed */ }
    for (const f of this.frames) f.close();
    this.frames = [];
    if (this.shown) { this.shown.close(); this.shown = null; }
  }
}
