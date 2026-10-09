import * as THREE from 'three';
import { GHAT_TOP } from '../config.js';
import { MeshBuilder } from '../utils/MeshBuilder.js';
import { RNG } from '../utils/math.js';
import { windowTexture } from '../utils/textures.js';
import { frameAtX, frameToWorld } from './WorldLayout.js';
import { surfaceMaterial } from './materials.js';
import { buildTemple, chhatri, shikhara } from './Temple.js';

// Builds the city of Kashi from the layout: havelis, palaces, the fort, temples, rooftop life
// and a hazy skyline beyond the playable edge.

const FLOOR_H = 3.2;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function local(b, lx, lz) {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  return { x: b.x + lx * c + lz * s, z: b.z - lx * s + lz * c };
}

export function buildCity(layout, textures, physics) {
  const rng = new RNG(2024);
  const plaster = new MeshBuilder();
  const stone = new MeshBuilder();
  const gold = new MeshBuilder();
  const carved = new MeshBuilder();
  const windowsDark = [];
  const windowsLit = [];
  const balconies = [];
  const tanks = [];
  const flags = [];
  const bells = [];

  const addWindow = (b, face, along, y, w, h, litChance = 0.3) => {
    let lx;
    let lz;
    let yaw;
    if (face === 'front') [lx, lz, yaw] = [along, b.d / 2 + 0.04, 0];
    else if (face === 'back') [lx, lz, yaw] = [-along, -b.d / 2 - 0.04, Math.PI];
    else if (face === 'left') [lx, lz, yaw] = [-b.w / 2 - 0.04, along, -Math.PI / 2];
    else [lx, lz, yaw] = [b.w / 2 + 0.04, -along, Math.PI / 2];
    const p = local(b, lx, lz);
    _q.setFromAxisAngle(_up, b.yaw + yaw);
    _m.compose(_p.set(p.x, y, p.z), _q, _s.set(w, h, 1));
    (rng.chance(litChance) ? windowsLit : windowsDark).push(_m.clone());
    return { p, yaw: b.yaw + yaw };
  };

  const faceWindows = (b, face, faceW, opts = {}) => {
    const spacing = opts.spacing ?? 2.7;
    const n = Math.max(1, Math.floor((faceW - 1.4) / spacing));
    for (let k = 0; k < b.floors; k++) {
      const floorY = b.baseY + k * FLOOR_H;
      for (let i = 0; i < n; i++) {
        const along = -faceW / 2 + ((i + 0.5) * faceW) / n;
        if (k === 0 && opts.doors) {
          if (i % 2 === 0) addWindow(b, face, along, floorY + 1.3, 1.5, 2.6, 0.15);
          continue;
        }
        if (rng.chance(opts.skip ?? 0.1)) continue;
        const w = opts.winW ?? 0.95;
        const h = opts.winH ?? 1.6;
        const win = addWindow(b, face, along, floorY + 0.75 + h / 2, w, h);
        if (k > 0 && (face === 'front' || face === 'back') && rng.chance(b.balconyChance)) {
          _q.setFromAxisAngle(_up, win.yaw);
          _m.compose(_p.set(win.p.x, floorY + 0.55, win.p.z), _q, _s.set(1, 1, 1));
          balconies.push(_m.clone());
        }
      }
    }
  };

  for (const b of layout.buildings) {
    const isPalace = b.kind === 'palace' || b.kind === 'fort';
    const builder = isPalace ? stone : plaster;
    const color = new THREE.Color(b.color);
    const trim = color.clone().multiplyScalar(0.82);
    const tile = isPalace ? 2.4 : 3;
    const uvo = [rng.range(0, 10), rng.range(0, 10)];
    const top = b.baseY + b.h;

    // Body, plinth and string courses
    builder.box(b.x, b.baseY + b.h / 2, b.z, b.w, b.h, b.d, b.yaw, color, { tile, grime: 0.35, uvOffset: uvo });
    builder.box(b.x, b.baseY + 0.45, b.z, b.w + 0.25, 0.9, b.d + 0.25, b.yaw, trim.clone().multiplyScalar(0.85), { tile, faces: ['px', 'nx', 'pz', 'nz', 'py'] });
    for (let k = 1; k < b.floors; k++) {
      builder.box(b.x, b.baseY + k * FLOOR_H, b.z, b.w + 0.14, 0.2, b.d + 0.14, b.yaw, trim, { tile, faces: ['px', 'nx', 'pz', 'nz', 'py', 'ny'] });
    }
    // Chhajja sunshades over the front windows
    for (let k = 1; k <= b.floors; k++) {
      const y = b.baseY + k * FLOOR_H - 0.3;
      if (y > top - 0.2) break;
      const p = local(b, 0, b.d / 2 + 0.32);
      builder.box(p.x, y, p.z, b.w - 0.3, 0.1, 0.64, b.yaw, trim, { tile, faces: ['px', 'nx', 'pz', 'py', 'ny'] });
    }
    // Parapet
    const parY = top + 0.45;
    for (const [lx, lz, w, d] of [
      [0, b.d / 2 - 0.12, b.w, 0.24],
      [0, -b.d / 2 + 0.12, b.w, 0.24],
      [-b.w / 2 + 0.12, 0, 0.24, b.d],
      [b.w / 2 - 0.12, 0, 0.24, b.d],
    ]) {
      const p = local(b, lx, lz);
      builder.box(p.x, parY, p.z, w, 0.9, d, b.yaw, color, { tile });
      // (solid: the roofs are walkable, Traversal.js; a parapet is vaulted, not walked through)
      physics.addBox(p.x, parY, p.z, w, 0.9, d, b.yaw);
    }
    // Battlements on the fort
    if (b.kind === 'fort') {
      for (let a = -b.w / 2 + 0.6; a < b.w / 2; a += 1.3) {
        const p = local(b, a, b.d / 2 - 0.12);
        stone.box(p.x, parY + 0.75, p.z, 0.6, 0.6, 0.3, b.yaw, color, { tile });
      }
    }

    // Windows
    if (isPalace) {
      faceWindows(b, 'front', b.w, { spacing: 2.3, winW: 1.25, winH: 2.1, doors: true, skip: 0.02 });
    } else {
      faceWindows(b, 'front', b.w, { doors: b.row === 0 });
      if (b.row > 0) faceWindows(b, 'back', b.w, { doors: true });
    }
    if (b.leftOpen) faceWindows(b, 'left', b.d, { skip: 0.3 });
    if (b.rightOpen) faceWindows(b, 'right', b.d, { skip: 0.3 });

    // Palace corner towers with domes
    if (isPalace) {
      for (const sx of [-1, 1]) {
        const p = local(b, sx * (b.w / 2 - 1.6), b.d / 2 - 1.6);
        const th = b.h + 4;
        stone.cylinder(p.x, b.baseY, p.z, 2.6, 2.4, th, 8, color, { tile: 2.4 });
        stone.cylinder(p.x, b.baseY + th, p.z, 2.8, 2.8, 0.4, 8, trim, { tile: 2.4 });
        if (b.kind === 'fort') {
          for (let a = 0; a < 8; a++) {
            const ang = (a / 8) * Math.PI * 2;
            stone.box(p.x + Math.cos(ang) * 2.5, b.baseY + th + 0.8, p.z + Math.sin(ang) * 2.5, 0.6, 0.8, 0.6, ang, color, { tile });
          }
        } else {
          chhatri(stone, p.x, b.baseY + th + 0.4, p.z, 3.4, b.yaw, color);
        }
        physics.addCylinder(p.x, b.baseY, p.z, 2.6, th);
        physics.addCylinder(p.x, b.baseY + th, p.z, 2.8, 0.4); // (its capping ring)
      }
      // A row of chhatris along the palace roof
      if (b.kind === 'palace') {
        for (let a = -b.w / 2 + 8; a <= b.w / 2 - 8; a += 9) {
          const p = local(b, a, b.d / 2 - 2.5);
          chhatri(stone, p.x, top, p.z, 2.6, b.yaw, color);
        }
      }
    }

    // Rooftop life
    if (b.roof.setback) {
      const p = local(b, rng.range(-b.w / 4, b.w / 4), rng.range(-b.d / 4, 0));
      builder.box(p.x, top + 1.3, p.z, Math.min(5, b.w * 0.35), 2.6, Math.min(4.5, b.d * 0.35), b.yaw, color, { tile, uvOffset: uvo });
      physics.addBox(p.x, top + 1.3, p.z, Math.min(5, b.w * 0.35), 2.6, Math.min(4.5, b.d * 0.35), b.yaw);
    }
    if (b.roof.chhatri) {
      const p = local(b, rng.chance(0.5) ? b.w / 2 - 2 : -b.w / 2 + 2, b.d / 2 - 2);
      chhatri(rng.chance(0.5) ? stone : plaster, p.x, top, p.z, 2.4, b.yaw, rng.chance(0.5) ? color : new THREE.Color(0.95, 0.92, 0.86));
      // its four pillars (walk in under the dome)
      const s0 = 2.4 * 0.42;
      for (const [px, pz] of [[-s0, -s0], [s0, -s0], [-s0, s0], [s0, s0]]) physics.addBox(p.x + px * Math.cos(b.yaw) + pz * Math.sin(b.yaw), top + 1.08, p.z - px * Math.sin(b.yaw) + pz * Math.cos(b.yaw), 0.24, 2.16, 0.24, b.yaw);
    }
    if (b.roof.tank) {
      const p = local(b, rng.range(-b.w / 3, b.w / 3), -b.d / 2 + 1.6);
      _m.compose(_p.set(p.x, top, p.z), _q.identity(), _s.set(1, 1, 1));
      tanks.push(_m.clone());
      physics.addCylinder(p.x, top, p.z, 0.75, 1.4);
    }
    if (b.roof.shrine) {
      const p = local(b, rng.range(-b.w / 4, b.w / 4), rng.range(-b.d / 4, b.d / 4));
      const sc = new THREE.Color(0.95, 0.62, 0.25);
      plaster.box(p.x, top + 0.6, p.z, 2.2, 1.2, 2.2, b.yaw, sc, { tile });
      physics.addBox(p.x, top + 0.6, p.z, 2.2, 1.2, 2.2, b.yaw);
      const t = shikhara(plaster, p.x, top + 1.2, p.z, 0.9, 2.6, [0.97, 0.66, 0.28]);
      flags.push(new THREE.Vector3(p.x, t, p.z));
    }

    physics.addBox(b.x, b.baseY + b.h / 2, b.z, b.w, b.h, b.d, b.yaw);
    // the plinth stands out a hand's breadth all round: solid too, or his feet sink into it
    physics.addBox(b.x, b.baseY + 0.45, b.z, b.w + 0.25, 0.9, b.d + 0.25, b.yaw);
  }

  // Temples
  for (const t of layout.temples) {
    _m.compose(_p.set(t.x, t.baseY, t.z), _q.setFromAxisAngle(_up, t.yaw), _s.set(1, 1, 1));
    const res = buildTemple({ stone, plaster, gold, carved }, _m.clone(), t.size, t.style);
    flags.push(...res.flags);
    for (const f of res.footprint) {
      const p = local({ x: t.x, z: t.z, yaw: t.yaw }, f.x, f.z);
      physics.addBox(p.x, t.baseY + f.y, p.z, f.w, f.h, f.d, t.yaw);
    }
    bells.push(new THREE.Vector3(t.x, t.baseY + 2, t.z));
  }

  // Skyline beyond the playable edge (no collision, fades into the haze)
  for (let x = -640; x < 640; x += rng.range(9, 15)) {
    const f = frameAtX(x);
    for (let v = -102; v > -300; v -= rng.range(14, 22)) {
      const p = frameToWorld(f, rng.range(-3, 3), v);
      const h = rng.range(7, 20) * (1 - (-v - 100) / 500);
      const w = rng.range(8, 14);
      const d = rng.range(8, 14);
      const col = new THREE.Color(rng.pick(['#e6dcc6', '#d9b26a', '#cfa38a', '#c9c0b0', '#d8d0bc']));
      plaster.box(p.x, GHAT_TOP + h / 2, p.z, w, h, d, f.yaw, col, { tile: 3, faces: ['px', 'nx', 'py', 'pz'] });
      if (rng.chance(0.04)) shikhara(plaster, p.x, GHAT_TOP + h, p.z, 2.2, 7, [0.95, 0.9, 0.8]);
    }
  }

  // Balcony and water-tank geometry
  const balconyGeo = makeBalconyGeometry();
  const tankGeo = new THREE.CylinderGeometry(0.75, 0.75, 1.4, 14).translate(0, 0.7, 0);

  // Meshes
  // water-aware = also receives the baked night light (no cost by day)
  const plasterMat = surfaceMaterial(textures.plaster, { normalScale: 0.9 });
  const stoneMat = surfaceMaterial(textures.stone, { normalScale: 1.0 });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xffbf52, metalness: 1, roughness: 0.28, vertexColors: true });
  const carvedMat = surfaceMaterial(textures.carving || textures.stone, { normalScale: 1.4 });
  // At night the temples are floodlit (warm uplight on the carvings) and the gold spires glow.
  for (const m of [carvedMat, goldMat]) {
    m.emissive = new THREE.Color(1.0, 0.6, 0.3);
    m.emissiveIntensity = 0;
  }
  carvedMat.emissiveMap = carvedMat.map;
  const group = new THREE.Group();
  group.name = 'city';
  for (const [builder, mat, name] of [
    [plaster, plasterMat, 'plaster'],
    [stone, stoneMat, 'stone'],
    [gold, goldMat, 'gold'],
    [carved, carvedMat, 'carved'],
  ]) {
    if (!builder.vertexCount) continue;
    const mesh = new THREE.Mesh(builder.build(), mat);
    mesh.name = `city-${name}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  const winGeo = new THREE.PlaneGeometry(1, 1);
  const winTex = windowTexture({ lit: false });
  const litTex = windowTexture({ lit: true });
  const winMat = new THREE.MeshStandardMaterial({ map: winTex, alphaTest: 0.5, roughness: 0.55 });
  const litMat = new THREE.MeshStandardMaterial({ map: winTex, emissiveMap: litTex, emissive: 0xffffff, emissiveIntensity: 0, alphaTest: 0.5, roughness: 0.55 });
  group.add(instanced(winGeo, winMat, windowsDark, 'windows'));
  const litMesh = instanced(winGeo, litMat, windowsLit, 'windows-lit');
  group.add(litMesh);
  const balcMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, map: textures.wood?.map || null, normalMap: textures.wood?.normalMap || null });
  const balcMesh = instanced(balconyGeo, balcMat, balconies, 'balconies');
  balcMesh.castShadow = true;
  group.add(balcMesh);
  const tankMesh = instanced(tankGeo, new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 }), tanks, 'tanks');
  tankMesh.castShadow = false; // up on the roofs: a shadow nobody sees, a draw call in the shadow pass
  group.add(tankMesh);

  return {
    group,
    flags,
    bells,
    setNight(n) {
      litMat.emissiveIntensity = n * 2.2;
      carvedMat.emissiveIntensity = n * 0.32;
      goldMat.emissiveIntensity = n * 0.4;
    },
    stats: { windows: windowsDark.length + windowsLit.length, balconies: balconies.length },
  };
}

function instanced(geo, mat, matrices, name) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, matrices.length));
  mesh.name = name;
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
  mesh.count = matrices.length;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.receiveShadow = true;
  return mesh;
}

// Wooden balcony with a painted railing and a little canopy, facing +Z, base at y = 0.
function makeBalconyGeometry() {
  const b = new MeshBuilder();
  const wood = new THREE.Color(0.85, 0.66, 0.52);
  const paint = new THREE.Color(0.48, 0.8, 0.72);
  b.box(0, 0, 0.42, 1.7, 0.14, 0.84, 0, wood, { tile: 1, faces: ['px', 'nx', 'py', 'pz', 'nz', 'ny'] });
  b.box(0, 0.42, 0.82, 1.7, 0.7, 0.05, 0, paint, { tile: 1 });
  b.box(-0.83, 0.42, 0.42, 0.05, 0.7, 0.84, 0, paint, { tile: 1 });
  b.box(0.83, 0.42, 0.42, 0.05, 0.7, 0.84, 0, paint, { tile: 1 });
  for (const sx of [-0.8, 0.8]) b.box(sx, 1.25, 0.8, 0.06, 1.7, 0.06, 0, wood, { tile: 1 });
  b.box(0, 2.15, 0.48, 1.9, 0.08, 1.0, 0, wood, { tile: 1, faces: ['px', 'nx', 'py', 'pz', 'nz', 'ny'] });
  return b.build();
}
