import * as THREE from 'three';
import { GROUPS } from '../core/Physics.js';
import { clamp, damp, dampAngle, smoothDamp } from '../utils/math.js';

const _q = new THREE.Quaternion();

// Third-person orbit camera: mouse/stick look, wheel zoom, collision so it never clips into
// walls, plus a scripted cinematic mode for the opening shot. With a lock-on target (lockAt) the
// view turns to keep the enemy framed beside the hero; the mouse then only flicks between targets.

const _probe = new THREE.Vector3();
const _pivot = new THREE.Vector3();

export class CameraRig {
  constructor(camera, physics) {
    this.camera = camera;
    this.physics = physics;
    this.yaw = 0; // 0 = looking toward +Z
    this.pitch = 0.18;
    this.distance = 4.6;
    this.targetDistance = 4.6;
    this.currentDist = 4.6;
    this.shoulder = 0.45;
    this.sensitivity = 1;
    this.invertY = false;
    this.target = new THREE.Vector3();
    this.smoothedTarget = new THREE.Vector3();
    this.excludeCollider = null;
    this.cinematic = null;
    this.first = true;
    this.spring = {};
    this.trauma = 0;
    this.shakeT = 0;
    this.waterHeightAt = null; // (x, z) => surface y, keeps the lens out of the waterline
    this.lockAt = null; // Vector3: a locked-on enemy to keep in view
    this.lockH = 1.75; // its height: a giant needs the camera further back and higher
    this.lockW = 0;
    this.lift = 0;
    this.override = null; // (dt, camera) => void: a shot that owns the camera (a finisher)
    this.shakeScale = 1; // Settings: camera shake 0..1
  }

  // Camera shake: trauma in [0,1] decays; offset grows with trauma^2 (feels right at any size).
  shake(amount) {
    this.trauma = Math.min(1, this.trauma + amount * this.shakeScale);
  }

  /**
   * A heavy blow's punch: the lens lunges in toward the action (amount: metres, ~0.4 a heavy cut)
   * and springs back out over a few frames, the frame tightening on the impact.
   */
  punch(amount) {
    this.punchV = (this.punchV || 0) + amount * this.shakeScale * 22;
  }

  /** A blow's jolt: the lens is knocked a few centimetres along `dir` (world, xz) and springs
   *  back, with a twitch of roll. Sharper than the shake: one beat, not a rumble. */
  kick(dir, amount) {
    const a = amount * this.shakeScale;
    const l = Math.hypot(dir.x, dir.z) || 1;
    this.kickV = this.kickV || new THREE.Vector3();
    this.kickP = this.kickP || new THREE.Vector3();
    this.kickV.x += (dir.x / l) * a * 40;
    this.kickV.z += (dir.z / l) * a * 40;
    this.kickV.y -= a * 18;
    this.rollV = (this.rollV || 0) + a * (Math.random() < 0.5 ? -1 : 1) * 6;
  }

