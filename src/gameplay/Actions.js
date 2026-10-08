import * as THREE from 'three';
import { GROUPS } from '../core/Physics.js';
import { PLAYER } from '../config.js';
import { dampAngle, lerp, smoothstep } from '../utils/math.js';
import { frameAtX, groundHeight } from '../world/WorldLayout.js';
import { solveTwoBone } from '../utils/bones.js';

// Prady's actions beyond walking and swimming, each driven by motion capture (CharacterAnimator
// play()) with the controller and a little IK doing the rest:
//
//   pranam        G: hands folded at the chest, a small bow (people nearby answer)
//   float a diya  F on the bottom steps: crouch, reach down, set it on the water
//   Ganga Snan    E waist-deep in the river: hands folded, the holy dip, and at dawn arghya
//                 (water poured from a brass lota toward the rising sun)
//   dive          Space at the water's edge (or from the boat) when the arc lands in deep
//                 water: take-off crouch, a swan arc, head-first into the river
//   climb         walking into a takht, a platform or a low wall (0.36–1.05 m): step up, hands
//                 on the edge when it is high
//   meditate      M: sit cross-legged; time-lapses the sky until you move
//
// While an action owns the body, fixed() moves the capsule itself and the Player skips its
// own movement for that step.

const FEET = PLAYER.halfHeight + PLAYER.radius;
const DOWN = { x: 0, y: -1, z: 0 };
const UP = { x: 0, y: 1, z: 0 };
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _t = new THREE.Vector3();
const _pole = new THREE.Vector3();

export class PradyActions {
  constructor(player, deps) {
    this.p = player;
    this.physics = deps.physics;
    this.water = deps.water;
    this.fx = deps.fx;
    this.anim = deps.animator;
    this.diyas = deps.diyas;
    this.ripples = deps.ripples;
    this.splash = deps.splash;
    this.sky = deps.sky;
    this.camRig = deps.camRig;
    this.ui = deps.ui;
    this.audio = deps.audio;
    this.onEvent = deps.onEvent || (() => {});
    this.act = null;
    this.climbHold = 0;
    this.wet = 0; // 1 right out of the river, dries over a minute (wet skin + footprints)
    this.seen = new Set();
    // brass lota for arghya
    const lota = new THREE.LatheGeometry(
      [[0.0, -0.07], [0.055, -0.065], [0.075, -0.02], [0.07, 0.03], [0.04, 0.06], [0.045, 0.085], [0.05, 0.09]].map(([x, y]) => new THREE.Vector2(x, y)),
      16
    );
    this.lota = new THREE.Mesh(lota, new THREE.MeshStandardMaterial({ color: 0xd9a441, metalness: 1, roughness: 0.3 }));
    this.lota.visible = false;
    this.lota.castShadow = true;
    deps.scene.add(this.lota);
  }

  get busy() {
    return !!this.act;
  }

  get type() {
    return this.act?.type ?? null;
  }

  hint(id, title, text) {
    if (this.seen.has(id)) return;
    this.seen.add(id);
    this.ui?.toast(title, text, 5);
  }

  facing() {
    return { x: Math.sin(this.p.yaw), z: Math.cos(this.p.yaw) };
  }

  feetY() {
    return this.p.position.y - FEET;
  }

  // ---------------------------------------------------------------- pranam (G)
  pranam() {
    const p = this.p;
    if (this.act || p.state !== 'ground' || p.speed > 0.6) return false;
    return this.anim.emote('pranam');
  }

  // ---------------------------------------------------------------- float a diya (F)
  // returns true when it handled the request (crouch on the steps); otherwise the caller
  // launches straight from the water / boat as before
  floatDiya() {
    const p = this.p;
    if (this.act || p.state !== 'ground' || p.speed > 0.8) return false;
    const spot = this.waterNear(1.7);
    if (!spot) return false;
    this.act = { type: 'diya', t: 0, yaw: Math.atan2(spot.dx, spot.dz), spot, done: false };
    this.anim.play('crouchReach', { cancelOnMove: false, fadeIn: 0.3, fadeOut: 0.35, noLook: true });
    return true;
  }

