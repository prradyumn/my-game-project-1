import * as THREE from 'three';
import { GROUPS } from '../core/Physics.js';
import { clamp, damp, dampAngle, smoothDamp } from '../utils/math.js';

const _q = new THREE.Quaternion();

// Third-person orbit camera: mouse/stick look, wheel zoom, collision so it never clips into
// walls, plus a scripted cinematic mode for the opening shot. With a lock-on target (lockAt) the
// view turns to keep the enemy framed beside the hero; the mouse then only flicks between targets.

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
    this.lockW = damp(this.lockW, this.lockAt ? 1 : 0, 5, dt);
    if (this.lockAt) {
      // turn to frame the enemy: aim past the hero at it, looking a little down on both
      const dx = this.lockAt.x - focus.x;
      const dz = this.lockAt.z - focus.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.6) this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 6.5, dt);
      const big = Math.max(0, this.lockH - 1.9);
      const wantPitch = clamp(0.3 - d * 0.008 + (focus.y + 1.5 - this.lockAt.y) * 0.08 + big * 0.03, 0.1, 0.52);
      this.pitch = damp(this.pitch, wantPitch, 3.5, dt);
    } else {
      this.yaw -= look.dx * s;
      this.pitch += look.dy * s * (this.invertY ? -1 : 1);
    }
    this.pitch = clamp(this.pitch, -0.55, 1.2);
    if (input.wheel) this.targetDistance = clamp(this.targetDistance + input.wheel * 0.6, 1.8, 12);
    const want = (opts.distance ?? this.targetDistance) + this.lockW * (0.9 + Math.max(0, this.lockH - 1.9) * 0.85);
    this.distance = damp(this.distance, want, 6, dt);

    // Follow target (head height) through a critically damped spring: tight horizontally, softer
    // vertically so step-ups and the swim bob don't jolt the view.
    this.target.copy(focus);
    this.target.y += opts.height ?? 1.55;
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
    const pivot = this.smoothedTarget.clone().addScaledVector(right, this.shoulder * Math.min(1, this.distance / 4));
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

    const cam = this.camera.position.copy(pivot).addScaledVector(dir, this.currentDist);
    // Never sit right on the waterline (half-under views look broken): pick a side.
    if (this.waterHeightAt) {
      const s = this.waterHeightAt(cam.x, cam.z);
      if (cam.y > s - 0.3 && cam.y < s + 0.25) cam.y = pivot.y > s ? s + 0.25 : s - 0.3;
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
