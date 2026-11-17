// Ekphrasis — sequential video frame access for offline rendering.
//
// Seeking a <video> per output frame forces the decoder to restart from the previous keyframe every time
// (O(GOP) decodes per frame). For monotonic access we instead let the element *play* and pause it once the
// presented frame reaches the target time, using requestVideoFrameCallback to know exactly which frame is up.
// Backward jumps, large forward jumps, hidden tabs (where video playback and rVFC are suspended) and browsers
// without rVFC fall back to seeking.

export function seekTo(v, t) {
  return new Promise((res) => {
    const done = () => { v.removeEventListener('seeked', done); clearTimeout(to); res(); };
    const to = setTimeout(done, 3000);
    v.addEventListener('seeked', done);
    v.currentTime = t;
  });
}

// MediaRecorder WebM files carry no duration (the element reports Infinity). Seeking far past the end makes the
// browser scan the file and publish the real duration.
export async function resolveDuration(v) {
  if (isFinite(v.duration) && v.duration > 0) return v.duration;
  await new Promise((res) => {
    const done = () => { if (isFinite(v.duration)) { v.removeEventListener('durationchange', done); clearTimeout(to); res(); } };
    const to = setTimeout(() => { v.removeEventListener('durationchange', done); res(); }, 5000);
    v.addEventListener('durationchange', done);
    v.currentTime = 1e101;
  });
  await seekTo(v, 0);
  return v.duration;
}

export class VideoStepper {
  // rate: playback rate while stepping. Measured on 1080p H.264 (GOP 60): rate 1 ≈ 28–34 ms/frame with ≤1 frame
  // error; rate 2 ≈ 17 ms/frame with ≤2 frames error; seeking per frame ≈ 100–160 ms/frame. Rates above 2 stall.
  constructor(video, { rate = 1 } = {}) {
    this.v = video;
    this.rate = rate;
    this.cur = -1;         // media time of the frame currently presented
    this.fd = 1 / 30;      // estimated source frame duration (refined while stepping)
    this.hasRVFC = typeof video.requestVideoFrameCallback === 'function';
    this.seeks = 0; this.steps = 0;
  }

  async start(t = 0) {
    const v = this.v;
    v.pause();
    v.playbackRate = this.rate;
    await seekTo(v, t);
    this.cur = v.currentTime;
    this.seeks++;
  }

  // Make the presented frame the latest source frame with media time ≤ t (within half a source frame).
  async frameAt(t) {
    const v = this.v, D = v.duration;
    t = Math.max(0, Math.min(t, (isFinite(D) ? D : t) - 0.001));
    // Sample-and-hold: the presented frame is valid for t within [cur − 1.5 frames, cur + ½ frame). The lower slack
    // absorbs the frame or two the element plays on after pause(), which would otherwise force a backward seek.
    if (this.cur >= 0 && t >= this.cur - this.fd * 1.5 && t < this.cur + this.fd * 0.5) return;
    const sequential = this.hasRVFC && !document.hidden && this.cur >= 0 && t > this.cur && t - this.cur < 1.5;
    if (!sequential) {
      await seekTo(v, t);
      this.cur = v.currentTime;
      this.seeks++;
      return;
    }
    const target = t - this.fd * 0.5;
    v.playbackRate = this.rate;
    for (let guard = 0; guard < 600; guard++) {
      const mt = await new Promise((res) => {
        let settled = false;
        const finish = (x) => { if (!settled) { settled = true; clearTimeout(to); res(x); } };
        const to = setTimeout(() => finish(null), 700);
        v.requestVideoFrameCallback((now, md) => finish(md.mediaTime));
        if (v.paused) v.play().catch(() => finish(null));
      });
      if (mt == null || v.ended) {           // stalled / ended / hidden: fall back to an exact seek
        v.pause();
        await seekTo(v, t);
        this.cur = v.currentTime;
        this.seeks++;
        return;
      }
      if (this.cur >= 0 && mt > this.cur) this.fd = Math.min(0.1, Math.max(1 / 120, 0.8 * this.fd + 0.2 * (mt - this.cur) / Math.max(1, Math.round((mt - this.cur) / this.fd))));
      this.steps++;
      if (mt >= target) {
        v.pause();
        // pause() lands a little after the callback: trust the element's real position, not the callback's.
        this.cur = Math.max(mt, v.currentTime);
        return;
      }
      this.cur = mt;
    }
    v.pause();
    await seekTo(v, t);
    this.cur = v.currentTime;
  }

  async stop() { this.v.pause(); this.v.playbackRate = 1; }
}
