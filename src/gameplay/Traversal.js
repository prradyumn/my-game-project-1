import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PLAYER } from '../config.js';
import { GROUPS } from '../core/Physics.js';
import { clamp, dampAngle, lerp, smoothstep } from '../utils/math.js';
import { solveTwoBone } from '../utils/bones.js';
import { groundHeight } from '../world/WorldLayout.js';

// Getting over things and up onto the rooftops, all motion capture (prady-moves.json) with IK
// putting the hands where the stone and the bamboo really are:
//
//   vault     running at a railing, a parapet or a low wall (0.35–1.25 m, not too deep): a leap
//             over it, one hand on the top, landing running on the far side (or dropping down)
//   scramble  walking or running at a ledge 1.05–2.9 m above the feet with room on top (or Space
//             facing it): hands up onto the edge, a scramble up and over
//   ladders   bamboo ladders lean against the havelis: up from the lanes between the ghats, and
//             from one roof up to a taller one. W / S climb, Shift climbs fast, C slides down,
//             Space lets go. At the top he climbs over the parapet onto the roof; E at a
//             ladder's head on a roof climbs back down.
//   rooftops  every roof has its parapet (Physics), plank bridges cross the narrow lanes between
//             roofs of a height, so the waterfront row is one long run above the ghats.
//   wall run  sprinting at a wall, Space: up it a few strides (a scramble's hands and feet on the
//             stone); a ledge in reach at the top is caught, else he kicks off it backwards
//   ledges    jumping or falling at a wall whose top is in reach catches it: hanging by both
//             hands (prady-moves2.json, the hands IK'd onto the edge). A / D shimmy along it hand
//             over hand while it runs on, W or Space pulls up over it (the scramble), S or C drops.
//
// While a move owns the body Player.state is 'climb': the capsule is placed by the move itself.

const FEET = PLAYER.halfHeight + PLAYER.radius;
const HANG_DROP = 2.08; // a ledge's top to his feet as he hangs from it
const DOWN = { x: 0, y: -1, z: 0 };
const UP = { x: 0, y: 1, z: 0 };
const RUNG = 0.33;
const CLIMB_SPEED = 1.35; // m/s up a ladder (Shift: x1.5)
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _t = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

function local(b, lx, lz) {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  return { x: b.x + lx * c + lz * s, z: b.z - lx * s + lz * c };
}

export class Traversal {
  constructor(game) {
    this.g = game;
    this.act = null;
    this.hold = 0;
    this.ladders = [];
    this.planks = [];
    this.build();
  }

  get p() {
    return this.g.player;
  }

  // ------------------------------------------------------------ the routes (ladders, planks)
  build() {
    const g = this.g;
    const row = g.world.layout.buildings.filter((b) => b.row === 0).sort((a, b) => a.x - b.x);
    const top = (b) => b.baseY + b.h;
    for (let i = 0; i < row.length - 1; i++) {
      const a = row[i];
      const b = row[i + 1];
      const ea = local(a, a.w / 2, 0);
      const eb = local(b, -b.w / 2, 0);
      const gap = Math.hypot(eb.x - ea.x, eb.z - ea.z);
      const lower = top(a) <= top(b) ? a : b;
      const taller = lower === a ? b : a;
      const dh = top(taller) - top(lower);
      // (the havelis stand a hand's width to a lane apart, fanned by the curve of the bank)
      if (gap > 2.4 && lower.kind === 'haveli' && top(lower) - lower.baseY < 21) {
        // a lane between them: a ladder up the lower one's side from the street
        const side = lower === a ? 1 : -1;
        this.addLadder(lower, side, lower.d / 2 - 2.6, null);
      }
      if (gap < 6 && a.kind === 'haveli' && b.kind === 'haveli') {
        // roofs of a height: a plank across from parapet to parapet; a taller neighbour: a
        // ladder up its side, its foot on the lower one's parapet
        if (dh < 2.0) this.addPlank(a, b, Math.min(a.d, b.d) / 2 - 3.2);
        else if (dh < 12 && gap < 2.4) this.addLadder(taller, taller === a ? 1 : -1, Math.min(a.d, b.d) / 2 - 2.2, lower, gap);
      }
    }
    this.mesh = this.buildMesh();
    g.scene.add(this.mesh);
  }

  /**
   * A ladder against building b's side (side +1: its +x face, -1: its -x face) at lz along its
   * depth; standing on the street (onRoof null) or on the roof of building onRoof.
   */
  addLadder(b, side, lz, onRoof, gap = 0) {
    const g = this.g;
    const wall = local(b, (side * b.w) / 2, lz);
    // outward normal of that face
    const n = local({ x: 0, z: 0, yaw: b.yaw }, side, 0);
    const out = { x: n.x, z: n.z };
    // on a roof its foot stands on the near parapet of the lower house, across the slot
    const off = onRoof ? gap + 0.12 : 0.85;
    const foot = { x: wall.x + out.x * off, z: wall.z + out.z * off };
    const y0 = onRoof ? onRoof.baseY + onRoof.h + 0.9 : groundHeight(foot.x, foot.z);
    // (the street must be dry stone with room to stand)
    if (!onRoof && Math.abs(y0 - b.baseY) > 1.5) return;
    if (!onRoof) {
      const hit = g.physics.castRay({ x: foot.x, y: y0 + 2, z: foot.z }, DOWN, 2.6, undefined, GROUPS.feet);
      if (hit !== null && y0 + 2 - hit > y0 + 0.4) return;
    }
    const y1 = b.baseY + b.h + 0.9; // the parapet's top
    this.ladders.push({ b, wall, out, y0, y1, top: y1 + 0.55, yaw: Math.atan2(-out.x, -out.z), lean0: off, lean1: 0.14, roof: !!onRoof });
  }

