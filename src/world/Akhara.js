import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { AKHARA, ghatById, ghatToWorld, LANDING_1 } from './WorldLayout.js';

// Tulsi Akhara: the wrestlers' training ground at Tulsi Ghat (a real one has stood there for
// centuries). A pit of soft red earth on the first landing, three wooden training dummies bound
// with straw that rock and shed straw when struck, a little shrine to Hanuman (the akhara's
// patron) and a pair of wooden clubs and a mace leaning by it.

export { AKHARA };

function part(geo, c, m) {
  const g = geo.toNonIndexed();
  if (m) g.applyMatrix4(m);
  g.deleteAttribute('uv');
  const col = new Float32Array(g.attributes.position.count * 3);
  const lin = new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
  for (let i = 0; i < col.length; i += 3) col.set([lin.r, lin.g, lin.b], i);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);

function dummyGeometry() {
  const wood = [0.45, 0.3, 0.18];
  const straw = [0.82, 0.68, 0.38];
  const rope = [0.55, 0.42, 0.24];
  const P = [
    part(new THREE.CylinderGeometry(0.32, 0.36, 0.14, 14), [0.5, 0.47, 0.42], T(0, 0.07, 0)), // stone base
    part(new THREE.CylinderGeometry(0.06, 0.07, 1.95, 8), wood, T(0, 1.0, 0)), // post
    part(new THREE.CylinderGeometry(0.21, 0.24, 0.72, 12), straw, T(0, 1.32, 0)), // straw torso
    part(new THREE.CylinderGeometry(0.035, 0.035, 0.95, 6), wood, new THREE.Matrix4().makeRotationZ(Math.PI / 2).premultiply(T(0, 1.52, 0))), // arms
    part(new THREE.SphereGeometry(0.13, 10, 8), straw, T(0, 1.86, 0)), // head
  ];
  for (const y of [1.05, 1.22, 1.42, 1.6]) P.push(part(new THREE.TorusGeometry(0.235, 0.014, 5, 16).rotateX(Math.PI / 2), rope, T(0, y, 0)));
  return mergeGeometries(P);
}

