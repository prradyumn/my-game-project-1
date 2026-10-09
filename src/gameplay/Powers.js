import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SHAKTI } from '../config.js';
import { GROUPS } from '../core/Physics.js';
import { dampAngle } from '../utils/math.js';
import { softDotTexture } from '../utils/textures.js';

// The divine powers, paid for with Shakti (filled by fighting well: blows landed, parries, a
// dodge through a blow, a kill) and unlocked on the Path of the Spirit (Siddhis.js):
//
//   1  Shiva's Damaru  Prady raises the drum and beats it: the third beat is a shockwave that
//                      throws every Asura near him flat (they get up again), shatters pots and
//                      puts out flying fire. Andhaka only staggers.
//   2  Trishul         a thrust that lets go: the trishul flies straight, pins the first Asura it
//                      meets (it reels, held) and after a moment flies back to his hand, cutting
//                      whatever it passes. Press again to call it back early.
//   3  Third Eye       for six seconds the world slows for everyone but Prady (Asuras, their
//                      fire), their veins burn brighter (weak: blows cut deeper), and every hidden
//                      rudraksha shines through the walls.
//
// Gamepad: hold LT, then X / Y / B.

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const KINDS = ['damaru', 'trishul', 'thirdEye'];

function damaruGeometry() {
  // an hourglass drum: two cones tip to tip, skin heads, a red cord at the waist with two beads
  const cone = (flip) => {
    const g = new THREE.CylinderGeometry(0.075, 0.018, 0.08, 16, 1, true);
    g.translate(0, 0.04, 0);
    if (flip) g.rotateX(Math.PI);
    return g;
  };
  const head = (y) => new THREE.CircleGeometry(0.074, 16).rotateX(y > 0 ? -Math.PI / 2 : Math.PI / 2).translate(0, y, 0);
  const wood = mergeGeometries([cone(false), cone(true)].map((g) => g.toNonIndexed()));
  const skin = mergeGeometries([head(0.08), head(-0.08)].map((g) => g.toNonIndexed()));
  const cord = mergeGeometries(
    [new THREE.TorusGeometry(0.02, 0.006, 6, 14).rotateX(Math.PI / 2), new THREE.SphereGeometry(0.012, 8, 6).translate(0.07, 0, 0), new THREE.SphereGeometry(0.012, 8, 6).translate(-0.07, 0, 0), new THREE.CylinderGeometry(0.003, 0.003, 0.05, 4).rotateZ(Math.PI / 2).translate(0.045, 0, 0), new THREE.CylinderGeometry(0.003, 0.003, 0.05, 4).rotateZ(Math.PI / 2).translate(-0.045, 0, 0)].map((g) => g.toNonIndexed())
  );
  const all = mergeGeometries([wood, skin, cord], true);
  return all;
}

function trishulGeometry() {
  // along +Y: the butt at 0, the prongs at the top (1.55 m); a small damaru tied below them
  const shaft = new THREE.CylinderGeometry(0.018, 0.022, 1.3, 10).translate(0, 0.65, 0);
  const collar = new THREE.CylinderGeometry(0.035, 0.03, 0.06, 12).translate(0, 1.3, 0);
  const mid = new THREE.ConeGeometry(0.035, 0.32, 4).scale(1, 1, 0.35).translate(0, 1.5, 0);
  const prong = (s) => {
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      pts.push(new THREE.Vector3(s * (0.03 + Math.sin(t * Math.PI * 0.85) * 0.11 - t * t * 0.05), 1.3 + t * 0.26, 0));
    }
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.012, 5);
    const tip = new THREE.ConeGeometry(0.02, 0.09, 4).scale(1, 1, 0.4).translate(pts[10].x, pts[10].y + 0.04, 0);
    return [tube, tip];
  };
  const bar = new THREE.CylinderGeometry(0.014, 0.014, 0.24, 6).rotateZ(Math.PI / 2).translate(0, 1.33, 0);
  const gold = mergeGeometries([collar, mid, ...prong(1), ...prong(-1), bar].map((g) => g.toNonIndexed()));
  const wood = shaft.toNonIndexed();
  const dam = damaruGeometry().scale(0.55, 0.55, 0.55).rotateZ(Math.PI / 2).translate(0, 1.2, 0.03);
  const drum = dam;
  const ribbon = new THREE.PlaneGeometry(0.05, 0.28).translate(0.03, 1.08, 0.02).toNonIndexed();
  return mergeGeometries([wood, gold, drum, ribbon], true);
}

