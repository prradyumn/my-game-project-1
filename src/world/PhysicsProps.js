import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GROUPS } from '../core/Physics.js';
import { RNG } from '../utils/math.js';
import { GHAT_SEGMENTS, LANDING_2, ghatToWorld } from './WorldLayout.js';
import { makeWaterAware } from './materials.js';

// Loose things on the ghats that obey physics: clay matkas beside the takhts, brass lotas on
// them, flower sellers' baskets of marigolds. Prady (and an Asura) walking or rolling into one
// shoves it (the character controllers push dynamic bodies), a strike sends it flying, a sword
// or a heavy kick shatters a matka into shards and a splash of water, Andhaka's stomp throws
// everything near it, and whatever reaches the Ganga floats, bobs and drifts off downstream.
//
// Cheap by design: a prop only has a Rapier body when Prady is near (created asleep, so nothing
// moves until something touches it) and gives it up once he's gone and it has come to rest;
// every kind is one instanced mesh; the shapes and the sounds are made in code (no downloads).

const KINDS = {
  // half-height and radius of the rounded-cylinder collider, mass (kg), bounciness, does it float
  matka: { hh: 0.27, r: 0.23, mass: 6, rest: 0.08, float: 1.25, fills: 6, sound: 'clay-knock' }, // floats until it fills
  lota: { hh: 0.09, r: 0.085, mass: 0.7, rest: 0.35, float: 0.55, sound: 'brass-clang' }, // brass: down it goes
  basket: { hh: 0.1, r: 0.27, mass: 1.6, rest: 0.1, float: 2.2, sound: 'wicker' },
};
const ACT = 28; // a prop near enough to be touched gets a body...
const DEACT = 40; // ...and gives it up once he's this far and it's at rest
const SHARDS = 72;

const C = (hex) => new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _z = new THREE.Vector3(0, 0, 0);
const _cur = { x: 0, z: 0 };

function colored(g, color) {
  const geo = g.index ? g.toNonIndexed() : g;
  const c = color;
  const a = new Float32Array(geo.attributes.position.count * 3);
  for (let i = 0; i < a.length; i += 3) a.set([c.r, c.g, c.b], i);
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}

function lathe(points, segs, color, y0 = 0) {
  const g = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y + y0)), segs);
  return colored(g, color);
}

// a clay matka: round belly, narrow neck, a rolled lip; a painted band round the shoulder
function matkaGeometry() {
  const hh = KINDS.matka.hh;
  const body = lathe([[0.001, 0], [0.12, 0.01], [0.22, 0.12], [0.25, 0.25], [0.23, 0.36], [0.15, 0.46], [0.1, 0.5], [0.11, 0.53], [0.125, 0.55], [0.1, 0.56]], 18, C('#a85a32'), -hh);
  const band = lathe([[0.235, 0.33], [0.238, 0.355], [0.227, 0.38]], 18, C('#e6c79a'), -hh);
  return mergeGeometries([body, band]);
}
function lotaGeometry() {
  const hh = KINDS.lota.hh;
  return lathe([[0.001, 0], [0.05, 0.005], [0.085, 0.05], [0.09, 0.09], [0.07, 0.13], [0.045, 0.15], [0.05, 0.17], [0.062, 0.18]], 16, C('#d9a441'), -hh);
}
function basketGeometry() {
  const hh = KINDS.basket.hh;
  const parts = [lathe([[0.001, 0], [0.2, 0], [0.28, 0.16], [0.29, 0.2], [0.27, 0.2], [0.26, 0.17], [0.001, 0.17]], 20, C('#a07a45'), -hh)];
  // a heap of marigolds
  const rng = new RNG(5);
  for (let i = 0; i < 26; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = Math.sqrt(rng.next()) * 0.22;
    const m = new THREE.IcosahedronGeometry(0.045, 0);
    m.translate(Math.cos(a) * d, 0.17 - hh + 0.03 + (0.22 - d) * 0.25, Math.sin(a) * d);
    parts.push(colored(m, C(i % 3 ? '#ff9f1a' : '#ffcc33')));
  }
  return mergeGeometries(parts);
}
// a curved potsherd
function shardGeometry() {
  const g = new THREE.CylinderGeometry(0.24, 0.24, 0.1, 4, 1, true, 0, 0.55);
  g.translate(-0.22, 0, 0);
  return colored(g, C('#9c522c'));
}

