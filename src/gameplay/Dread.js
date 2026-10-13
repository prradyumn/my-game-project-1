import { clamp, damp } from '../utils/math.js';

// Dread: how afraid the night feels, and the body's answer to it. The places that are meant to
// frighten ask for it with want(key, level) — the dark lanes, Masan at the burning ghat, the
// eclipse, the drowned sanctum — and it climbs further while something hunts him unseen
// (threat(k), set each frame by whatever is doing the hunting).
//
// It drives the colour grade (Grading: uDread drains the colour, sinks the shadows cold, adds
// grain and closes the edges in; uPulse closes them a little more on each beat), a heartbeat that
// quickens from 62 to ~130 bpm, a low drone under everything, the pad's rumble on each beat, and
// a breath of unsteadiness in the camera. All of it made in code: nothing to download.

export class Dread {
  constructor(game) {
    this.g = game;
    this.wants = new Map();
    this.level = 0; // 0..1, eased
    this.hunt = 0; // 0..1: something close that he can't see (eased)
    this.huntT = 0;
    this.beat = 0; // phase of the heartbeat, 0..1
    this.pulse = 0; // 0..1 envelope of the last beat (the grade reads it)
    this.drone = null;
    game.audio.synth('heartbeat', synthHeartbeat);
    game.audio.synth('dread-drone', synthDrone);
  }

  /** A place or an event asks for dread (0..1); 0 lets go of it. */
  want(key, level) {
    if (!(level > 0)) this.wants.delete(key);
    else this.wants.set(key, Math.min(1, level));
  }

  /** Something is hunting him this frame (0..1: how close, how unseen). */
  threat(k) {
    this.huntT = Math.max(this.huntT, clamp(k, 0, 1));
  }

  clear() {
    this.wants.clear();
    this.huntT = 0;
  }

  update(dt) {
    const g = this.g;
    let want = 0;
    for (const v of this.wants.values()) want = Math.max(want, v);
    // (never in a menu, a photo or a story scene: the grade would follow it in)
    if (g.state !== 'play' || g.photo) want = 0;
    this.hunt = damp(this.hunt, this.huntT, this.huntT > this.hunt ? 2.5 : 0.6, dt);
    this.huntT = 0;
    const target = Math.min(1, want + this.hunt * 0.4 * (want > 0 ? 1 : 0.5));
    // fear comes on slowly and leaves slower still
    this.level = damp(this.level, target, target > this.level ? 0.7 : 0.35, dt);
    const L = this.level;

    // ---- the heartbeat: lub-dub, quickening with the fear and with the hunt
    const bpm = 62 + 40 * L + 30 * this.hunt;
    this.beat += (dt * bpm) / 60;
    if (this.beat >= 1) {
      this.beat -= 1;
      if (L > 0.12) {
        const v = clamp((L - 0.12) * 1.1 + this.hunt * 0.3, 0, 0.85);
        g.audio.play('heartbeat', { volume: v, rate: 0.95 + this.hunt * 0.08, channel: 'sfx' });
        if (L > 0.35) g.haptics?.pulse?.(0.18 * L, 0.32 * L, 70);
      }
    }
    const b = this.beat;
    // (the lub at 0, the dub 0.17 of a beat later)
    this.pulse = Math.exp(-b * 16) + 0.65 * (b > 0.17 ? Math.exp(-(b - 0.17) * 16) : 0);

    // ---- the drone: a low, beating hum under everything
    if (L > 0.03 && !this.drone) this.drone = g.audio.loop('dread-drone', { channel: 'ambience', volume: 0 });
    if (this.drone) {
      this.drone.setVolume(Math.min(0.7, L * 0.55 + this.hunt * 0.25), 0.6);
      if (L < 0.01) {
        this.drone.stop(1.5);
        this.drone = null;
      }
    }
  }

  /** The camera's unsteadiness (radians of roll) for CameraRig: a slow, uneven sway. */
  sway(t) {
    const L = this.level;
    if (L < 0.05) return 0;
    return (Math.sin(t * 0.7) * 0.6 + Math.sin(t * 1.9 + 1.3) * 0.3) * 0.006 * L;
  }
}

// ---------------------------------------------------------------- sounds (made in code)

/** A heartbeat: a low lub and a softer dub, felt more than heard. */
export function synthHeartbeat(ctx) {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * 0.6);
  const b = ctx.createBuffer(1, n, sr);
  const d = b.getChannelData(0);
  const thump = (t0, f0, amp) => {
    for (let i = Math.floor(t0 * sr); i < n; i++) {
      const t = i / sr - t0;
      if (t > 0.22) break;
      const env = Math.min(1, t * 120) * Math.exp(-t * 22);
      const f = f0 * (1 - 0.35 * Math.min(1, t * 8));
      d[i] += Math.sin(2 * Math.PI * f * t) * env * amp + Math.sin(2 * Math.PI * f * 2.02 * t) * env * amp * 0.18;
    }
  };
  thump(0, 58, 0.95);
  thump(0.16, 50, 0.6);
  return b;
}

/** A dread drone: low detuned tones beating against each other over a breath of dark noise,
 *  slowly swelling; every partial a whole number of cycles over the loop, so it loops cleanly. */
export function synthDrone(ctx) {
  const sr = ctx.sampleRate;
  const secs = 8;
  const n = Math.floor(sr * secs);
  const b = ctx.createBuffer(2, n, sr);
  // (cycles per loop: 55 Hz ~ 440, a tritone above, a sub, a slow swell of 2 per loop)
  const parts = [
    [440, 0.32],
    [443, 0.28],
    [622, 0.12],
    [625, 0.1],
    [220, 0.22],
    [880, 0.05],
  ];
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let lp = 0;
    let lp2 = 0;
    for (let i = 0; i < n; i++) {
      const k = i / n;
      let s = 0;
      for (const [c, a] of parts) s += Math.sin(2 * Math.PI * (c + ch * 2) * k) * a;
      const w = Math.random() * 2 - 1;
      lp += (w - lp) * 0.02;
      lp2 += (lp - lp2) * 0.02;
      const swell = 0.75 + 0.25 * Math.sin(2 * Math.PI * 2 * k + ch);
      d[i] = (s * 0.32 + lp2 * 2.2) * swell;
    }
  }
  return b;
}
