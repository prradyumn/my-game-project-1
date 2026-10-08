import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GHAT_TOP } from '../config.js';
import { LANDING_1, LANDING_2, PROFILE, ghatHeight, ghatToWorld } from './WorldLayout.js';
import { makeWaterAware } from './materials.js';

// Daily life on the ghats, played with the shared motion packs (tools/people-config.js PACKS):
// sadhus meditating at sunrise and sunset, Surya Namaskar groups at dawn, friends resting on the
// stone, chai-walas and flower sellers with their customers, sweepers at first light, people
// scattering grain for the pigeons, dhol drummers at the aarti, dancers on festival nights and
// children at play. planLife() adds slots to the Crowd; LifeProps draws the stalls and the
// props in people's hands (brooms, dhols).

const ALL = ['local', 'pilgrim', 'tourist'];

export function planLife(crowd, layout, rng) {
  const G = (id) => layout.ghats.find((g) => g.id === id);
  const face = (g) => Math.atan2(g.N.x, g.N.z);
  const at = (g, u, v) => {
    const p = ghatToWorld(g, u, v);
    return { x: p.x, z: p.z, y: ghatHeight(v) };
  };
  const spot = (g, uR, vR, y, ru, rv, tries = 10) => {
    for (let t = 0; t < tries; t++) {
      const u = rng.range(uR[0], uR[1]);
      const v = rng.range(vR[0], vR[1]);
      if (crowd._clear(g, u, v, y, ru, rv)) return { u, v };
      crowd.rejected++;
    }
    return null;
  };
  const slot = (o) => crowd._slot(o, rng);
  const L1 = LANDING_1;
  const L2 = LANDING_2;
  const stalls = [];
  // keep stalls away from people the main plan already placed
  const freeOfPeople = (x, z, r) => crowd.slots.every((o) => Math.hypot(o.x - x, o.z - z) > r);

  // chai stalls on the top terraces: the chai-wala stirs, customers come and go
  for (const [id, t] of [['dashashwamedh', 0.86], ['assi', 0.52], ['kedar', 0.36], ['panchganga', 0.3]]) {
    const g = G(id);
    const u = g.width * t;
    if (!crowd._clear(g, u, -1.9, GHAT_TOP, 1.2, 0.6) || !freeOfPeople(ghatToWorld(g, u, -1.9).x, ghatToWorld(g, u, -1.9).z, 2.6)) {
      crowd.rejected++;
      continue;
    }
    const p = at(g, u, -1.9);
    stalls.push({ kind: 'chai', x: p.x, z: p.z, y: GHAT_TOP, yaw: face(g) });
    const v = at(g, u, -2.85);
    slot({ kind: 'stand', clip: 'stir', busy: true, x: v.x, z: v.z, y: GHAT_TOP, yaw: face(g), hours: [5, 22.5], roles: ['local'], sex: 'm' });
    for (const du of [-0.55, 0.6]) {
      const c = at(g, u + du, -0.75);
      slot({ kind: 'customer', clip: 'idle', x: c.x, z: c.z, y: GHAT_TOP, yaw: face(g) + Math.PI + rng.range(-0.3, 0.3), hours: rng.chance(0.5) ? [5.5, 10] : [16, 21.5], roles: ALL });
    }
  }

  // flower sellers on a low stool behind baskets of marigolds
  for (const [id, t] of [['dashashwamedh', 0.42], ['kedar', 0.62], ['scindia', 0.4]]) {
    const g = G(id);
    const u = g.width * t;
    if (!crowd._clear(g, u, -1.7, GHAT_TOP, 1.0, 0.6) || !freeOfPeople(ghatToWorld(g, u, -1.7).x, ghatToWorld(g, u, -1.7).z, 2.6)) {
      crowd.rejected++;
      continue;
    }
    const p = at(g, u, -1.7);
    stalls.push({ kind: 'flowers', x: p.x, z: p.z, y: GHAT_TOP, yaw: face(g) });
    const sp = at(g, u, -2.45);
    slot({ kind: 'sit', seat: true, clip: 'sitChin', x: sp.x, z: sp.z, seatY: GHAT_TOP + 0.42, feetY: GHAT_TOP, yaw: face(g), hours: [5.5, 21], roles: ['local', 'pilgrim'] });
    const c = at(g, u + 0.3, -0.7);
    slot({ kind: 'customer', clip: 'idle', x: c.x, z: c.z, y: GHAT_TOP, yaw: face(g) + Math.PI, hours: [6.5, 20], roles: ALL });
  }

  // the stalls are solid before anything else is planned around them
  for (const st of stalls) {
    const size = st.kind === 'chai' ? [1.42, 0.9, 0.72] : [1.5, 0.3, 0.85];
    crowd.physics.addBox(st.x, st.y + size[1] / 2, st.z, size[0], size[1], size[2], st.yaw);
  }
  crowd.physics.step(1 / 60);

  // sadhus, saffron-clad, sitting in stillness on the edge of the steps at sunrise and sunset
  // (the cross-legged take retargets badly onto these bodies: a kneel with sunken shins)
  for (const g of layout.ghats) {
    if (g.pyres) continue;
    const n = g.aarti || g.id === 'assi' ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const L = k === 0 ? L1 : PROFILE[0];
      const sp = spot(g, [6, g.width - 6], [L.v1 - 0.3, L.v1 - 0.3], L.h0, 0.6, 0.15);
      if (!sp) continue;
      const p = at(g, sp.u, L.v1 - 0.12);
      slot({ kind: 'sit', seat: true, sadhu: true, clip: 'sit', busy: true, x: p.x, z: p.z, seatY: L.h0, feetY: L.h0 - 0.3, yaw: face(g) + rng.range(-0.15, 0.15), hours: rng.chance(0.5) ? [4.6, 9.5] : [16.5, 21.5], avatarId: 'Male_Adult_15', tint: rng.chance(0.7) ? 'saffron' : 'marigold' });
    }
  }

  // Surya Namaskar at dawn: rows facing the river, moving together (Assi is famous for it)
  for (const [id, n] of [['assi', 6], ['dashashwamedh', 3], ['tulsi', 3]]) {
    const g = G(id);
    const c = spot(g, [g.width * 0.25, g.width * 0.75], [L1.v0 + 2.4, L1.v0 + 2.6], L1.h0, 2.6, 1.5);
    if (!c) continue;
    for (let i = 0; i < n; i++) {
      const u = c.u + ((i % 3) - 1) * 1.7;
      const v = c.v + Math.floor(i / 3) * 1.6 - 0.8;
      if (!crowd._clear(g, u, v, L1.h0, 0.5, 0.4)) continue;
      const p = at(g, u, v);
      slot({ kind: 'stand', clip: 'surya', sync: true, busy: true, x: p.x, z: p.z, y: L1.h0, yaw: face(g), hours: [5.2, 8.7], roles: ALL });
    }
  }

  // friends sitting together on the edge of a landing, feet on the step below, watching the
  // river (the way everyone sits on the ghats; the floor-sitting take floated and lay back)
  for (const g of layout.ghats) {
    if (g.pyres) continue;
    const onL2 = rng.chance(0.5) && !g.aarti;
    const L = onL2 ? L2 : L1;
    const sp = spot(g, [6, g.width - 6], [L.v1 - 0.3, L.v1 - 0.3], L.h0, 0.9, 0.15);
    if (!sp) continue;
    [0, 0.66].forEach((du, k) => {
      const p = at(g, sp.u + du, L.v1 - 0.12);
      slot({ kind: 'sit', seat: true, clip: k ? 'sitChin' : 'sit', x: p.x, z: p.z, seatY: L.h0, feetY: L.h0 - 0.3, yaw: face(g) + rng.range(-0.2, 0.2), hours: [7, 20.5], roles: ALL });
    });
  }

  // sweepers at first light
  for (const g of layout.ghats) {
    if (g.index % 2) continue;
    const sp = spot(g, [8, g.width - 8], [L1.v0 + 1.0, L1.v1 - 1.0], L1.h0, 0.8, 0.6);
    if (!sp) continue;
    const p = at(g, sp.u, sp.v);
    slot({ kind: 'stand', clip: 'sweep', busy: true, prop: 'broom', x: p.x, z: p.z, y: L1.h0, yaw: face(g) + rng.range(-1.5, 1.5), hours: [5.2, 8.6], roles: ['local'] });
  }

  // scattering grain for the pigeons
  for (const sp of layout.pigeonSpots) {
    const g = G(sp.ghat);
    const u = (sp.x - g.S.x) * g.T.x + (sp.z - g.S.z) * g.T.z;
    const v = (sp.x - g.S.x) * g.N.x + (sp.z - g.S.z) * g.N.z;
    const fu = u + 2.4;
    if (!crowd._clear(g, fu, v, GHAT_TOP, 0.4, 0.4)) continue;
    const p = at(g, fu, v);
    slot({ kind: 'stand', clip: 'toss', busy: true, x: p.x, z: p.z, y: GHAT_TOP, yaw: Math.atan2(sp.x - p.x, sp.z - p.z), hours: [6.5, 11], roles: ['local', 'pilgrim'] });
  }

  // the evening aarti: dhol drummers beside the platforms
  const dash = layout.ghats.find((g) => g.aarti);
  if (dash) {
    for (const du of [-21.5, 21.5]) {
      const p = at(dash, dash.width * 0.5 + du, (L2.v0 + L2.v1) / 2);
      slot({ kind: 'stand', clip: 'drum', busy: true, prop: 'dhol', x: p.x, z: p.z, y: L2.h0, yaw: face(dash), aarti: true, roles: ['local'], sex: 'm' });
    }
    // Dev Deepawali: dancers in a ring around a drummer on the terrace
    const c = at(dash, dash.width * 0.62, -0.6);
    const ring = 6;
    for (let i = 0; i < ring; i++) {
      const a = (i / ring) * Math.PI * 2;
      const x = c.x + Math.sin(a) * 2.6;
      const z = c.z + Math.cos(a) * 2.6;
      slot({ kind: 'stand', clip: i % 2 ? 'danceA' : 'danceB', busy: true, festival: true, x, z, y: GHAT_TOP, yaw: Math.atan2(c.x - x, c.z - z), hours: [18.8, 23.8], roles: ALL });
    }
    slot({ kind: 'stand', clip: 'drum', busy: true, prop: 'dhol', festival: true, x: c.x, z: c.z, y: GHAT_TOP, yaw: face(dash), hours: [18.8, 23.8], roles: ['local'], sex: 'm' });
  }

  // children at play
  for (const [id, n] of [['dashashwamedh', 2], ['assi', 2], ['tulsi', 1], ['scindia', 2], ['panchganga', 1]]) {
    const g = G(id);
    for (let k = 0; k < n; k++) {
      const onTerrace = rng.chance(0.6);
      const y = onTerrace ? GHAT_TOP : L1.h0;
      const sp = spot(g, [8, g.width - 8], onTerrace ? [-2.2, 1.0] : [L1.v0 + 1.4, L1.v1 - 1.2], y, 0.8, 0.6);
      if (!sp) continue;
      const p = at(g, sp.u, sp.v);
      slot({ kind: 'stand', clip: rng.chance(0.5) ? 'hopscotch' : 'play', x: p.x, z: p.z, y, yaw: rng.range(0, Math.PI * 2), hours: [8, 18.5], roles: ['child'] });
    }
  }
  return stalls;
}