export class PhysicsProps {
  constructor(game) {
    this.g = game;
    this.physics = game.physics;
    this.props = [];
    this.place();
    const mat = makeWaterAware(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), { puddles: false });
    const brass = makeWaterAware(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.85 }), { puddles: false });
    const geos = { matka: matkaGeometry(), lota: lotaGeometry(), basket: basketGeometry() };
    this.meshes = {};
    for (const k of Object.keys(KINDS)) {
      const list = this.props.filter((p) => p.kind === k);
      const mesh = new THREE.InstancedMesh(geos[k], k === 'lota' ? brass : mat, Math.max(1, list.length));
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `props-${k}`;
      list.forEach((p, i) => {
        p.index = i;
        this.write(p);
      });
      mesh.count = list.length;
      game.scene.add(mesh);
      this.meshes[k] = mesh;
    }
    // shards of broken matkas: a small pool, each a short-lived body
    this.shardMesh = new THREE.InstancedMesh(shardGeometry(), mat, SHARDS);
    this.shardMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shardMesh.castShadow = true;
    this.shardMesh.frustumCulled = false;
    this.shardMesh.count = 0;
    game.scene.add(this.shardMesh);
    this.shards = [];
    for (const m of Object.values(this.meshes)) m.frustumCulled = false;
  }

  // ---------------------------------------------------------------- where they stand
  place() {
    const rng = new RNG(808);
    const lay = this.g.world.layout;
    const add = (kind, x, y, z, yaw = 0) => this.props.push({ kind, home: { x, y, z, yaw }, x, y, z, q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), body: null, broken: false, brokenAt: 0, settled: false, v: new THREE.Vector3() });
    // beside the takhts under the straw umbrellas: a water matka on the stone, lotas on top
    for (const u of lay.umbrellas || []) {
      const cx = Math.cos(u.yaw);
      const sx = -Math.sin(u.yaw);
      const fx = Math.sin(u.yaw);
      const fz = Math.cos(u.yaw);
      if (rng.chance(0.55)) {
        const side = rng.chance(0.5) ? 1 : -1;
        add('matka', u.x + cx * 1.32 * side + fx * 0.25, u.y, u.z + sx * 1.32 * side + fz * 0.25, rng.range(0, 6.28));
      }
      if (rng.chance(0.45)) add('lota', u.x + cx * rng.range(-0.6, 0.6) + fx * 0.3, u.y + 0.5, u.z + sx * rng.range(-0.6, 0.6) + fz * 0.3, rng.range(0, 6.28));
    }
    // the lower landing: flower sellers' baskets and pilgrims' lotas, toward the water
    for (const g of GHAT_SEGMENTS) {
      for (let i = 0; i < 3; i++) {
        const u = rng.range(6, g.width - 6);
        const v = (LANDING_2.v0 + LANDING_2.v1) / 2 + rng.range(-0.4, 0.6);
        const p = ghatToWorld(g, u, v);
        add(rng.chance(0.55) ? 'basket' : 'lota', p.x, LANDING_2.h0, p.z, rng.range(0, 6.28));
        if (rng.chance(0.35)) add('lota', p.x + rng.range(-0.6, 0.6), LANDING_2.h0, p.z + rng.range(-0.6, 0.6), rng.range(0, 6.28));
      }
    }
    // standing upright on what's under them (a takht, a step), half their height up
    for (const p of this.props) p.y = p.home.y + KINDS[p.kind].hh + 0.01;
  }

  write(p) {
    const mesh = this.meshes[p.kind];
    if (!mesh) return;
    if (p.broken) _m.compose(_p.set(0, -999, 0), _q.identity(), _z);
    else _m.compose(_p.set(p.x, p.y, p.z), p.q, _s);
    mesh.setMatrixAt(p.index, _m);
    mesh.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- bodies near Prady only
  wake(p) {
    const R = this.physics.RAPIER;
    const K = KINDS[p.kind];
    // settle onto the real surface below (the exact tread, the takht top) before it can be seen
    // standing a hair above it
    if (!p.settled) {
      const hit = this.physics.castRay({ x: p.x, y: p.y + 0.8, z: p.z }, { x: 0, y: -1, z: 0 }, 2.5, undefined, GROUPS.feet);
      if (hit !== null) p.y = p.y + 0.8 - hit + K.hh + 0.005;
      p.settled = true;
      this.write(p);
    }
    const body = this.physics.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(p.x, p.y, p.z)
        .setRotation({ x: p.q.x, y: p.q.y, z: p.q.z, w: p.q.w })
        .setLinearDamping(0.08)
        .setAngularDamping(0.35)
        .setCcdEnabled(true)
        .setSleeping(true)
    );
    const col = R.ColliderDesc.roundCylinder(Math.max(0.01, K.hh - 0.02), Math.max(0.01, K.r - 0.02), 0.02).setMass(K.mass).setFriction(0.75).setRestitution(K.rest).setCollisionGroups(GROUPS.prop);
    this.physics.world.createCollider(col, body);
    p.body = body;
    p.v.set(0, 0, 0);
  }

  rest(p) {
    const t = p.body.translation();
    const r = p.body.rotation();
    p.x = t.x;
    p.y = t.y;
    p.z = t.z;
    p.q.set(r.x, r.y, r.z, r.w);
    this.physics.world.removeRigidBody(p.body);
    p.body = null;
    this.write(p);
  }

  update(dt) {
    const g = this.g;
    const P = g.player.position;
    const now = g.asuras?.clock ?? 0;
    this.time = (this.time || 0) + dt;
    for (const p of this.props) {
      const d2 = (p.x - P.x) ** 2 + (p.z - P.z) ** 2;
      if (p.broken) {
        // a broken matka is replaced (out of sight) after a while
        if (this.time - p.brokenAt > 240 && d2 > 60 * 60) this.restore(p);
        continue;
      }
      if (!p.body && d2 < ACT * ACT) this.wake(p);
      else if (p.body && d2 > DEACT * DEACT && p.body.isSleeping()) this.rest(p);
      if (p.body && !p.body.isSleeping()) {
        const t = p.body.translation();
        const r = p.body.rotation();
        p.x = t.x;
        p.y = t.y;
        p.z = t.z;
        p.q.set(r.x, r.y, r.z, r.w);
        this.write(p);
        // carried off down the river and out of sight: gone
        if (p.y < -0.2 && d2 > 90 * 90) this.sink(p);
      }
    }
    this.updateShards(dt);
  }

  restore(p) {
    p.broken = false;
    p.x = p.home.x;
    p.y = p.home.y + KINDS[p.kind].hh + 0.01;
    p.z = p.home.z;
    p.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.home.yaw);
    p.settled = false;
    this.write(p);
  }

  sink(p) {
    if (p.body) {
      this.physics.world.removeRigidBody(p.body);
      p.body = null;
    }
    p.broken = true;
    p.brokenAt = this.time;
    this.write(p);
  }

  /** Who can walk into things: Prady and the Asuras (position, velocity, body radius). */
  pushers() {
    const g = this.g;
    const out = this._pushers || (this._pushers = []);
    out.length = 0;
    const P = g.player;
    if (P.state === 'ground' || P.state === 'air') out.push({ x: P.position.x, y: P.feetY, z: P.position.z, vx: P.velocity.x, vz: P.velocity.z, r: 0.34, h: 1.75 });
    for (const a of g.asuras?.list || []) if (a.alive) out.push({ x: a.pos.x, y: a.pos.y, z: a.pos.z, vx: a.vel?.x || 0, vz: a.vel?.z || 0, r: a.radius, h: a.height });
    return out;
  }

  /** Every physics step (before it): shoves, the river holding things up, impacts. */
  fixed(dt) {
    const g = this.g;
    const W = g.water;
    // walking into a pot shoves it ahead (above its middle, so a hard knock tips it over): the
    // controllers' own push is too soft and lets a quick stride overtake the pot
    const ps = this.pushers();
    for (const p of this.props) {
      const b = p.body;
      if (!b) continue;
      const K = KINDS[p.kind];
      for (const q of ps) {
        if (p.y < q.y - 0.1 || p.y > q.y + q.h) continue;
        const dx = p.x - q.x;
        const dz = p.z - q.z;
        const d = Math.hypot(dx, dz);
        const minD = K.r + q.r + 0.04;
        if (d >= minD || d < 1e-4) continue;
        const nx = dx / d;
        const nz = dz / d;
        const v = b.linvel();
        const closing = q.vx * nx + q.vz * nz - (v.x * nx + v.z * nz);
        const pen = minD - d;
        if (closing <= 0 && pen < 0.04) continue;
        // its speed matched to his along the contact (a stride moves it, a run sends it), plus a
        // gentle push out of an overlap
        const dv = Math.max(0, closing) * 1.05 + Math.min(pen, 0.06) * 2.5;
        const m = b.mass();
        b.applyImpulseAtPoint({ x: nx * dv * m, y: 0.05 * m, z: nz * dv * m }, { x: p.x - nx * K.r * 0.2, y: p.y + K.hh * 0.6, z: p.z - nz * K.r * 0.2 }, true);
      }
    }
    for (const p of this.props) {
      const b = p.body;
      if (!b || b.isSleeping()) continue;
      const K = KINDS[p.kind];
      const t = b.translation();
      const v = b.linvel();
      // impacts: a sudden change of velocity is a knock (louder the harder); clay breaks
      const dv = Math.hypot(v.x - p.v.x, v.y - p.v.y, v.z - p.v.z);
      if (dv > 1.4 && this.time - (p.lastKnock || 0) > 0.12) {
        p.lastKnock = this.time;
        const wet = W.heightAt(t.x, t.z) > t.y;
        if (!wet) g.audio.play(K.sound, { at: _p.set(t.x, t.y, t.z), volume: Math.min(1, dv / 6), rate: 0.9 + Math.random() * 0.2, ref: 5 });
        if (!wet && dv > 2.6) g.asuras?.particles.emitDust(t.x, t.y - K.hh, t.z, 0.45 + K.r, 3);
        if (p.kind === 'matka' && dv > 5.5) {
          this.shatter(p, { x: v.x * 0.3, y: 1, z: v.z * 0.3 });
          continue;
        }
      }
      p.v.set(v.x, v.y, v.z);
      // buoyancy, water drag and the current
      const wy = W.heightAt(t.x, t.z);
      const sub = Math.min(1, Math.max(0, (wy - (t.y - K.hh)) / (2 * K.hh)));
      b.resetForces(true);
      if (sub > 0) {
        if (!p.inWater && v.y < -1.2) {
          g.fx?.splash?.(t.x, wy, t.z, Math.min(1, -v.y / 5));
          g.audio.play('splash', { at: _p.set(t.x, wy, t.z), volume: Math.min(0.5, -v.y / 10), rate: 1.6 + Math.random() * 0.3, ref: 6 });
        }
        if (!p.inWater) p.wetT = 0;
        p.inWater = true;
        p.wetT = (p.wetT || 0) + dt;
        const m = b.mass();
        W.currentAt(t.x, t.z, _cur);
        // (a clay pot takes water through its mouth and slowly goes under)
        const fl = K.fills ? K.float * Math.max(0.35, 1 - p.wetT / K.fills) : K.float;
        b.addForce({ x: (_cur.x - v.x) * m * 1.5 * sub, y: m * 9.81 * fl * sub - v.y * m * 2.2 * sub, z: (_cur.z - v.z) * m * 1.5 * sub }, true);
        b.setAngularDamping(2.5);
      } else if (p.inWater) {
        p.inWater = false;
        b.setAngularDamping(0.35);
      }
    }
  }

  // ---------------------------------------------------------------- blows, blasts, breaking
  /** The prop a strike point touches (point: world, reach: the limb's / blade's radius). */
  touching(pt, reach) {
    for (const p of this.props) {
      if (p.broken || !p.body) continue;
      const K = KINDS[p.kind];
      if (Math.abs(pt.y - p.y) > K.hh + reach + 0.05) continue;
      if ((pt.x - p.x) ** 2 + (pt.z - p.z) ** 2 < (K.r + reach) ** 2) return p;
    }
    return null;
  }

  /** A blow: a sword through a matka breaks it; anything else sends it flying. */
  strike(p, dir, k, { sword = false, heavy = false, kick = false } = {}) {
    if (!p.body || p.broken) return;
    const l = Math.hypot(dir.x, dir.z) || 1;
    const K = KINDS[p.kind];
    if (p.kind === 'matka' && (sword || heavy || (kick && k >= 1))) return this.shatter(p, { x: (dir.x / l) * 2.5, y: 1.5, z: (dir.z / l) * 2.5 });
    const speed = (kick ? 5.5 : heavy ? 6 : 3.6) * k * (p.kind === 'matka' ? 0.55 : 1);
    p.body.wakeUp();
    p.body.applyImpulse({ x: (dir.x / l) * speed * K.mass, y: speed * 0.45 * K.mass, z: (dir.z / l) * speed * K.mass }, true);
    p.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * K.mass * 0.4, y: (Math.random() - 0.5) * K.mass * 0.2, z: (Math.random() - 0.5) * K.mass * 0.4 }, true);
    this.g.audio.play(K.sound, { at: _p.set(p.x, p.y, p.z), volume: 0.9, rate: 1, ref: 6 });
  }

  /** A ring of force (the stomp): everything inside is thrown outward and up. */
  blast(c, radius, power = 7) {
    for (const p of this.props) {
      if (p.broken || !p.body) continue;
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const d = Math.hypot(dx, dz);
      if (d > radius) continue;
      const f = (1 - d / radius) * power;
      if (p.kind === 'matka' && f > 4) {
        this.shatter(p, { x: (dx / (d || 1)) * f * 0.4, y: f * 0.4, z: (dz / (d || 1)) * f * 0.4 });
        continue;
      }
      const m = KINDS[p.kind].mass;
      p.body.wakeUp();
      p.body.applyImpulse({ x: (dx / (d || 1)) * f * m * 0.6, y: f * m * 0.5, z: (dz / (d || 1)) * f * m * 0.6 }, true);
    }
  }

  shatter(p, vel) {
    const g = this.g;
    const at = new THREE.Vector3(p.x, p.y, p.z);
    if (p.body) {
      this.physics.world.removeRigidBody(p.body);
      p.body = null;
    }
    p.broken = true;
    p.brokenAt = this.time;
    this.write(p);
    g.audio.play('clay-break', { at, volume: 0.95, rate: 0.9 + Math.random() * 0.2, ref: 7 });
    g.asuras?.particles.emitDust(at.x, at.y - 0.25, at.z, 0.9, 7);
    // the water it held
    for (let i = 0; i < 4; i++) g.fx?.spray?.(at.x + (Math.random() - 0.5) * 0.3, at.y - 0.1, at.z + (Math.random() - 0.5) * 0.3);
    // shards: curved pieces of the belly, flung out, tumbling, gone in a few seconds
    const R = this.physics.RAPIER;
    for (let i = 0; i < 8; i++) {
      if (this.shards.length >= SHARDS) this.dropShard(this.shards[0]);
      const a = (i / 8) * Math.PI * 2 + Math.random() * 0.4;
      const pos = { x: at.x + Math.cos(a) * 0.18, y: at.y + (Math.random() - 0.3) * 0.3, z: at.z + Math.sin(a) * 0.18 };
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 3, a, Math.random() * 3));
      const body = this.physics.world.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation(pos.x, pos.y, pos.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setLinvel(vel.x + Math.cos(a) * 2.2 * Math.random(), vel.y + Math.random() * 1.5, vel.z + Math.sin(a) * 2.2 * Math.random())
          .setAngvel({ x: (Math.random() - 0.5) * 14, y: (Math.random() - 0.5) * 14, z: (Math.random() - 0.5) * 14 })
          .setCcdEnabled(true)
      );
      this.physics.world.createCollider(R.ColliderDesc.cuboid(0.07, 0.04, 0.05).setMass(0.15).setFriction(0.8).setRestitution(0.2).setCollisionGroups(GROUPS.prop), body);
      this.shards.push({ body, t: 0, s: 0.5 + Math.random() * 0.5 });
    }
  }

  dropShard(sh) {
    this.physics.world.removeRigidBody(sh.body);
    this.shards.splice(this.shards.indexOf(sh), 1);
  }

  updateShards(dt) {
    const m = this.shardMesh;
    let n = 0;
    for (const sh of [...this.shards]) {
      sh.t += dt;
      if (sh.t > 9) {
        this.dropShard(sh);
        continue;
      }
      const t = sh.body.translation();
      const r = sh.body.rotation();
      // shrink away at the end (into the dust of the ghat)
      const k = sh.s * (1 - Math.max(0, (sh.t - 7.5) / 1.5));
      _m.compose(_p.set(t.x, t.y, t.z), _q.set(r.x, r.y, r.z, r.w), _s.set(k, k, k));
      m.setMatrixAt(n++, _m);
    }
    _s.set(1, 1, 1);
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- their sounds (made in code)
const noiseBuf = (ctx, secs, fill) => {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * secs);
  const b = ctx.createBuffer(1, n, sr);
  fill(b.getChannelData(0), sr, n);
  return b;
};

