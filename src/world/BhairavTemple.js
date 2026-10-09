import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBuilder } from '../utils/MeshBuilder.js';
import { frameAtX, frameToWorld } from './WorldLayout.js';
import { makeWaterAware, surfaceMaterial } from './materials.js';
import { shikhara } from './Temple.js';

// Kaal Bhairav's temple (Chapter V): the Kotwal of Kashi keeps his shrine on the first lane
// behind Panchganga. A courtyard walled in saffron and vermilion, entered through a carved gate
// from the lane; a raised, pillared mandapa hung with brass bells; the sanctum at the back
// where Bhairav stands, a silver face above red cloth heaped with marigolds; his black dogs
// at the door; mustard-oil lamps that never go out. You can walk in.

const C = (hex) => new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);

// the murti's face: a silver mask with great painted eyes, a moustache, a vermilion tilak
function faceTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#b9bcc2';
  x.fillRect(0, 0, 256, 256);
  const eye = (cx) => {
    x.fillStyle = '#ffffff';
    x.beginPath();
    x.ellipse(cx, 112, 34, 22, 0, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = '#111';
    x.beginPath();
    x.arc(cx, 112, 13, 0, Math.PI * 2);
    x.fill();
    x.strokeStyle = '#1a1a1a';
    x.lineWidth = 6;
    x.beginPath();
    x.ellipse(cx, 112, 36, 24, 0, 0, Math.PI * 2);
    x.stroke();
  };
  eye(82);
  eye(174);
  x.fillStyle = '#c0141c'; // tilak
  x.fillRect(118, 30, 20, 56);
  x.fillStyle = '#1a1414'; // moustache
  x.beginPath();
  x.moveTo(60, 182);
  x.quadraticCurveTo(128, 150, 196, 182);
  x.quadraticCurveTo(128, 168, 60, 182);
  x.fill();
  x.fillStyle = '#8a0f14'; // mouth
  x.fillRect(108, 196, 40, 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class BhairavTemple {
  constructor({ scene, physics, textures, fire, lot, murtiUrl }) {
    this.lot = lot;
    // local frame: origin at the middle of the lane-side front, x along the lane, z toward the
    // lane (out of the gate), y up from the city level (lot.bankX: the lot's centre along the bank)
    const f0 = frameAtX(lot.bankX ?? lot.x);
    const front = frameToWorld(f0, 0, lot.frontV);
    const yaw = Math.atan2(f0.N.x, f0.N.z);
    this.yaw = yaw;
    const M = new THREE.Matrix4().makeRotationY(yaw).setPosition(front.x, lot.baseY, front.z);
    this.M = M;
    const L = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(M);
    this.L = L;
    const W = lot.w - 1;
    const D = lot.d - 1;
    const stone = new MeshBuilder().setTransform(M);
    const plaster = new MeshBuilder().setTransform(M);
    const wood = new MeshBuilder().setTransform(M);
    const brass = new MeshBuilder().setTransform(M);
    const cloth = new MeshBuilder().setTransform(M);
    const saffron = C('#e0702a');
    const vermilion = C('#b8281e');
    const lime = C('#efe2c8');
    const solid = [];
    const wall = (cx, cz, w, d, h, col) => {
      plaster.box(cx, h / 2, cz, w, h, d, 0, col, { tile: 2, grime: 0.35 });
      solid.push([cx, h / 2, cz, w, h, d]);
    };
    // ---- the compound wall, a gate in the middle of the lane side
    const H = 4.2;
    const gateW = 3.2;
    wall(-(W / 2 + gateW / 2) / 2, -0.3, W / 2 - gateW / 2, 0.6, H, saffron);
    wall((W / 2 + gateW / 2) / 2, -0.3, W / 2 - gateW / 2, 0.6, H, saffron);
    wall(-W / 2 + 0.3, -D / 2, 0.6, D, H, saffron);
    wall(W / 2 - 0.3, -D / 2, 0.6, D, H, saffron);
    wall(0, -D + 0.3, W, 0.6, H, saffron);
    // vermilion bands along the top of the walls, a coping
    plaster.box(0, H + 0.1, -0.3, W + 0.2, 0.2, 0.8, 0, vermilion);
    plaster.box(-W / 2 + 0.3, H + 0.1, -D / 2, 0.8, 0.2, D, 0, vermilion);
    plaster.box(W / 2 - 0.3, H + 0.1, -D / 2, 0.8, 0.2, D, 0, vermilion);
    // (the coping is solid with the wall under it: up on the wall, his feet stand on it)
    solid.push([0, H + 0.1, -0.3, W + 0.2, 0.2, 0.8], [-W / 2 + 0.3, H + 0.1, -D / 2, 0.8, 0.2, D], [W / 2 - 0.3, H + 0.1, -D / 2, 0.8, 0.2, D]);
    // ---- the gate: two thick pillars, a lintel with a little shikhara over it, bells
    for (const sx of [-1, 1]) {
      stone.box(sx * (gateW / 2 + 0.35), 2.6, -0.3, 0.7, 5.2, 0.9, 0, C('#d9c19a'), { tile: 1.5 });
      stone.box(sx * (gateW / 2 + 0.35), 5.3, -0.3, 0.9, 0.2, 1.1, 0, vermilion);
      solid.push([sx * (gateW / 2 + 0.35), 2.6, -0.3, 0.7, 5.2, 0.9]);
    }
    stone.box(0, 5.0, -0.3, gateW + 1.6, 0.7, 1.0, 0, C('#d9c19a'), { tile: 1.5 });
    shikhara(stone, 0, 5.35, -0.3, 0.75, 1.9, [0.88, 0.45, 0.18], { stripes: true });
    // ---- the mandapa: a plinth, steps, sixteen pillars, a flat roof with a parapet
    const mz0 = -5.2;
    const mz1 = -D + 4.6;
    const mW = 9;
    const plH = 0.75;
    stone.box(0, plH / 2, (mz0 + mz1) / 2 - 1.2, mW + 1, plH, mz0 - mz1 + 3.4, 0, C('#cdb48c'), { tile: 1.6 });
    solid.push([0, plH / 2, (mz0 + mz1) / 2 - 1.2, mW + 1, plH, mz0 - mz1 + 3.4]);
    for (let i = 0; i < 3; i++) {
      stone.box(0, (plH / 3) * (i + 0.5), mz0 + 0.45 + (2 - i) * 0.32, 3, (plH / 3) * (i + 1), 0.32, 0, C('#c8ad84'));
      solid.push([0, (plH / 3) * (i + 0.5), mz0 + 0.45 + (2 - i) * 0.32, 3, (plH / 3) * (i + 1), 0.32]); // (steps he climbs, not wades)
    }
    this.pillars = [];
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const px = -mW / 2 + 0.5 + i * ((mW - 1) / 3);
        const pz = mz0 - 0.6 - j * ((mz0 - mz1 - 1.2) / 3);
        // a carved column: square base, octagonal shaft, a bracket capital
        stone.box(px, plH + 0.25, pz, 0.55, 0.5, 0.55, 0, C('#d4bb93'));
        // (MeshBuilder.cylinder takes its BASE height: the shaft stands on the base block and
        // meets the capital: plH + 0.5 .. plH + 3.4)
        stone.cylinder(px, plH + 0.5, pz, 0.2, 0.18, 2.9, 8, C('#dcc39c'));
        stone.box(px, plH + 3.55, pz, 0.6, 0.3, 0.6, 0, C('#c9ad82'));
        for (const b of [0.85, 2.2]) stone.box(px, plH + 0.5 + b, pz, 0.46, 0.08, 0.46, 0, vermilion);
        solid.push([px, plH + 2, pz, 0.45, 4, 0.45]);
        this.pillars.push(L(px, plH, pz));
      }
    }
    const roofY = plH + 3.7;
    stone.box(0, roofY + 0.15, (mz0 + mz1) / 2 - 0.3, mW + 0.6, 0.3, mz0 - mz1 + 1.4, 0, C('#c9ad82'), { tile: 2 });
    plaster.box(0, roofY + 0.55, (mz0 + mz1) / 2 - 0.3, mW + 0.6, 0.5, mz0 - mz1 + 1.4, 0, saffron, { faces: ['px', 'nx', 'pz', 'nz'] });
    // ---- the sanctum at the back: thick walls, a low dark doorway, the shikhara above
    const sz = -D + 2.4;
    const sW = 4.2;
    const sH = 3.6;
    for (const sx of [-1, 1]) {
      plaster.box(sx * (sW / 2 - 0.3), plH + sH / 2, sz, 0.6, sH, 3.6, 0, vermilion, { tile: 2 });
      solid.push([sx * (sW / 2 - 0.3), plH + sH / 2, sz, 0.6, sH, 3.6]);
    }
    plaster.box(0, plH + sH / 2, sz - 1.5, sW, sH, 0.6, 0, vermilion);
    plaster.box(-1.25, plH + sH / 2, sz + 1.5, 1.1, sH, 0.6, 0, vermilion);
    plaster.box(1.25, plH + sH / 2, sz + 1.5, 1.1, sH, 0.6, 0, vermilion);
    plaster.box(0, plH + sH - 0.55, sz + 1.5, 1.4, 1.1, 0.6, 0, vermilion);
    solid.push([0, plH + sH / 2, sz - 1.5, sW, sH, 0.6], [-1.25, plH + sH / 2, sz + 1.5, 1.1, sH, 0.6], [1.25, plH + sH / 2, sz + 1.5, 1.1, sH, 0.6]);
    stone.box(0, plH + sH + 0.15, sz, sW + 0.4, 0.3, 4.0, 0, C('#c9ad82'));
    shikhara(stone, 0, plH + sH + 0.3, sz, 1.9, 4.6, [0.95, 0.5, 0.2], { stripes: true });
    // ---- the deity: dark body under red cloth and garlands, a silver face, a crown
    const dz = sz - 0.7;
    const dY = plH + 0.5;
    // the pedestal, stepped and dark with oil
    stone.box(0, plH + 0.12, dz, 1.5, 0.24, 1.1, 0, C('#3e332c'));
    stone.box(0, plH + 0.36, dz, 1.25, 0.24, 0.95, 0, C('#4a3d33'));
    solid.push([0, plH + 0.12, dz, 1.5, 0.24, 1.1], [0, plH + 0.36, dz, 1.25, 0.24, 0.95]);
    // the niche behind him, black with a century of lamp soot
    plaster.box(0, plH + sH / 2, sz - 1.17, sW - 1.25, sH, 0.06, 0, C('#1a1210'));
    this.faceAt = L(0, dY + 1.48, dz + 0.02);
    // ---- his dogs: two black dogs, sitting, at the sanctum door
    const dog = dogGeometry();
    for (const sx of [-1, 1]) stone.geometry(dog, new THREE.Matrix4().makeRotationY(sx > 0 ? -0.3 : 0.3).setPosition(sx * 1.1, plH, sz + 2.2), C('#141212'));
    // ---- bells hanging in the mandapa, lamps on brass stands
    this.bells = [];
    for (let i = 0; i < 5; i++) {
      const bx = -2 + i;
      const bz = mz0 - 1.4 - (i % 2) * 0.8;
      brass.cylinder(bx, roofY - 0.86, bz, 0.01, 0.01, 0.86, 4, C('#3a2a1a')); // the rope, ceiling down to the bell
      brass.lathe(bx, roofY - 1.15, bz, [[0, 0.3], [0.05, 0.28], [0.1, 0.12], [0.16, 0], [0.15, -0.02]], 14, C('#d1a24a'));
      this.bells.push(L(bx, roofY - 1.1, bz));
    }
    this.lamps = [];
    for (const [lx, lz] of [[-1.6, sz + 2.8], [1.6, sz + 2.8], [-0.5, dz + 0.6], [0.5, dz + 0.6]]) {
      brass.cylinder(lx, plH, lz, 0.08, 0.05, 0.9, 8, C('#c9962f')); // the stand, on the floor up to its dish
      brass.lathe(lx, plH + 0.9, lz, [[0, 0], [0.12, 0.02], [0.13, 0.05]], 12, C('#d9a441'));
      this.lamps.push(L(lx, plH + 0.98, lz));
    }
    // a peepal sapling's platform in the courtyard, with threads tied round it
    stone.cylinder(-W / 2 + 2.6, 0, -2.4, 1.25, 1.2, 0.6, 16, C('#cbb38d'));
    solid.push([-W / 2 + 2.6, 0.3, -2.4, 2.2, 0.6, 2.2]);
    // materials + meshes
    const matsOf = [
      [stone, surfaceMaterial(textures.carving || textures.stone, { normalScale: 1.2 })],
      [plaster, surfaceMaterial(textures.plaster, { normalScale: 0.8 })],
      [wood, makeWaterAware(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }))],
      [brass, makeWaterAware(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.9 }))],
      [cloth, makeWaterAware(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }))],
    ];
    this.group = new THREE.Group();
    this.group.name = 'bhairav-temple';
    for (const [b, mat] of matsOf) {
      if (!b.vertexCount) continue;
      const mesh = new THREE.Mesh(b.build(), mat);
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    // the silver face (its own small mesh: a painted mask)
    // Bhairav himself: the shringar as a worshipper sees it from the door (a painted murti,
    // generated with Gemini: the silver face, the gold mukut, the marigolds, the silver arch), on
    // a gently curved panel standing on the pedestal, lit by the lamps and a little of its own
    const pw = 1.55;
    const ph = pw * (1746 / 1024);
    const pg = new THREE.PlaneGeometry(pw, ph, 16, 1);
    {
      const pa = pg.attributes.position;
      for (let i = 0; i < pa.count; i++) pa.setZ(i, -0.28 * (pa.getX(i) / (pw / 2)) ** 2);
      pg.computeVertexNormals();
    }
    const tex = new THREE.TextureLoader().load(murtiUrl);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const murti = new THREE.Mesh(pg, new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color(0.32, 0.3, 0.28), roughness: 0.5, metalness: 0.12 }));
    murti.position.copy(L(0, plH + 0.48 + ph / 2, dz - 0.05));
    murti.rotation.y = yaw;
    this.group.add(murti);

    scene.add(this.group);
    // colliders
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    for (const [cx, cy, cz, w, h, d] of solid) {
      const c = L(cx, cy, cz);
      physics.addBoxQ(c.x, c.y, c.z, w, h, d, { x: q.x, y: q.y, z: q.z, w: q.w });
    }
    // lamps burn always; the light pool lights the sanctum
    for (const p of this.lamps) fire.add(p, 0.5, true);
    this.lightSpots = [L(0, plH + 2.2, sz + 2.4), L(0, plH + 2.6, mz0 - 2)];
    // where people stand: the priest in the mandapa, a bowing spot before the deity, the gate
    this.priestAt = { ...L(1.2, plH, sz + 3.2), yaw: yaw + Math.PI + 0.5 };
    this.bowAt = { ...L(0, plH, sz + 2.6), yaw: yaw + Math.PI };
    this.gate = { ...L(0, 0, 1.2), yaw: yaw + Math.PI };
    this.center = L(0, 0, -D / 2);
    this.plinthY = lot.baseY + plH;
    this.clutter = [{ x: this.center.x, z: this.center.z, r: Math.max(W, D) / 2 + 1 }];
  }
}