  // water within reach in front of the feet (toward the river), for the diya and the dip
  waterNear(reach) {
    const p = this.p.position;
    const f = frameAtX(p.x);
    const feet = this.feetY();
    for (let d = 0.5; d <= reach; d += 0.2) {
      const x = p.x + f.N.x * d;
      const z = p.z + f.N.z * d;
      const s = this.water.heightAt(x, z);
      if (s - groundHeight(x, z) > 0.08 && feet - s < 1.15 && feet - s > -0.45) return { x, z, s, dx: f.N.x, dz: f.N.z };
    }
    return null;
  }

  // ---------------------------------------------------------------- Ganga Snan (E in the river)
  holyDipAvailable() {
    const p = this.p;
    if (this.act || p.state !== 'ground' || p.speed > 0.5) return false;
    const depth = this.water.heightAt(p.position.x, p.position.z) - this.feetY();
    return depth > 0.55 && depth < 1.45;
  }

  startHolyDip() {
    if (!this.holyDipAvailable()) return false;
    const h = this.sky.hours;
    const dawn = h > 5 && h < 9.5;
    // face the river (and the rising sun at dawn)
    const f = frameAtX(this.p.position.x);
    this.act = { type: 'snan', t: 0, yaw: Math.atan2(f.N.x, f.N.z), dawn, splashed: false, rings: 0 };
    this.anim.play('pranam', { loop: true, cancelOnMove: false, bow: 0.22, fadeIn: 0.4, fadeOut: 0.4 });
    return true;
  }

  // ---------------------------------------------------------------- dive (Space at the edge)
  // Simulate the arc; dive only when it lands head-first in water at least 1.5 m deep.
  predictDive(x, y, z, fx, fz, vh, vy) {
    let px = x;
    let py = y;
    let pz = z;
    let vY = vy;
    const dt = 0.04;
    for (let t = 0; t < 1.8; t += dt) {
      px += fx * vh * dt;
      pz += fz * vh * dt;
      vY -= 15 * dt;
      py += vY * dt;
      const g = groundHeight(px, pz);
      const s = this.water.heightAt(px, pz);
      if (py <= s && s - g >= 1.5) return { x: px, z: pz, t };
      if (py <= g + 0.2) return null;
    }
    return null;
  }

  tryDive() {
    const p = this.p;
    if (this.act || p.state !== 'ground' || !p.grounded) return false;
    const f = this.facing();
    const feet = this.feetY();
    if (feet < this.water.heightAt(p.position.x, p.position.z) + 0.15) return false; // standing in the water: swim instead
    const entry = this.predictDive(p.position.x, feet + 0.9, p.position.z, f.x, f.z, 4.4, 4.0);
    if (!entry) return false;
    this.startDive(f, false);
    return true;
  }

  diveFromBoat(boat) {
    const p = this.p;
    if (this.act || p.state !== 'boat') return false;
    // over the side, away from the ghat if possible
    const r = { x: Math.cos(boat.yaw), z: -Math.sin(boat.yaw) };
    const toRiver = frameAtX(boat.x).N;
    const s = r.x * toRiver.x + r.z * toRiver.z >= 0 ? 1 : -1;
    const f = { x: r.x * s, z: r.z * s };
    const deck = this.water.heightAt(boat.x, boat.z) + 0.35;
    p.exitBoat(boat.x + f.x * 0.75, deck, boat.z + f.z * 0.75);
    p.yaw = Math.atan2(f.x, f.z);
    p.prevYaw = p.yaw;
    this.startDive(f, true);
    return true;
  }

  startDive(f, fromBoat) {
    this.act = { type: 'dive', t: 0, phase: 'takeoff', f, fromBoat };
    this.anim.play('diveTakeoff', { timeScale: 1.55, clamp: true, cancelOnMove: false, fadeIn: 0.1, noFootIK: fromBoat });
    this.hint('dive', 'Ghat dive', 'Space at the water’s edge or from the boat, when the water below is deep.');
  }