export class Powers {
  constructor(game) {
    const g = game;
    this.g = g;
    this.shakti = 0;
    this.fillMul = 1;
    this.act = null; // a power being cast: { kind, t, ... }
    this.eye = 0; // Third Eye seconds left
    this.eyeK = 0; // its eased strength (0..1)
    this.shownT = 0;
    // the damaru (in his right hand while it plays)
    const wood = new THREE.MeshStandardMaterial({ color: 0x5a3519, roughness: 0.6 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xe8d6b0, roughness: 0.85 });
    const cord = new THREE.MeshStandardMaterial({ color: 0xa3150c, roughness: 0.7 });
    this.damaru = new THREE.Mesh(damaruGeometry().scale(1.3, 1.3, 1.3), [wood, skin, cord]);
    this.damaru.castShadow = true;
    this.damaru.visible = false;
    g.scene.add(this.damaru);
    // the trishul
    const gold = new THREE.MeshStandardMaterial({ color: 0xffc35a, metalness: 1, roughness: 0.28, emissive: 0x3a1800, emissiveIntensity: 0.4 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0xff6a10, roughness: 0.9, side: THREE.DoubleSide });
    this.trishulMesh = new THREE.Mesh(trishulGeometry(), [wood, gold, wood, cloth]);
    this.trishulMesh.castShadow = true;
    this.trishulMesh.visible = false;
    g.scene.add(this.trishulMesh);
    this.tri = null; // the trishul's flight: { phase: 'out'|'stuck'|'pinned'|'back', pos, vel, ... }
    // the shockwave: a ring of light over the ground, and a disc of dust under it
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.86, 1, 96).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        uniforms: { uK: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform float uK; varying vec2 vUv; void main(){ float a = (1.0 - uK) * (1.0 - uK); gl_FragColor = vec4(vec3(1.6, 1.2, 0.7) * a, a * 0.85); }',
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.ring.frustumCulled = false;
    this.ring.visible = false;
    g.scene.add(this.ring);
    this.shock = null;
    // the third eye: a vertical flame on his brow
    const eyeMat = new THREE.SpriteMaterial({ map: softDotTexture(), color: 0xffd28a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 });
    this.brow = new THREE.Sprite(eyeMat);
    this.brow.scale.set(0.05, 0.11, 1);
    this.brow.visible = false;
    g.scene.add(this.brow);
    this.trail = [];
  }

  serialize() {
    return { shakti: Math.round(this.shakti) };
  }

  restore(d) {
    this.shakti = d?.shakti ?? 0;
  }

  unlocked(kind) {
    return !!this.g.siddhis?.has(kind);
  }

  /** Fighting well fills the meter (x the Kundalini siddhi). */
  gain(n) {
    if (!KINDS.some((k) => this.g.siddhis?.has(k))) return;
    const before = this.shakti;
    this.shakti = Math.min(SHAKTI.max, this.shakti + n * this.fillMul);
    this.shownT = 3;
    // Kundalini: the meter brimming over heals
    if (before < SHAKTI.max && this.shakti >= SHAKTI.max && this.g.siddhis?.has('kundalini')) {
      this.g.health.heal(15);
      this.g.ui.toast('Kundalini rises', 'Shakti is full: prana flows back.', 2.5);
    }
  }

