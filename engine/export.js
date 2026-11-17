// Ekphrasis — exporters: WAV (16-bit PCM), Standard MIDI File (type 1), recorder mime picking, download.

import { PATCHES } from './instruments.js';

export function encodeWAV(buf) {
  const nch = Math.min(2, buf.numberOfChannels), sr = buf.sampleRate, len = buf.length;
  const chans = [];
  let peak = 0;
  for (let c = 0; c < nch; c++) {
    const d = buf.getChannelData(c);
    chans.push(d);
    for (let i = 0; i < len; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
  }
  const gain = peak > 1e-6 ? Math.min(4, 0.89 / peak) : 1; // normalize to about -1 dBFS
  const bytes = len * nch * 2;
  const dv = new DataView(new ArrayBuffer(44 + bytes));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + bytes, true); str(8, 'WAVE');
  str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, nch, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * nch * 2, true); dv.setUint16(32, nch * 2, true); dv.setUint16(34, 16, true);
  str(36, 'data'); dv.setUint32(40, bytes, true);
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < nch; c++) {
      let s = chans[c][i] * gain;
      s = s > 1 ? 1 : s < -1 ? -1 : s;
      dv.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([dv.buffer], { type: 'audio/wav' });
}

const ROLES = [['lead', 0, 'Lead'], ['arp', 1, 'Arp'], ['chords', 2, 'Chords'], ['bass', 3, 'Bass'], ['atmos', 4, 'Atmosphere'], ['drums', 9, 'Drums']];

function vlq(out, v) {
  v = Math.max(0, Math.round(v));
  const stack = [v & 0x7f];
  while ((v >>= 7) > 0) stack.push((v & 0x7f) | 0x80);
  while (stack.length) out.push(stack.pop());
}

function textBytes(s) { return Array.from(new TextEncoder().encode(s)); }

function serialize(list) {
  list.sort((a, b) => a.tick - b.tick || a.ord - b.ord);
  const out = [];
  let last = 0;
  for (const e of list) { vlq(out, e.tick - last); last = e.tick; out.push(...e.bytes); }
  out.push(0x00, 0xff, 0x2f, 0x00);
  return out;
}

function meta(type, data) { const out = [0xff, type]; vlq(out, data.length); return out.concat(data); }

export function buildMIDI(events, tempo, voices) {
  const PPQ = 480, tps = PPQ * tempo / 60;
  const tracks = [];
  const us = Math.round(60e6 / tempo);
  tracks.push(serialize([
    { tick: 0, ord: 0, bytes: meta(0x03, textBytes('Ekphrasis')) },
    { tick: 0, ord: 1, bytes: meta(0x51, [(us >> 16) & 255, (us >> 8) & 255, us & 255]) },
    { tick: 0, ord: 2, bytes: meta(0x58, [4, 2, 24, 8]) },
  ]));

  for (const [v, ch, roleName] of ROLES) {
    const vs = voices && voices[v];
    if (vs && !vs.on) continue;
    const patch = v === 'drums' ? null : PATCHES[vs ? vs.inst : ''];
    if (v !== 'drums' && (!patch || patch.gm < 0)) continue;
    const evs = events.filter((e) => e.voice === v);
    if (!evs.length) continue;
    const prog = patch ? patch.gm : -1;
    const name = patch ? `${roleName} - ${patch.label}` : roleName;
    const list = [{ tick: 0, ord: 0, bytes: meta(0x03, textBytes(name)) }];
    if (prog >= 0) list.push({ tick: 0, ord: 1, bytes: [0xc0 | ch, prog] });
    // Truncate overlapping notes of the same pitch so note-offs never cut a later note.
    const byPitch = new Map();
    for (const e of evs) {
      const s = Math.round(e.t * tps), en = Math.round((e.t + e.dur) * tps);
      if (!byPitch.has(e.midi)) byPitch.set(e.midi, []);
      byPitch.get(e.midi).push({ s, en, vel: Math.max(1, Math.min(127, Math.round(e.vel * 127))) });
    }
    for (const [pitch, notes] of byPitch) {
      notes.sort((a, b) => a.s - b.s);
      for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        let en = n.en;
        if (i + 1 < notes.length) en = Math.min(en, notes[i + 1].s);
        if (i > 0 && n.s === notes[i - 1].s) continue; // duplicate onset
        if (en <= n.s) en = n.s + 1;
        list.push({ tick: n.s, ord: 3, bytes: [0x90 | ch, pitch & 127, n.vel] });
        list.push({ tick: en, ord: 2, bytes: [0x80 | ch, pitch & 127, 0] });
      }
    }
    tracks.push(serialize(list));
  }

  const out = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, (tracks.length >> 8) & 255, tracks.length & 255, (PPQ >> 8) & 255, PPQ & 255];
  for (const t of tracks) {
    out.push(0x4d, 0x54, 0x72, 0x6b, (t.length >>> 24) & 255, (t.length >>> 16) & 255, (t.length >>> 8) & 255, t.length & 255);
    for (let i = 0; i < t.length; i++) out.push(t[i]);
  }
  return new Blob([new Uint8Array(out)], { type: 'audio/midi' });
}

export function pickVideoMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  const list = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1,opus', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  for (const m of list) if (MediaRecorder.isTypeSupported(m)) return m;
  return '';
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