  /** A plank from a's roof to b's across the lane between them (resting on both parapets). */
  addPlank(a, b, lz) {
    const g = this.g;
    const pa = local(a, a.w / 2 - 0.12, lz);
    const pb = local(b, -b.w / 2 + 0.12, lz);
    const ya = a.baseY + a.h + 0.9 + 0.04;
    const yb = b.baseY + b.h + 0.9 + 0.04;
    const len = Math.hypot(pb.x - pa.x, pb.z - pa.z, yb - ya);
    const mid = new THREE.Vector3((pa.x + pb.x) / 2, (ya + yb) / 2, (pa.z + pb.z) / 2);
    const dir = new THREE.Vector3(pb.x - pa.x, yb - ya, pb.z - pa.z).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
    // keep it flat across (no roll)
    const yaw = Math.atan2(-(pb.z - pa.z), pb.x - pa.x);
    const pitch = Math.asin(clamp(dir.y, -1, 1));
    q.setFromEuler(_e.set(0, yaw, pitch, 'YZX'));
    g.physics.addBoxQ(mid.x, mid.y - 0.04, mid.z, len + 0.5, 0.08, 0.62, { x: q.x, y: q.y, z: q.z, w: q.w });
    this.planks.push({ mid, len: len + 0.5, q });
  }

  buildMesh() {
    const parts = [];
    const bamboo = (x0, y0, z0, x1, y1, z1, r) => {
      const a = new THREE.Vector3(x0, y0, z0);
      const b = new THREE.Vector3(x1, y1, z1);
      const len = a.distanceTo(b);
      const geo = new THREE.CylinderGeometry(r, r * 1.05, len, 6, 1);
      geo.applyQuaternion(_q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
      geo.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      parts.push(geo.toNonIndexed());
    };
    for (const L of this.ladders) {
      const right = { x: -L.out.z, z: L.out.x };
      const at = (y, s) => {
        const k = (y - L.y0) / (L.top - L.y0);
        const off = lerp(L.lean0, L.lean1, k);
        return [L.wall.x + L.out.x * off + right.x * 0.23 * s, y, L.wall.z + L.out.z * off + right.z * 0.23 * s];
      };
      for (const s of [-1, 1]) bamboo(...at(L.y0 - 0.05, s), ...at(L.top, s), 0.035);
      for (let y = L.y0 + 0.3; y < L.top - 0.15; y += RUNG) bamboo(...at(y, -1), ...at(y, 1), 0.02);
    }
    for (const P of this.planks) {
      const geo = new THREE.BoxGeometry(P.len, 0.06, 0.6, 1, 1, 1).applyQuaternion(P.q).translate(P.mid.x, P.mid.y - 0.03, P.mid.z);
      parts.push(geo.toNonIndexed());
    }
    const geo = parts.length ? mergeGeometries(parts.map((p) => { p.deleteAttribute('uv'); return p; })) : new THREE.BufferGeometry();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x9c7a46, roughness: 0.78 }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'ladders';
    return mesh;
  }

  /** A point on ladder L at height y (its plane, between the rails). */
  ladderPoint(L, y, out) {
    const k = clamp((y - L.y0) / (L.top - L.y0), 0, 1);
    const off = lerp(L.lean0, L.lean1, k);
    return out.set(L.wall.x + L.out.x * off, y, L.wall.z + L.out.z * off);
  }

  // ------------------------------------------------------------ what can be done here
  /** The ladder prompts: at its foot (climb), at its head on the roof (climb down). */
  interaction() {
    const p = this.p;
    if (this.act || p.state !== 'ground') return null;
    const P = p.position;
    const fy = p.feetY;
    for (const L of this.ladders) {
      const foot = this.ladderPoint(L, L.y0, _v);
      if (fy - L.y0 < 0.6 && fy - L.y0 > (L.roof ? -1.2 : -0.6) && Math.hypot(P.x - foot.x, P.z - foot.z) < 1.9) return { prompt: 'Climb the ladder', action: () => this.mountLadder(L, 'bottom') };
      // at its head: on the roof behind the parapet
      const head = { x: L.wall.x - L.out.x * 0.7, z: L.wall.z - L.out.z * 0.7 };
      if (Math.abs(fy - (L.y1 - 0.9)) < 0.6 && Math.hypot(P.x - head.x, P.z - head.z) < 1.2) return { prompt: 'Climb down the ladder', action: () => this.mountLadder(L, 'top') };
    }
    return null;
  }

  /** Every physics step on the ground (before the step-up climb): start a vault or a scramble. */
  check(dt) {
    const p = this.p;
    if (this.act || p.state !== 'ground' || !p.grounded || p.cmd.mag < 0.3 || p.combat?.busy) {
      this.hold = 0;
      return false;
    }
    const w = p.cmd.wish;
    if (w.lengthSq() < 0.01) return false;
    // walking into a ladder's foot climbs it
    for (const L of this.ladders) {
      const dy = p.feetY - L.y0;
      if (dy > 0.6 || dy < (L.roof ? -1.2 : -0.6)) continue;
      const foot = this.ladderPoint(L, L.y0, _v);
      const d = Math.hypot(p.position.x - foot.x, p.position.z - foot.z);
      if (d < 1.0 && -(w.x * L.out.x + w.z * L.out.z) > 0.7) {
        this.mountLadder(L, 'bottom');
        return true;
      }
    }
    // only straight at it (not sliding along a wall)
    const fwd = { x: Math.sin(p.yaw), z: Math.cos(p.yaw) };
    if (fwd.x * w.x + fwd.z * w.z < 0.75) return false;
    if (p.speed > 2.6 && this.tryVault(w)) return true;
    const s = this.scrambleSpot(w, 0.75);
    if (!s) {
      this.hold = 0;
      return false;
    }
    this.hold += dt;
    // (a moment pushing into it: brushing past a wall never climbs it)
    if (this.hold < (p.speed > 2.6 ? 0.06 : 0.16)) return true;
    this.hold = 0;
    this.startScramble(s);
    return true;
  }

