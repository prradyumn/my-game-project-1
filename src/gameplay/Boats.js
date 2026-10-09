import * as THREE from 'three';
import { WORLD } from '../config.js';
import { clamp } from '../utils/math.js';
import { groundHeight } from '../world/WorldLayout.js';

// Boats on the Ganga. The Genex boat GLB is normalised (1 unit long along X); we bake it to
// 7.5 m with its bow along +Z. Moored boats are one InstancedMesh; the player's boat is a
// separate mesh with simple buoyancy (4 hull samples -> heave, pitch, roll) and rowing.

export const BOAT = { length: 7.5, draft: 0.32, halfLen: 3.3, halfBeam: 0.95 };

export function prepareBoatGeometry(gltfScene) {
  let mesh = null;
  gltfScene.traverse((o) => {
    if (o.isMesh && !mesh) mesh = o;
  });
  if (!mesh) return null;
  gltfScene.updateMatrixWorld(true);
  const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const size = new THREE.Vector3();
  bb.getSize(size);
  const center = new THREE.Vector3();
  bb.getCenter(center);
  const longIsX = size.x >= size.z;
  const s = BOAT.length / Math.max(size.x, size.z);
  geo.translate(-center.x, -bb.min.y, -center.z);
  if (longIsX) geo.rotateY(-Math.PI / 2);
  geo.scale(s, s, s);
  geo.translate(0, -BOAT.draft, 0);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  const mat = mesh.material;
  mat.envMapIntensity = 0.8;
  return { geometry: geo, material: mat, height: size.y * s };
}

// Fallback hull if the GLB is missing: a simple tapered wooden shell.
export function proceduralBoatGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-1, 0);
  shape.quadraticCurveTo(-1.05, 0.55, -0.7, 0.62);
  shape.lineTo(0.7, 0.62);
  shape.quadraticCurveTo(1.05, 0.55, 1, 0);
  shape.lineTo(-1, 0);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: BOAT.length, bevelEnabled: false }).translate(0, -BOAT.draft, -BOAT.length / 2);
  return { geometry: geo, material: new THREE.MeshStandardMaterial({ color: 0x3d6f7a, roughness: 0.8 }), height: 0.62 };
}

const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

function floatPose(water, x, z, yaw, out) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const fx = s * BOAT.halfLen;
  const fz = c * BOAT.halfLen;
  const rx = c * BOAT.halfBeam;
  const rz = -s * BOAT.halfBeam;
  const bow = water.heightAt(x + fx, z + fz);
  const stern = water.heightAt(x - fx, z - fz);
  const port = water.heightAt(x - rx, z - rz);
  const star = water.heightAt(x + rx, z + rz);
  out.y = (bow + stern + port + star) / 4;
  out.pitch = Math.atan2(stern - bow, BOAT.halfLen * 2) * 1.6;
  out.roll = Math.atan2(port - star, BOAT.halfBeam * 2) * 1.2;
  return out;
}

// Spring-damper step for one degree of freedom (semi-implicit Euler): x'' = w^2 (target - x) - 2 z w x'
function spring(state, key, target, w, zeta, dt) {
  const v = `${key}V`;
  state[v] += (w * w * (target - state[key]) - 2 * zeta * w * state[v]) * dt;
  state[key] += state[v] * dt;
}

const _cur = { x: 0, z: 0 };

