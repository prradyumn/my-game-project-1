import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG } from '../utils/math.js';
import { ghatById, ghatToWorld, PROFILE_LEN } from './WorldLayout.js';

// Offerings on the Ganga: marigold heads, loose rose petals and leaf-plates (dona) that people
// set on the water at the ghats. They drift downstream with the current, bob on the waves and
// part around a boat or a swimmer. One InstancedMesh (one shape, scaled and tinted per kind).

const KINDS = [
  // weight, scale (x, y, z), colours
  { w: 0.55, s: [1, 1, 1], cols: [[1.0, 0.55, 0.06], [1.0, 0.68, 0.1], [0.98, 0.45, 0.04]] }, // marigold
  { w: 0.33, s: [0.55, 0.22, 0.85], cols: [[0.62, 0.05, 0.08], [0.78, 0.12, 0.16], [1.0, 0.6, 0.1]] }, // petals
  { w: 0.12, s: [2.6, 0.32, 2.6], cols: [[0.24, 0.38, 0.14], [0.3, 0.44, 0.16]] }, // dona
];

// where offerings are made (heavier at Dashashwamedh)
const SOURCES = [
  ['assi', 2],
  ['kedar', 1],
  ['dashashwamedh', 4],
  ['manikarnika', 1.5],
  ['scindia', 1],
  ['panchganga', 1],
];

function marigoldGeometry() {
  // a ruffled pom-pom: a squashed sphere with petal bumps, sitting on the waterline
  const g = new THREE.SphereGeometry(0.065, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.62);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const a = Math.atan2(v.z, v.x);
    const ruffle = 1 + 0.16 * Math.sin(a * 9 + v.y * 60) * Math.cos(a * 4);
    p.setXYZ(i, v.x * ruffle, v.y * 0.62 - 0.012, v.z * ruffle);
  }
  const base = new THREE.CircleGeometry(0.065, 10).rotateX(Math.PI / 2).translate(0, -0.012, 0);
  const m = mergeGeometries([g.toNonIndexed(), base.toNonIndexed()]);
  m.computeVertexNormals();
  return m;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();
const _cur = { x: 0, z: 0 };