  /** Space facing a ledge: climb it. */
  tryJump() {
    const p = this.p;
    if (this.act || p.state !== 'ground') return false;
    const w = p.cmd.mag > 0.2 ? p.cmd.wish : _w.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    if (p.speed > 2.6 && this.tryVault(w)) return true;
    const s = this.scrambleSpot(w, 1.0);
    if (s) {
      this.startScramble(s);
      return true;
    }
    // a wall too tall to scramble: up it (at a run, or pressed against it)
    return (p.speed > 3.2 || p.cmd.mag > 0.2) && this.tryWallRun(w, p.speed <= 3.2);
  }

  // ------------------------------------------------------------ ledges and wall runs
  /**
   * A ledge ahead of (ox, oy, oz) along w: a wall within `reach`, its top edge between minY and
   * maxY (world) with open air above it. { hx, hz (on the face), top, f (into the wall), r }.
   */
  ledgeAhead(ox, oy, oz, w, reach, minY, maxY) {
    const ph = this.g.physics;
    const p = this.p;
    const hit = ph.castRayNormal({ x: ox, y: oy, z: oz }, { x: w.x, y: 0, z: w.z }, reach, p.collider, GROUPS.climb);
    if (!hit || Math.abs(hit.ny) > 0.35) return null;
    const nl = Math.hypot(hit.nx, hit.nz) || 1;
    const f = { x: -hit.nx / nl, z: -hit.nz / nl };
    let hx = ox + w.x * hit.toi;
    let hz = oz + w.z * hit.toi;
    // its top, just inside the face (from above: a wall that runs on higher starts the ray inside
    // itself and reads as too tall)
    const from = maxY + 0.5;
    const span = from - minY + 0.3;
    let top = this.topAt(hx + f.x * 0.12, hz + f.z * 0.12, from, span);
    if (top === null || top < minY || top > maxY) {
      // or a ledge standing out from the face above him (a chhajja, a cornice): felt for outward
      // from the wall, then its lip found
      top = null;
      let lip = 0;
      for (let d = 0.1; d < 0.95; d += 0.1) {
        const t = this.topAt(hx - f.x * d, hz - f.z * d, from, span);
        if (t !== null && t >= minY && t <= maxY && (top === null || Math.abs(t - top) < 0.06)) {
          top = Math.max(top ?? t, t);
          lip = d;
        } else if (top !== null) break;
      }
      if (top === null) return null;
      let out = lip + 0.1;
      for (let i = 0; i < 3; i++) {
        const mid = (lip + out) / 2;
        const t = this.topAt(hx - f.x * mid, hz - f.z * mid, from, span);
        if (t !== null && Math.abs(t - top) < 0.06) lip = mid;
        else out = mid;
      }
      hx -= f.x * lip;
      hz -= f.z * lip;
    }
    // hands' room on it: nothing standing on the edge itself
    if (ph.castRay({ x: hx - f.x * 0.2, y: top + 0.1, z: hz - f.z * 0.2 }, { x: f.x, y: 0, z: f.z }, 0.45, p.collider, GROUPS.climb) !== null) return null;
    // and the body's room under it (a balcony below a chhajja)
    if (ph.sphereCastOnly({ x: hx - f.x * 0.36, y: top - 0.3, z: hz - f.z * 0.36 }, DOWN, 0.26, 1.5, GROUPS.decor, p.collider) !== null) return null;
    return { hx, hz, top, f, r: { x: -f.z, z: f.x } }; // (r: his right as he faces the wall)
  }

  /** Falling or at the top of a jump beside a wall: a ledge in reach is caught. */
  airGrab() {
    const p = this.p;
    if (this.act || p.state !== 'air' || p.velocity.y > 2.5 || this.g.combat?.dead) return false;
    if (this.g.health?.time - (this.letGoAt ?? -9) < 0.45) return false;
    const v = p.velocity;
    const hs = Math.hypot(v.x, v.z);
    const w = hs > 0.6 ? _w.set(v.x / hs, 0, v.z / hs) : _w.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    const L = this.ledgeAhead(p.position.x, p.feetY + 1.3, p.position.z, w, 0.8, p.feetY + 1.7, p.feetY + 2.45);
    if (!L) return false;
    this.startHang(L);
    return true;
  }

  tryWallRun(w, standing = false) {
    const p = this.p;
    const ph = this.g.physics;
    const o = { x: p.position.x, y: p.feetY + 1.0, z: p.position.z };
    const hit = ph.castRayNormal(o, { x: w.x, y: 0, z: w.z }, standing ? 0.85 : 1.5, p.collider, GROUPS.climb);
    if (!hit || Math.abs(hit.ny) > 0.3) return false;
    const nl = Math.hypot(hit.nx, hit.nz) || 1;
    const f = { x: -hit.nx / nl, z: -hit.nz / nl };
    // square enough to it (a glancing run along a wall is not a run up it)
    if (f.x * w.x + f.z * w.z < 0.75) return false;
    // the face must go up (no wall-run into a fence) and leave room overhead to rise
    if (ph.castRay({ x: o.x, y: p.feetY + 2.2, z: o.z }, { x: f.x, y: 0, z: f.z }, hit.toi + 0.4, p.collider, GROUPS.climb) === null) return false;
    // (a low ceiling, not a ledge overhead: that he catches on the way up)
    if (ph.sphereCast({ x: p.position.x, y: p.feetY + 1.6, z: p.position.z }, UP, 0.25, 0.9, p.collider, GROUPS.feet) !== null) return false;
    const wall = new THREE.Vector3(o.x + w.x * hit.toi - f.x * 0.4, 0, o.z + w.z * hit.toi - f.z * 0.4);
    // (and no balcony on the way up the face)
    if (ph.sphereCastOnly({ x: wall.x, y: p.feetY + 0.9, z: wall.z }, UP, 0.3, 3.6, GROUPS.decor, p.collider) !== null) return false;
    this.act = { type: 'wallrun', t: 0, T: 0.62, p0: p.position.clone(), wall, f, f0: p.feetY, rise: 2.35, yaw: Math.atan2(f.x, f.z) };
    p.state = 'climb';
    p.velocity.set(0, 0, 0);
    // strides up the face (the run cycle, quickened), the body leaning back off it
    const anim = this.g.animator;
    if (!anim.play('wallRun', { loop: true, timeScale: 1.35, fadeIn: 0.1, fadeOut: 0.2, cancelOnMove: false, noLook: true, noFootIK: true })) anim.play('scramble', { timeScale: 4.2, fadeIn: 0.08, fadeOut: 0.2, cancelOnMove: false, noLook: true, noFootIK: true });
    this.g.audio.play('footstep', { volume: 0.75, rate: 0.9 });
    return true;
  }