  // ---------------------------------------------------------------- climb (walk into it)
  checkClimb(dt) {
    const p = this.p;
    if (this.act || p.state !== 'ground' || !p.grounded || p.cmd.mag < 0.3) {
      this.climbHold = 0;
      return;
    }
    const w = p.cmd.wish;
    if (w.lengthSq() < 0.01) return;
    const feet = this.feetY();
    const o = { x: p.position.x, y: feet + 0.45, z: p.position.z };
    const hit = this.physics.castRayNormal(o, { x: w.x, y: 0, z: w.z }, 0.72, p.collider, GROUPS.climb);
    if (!hit || Math.abs(hit.ny) > 0.35) {
      this.climbHold = 0;
      return;
    }
    const hx = o.x + w.x * hit.toi;
    const hz = o.z + w.z * hit.toi;
    const top = this.topAt(hx + w.x * 0.3, hz + w.z * 0.3, feet + 1.4);
    const top2 = this.topAt(hx + w.x * 0.7, hz + w.z * 0.7, feet + 1.4);
    if (top === null || top2 === null || Math.abs(top - top2) > 0.1) return;
    const h = top - feet;
    if (h < 0.36 || h > 1.05) return;
    // room to stand on top
    const head = this.physics.sphereCast({ x: hx + w.x * 0.5, y: top + 0.4, z: hz + w.z * 0.5 }, UP, 0.26, 1.4, p.collider, GROUPS.climb);
    if (head !== null) return;
    this.climbHold += dt;
    if (this.climbHold < 0.12) return;
    this.climbHold = 0;
    const T = 0.55 + h * 0.6;
    const yaw = Math.atan2(w.x, w.z);
    this.act = {
      type: 'climb',
      t: 0,
      T,
      h,
      yaw,
      f: { x: w.x, z: w.z },
      p0: p.position.clone(),
      p1: new THREE.Vector3(hx + w.x * 0.42, top + FEET + 0.03, hz + w.z * 0.42),
      edge: new THREE.Vector3(hx, top, hz),
    };
    this.anim.play('stepUp', { timeScale: (1.05 / T) * 1.15, cancelOnMove: false, fadeIn: 0.12, fadeOut: 0.25, noFootIK: true });
  }

  topAt(x, z, fromY) {
    const d = this.physics.castRay({ x, y: fromY, z }, DOWN, 1.6, this.p.collider, GROUPS.climb);
    return d === null ? null : fromY - d;
  }

  // ---------------------------------------------------------------- meditate (M)
  toggleMeditate() {
    const p = this.p;
    if (this.act?.type === 'meditate') {
      this.rise();
      return true;
    }
    if (this.act || p.state !== 'ground' || p.speed > 0.4) return false;
    this.act = { type: 'meditate', phase: 'down', t: 0, timeSpeed: this.sky.timeSpeed, camDist: this.camRig.targetDistance };
    this.anim.play('sitToStand', { reverse: true, timeScale: 2.3, clamp: true, cancelOnMove: false, noLook: true, fadeIn: 0.3 });
    this.hint('meditate', 'Dhyana', 'Time flows past while Prady meditates. Move to rise.');
    return true;
  }

  rise() {
    const a = this.act;
    if (!a || a.type !== 'meditate' || a.phase === 'up') return;
    a.phase = 'up';
    a.t = 0;
    this.sky.timeSpeed = a.timeSpeed;
    this.camRig.targetDistance = a.camDist;
    this.anim.play('sitToStand', { timeScale: 2.3, cancelOnMove: false, noLook: true, fadeIn: 0.3, fadeOut: 0.35 });
  }

  // ---------------------------------------------------------------- per physics step
  /** Returns true when the current action moved the body this step (the Player skips its own). */
  fixed(dt) {
    const a = this.act;
    const p = this.p;
    this.wet = Math.max(0, this.wet - dt / 70);
    if (p.state === 'swim' || p.state === 'dive') this.wet = 1;
    if (!a) return false;
    a.t += dt;
    p.speed = 0;
    switch (a.type) {
      case 'diya':
        p.velocity.set(0, 0, 0);
        p.yaw = dampAngle(p.yaw, a.yaw, 8, dt);
        if (!a.done && a.t > 0.95) {
          a.done = true;
          const hand = this.anim.boneWorld('RightHand', _v) || _v.set(a.spot.x, a.spot.s, a.spot.z);
          // set it down on the water just beyond the hand
          const x = hand.x + a.spot.dx * 0.25;
          const z = hand.z + a.spot.dz * 0.25;
          const sx = this.water.heightAt(x, z) - groundHeight(x, z) > 0.05 ? x : a.spot.x;
          const sz = sx === x ? z : a.spot.z;
          this.diyas.launch(sx, sz);
          this.ripples.spawn(sx, this.water.heightAt(sx, sz), sz, 0.9, 1.6);
          this.onEvent('diya', { x: sx, z: sz });
        }
        if (a.t > 1.8) this.end();
        return this.hold(dt);
      case 'snan':
        return this.snanStep(a, dt);
      case 'dive':
        return this.diveStep(a, dt);
      case 'climb':
        return this.climbStep(a, dt);
      case 'meditate':
        return this.meditateStep(a, dt);
      default:
        return false;
    }
  }