export class FloatingFlowers {
  constructor(water, quality = 'medium') {
    this.water = water;
    this.count = { low: 140, medium: 260, high: 380, veryhigh: 420, ultra: 460 }[quality] ?? 260;
    this.rng = new RNG(4242);
    this.sources = SOURCES.map(([id, w]) => ({ g: ghatById(id), w })).filter((s) => s.g);
    this.totalW = this.sources.reduce((a, s) => a + s.w, 0);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0 });
    this.mesh = new THREE.InstancedMesh(marigoldGeometry(), mat, this.count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(2); // too small to matter in the mirror
    this.items = [];
    let age = 0;
    for (let i = 0; i < this.count; i++) {
      const f = this._spawn({});
      // spread the first ones along their drift so the river is already dressed
      if (this.handful.left === 0 || i === 0) age = this.rng.range(0, 0.9);
      f.age = age * f.life;
      this.water.currentAt(f.x, f.z, _cur);
      f.x += _cur.x * f.age * 0.8;
      f.z += (_cur.z + f.vz) * f.age * 0.5;
      this.items.push(f);
      this.mesh.setColorAt(i, _c.setRGB(...f.col, THREE.SRGBColorSpace));
    }
    this.mesh.instanceColor.needsUpdate = true;
  }

  _pickSource(avoid) {
    // offerings come by the handful: a few in a row share a spot
    const h = this.handful;
    if (h && h.left-- > 0 && (!avoid || Math.hypot(h.p.x - avoid.x, h.p.z - avoid.z) > 30)) return h.p;
    for (let k = 0; k < 4; k++) {
      let r = this.rng.next() * this.totalW;
      let s = this.sources[0];
      for (const c of this.sources) {
        r -= c.w;
        if (r <= 0) {
          s = c;
          break;
        }
      }
      const p = ghatToWorld(s.g, s.g.width * this.rng.range(0.1, 0.9), PROFILE_LEN + this.rng.range(0.2, 3));
      // never pop in right in front of the camera
      if (!avoid || Math.hypot(p.x - avoid.x, p.z - avoid.z) > 30) {
        this.handful = { p, left: this.rng.int(3, 9) };
        return p;
      }
    }
    return null;
  }

  _spawn(f, avoid) {
    const p = this._pickSource(avoid);
    if (!p) return null;
    let r = this.rng.next();
    let kind = KINDS[0];
    for (const k of KINDS) {
      r -= k.w;
      if (r <= 0) {
        kind = k;
        break;
      }
    }
    const jitter = this.rng.range(0.8, 1.25);
    Object.assign(f, {
      x: p.x + this.rng.range(-0.6, 0.6),
      z: p.z + this.rng.range(-0.4, 0.4),
      vx: 0,
      vz: this.rng.range(0.01, 0.05), // a slow drift out from the steps
      px: 0,
      pz: 0,
      yaw: this.rng.range(0, Math.PI * 2),
      spin: this.rng.range(-0.25, 0.25),
      sx: kind.s[0] * jitter,
      sy: kind.s[1] * jitter,
      sz: kind.s[2] * jitter,
      col: this.rng.pick(kind.cols),
      age: 0,
      life: this.rng.range(240, 420),
      bob: this.rng.range(0, 6.28),
    });
    return f;
  }

  /** Scatter n flowers (the oldest ones) on the water around (x, z), radius r. */
  burst(x, z, n, r = 6) {
    const order = this.items.map((f, i) => i).sort((a, b) => this.items[b].age / this.items[b].life - this.items[a].age / this.items[a].life);
    for (const i of order.slice(0, n)) {
      const f = this.items[i];
      const a = this.rng.range(0, Math.PI * 2);
      const d = Math.sqrt(this.rng.next()) * r;
      this._spawn(f);
      f.x = x + Math.cos(a) * d;
      f.z = z + Math.sin(a) * d;
      this.mesh.setColorAt(i, _c.setRGB(...f.col, THREE.SRGBColorSpace));
    }
    this.mesh.instanceColor.needsUpdate = true;
  }

  /** pushers: [{x, z, r}] — a hull or a swimmer parting the flowers. */
  update(dt, { camera, pushers = [] }) {
    const cam = camera.position;
    let recolor = false;
    for (let i = 0; i < this.items.length; i++) {
      const f = this.items[i];
      f.age += dt;
      if (f.age > f.life) {
        if (this._spawn(f, cam)) {
          this.mesh.setColorAt(i, _c.setRGB(...f.col, THREE.SRGBColorSpace));
          recolor = true;
        } else f.age = f.life;
      }
      const dx = f.x - cam.x;
      const dz = f.z - cam.z;
      const far = dx * dx + dz * dz > 160 * 160;
      if (!far) this.water.currentAt(f.x, f.z, _cur);
      else _cur.x = _cur.z = 0.3;
      // parted by hulls and swimmers
      for (const h of pushers) {
        const hx = f.x - h.x;
        const hz = f.z - h.z;
        const d2 = hx * hx + hz * hz;
        if (d2 < h.r * h.r && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const k = (1 - d / h.r) * 2.2;
          f.px += (hx / d) * k * dt * 4;
          f.pz += (hz / d) * k * dt * 4;
        }
      }
      const drag = Math.exp(-dt * 1.5);
      f.px *= drag;
      f.pz *= drag;
      const out = Math.max(0, 1 - f.age / 60);
      f.x += (_cur.x + f.px) * dt;
      f.z += (_cur.z + f.pz + f.vz * out) * dt;
      f.yaw += f.spin * dt;
      // grow in when offered, sink away at the end
      const life = Math.min(1, f.age / 2) * Math.min(1, (f.life - f.age) / 6);
      if (far || life <= 0) {
        _m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, _m);
        continue;
      }
      const y = this.water.heightAt(f.x, f.z);
      _e.set(Math.sin(this.water.time * 1.3 + f.bob) * 0.12, f.yaw, Math.cos(this.water.time * 1.1 + f.bob) * 0.12);
      _q.setFromEuler(_e);
      _m.compose(_p.set(f.x, y - (1 - life) * 0.05, f.z), _q, _s.set(f.sx * life, f.sy * life, f.sz * life));
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (recolor) this.mesh.instanceColor.needsUpdate = true;
  }
}
