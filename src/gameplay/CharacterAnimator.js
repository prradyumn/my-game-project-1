import * as THREE from 'three';
import { clamp, damp, smoothstep } from '../utils/math.js';
import { Locomotion } from './Locomotion.js';

// Drives Prady's skeleton from a small set of clips.
//
// Bought from Genex: walk + run (Uthana, Mixamo-named skeleton). Everything else is derived
// procedurally from those two so the character is fully playable today:
//   idle  = the walk cycle averaged into a standing pose + breathing + weight shift
//   swim  = the run cycle with damped legs (flutter kick) — the body is pitched by Player
//   air   = a single frame of the run (knee up) for jumps and falls
//
// Any extra clip whose name contains one of these keys (idle, swim, jump, fall, sit, pray…)
// REPLACES the procedural one automatically — e.g. drop a Mixamo "Swimming" GLB in and list
// it in Assets.js. Bones are named mixamorig:*, so Mixamo clips work without retargeting.

const LEG_BONES = /UpLeg|Leg|Foot|Toe/;

function trackBone(track) {
  return track.name.slice(0, track.name.lastIndexOf('.'));
}

// Make a clip loop in place: remove the Hips' net travel (keeps bob and sway).
function stripRootMotion(clip) {
  let travel = 0;
  for (const t of clip.tracks) {
    if (!t.name.endsWith('Hips.position')) continue;
    const v = t.values;
    const n = t.times.length;
    const dur = t.times[n - 1] - t.times[0] || 1;
    const d = [v[(n - 1) * 3] - v[0], v[(n - 1) * 3 + 1] - v[1], v[(n - 1) * 3 + 2] - v[2]];
    travel = Math.hypot(d[0], d[1], d[2]);
    for (let i = 0; i < n; i++) {
      const k = (t.times[i] - t.times[0]) / dur;
      v[i * 3] -= d[0] * k;
      v[i * 3 + 1] -= d[1] * k;
      v[i * 3 + 2] -= d[2] * k;
    }
  }
  return travel; // in the Hips' parent units
}

function averageQuat(track) {
  const v = track.values;
  const n = v.length / 4;
  const ref = new THREE.Quaternion(v[0], v[1], v[2], v[3]);
  const acc = new THREE.Vector4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < n; i++) {
    q.fromArray(v, i * 4);
    if (q.dot(ref) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
    acc.x += q.x;
    acc.y += q.y;
    acc.z += q.z;
    acc.w += q.w;
  }
  return new THREE.Quaternion(acc.x, acc.y, acc.z, acc.w).normalize();
}

function averageVec(track) {
  const v = track.values;
  const n = v.length / 3;
  const out = new THREE.Vector3();
  for (let i = 0; i < n; i++) out.x += v[i * 3] / n, out.y += v[i * 3 + 1] / n, out.z += v[i * 3 + 2] / n;
  return out;
}

function makeIdle(walk) {
  const tracks = [];
  const D = 4;
  const times = [0, 1, 2, 3, 4];
  for (const t of walk.tracks) {
    const bone = trackBone(t);
    if (t.name.endsWith('.quaternion')) {
      const avg = averageQuat(t);
      const values = [];
      for (const tt of times) {
        const q = avg.clone();
        // breathing in the chest, a hint of neck motion
        if (/Spine1|Spine2/.test(bone)) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.sin((tt / D) * Math.PI * 2) * 0.018));
        if (/Neck/.test(bone)) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.sin((tt / D) * Math.PI * 2) * 0.03));
        values.push(q.x, q.y, q.z, q.w);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(t.name, times, values));
    } else if (t.name.endsWith('Hips.position')) {
      const avg = averageVec(t);
      const values = [];
      for (const tt of times) values.push(avg.x + Math.sin((tt / D) * Math.PI * 2) * 0.6, avg.y, avg.z);
      tracks.push(new THREE.VectorKeyframeTrack(t.name, times, values));
    }
  }
  return new THREE.AnimationClip('idle', D, tracks);
}