  // stand still where we are (the controller still holds us on the ground)
  hold(dt) {
    const p = this.p;
    p.prevPosition.copy(p.position);
    p.prevYaw = p.yaw;
    p.body.setNextKinematicTranslation(p.position);
    p.velocity.set(0, 0, 0);
    void dt;
    return true;
  }

  end() {
    this.act = null;
    this.p.visualDip = 0;
    this.p.diving = false;
    this.lota.visible = false;
  }

  snanStep(a, dt) {
    const p = this.p;
    p.yaw = dampAngle(p.yaw, a.yaw, 4, dt);
    const t = a.t;
    // 1.2–3.2 s: down under the surface and up again
    const dip = smoothstep(1.2, 1.75, t) * (1 - smoothstep(2.35, 3.1, t));
    p.visualDip = -1.3 * dip;
    const x = p.position.x;
    const z = p.position.z;
    const s = this.water.heightAt(x, z);
    if (t > 1.25 && a.rings === 0) {
      a.rings = 1;
      this.ripples.spawn(x, s, z, 1.6, 2.0);
    }
    if (t > 2.75 && !a.splashed) {
      a.splashed = true;
      this.fx.splash(x, s, z, 0.45);
      this.wet = 1;
    }
    const total = a.dawn ? 7.2 : 4.0;
    if (a.dawn && t > 3.4 && !a.arghya) {
      a.arghya = true;
      this.anim.stop(0.5);
    }
    if (t > total) {
      this.anim.stop(0.4);
      this.end();
      if (!this.seen.has('snan')) {
        this.seen.add('snan');
        this.ui?.toast('Ganga Snan', a.dawn ? 'At dawn, Prady offers arghya to the rising Sun.' : 'Mother Ganga washes the dust of the road away.', 6);
      }
      this.onEvent('snan', { dawn: a.dawn });
    }
    return this.hold(dt);
  }

  diveStep(a, dt) {
    const p = this.p;
    if (a.phase === 'takeoff') {
      p.yaw = dampAngle(p.yaw, Math.atan2(a.f.x, a.f.z), 10, dt);
      if (a.t < 0.36) return this.hold(dt);
      a.phase = 'air';
      p.velocity.set(a.f.x * 4.4, 4.0, a.f.z * 4.4);
      p.state = 'air';
      p.grounded = false;
      p.diving = true;
      this.fx.land?.(0.5);
    }
    // ballistic, with the controller only to stop us on walls
    p.prevPosition.copy(p.position);
    p.prevYaw = p.yaw;
    p.velocity.y -= 15 * dt;
    const want = _v.set(p.velocity.x * dt, p.velocity.y * dt, p.velocity.z * dt);
    p.kcc.computeColliderMovement(p.collider, want, undefined, GROUPS.mover);
    const m = p.kcc.computedMovement();
    p.position.x += m.x;
    p.position.y += m.y;
    p.position.z += m.z;
    p.body.setNextKinematicTranslation(p.position);
    const s = this.water.heightAt(p.position.x, p.position.z);
    // head-first entry: the hips go under
    if (p.position.y < s + 0.15) {
      this.fx.splash(p.position.x, s, p.position.z, 1.3);
      this.ripples.spawn(p.position.x, s, p.position.z, 3, 2.4);
      p.state = 'dive';
      p.velocity.set(a.f.x * 2.4, -2.6, a.f.z * 2.4);
      this.anim.stop(0.35);
      this.wet = 1;
      this.end();
      this.onEvent('dive', {});
      return true;
    }
    if (p.kcc.computedGrounded() && p.velocity.y < 0) {
      // landed on something after all
      p.state = 'ground';
      p.grounded = true;
      this.anim.stop(0.2);
      this.end();
    }
    return true;
  }

  climbStep(a, dt) {
    const p = this.p;
    const k = Math.min(1, a.t / a.T);
    p.prevPosition.copy(p.position);
    p.prevYaw = p.yaw;
    p.yaw = dampAngle(p.yaw, a.yaw, 10, dt);
    const ky = smoothstep(0.04, 0.62, k);
    const kh = smoothstep(0.26, 1.0, k);
    p.position.set(lerp(a.p0.x, a.p1.x, kh), lerp(a.p0.y, a.p1.y, ky), lerp(a.p0.z, a.p1.z, kh));
    p.body.setNextKinematicTranslation(p.position);
    p.velocity.set(0, 0, 0);
    if (k >= 1) {
      p.grounded = true;
      p.state = 'ground';
      this.end();
    }
    return true;
  }