// ------------------------------------------------------------------------------------------
// Props: the stalls (one merged mesh each), brooms and dhols that follow people's hands.

function part(geo, color, m) {
  const g = geo.toNonIndexed();
  if (m) g.applyMatrix4(m);
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set(color, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);

function chaiStall() {
  const wood = [0.42, 0.27, 0.16];
  const dark = [0.12, 0.1, 0.09];
  const brass = [0.85, 0.62, 0.25];
  const cloth = [0.85, 0.32, 0.1];
  const P = [
    part(new THREE.BoxGeometry(1.3, 0.75, 0.62), wood, T(0, 0.45, 0)),
    part(new THREE.BoxGeometry(1.42, 0.05, 0.72), [0.5, 0.33, 0.2], T(0, 0.85, 0)),
    part(new THREE.CylinderGeometry(0.17, 0.2, 0.22, 12), dark, T(-0.3, 0.98, 0)), // coal stove
    part(new THREE.CylinderGeometry(0.14, 0.12, 0.2, 14), brass, T(-0.3, 1.19, 0)), // the chai pot
    part(new THREE.CylinderGeometry(0.03, 0.025, 0.07, 8), [0.95, 0.9, 0.82], T(0.25, 0.91, 0.15)),
    part(new THREE.CylinderGeometry(0.03, 0.025, 0.07, 8), [0.95, 0.9, 0.82], T(0.36, 0.91, 0.12)),
    part(new THREE.CylinderGeometry(0.03, 0.025, 0.07, 8), [0.95, 0.9, 0.82], T(0.3, 0.91, -0.05)),
    part(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 14), dark, new THREE.Matrix4().makeRotationZ(Math.PI / 2).premultiply(T(-0.69, 0.22, 0.2))),
    part(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 14), dark, new THREE.Matrix4().makeRotationZ(Math.PI / 2).premultiply(T(0.69, 0.22, 0.2))),
    part(new THREE.CylinderGeometry(0.025, 0.025, 1.4, 6), [0.6, 0.5, 0.35], T(0.62, 1.55, -0.3)),
    part(new THREE.CylinderGeometry(0.025, 0.025, 1.4, 6), [0.6, 0.5, 0.35], T(-0.62, 1.55, -0.3)),
    part(new THREE.BoxGeometry(1.55, 0.03, 0.95), cloth, new THREE.Matrix4().makeRotationX(-0.18).premultiply(T(0, 2.25, -0.1))),
  ];
  return { geo: mergeGeometries(P), stove: new THREE.Vector3(-0.3, 1.32, 0), size: [1.42, 0.9, 0.72] };
}