  wallRunStep(a, dt) {
    const p = this.p;
    const k = Math.min(1, a.t / a.T);
    p.yaw = dampAngle(p.yaw, a.yaw, 16, dt);
    // onto the face in the first strides, then up it, slowing as the run gives out
    const onto = smoothstep(0, 0.3, k);
    const up = 1 - (1 - k) * (1 - k);
    p.position.set(lerp(a.p0.x, a.wall.x, onto), a.f0 + a.rise * up + FEET, lerp(a.p0.z, a.wall.z, onto));
    p.climbLean = -0.2 * smoothstep(0.05, 0.3, k) * (1 - smoothstep(0.55, 0.9, k));
    // the run gives out: both arms up for the edge
    if (k > 0.58 && !a.reach) {
      a.reach = true;
      this.g.animator.play('hang', { loop: true, fadeIn: 0.2, fadeOut: 0.25, cancelOnMove: false, noLook: true, noFootIK: true });
    }
    if (k > 0.2 && Math.floor(a.t / 0.16) !== Math.floor((a.t - dt) / 0.16)) this.g.audio.play('footstep', { volume: 0.55, rate: 1.05 + Math.random() * 0.15 });
    // a ledge within reach of the run: he runs on up to hanging height under it, then catches it
    // (a chhajja overhead is caught from below, never run into)
    if (!a.L && k > 0.08) a.L = this.ledgeAhead(p.position.x, p.feetY + 1.3, p.position.z, a.f, 0.9, p.feetY + 1.45, a.f0 + a.rise + 2.05);
    if (a.L && (p.feetY >= a.L.top - HANG_DROP - 0.03 || k >= 1)) {
      const L = a.L;
      this.end();
      this.startHang(L);
      return;
    }
    if (k >= 1) {
      // nothing to catch: kicked off the wall, turned away from it
      this.end();
      p.state = 'air';
      p.grounded = false;
      p.yaw = Math.atan2(-a.f.x, -a.f.z);
      p.velocity.set(-a.f.x * 3.2, 3.4, -a.f.z * 3.2);
      this.letGoAt = this.g.health?.time ?? 0;
      this.g.animator.stop(0.15);
      this.g.audio.play('whoosh', { volume: 0.45, rate: 1.1 });
    }
  }

  startHang(L) {
    const p = this.p;
    const fresh = this.act?.type !== 'hang';
    this.act = { type: 'hang', t: 0, L: { ...L }, u: 0, v: 0, lh: -0.22, rh: 0.22, step: null, settle: 0, from: p.position.clone() };
    p.state = 'climb';
    p.velocity.set(0, 0, 0);
    p.grounded = false;
    if (fresh) {
      if (!this.g.animator.isPlaying('hang')) this.g.animator.play('hang', { loop: true, fadeIn: 0.12, fadeOut: 0.25, cancelOnMove: false, noLook: true, noFootIK: true });
      this.g.audio.play('thump', { volume: 0.35, rate: 1.4 });
      this.g.camRig.shake(0.08);
    }
  }

  /** Where his body hangs from the ledge at u (metres along it from where he caught it). */
  hangPoint(a, out) {
    const L = a.L;
    out.set(L.hx - L.f.x * 0.36 + L.r.x * a.u, L.top - HANG_DROP + FEET, L.hz - L.f.z * 0.36 + L.r.z * a.u);
    return out;
  }