/** Fired clay knocked on stone: a dull hollow tok. */
export function synthClayKnock(ctx) {
  return noiseBuf(ctx, 0.35, (d, sr, n) => {
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      lp += ((Math.random() * 2 - 1) - lp) * 0.35;
      d[i] = (Math.sin(2 * Math.PI * 310 * t) * 0.6 + Math.sin(2 * Math.PI * 520 * t) * 0.3) * Math.exp(-t * 32) + lp * Math.exp(-t * 70) * 0.5;
    }
  });
}

/** A matka breaking: a sharp crack, then the clatter of shards. */
export function synthClayBreak(ctx) {
  return noiseBuf(ctx, 1.0, (d, sr, n) => {
    let lp = 0;
    const clicks = Array.from({ length: 14 }, () => [0.04 + Math.random() * 0.6, 0.3 + Math.random() * 0.7]);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const w = Math.random() * 2 - 1;
      lp += (w - lp) * 0.6;
      let v = lp * Math.exp(-t * 18) * 0.9 + Math.sin(2 * Math.PI * 260 * t) * Math.exp(-t * 25) * 0.5;
      for (const [c, a] of clicks) {
        const dt = t - c;
        if (dt > 0 && dt < 0.03) v += w * a * Math.exp(-dt * 160) * 0.6;
      }
      d[i] = v;
    }
  });
}

/** A brass lota: a bright ring that hums away. */
export function synthBrassClang(ctx) {
  return noiseBuf(ctx, 1.2, (d, sr, n) => {
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const ring = [880, 1394, 2214, 3051].reduce((a, f, k) => a + Math.sin(2 * Math.PI * f * t + k) / (k + 1.4), 0) * Math.exp(-t * 4.5) * 0.35;
      d[i] = ring + (Math.random() * 2 - 1) * Math.exp(-t * 90) * 0.4;
    }
  });
}

/** A wicker basket: a soft papery thump. */
export function synthWicker(ctx) {
  return noiseBuf(ctx, 0.3, (d, sr, n) => {
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      lp += ((Math.random() * 2 - 1) - lp) * 0.25;
      d[i] = lp * Math.exp(-t * 28) * 0.8 + Math.sin(2 * Math.PI * 140 * t) * Math.exp(-t * 40) * 0.3;
    }
  });
}