  canCast(kind) {
    const g = this.g;
    const c = g.combat;
    if (!this.unlocked(kind) || this.act || g.finishers?.active) return false;
    if (kind === 'trishul' && this.tri) return false;
    if (kind === 'thirdEye' && this.eye > 0) return false;
    return this.shakti >= SHAKTI.cost[kind] && g.player.state === 'ground' && !c.dead && !c.react && !c.roll;
  }

  /** The power key: cast it (or, with the trishul out, call it back). */
  press(kind) {
    const g = this.g;
    if (kind === 'trishul' && this.tri && this.tri.phase !== 'back') return this.recall();
    if (!this.unlocked(kind)) {
      g.ui.toast('A siddhi not yet earned', 'Open the journal (J) and offer rudraksha and embers on the Path of the Spirit.', 3);
      return;
    }
    if (!this.canCast(kind)) {
      if (this.shakti < SHAKTI.cost[kind]) {
        this.shownT = 3;
        this.denied = 1.4;
        this.deniedNeed = SHAKTI.cost[kind];
        g.audio.play('block', { volume: 0.25, rate: 1.6 });
        // (said plainly once in a while, beside the bar's own hint)
        if (g.health.time - (this.deniedToastAt ?? -99) > 6) {
          this.deniedToastAt = g.health.time;
          g.ui.toast('Not enough Shakti', `It needs ${SHAKTI.cost[kind]}. Blows, parries and kills fill it.`, 2.2);
        }
      }
      return;
    }
    const c = g.combat;
    // whatever he was doing gives way (a strike still winding up, the guard)
    if (c.move) c.cancelMove();
    c.dash = null;
    if (c.blocking) c.setBlock(false, true);
    this.shakti -= SHAKTI.cost[kind];
    this.shownT = 3;
    g.achievements?.event('power', { kind });
    if (kind === 'thirdEye') return this.openEye();
    // (the talwar goes back to its scabbard while the hand is busy)
    c.handBusy = true;
    if (kind === 'damaru') {
      this.act = { kind, t: 0, beats: 0, yaw: g.player.yaw };
      g.animator.play('wave', { timeScale: 1.35, fadeIn: 0.14, fadeOut: 0.3, cancelOnMove: false, noLook: true });
      this.damaru.visible = true;
    } else if (kind === 'trishul') {
      const aim = this.aim();
      this.act = { kind, t: 0, aim, yaw: Math.atan2(aim.dir.x, aim.dir.z), thrown: false };
      g.animator.play('thrust', { timeScale: 1.25, fadeIn: 0.12, fadeOut: 0.25, cancelOnMove: false, noLook: true });
      this.trishulMesh.visible = true;
      g.audio.play('blade-draw', { volume: 0.45, rate: 0.75 });
    }
  }

  /** Where the trishul goes: the locked enemy, the one along the camera, or the camera's line. */
  aim() {
    const g = this.g;
    const p = g.player.position;
    const camYaw = Math.atan2(g.camRig.forward.x, g.camRig.forward.z);
    const L = g.combat.lockTarget;
    const ok = (x) => x.enemy && x.state !== 'rise';
    const t = L?.alive ? L : g.targets.nearest(p, 30, camYaw, 0.45, ok, g.player.feetY) || g.targets.nearest(p, 14, camYaw, 1.1, ok, g.player.feetY);
    if (t) {
      const c = t.lockPoint ? t.lockPoint(new THREE.Vector3()) : new THREE.Vector3(t.pos.x, t.pos.y + 1.1, t.pos.z);
      return { target: t, point: c, dir: _v.set(c.x - p.x, 0, c.z - p.z).normalize().clone() };
    }
    const d = g.camera.getWorldDirection(new THREE.Vector3());
    return { target: null, point: null, dir: d.clone().setY(0).normalize(), dir3: d };
  }