export class PlayerBoat {
  constructor(geo, start) {
    this.object = new THREE.Group();
    const mesh = new THREE.Mesh(geo.geometry, geo.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.object.add(mesh);
    // Planar rigid body: position, velocity (world), heading and turn rate.
    this.x = start.x;
    this.z = start.z;
    this.vx = 0;
    this.vz = 0;
    this.yaw = start.yaw + Math.PI / 2; // moored parallel to the bank
    this.yawRate = 0;
    // Vertical dynamics (heave / pitch / roll) chase the wave surface with inertia.
    this.dyn = { y: 0, yV: 0, pitch: 0, pitchV: 0, roll: 0, rollV: 0 };
    this.pose = { y: 0, pitch: 0, roll: 0 };
    this.prev = { x: this.x, z: this.z, yaw: this.yaw, y: 0, pitch: 0, roll: 0 };
    this.strokeTimer = 0;
    this.stroke = 0; // remaining thrust time of the current oar stroke
    this.strokeSide = 0;
    this.rowPhase = 0;
    this.load = 0;
    this.seat = new THREE.Vector3(0, 0.12, -1.6);
    this.input = { thrust: 0, turn: 0 };
    this.power = 1; // stroke strength (Ramu's oar: rows faster after the ferry mission)
    this.boost = 1; // this stroke's strength (a well-timed stroke in the boat race pulls harder)
    this.pendingBoost = 0; // ...set for the next stroke
  }

  get speed() {
    const f = this.forward;
    return this.vx * f.x + this.vz * f.z;
  }

  seatWorld(out) {
    return out.copy(this.seat).applyMatrix4(this.object.matrixWorld);
  }

  get forward() {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  // Someone stepping in or out: the hull dips and rocks.
  addLoad(n) {
    this.load += n;
    this.dyn.yV -= 0.55 * Math.sign(n);
    this.dyn.rollV += 0.35 * Math.sign(n);
  }

  // Horizontal distance from a point to the keel line (bow-stern), for boarding.
  distanceTo(p) {
    const f = this.forward;
    const dx = p.x - this.x;
    const dz = p.z - this.z;
    const along = Math.max(-BOAT.halfLen, Math.min(BOAT.halfLen, dx * f.x + dz * f.z));
    return Math.hypot(dx - f.x * along, dz - f.z * along);
  }

  readInput(input, controlled) {
    if (!controlled) {
      this.input.thrust = 0;
      this.input.turn = 0;
      return;
    }
    const mv = input.move();
    this.input.thrust = mv.y;
    this.input.turn = -mv.x;
  }

  fixedUpdate(dt, water, fx) {
    const P = this.prev;
    P.x = this.x;
    P.z = this.z;
    P.yaw = this.yaw;
    P.y = this.pose.y;
    P.pitch = this.pose.pitch;
    P.roll = this.pose.roll;

    const f = { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
    const r = { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) }; // starboard
    const { thrust, turn } = this.input;

    // --- oars: each stroke is a ~0.55 s pull; turning favours one oar
    this.strokeTimer -= dt;
    if ((Math.abs(thrust) > 0.1 || Math.abs(turn) > 0.1) && this.strokeTimer <= 0) {
      this.strokeTimer = 1.1;
      this.stroke = 0.55;
      this.boost = this.pendingBoost || 1;
      this.pendingBoost = 0;
      this.strokeSide = Math.abs(turn) > 0.3 ? Math.sign(turn) : 0;
      this.strokeDir = Math.abs(thrust) > 0.1 ? Math.sign(thrust) : 1;
      fx.oar(this.x, this.z);
      const yS = water.heightAt(this.x, this.z);
      fx.ripple(this.x + r.x * 1.3, yS, this.z + r.z * 1.3, 1.4);
      fx.ripple(this.x - r.x * 1.3, yS, this.z - r.z * 1.3, 1.4);
      this.dyn.pitchV += 0.05 * this.strokeDir;
    }
    let ax = 0;
    let az = 0;
    let yawAcc = 0;
    if (this.stroke > 0) {
      this.stroke -= dt;
      const pull = Math.sin(Math.PI * (1 - this.stroke / 0.55)); // smooth pulse
      const fwd = (this.strokeSide === 0 ? 2.6 : 1.5) * this.strokeDir * pull * this.power * this.boost;
      ax += f.x * fwd;
      az += f.z * fwd;
      yawAcc += this.strokeSide * 1.4 * pull; // one-oar stroke yaws the boat
    }
    this.rowPhase = (1.1 - Math.max(0, this.strokeTimer)) / 1.1;

    // --- hydrodynamic drag on velocity RELATIVE to the water: low along the keel, high across
    const cur = water.currentAt(this.x, this.z, _cur);
    const rvx = this.vx - cur.x;
    const rvz = this.vz - cur.z;
    const u = rvx * f.x + rvz * f.z; // surge
    const w = rvx * r.x + rvz * r.z; // sway
    const du = -(0.12 * u + 0.05 * u * Math.abs(u));
    const dw = -(1.6 * w + 1.2 * w * Math.abs(w));
    ax += f.x * du + r.x * dw;
    az += f.z * du + r.z * dw;
    // a moving hull turns more readily; drag on rotation
    yawAcc += turn * 0.35 * clamp(Math.abs(u), 0, 2) * Math.sign(u || 1);
    yawAcc -= 1.1 * this.yawRate + 0.8 * this.yawRate * Math.abs(this.yawRate);

    this.vx += ax * dt;
    this.vz += az * dt;
    this.yawRate += yawAcc * dt;
    this.yaw += this.yawRate * dt;
    let nx = this.x + this.vx * dt;
    let nz = this.z + this.vz * dt;

    // --- collision with the ghats / banks: probe hull points against the river bed
    const draft = -0.45;
    for (const [along, side] of [[1, 0], [-1, 0], [0.55, 1], [0.55, -1], [-0.55, 1], [-0.55, -1]]) {
      const px = nx + f.x * BOAT.halfLen * along + r.x * BOAT.halfBeam * side;
      const pz = nz + f.z * BOAT.halfLen * along + r.z * BOAT.halfBeam * side;
      const g = groundHeight(px, pz);
      if (g <= draft) continue;
      // normal = downhill direction of the bed (finite differences)
      const e = 0.6;
      let gx = groundHeight(px + e, pz) - groundHeight(px - e, pz);
      let gz = groundHeight(px, pz + e) - groundHeight(px, pz - e);
      const gl = Math.hypot(gx, gz) || 1;
      gx = -gx / gl;
      gz = -gz / gl;
      const pen = Math.min(0.5, (g - draft) * 0.5 + 0.02);
      nx += gx * pen;
      nz += gz * pen;
      const vn = this.vx * gx + this.vz * gz;
      if (vn < 0) {
        // bounce off with a little restitution, scrub some tangential speed
        this.vx -= (1.25 * vn) * gx;
        this.vz -= (1.25 * vn) * gz;
        this.vx *= 0.92;
        this.vz *= 0.92;
        this.yawRate *= 0.7;
      }
    }
    // --- the moored boats: hull against hull (three circles down each keel); the one struck rocks
    if (this.moored) {
      const mine = [-2.5, 0, 2.5].map((k) => ({ x: nx + f.x * k, z: nz + f.z * k }));
      for (const sp of this.moored.spots) {
        if (Math.abs(sp.x - nx) > 9 || Math.abs(sp.z - nz) > 9) continue;
        const sf = { x: Math.sin(sp.yaw), z: Math.cos(sp.yaw) };
        let px = 0;
        let pz = 0;
        let hits = 0;
        for (const a of mine) {
          for (const k of [-2.4, 0, 2.4]) {
            const dx = a.x - (sp.x + sf.x * k);
            const dz = a.z - (sp.z + sf.z * k);
            const d = Math.hypot(dx, dz);
            if (d < 2.0 && d > 1e-4) {
              px += (dx / d) * (2.0 - d);
              pz += (dz / d) * (2.0 - d);
              hits++;
            }
          }
        }
        if (!hits) continue;
        px /= hits;
        pz /= hits;
        const l = Math.hypot(px, pz) || 1;
        nx += px;
        nz += pz;
        const vn = this.vx * (px / l) + this.vz * (pz / l);
        if (vn < 0) {
          this.vx -= 1.3 * vn * (px / l);
          this.vz -= 1.3 * vn * (pz / l);
          this.yawRate *= 0.6;
          // the moored boat takes the knock: it rolls and heaves on its rope
          const side = Math.sign((px / l) * sf.z - (pz / l) * sf.x) || 1;
          sp.dyn.rollV += side * Math.min(0.9, -vn * 0.45);
          sp.dyn.yV -= Math.min(0.35, -vn * 0.1);
          this.dyn.rollV -= side * Math.min(0.4, -vn * 0.15);
          if (-vn > 0.6) fx.bump?.(nx - px * 2, nz - pz * 2, -vn);
        }
      }
    }
    this.x = clamp(nx, WORLD.xMin + 5, WORLD.xMax - 5);
    this.z = clamp(nz, WORLD.zMin, WORLD.zMax - 5);

    // --- vertical dynamics: heave/pitch/roll springs toward the wave equilibrium
    floatPose(water, this.x, this.z, this.yaw, this.pose);
    const sink = 0.07 * this.load;
    spring(this.dyn, 'y', this.pose.y - sink, 3.6, 0.35, dt);
    spring(this.dyn, 'pitch', this.pose.pitch, 3.0, 0.3, dt);
    spring(this.dyn, 'roll', this.pose.roll - this.yawRate * u * 0.05, 3.4, 0.22, dt);
    this.pose.y = this.dyn.y;
    this.pose.pitch = this.dyn.pitch;
    this.pose.roll = this.dyn.roll;
    if (Math.abs(u) > 1.2 && Math.random() < dt * 4) fx.ripple(this.x - f.x * 3.4, this.pose.y, this.z - f.z * 3.4, 2.2);
  }

  // Interpolate between the last two physics states for smooth rendering.
  lateUpdate(alpha) {
    const P = this.prev;
    const lerp = (a, b) => a + (b - a) * alpha;
    const yaw = P.yaw + Math.atan2(Math.sin(this.yaw - P.yaw), Math.cos(this.yaw - P.yaw)) * alpha;
    _e.set(lerp(P.pitch, this.pose.pitch), yaw, lerp(P.roll, this.pose.roll));
    this.object.quaternion.setFromEuler(_e);
    this.object.position.set(lerp(P.x, this.x), lerp(P.y, this.pose.y), lerp(P.z, this.z));
    this.object.updateMatrixWorld();
  }

  // Somewhere dry to step off, or null to slip into the water.
  findLanding() {
    const f = this.forward;
    const r = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const cands = [];
    for (const d of [2.0, 2.8, 3.6, 4.6, 5.8, 7.0, 8.5]) {
      for (const dir of [r, r.clone().negate(), f, f.clone().negate()]) {
        const x = this.x + dir.x * d;
        const z = this.z + dir.z * d;
        const g = groundHeight(x, z);
        if (g > -0.25 && g < 3.5) cands.push({ x, y: Math.max(g, 0), z, d });
      }
    }
    cands.sort((a, b) => a.d - b.d);
    return cands[0] || null;
  }
}

export class MooredBoats {
  constructor(geo, spots) {
    this.spots = spots.map((s) => ({ ...s, ph: Math.random() * 10, dyn: { y: 0, yV: 0, pitch: 0, pitchV: 0, roll: 0, rollV: 0 } }));
    this.mesh = new THREE.InstancedMesh(geo.geometry, geo.material, spots.length);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.pose = { y: 0, pitch: 0, roll: 0 };
  }

  update(dt, water, camPos) {
    const d = Math.min(dt, 1 / 30);
    this.spots.forEach((s, i) => {
      if (Math.abs(s.x - camPos.x) > 220 && i % 4 !== Math.floor(water.time * 10) % 4) return;
      floatPose(water, s.x, s.z, s.yaw, this.pose);
      spring(s.dyn, 'y', this.pose.y, 3.6, 0.35, d);
      spring(s.dyn, 'pitch', this.pose.pitch, 3.0, 0.3, d);
      spring(s.dyn, 'roll', this.pose.roll, 3.4, 0.25, d);
      _e.set(s.dyn.pitch, s.yaw + Math.sin(water.time * 0.2 + s.ph) * 0.03, s.dyn.roll);
      _q.setFromEuler(_e);
      _m.compose(_p.set(s.x, s.dyn.y, s.z), _q, _s);
      this.mesh.setMatrixAt(i, _m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