  hangStep(a, dt) {
    const p = this.p;
    const c = p.cmd;
    const L = a.L;
    p.yaw = dampAngle(p.yaw, Math.atan2(L.f.x, L.f.z), 14, dt);
    // the catch: a little drop and a swing in toward the wall, settling
    a.settle = Math.min(1, a.settle + dt * 3);
    // shimmy: A / D along the ledge while it runs on (felt for a step ahead each frame)
    const side = Math.abs(c.mv.x) > 0.35 ? Math.sign(c.mv.x) : 0;
    let want = 0;
    if (side) {
      const pr = _t.set(L.hx + L.r.x * (a.u + side * 0.45) - L.f.x * 0.5, 0, L.hz + L.r.z * (a.u + side * 0.45) - L.f.z * 0.5);
      const ahead = this.ledgeAhead(pr.x, L.top - 0.35, pr.z, L.f, 0.9, L.top - 0.15, L.top + 0.15);
      // (and nothing in the way of the body: a pillar, a drainpipe, the next house)
      const body = this.hangPoint(a, _w);
      const blocked = this.g.physics.sphereCast({ x: body.x, y: body.y + 0.4, z: body.z }, { x: L.r.x * side, y: 0, z: L.r.z * side }, 0.28, 0.4, p.collider, GROUPS.feet) !== null;
      if (ahead && !blocked) want = side * 0.62;
    }
    a.v += (want - a.v) * Math.min(1, dt * 8);
    a.u += a.v * dt;
    const P = this.hangPoint(a, _v);
    P.y += (1 - a.settle) * 0.12 * Math.sin(a.settle * Math.PI);
    // (from wherever he caught it: a jump's apex, a run up the wall)
    if (a.from) {
      const b = smoothstep(0, 0.22, a.t);
      P.lerpVectors(a.from, P, b);
      if (b >= 1) a.from = null;
    }
    p.position.copy(P);
    // the hands step along the edge: the leading one reaches, then the other follows
    const st = a.step;
    if (st) {
      st.t += dt / 0.17;
      a[st.hand] = lerp(st.from, st.to, smoothstep(0, 1, st.t));
      if (st.t >= 1) a.step = null;
    } else if (Math.abs(a.v) > 0.05) {
      const lead = a.v > 0 ? 'rh' : 'lh';
      const trail = lead === 'rh' ? 'lh' : 'rh';
      const ls = lead === 'rh' ? 1 : -1;
      if ((a[lead] - a.u) * ls < 0.12) a.step = { hand: lead, from: a[lead], to: a.u + ls * 0.36, t: 0 };
      else if ((a.u - a[trail]) * ls > 0.36) a.step = { hand: trail, from: a[trail], to: a.u - ls * 0.12, t: 0 };
    }
    if (a.t < 0.3) return;
    // up over it (W or Space) when there is a level place to stand with room overhead
    if ((c.mv.y > 0.5 || c.jumpHeld) && !side) {
      const ex = L.hx + L.r.x * a.u;
      const ez = L.hz + L.r.z * a.u;
      // (a wall top: well past the edge; a chhajja: just on it, back to the wall; a parapet: over
      // it and down onto the roof behind)
      // (a wall close behind the edge: he stands a body's depth off it, not pressed into it)
      const back = this.g.physics.castRay({ x: ex, y: L.top + 1.1, z: ez }, { x: L.f.x, y: 0, z: L.f.z }, 1.2, p.collider, GROUPS.climb);
      for (const d0 of [0.55, 0.34, 0.7]) {
        const d = back !== null && back - d0 < 0.36 ? Math.max(0.14, back - 0.36) : d0;
        const sx = ex + L.f.x * d;
        const sz = ez + L.f.z * d;
        const stand = this.topAt(sx, sz, L.top + 0.5, 1.8);
        const headroom = stand !== null && this.g.physics.sphereCast({ x: sx, y: stand + 0.45, z: sz }, UP, 0.27, 1.25, p.collider, GROUPS.feet) === null;
        if (stand !== null && headroom && stand < L.top + 0.4 && stand > L.top - 1.25) {
          this.end();
          this.startScramble({ hx: ex, hz: ez, clear: L.top, stand, sx, sz, w: L.f, h: L.top - p.feetY });
          return;
        }
      }
    }
    // let go (S or C), or a blow knocks him off
    if (c.mv.y < -0.5 || c.down) this.letGo(L.f, 0.8);
  }

  letGo(f, push = 0.8) {
    const p = this.p;
    this.end();
    p.state = 'air';
    p.grounded = false;
    p.velocity.set(-f.x * push, -0.5, -f.z * push);
    this.letGoAt = this.g.health?.time ?? 0;
    this.g.animator.stop(0.15);
  }

  topAt(x, z, fromY, span = 3.6) {
    const d = this.g.physics.castRay({ x, y: fromY, z }, DOWN, span, this.p.collider, GROUPS.climb);
    return d === null ? null : fromY - d;
  }

  /** A low obstacle ahead to leap over: { hx, hz, top, far (m beyond the near face), land } */
  tryVault(w) {
    const p = this.p;
    const ph = this.g.physics;
    const feet = p.feetY;
    const o = { x: p.position.x, y: feet + 0.42, z: p.position.z };
    const hit = ph.castRayNormal(o, { x: w.x, y: 0, z: w.z }, 0.6 + p.speed * 0.16, p.collider, GROUPS.climb);
    if (!hit || Math.abs(hit.ny) > 0.35) return false;
    const hx = o.x + w.x * hit.toi;
    const hz = o.z + w.z * hit.toi;
    // its top, and how deep it is: along the run until the ground falls away again
    let top = -Infinity;
    let far = null;
    for (let d = 0.08; d <= 1.9; d += 0.12) {
      const t = this.topAt(hx + w.x * d, hz + w.z * d, feet + 2.0, 4.5);
      if (t === null) return false;
      if (t > feet + 0.3) top = Math.max(top, t);
      else {
        far = d;
        break;
      }
    }
    if (far === null || top < feet + 0.35 || top > feet + 1.25) return false;
    // somewhere to land: dry ground beyond, not a long way down a sheer drop into the river
    const lx = hx + w.x * (far + 0.75);
    const lz = hz + w.z * (far + 0.75);
    const land = this.topAt(lx, lz, top + 0.6, 30);
    // (never over a roof's edge into the street by accident: a drop beyond 4 m is no vault)
    if (land === null || land > top - 0.2 || land < feet - 4) return false;
    const g = this.g;
    if (g.water.heightAt(lx, lz) - groundHeight(lx, lz) > 0.9 && land < g.water.heightAt(lx, lz)) return false;
    // nothing to hit the head on over the top, and nobody sitting or standing on it
    for (const k of [0.15, 0.5, 0.85]) {
      if (ph.sphereCast({ x: hx + w.x * (far * k), y: top + 0.3, z: hz + w.z * (far * k) }, UP, 0.3, 1.3, p.collider, GROUPS.feet) !== null) return false;
    }
    this.startVault({ hx, hz, top, far, land, lx, lz, w: { x: w.x, z: w.z } });
    return true;
  }