function flowerStall(rng) {
  const P = [
    part(new THREE.BoxGeometry(1.5, 0.3, 0.85), [0.45, 0.3, 0.18], T(0, 0.15, 0)),
    part(new THREE.BoxGeometry(0.4, 0.4, 0.35), [0.4, 0.28, 0.18], T(0, 0.2, -0.85)), // the seller's stool
  ];
  const colors = [
    [1.0, 0.55, 0.05],
    [1.0, 0.75, 0.1],
    [0.95, 0.25, 0.15],
    [0.98, 0.95, 0.88],
  ];
  for (let i = 0; i < 5; i++) {
    const x = -0.56 + i * 0.28;
    P.push(part(new THREE.CylinderGeometry(0.13, 0.1, 0.14, 12), [0.55, 0.42, 0.25], T(x, 0.37, 0.05)));
    const c = colors[i % colors.length];
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      P.push(part(new THREE.SphereGeometry(0.045, 6, 5), c, T(x + Math.cos(a) * 0.06 * rng(), 0.45 + rng() * 0.04, 0.05 + Math.sin(a) * 0.06 * rng())));
    }
  }
  // garlands hanging off the front
  for (let i = 0; i < 4; i++) P.push(part(new THREE.TorusGeometry(0.11, 0.025, 6, 12), colors[i % 2], T(-0.5 + i * 0.33, 0.12, 0.45)));
  return { geo: mergeGeometries(P), size: [1.5, 0.3, 0.85] };
}

