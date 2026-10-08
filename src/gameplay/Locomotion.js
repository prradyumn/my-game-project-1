import * as THREE from 'three';
import { clamp, damp, smoothstep, wrapAngle } from '../utils/math.js';
import { aimBone, findBone, rotateBoneAxis, solveTwoBone, twistToward } from '../utils/bones.js';

// Procedural locomotion layer, applied on top of the animation clips every frame.
//
// With the motion-capture clips (prady-mocap.json, see Retarget.js) only the light parts run:
// foot IK on uneven ground, lean, banking, head look, and the swim / rowing arm strokes.
// With the fallback Genex clips everything below runs, because those clips are "in place"
// with the hips locked at one height and the hands held at the chest. Measured in
// tools/anim-lab.html:
//   walk  natural speed ~1.5 m/s, 77 steps/min, hip bob 0, hands 24 cm ABOVE the hips
//   run   natural speed 3.37 m/s, 106 steps/min, hip bob 0, hands at the chest
// So on top of the clips we add, from first principles:
//   * calibration      natural speed from the stance foot, floor height, stride, contact phases
//   * pelvis           walk: inverted-pendulum bob from the legs' own geometry (lowest foot on
//                      the floor); run: spring-mass bob (lowest at mid-stance) with a real flight
//                      phase; lateral weight shift; pelvis yaw/roll + shoulder counter-rotation
//   * arms             natural opposite-arm swing driven by the LIVE leg phase (never out of
//                      sync), elbows bent for running, a front-crawl stroke when swimming,
//                      sculling when treading water, a rowing stroke in the boat
//   * head             looks where the camera looks (within neck limits)
//   * feet             two-bone IK onto the real ground under each foot (ghat steps!), pelvis
//                      drops so the lower foot can reach, feet never sink below the floor

const TOE_CONTACT = 0.035; // toe joint height above the sole when planted
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _inv = new THREE.Matrix4();
const _U = new THREE.Vector3();
const _F = new THREE.Vector3();
const _L = new THREE.Vector3();
const _d = new THREE.Vector3();
const _fd = new THREE.Vector3();
const _p = new THREE.Vector3();
const _target = new THREE.Vector3();

export class Locomotion {
  constructor(model, opts = {}) {
    this.mocap = !!opts.mocap;
    this.model = model; // the glTF scene root (child of the Player's wrapper)
    this.basePos = model.position.clone();
    const B = (s) => findBone(model, s);
    this.b = {
      hips: B('Hips'),
      spine: B('Spine'),
      spine1: B('Spine1'),
      spine2: B('Spine2'),
      neck: B('Neck'),
      head: B('Head'),
    };
    for (const side of ['Left', 'Right']) {
      this.b[side] = {
        arm: B(`${side}Arm`),
        fore: B(`${side}ForeArm`),
        hand: B(`${side}Hand`),
        upLeg: B(`${side}UpLeg`),
        leg: B(`${side}Leg`),
        foot: B(`${side}Foot`),
        toe: B(`${side}ToeBase`),
        thumb: B(`${side}HandThumb1`),
        pinky: B(`${side}HandPinky1`),
      };
    }
    this.ok = !!(this.b.hips && this.b.Left.arm && this.b.Left.foot && this.b.Left.toe);
    this.cal = {};
    this.offsetY = 0;
    this.sway = 0;
    this.headYaw = 0;
    this.pelvisDrop = 0;
    this.footDelta = { Left: 0, Right: 0 };
    this.sideSign = 1;
    this.lean = 0;
  }

  // Position of a bone in the wrapper's local frame (wrapper = the Player's root object).
  local(bone, out) {
    return bone.getWorldPosition(out).applyMatrix4(_inv);
  }

