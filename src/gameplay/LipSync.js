// Lip sync from the voice lines themselves. When a line starts, its decoded audio is read once
// into a mouth track at 60 frames a second: how far the jaw opens (the voice's loudness, on a
// curve, so a whisper parts the lips and a shout drops the jaw), snapping shut on the short
// silences between syllables (m, b, p and the stops), held a little narrower on bright,
// hissing sounds (s, sh, ee: the energy high in the spectrum, by zero crossings). Played back
// against the audio clock, so the mouth stays on the sound however the frames fall.
//
// Who is speaking comes with the line (Story, Missions); any face that can (a Rocketbox crowd
// actor's jaw, an Asura's) asks mouth(name) every frame.
//
// (Rhubarb Lip Sync would give named mouth shapes, but its macOS build is x86-only and this Mac
// has no Rosetta; the faces here have a jaw and lips, not shape keys, so loudness and brightness
// carry nearly all of it.)

const FPS = 60;

export class LipSync {
  constructor(audio) {
    this.audio = audio;
    this.cache = new WeakMap();
    this.cur = null; // { track, t0, who }
    this.who = null;
  }

  /** The analysed track for a buffer: { open: Float32Array, narrow: Float32Array, n }. */
  analyse(buf) {
    const hit = this.cache.get(buf);
    if (hit) return hit;
    const d = buf.getChannelData(0);
    const sr = buf.sampleRate;
    const hop = Math.round(sr / FPS);
    const win = hop * 2;
    const n = Math.ceil(d.length / hop);
    const rms = new Float32Array(n);
    const zcr = new Float32Array(n);
    for (let f = 0; f < n; f++) {
      const a = f * hop;
      const b = Math.min(d.length, a + win);
      let s = 0;
      let z = 0;
      for (let i = a; i < b; i++) {
        s += d[i] * d[i];
        if (i > a && d[i] >= 0 !== d[i - 1] >= 0) z++;
      }
      const L = Math.max(1, b - a);
      rms[f] = Math.sqrt(s / L);
      zcr[f] = z / L;
    }
    // loud: the 95th percentile of the voiced frames (each line levelled to its own voice)
    const sorted = Array.from(rms).sort((x, y) => x - y);
    const loud = Math.max(1e-4, sorted[Math.floor(sorted.length * 0.95)]);
    const floor = sorted[Math.floor(sorted.length * 0.2)] * 1.5;
    const open = new Float32Array(n);
    const narrow = new Float32Array(n);
    let o = 0;
    for (let f = 0; f < n; f++) {
      const e = Math.max(0, (rms[f] - floor) / (loud - floor));
      const target = Math.min(1, Math.pow(e, 0.65));
      // opens fast, closes a touch slower (the jaw has weight); a sharp dip still shuts it
      o += (target - o) * (target > o ? 0.65 : 0.42);
      // a hiss: many crossings while there is sound (teeth together, lips spread)
      const hiss = Math.min(1, Math.max(0, (zcr[f] - 0.12) / 0.18)) * Math.min(1, e * 3);
      open[f] = o * (1 - 0.55 * hiss);
      narrow[f] = hiss;
    }
    const track = { open, narrow, n };
    this.cache.set(buf, track);
    return track;
  }

  /** A line's voice began (AudioManager): its buffer and the audio-clock time it started. */
  start(buf, t0) {
    if (!buf) {
      this.cur = null;
      return;
    }
    this.cur = { track: this.analyse(buf), t0, who: this.who };
  }

  stop() {
    this.cur = null;
  }

  /** How open `name`'s mouth is now (0 shut .. 1 wide), and how much it hisses. */
  mouth(name, out = { open: 0, narrow: 0 }) {
    out.open = 0;
    out.narrow = 0;
    const c = this.cur;
    if (!c || !name || !c.who || c.who !== name || !this.audio.ctx) return out;
    const f = (this.audio.ctx.currentTime - c.t0) * FPS;
    if (f < 0) return out;
    const i = Math.floor(f);
    if (i >= c.track.n - 1) {
      this.cur = null;
      return out;
    }
    const k = f - i;
    out.open = c.track.open[i] * (1 - k) + c.track.open[i + 1] * k;
    out.narrow = c.track.narrow[i] * (1 - k) + c.track.narrow[i + 1] * k;
    return out;
  }
}
