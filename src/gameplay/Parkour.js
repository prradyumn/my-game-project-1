import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PLAYER } from '../config.js';
import { GROUPS } from '../core/Physics.js';
import { clamp, damp, smoothstep } from '../utils/math.js';
import { solveTwoBone } from '../utils/bones.js';

// The rest of the Prince of Persia's book, over the rooftops of Kashi (Traversal owns the act;
// these are its moves and their places):
//
//   wall jump   in the air against a wall, Space: his feet on it for a beat, then a kick off it
//               up and away. Between two walls close together (the slots between the havelis)
//               it chains: up the gap, side to side, ~1.4 m gained a kick
//   rope slide  ropes hung with prayer flags run from a taller roof down across the lane to a
//               lower one: jump into one (or E at its top) and ride it down hand over hand;
//               Space lets go
//   swing pole  where a gap between two roofs is too wide for a plank, a bamboo pole is lashed
//               along the middle of it: leap for it, swing (W pumps it), Space lets go at the
//               top of the swing, out across to the far parapet (the ledge catch takes it)
//   beam        some of the plank bridges are a single beam: he balances along it, arms out,
//               slower, swaying; pushing sideways rocks him
//
// All of it from the clips the game has (the hang, the wall run, the walk) and IK: nothing to
// download.

const FEET = PLAYER.halfHeight + PLAYER.radius;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _t = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _palm = new THREE.Vector3();
const _fing = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const HANG = 1.85; // hands on a rope or a pole to his feet

function local(b, lx, lz) {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  return { x: b.x + lx * c + lz * s, z: b.z - lx * s + lz * c };
}

export class Parkour {
  constructor(traversal) {
    this.T = traversal;
    this.g = traversal.g;
    this.ropes = [];
    this.poles = [];
    this.wallJumpAt = -9;
  }

  get p() {
    return this.g.player;
  }

  // ------------------------------------------------------------ the places
  build() {
    const g = this.g;
    const B = g.world.layout.buildings;
    const top = (b) => b.baseY + b.h;
    const row0 = B.filter((b) => b.row === 0 && b.kind === 'haveli');
    const row1 = B.filter((b) => b.row === 1 && b.kind === 'haveli');
    // ropes: from a row-0 roof's back parapet across the lane to the front parapet of a lower
    // house behind it (or the other way, down), every so often along the river
    let lastX = -1e9;
    for (const a of row0) {
      if (this.ropes.length >= 9) break;
      if (a.x - lastX < 60) continue;
      const A = local(a, 0, -a.d / 2 + 0.2);
      let best = null;
      let bd = 16;
      for (const b of row1) {
        const Bp = local(b, 0, b.d / 2 - 0.2);
        const d = Math.hypot(Bp.x - A.x, Bp.z - A.z);
        const dh = Math.abs(top(a) - top(b));
        if (d < bd && d > 6 && dh > 2.5 && dh < 9) {
          bd = d;
          best = b;
        }
      }
      if (!best) continue;
      const hi = top(a) > top(best) ? a : best;
      const lo = hi === a ? best : a;
      // (its posts stand inside each parapet, tall enough that his feet hang clear of them: he
      // goes up off one roof and comes down over the middle of the other)
      const H = hi === a ? local(a, 0, -a.d / 2 + 0.9) : local(best, 0, best.d / 2 - 0.9);
      const L = hi === a ? local(best, 0, best.d / 2 - 1.7) : local(a, 0, -a.d / 2 + 1.7);
      const p0 = new THREE.Vector3(H.x, top(hi) + 2.95, H.z);
      const p1 = new THREE.Vector3(L.x, top(lo) + 2.95, L.z);
      const len = p0.distanceTo(p1);
      this.ropes.push({ p0, p1, len, sag: 0.05 * len, hi, lo, landY: top(lo) });
      lastX = a.x;
    }
    // poles: in the wider slots between neighbours on the waterfront row (a plank won't span
    // them), along the middle of the gap a little under the parapets
    const row = B.filter((b) => b.row === 0).sort((x, y) => x.x - y.x);
    for (let i = 0; i < row.length - 1 && this.poles.length < 7; i++) {
      const a = row[i];
      const b = row[i + 1];
      if (a.kind !== 'haveli' || b.kind !== 'haveli') continue;
      const ea = local(a, a.w / 2, 0);
      const eb = local(b, -b.w / 2, 0);
      const gap = Math.hypot(eb.x - ea.x, eb.z - ea.z);
      if (gap < 2.8 || gap > 6 || Math.abs(top(a) - top(b)) >= 2.0) continue;
      if (i % 2) continue;
      const y = Math.min(top(a), top(b)) + 0.35;
      const d = Math.min(a.d, b.d) - 2;
      const mid = { x: (ea.x + eb.x) / 2, z: (ea.z + eb.z) / 2 };
      const along = { x: Math.sin(a.yaw), z: Math.cos(a.yaw) }; // (front to back of the houses)
      const across = { x: (eb.x - ea.x) / gap, z: (eb.z - ea.z) / gap };
      this.poles.push({
        p0: new THREE.Vector3(mid.x - along.x * d * 0.5, y, mid.z - along.z * d * 0.5),
        p1: new THREE.Vector3(mid.x + along.x * d * 0.5, y, mid.z + along.z * d * 0.5),
        along,
        across,
        gap,
        a,
        b,
      });
    }
    this.mesh = this.buildMesh();
    g.scene.add(this.mesh);
  }