  /** A ledge ahead to climb onto: { hx, hz, clear (highest point to get over), stand, sx, sz }. */
  scrambleSpot(w, reach) {
    const p = this.p;
    const ph = this.g.physics;
    const feet = p.feetY;
    const o = { x: p.position.x, y: feet + 0.6, z: p.position.z };
    const hit = ph.castRayNormal(o, { x: w.x, y: 0, z: w.z }, reach, p.collider, GROUPS.climb);
    if (!hit || Math.abs(hit.ny) > 0.35) return null;
    const hx = o.x + w.x * hit.toi;
    const hz = o.z + w.z * hit.toi;
    let clear = -Infinity;
    for (const d of [0.05, 0.16, 0.3]) {
      const t = this.topAt(hx + w.x * d, hz + w.z * d, feet + 3.4);
      if (t === null) return null;
      clear = Math.max(clear, t);
    }
    const h = clear - feet;
    if (h < 1.05 || h > 2.9) return null;
    // where he stands: a level spot past the edge (a body's depth off any wall behind it)
    const back = ph.castRay({ x: hx, y: clear + 1.1, z: hz }, { x: w.x, y: 0, z: w.z }, 1.3, p.collider, GROUPS.climb);
    const sd = back !== null && back - 0.62 < 0.36 ? Math.max(0.14, back - 0.36) : 0.62;
    const sx = hx + w.x * sd;
    const sz = hz + w.z * sd;
    const stand = this.topAt(sx, sz, clear + 0.4, 1.6);
    const stand2 = this.topAt(hx + w.x * 0.95, hz + w.z * 0.95, clear + 0.4, 1.6);
    if (stand === null || stand2 === null || Math.abs(stand - stand2) > 0.12 || stand > clear + 0.05) return null;
    // headroom up there
    if (ph.sphereCast({ x: sx, y: stand + 0.45, z: sz }, UP, 0.27, 1.25, p.collider, GROUPS.feet) !== null) return null;
    return { hx, hz, clear, stand, sx, sz, w: { x: w.x, z: w.z }, h };
  }

  // ------------------------------------------------------------ the moves
  startVault(v) {
    const p = this.p;
    const speed = Math.max(4, p.speed);
    const p0 = p.position.clone();
    const p1 = new THREE.Vector3(v.lx, v.land + FEET + 0.02, v.lz);
    const dist = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    const T = clamp(dist / speed, 0.42, 0.7);
    // the arc: high enough that the feet clear the top all the way across it
    const f0 = p.feetY;
    const f1 = v.land;
    const d0 = Math.hypot(v.hx - p0.x, v.hz - p0.z);
    let H = 0.25;
    for (let k = 0; k <= 1; k += 0.05) {
      const dk = k * dist;
      if (dk < d0 - 0.35 || dk > d0 + v.far + 0.35) continue;
      const base = lerp(f0, f1, k);
      const s = Math.pow(Math.sin(Math.PI * k), 0.8);
      if (s > 0.05) H = Math.max(H, (v.top + 0.16 - base) / s);
    }
    this.act = { type: 'vault', t: 0, T, p0, p1, f0, f1, H, v, yaw: Math.atan2(v.w.x, v.w.z), speed };
    p.state = 'climb';
    this.g.animator.play('vault', { timeScale: 0.68 / T, fadeIn: 0.08, fadeOut: 0.22, cancelOnMove: false, noLook: true, noFootIK: true });
    // start where the leap leaves the ground
    if (this.g.animator.cur) this.g.animator.cur.a.time = 0.3;
    this.g.audio.play('footstep', { volume: 0.7, rate: 0.85 });
    this.g.achievements?.event('vault', {});
  }

  startScramble(s) {
    const p = this.p;
    const T = 0.95 + s.h * 0.22;
    const p0 = p.position.clone();
    // up the wall face first (a hand's width off it), then over onto the top
    const wall = new THREE.Vector3(s.hx - s.w.x * 0.38, 0, s.hz - s.w.z * 0.38);
    const p1 = new THREE.Vector3(s.sx, s.stand + FEET + 0.03, s.sz);
    this.act = { type: 'scramble', t: 0, T, p0, p1, wall, clear: s.clear, edge: new THREE.Vector3(s.hx, s.clear, s.hz), f: s.w, yaw: Math.atan2(s.w.x, s.w.z), h: s.h };
    p.state = 'climb';
    this.g.animator.play('scramble', { timeScale: (2.4 / T) * 1.0, fadeIn: 0.12, fadeOut: 0.3, cancelOnMove: false, noLook: true, noFootIK: true });
    this.g.audio.play('footstep', { volume: 0.6, rate: 0.75 });
    this.g.achievements?.event('scramble', {});
  }

  mountLadder(L, from) {
    const p = this.p;
    const y = from === 'bottom' ? L.y0 : L.y1 - 1.75;
    // (from the bottom: a step onto the rungs; from a roof: over the parapet onto its head)
    this.act = { type: 'ladder', t: 0, L, y, v: 0, phase: 'down', start: p.position.clone(), mountT: from === 'top' ? 0.9 : 0.35 };
    p.state = 'climb';
    p.velocity.set(0, 0, 0);
    this.g.animator.play('ladder', { loop: true, fadeIn: 0.25, fadeOut: 0.3, cancelOnMove: false, noLook: true, noFootIK: true, timeScale: 0.001 });
    this.g.audio.play('footstep', { volume: 0.5, rate: 0.7 });
  }

  // ------------------------------------------------------------ fixed 60 Hz (instead of the player)
  fixed(dt) {
    const a = this.act;
    if (!a) return false;
    const p = this.p;
    // (felled on a ladder or a ledge: he lets go and falls)
    if (this.g.combat?.dead) {
      this.end();
      p.state = 'air';
      p.grounded = false;
      return false;
    }
    a.t += dt;
    p.prevPosition.copy(p.position);
    p.prevYaw = p.yaw;
    p.speed = 0;
    if (a.type === 'vault') this.vaultStep(a, dt);
    else if (a.type === 'scramble') this.scrambleStep(a, dt);
    else if (a.type === 'ladder') this.ladderStep(a, dt);
    else if (a.type === 'wallrun') this.wallRunStep(a, dt);
    else if (a.type === 'hang') this.hangStep(a, dt);
    p.body.setNextKinematicTranslation(p.position);
    return true;
  }

