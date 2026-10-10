import * as THREE from 'three';
import { GHAT_TOP } from '../config.js';
import { MeshBuilder } from '../utils/MeshBuilder.js';
import { ghatById, ghatToWorld } from './WorldLayout.js';
import { makeWaterAware, shiny } from './materials.js';

// Amma's kitchen at Kedar Ghat (Chapter II): the temple's bhandara, where the pilgrims are fed.
// A clay chulha with a wood fire in it, a great brass degchi on top, a wooden paddle to stir
// with, sacks, a stack of leaf plates and a low tarp roof on bamboo poles. The pot steams once
// the khichdi is cooking (setCooking).

const C = (hex) => new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);

export class Kitchen {
  constructor({ scene, physics, textures, fire, smoke }) {
    const g = ghatById('kedar');
    const u = g.width * 0.5 - 7;
    const v = 2.2;
    const p = ghatToWorld(g, u, v);
    this.pos = new THREE.Vector3(p.x, GHAT_TOP, p.z);
    const yaw = Math.atan2(g.N.x, g.N.z); // facing the river
    this.yaw = yaw;
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(this.pos);
    const clay = new MeshBuilder().setTransform(m);
    const brass = new MeshBuilder().setTransform(m);
    const cloth = new MeshBuilder().setTransform(m);
    // the chulha: a horseshoe of baked clay with a mouth for the wood
    const mud = C('#8a5a3a');
    clay.box(-0.55, 0.3, 0, 0.28, 0.6, 1.2, 0, mud);
    clay.box(0.55, 0.3, 0, 0.28, 0.6, 1.2, 0, mud);
    clay.box(0, 0.3, -0.48, 0.82, 0.6, 0.26, 0, mud);
    clay.box(0, 0.02, 0, 1.4, 0.04, 1.3, 0, C('#5b3a26'));
    // logs in the mouth of the stove
    for (let i = 0; i < 3; i++) clay.cylinder(-0.12 + i * 0.12, 0.1, 0.55, 0.05, 0.05, 0.7, 7, C('#4a2f1c'), {});
    // the degchi: a broad, heavy brass pot with a rolled rim
    brass.lathe(0, 0.6, 0, [[0, 0], [0.42, 0.02], [0.55, 0.18], [0.6, 0.42], [0.56, 0.62], [0.5, 0.7], [0.56, 0.74], [0.52, 0.76]], 24, C('#c9962f'));
    // khichdi inside (hidden until cooking)
    this.food = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: C('#e0b44a'), roughness: 0.6 }));
    this.food.position.set(0, 1.28, 0).applyMatrix4(new THREE.Matrix4().makeRotationY(yaw)).add(this.pos);
    this.food.visible = false;
    scene.add(this.food);
    // a wooden paddle leaning in the pot
    clay.box(0.18, 1.35, 0.05, 0.05, 1.3, 0.05, 0.4, C('#6b4426'));
    // sacks, a water pot, leaf plates stacked on a takht
    for (let i = 0; i < 4; i++) cloth.lathe(-1.7 + (i % 2) * 0.5, 0, 0.4 + Math.floor(i / 2) * 0.55, [[0, 0], [0.26, 0], [0.28, 0.4], [0.24, 0.6], [0.28, 0.62], [0, 0.66]], 12, C(['#8d6b43', '#9a7a4f', '#7f5f3a', '#a3845a'][i]));
    clay.lathe(1.6, 0, 0.6, [[0, 0], [0.2, 0.02], [0.3, 0.25], [0.26, 0.45], [0.12, 0.55], [0.14, 0.62]], 16, C('#9b5432')); // a clay matka
    clay.box(1.7, 0.4, -0.2, 1.2, 0.08, 0.7, 0, C('#6b4426'));
    for (let i = 0; i < 4; i++) clay.box(1.7 + (i % 2 ? 0.5 : -0.5), 0.2, -0.2 + (i < 2 ? 0.3 : -0.3), 0.08, 0.4, 0.08, 0, C('#4a2c16'));
    for (let i = 0; i < 12; i++) cloth.cylinder(1.6, 0.46 + i * 0.012, -0.2, 0.22, 0.22, 0.01, 16, C(i % 2 ? '#3f7a2c' : '#4f8f36')); // banana-leaf plates
    // a tarp roof on bamboo poles
    for (const [x, z] of [[-2.2, -1.1], [2.4, -1.1], [-2.2, 1.4], [2.4, 1.4]]) clay.cylinder(x, 0, z, 0.05, 0.05, z < 0 ? 2.78 : 2.48, 6, C('#b39662')); // ground to the sloping tarp
    cloth.quad([-2.4, 2.75, -1.25], [2.6, 2.75, -1.25], [2.6, 2.45, 1.55], [-2.4, 2.45, 1.55], [0, 0.99, 0.1], [[0, 0], [1, 0], [1, 1], [0, 1]], C('#1e5aa8'), C('#2a6fc0'));
    const mats = [
      [clay, makeWaterAware(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }))],
      [brass, shiny(makeWaterAware(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.9 })))],
      [cloth, makeWaterAware(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }))],
    ];
    this.group = new THREE.Group();
    for (const [b, mat] of mats) {
      const mesh = new THREE.Mesh(b.build(), mat);
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    scene.add(this.group);
    void textures;
    physics.addBox(this.pos.x, GHAT_TOP + 0.5, this.pos.z, 1.5, 1.0, 1.4, yaw);
    const L = (x, z) => new THREE.Vector3(x, 0, z).applyMatrix4(new THREE.Matrix4().makeRotationY(yaw)).add(this.pos);
    physics.addBox(L(1.7, -0.2).x, GHAT_TOP + 0.25, L(1.7, -0.2).z, 1.25, 0.5, 0.75, yaw);
    // the fire under the pot (always smouldering; roars when cooking)
    this.fire = fire;
    this.fireId = fire.add(new THREE.Vector3(0, 0.25, 0.1).applyMatrix4(new THREE.Matrix4().makeRotationY(yaw)).add(this.pos), 0.9, true);
    this.smoke = smoke;
    this.steamId = smoke.add(new THREE.Vector3(0, 1.5, 0).applyMatrix4(new THREE.Matrix4().makeRotationY(yaw)).add(this.pos), 0);
    // where the cook stands (behind the stove, facing the river) and where Prady stirs
    this.cookAt = L(-0.9, -1.3);
    this.stirAt = L(0, 1.2);
    this.clutter = [{ x: this.pos.x, z: this.pos.z, r: 3 }];
  }

  setCooking(on) {
    this.food.visible = on;
    this.smoke.setStrength(this.steamId, on ? 0.35 : 0);
  }
}