function makeSwim(run, name = 'swim') {
  const clip = run.clone();
  clip.name = name;
  for (const t of clip.tracks) {
    const bone = trackBone(t);
    if (t.name.endsWith('.quaternion') && LEG_BONES.test(bone)) {
      const avg = averageQuat(t);
      const q = new THREE.Quaternion();
      for (let i = 0; i < t.values.length / 4; i++) {
        q.fromArray(t.values, i * 4).slerp(avg, 0.6);
        q.toArray(t.values, i * 4);
      }
    } else if (t.name.endsWith('Hips.position')) {
      const avg = averageVec(t);
      for (let i = 0; i < t.values.length / 3; i++) t.values[i * 3 + 1] = avg.y;
    }
  }
  return clip;
}

function makePose(clip, phase, name) {
  const tracks = [];
  for (const t of clip.tracks) {
    const interp = t.createInterpolant();
    const time = t.times[0] + (t.times[t.times.length - 1] - t.times[0]) * phase;
    const v = Array.from(interp.evaluate(time));
    const Track = t.constructor;
    tracks.push(new Track(t.name, [0, 1], [...v, ...v]));
  }
  return new THREE.AnimationClip(name, 1, tracks);
}

/**
 * A held pose that breathes: the clip's pose at phase a eased to its pose at phase b and back over
 * `period` seconds. A stance cut from a few tenths of a second of motion capture (a fighter's pause
 * before the first blow) jiggles when looped as it is: the actor never stands still, so the loop
 * replays his twitch twice a second. Two poses a moment apart, blended slowly, read as breath.
 */
function makeBreath(clip, a, b, period, name) {
  const N = 12;
  const tracks = [];
  for (const t of clip.tracks) {
    const interp = t.createInterpolant();
    const at = (ph) => Array.from(interp.evaluate(t.times[0] + (t.times[t.times.length - 1] - t.times[0]) * ph));
    const va = at(a);
    const vb = at(b);
    const times = [];
    const values = [];
    const quat = t.ValueTypeName === 'quaternion';
    for (let i = 0; i <= N; i++) {
      const k = (1 - Math.cos((i / N) * Math.PI * 2)) / 2;
      let v = va.map((x, j) => x + (vb[j] - x) * k);
      if (quat) {
        const l = Math.hypot(...v) || 1;
        v = v.map((x) => x / l);
      }
      times.push((i / N) * period);
      values.push(...v);
    }
    tracks.push(new t.constructor(t.name, times, values));
  }
  return new THREE.AnimationClip(name, period, tracks);
}
// the short-sliced holds: [from phase, to phase, seconds a breath]
const BREATHE = { swordStance: [0.35, 0.6, 3.6], guard: [0.3, 0.6, 3.2], pranam: [0.3, 0.7, 4.5], meditate: [0.3, 0.7, 5] };