  // ------------------------------------------------------------ fixed 60 Hz (instead of the player)
  fixed(dt) {
    const a = this.act;
    if (!a) return false;
    const p = this.g.player;
    a.t += dt;
    p.prevPosition.copy(p.position);
    p.prevYaw = p.yaw;
    p.yaw = dampAngle(p.yaw, a.yaw, 12, dt);
    p.body.setNextKinematicTranslation(p.position);
    p.velocity.set(0, 0, 0);
    p.speed = 0;
    if (a.kind === 'damaru') this.damaruStep(a);
    else if (a.kind === 'trishul') this.throwStep(a);
    return true;
  }

  damaruStep(a) {
    const g = this.g;
    // three beats, the third is the blast
    const beats = [0.2, 0.38, 0.62];
    while (a.beats < beats.length && a.t >= beats[a.beats]) {
      const last = a.beats === beats.length - 1;
      a.beats++;
      g.audio.play('damaru', { volume: last ? 1 : 0.7, rate: last ? 0.92 : 1.05 });
      if (last) this.blast();
      else g.camRig.shake(0.06);
    }
    if (a.t > 1.05) {
      this.act = null;
      this.damaru.visible = false;
      g.combat.handBusy = false;
      g.animator.stop(0.3);
      if (g.combat.armed) g.combat.stance(3);
    }
  }

  /** The Damaru's shockwave. */
  blast() {
    const g = this.g;
    const P = g.player.position;
    const R = 7.5;
    this.shock = { x: P.x, y: g.player.feetY + 0.08, z: P.z, t: 0, r: R };
    g.camRig.shake(0.55);
    g.cinematics?.impact(0.7);
    g.animals?.startle(P.x, P.z, R * 2);
    g.haptics?.play('damaru');
    g.audio.play('fw-boom', { volume: 0.6, rate: 1.6 });
    g.audio.play('thump', { volume: 1, rate: 0.45 });
    g.asuras.particles.emitDust(P.x, g.player.feetY, P.z, 2.2, 22);
    g.looseProps?.blast(P, R, 10);
    g.projectiles?.douse(P, R);
    let n = 0;
    for (const a of g.asuras.list) {
      if (!a.alive || a.state === 'rise') continue;
      const dx = a.pos.x - P.x;
      const dz = a.pos.z - P.z;
      const d = Math.hypot(dx, dz);
      if (d > R + a.radius || Math.abs(a.pos.y - g.player.feetY) > 3.5) continue;
      const dir = { x: dx / (d || 1), z: dz / (d || 1) };
      a.hit({ k: 1.2 * (1 - (d / R) * 0.4), dir, at: { x: a.pos.x, y: a.pos.y + a.height * 0.5, z: a.pos.z }, sword: false, heavy: true, power: true, dmgOverride: 16 });
      if (a.alive) a.floor(dir, 1.6 - (d / R) * 0.6);
      n++;
    }
    g.achievements?.event('damaru', { n });
  }

  throwStep(a) {
    const g = this.g;
    // re-aim while winding up (the target moves)
    if (!a.thrown && a.t < 0.4) {
      const fresh = a.aim.target?.alive ? a.aim.target : null;
      if (fresh) {
        const c = fresh.lockPoint ? fresh.lockPoint(_v) : _v.set(fresh.pos.x, fresh.pos.y + 1.1, fresh.pos.z);
        a.aim.point = c.clone();
        a.yaw = Math.atan2(c.x - g.player.position.x, c.z - g.player.position.z);
      }
    }
    if (!a.thrown && a.t >= 0.5) {
      a.thrown = true;
      const hand = g.animator.boneWorld('RightHand', new THREE.Vector3()) || g.player.position.clone().setY(g.player.feetY + 1.4);
      let dir;
      if (a.aim.point) {
        // a clear line to it: over a takht, a step's edge or a railing, lift the aim until it is
        const P = a.aim.point;
        for (const lift of [0, 0.4, 0.8, 1.3]) {
          dir = _v.set(P.x, P.y + lift, P.z).sub(hand);
          const d = dir.length();
          dir.normalize();
          const hit = g.physics.castRay(hand, dir, d - 0.4, g.player.collider, GROUPS.missile);
          if (hit === null) break;
        }
      } else dir = (a.aim.dir3 || a.aim.dir).clone().normalize();
      this.tri = { phase: 'out', pos: hand.clone(), vel: dir.clone().multiplyScalar(34), t: 0, travelled: 0, hitSet: new Set(), spin: 0 };
      g.audio.play('blade-whoosh', { volume: 1, rate: 0.55 });
      g.haptics?.play('throw');
    }
    if (a.t > 0.95) {
      this.act = null;
      g.combat.handBusy = false;
      g.animator.stop(0.25);
      if (g.combat.armed) g.combat.stance(3);
    }
  }

