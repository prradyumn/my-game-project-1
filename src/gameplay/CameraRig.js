import * as THREE from 'three';
import { GROUPS } from '../core/Physics.js';
import { clamp, damp, smoothDamp } from '../utils/math.js';

// Third-person orbit camera: mouse/stick look, wheel zoom, collision so it never clips into
// walls, plus a scripted cinematic mode for the opening shot.

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
  }

  // Camera shake: trauma in [0,1] decays; offset grows with trauma^2 (feels right at any size).
  shake(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
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

  skipCinematic() {
    if (!this.cinematic) return;
    const done = this.cinematic.onDone;
    this.cinematic = null;
    this.first = true;
    done?.();
  }

  update(dt, input, focus, opts = {}) {
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
    this.yaw -= look.dx * s;
    this.pitch += look.dy * s * (this.invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -0.55, 1.2);
    if (input.wheel) this.targetDistance = clamp(this.targetDistance + input.wheel * 0.6, 1.8, 12);
    const want = opts.distance ?? this.targetDistance;
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

    // Collision: sweep a small sphere (the lens) so the camera never slips through wall edges.
    let dist = this.distance;
    const hit = this.physics.sphereCast(pivot, dir, 0.22, this.distance, this.excludeCollider, GROUPS.ignorePeople);
    if (hit !== null) dist = Math.max(0.5, hit - 0.05);
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
  }
}