export class LifeProps {
  constructor({ scene, fire, smoke, stalls }) {
    this.group = new THREE.Group();
    this.group.name = 'life-props';
    this.heatSpots = []; // chai stoves (hot air for the heat shimmer)
    scene.add(this.group);
    const mat = makeWaterAware(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05 }), { caustics: false, wetness: false });
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const chai = chaiStall();
    const flowers = flowerStall(rnd);
    // every stall in one merged mesh (one draw call, one in the shadow pass)
    const parts = [];
    const m4 = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    for (const s of stalls) {
      const def = s.kind === 'chai' ? chai : flowers;
      pos.set(s.x, s.y, s.z);
      parts.push(def.geo.clone().applyMatrix4(m4.makeRotationY(s.yaw).setPosition(pos)));
      if (s.kind === 'chai') {
        const p = def.stove.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw).add(pos);
        fire?.add(new THREE.Vector3(p.x, p.y - 0.18, p.z), 0.5, true);
        this.heatSpots.push({ x: p.x, y: p.y + 0.05, z: p.z, h: 1.1, amt: 0.45 });
        smoke?.add(new THREE.Vector3(p.x, p.y + 0.05, p.z), 0.22);
      }
    }
    if (parts.length) {
      const m = new THREE.Mesh(mergeGeometries(parts), mat);
      m.castShadow = true;
      m.receiveShadow = true;
      m.name = 'stalls';
      this.group.add(m);
    }
    // brooms and dhols, placed from people's hands every frame
    const handle = new THREE.CylinderGeometry(0.013, 0.013, 1, 6);
    const bristle = new THREE.CylinderGeometry(0.025, 0.1, 0.42, 9).translate(0, -0.21, 0);
    const dhol = mergeGeometries([
      part(new THREE.CylinderGeometry(0.17, 0.17, 0.46, 16), [0.55, 0.18, 0.1], new THREE.Matrix4().makeRotationZ(Math.PI / 2)),
      part(new THREE.CylinderGeometry(0.172, 0.172, 0.03, 16), [0.9, 0.82, 0.62], new THREE.Matrix4().makeRotationZ(Math.PI / 2).premultiply(T(0.235, 0, 0))),
      part(new THREE.CylinderGeometry(0.172, 0.172, 0.03, 16), [0.9, 0.82, 0.62], new THREE.Matrix4().makeRotationZ(Math.PI / 2).premultiply(T(-0.235, 0, 0))),
    ]);
    const mk = (geo, color, n) => {
      const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.85, vertexColors: !!geo.attributes.color }), n);
      im.count = 0;
      im.castShadow = true;
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(im);
      return im;
    };
    this.handle = mk(handle, 0x8a6a3a, 12);
    this.bristle = mk(bristle, 0xc9b27a, 12);
    this.dhol = mk(dhol, 0xffffff, 6);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._d = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this.counts = { broom: 0, dhol: 0 };
  }

  begin() {
    this.counts.broom = 0;
    this.counts.dhol = 0;
  }

  // a broom between the hands, its head on the stone
  broom(body, groundY) {
    const b = body.b;
    if (!b.lHand || !b.rHand || this.counts.broom >= 12) return;
    b.lHand.getWorldPosition(this._a);
    b.rHand.getWorldPosition(this._b);
    const hi = this._a.y > this._b.y ? this._a : this._b;
    const lo = hi === this._a ? this._b : this._a;
    const d = this._d.subVectors(lo, hi);
    if (d.lengthSq() < 1e-4) d.set(0, -1, 0);
    d.normalize();
    if (d.y > -0.35) d.y = -0.35;
    d.normalize();
    const len = Math.min(1.5, Math.max(0.3, (hi.y - (groundY + 0.4)) / -d.y));
    const top = this._s.copy(hi).addScaledVector(d, -0.12);
    const bottom = hi.clone().addScaledVector(d, len);
    const mid = top.clone().add(bottom).multiplyScalar(0.5);
    this._q.setFromUnitVectors(new THREE.Vector3(0, -1, 0), d);
    const i = this.counts.broom++;
    this._m.compose(mid, this._q, new THREE.Vector3(1, top.distanceTo(bottom), 1));
    this.handle.setMatrixAt(i, this._m);
    this._m.compose(bottom, this._q, new THREE.Vector3(1, 1, 1));
    this.bristle.setMatrixAt(i, this._m);
  }

  // a dhol hung at the waist, across the body
  dholAt(body, yaw) {
    const p = body.b.pelvis;
    if (!p || this.counts.dhol >= 6) return;
    p.getWorldPosition(this._a);
    this._a.x += Math.sin(yaw) * 0.27;
    this._a.z += Math.cos(yaw) * 0.27;
    this._a.y += 0.1;
    this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this._m.compose(this._a, this._q, new THREE.Vector3(1, 1, 1));
    this.dhol.setMatrixAt(this.counts.dhol++, this._m);
  }

  end() {
    this.handle.count = this.bristle.count = this.counts.broom;
    this.dhol.count = this.counts.dhol;
    // no draw call (or shadow) for a prop nobody is holding
    this.handle.visible = this.bristle.visible = this.counts.broom > 0;
    this.dhol.visible = this.counts.dhol > 0;
    this.handle.instanceMatrix.needsUpdate = true;
    this.bristle.instanceMatrix.needsUpdate = true;
    this.dhol.instanceMatrix.needsUpdate = true;
  }
}