  /** A point on rope R at s (0 its high end .. 1 its low end), sagging in the middle. */
  ropeAt(R, s, out) {
    return out.lerpVectors(R.p0, R.p1, s).addScaledVector(UP, -R.sag * 4 * s * (1 - s));
  }

  buildMesh() {
    const parts = [];
    const col = (g, c) => {
      const n = g.attributes.position.count;
      const a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      if (g.attributes.uv) g.deleteAttribute('uv');
      return g.index ? g.toNonIndexed() : g;
    };
    const stick = (a, b, r, c) => {
      const len = a.distanceTo(b);
      const geo = new THREE.CylinderGeometry(r, r * 1.05, len, 6, 1);
      geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, _v.subVectors(b, a).normalize()));
      geo.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      parts.push(col(geo, c));
    };
    const bamboo = new THREE.Color(0.61, 0.48, 0.27);
    const rope = new THREE.Color(0.52, 0.42, 0.3);
    const FLAGS = [[0.9, 0.12, 0.1], [0.98, 0.72, 0.1], [0.15, 0.55, 0.25], [0.18, 0.3, 0.75], [0.95, 0.95, 0.9]].map((c) => new THREE.Color(...c));
    for (const R of this.ropes) {
      // a bamboo post on each roof
      for (const e of [R.p0, R.p1]) stick(new THREE.Vector3(e.x, e.y - 2.95, e.z), new THREE.Vector3(e.x, e.y + 0.1, e.z), 0.045, bamboo);
      // the rope, and its prayer flags (little squares hung under it)
      const N = Math.max(8, Math.round(R.len * 2));
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      for (let i = 0; i < N; i++) {
        this.ropeAt(R, i / N, a);
        this.ropeAt(R, (i + 1) / N, b);
        stick(a.clone(), b.clone(), 0.014, rope);
      }
      const dir = _w.subVectors(R.p1, R.p0).setY(0).normalize().clone();
      let k = 0;
      for (let s = 0.06; s < 0.95; s += 0.55 / R.len) {
        this.ropeAt(R, s, a);
        const f = new THREE.PlaneGeometry(0.2, 0.24);
        f.translate(0, -0.13, 0);
        f.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir));
        f.translate(a.x, a.y, a.z);
        parts.push(col(f, FLAGS[k++ % FLAGS.length]));
      }
    }
    for (const P of this.poles) {
      stick(P.p0, P.p1, 0.05, bamboo);
      // lashed to short cross-poles into the walls at each end
      for (const e of [P.p0, P.p1]) {
        stick(new THREE.Vector3(e.x - P.across.x * P.gap * 0.5, e.y, e.z - P.across.z * P.gap * 0.5), new THREE.Vector3(e.x + P.across.x * P.gap * 0.5, e.y, e.z + P.across.z * P.gap * 0.5), 0.045, bamboo);
      }
    }
    const geo = parts.length ? mergeGeometries(parts) : new THREE.BufferGeometry();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }));
    mesh.castShadow = true;
    mesh.name = 'parkour';
    return mesh;
  }

  // ------------------------------------------------------------ in the air: what to take hold of
  /** Player (in the air): a wall to kick off, a rope or a pole to catch. */
  air() {
    const p = this.p;
    if (this.T.act || p.state !== 'air' || this.g.combat?.dead) return false;
    if ((this.g.health?.time ?? 0) - (this.T.letGoAt ?? -9) < 0.3) return false;
    return this.catchRope() || this.catchPole() || this.wallJump();
  }

  wallJump() {
    const p = this.p;
    const now = this.g.health?.time ?? 0;
    if (p.jumpBuffer <= 0 || now - this.wallJumpAt < 0.28) return false;
    const v = p.velocity;
    const hs = Math.hypot(v.x, v.z);
    const w = hs > 0.5 ? _w.set(v.x / hs, 0, v.z / hs) : _w.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    const ph = this.g.physics;
    // (at the wall: his feet can reach it, ~0.2 m off his body)
    const hit = ph.castRayNormal({ x: p.position.x, y: p.feetY + 1.0, z: p.position.z }, { x: w.x, y: 0, z: w.z }, 0.52, p.collider, GROUPS.climb);
    if (!hit || Math.abs(hit.ny) > 0.3) return false;
    // (the wall goes on up: a fence or a low wall is vaulted, not kicked off)
    if (ph.castRay({ x: p.position.x, y: p.feetY + 2.1, z: p.position.z }, { x: w.x, y: 0, z: w.z }, hit.toi + 0.35, p.collider, GROUPS.climb) === null) return false;
    const nl = Math.hypot(hit.nx, hit.nz) || 1;
    const n = { x: hit.nx / nl, z: hit.nz / nl };
    p.jumpBuffer = 0;
    this.wallJumpAt = now;
    p.state = 'climb';
    // (his feet on it: drawn in to the wall for the plant)
    const pull = Math.max(0, hit.toi - 0.34);
    this.T.act = { type: 'walljump', t: 0, T: 0.14, n, p0: p.position.clone(), yaw: Math.atan2(-n.x, -n.z), pull: { x: -n.x * pull, z: -n.z * pull } };
    p.velocity.set(0, 0, 0);
    this.g.animator.play('wallRun', { loop: true, fadeIn: 0.06, fadeOut: 0.2, cancelOnMove: false, noLook: true, noFootIK: true, timeScale: 2.2 });
    this.g.audio.play('footstep', { volume: 0.5, rate: 1.1 });
    const at = { x: p.position.x - n.x * (hit.toi - 0.05), y: p.feetY + 0.6, z: p.position.z - n.z * (hit.toi - 0.05) };
    this.g.asuras?.particles.emitDust(at.x, at.y, at.z, 0.4, 5);
    return true;
  }

  catchRope() {
    const p = this.p;
    if (p.velocity.y > 3) return false;
    const hand = _t.set(p.position.x, p.feetY + HANG, p.position.z);
    for (const R of this.ropes) {
      // nearest point of the rope to his hands
      let best = -1;
      let bd = 0.55;
      for (let s = 0.03; s < 0.95; s += 0.02) {
        const d = this.ropeAt(R, s, _v).distanceTo(hand);
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      if (best < 0) continue;
      this.startZip(R, best);
      return true;
    }
    return false;
  }

  catchPole() {
    const p = this.p;
    if (p.velocity.y > 3) return false;
    const hand = _t.set(p.position.x, p.feetY + HANG, p.position.z);
    for (const P of this.poles) {
      _v.subVectors(P.p1, P.p0);
      const L = _v.length();
      const u = clamp(_w.subVectors(hand, P.p0).dot(_v) / (L * L), 0.05, 0.95);
      const q = _w.copy(P.p0).addScaledVector(_v, u);
      if (q.distanceTo(hand) > 0.6) continue;
      // the swing starts from how he came at it (across the gap)
      const fwd = P.across.x * p.velocity.x + P.across.z * p.velocity.z >= 0 ? 1 : -1;
      const sp = Math.hypot(p.velocity.x, p.velocity.z);
      p.state = 'climb';
      this.T.act = { type: 'swing', t: 0, P, u, at: q.clone(), dir: { x: P.across.x * fwd, z: P.across.z * fwd }, th: 0.35, w: Math.min(3.2, sp / HANG + 0.6) };
      p.velocity.set(0, 0, 0);
      this.g.animator.play('hang', { loop: true, fadeIn: 0.12, fadeOut: 0.25, cancelOnMove: false, noLook: true, noFootIK: true });
      this.g.audio.play('wicker', { volume: 0.5, rate: 0.6 });
      this.g.camRig.shake(0.05);
      return true;
    }
    return false;
  }

  /** E at a rope's high end: take hold and go. */
  interaction() {
    const p = this.p;
    if (this.T.act || p.state !== 'ground') return null;
    for (const R of this.ropes) {
      if (Math.hypot(p.position.x - R.p0.x, p.position.z - R.p0.z) < 1.6 && Math.abs(p.feetY + 2.95 - R.p0.y) < 0.8) return { prompt: 'Slide down the rope', action: () => this.startZip(R, 0.04, true) };
    }
    return null;
  }

  startZip(R, s, hop = false) {
    const p = this.p;
    p.state = 'climb';
    const dir = _v.subVectors(R.p1, R.p0).setY(0).normalize();
    // (from the roof: a hop up to take hold, the body carried onto the rope)
    this.T.act = { type: 'zip', t: 0, R, s, v: 1.2, yaw: Math.atan2(dir.x, dir.z), from: hop ? p.position.clone() : null };
    p.velocity.set(0, 0, 0);
    this.g.animator.play('hang', { loop: true, fadeIn: 0.12, fadeOut: 0.25, cancelOnMove: false, noLook: true, noFootIK: true });
    this.g.audio.play('wicker', { volume: 0.5, rate: 0.7 });
  }

  // ------------------------------------------------------------ the moves (Traversal.fixed)
  owns(a) {
    return a.type === 'walljump' || a.type === 'zip' || a.type === 'swing';
  }

  step(a, dt) {
    if (a.type === 'walljump') this.wallJumpStep(a, dt);
    else if (a.type === 'zip') this.zipStep(a, dt);
    else if (a.type === 'swing') this.swingStep(a, dt);
  }

  wallJumpStep(a, dt) {
    const p = this.p;
    if (!a.fly) {
      // feet on the wall for a beat, sinking a little, the body leaning out from it
      const k = Math.min(1, dt / 0.05);
      p.position.x += a.pull.x * k;
      p.position.z += a.pull.z * k;
      a.pull.x *= 1 - k;
      a.pull.z *= 1 - k;
      p.position.y -= dt * 0.6;
      p.yaw = a.yaw;
      p.climbLean = -0.25 * smoothstep(0, 1, a.t / a.T);
      p.body.setNextKinematicTranslation(p.position);
      if (a.t < a.T) return;
      // the kick: up and away, turned to face the way he flies
      a.fly = { t: 0, v: new THREE.Vector3(a.n.x * 4.4, 7.6, a.n.z * 4.4) };
      p.yaw = Math.atan2(a.n.x, a.n.z);
      p.prevYaw = p.yaw;
      p.climbLean = 0;
      this.g.animator.stop(0.15);
      this.g.audio.play('whoosh', { volume: 0.55, rate: 1.05 });
      return;
    }
    // the first fifth of a second of the flight is his own (the controller, touching the wall he
    // kicked from, would hold him down): a clean arc, stopped short of the wall ahead
    const F = a.fly;
    F.t += dt;
    F.v.y += PLAYER.gravity * dt;
    const hs = Math.hypot(F.v.x, F.v.z);
    let hx = F.v.x * dt;
    let hz = F.v.z * dt;
    if (hs > 0.01) {
      const ahead = this.g.physics.castRay({ x: p.position.x, y: p.feetY + 1.0, z: p.position.z }, { x: F.v.x / hs, y: 0, z: F.v.z / hs }, 0.32 + hs * dt + 0.02, p.collider, GROUPS.climb);
      if (ahead !== null) {
        const room = Math.max(0, ahead - 0.33);
        hx = (F.v.x / hs) * room;
        hz = (F.v.z / hs) * room;
        F.v.x = F.v.z = 0;
      }
    }
    p.position.x += hx;
    p.position.z += hz;
    p.position.y += F.v.y * dt;
    p.body.setNextKinematicTranslation(p.position);
    if (F.t < 0.2 && hs > 0.01) return;
    this.T.end();
    p.state = 'air';
    p.grounded = false;
    p.velocity.copy(F.v);
    p.jumpCut = false;
  }

  zipStep(a, dt) {
    const p = this.p;
    const R = a.R;
    // down the rope: gravity along its slope, the hands' friction, the air
    const ds = 0.01;
    const y0 = this.ropeAt(R, Math.max(0, a.s - ds), _v).y;
    const y1 = this.ropeAt(R, Math.min(1, a.s + ds), _w).y;
    const slope = (y0 - y1) / (2 * ds * R.len);
    a.v = clamp(a.v + (9.8 * slope * 0.85 - 0.9 - 0.02 * a.v * a.v) * dt, 0.6, 9);
    a.s += (a.v * dt) / R.len;
    const h = this.ropeAt(R, a.s, _t);
    p.position.set(h.x, h.y - HANG + FEET, h.z);
    if (a.from && a.t < 0.35) {
      const k = smoothstep(0, 0.35, a.t);
      p.position.lerpVectors(a.from, p.position, k);
      p.position.y += Math.sin(k * Math.PI) * 0.25;
      a.v = Math.min(a.v, 1.2);
      a.s = Math.max(0.04, a.s - (a.v * dt) / R.len * (1 - k));
    }
    p.yaw = a.yaw;
    p.climbLean = -0.06 - 0.02 * Math.min(1, a.v / 6);
    p.body.setNextKinematicTranslation(p.position);
    a.rubT = (a.rubT || 0) - dt;
    if (a.rubT <= 0) {
      a.rubT = 0.22;
      this.g.audio.play('wicker', { volume: 0.15 + Math.min(0.3, a.v * 0.04), rate: 1.4 + a.v * 0.05 });
    }
    // Space lets go; at the end he drops onto the lower roof running
    const end = a.s >= 0.96;
    if (end || (p.cmd.jumpHeld && a.t > 0.35)) {
      const dir = _v.subVectors(R.p1, R.p0).setY(0).normalize();
      this.T.end();
      p.state = 'air';
      p.grounded = false;
      p.velocity.set(dir.x * a.v * 0.7, end ? 1.2 : 0.2, dir.z * a.v * 0.7);
      this.T.letGoAt = this.g.health?.time ?? 0;
      this.g.animator.stop(0.2);
    }
  }

  swingStep(a, dt) {
    const p = this.p;
    // a pendulum about the pole; W (or pushing the way he swings) pumps it
    const pump = p.cmd.mv.y > 0.3 ? 1 : 0;
    a.w += (-(9.8 / HANG) * Math.sin(a.th) - 0.25 * a.w) * dt;
    if (pump && Math.sign(a.w) > 0) a.w += 1.6 * dt;
    a.w = clamp(a.w, -4.2, 4.2);
    a.th = clamp(a.th + a.w * dt, -1.35, 1.6);
    // the body: hands on the pole, swung out by th (feet forward when th > 0)
    const s = Math.sin(a.th);
    const c = Math.cos(a.th);
    p.position.set(a.at.x + a.dir.x * s * (HANG - FEET * 0.5), a.at.y - c * (HANG - FEET * 0.5) - FEET * 0.5 * c + FEET, a.at.z + a.dir.z * s * (HANG - FEET * 0.5));
    p.yaw = Math.atan2(a.dir.x, a.dir.z);
    p.climbLean = -a.th;
    p.body.setNextKinematicTranslation(p.position);
    a.creakT = (a.creakT || 0) - dt;
    if (Math.abs(a.th) > 0.6 && a.creakT <= 0) {
      a.creakT = 0.9;
      this.g.audio.play('wicker', { volume: 0.3, rate: 0.55 });
    }
    // Space: let go, flying on the way he swings (best near the top of the forward swing)
    if (p.cmd.jumpHeld && a.t > 0.3) {
      const tv = a.w * HANG; // tangential speed
      this.T.end();
      p.state = 'air';
      p.grounded = false;
      p.velocity.set(a.dir.x * tv * c, 2.4 + Math.max(0, tv * s * 0.5), a.dir.z * tv * c);
      p.climbLean = 0;
      this.T.letGoAt = (this.g.health?.time ?? 0) - 0.2;
      this.g.animator.stop(0.15);
      this.g.audio.play('whoosh', { volume: 0.6, rate: 0.9 });
    } else if (p.cmd.down && a.t > 0.3) {
      this.T.letGo({ x: -a.dir.x, z: -a.dir.z }, 0.2);
    }
  }

  // ------------------------------------------------------------ the hands (Traversal.late)
  late(a) {
    const loco = this.g.animator.loco;
    if (!loco?.b) return;
    if (a.type === 'zip' || a.type === 'swing') {
      // both hands on it, a little apart, closed round it (overhand)
      let along;
      let at;
      if (a.type === 'zip') {
        along = _v.subVectors(a.R.p1, a.R.p0).normalize().clone();
        at = (side) => this.ropeAt(a.R, a.s + (side === 'Left' ? -0.12 : 0.12) / a.R.len, new THREE.Vector3());
      } else {
        along = _v.subVectors(a.P.p1, a.P.p0).normalize().clone();
        at = (side) => a.at.clone().addScaledVector(along, side === 'Left' ? 0.14 : -0.14);
      }
      const fwd = new THREE.Vector3(Math.sin(this.p.yaw), 0, Math.cos(this.p.yaw));
      for (const side of ['Left', 'Right']) {
        const B = loco.b[side];
        if (!B?.arm) continue;
        const target = at(side).addScaledVector(UP, -0.05).addScaledVector(fwd, -0.03);
        _pole.set(fwd.x * -0.3, -0.4, fwd.z * -0.3).normalize();
        solveTwoBone(B.arm, B.fore, B.hand, target, _pole, 1);
        this.T.holdHand(side, _palm.copy(fwd).setY(0.1), _fing.set(0, 1, 0), 'bar', 1);
      }
    }
  }

  // ------------------------------------------------------------ beams (balancing on a plank)
  /** Player: on a beam (a narrow plank)? Then he balances: slower, arms out, swaying. */
  balance(dt, onBeam, side) {
    const loco = this.g.animator.loco;
    this.bal = damp(this.bal || 0, onBeam ? 1 : 0, onBeam ? 6 : 4, dt);
    this.rock = damp(this.rock || 0, onBeam ? side * 0.22 + Math.sin((this.g.health?.time ?? 0) * 1.7) * 0.05 : 0, 3, dt);
    if (this.bal < 0.02 || !loco?.b) return;
    // arms out to the sides, a little forward, hands loose
    const p = this.p;
    const fwd = _w.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    const right = _v.set(-fwd.z, 0, fwd.x);
    for (const [side, s] of [['Left', -1], ['Right', 1]]) {
      const B = loco.b[side];
      if (!B?.arm) continue;
      B.arm.getWorldPosition(_t);
      _t.addScaledVector(right, s * 0.5).addScaledVector(fwd, 0.12);
      _t.y += 0.02 + s * this.rock * 0.25;
      _pole.set(0, -1, 0).addScaledVector(fwd, -0.3);
      solveTwoBone(B.arm, B.fore, B.hand, _t, _pole, this.bal);
    }
  }
}