export class CharacterAnimator {
  /**
   * @param root   the character's scene root (contains the SkinnedMesh); must already be a
   *               child of the Player's wrapper so calibration can measure it
   * @param clips  { walk, run, ...extra } AnimationClips
   */
  constructor(root, clips) {
    this.mixer = new THREE.AnimationMixer(root);
    this.root = root;
    this.actions = {};

    const walk = clips.walk;
    const run = clips.run;
    // Clips that carry root motion (e.g. Mixamo "with root") are made to loop in place.
    if (walk) stripRootMotion(walk);
    if (run) stripRootMotion(run);
    const base = walk || run;

    const all = {
      walk,
      run,
      idle: clips.idle || (base ? makeIdle(base) : null),
      // front crawl (mocap) when moving; treading water (procedural flutter kick) when still
      swim: clips.swim || (run ? makeSwim(run) : null),
      tread: clips.swim && run ? makeSwim(run, 'tread') : null,
      air: clips.jump || clips.fall || (run ? makePose(run, 0.22, 'air') : null),
    };
    for (const [k, clip] of Object.entries(all)) {
      if (!clip) continue;
      const a = this.mixer.clipAction(clip);
      a.enabled = true;
      a.setEffectiveWeight(0);
      a.play();
      this.actions[k] = a;
    }

    // Full-body ACTIONS over locomotion (mocap): pranam, wave, idle breaks, floating a diya,
    // sitting down to meditate, stepping up, the dive take-off. One plays at a time; switching
    // crossfades. See play() / stop().
    this.clipActions = {};
    for (const k of ['wave', 'stretch', 'lookAround', 'pranam', 'meditate', 'sitToStand', 'crouchReach', 'stepUp', 'diveTakeoff', 'guard', 'oneTwo', 'bodyShot', 'frontKick', 'roundKick', 'thrust', 'parry', 'swordStance', 'slashA', 'slashB', 'heavyCut', 'dodgeRoll', 'dodgeBack', 'knockdown', 'getUp', 'death', 'hitLight', 'hitHeavy', 'vault', 'scramble', 'ladder', 'hang']) {
      if (clips[k]) this.clipActions[k] = this.mixer.clipAction(BREATHE[k] ? makeBreath(clips[k], ...BREATHE[k], k) : clips[k]);
    }
    // up a wall at a run: the run cycle itself, its own action (Traversal leans the body back)
    if (run) this.clipActions.wallRun = this.mixer.clipAction(Object.assign(run.clone(), { name: 'wallRun' }));
    this.cur = null;
    this.fading = [];
    this.actW = 0;
    this.stillTime = 0;
    this.swimMocap = !!clips.swim;

    // Procedural layer: calibrate each locomotion clip once (speed, floor, stride, phases).
    // With motion-capture clips the layer stays light (feet IK, lean, bank, head look);
    // with the in-place Genex clips it also rebuilds arm swing and pelvis motion.
    this.loco = new Locomotion(root, { mocap: !!clips.mocap });
    const cw = this.loco.calibrate('walk', walk);
    const cr = this.loco.calibrate('run', run);
    this.loco.calibrate('idle', all.idle);
    this.natural = { walk: cw?.speed ?? 1.4, run: cr?.speed ?? 3.4 };
    // phase offset that lines up the left-foot contacts of walk and run
    this.runPhaseOffset = (cr?.firstContactL ?? 0) - (cw?.firstContactL ?? 0);
    this.mode = { ground: 1, swim: 0, air: 0 };
    this.swimPhase = 0;

    // three.js's mixer only writes a bone when its animated value CHANGED since the last frame.
    // The procedural layer edits bones after the mixer, so without this the edits would pile up
    // frame after frame on any bone the clip holds still (spinning head, twisted limbs).
    // We keep the mixer's clean output and restore it before every mixer update.
    this.bones = [];
    root.traverse((o) => {
      if (o.isBone) this.bones.push(o);
    });
    this.clean = this.bones.map((b) => ({ q: b.quaternion.clone(), p: b.position.clone() }));
  }

  /** The greeting and idle-break emotes (stand still; moving cancels them). */
  emote(name) {
    if (name === 'pranam') return this.play('pranam', { loop: true, hold: 1.9, bow: 0.3, fadeIn: 0.38, fadeOut: 0.45 });
    return this.play(name, {});
  }

  /**
   * Play a full-body action. opts: loop, timeScale, reverse (play backwards from the end),
   * clamp (stay on the last frame until stop()), hold (seconds, then fade out), fadeIn,
   * fadeOut, cancelOnMove (default true), bow (head bow, radians), noLook, noFootIK.
   */
  play(name, opts = {}) {
    const a = this.clipActions[name];
    if (!a) return false;
    const o = { loop: false, timeScale: 1, reverse: false, clamp: false, hold: 0, fadeIn: 0.25, fadeOut: 0.3, cancelOnMove: true, bow: 0, noLook: false, noFootIK: false, ...opts };
    if (this.cur) {
      if (this.cur.a === a) this.fading = this.fading.filter((f) => f.a !== a);
      else this.fading.push({ a: this.cur.a, w: this.cur.w, w0: this.cur.w, t: 0, fadeOut: o.fadeIn });
    }
    this.fading = this.fading.filter((f) => f.a !== a);
    a.reset();
    a.enabled = true;
    a.setLoop(o.loop ? THREE.LoopRepeat : THREE.LoopOnce, o.loop ? Infinity : 1);
    a.clampWhenFinished = !o.loop;
    a.timeScale = (o.reverse ? -1 : 1) * Math.abs(o.timeScale);
    a.setEffectiveWeight(0);
    a.play();
    if (o.reverse) a.time = a.getClip().duration;
    this.cur = { a, name, w: 0, w0: 0, t: 0, o };
    this.stillTime = -12;
    return true;
  }