export class Akhara {
  constructor({ scene, physics, textures }) {
    const g = ghatById(AKHARA.ghat);
    this.g = g;
    const y = LANDING_1.h0;
    this.y = y;
    const P = [];
    const yaw = Math.atan2(-g.T.z, g.T.x); // the ghat's frame: local X along the bank
    const toWorld = (u, v, h = 0) => {
      const p = ghatToWorld(g, u, v);
      return new THREE.Vector3(p.x, y + h, p.z);
    };
    const place = (geo, c, u, v, h, rot = 0) => {
      const p = toWorld(u, v, h);
      P.push(part(geo, c, new THREE.Matrix4().makeRotationY(yaw + rot).setPosition(p)));
    };
    const du = AKHARA.u1 - AKHARA.u0;
    const dv = AKHARA.v1 - AKHARA.v0;
    const uc = (AKHARA.u0 + AKHARA.u1) / 2;
    const vc = (AKHARA.v0 + AKHARA.v1) / 2;
    // the pit: soft red earth (akhara mitti, turned and watered every morning), a low brick lip
    {
      const pit = new THREE.BoxGeometry(du, 0.04, dv, 1, 1, 1);
      const sand = textures?.sand;
      const tex = (t) => {
        if (!t) return null;
        const c = t.clone();
        c.repeat.set(du / 2.2, dv / 2.2);
        c.needsUpdate = true;
        return c;
      };
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.72, 0.36, 0.22), map: tex(sand?.map), normalMap: tex(sand?.normalMap), roughness: 1, normalScale: new THREE.Vector2(1.6, 1.6) });
      const m = new THREE.Mesh(pit, mat);
      const p = toWorld(uc, vc, 0.02);
      m.position.copy(p);
      m.rotation.y = yaw;
      m.receiveShadow = true;
      m.name = 'akhara-pit';
      scene.add(m);
    }
    for (const [u, v, w, d] of [[uc, AKHARA.v0, du + 0.3, 0.15], [uc, AKHARA.v1, du + 0.3, 0.15], [AKHARA.u0, vc, 0.15, dv], [AKHARA.u1, vc, 0.15, dv]]) place(new THREE.BoxGeometry(w, 0.1, d), [0.62, 0.36, 0.25], u, v, 0.05);
    // Hanuman's shrine at the pit's head: a vermilion niche under a little dome
    const su = AKHARA.u0 - 1.1;
    place(new THREE.BoxGeometry(0.9, 0.9, 0.7), [0.9, 0.86, 0.78], su, vc, 0.45);
    place(new THREE.BoxGeometry(0.62, 0.62, 0.05), [0.75, 0.2, 0.06], su, vc + 0.34, 0.5);
    place(new THREE.SphereGeometry(0.17, 10, 8).scale(1, 1.35, 0.6), [0.93, 0.36, 0.08], su, vc + 0.36, 0.52);
    place(new THREE.ConeGeometry(0.42, 0.55, 12), [0.94, 0.62, 0.22], su, vc, 1.17);
    place(new THREE.CylinderGeometry(0.012, 0.012, 1.1, 5), [0.4, 0.3, 0.2], su + 0.3, vc - 0.2, 1.4);
    place(new THREE.PlaneGeometry(0.5, 0.32).translate(0.25, 0, 0), [1.0, 0.45, 0.05], su + 0.3, vc - 0.2, 1.8); // saffron flag
    // the wrestlers' gear beside the shrine: a pair of jori clubs and a gada (mace), leaning
    const lean = (geo, c, u, v, h, tilt, rot) => {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, yaw + rot, 0, 'YXZ'));
      const pp = toWorld(u, v, h);
      P.push(part(geo, c, new THREE.Matrix4().compose(pp, q, new THREE.Vector3(1, 1, 1))));
    };
    lean(new THREE.CylinderGeometry(0.11, 0.035, 0.75, 10), [0.4, 0.25, 0.14], su - 0.75, AKHARA.v0 + 0.5, 0.37, 0.12, 0.2);
    lean(new THREE.CylinderGeometry(0.11, 0.035, 0.75, 10), [0.38, 0.24, 0.13], su - 0.75, AKHARA.v0 + 0.85, 0.37, 0.12, -0.3);
    lean(new THREE.CylinderGeometry(0.028, 0.03, 0.85, 6).translate(0, 0.42, 0), [0.35, 0.22, 0.12], su - 0.6, AKHARA.v1 - 0.6, 0, -0.32, Math.PI / 2);
    {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.32, yaw + Math.PI / 2, 0, 'YXZ'));
      const head = toWorld(su - 0.6, AKHARA.v1 - 0.6, 0).add(new THREE.Vector3(0, 0.9, 0).applyQuaternion(q));
      const ribbed = new THREE.SphereGeometry(0.19, 14, 10);
      const pos = ribbed.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const k = 1 + 0.06 * Math.cos(Math.atan2(z, x) * 8);
        pos.setXYZ(i, x * k, y, z * k);
      }
      P.push(part(ribbed, [0.55, 0.36, 0.2], new THREE.Matrix4().compose(head, q, new THREE.Vector3(1, 1, 1))));
    }
    const mesh = new THREE.Mesh(mergeGeometries(P), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.name = 'akhara';
    scene.add(mesh);
    physics.addBox(toWorld(su, vc).x, y + 0.45, toWorld(su, vc).z, 0.9, 0.9, 0.7, yaw);

    // the dummies (one instanced mesh, each rocking on its own spring)
    this.dummies = [2.6, 5.5, 8.4].map((k, i) => {
      const p = toWorld(AKHARA.u0 + k - (i === 1 ? 0 : 0.0), vc + (i === 1 ? -0.6 : 0.5));
      physics.addCylinder(p.x, y, p.z, 0.3, 1.95);
      return { x: p.x, y, z: p.z, ax: 0, az: 0, vx: 0, vz: 0, hits: 0, i };
    });
    this.inst = new THREE.InstancedMesh(dummyGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), this.dummies.length);
    this.inst.castShadow = true;
    this.inst.receiveShadow = true;
    this.inst.name = 'dummies';
    scene.add(this.inst);
    this.clutter = [{ x: toWorld(uc, vc).x, z: toWorld(uc, vc).z, r: Math.max(du, dv) / 2 + 0.6 }, { x: toWorld(su, vc).x, z: toWorld(su, vc).z, r: 1.2 }];
    this.center = toWorld(uc, vc);
    this.shrine = toWorld(su, vc);

    // straw chaff from a hit: a small burst of points
    const N = 160;
    this.chaff = { pos: new Float32Array(N * 3), vel: new Float32Array(N * 3), life: new Float32Array(N), next: 0, N };
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.BufferAttribute(this.chaff.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.chaffPoints = new THREE.Points(cg, new THREE.PointsMaterial({ color: 0xd8b56a, size: 0.035, sizeAttenuation: true }));
    this.chaffPoints.frustumCulled = false;
    this.chaffPoints.visible = false;
    scene.add(this.chaffPoints);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this.update(0);
  }

  /** Strike points that touch a dummy: returns the dummy or null. p: world point, r: reach. */
  touching(p, r = 0.12) {
    for (const d of this.dummies) {
      const h = p.y - d.y;
      if (h < 0.25 || h > 2.0) continue;
      const rad = h > 0.96 && h < 1.7 ? 0.24 : h > 1.7 ? 0.16 : 0.08;
      if (Math.hypot(p.x - d.x, p.z - d.z) < rad + r) return d;
    }
    return null;
  }

  /** A blow on dummy d, pushing it along (dx, dz) with strength k (0..1+). */
  hit(d, dx, dz, k, at) {
    const l = Math.hypot(dx, dz) || 1;
    d.vx += (dx / l) * 2.6 * k;
    d.vz += (dz / l) * 2.6 * k;
    d.hits++;
    const c = this.chaff;
    for (let i = 0; i < 18 * k + 6; i++) {
      const j = c.next++ % c.N;
      c.pos.set([at.x, at.y, at.z], j * 3);
      c.vel.set([(dx / l) * 1.5 * k + (Math.random() - 0.5) * 1.6, Math.random() * 1.8, (dz / l) * 1.5 * k + (Math.random() - 0.5) * 1.6], j * 3);
      c.life[j] = 0.8 + Math.random() * 0.8;
    }
  }

  update(dt) {
    for (const d of this.dummies) {
      // a stiff, lightly damped spring about the base: rocks and settles
      const w = 9;
      const z = 0.18;
      d.vx += (-w * w * d.ax - 2 * z * w * d.vx) * dt;
      d.vz += (-w * w * d.az - 2 * z * w * d.vz) * dt;
      d.ax += d.vx * dt;
      d.az += d.vz * dt;
      d.ax = Math.max(-0.35, Math.min(0.35, d.ax));
      d.az = Math.max(-0.35, Math.min(0.35, d.az));
      this._e.set(d.az, 0, -d.ax);
      this._m.compose(new THREE.Vector3(d.x, d.y, d.z), this._q.setFromEuler(this._e), new THREE.Vector3(1, 1, 1));
      this.inst.setMatrixAt(d.i, this._m);
    }
    this.inst.instanceMatrix.needsUpdate = true;
    const c = this.chaff;
    let alive = 0;
    for (let j = 0; j < c.N; j++) {
      if (c.life[j] <= 0) continue;
      alive++;
      c.life[j] -= dt;
      c.vel[j * 3 + 1] -= 6 * dt;
      for (let a = 0; a < 3; a++) c.pos[j * 3 + a] += c.vel[j * 3 + a] * dt;
      if (c.pos[j * 3 + 1] < this.y + 0.04) {
        c.pos[j * 3 + 1] = this.y + 0.04;
        c.vel[j * 3] *= 0.5;
        c.vel[j * 3 + 2] *= 0.5;
        c.vel[j * 3 + 1] = 0;
      }
      if (c.life[j] <= 0) c.pos[j * 3 + 1] = -100;
    }
    this.chaffPoints.visible = alive > 0;
    if (alive) this.chaffPoints.geometry.attributes.position.needsUpdate = true;
  }
}