  recall() {
    const T = this.tri;
    if (!T || T.phase === 'back') return;
    if (T.pinned?.alive && T.pinned.state === 'pinned') T.pinned.unpin?.();
    T.phase = 'back';
    T.t = 0;
    T.hitSet.clear();
    this.g.audio.play('blade-whoosh', { volume: 0.8, rate: 0.7 });
  }

  openEye() {
    const g = this.g;
    this.eye = SHAKTI.thirdEyeSecs;
    g.audio.play('om', { volume: 0.9 });
    g.audio.play('riser', { volume: 0.7 });
    g.ui.setThirdEye?.(true);
    g.haptics?.pulse(0.3, 0.2, 300);
  }

  // ------------------------------------------------------------ per rendered frame
  update(dt) {
    const g = this.g;
    // the Third Eye
    if (this.eye > 0) {
      this.eye = Math.max(0, this.eye - dt);
      if (this.eye <= 0) {
        g.ui.setThirdEye?.(false);
        g.audio.play('chime', { volume: 0.4, rate: 0.5 });
      }
    }
    this.eyeK += ((this.eye > 0 ? 1 : 0) - this.eyeK) * Math.min(1, dt * (this.eye > 0 ? 6 : 2.5));
    g.asuras.timeScale = 1 - this.eyeK * 0.68;
    if (g.projectiles) g.projectiles.timeScale = g.asuras.timeScale;
    if (g.quest?.glow) {
      g.quest.glow.material.uniforms.uReveal.value = this.eyeK;
      g.quest.glow.material.depthTest = this.eyeK < 0.05;
    }
    this.updateTrishul(dt);
    // the shockwave's ring
    const S = this.shock;
    this.ring.visible = !!S;
    if (S) {
      S.t += dt;
      const k = Math.min(1, S.t / 0.5);
      const e = 1 - (1 - k) * (1 - k);
      this.ring.position.set(S.x, S.y, S.z);
      this.ring.scale.setScalar(0.5 + S.r * e);
      this.ring.material.uniforms.uK.value = k;
      // embers along the front
      for (let i = 0; i < 6; i++) {
        const ang = Math.random() * Math.PI * 2;
        const r = 0.5 + S.r * e;
        g.asuras.particles.emitEmbers(S.x + Math.cos(ang) * r, S.y + 0.1, S.z + Math.sin(ang) * r, 1, { x: Math.cos(ang) * 0.6, z: Math.sin(ang) * 0.6 }, 0.45);
      }
      if (k >= 1) this.shock = null;
    }
    this.shownT = Math.max(0, this.shownT - dt);
    this.denied = Math.max(0, (this.denied || 0) - dt);
    this.hud();
  }