  stop(fadeOut = 0.3) {
    if (!this.cur) return;
    this.fading.push({ a: this.cur.a, w: this.cur.w, w0: this.cur.w, t: 0, fadeOut });
    this.cur = null;
  }

  isPlaying(name) {
    return this.cur?.name === name;
  }

  /** Seconds left in the current action (LoopOnce), or Infinity. */
  actionLeft() {
    const c = this.cur;
    if (!c || c.o.loop) return Infinity;
    const a = c.a;
    const ts = Math.abs(a.timeScale) || 1;
    return (c.o.reverse ? a.time : a.getClip().duration - a.time) / ts;
  }

  updateActions(dt, state, groundSpeed) {
    // an idle break after standing still a while
    const still = state === 'ground' && groundSpeed < 0.15;
    this.stillTime = still && !this.cur ? this.stillTime + dt : Math.min(this.stillTime, 0);
    if (this.stillTime > 16 && (this.clipActions.lookAround || this.clipActions.stretch)) {
      this.play(Math.random() < 0.6 && this.clipActions.lookAround ? 'lookAround' : 'stretch', {});
    }
    const c = this.cur;
    if (c) {
      c.t += dt;
      if (c.o.cancelOnMove && !(state === 'ground' && groundSpeed < 0.5)) this.stop(0.12);
      else if (c.o.hold && c.t > c.o.hold) this.stop(c.o.fadeOut);
      else if (!c.o.loop && !c.o.clamp && this.actionLeft() < c.o.fadeOut) this.stop(c.o.fadeOut);
    }
    // S-curve cross-fades (ease in and out): an exponential fade put ~27% of a big pose change
    // into its very first frame, a visible pop between very different poses
    if (this.cur) {
      const k = dt > 0 ? Math.min(1, this.cur.t / Math.max(0.05, this.cur.o.fadeIn)) : 1;
      this.cur.w = Math.max(this.cur.w, k * k * (3 - 2 * k));
      this.cur.a.setEffectiveWeight(this.cur.w);
    }
    for (const f of this.fading) {
      f.t = (f.t ?? 0) + dt;
      const k = dt > 0 ? Math.min(1, f.t / Math.max(0.05, f.fadeOut)) : 1;
      f.w = (f.w0 ?? f.w) * (1 - k * k * (3 - 2 * k));
      f.a.setEffectiveWeight(f.w);
      if (f.w < 0.01) f.a.stop();
    }
    this.fading = this.fading.filter((f) => f.w >= 0.01);
    this.actW = Math.min(1, (this.cur?.w ?? 0) + this.fading.reduce((acc, f) => acc + f.w, 0));
    return this.actW;
  }

  /** World position of one of Prady's bones by Mixamo name (e.g. 'RightHand'). */
  boneWorld(name, out) {
    const b = name.includes('Left') || name.includes('Right') ? this.loco.b[name.startsWith('Left') ? 'Left' : 'Right'][{ Hand: 'hand', ForeArm: 'fore', Arm: 'arm', Foot: 'foot' }[name.replace(/^(Left|Right)/, '')]] : this.loco.b[name.charAt(0).toLowerCase() + name.slice(1)];
    return b ? b.getWorldPosition(out) : null;
  }

  restoreCleanPose() {
    for (let i = 0; i < this.bones.length; i++) {
      this.bones[i].quaternion.copy(this.clean[i].q);
      this.bones[i].position.copy(this.clean[i].p);
    }
  }

  saveCleanPose() {
    for (let i = 0; i < this.bones.length; i++) {
      this.clean[i].q.copy(this.bones[i].quaternion);
      this.clean[i].p.copy(this.bones[i].position);
    }
  }