  meditateStep(a, dt) {
    const p = this.p;
    if (a.phase === 'down' && this.anim.actionLeft() < 0.12) {
      a.phase = 'hold';
      a.t = 0;
      this.anim.play('meditate', { loop: true, cancelOnMove: false, noLook: true, fadeIn: 0.35, fadeOut: 0.3 });
      this.audio?.play('bell', { volume: 0.35 });
    }
    if (a.phase === 'hold') {
      // the sky time-lapses; the camera drifts back and slowly around
      this.sky.timeSpeed = lerp(a.timeSpeed, 40, smoothstep(0.5, 3, a.t));
      this.camRig.targetDistance = lerp(a.camDist, 5.6, smoothstep(0, 2.5, a.t));
      this.camRig.yaw += dt * 0.07;
      if (p.cmd.mag > 0.3 || p.cmd.jumpHeld) this.rise();
    }
    if (a.phase === 'up' && this.anim.actionLeft() < 0.35) this.end();
    return this.hold(dt);
  }

  // ---------------------------------------------------------------- per rendered frame (after the animator)
  late(dt) {
    const a = this.act;
    if (!a) return;
    if (a.type === 'climb' && a.h > 0.55) this.handsOnEdge(a);
    if (a.type === 'snan' && a.arghya) this.arghya(a, dt);
  }

  // palms on the top edge while the body rises (higher ledges)
  handsOnEdge(a) {
    const k = a.t / a.T;
    const w = smoothstep(0.0, 0.14, k) * (1 - smoothstep(0.45, 0.66, k));
    if (w < 0.01) return;
    const r = { x: a.f.z, z: -a.f.x }; // the body's left (facing +Z, left is +X)
    for (const [side, s] of [['Left', 1], ['Right', -1]]) {
      const B = this.anim.loco.b[side];
      if (!B?.arm) continue;
      _t.set(a.edge.x + r.x * 0.24 * s + a.f.x * 0.06, a.edge.y + 0.03, a.edge.z + r.z * 0.24 * s + a.f.z * 0.06);
      _pole.set(-a.f.x, -0.4, -a.f.z).normalize();
      solveTwoBone(B.arm, B.fore, B.hand, _t, _pole, w);
    }
  }

  // both hands raised before the face holding the lota; water pours in a thin stream
  arghya(a, dt) {
    const k = a.t - 3.4;
    const w = smoothstep(0, 0.7, k) * (1 - smoothstep(3.2, 3.8, k));
    const head = this.anim.boneWorld('Head', _v);
    if (!head) return;
    const f = this.facing();
    const lift = 0.1 + 0.08 * smoothstep(0.6, 2.6, k);
    const c = _v2.set(head.x + f.x * 0.42, head.y + lift, head.z + f.z * 0.42);
    const r = { x: f.z, z: -f.x }; // the body's left
    for (const [side, s] of [['Left', 1], ['Right', -1]]) {
      const B = this.anim.loco.b[side];
      if (!B?.arm) continue;
      _t.set(c.x + r.x * 0.07 * s, c.y - 0.05, c.z + r.z * 0.07 * s);
      _pole.set(r.x * s * 0.6, -0.8, r.z * s * 0.6).normalize();
      solveTwoBone(B.arm, B.fore, B.hand, _t, _pole, w);
    }
    this.lota.visible = w > 0.3;
    this.lota.position.set(c.x, c.y + 0.02, c.z);
    // tip it forward as it pours
    this.lota.rotation.set(0, Math.atan2(f.x, f.z), 0);
    this.lota.rotateX(0.35 + 0.5 * smoothstep(0.8, 1.6, k));
    if (w > 0.6 && k > 0.9) {
      a.pourT = (a.pourT || 0) - dt;
      if (a.pourT <= 0) {
        a.pourT = 0.035;
        this.splash.spawn(_t.set(c.x + f.x * 0.09, c.y + 0.04, c.z + f.z * 0.09), 2, 0.25, 0.05);
      }
    }
  }
}

