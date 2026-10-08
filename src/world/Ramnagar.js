import * as THREE from 'three';
import { MeshBuilder } from '../utils/MeshBuilder.js';
import { frameAtX, frameToWorld } from './WorldLayout.js';
import { makeWaterAware, surfaceMaterial } from './materials.js';
import { chhatri, shikhara } from './Temple.js';

// Ramnagar Fort, across the river upstream (Chapter V: the Raja's mustard oil for the Thousand
// Lamps). The Maharaja of Benares' fort of buff Chunar sandstone: a long river wall on a
// battered base, octagonal bastions crowned with chhatris, jharokha balconies, a tall gate
// tower over a ghat of steps down to a sand beach, the palace and the Ved Vyasa temple behind.
// It faces the city across the water. Its gate is shut, but the steward waits at the top of
// the steps.

const C = (hex) => new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);

export class RamnagarFort {
  constructor({ scene, physics, textures, fire }) {
    const BX = -330; // bank x of the fort's middle
    const FV = 272; // the river wall's face, in the bank frame (the far bank)
    const f = frameAtX(BX);
    const o = frameToWorld(f, 0, FV);
    // local frame: x along the bank, +z out of the fort toward the river (toward the city)
    const yaw = Math.atan2(-f.N.x, -f.N.z);
    this.yaw = yaw;
    const baseY = 0.3;
    const M = new THREE.Matrix4().makeRotationY(yaw).setPosition(o.x, baseY, o.z);
    const L = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(M);
    this.L = L;
    const stone = new MeshBuilder().setTransform(M);
    const plain = new MeshBuilder().setTransform(M);
    const dark = new MeshBuilder().setTransform(M);
    const sand = C('#d8bf93');
    const sandHi = C('#e6cfa3');
    const sandLo = C('#bfa478');
    const shadow = C('#2a2018');
    const solid = [];
    const box = (b, cx, cy, cz, w, h, d, col, opts) => {
      b.box(cx, cy, cz, w, h, d, 0, col, opts);
      return [cx, cy, cz, w, h, d];
    };
    const W = 96;
    const H = 15;
    // ---- the river wall: a battered plinth, the wall, string courses, crenellations
    solid.push(box(stone, 0, 2.2, -2.2, W + 2, 4.4, 5.4, sandLo, { tile: 2.5, grime: 0.6 }));
    solid.push(box(stone, 0, H / 2, -3.4, W, H, 3, sand, { tile: 2.5, grime: 0.3 }));
    for (const y of [4.6, 8.3, 12.2]) stone.box(0, y, -1.82, W + 0.2, 0.3, 0.32, 0, sandHi, { tile: 2 });
    for (let x = -W / 2 + 0.9; x <= W / 2 - 0.9; x += 1.8) stone.box(x, H + 0.6, -2.2, 0.9, 1.2, 0.7, 0, sandHi, { tile: 1.5 });
    stone.box(0, H + 0.05, -3.4, W + 0.4, 0.3, 3.4, 0, sandHi, { tile: 2 });
    // windows: two rows of small dark arched windows, and jharokhas (projecting balconies)
    for (let x = -42; x <= 42; x += 6) {
      if (Math.abs(x) < 10) continue;
      dark.box(x, 6.4, -1.86, 0.9, 1.6, 0.1, 0, shadow);
      if ((x / 6) % 2 === 0) {
        // a jharokha: a corbelled balcony with a curved little roof
        stone.box(x, 9.2, -1.2, 3.2, 0.35, 1.6, 0, sandHi);
        for (const s of [-1.3, 1.3]) stone.box(x + s, 10.3, -0.65, 0.18, 2, 0.18, 0, sand);
        stone.box(x, 10.15, -0.6, 2.8, 0.9, 0.08, 0, sand);
        dark.box(x, 10.6, -1.85, 2.2, 1.6, 0.1, 0, shadow);
        stone.box(x, 11.45, -1.15, 3.4, 0.25, 1.8, 0, sandHi);
        stone.lathe(x, 11.55, -1.15, [[1.5, 0], [1.3, 0.35], [0.8, 0.6], [0.05, 0.75]], 16, sand);
        for (const s of [-1.2, 1.2]) for (const kz of [-0.6, 0.4]) stone.box(x + s, 8.7, -1.2 + kz, 0.22, 0.7, 0.22, 0, sandLo); // corbels
      } else dark.box(x, 10.6, -1.86, 0.9, 1.6, 0.1, 0, shadow);
    }
    // ---- the bastions: octagonal towers at both ends, chhatris on top
    this.towers = [];
    for (const sx of [-1, 1]) {
      const tx = sx * (W / 2 + 3.5);
      stone.cylinder(tx, 0, -3, 6.6, 7.2, 4.4, 8, sandLo, { tile: 2.5 });
      stone.cylinder(tx, 4.4, -3, 6, 6.4, 15.6, 8, sand, { tile: 2.5 });
      stone.cylinder(tx, 20, -3, 6.5, 6.5, 0.4, 8, sandHi, { tile: 2 });
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        stone.box(tx + Math.cos(a) * 6.1, 20.8, -3 + Math.sin(a) * 6.1, 1.0, 1.2, 0.6, -a, sandHi);
      }
      chhatri(stone, tx, 20.2, -3, 4.2, 0, sandHi);
      solid.push([tx, 10, -3, 12.4, 20, 12.4]);
      this.towers.push(L(tx, 0, -3));
    }
    // ---- the gate tower: a tall block projecting from the wall, a great arched gate, a pavilion
    solid.push(box(stone, 0, 11, -1, 16, 22, 7, sand, { tile: 2.5, grime: 0.3 }));
    dark.box(0, 5.4, 2.53, 5.6, 7.4, 0.1, 0, shadow); // the gateway
    stone.box(0, 9.4, 2.6, 6.8, 0.6, 0.3, 0, sandHi);
    for (const s of [-3.1, 3.1]) stone.box(s, 5.6, 2.6, 0.6, 8, 0.3, 0, sandHi);
    // the closed doors, studded wood
    plain.box(0, 4.6, 2.45, 5.2, 6.6, 0.12, 0, C('#4a2e1a'), { tile: 1.5 });
    for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) plain.cylinder(-2 + i * 0.8, 2.2 + j * 1.5, 2.53, 0.06, 0.06, 0.08, 6, C('#9a8a6a'));
    // pavilion over the gate: arches, a dome, a flagpole
    stone.box(0, 22.2, -1, 12, 0.4, 6, 0, sandHi);
    for (const s of [-4.5, -1.5, 1.5, 4.5]) stone.box(s, 24, 1.6, 0.5, 3.2, 0.5, 0, sand);
    stone.box(0, 25.8, -1, 11, 0.5, 6, 0, sandHi);
    stone.lathe(0, 26, -1, [[3.6, 0], [3.4, 1.2], [2.6, 2.4], [1.2, 3.2], [0.15, 3.6]], 20, sandHi);
    plain.cylinder(0, 29.5, -1, 0.06, 0.05, 4.5, 6, C('#5a4a3a'));
    // ---- the ghat: steps from the sand up to the gate threshold
    const steps = 12;
    const rise = 0.27;
    const run = 0.5;
    for (let i = 0; i < steps; i++) {
      const z = 2.6 + (steps - i) * run;
      stone.box(0, (i + 0.5) * rise, z - run / 2, 14, rise * (i + 1), run, 0, i % 2 ? sand : sandLo, { tile: 1.6 });
    }
    // a flat landing before the doors
    stone.box(0, steps * rise - 0.12, 3.2, 14, 0.24, 1.6, 0, sandHi);
    this.thresholdY = baseY + steps * rise;
    // steps for the feet + a ramp for the walk (as on the ghats)
    const stepTop = steps * rise;
    this.ramp = { x0: 2.6 + steps * run, x1: 2.6 };
    // ---- behind: the palace (the Durbar hall) and the Ved Vyasa temple
    plain.box(-18, 21, -20, 52, 12, 26, 0, C('#e3d2b2'), { tile: 3 });
    for (let x = -40; x <= 4; x += 5) dark.box(x, 22, -6.95, 1.4, 2.4, 0.1, 0, shadow);
    plain.lathe(-18, 27, -20, [[7, 0], [6.5, 2], [4.5, 4], [1.5, 5.2], [0.2, 5.6]], 22, C('#eadcc0'));
    for (const x of [-38, 2]) plain.lathe(x, 27, -12, [[2.5, 0], [2.3, 1], [1.4, 2], [0.1, 2.5]], 14, C('#eadcc0'));
    shikhara(stone, 26, 15, -22, 4.5, 14, [0.86, 0.72, 0.52], { stripes: false });
    stone.box(26, 7.5, -22, 9, 15, 9, 0, sand, { tile: 2.5 });
    // materials, meshes
    const stoneMat = surfaceMaterial(textures.carving || textures.stone, { normalScale: 1.1 });
    const plainMat = surfaceMaterial(textures.plaster, { normalScale: 0.7 });
    const darkMat = makeWaterAware(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    this.group = new THREE.Group();
    this.group.name = 'ramnagar-fort';
    for (const [b, mat] of [[stone, stoneMat], [plain, plainMat], [dark, darkMat]]) {
      if (!b.vertexCount) continue;
      const mesh = new THREE.Mesh(b.build(), mat);
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    scene.add(this.group);
    // colliders
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const Q = { x: q.x, y: q.y, z: q.z, w: q.w };
    for (const [cx, cy, cz, w, h, d] of solid) {
      const c = L(cx, cy, cz);
      physics.addBoxQ(c.x, c.y, c.z, w, h, d, Q);
    }
    // the steps: one smooth ramp for walking (a box rotated to the slope) + the landing
    {
      const len = Math.hypot(steps * run, stepTop);
      const ang = Math.atan2(stepTop, steps * run);
      const mid = L(0, stepTop / 2 - 0.15, 2.6 + (steps * run) / 2);
      const rq = new THREE.Quaternion().setFromEuler(new THREE.Euler(ang, yaw, 0, 'YXZ'));
      physics.addBoxQ(mid.x, mid.y, mid.z, 14, 0.3, len, { x: rq.x, y: rq.y, z: rq.z, w: rq.w });
      const ld = L(0, stepTop - 0.12, 3.2);
      physics.addBoxQ(ld.x, ld.y, ld.z, 14, 0.24, 1.6, Q);
    }
    // torches either side of the gate (lit at night)
    this.torches = [L(-3.8, 4.6, 2.9), L(3.8, 4.6, 2.9)];
    this.torchIds = this.torches.map((p) => fire.add(p, 1.1, false));
    this.fire = fire;
    // where the steward stands, and where a boat should come in
    this.stewardAt = { ...L(1.6, stepTop, 3.4), yaw: yaw };
    this.landing = L(0, 0, 2.6 + steps * run + 4.5);
    this.dock = L(0, 0, 2.6 + steps * run + 16);
    this.center = L(0, 10, -3);
    this.lamps = this.torches;
  }

  setNight(n) {
    const on = n > 0.4 ? 1 : 0;
    if (on === this._on) return;
    this._on = on;
    for (const id of this.torchIds) this.fire.setLit(id, on);
  }
}