  /**
   * state: 'ground' | 'air' | 'swim' | 'dive' | 'waterrun' | 'boat'
   * speed: horizontal speed in m/s
   * extra: { lean, lookYaw, groundY, rayDown(x,y,z), rowPhase }
   */
  update(dt, state, speed, extra = {}) {
    dt *= this.timeScale ?? 1; // hit-stop: a strike that lands freezes the body for a beat
    const targetMode = { ground: 0, swim: 0, air: 0 };
    if (state === 'swim' || state === 'dive') targetMode.swim = 1;
    else if (state === 'air') targetMode.air = 1;
    else targetMode.ground = 1;
    for (const k of Object.keys(this.mode)) this.mode[k] = dt > 0 ? damp(this.mode[k], targetMode[k], 10, dt) : targetMode[k];

    const A = this.actions;
    const groundSpeed = state === 'boat' ? 0 : speed;
    const nw = this.natural.walk;
    const nr = this.natural.run;
    const wMove = smoothstep(0.05, 0.55, groundSpeed);
    // walk -> run blend across the speeds where neither clip would need extreme playback rates
    const wRun = smoothstep(nw * 1.2, Math.max(nw * 1.2 + 0.5, nr * 0.85), groundSpeed);
    const wCrawl = A.tread ? smoothstep(0.2, 0.75, speed) : 1;
    const w = {
      idle: this.mode.ground * (1 - wMove),
      walk: this.mode.ground * wMove * (1 - wRun),
      run: this.mode.ground * wMove * wRun,
      swim: this.mode.swim * wCrawl,
      tread: this.mode.swim * (1 - wCrawl),
      air: this.mode.air,
    };
    if (!A.walk && A.run) {
      w.run += w.walk;
      w.walk = 0;
    }
    // Full-body actions take over from locomotion by their weight.
    const actW = this.updateActions(dt, state, groundSpeed);
    if (actW > 0) for (const k of Object.keys(w)) w[k] *= 1 - actW;
    w.action = actW;
    for (const [k, a] of Object.entries(A)) a.setEffectiveWeight(w[k] ?? 0);

    // Cadence follows speed so the planted foot stays planted (stride is fixed in an in-place
    // clip, so rate = speed / natural speed), capped where the legs would look frantic.
    if (A.walk) A.walk.timeScale = clamp(groundSpeed / nw, 0.55, 1.75);
    if (A.run) A.run.timeScale = clamp(groundSpeed / nr, 0.7, 1.8);
    // Keep walk and run on the same foot while they blend.
    if (A.walk && A.run && w.run > 0.01 && w.walk > 0.01) {
      const ph = A.walk.time / A.walk.getClip().duration + this.runPhaseOffset;
      A.run.time = (((ph % 1) + 1) % 1) * A.run.getClip().duration;
    }
    if (A.swim) A.swim.timeScale = this.swimMocap ? clamp(0.55 + speed * 0.28, 0.55, 1.5) : 0.35 + Math.min(speed, 3) * 0.22;
    if (A.tread) A.tread.timeScale = 0.4;
    this.swimPhase += dt * (speed > 0.3 ? 0.42 + speed * 0.12 : 0.35);
    this.restoreCleanPose();
    this.mixer.update(dt);
    this.saveCleanPose();

    const phase = (a) => (a ? a.time / a.getClip().duration : 0);
    const o = this.cur?.o;
    this.loco.update({
      dt,
      weights: w,
      phases: { walk: phase(A.walk), run: phase(A.run), idle: phase(A.idle) },
      speed: groundSpeed,
      state,
      swimPhase: this.swimPhase,
      swimMocap: this.swimMocap,
      noLook: !!o?.noLook && actW > 0.3,
      noFootIK: !!o?.noFootIK && actW > 0.3,
      ...extra,
    });
    // a gentle bow of the head and upper back (pranam)
    const bow = (o?.bow ?? 0) * (this.cur?.w ?? 0);
    if (bow > 0.001) this.loco.bow(bow);
  }
}