  updateTrishul(dt) {
    const g = this.g;
    const T = this.tri;
    const M = this.trishulMesh;
    if (!T) {
      if (!this.act || this.act.kind !== 'trishul') M.visible = false;
      return;
    }
    M.visible = true;
    T.t += dt;
    if (T.phase === 'out') {
      const step = T.vel.length() * dt;
      const dir = _a.copy(T.vel).normalize();
      // the world first (stone, walls): it bites in
      const wall = g.physics.castRay(T.pos, dir, step + 0.1, g.player.collider, GROUPS.missile);
      const reach = wall !== null ? Math.min(step, wall) : step;
      // an Asura along the way
      for (let s = 0.25; s <= reach + 1e-3; s += 0.25) {
        _b.copy(T.pos).addScaledVector(dir, Math.min(s, reach));
        const t = g.targets.touching(_b, 0.14);
        if (t && t.enemy && !T.hitSet.has(t)) {
          T.hitSet.add(t);
          T.pos.copy(_b);
          return this.pin(t, dir);
        }
        const pr = g.looseProps?.touching(_b, 0.1);
        if (pr) g.looseProps.strike(pr, { x: dir.x, z: dir.z }, 1.4, { sword: true, heavy: true });
      }
      T.pos.addScaledVector(dir, reach);
      T.travelled += reach;
      T.vel.y -= 2.5 * dt; // a little drop over a long throw
      if (wall !== null && wall <= step + 0.1) {
        T.phase = 'stuck';
        T.t = 0;
        T.stuckDir = dir.clone();
        g.audio.play('blade-hit', { at: T.pos, volume: 0.9, rate: 0.7 });
        g.asuras.particles.emitDust(T.pos.x, T.pos.y - 0.1, T.pos.z, 0.5, 5);
      } else if (T.travelled > 36) this.recall();
      this.placeTrishul(T.pos, dir, false);
    } else if (T.phase === 'stuck') {
      this.placeTrishul(T.pos, T.stuckDir, false);
      if (T.t > 0.55) this.recall();
    } else if (T.phase === 'pinned') {
      const a = T.pinned;
      // it rides in the body (its chest, as it reels)
      if (a?.alive && a.state === 'pinned') {
        _w.set(a.pos.x, a.pos.y + a.height * 0.6, a.pos.z);
        const c = Math.cos(a.yaw - T.yaw0);
        const s = Math.sin(a.yaw - T.yaw0);
        T.dirNow = _a.set(T.stuckDir.x * c + T.stuckDir.z * s, T.stuckDir.y, -T.stuckDir.x * s + T.stuckDir.z * c);
        T.pos.copy(_w).addScaledVector(T.dirNow, -0.25);
        this.placeTrishul(T.pos, T.dirNow, false);
        if (T.t > 2.6) this.recall();
      } else this.recall();
    } else if (T.phase === 'back') {
      // home to the right hand: fast, turning smoothly, cutting what it passes
      const hand = g.animator.boneWorld('RightHand', _w) || _w.set(g.player.position.x, g.player.feetY + 1.3, g.player.position.z);
      const to = _a.copy(hand).sub(T.pos);
      const d = to.length();
      const speed = Math.min(30, 12 + T.t * 40);
      if (d < Math.max(0.5, speed * dt)) return this.caught();
      to.normalize();
      T.vel.lerp(_b.copy(to).multiplyScalar(speed), Math.min(1, dt * 9));
      const step = T.vel.length() * dt;
      const dir = _b.copy(T.vel).normalize();
      for (let s = 0.3; s <= step + 1e-3; s += 0.3) {
        _v.copy(T.pos).addScaledVector(dir, Math.min(s, step));
        const t = g.targets.touching(_v, 0.16);
        if (t && t.enemy && !T.hitSet.has(t)) {
          T.hitSet.add(t);
          t.hit({ k: 0.8, dir: { x: dir.x, z: dir.z }, at: _v.clone(), sword: true, heavy: false, power: true, dmgOverride: 12 });
          g.haptics?.play('hit');
        }
      }
      T.pos.addScaledVector(dir, step);
      // butt first, so he catches the shaft
      this.placeTrishul(T.pos, _a.copy(dir).negate(), false);
      if (T.t > 3) this.caught();
    }
    // a streak of light behind it
    if (T.phase === 'out' || T.phase === 'back') g.asuras.particles.emitEmbers(T.pos.x, T.pos.y, T.pos.z, 1, null, 0.15);
  }

