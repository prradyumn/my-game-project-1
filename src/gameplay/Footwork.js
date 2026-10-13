import { clamp, wrapAngle } from '../utils/math.js';
import { groundHeight } from '../world/WorldLayout.js';

// The small motions between the big ones, motion capture from prady-moves3.json:
//
//   turning on the spot  standing, pushed somewhere well round from where he faces: he steps
//                        round on his feet (a quarter turn, or two of them for a half) instead of
//                        spinning on them. The turn is baked out of the take (Retarget rootYaw) and
//                        he is turned by it here, so the foot he stands on stays where it is.
//   braking              let go of the stick at a run: he plants a foot and drops his hips into
//                        it, carried along the take's own braking path to a standstill (sprinting,
//                        the take is played quicker). A drop or the river ahead skips it.
//
// Neither owns the body: Player moves as ever (the stair ramps, walls, snapping to the ground).
// Footwork only holds his speed back while he turns, sets it while he brakes, and turns him.
// Anything else that wants him (a stance, an action, a fight, the stick pushed again) wins.

const LEG = 0.88; // Prady's hip height above the foot (m): root motion is baked in these units
const TURN_TS = [2.1, 2.5]; // the takes turn calmly: quicker (a quarter ~0.65 s, a half ~1.1 s)
const TURN_MIN = 1.0; // radians off his facing before he steps round (less: he just walks off)
const TURN_HALF = 2.3; // past this, two quarter turns
const TURN_GO = 0.72; // through the last turn, he sets off walking (the walk finishes it)
const STOP_SPEED = 2.6; // m/s: a run, not a walk
// where the take is entered: the brake step on the left foot (the big one), or on the right
const STOP_ENTRY = { Left: 0.08, Right: 0.28 };
const STOP_STEPS = [
  [0.18, 'Left'],
  [0.38, 'Right'],
  [0.8, 'Left'],
];
// idle breaks and the like may be cut short by a turn
const YIELDS = new Set(['lookAround', 'stretch', 'akimbo', 'wave']);

export class Footwork {
  constructor({ player, animator, rootMotion, water }) {
    this.p = player;
    this.anim = animator;
    this.rm = rootMotion || {};
    this.water = water;
    this.turn = null;
    this.stop = null;
    this.speedScale = 1;
    this.yawOwned = false;
    this.yaw = 0;
    this.stopVel = null;
    this.ok = !!(animator.clipActions.turnL && animator.clipActions.turnR && this.rm.turnL?.yaw && this.rm.turnR?.yaw);
    this.okStop = !!(animator.clipActions.runStop && this.rm.runStop?.path);
    this.blocked = () => false; // Game: true while a fight is on
  }

  /** The clip's yaw (radians from its start) at clip time t, interpolated between frames. */
  yawAt(rm, t) {
    const f = clamp(t * rm.fps, 0, rm.yaw.length - 1);
    const i = Math.floor(f);
    const j = Math.min(rm.yaw.length - 1, i + 1);
    return rm.yaw[i] + (rm.yaw[j] - rm.yaw[i]) * (f - i);
  }

  /** The braking take's speed (m/s at its own pace) at clip time t. */
  speedAt(rm, t) {
    const n = rm.path.length / 2;
    const f = clamp(t * rm.fps, 0, n - 2);
    const i = Math.floor(f);
    const v = (k) => Math.hypot(rm.path[(k + 1) * 2] - rm.path[k * 2], rm.path[(k + 1) * 2 + 1] - rm.path[k * 2 + 1]) * rm.fps * LEG;
    // (a frame either side: the path's own steps show in a single frame's travel)
    const a = (v(Math.max(0, i - 1)) + v(i) + v(Math.min(n - 2, i + 1))) / 3;
    const b = (v(i) + v(Math.min(n - 2, i + 1)) + v(Math.min(n - 2, i + 2))) / 3;
    return a + (b - a) * (f - i);
  }

  free() {
    const p = this.p;
    const cur = this.anim.cur?.name;
    if (cur && !YIELDS.has(cur) && !(this.turn || this.stop)) return false;
    return p.state === 'ground' && p.grounded && !p.inputLocked && !p.traversal?.act && !p.actions?.act && !p.combat?.move && !p.combat?.react && !p.combat?.blocking && !p.boat && !this.blocked();
  }

  // ---------------------------------------------------------------- fixed 60 Hz (before Player's forces)
  fixed(dt) {
    const p = this.p;
    const c = p.cmd;
    this.speedScale = 1;
    this.stopVel = null;
    // something else took the body's animation over (a stance, an action): it has him now
    const M = this.turn || this.stop;
    if (M && this.anim.cur?.a !== M.action) {
      this.turn = this.stop = null;
      this.yawOwned = false;
    }
    if (!this.free()) return this.end(0.2);
    if (this.turn) this.stepTurn(dt);
    else if (this.stop) this.stepStop(dt);
    else this.trigger();
    this.wasRunning = p.speed >= STOP_SPEED && c.mag > 0.5;
  }