  vaultStep(a, dt) {
    const p = this.p;
    const k = Math.min(1, a.t / a.T);
    p.yaw = dampAngle(p.yaw, a.yaw, 14, dt);
    const fy = lerp(a.f0, a.f1, k) + a.H * Math.pow(Math.sin(Math.PI * k), 0.8);
    p.position.set(lerp(a.p0.x, a.p1.x, k), fy + FEET, lerp(a.p0.z, a.p1.z, k));
    p.velocity.set((a.p1.x - a.p0.x) / a.T, 0, (a.p1.z - a.p0.z) / a.T);
    p.speed = a.speed;
    if (k >= 1) {
      // land running (or keep falling, off a roof's edge)
      this.end();
      const below = this.topAt(p.position.x, p.position.z, p.feetY + 0.3, 1.0);
      p.state = below !== null ? 'ground' : 'air';
      p.grounded = below !== null;
      p.velocity.set(Math.sin(a.yaw) * a.speed * 0.9, below !== null ? -2 : 0, Math.cos(a.yaw) * a.speed * 0.9);
      this.g.fx.land?.(3);
      this.g.animator.stop(0.18);
    }
  }

  scrambleStep(a, dt) {
    const p = this.p;
    const k = Math.min(1, a.t / a.T);
    p.yaw = dampAngle(p.yaw, a.yaw, 12, dt);
    // a crouch, up the face to the edge, then over onto the top
    const up = smoothstep(0.08, 0.68, k);
    const over = smoothstep(0.55, 1.0, k);
    const feetUp = lerp(a.p0.y - FEET, a.clear + 0.06, up) - Math.sin(Math.min(1, k / 0.12) * Math.PI) * 0.06;
    const fy = lerp(feetUp, a.p1.y - FEET, over * over);
    const atWall = smoothstep(0, 0.3, k);
    const x0 = lerp(a.p0.x, a.wall.x, atWall);
    const z0 = lerp(a.p0.z, a.wall.z, atWall);
    p.position.set(lerp(x0, a.p1.x, over), Math.max(fy, lerp(a.p0.y - FEET, a.p1.y - FEET, k)) + FEET, lerp(z0, a.p1.z, over));
    p.velocity.set(0, 0, 0);
    if (k >= 1) {
      p.position.copy(a.p1);
      this.end();
      p.state = 'ground';
      p.grounded = true;
      this.g.animator.stop(0.3);
    }
  }

  ladderStep(a, dt) {
    const p = this.p;
    const L = a.L;
    const c = p.cmd;
    const anim = this.g.animator;
    p.yaw = dampAngle(p.yaw, L.yaw, 10, dt);
    if (a.phase === 'down') {
      // onto the rungs (from the roof: over the parapet onto the ladder's head)
      const k = Math.min(1, a.t / a.mountT);
      const on = this.bodyAt(L, a.y, _v);
      p.position.lerpVectors(a.start, on, smoothstep(0, 1, k));
      p.position.y = lerp(a.start.y, on.y, smoothstep(0.2, 1, k)) + Math.sin(k * Math.PI) * (a.mountT > 0.5 ? 0.35 : 0.1);
      if (k >= 1) a.phase = 'on';
      return;
    }
    if (a.phase === 'off') {
      // over the parapet at the top, onto the roof
      const k = Math.min(1, a.t / 1.0);
      const up = smoothstep(0, 0.55, k);
      const over = smoothstep(0.45, 1, k);
      // up until the feet clear the parapet, across it, down onto the roof
      const crest = L.y1 + 0.06 + FEET;
      p.position.x = lerp(a.from.x, a.to.x, over);
      p.position.z = lerp(a.from.z, a.to.z, over);
      p.position.y = lerp(lerp(a.from.y, crest, up), a.to.y, smoothstep(0.78, 1, k));
      if (k >= 1) {
        p.position.copy(a.to);
        this.end();
        p.state = 'ground';
        p.grounded = true;
        anim.stop(0.3);
      }
      return;
    }
    // on the rungs: W / S, Shift faster, C slides down, Space lets go
    let want = c.mv.y * CLIMB_SPEED * (c.sprint ? 1.5 : 1);
    const slide = c.down && a.y > L.y0 + 0.2;
    if (slide) want = -6;
    a.v += (want - a.v) * Math.min(1, dt * (slide ? 6 : 12));
    a.y = clamp(a.y + a.v * dt, L.y0, L.y1 - 1.45);
    this.bodyAt(L, a.y, p.position);
    // the clip steps with the climb (backwards going down); held still when he stops
    if (anim.cur?.name === 'ladder') anim.cur.a.timeScale = slide ? 0.001 : a.v / 0.42;
    a.rungT = (a.rungT || 0) + Math.abs(a.v) * dt;
    if (!slide && a.rungT > RUNG * 2) {
      a.rungT = 0;
      this.g.audio.play('footstep', { volume: 0.22, rate: 1.25 + Math.random() * 0.2 });
    }
    if (c.jumpHeld && a.t > 0.4) {
      // let go: a push off the bamboo, away from the wall
      this.end();
      p.state = 'air';
      p.grounded = false;
      p.velocity.set(L.out.x * 2.6, 1.5, L.out.z * 2.6);
      p.jumpBuffer = 0;
      anim.stop(0.2);
      return;
    }
    if (a.y >= L.y1 - 1.46 && c.mv.y > 0.3) {
      // the head of the ladder: over the parapet onto the roof
      a.phase = 'off';
      a.t = 0;
      a.from = p.position.clone();
      const ry = this.topAt(L.wall.x - L.out.x * 0.85, L.wall.z - L.out.z * 0.85, L.y1 + 1.2, 4);
      a.to = new THREE.Vector3(L.wall.x - L.out.x * 0.85, (ry ?? L.y1 - 0.9) + FEET + 0.03, L.wall.z - L.out.z * 0.85);
      anim.play('scramble', { timeScale: 2.4, fadeIn: 0.15, fadeOut: 0.3, cancelOnMove: false, noLook: true, noFootIK: true });
      return;
    }
    if (a.y <= L.y0 + 0.01 && (c.mv.y < -0.3 || slide) && a.t > 0.3) {
      // the foot: step off backwards onto the street (or the roof below)
      const foot = this.ladderPoint(L, L.y0, _v);
      const fx = foot.x + L.out.x * 0.6;
      const fz = foot.z + L.out.z * 0.6;
      const floor = this.topAt(fx, fz, L.y0 + 0.5, 3) ?? L.y0;
      p.position.set(fx, floor + FEET + 0.03, fz);
      this.end();
      p.state = 'ground';
      p.grounded = true;
      anim.stop(0.3);
      this.g.fx.land?.(2);
    }
  }