  pin(a, dir) {
    const g = this.g;
    const T = this.tri;
    T.phase = 'pinned';
    T.t = 0;
    T.pinned = a;
    T.stuckDir = dir.clone();
    T.yaw0 = a.yaw;
    a.hit({ k: 1.4, dir: { x: dir.x, z: dir.z }, at: T.pos.clone(), sword: true, heavy: true, power: true, dmgOverride: 30 });
    if (a.alive) a.pin?.(2.6);
    else T.phase = 'stuck';
    g.audio.play('blade-hit', { at: T.pos, volume: 1, rate: 0.6 });
    g.audio.play('thump', { at: T.pos, volume: 0.8, rate: 0.5 });
    g.camRig.shake(0.18);
    g.haptics?.play('pin');
    g.achievements?.event('trishulPin', {});
  }

  caught() {
    const g = this.g;
    this.tri = null;
    this.trishulMesh.visible = false;
    g.audio.play('brass-clang', { volume: 0.45, rate: 1.4 });
    g.haptics?.play('land');
    const h = g.animator.boneWorld('RightHand', _v);
    if (h) g.asuras.particles.emitEmbers(h.x, h.y, h.z, 10, null, 0.35);
  }

  /** The trishul along dir (prongs first), its middle at pos (or held in the hand). */
  placeTrishul(pos, dir, held) {
    const M = this.trishulMesh;
    _y.copy(dir).normalize();
    _x.crossVectors(UP, _y);
    if (_x.lengthSq() < 1e-4) _x.set(1, 0, 0);
    _x.normalize();
    _z.crossVectors(_x, _y).normalize();
    _m.makeBasis(_x, _y, _z);
    M.quaternion.setFromRotationMatrix(_m);
    // the geometry's butt is at 0: put its middle (0.8 m up the shaft) at pos
    M.position.copy(pos).addScaledVector(_y, held ? -0.55 : -0.8);
    M.updateMatrixWorld();
  }

  // ------------------------------------------------------------ after the animator (props in the hand)
  late() {
    const g = this.g;
    const a = this.act;
    const R = g.animator.loco?.b?.Right;
    if (a?.kind === 'damaru' && R?.hand) {
      // held by its waist, heads to either side of the fist, above the knuckles
      const h = R.hand.getWorldPosition(_v);
      const f = R.fore.getWorldPosition(_w);
      const along = _a.subVectors(h, f).normalize(); // the forearm's line
      const side = _b.set(Math.cos(g.player.yaw), 0, -Math.sin(g.player.yaw)); // his left
      _z.crossVectors(side, along).normalize();
      _y.copy(side);
      _x.crossVectors(_y, _z).normalize();
      _m.makeBasis(_x, _y, _z);
      this.damaru.quaternion.setFromRotationMatrix(_m);
      // the wrist twist that swings the beads
      this.damaru.rotateX(Math.sin(a.t * 38) * 0.5);
      this.damaru.position.copy(h).addScaledVector(along, 0.09);
      this.damaru.updateMatrixWorld();
    }
    if (a?.kind === 'trishul' && !a.thrown && R?.hand) {
      // gripped like a spear, prongs toward the throw
      const h = R.hand.getWorldPosition(_v);
      const f = R.fore.getWorldPosition(_w);
      const along = _a.subVectors(h, f).normalize();
      const fwd = _b.set(Math.sin(a.yaw), 0, Math.cos(a.yaw));
      const dir = along.lerp(fwd, 0.5).normalize();
      this.placeTrishul(h, dir, true);
    }
    // the third eye on his brow
    const head = g.animator.boneWorld('Head', _v);
    this.brow.visible = this.eyeK > 0.02 && !!head;
    if (this.brow.visible) {
      const yaw = g.player.yaw;
      this.brow.position.set(head.x + Math.sin(yaw) * 0.105, head.y + 0.085, head.z + Math.cos(yaw) * 0.105);
      this.brow.material.opacity = this.eyeK * (0.75 + 0.25 * Math.sin(performance.now() * 0.012));
    }
  }