  /** Measure a clip by sampling it with a temporary mixer. */
  calibrate(name, clip) {
    if (!this.ok || !clip) return null;
    const root = this.model;
    const wrapper = root.parent;
    wrapper.updateMatrixWorld(true);
    _inv.copy(wrapper.matrixWorld).invert();
    const mixer = new THREE.AnimationMixer(root);
    mixer.clipAction(clip).play();
    const N = 96;
    const S = [];
    const saveY = root.position.y;
    root.position.copy(this.basePos);
    for (let i = 0; i < N; i++) {
      const t = (i / N) * clip.duration;
      mixer.setTime(t);
      root.updateMatrixWorld(true);
      const L = this.local(this.b.Left.toe, new THREE.Vector3());
      const R = this.local(this.b.Right.toe, new THREE.Vector3());
      const LA = this.local(this.b.Left.foot, new THREE.Vector3());
      const RA = this.local(this.b.Right.foot, new THREE.Vector3());
      S.push({ t, L, R, LA, RA, low: Math.min(L.y, R.y) });
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(root);
    root.position.y = saveY;

    const minLow = Math.min(...S.map((s) => s.low));
    // Each foot has its own floor (the clips are slightly asymmetric).
    const minL = Math.min(...S.map((s) => s.L.y));
    const minR = Math.min(...S.map((s) => s.R.y));
    const plantedL = (s) => s.L.y < minL + 0.02;
    const plantedR = (s) => s.R.y < minR + 0.02;
    // A planted foot slides backward at exactly the speed the body must travel.
    let vSum = 0;
    let vN = 0;
    const dt = clip.duration / N;
    for (let i = 0; i < N; i++) {
      const a = S[i];
      const b = S[(i + 1) % N];
      for (const [k, planted] of [['L', plantedL], ['R', plantedR]]) {
        if (!planted(a) || !planted(b)) continue;
        vSum += -(b[k].z - a[k].z) / dt;
        vN++;
      }
    }
    const speed = vN ? vSum / vN : 1.4;
    const halfStride = Math.max(0.05, Math.max(...S.map((s) => Math.abs(s.L.z - s.R.z))) / 2);
    const contactL = S.map(plantedL);
    const firstL = contactL.findIndex((c, i) => c && !contactL[(i - 1 + N) % N]);
    // flight = both feet clearly off their floors (a run has it, a walk doesn't)
    const flight = S.filter((s) => s.L.y > minL + 0.05 && s.R.y > minR + 0.05).length / N;
    const plantedFrames = S.filter(plantedL);
    const ankleRest = plantedFrames.reduce((acc, s) => acc + (s.LA.y - s.L.y), 0) / Math.max(1, plantedFrames.length) + TOE_CONTACT;
    // Mid-stance of the left foot (centre of its longest contact window), for the run bob.
    let best = { len: 0, mid: 0 };
    for (let i = 0; i < N; i++) {
      if (!contactL[i] || contactL[(i - 1 + N) % N]) continue;
      let len = 0;
      while (contactL[(i + len) % N] && len < N) len++;
      if (len > best.len) best = { len, mid: (i + len / 2) / N };
    }
    this.sideSign = Math.sign(S.reduce((a, s) => a + (s.L.x - s.R.x), 0)) || 1;
    const cal = {
      speed: Math.max(0.6, speed),
      halfStride,
      firstContactL: firstL >= 0 ? firstL / N : 0,
      midStanceL: best.mid,
      flight,
      floor: -minLow + TOE_CONTACT, // root offset that puts the lowest toe on the floor
      ankleRest,
      lows: S.map((s) => s.low),
    };
    this.cal[name] = cal;
    return cal;
  }

  // Walk/idle: keep the lowest toe on the floor -> the inverted-pendulum bob falls out of the
  // legs' geometry. Run: spring-mass bob (lowest at mid-stance) with flight in between.
  rootOffset(name, phase) {
    const c = this.cal[name];
    if (!c) return 0;
    if (this.mocap) return c.floor; // mocap hips already carry the real bob and flight
    const n = c.lows.length;
    const f = (((phase % 1) + 1) % 1) * n;
    const i = Math.floor(f);
    const low = c.lows[i] + (c.lows[(i + 1) % n] - c.lows[i]) * (f - i);
    if (c.flight < 0.12) return -low + TOE_CONTACT;
    const bob = -Math.cos((phase - c.midStanceL) * Math.PI * 4) * 0.028;
    return c.floor + 0.012 + bob;
  }

  /**
   * ctx: { dt, weights{idle,walk,run,swim,air}, phases{walk,run}, speed, state, lean, bank,
   *        lookYaw (camera yaw relative to body), swimPhase, rowPhase, groundY, rayDown(x,y,z) }
   */
  update(ctx) {
    if (!this.ok) return;
    const { dt, weights: W } = ctx;
    const root = this.model;
    const wrapper = root.parent;
    wrapper.updateMatrixWorld(true);
    _inv.copy(wrapper.matrixWorld).invert();
    wrapper.getWorldQuaternion(_q);
    _U.set(0, 1, 0).applyQuaternion(_q);
    _F.set(0, 0, 1).applyQuaternion(_q);
    _L.set(this.sideSign, 0, 0).applyQuaternion(_q); // character's left

    const groundish = W.idle + W.walk + W.run;
    const Wsw = W.swim + (W.tread || 0);
    // ------------------------------------------------ pelvis height + weight shift
    let target = 0;
    let wsum = 0;
    if (this.cal.walk && W.walk > 0) {
      target += W.walk * this.rootOffset('walk', ctx.phases.walk);
      wsum += W.walk;
    }
    if (this.cal.run && W.run > 0) {
      target += W.run * this.rootOffset('run', ctx.phases.run);
      wsum += W.run;
    }
    if (this.cal.idle && W.idle > 0) {
      target += W.idle * this.rootOffset('idle', ctx.phases.idle ?? 0);
      wsum += W.idle;
    }
    const restFloor = this.cal.run ? this.cal.run.floor : this.cal.walk ? this.cal.walk.floor : 0;
    if (W.air > 0) {
      target += W.air * (restFloor + 0.05);
      wsum += W.air;
    }
    if (Wsw > 0) {
      target += Wsw * this.offsetY;
      wsum += Wsw;
    }
    // full-body actions (mocap) stand on the same floor as the idle
    if ((W.action || 0) > 0) {
      target += W.action * (this.cal.idle ? this.cal.idle.floor : restFloor);
      wsum += W.action;
    }
    if (wsum > 0) target /= wsum;
    this.offsetY = dt > 0 ? damp(this.offsetY, target, 30, dt) : target;

    // Weight shift over the stance foot (from the previous frame's toes)
    root.position.set(this.basePos.x + this.sway * this.sideSign, this.basePos.y + this.offsetY + this.pelvisDrop, this.basePos.z);
    root.updateMatrixWorld(true);
    const tL = this.local(this.b.Left.toe, new THREE.Vector3());
    const tR = this.local(this.b.Right.toe, new THREE.Vector3());
    const stride = this.cal.walk?.halfStride ?? 0.35;
    const legPhase = clamp((tL.z - tR.z) / stride, -1, 1); // +1: left leg forward
    const stanceSide = clamp((tR.y - tL.y) / 0.05, -1, 1); // +1: standing on the left foot
    const swayAmp = this.mocap ? 0 : (W.walk * 0.022 + W.run * 0.01 + W.idle * 0.004) * (1 - Wsw);
    // Footstep events at real foot contacts (sound and dust stay in sync with the legs)
    const stance = stanceSide > 0.6 ? 1 : stanceSide < -0.6 ? -1 : 0;
    if (stance !== 0 && stance !== this.lastStance) {
      this.lastStance = stance;
      if (groundish > 0.5 && ctx.speed > 0.3 && ctx.state === 'ground') this.onFootstep?.(stance > 0 ? 'Left' : 'Right');
    }
    this.sway = dt > 0 ? damp(this.sway, stanceSide * swayAmp, 8, dt) : 0;

    // ------------------------------------------------ pelvis + spine rotation, lean
    const moving = this.mocap ? 0 : clamp(ctx.speed / 2, 0, 1) * groundish;
    rotateBoneAxis(this.b.hips, _U, legPhase * 0.09 * moving);
    rotateBoneAxis(this.b.hips, _F, -stanceSide * 0.04 * moving * this.sideSign);
    if (this.b.spine1) rotateBoneAxis(this.b.spine1, _U, -legPhase * 0.14 * moving);
    const right = _w.crossVectors(_F, _U).normalize(); // character's right
    this.lean = dt > 0 ? damp(this.lean, ctx.lean ?? 0, 6, dt) : ctx.lean ?? 0;
    if (this.b.spine && Math.abs(this.lean) > 1e-4) rotateBoneAxis(this.b.spine, right, -this.lean);

    // ------------------------------------------------ arms
    const armW = clamp(groundish + W.air, 0, 1) * (1 - Wsw);
    // with the mocap front crawl only treading water still needs the procedural sculling
    const armSwim = ctx.swimMocap ? W.tread || 0 : Wsw;
    if (ctx.state === 'boat') this.rowArms(ctx.rowPhase ?? 0, ctx.oarHands, ctx.oarLean);
    else if (armSwim > 0.05) this.swimArms(ctx, armSwim);
    else if (armW > 0.01 && !this.mocap) this.walkArms(ctx, W, legPhase, armW);

    // ------------------------------------------------ head looks where the camera looks
    let want = 0;
    if (ctx.lookYaw !== undefined && Wsw < 0.5 && !ctx.noLook) {
      const rel = wrapAngle(ctx.lookYaw);
      const fade = 1 - smoothstep(1.4, 2.2, Math.abs(rel));
      want = clamp(rel, -0.7, 0.7) * 0.7 * fade * (1 - clamp(ctx.speed / 6, 0, 0.6));
    }
    this.headYaw = dt > 0 ? damp(this.headYaw, want, 5, dt) : want;
    if (this.b.neck) rotateBoneAxis(this.b.neck, _U, this.headYaw * 0.4);
    if (this.b.head) rotateBoneAxis(this.b.head, _U, this.headYaw * 0.6);

    // ------------------------------------------------ feet on the real ground
    if (ctx.state === 'ground' && ctx.rayDown && !ctx.noFootIK) this.footIK(ctx);
    else {
      this.pelvisDrop = dt > 0 ? damp(this.pelvisDrop, 0, 10, dt) : 0;
      this.footDelta.Left = this.footDelta.Right = 0;
    }
  }

  // Bow the head and upper back forward (pranam), in the body's own frame.
  bow(angle) {
    const right = _w.crossVectors(_F, _U).normalize();
    // (negative about the body's right tips forward, as the lean does)
    if (this.b.spine2) rotateBoneAxis(this.b.spine2, right, -angle * 0.35);
    if (this.b.neck) rotateBoneAxis(this.b.neck, right, -angle * 0.3);
    if (this.b.head) rotateBoneAxis(this.b.head, right, -angle * 0.45);
  }

  walkArms(ctx, W, legPhase, weight) {
    // Arm style follows real speed: relaxed walk swing -> bent-elbow running pump.
    const runW = smoothstep(2.3, 3.8, ctx.speed) * (1 - W.air);
    const moveW = clamp(ctx.speed / 1.1, 0, 1) * (1 - W.air);
    const amp = (0.22 + 0.1 * clamp((ctx.speed - 1) / 1.2, 0, 1)) * (1 - runW) * moveW + 0.44 * runW;
    const fwdBias = 0.05 + W.air * 0.35;
    const breath = Math.sin(performance.now() * 0.0016) * 0.015 * (1 - moveW);
    for (const side of ['Left', 'Right']) {
      const s = side === 'Left' ? 1 : -1;
      const B = this.b[side];
      const a = -s * legPhase * amp + fwdBias + breath;
      const abd = 0.16 + runW * 0.08 + W.air * 0.3;
      _d.copy(_U).multiplyScalar(-Math.cos(a)).addScaledVector(_F, Math.sin(a)).addScaledVector(_L, s * abd).normalize();
      const walkElbow = 0.22 + 0.24 * Math.max(0, Math.sin(a)) * moveW;
      const runElbow = 1.22 + 0.12 * Math.max(0, Math.sin(a));
      const elbow = walkElbow * (1 - runW) + runElbow * runW + W.air * 0.5;
      _p.copy(_F).addScaledVector(_d, -_F.dot(_d)).normalize();
      _fd.copy(_d).multiplyScalar(Math.cos(elbow)).addScaledVector(_p, Math.sin(elbow)).addScaledVector(_L, -s * 0.12 * runW).normalize();
      aimBone(B.arm, B.fore, _d, weight);
      aimBone(B.fore, B.hand, _fd, weight);
      // thumb leads (forward when hanging, up when pumping): palm faces the body
      if (B.thumb && B.pinky) twistToward(B.fore, _fd, B.thumb, B.pinky, _p.copy(_F).lerp(_U, runW * 0.6).normalize(), 0.85 * weight);
    }
  }

  // Front crawl (moving) or sculling (treading water), in the swimmer's body frame.
  swimArms(ctx, weight) {
    const moving = clamp(ctx.speed / 1.2, 0, 1);
    for (const side of ['Left', 'Right']) {
      const s = side === 'Left' ? 1 : -1;
      const B = this.b[side];
      if (moving > 0.3) {
        const th = (ctx.swimPhase + (s > 0 ? 0 : 0.5)) * Math.PI * 2;
        _d.copy(_U).multiplyScalar(Math.cos(th)).addScaledVector(_F, Math.sin(th)).addScaledVector(_L, s * 0.28).normalize();
        const pull = Math.max(0, Math.sin(th));
        const recover = Math.max(0, -Math.sin(th));
        const elbow = 0.15 + 0.95 * Math.pow(pull, 1.5) + 1.3 * recover;
        _p.copy(_F).multiplyScalar(recover > 0 ? 1 : 0.25).addScaledVector(_U, pull > 0 ? -1 : -0.2);
        _p.addScaledVector(_d, -_p.dot(_d)).normalize();
        _fd.copy(_d).multiplyScalar(Math.cos(elbow)).addScaledVector(_p, Math.sin(elbow)).normalize();
      } else {
        const sweep = Math.sin(ctx.swimPhase * Math.PI * 2 * 1.3 + (s > 0 ? 0 : Math.PI));
        _d.copy(_U).multiplyScalar(-0.45).addScaledVector(_L, s * 0.85).addScaledVector(_F, 0.3 + 0.25 * sweep).normalize();
        _p.copy(_F).addScaledVector(_d, -_F.dot(_d)).normalize();
        _fd.copy(_d).multiplyScalar(Math.cos(0.6)).addScaledVector(_p, Math.sin(0.6)).addScaledVector(_L, -s * 0.3 * sweep).normalize();
      }
      aimBone(B.arm, B.fore, _d, weight);
      aimBone(B.fore, B.hand, _fd, weight);
    }
  }

  // Both hands on the oars: the grips (Oars.js) when the boat has them, else a mimed stroke.
  rowArms(phase, hands, lean) {
    if (hands) {
      // a lean with the drive: forward as the handles go out, upright again for the catch
      const right = _w.crossVectors(_F, _U).normalize();
      if (this.b.spine1) rotateBoneAxis(this.b.spine1, right, -0.16 * (lean ?? 0));
      if (this.b.spine2) rotateBoneAxis(this.b.spine2, right, -0.1 * (lean ?? 0));
      for (const [i, side] of [[0, 'Left'], [1, 'Right']]) {
        const s = side === 'Left' ? 1 : -1;
        const B = this.b[side];
        // elbows out and down
        _p.copy(_L).multiplyScalar(s * 0.75).addScaledVector(_U, -0.65).normalize();
        solveTwoBone(B.arm, B.fore, B.hand, hands[i], _p, 1);
      }
      return;
    }
    const k = Math.sin(phase * Math.PI * 2);
    for (const side of ['Left', 'Right']) {
      const s = side === 'Left' ? 1 : -1;
      const B = this.b[side];
      _d.copy(_U).multiplyScalar(-0.55).addScaledVector(_F, 0.55 + 0.4 * k).addScaledVector(_L, s * 0.45).normalize();
      const elbow = 0.5 + 0.7 * (1 - (k + 1) / 2);
      _p.copy(_F).addScaledVector(_d, -_F.dot(_d)).normalize();
      _fd.copy(_d).multiplyScalar(Math.cos(elbow)).addScaledVector(_p, Math.sin(elbow)).addScaledVector(_L, -s * 0.35).normalize();
      aimBone(B.arm, B.fore, _d, 1);
      aimBone(B.fore, B.hand, _fd, 1);
    }
  }

  footIK(ctx) {
    const dt = ctx.dt;
    const ankleRest = this.cal.walk?.ankleRest ?? 0.09;
    const floorY = ctx.groundY;
    const want = {};
    for (const side of ['Left', 'Right']) {
      const B = this.b[side];
      B.toe.getWorldPosition(_v);
      B.foot.getWorldPosition(_w);
      const gx = (_v.x + _w.x) / 2;
      const gz = (_v.z + _w.z) / 2;
      const g = ctx.rayDown(gx, floorY + 0.65, gz);
      want[side] = g === null ? 0 : clamp(g - floorY, -0.45, 0.45);
    }
    for (const side of ['Left', 'Right']) this.footDelta[side] = dt > 0 ? damp(this.footDelta[side], want[side], 16, dt) : want[side];
    const drop = Math.min(0, this.footDelta.Left, this.footDelta.Right);
    this.pelvisDrop = dt > 0 ? damp(this.pelvisDrop, drop, 12, dt) : drop;
    this.model.position.y = this.basePos.y + this.offsetY + this.pelvisDrop;
    this.model.updateMatrixWorld(true);

    for (const side of ['Left', 'Right']) {
      const B = this.b[side];
      const d = this.footDelta[side] - this.pelvisDrop;
      B.foot.getWorldPosition(_target);
      _target.y += d;
      // never let the ankle sink below the floor under it
      _target.y = Math.max(_target.y, floorY + this.footDelta[side] + ankleRest * 0.85);
      B.foot.getWorldPosition(_v);
      if (Math.abs(_target.y - _v.y) < 0.004) continue;
      solveTwoBone(B.upLeg, B.leg, B.foot, _target, _F, 1);
    }
  }
}