  get forward() {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  get right() {
    return new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
  }

  // Scripted shot: list of { pos, look, t } keyframes (seconds), Catmull-Rom between them.
  playCinematic(keys, onDone) {
    const dur = keys[keys.length - 1].t;
    this.cinematic = {
      keys,
      t: 0,
      dur,
      onDone,
      posCurve: new THREE.CatmullRomCurve3(keys.map((k) => k.pos)),
      lookCurve: new THREE.CatmullRomCurve3(keys.map((k) => k.look)),
    };
  }

  /** Ease out of the shot on screen now: for `secs` the follow camera is blended in from it. */
  blendFrom(secs = 0.7) {
    this.blend = { pos: this.camera.position.clone(), q: this.camera.quaternion.clone(), t: 0, dur: secs };
  }

  skipCinematic() {
    if (!this.cinematic) return;
    const done = this.cinematic.onDone;
    this.cinematic = null;
    this.first = true;
    done?.();
  }

  update(dt, input, focus, opts = {}) {
    if (this.override) {
      this.override(dt, this.camera);
      // (the shake still plays over a scripted shot)
      this.trauma = Math.max(0, this.trauma - dt * 1.6);
      this.shakeT += dt * 30;
      const sh = this.trauma * this.trauma * 0.12;
      if (sh > 1e-4) this.camera.position.set(this.camera.position.x + Math.sin(this.shakeT * 1.1) * sh, this.camera.position.y + Math.sin(this.shakeT * 1.7 + 1.3) * sh, this.camera.position.z + Math.sin(this.shakeT * 1.3 + 2.1) * sh);
      return;
    }
    if (this.cinematic) {
      const c = this.cinematic;
      c.t += dt;
      const k = Math.min(1, c.t / c.dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      this.camera.position.copy(c.posCurve.getPoint(e));
      this.camera.lookAt(c.lookCurve.getPoint(e));
      if (k >= 1) this.skipCinematic();
      return;
    }

    const look = input.look();
    const s = 0.0022 * this.sensitivity;
    // the climbing view (a wall run, a hang, ledge to ledge): in closer and a little below him,
    // looking up the face to where he is going, squared to the wall behind him. A touch of the
    // mouse gives the view back to the player for a moment.
    if (Math.abs(look.dx) + Math.abs(look.dy) > 0.5) this.userLook = 1.6;
    this.userLook = Math.max(0, (this.userLook || 0) - dt);
    const climb = opts.climb && !this.lockAt ? opts.climb : null;
    this.climbW = damp(this.climbW || 0, climb ? 1 : 0, climb ? 2.4 : 1.6, dt);
    if (climb && this.userLook <= 0) {
      this.pitch = damp(this.pitch, -0.04, 2.0, dt);
      this.yaw = dampAngle(this.yaw, climb.yaw, 1.8, dt);
    }
    this.lockW = damp(this.lockW, this.lockAt ? 1 : 0, 5, dt);
    // a fight round him (not locked on): the lens comes in closer and lower and leans toward the
    // nearest enemy, so the two of them fill the frame (fightAt: Game, each frame)
    const fight = this.fightAt && !this.lockAt && !climb;
    this.fightW = damp(this.fightW || 0, fight ? 1 : 0, fight ? 1.6 : 0.8, dt);
    // ... and eases round to over his shoulder: a little off the line from him to it, so he
    // never stands in front of what he is fighting (only while the player isn't steering the view)
    if (fight && this.userLook <= 0) {
      const dx = this.fightAt.x - focus.x;
      const dz = this.fightAt.z - focus.z;
      if (Math.hypot(dx, dz) > 0.8) {
        // over whichever shoulder has room behind it: the lens never swings into a takht or under
        // an umbrella (that squeezes it in onto his head); with no room either side it is left be
        this.sideT = (this.sideT || 0) - dt;
        if (this.sideT <= 0) {
          this.sideT = 0.5;
          const base = Math.atan2(dx, dz);
          const room = (off) => {
            const y = base + off;
            const d = _probe.set(-Math.sin(y) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(y) * Math.cos(this.pitch));
            const h = this.physics.sphereCast(_pivot.set(focus.x, focus.y + 1.55, focus.z), d, 0.3, this.distance + 0.3, this.excludeCollider, GROUPS.ignorePeople);
            return h === null ? this.distance + 0.3 : h;
          };
          const a = room(0.5);
          const b = room(-0.5);
          const want = this.distance * 0.85;
          // (keep the side it is on unless the other is clearly better)
          const cur = this.fightSide ?? 0.5;
          const curRoom = cur > 0 ? a : b;
          const othRoom = cur > 0 ? b : a;
          if (curRoom < want && othRoom > curRoom + 0.4) this.fightSide = -cur;
          else this.fightSide = cur;
          this.fightOk = Math.max(a, b) >= want * 0.8;
        }
        if (this.fightOk) this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz) + this.fightSide, 1.1, dt);
      }
    }
    if (this.lockAt) {
      // turn to frame the enemy: aim past the hero at it, looking a little down on both
      const dx = this.lockAt.x - focus.x;
      const dz = this.lockAt.z - focus.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.6) this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 6.5, dt);
      const big = Math.max(0, this.lockH - 1.9);
      const wantPitch = clamp(0.24 - d * 0.008 + (focus.y + 1.5 - this.lockAt.y) * 0.08 + big * 0.05, 0.08, 0.52);
      this.pitch = damp(this.pitch, wantPitch, 3.5, dt);
    } else {
      this.yaw -= look.dx * s;
      this.pitch += look.dy * s * (this.invertY ? -1 : 1);
    }
    this.pitch = clamp(this.pitch, -0.55, 1.2);
    if (input.wheel) this.targetDistance = clamp(this.targetDistance + input.wheel * 0.6, 1.8, 12);
    // locked on: in tight on the two of them (a giant still needs the lens further back)
    const want = ((opts.distance ?? this.targetDistance) + this.lockW * (0.3 + Math.max(0, this.lockH - 1.9) * 0.95)) * (1 - this.climbW * 0.12) * (1 - (this.fightW || 0) * 0.22);
    this.distance = damp(this.distance, want, 6, dt);
    // the punch: a stiff spring on the boom (in fast, back out), stepped finely so a long frame
    // can't fling it, and never more than a short lunge
    for (let h = Math.min(dt, 0.1), n = Math.ceil(h / 0.004), i = 0; i < n; i++) {
      const s = h / n;
      this.punchV = ((this.punchV || 0) - 380 * (this.punchP || 0) * s) * (1 - 24 * s);
      this.punchP = Math.max(-0.3, Math.min(0.7, (this.punchP || 0) + this.punchV * s));
    }

    // Follow target (head height) through a critically damped spring: tight horizontally, softer
    // vertically so step-ups and the swim bob don't jolt the view.
    this.target.copy(focus);
    this.target.y += (opts.height ?? 1.55) + this.climbW * (opts.climb?.up ?? 0.5);
    if (this.first) {
      this.smoothedTarget.copy(this.target);
      this.spring = {};
      this.first = false;
    }
    const st = this.smoothedTarget;
    st.x = smoothDamp(st.x, this.target.x, this.spring, 'x', 0.05, dt);
    st.z = smoothDamp(st.z, this.target.z, this.spring, 'z', 0.05, dt);
    st.y = smoothDamp(st.y, this.target.y, this.spring, 'y', 0.16, dt);

    const cp = Math.cos(this.pitch);
    const dir = new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
    const right = this.right;
    const pivot = this.smoothedTarget.clone().addScaledVector(right, (this.shoulder + (this.fightW || 0) * (this.fightSide < 0 ? -1.25 : 0.35)) * Math.min(1, this.distance / 4));
    if (this.lockAt && this.lockW > 0.01) {
      // frame both: the point we orbit slides a third of the way toward the enemy, and up a bit
      // (less as the lens is pulled in against a wall or a canopy: a short boom must never carry
      // the pivot past him, the camera ending up in front of him looking at the pack)
      const room = clamp(((this.currentDist ?? this.distance) - 1.3) / 2.4, 0, 1);
      const k = this.lockW * 0.32 * room;
      pivot.x += (this.lockAt.x - pivot.x) * k;
      pivot.z += (this.lockAt.z - pivot.z) * k;
      pivot.y += this.lockW * 0.25 + Math.max(0, this.lockAt.y - pivot.y) * k * 0.6;
    }
    if ((this.fightW || 0) > 0.01 && this.fightAt) {
      const room = clamp(((this.currentDist ?? this.distance) - 1.3) / 2.4, 0, 1);
      const k = this.fightW * 0.18 * room;
      pivot.x += (this.fightAt.x - pivot.x) * k;
      pivot.z += (this.fightAt.z - pivot.z) * k;
      pivot.y -= this.fightW * 0.12;
    }

    // Collision: sweep a small sphere (the lens) so the camera never slips through wall edges.
    let dist = this.distance;
    let hit = this.physics.sphereCast(pivot, dir, 0.22, this.distance, this.excludeCollider, GROUPS.ignorePeople);
    // squeezed against a wall or a step behind: rise up over the shoulder rather than end up
    // inside the hero's arms (look down at him a little more)
    const squeezed = hit !== null && hit < Math.min(1.7, this.distance * 0.55) ? 1 : 0;
    this.lift = damp(this.lift, squeezed, squeezed ? 6 : 2, dt);
    if (this.lift > 0.02) {
      pivot.y += this.lift * 0.9;
      dir.y += this.lift * 0.55;
      dir.normalize();
      hit = this.physics.sphereCast(pivot, dir, 0.22, this.distance, this.excludeCollider, GROUPS.ignorePeople);
    }
    if (hit !== null) dist = Math.max(0.9, hit - 0.05);
    // pull in instantly, ease back out
    this.currentDist = dist < this.currentDist ? dist : smoothDamp(this.currentDist, dist, this.spring, 'd', 0.35, dt);

    const cam = this.camera.position.copy(pivot).addScaledVector(dir, Math.max(0.8, this.currentDist - (this.punchP || 0)));
    // Never sit right on the waterline (half-under views look broken): pick a side.
    if (this.waterHeightAt) {
      const s = this.waterHeightAt(cam.x, cam.z);
      if (cam.y > s - 0.3 && cam.y < s + 0.25) cam.y = pivot.y > s ? s + 0.25 : s - 0.3;
    }
    // a handheld breath in the quiet: standing still, no fight, no input, the lens drifts a few
    // centimetres and rolls a hair, slow (as an operator's shoulder does), gone the moment he moves
    {
      const still = !this.fightAt && !this.lockAt && (this.userLook || 0) <= 0 && Math.hypot(this.target.x - (this._lastT?.x ?? this.target.x), this.target.z - (this._lastT?.z ?? this.target.z)) < 0.002;
      (this._lastT ||= new THREE.Vector3()).copy(this.target);
      this.quietT = still ? (this.quietT || 0) + dt : 0;
      this.breathW = damp(this.breathW || 0, this.quietT > 1.5 ? 1 : 0, this.quietT > 1.5 ? 0.6 : 4, dt);
      this.breathT = (this.breathT || 0) + dt;
      if (this.breathW > 0.01) {
        const t = this.breathT;
        const a = this.breathW * this.shakeScale;
        cam.x += (Math.sin(t * 0.37) * 0.6 + Math.sin(t * 0.83 + 1.1) * 0.4) * 0.035 * a;
        cam.y += (Math.sin(t * 0.29 + 2.0) * 0.6 + Math.sin(t * 0.71) * 0.4) * 0.025 * a;
        cam.z += (Math.sin(t * 0.41 + 0.7) * 0.6 + Math.sin(t * 0.67 + 2.4) * 0.4) * 0.035 * a;
        this.breathRoll = Math.sin(t * 0.23 + 0.5) * 0.006 * a;
      } else this.breathRoll = 0;
    }
    // Shake
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.shakeT += dt * 30;
    const sh = this.trauma * this.trauma * 0.12;
    if (sh > 1e-4) {
      cam.x += Math.sin(this.shakeT * 1.1) * sh;
      cam.y += Math.sin(this.shakeT * 1.7 + 1.3) * sh;
      cam.z += Math.sin(this.shakeT * 1.3 + 2.1) * sh;
    }
    this.camera.lookAt(pivot.x, pivot.y + 0.05, pivot.z);
    if (this.breathRoll) this.camera.rotateZ(this.breathRoll);
    // the blow's kick (a stiff spring: out and back inside a tenth of a second)
    if (this.kickV) {
      const K = this.kickP;
      for (let h = Math.min(dt, 0.1), n = Math.ceil(h / 0.004), i = 0; i < n; i++) {
        const s = h / n;
        this.kickV.addScaledVector(K, -420 * s).multiplyScalar(1 - 26 * s);
        K.addScaledVector(this.kickV, s);
        this.rollV += -420 * (this.roll || 0) * s;
        this.rollV *= 1 - 26 * s;
        this.roll = (this.roll || 0) + this.rollV * s;
      }
      K.clampLength(0, 0.35);
      this.roll = Math.max(-0.08, Math.min(0.08, this.roll));
      if (K.lengthSq() > 1e-8 || Math.abs(this.roll) > 1e-5) {
        cam.add(K);
        this.camera.rotateZ(this.roll);
      }
    }
    if (this.blend) {
      const b = this.blend;
      b.t += dt;
      const k = Math.min(1, b.t / b.dur);
      const e = k * k * (3 - 2 * k);
      cam.lerpVectors(b.pos, cam, e);
      _q.copy(this.camera.quaternion);
      this.camera.quaternion.copy(b.q).slerp(_q, e);
      if (k >= 1) this.blend = null;
    }
  }
}