  hud() {
    const g = this.g;
    const owned = KINDS.filter((k) => g.siddhis?.has(k));
    if (!owned.length) return g.ui.setShakti?.(null);
    g.ui.setShakti?.({
      frac: this.shakti / SHAKTI.max,
      show: g.inCombat || this.shownT > 0 || this.eye > 0 || !!this.tri,
      powers: owned.map((k) => ({ kind: k, ready: this.shakti >= SHAKTI.cost[k] && (k !== 'trishul' || !this.tri) && (k !== 'thirdEye' || this.eye <= 0), cost: SHAKTI.cost[k] / SHAKTI.max, active: (k === 'thirdEye' && this.eye > 0) || (k === 'trishul' && !!this.tri) })),
      denied: this.denied > 0,
      need: this.denied > 0 ? this.deniedNeed : 0,
      eye: this.eye / SHAKTI.thirdEyeSecs,
    });
  }

  /** A blow landed while casting: the power is lost (its Shakti back if it never left his hands). */
  interrupt() {
    const a = this.act;
    if (!a) return;
    if ((a.kind === 'damaru' && a.beats < 3) || (a.kind === 'trishul' && !a.thrown)) this.shakti = Math.min(SHAKTI.max, this.shakti + SHAKTI.cost[a.kind]);
    this.act = null;
    this.damaru.visible = false;
    if (!this.tri) this.trishulMesh.visible = false;
    this.g.combat.handBusy = false;
    this.g.animator.stop(0.15);
  }

  /** End everything (a test jump, a fall). */
  reset() {
    this.act = null;
    this.g.combat.handBusy = false;
    this.damaru.visible = false;
    if (this.tri?.pinned?.alive) this.tri.pinned.unpin?.();
    this.tri = null;
    this.trishulMesh.visible = false;
    this.eye = 0;
    this.eyeK = 0;
    this.shock = null;
    this.g.ui.setThirdEye?.(false);
  }
}

// ---------------------------------------------------------------- sounds (made in code)

/** The damaru: a taut little drum struck by its beads, a sharp "dug" with a rattle of the cord. */
export function synthDamaru(ctx) {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * 0.5);
  const b = ctx.createBuffer(1, n, sr);
  const d = b.getChannelData(0);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const w = Math.random() * 2 - 1;
    lp += (w - lp) * 0.3;
    // two heads, a pitch drop as the skin settles
    const f = 260 * (1 + 0.6 * Math.exp(-t * 40));
    const head = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 16) + 0.5 * Math.sin(2 * Math.PI * f * 1.48 * t) * Math.exp(-t * 22);
    const slap = lp * Math.exp(-t * 70) * 0.8;
    const rattle = t > 0.03 && t < 0.09 ? w * 0.15 * Math.exp(-(t - 0.03) * 40) : 0;
    d[i] = (head * 0.8 + slap + rattle) * 0.9;
  }
  return b;
}

/** Om: a low drone with a slow swell and shimmering overtones (the Third Eye opening). */
export function synthOm(ctx) {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * 3.6);
  const b = ctx.createBuffer(1, n, sr);
  const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.min(1, t / 0.5) * Math.exp(-Math.max(0, t - 1.2) * 1.4);
    const f = 110;
    let s = 0;
    for (let k = 1; k <= 7; k++) s += Math.sin(2 * Math.PI * f * k * t * (1 + 0.0007 * Math.sin(t * 3 + k))) * (k === 1 ? 1 : 0.5 / k) * (k > 3 ? 0.5 + 0.5 * Math.sin(t * 2.2 + k) : 1);
    d[i] = s * env * 0.32;
  }
  return b;
}