  trigger() {
    const p = this.p;
    const c = p.cmd;
    const depth = this.water.heightAt(p.position.x, p.position.z) - p.feetY;
    if (depth > 0.25) return;
    // ---- a turn on the spot
    if (this.ok && p.speed < 0.3 && c.mag > 0.35 && !p.walkMode) {
      const ang = wrapAngle(Math.atan2(c.wish.x, c.wish.z) - p.yaw);
      if (Math.abs(ang) > TURN_MIN) return this.startTurn(ang);
    }
    // ---- braking out of a run
    if (this.okStop && this.wasRunning && c.mag < 0.12) {
      const v = Math.hypot(p.velocity.x, p.velocity.z);
      if (v < STOP_SPEED) return;
      const dx = p.velocity.x / v;
      const dz = p.velocity.z / v;
      // never braked over a step edge or into the river (the plant carries him a metre or two)
      for (const d of [0.7, 1.4, 2.1]) {
        const gy = groundHeight(p.position.x + dx * d, p.position.z + dz * d);
        if (p.feetY - gy > 0.4 || gy < this.water.heightAt(p.position.x + dx * d, p.position.z + dz * d) - 0.2) return;
      }
      this.startStop(v, dx, dz);
    }
  }

  // ---------------------------------------------------------------- turning on the spot
  startTurn(ang) {
    const p = this.p;
    const name = ang > 0 ? 'turnL' : 'turnR';
    const rm = this.rm[name];
    const end = rm.yaw[rm.yaw.length - 1];
    const legs = Math.abs(ang) > TURN_HALF ? 2 : 1;
    // the take's quarter turn stretched or shrunk to the turn asked for (a little: much more and
    // the feet would slide round)
    const scale = clamp(ang / legs / end, 0.6, 1.3);
    this.turn = { name, rm, end, scale, legs, leg: 0, t: 0, prevT: 0, y0: p.yaw, dur: rm.yaw.length / rm.fps };
    this.playTurn(0.16);
    this.stepTurn(0);
  }

  playTurn(fadeIn) {
    const T = this.turn;
    // (the second quarter is a second copy of the clip, so the two cross-fade)
    const clip = T.leg === 1 ? `${T.name}2` : T.name;
    this.anim.play(this.anim.clipActions[clip] ? clip : T.name, { clamp: true, cancelOnMove: false, fadeIn, fadeOut: 0.28, timeScale: 0, plant: true });
    T.action = this.anim.cur?.a;
  }

  stepTurn(dt) {
    const T = this.turn;
    const p = this.p;
    T.prevT = T.t;
    T.t = Math.min(T.dur, T.t + dt * TURN_TS[T.legs - 1]);
    const y = this.yawAt(T.rm, T.t) * T.scale;
    this.yawOwned = true;
    this.yaw = T.y0 + y;
    this.speedScale = 0;
    const k = y / (T.end * T.scale);
    const last = T.leg === T.legs - 1;
    if (!last && k >= 0.97) {
      // the second quarter of a half turn, from where the first one left him
      T.leg++;
      T.y0 = this.yaw;
      T.t = T.prevT = 0;
      this.playTurn(0.12);
      return;
    }
    if (last && (k >= TURN_GO || T.t >= T.dur) && p.cmd.mag > 0.2) return this.end(0.3);
    if (T.t >= T.dur) this.end(0.35);
  }

  // ---------------------------------------------------------------- braking
  startStop(v, dx, dz) {
    const rm = this.rm.runStop;
    // the foot that comes down next takes the brake step
    const entry = STOP_ENTRY[this.p.lastStep === 'Left' ? 'Right' : 'Left'];
    const vc = this.speedAt(rm, entry);
    const ts = clamp(v / Math.max(0.3, vc), 1, 1.85);
    // (sprinting, the take quickened as far as it looks right, and its path stretched for the rest)
    const s = v / (ts * vc);
    this.stop = { rm, t: entry, prevT: entry, entry, ts, s, dx, dz, yaw: this.p.yaw, dur: rm.path.length / 2 / rm.fps, steps: STOP_STEPS.filter(([at]) => at > entry) };
    this.anim.play('runStop', { clamp: true, cancelOnMove: false, fadeIn: 0.12, fadeOut: 0.4, timeScale: 0, plant: true });
    this.stop.action = this.anim.cur?.a;
    if (this.stop.action) this.stop.action.time = entry;
    this.stepStop(0);
  }

  stepStop(dt) {
    const S = this.stop;
    const p = this.p;
    // pushed again: he runs on out of it
    if (p.cmd.mag > 0.3) return this.end(0.18);
    S.prevT = S.t;
    S.t = Math.min(S.dur, S.t + dt * S.ts);
    const v = S.s * S.ts * this.speedAt(S.rm, S.t);
    this.yawOwned = true;
    this.yaw = S.yaw;
    while (S.steps.length && S.t >= S.steps[0][0]) {
      const [, side] = S.steps.shift();
      p.lastStep = side;
      p.fx.footstep?.(Math.max(2, v * 1.4));
      p.fx.footprint?.(side);
    }
    if (S.t >= S.dur - 0.12 || v < 0.12) {
      this.stopVel = { x: 0, z: 0 };
      return this.end(0.45);
    }
    this.stopVel = { x: S.dx * v, z: S.dz * v };
  }

  // ---------------------------------------------------------------- end / per frame
  end(fade = 0.3) {
    const act = this.turn?.action || this.stop?.action;
    if (act && this.anim.cur?.a === act) this.anim.stop(fade);
    this.turn = this.stop = null;
    this.yawOwned = false;
  }

  /** Per rendered frame, before the animator: the clip's time from the same interpolation as
   *  his position and facing, so the pose and the turn never drift apart. */
  late(alpha) {
    const M = this.turn || this.stop;
    if (!M?.action) return;
    if (this.anim.cur?.a !== M.action) return;
    M.action.time = M.prevT + (M.t - M.prevT) * alpha;
  }
}