  /** Where his capsule hangs on ladder L with the feet at y: out from the rungs, facing them. */
  bodyAt(L, y, out) {
    this.ladderPoint(L, y + 0.25, out);
    out.x += L.out.x * 0.33;
    out.z += L.out.z * 0.33;
    out.y = y + FEET;
    return out;
  }

  end() {
    this.act = null;
    this.hold = 0;
    this.p.climbLean = 0;
  }

  // ------------------------------------------------------------ after the animator: the hands
  late() {
    const a = this.act;
    if (!a) return;
    const anim = this.g.animator;
    const loco = anim.loco;
    if (!loco?.b) return;
    const p = this.p;
    if (a.type === 'vault') {
      // a hand on the top as he goes over (the side toward the obstacle's middle)
      const k = a.t / a.T;
      const w = smoothstep(0.08, 0.22, k) * (1 - smoothstep(0.42, 0.58, k));
      if (w < 0.01) return;
      const B = loco.b.Left;
      if (!B?.arm) return;
      const v = a.v;
      const r = { x: v.w.z, z: -v.w.x };
      _t.set(v.hx + v.w.x * Math.min(0.25, v.far * 0.4) + r.x * 0.12, v.top + 0.03, v.hz + v.w.z * Math.min(0.25, v.far * 0.4) + r.z * 0.12);
      _pole.set(-v.w.x, -0.5, -v.w.z).normalize();
      solveTwoBone(B.arm, B.fore, B.hand, _t, _pole, w);
    } else if (a.type === 'scramble') {
      // both palms on the edge while he pulls himself up
      const k = a.t / a.T;
      const w = smoothstep(0.02, 0.16, k) * (1 - smoothstep(0.62, 0.8, k));
      if (w < 0.01) return;
      const r = { x: a.f.z, z: -a.f.x };
      for (const [side, s] of [['Left', 1], ['Right', -1]]) {
        const B = loco.b[side];
        if (!B?.arm) continue;
        _t.set(a.edge.x + r.x * 0.26 * s + a.f.x * 0.08, a.clear + 0.03, a.edge.z + r.z * 0.26 * s + a.f.z * 0.08);
        _pole.set(-a.f.x, -0.6, -a.f.z).normalize();
        solveTwoBone(B.arm, B.fore, B.hand, _t, _pole, w);
      }
    } else if (a.type === 'hang') {
      // both hands on the edge, where they are along it (lifted a little while one steps)
      const L = a.L;
      for (const [side, s, key] of [['Left', 1, 'lh'], ['Right', -1, 'rh']]) {
        const B = loco.b[side];
        if (!B?.arm) continue;
        const u = a[key];
        const lift = a.step?.hand === key ? Math.sin(Math.min(1, a.step.t) * Math.PI) * 0.07 : 0;
        // (his left hand is on his left as he faces the wall: -r)
        const uu = key === 'lh' ? Math.min(u, a.u - 0.08) : Math.max(u, a.u + 0.08);
        _t.set(L.hx + L.r.x * uu + L.f.x * 0.06, L.top + 0.02 + lift, L.hz + L.r.z * uu + L.f.z * 0.06);
        _pole.set(-L.f.x * 0.6 + L.r.x * -s * 0.8, -0.4, -L.f.z * 0.6 + L.r.z * -s * 0.8).normalize();
        solveTwoBone(B.arm, B.fore, B.hand, _t, _pole, 1);
      }
    } else if (a.type === 'ladder' && a.phase === 'on') {
      // hands on the rails, each on the rung nearest where the clip reaches
      const L = a.L;
      const right = { x: -L.out.z, z: L.out.x };
      for (const [side, s] of [['Left', 1], ['Right', -1]]) {
        const B = loco.b[side];
        if (!B?.arm) continue;
        const h = B.hand.getWorldPosition(_w);
        const ry = L.y0 + 0.3 + Math.round((clamp(h.y, p.feetY + 1.2, p.feetY + 2.05) - L.y0 - 0.3) / RUNG) * RUNG;
        this.ladderPoint(L, ry, _t);
        // (the ladder's left rail is on his right as he faces it)
        _t.x += right.x * 0.2 * -s;
        _t.z += right.z * 0.2 * -s;
        _pole.set(L.out.x * 0.4 + right.x * -s, -0.8, L.out.z * 0.4 + right.z * -s).normalize();
        solveTwoBone(B.arm, B.fore, B.hand, _t, _pole, 0.85);
      }
    }
  }

  reset() {
    if (!this.act) return;
    this.end();
    if (this.p.state === 'climb') this.p.state = 'ground';
    // (the ladder, hang and wall-run loops never end on their own)
    if (['ladder', 'hang', 'wallRun', 'scramble', 'vault'].includes(this.g.animator.cur?.name)) this.g.animator.stop(0.1);
  }
}