// a sitting dog, from a few rounded pieces (head up, ears pricked, tail curled)
function dogGeometry() {
  const parts = [];
  const add = (g, x, y, z, rx = 0, ry = 0, rz = 0) => parts.push(g.rotateX(rx).rotateY(ry).rotateZ(rz).translate(x, y, z));
  add(new THREE.SphereGeometry(0.22, 12, 10).scale(0.9, 1.25, 1.1), 0, 0.42, -0.05, -0.25); // chest + haunches
  add(new THREE.SphereGeometry(0.2, 12, 10).scale(1.05, 0.8, 1.2), 0, 0.2, -0.15); // seat
  add(new THREE.CylinderGeometry(0.075, 0.09, 0.22, 10), 0, 0.68, 0.04, -0.5); // neck
  add(new THREE.SphereGeometry(0.115, 12, 10).scale(0.9, 0.85, 1.15), 0, 0.82, 0.1); // skull
  add(new THREE.CylinderGeometry(0.04, 0.065, 0.2, 10), 0, 0.78, 0.26, Math.PI / 2 - 0.15); // long muzzle
  add(new THREE.SphereGeometry(0.03, 8, 6), 0, 0.775, 0.37); // nose
  for (const s of [-1, 1]) {
    add(new THREE.SphereGeometry(0.05, 8, 6).scale(0.5, 1, 0.85), s * 0.085, 0.86, 0.07, 0.4, 0, -s * 0.6); // folded ears
    add(new THREE.CylinderGeometry(0.035, 0.03, 0.36, 8), s * 0.1, 0.18, 0.13, 0.15); // forelegs
    add(new THREE.SphereGeometry(0.1, 10, 8).scale(0.8, 0.9, 1.3), s * 0.13, 0.12, -0.2); // hind legs
  }
  add(new THREE.TorusGeometry(0.12, 0.03, 6, 12, Math.PI * 1.3), 0.12, 0.2, -0.33, 0, Math.PI / 2, 0); // tail
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  return g;
}
