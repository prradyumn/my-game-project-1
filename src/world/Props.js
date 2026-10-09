import * as THREE from 'three';
import { GHAT_TOP } from '../config.js';
import { MeshBuilder } from '../utils/MeshBuilder.js';
import { RNG } from '../utils/math.js';
import { leafTexture } from '../utils/textures.js';
import { GHAT_SEGMENTS, frameAtX, frameToWorld, ghatById, ghatToWorld } from './WorldLayout.js';
import { WORLD_UNIFORMS, makeWaterAware, occluderFade, surfaceMaterial } from './materials.js';
import { buildTemple } from './Temple.js';

// Set dressing and the sacred-flame structures. Fire/smoke emitters are returned as plain
// positions so the particle systems (Particles.js) and the quest (Quest.js) can use them.

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);

export function buildProps(layout, textures, physics, extraFlags = []) {
  const group = new THREE.Group();
  group.name = 'props';
  const rng = new RNG(77);
  const stone = new MeshBuilder();
  const plaster = new MeshBuilder();
  const gold = new MeshBuilder();
  const wood = new MeshBuilder();
  const carved = new MeshBuilder();
  const out = {
    group,
    flameSites: {}, // quest flame id -> { pos, lamps: [Vector3] }
    aartiLamps: [], // evening aarti lamp positions (non-quest platforms)
    smokeSites: [],
    lampPosts: [],
    bells: [],
    flagPositions: [],
    interactRadius: {},
    update: () => {},
  };

  // ---- Straw umbrellas + takhts (instanced)
  const umbGeo = umbrellaGeometry();
  const canopyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, side: THREE.DoubleSide, map: textures.straw?.map || null, normalMap: textures.straw?.normalMap || null });
  const frameMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, map: textures.wood?.map || null, normalMap: textures.wood?.normalMap || null });
  // (an umbrella between the camera and Prady fades away instead of filling the frame)
  occluderFade(canopyMat, { top: 2.95, r: 2.3 });
  occluderFade(frameMat, { top: 2.95, r: 2.3, minY: 0.9 }); // (the pole and ribs; never the takht below)
  const umbMeshes = [new THREE.InstancedMesh(umbGeo.canopy, canopyMat, layout.umbrellas.length), new THREE.InstancedMesh(umbGeo.frame, frameMat, layout.umbrellas.length)];
  layout.umbrellas.forEach((u, i) => {
    _e.set(u.tilt, u.yaw, u.tilt * 0.6);
    _m.compose(_p.set(u.x, u.y, u.z), _q.setFromEuler(_e), _s.setScalar(1));
    for (const um of umbMeshes) um.setMatrixAt(i, _m);
    physics.addBox(u.x, u.y + 0.25, u.z, 1.9, 0.5, 1.2, u.yaw);
    physics.addCylinder(u.x, u.y + 0.5, u.z, 0.06, 2.6); // the bamboo pole (stand on the takht beside it)
    physics.addCameraDisc(u.x, u.y + 2.95, u.z, 2.3, 0.55); // the canopy: the camera stays under it
  });
  for (const um of umbMeshes) {
    um.castShadow = true;
    um.receiveShadow = true;
    um.computeBoundingSphere();
    group.add(um);
  }

  // ---- Lamp posts along the top terraces (warm glow at night)
  for (const g of GHAT_SEGMENTS) {
    for (let u = 6; u < g.width - 3; u += 14) {
      const p = ghatToWorld(g, u, 3.3);
      wood.cylinder(p.x, GHAT_TOP, p.z, 0.09, 0.06, 3.4, 6, new THREE.Color(0.12, 0.12, 0.12), { tile: 1 });
      wood.box(p.x, GHAT_TOP + 3.45, p.z, 0.36, 0.42, 0.36, g.yaw, new THREE.Color(0.15, 0.14, 0.12), { tile: 1 });
      out.lampPosts.push(new THREE.Vector3(p.x, GHAT_TOP + 3.45, p.z));
      physics.addCylinder(p.x, GHAT_TOP, p.z, 0.11, 3.4);
    }
  }

  // ---- Dashashwamedh aarti platforms
  for (const a of layout.aartiPlatforms) {
    _m.compose(_p.set(a.x, a.y, a.z), _q.setFromAxisAngle(UP, a.yaw), _s.setScalar(1));
    wood.setTransform(_m.clone());
    gold.setTransform(_m.clone());
    wood.box(0, 0.45, 0, 2.8, 0.9, 2.8, 0, new THREE.Color(0.62, 0.48, 0.38), { tile: 1.4 });
    wood.box(0, 0.86, 0, 2.9, 0.08, 2.9, 0, new THREE.Color(0.75, 0.55, 0.2), { tile: 1, faces: ['px', 'nx', 'py', 'pz', 'nz', 'ny'] }); // brass trim
    for (const [x, z] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) wood.box(x, 0.45, z, 0.22, 0.9, 0.22, 0, new THREE.Color(0.7, 0.52, 0.4), { tile: 1 });
    wood.box(0, 0.92, 0, 2.6, 0.06, 2.6, 0, new THREE.Color(0.55, 0.08, 0.06), { tile: 1 }); // red cloth
    // brass lamp stand with three tiers
    gold.cylinder(0, 0.95, 0, 0.18, 0.06, 1.5, 10, new THREE.Color(1, 1, 1), { tile: 1 });
    const lamps = [];
    for (let t = 0; t < 3; t++) {
      const y = 1.35 + t * 0.45;
      const r = 0.42 - t * 0.12;
      gold.lathe(0, y, 0, [[0.04, 0], [r, 0.06], [r + 0.02, 0.1]], 16, new THREE.Color(1, 1, 1), { tile: 1 });
      for (let k = 0; k < 6 - t * 2; k++) {
        const ang = (k / (6 - t * 2)) * Math.PI * 2;
        lamps.push(new THREE.Vector3(Math.cos(ang) * r * 0.9, y + 0.14, Math.sin(ang) * r * 0.9).applyMatrix4(_m));
      }
    }
    lamps.push(new THREE.Vector3(0, 2.55, 0).applyMatrix4(_m));
    wood.setTransform(null);
    gold.setTransform(null);
    physics.addBox(a.x, a.y + 0.45, a.z, 2.8, 0.9, 2.8, a.yaw);
    physics.addCylinder(a.x, a.y + 0.95, a.z, 0.24, 1.5); // the brass lamp stand
    if (a.central) out.flameSites.dashashwamedh = { pos: new THREE.Vector3(a.x, a.y, a.z), lamps };
    else out.aartiLamps.push(...lamps);
    out.smokeSites.push({ pos: new THREE.Vector3(a.x, a.y + 1.2, a.z), kind: 'incense', aarti: true });
  }

  // ---- Flame pillars (Assi, Kedar)
  for (const f of layout.flames.filter((f) => f.type === 'pillar')) {
    _m.compose(_p.set(f.x, f.y, f.z), _q.setFromAxisAngle(UP, f.yaw), _s.setScalar(1));
    stone.setTransform(_m.clone());
    gold.setTransform(_m.clone());
    const c = new THREE.Color(0.93, 0.82, 0.66);
    stone.box(0, 0.3, 0, 1.4, 0.6, 1.4, 0, c.clone().multiplyScalar(0.85), { tile: 1.2 });
    stone.cylinder(0, 0.6, 0, 0.36, 0.3, 2.4, 8, c, { tile: 1.2 });
    stone.box(0, 3.1, 0, 0.95, 0.22, 0.95, 0, c.clone().multiplyScalar(0.85), { tile: 1.2, faces: ['px', 'nx', 'py', 'pz', 'nz', 'ny'] });
    gold.lathe(0, 3.21, 0, [[0.08, 0], [0.42, 0.12], [0.48, 0.22]], 16, new THREE.Color(1, 1, 1), { tile: 1 });
    stone.setTransform(null);
    gold.setTransform(null);
    // the square base (a round collider left its corners for his feet to sink into), the column
    physics.addBox(f.x, f.y + 0.3, f.z, 1.4, 0.6, 1.4, f.yaw);
    physics.addCylinder(f.x, f.y + 0.6, f.z, 0.4, 2.8);
    out.flameSites[f.id] = { pos: new THREE.Vector3(f.x, f.y, f.z), lamps: [new THREE.Vector3(f.x, f.y + 3.36, f.z)] };
  }

  // ---- Hazara Deepstambh at Panchganga: the thousand-lamp pillar
  {
    const f = layout.flames.find((x) => x.type === 'deepstambh');
    const c = new THREE.Color(0.86, 0.78, 0.64);
    const H = 9;
    stone.box(f.x, f.y + 0.5, f.z, 3.2, 1.0, 3.2, f.yaw, c.clone().multiplyScalar(0.8), { tile: 1.5 });
    stone.cylinder(f.x, f.y + 1.0, f.z, 0.95, 0.55, H, 8, c, { tile: 1.5 });
    const lamps = [];
    for (let r = 0; r < 13; r++) {
      const y = f.y + 1.6 + r * 0.62;
      const rad = 0.95 - (0.4 * (y - f.y - 1)) / H;
      const n = 8;
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * Math.PI * 2 + (r % 2) * (Math.PI / n) + f.yaw;
        const px = f.x + Math.cos(ang) * (rad + 0.18);
        const pz = f.z + Math.sin(ang) * (rad + 0.18);
        stone.box(px, y, pz, 0.3, 0.08, 0.22, -ang, c.clone().multiplyScalar(0.9), { tile: 1 });
        lamps.push(new THREE.Vector3(px, y + 0.1, pz));
      }
    }
    gold.lathe(f.x, f.y + 1 + H, f.z, [[0.2, 0], [0.7, 0.2], [0.75, 0.35]], 16, new THREE.Color(1, 1, 1), { tile: 1 });
    lamps.push(new THREE.Vector3(f.x, f.y + H + 1.22, f.z));
    // the square base, then the column with its rings of lamp ledges
    physics.addBox(f.x, f.y + 0.5, f.z, 3.2, 1.0, 3.2, f.yaw);
    physics.addCylinder(f.x, f.y + 1.0, f.z, 1.3, H);
    out.flameSites.panchganga = { pos: new THREE.Vector3(f.x, f.y, f.z), lamps };
  }

  // ---- Ratneshwar: the leaning temple, half swallowed by the river
  {
    const f = layout.flames.find((x) => x.type === 'sunken');
    const g = ghatById('scindia');
    // temple behind the flame platform, leaning toward the river
    const back = { x: f.x - g.N.x * 6.2, z: f.z - g.N.z * 6.2 };
    const tilt = 0.17;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, g.yaw, 0, 'YXZ'));
    _m.compose(_p.set(back.x, -3.4, back.z), q, _s.setScalar(1));
    const res = buildTemple({ stone, plaster, gold, carved }, _m.clone(), 5.5, 'sandstone');
    out.flagPositions.push(...res.flags);
    for (const fp of res.footprint) {
      const c = new THREE.Vector3(fp.x, fp.y, fp.z).applyMatrix4(_m);
      physics.addBoxQ(c.x, c.y, c.z, fp.w, fp.h, fp.d, q);
    }
    // broken stone platform at the waterline holding the flame bowl
    stone.box(f.x, f.y - 1.6, f.z, 4.2, 3.6, 3.2, g.yaw + 0.05, new THREE.Color(0.7, 0.62, 0.52), { tile: 1.6 });
    gold.lathe(f.x, f.y + 0.2, f.z, [[0.08, 0], [0.42, 0.12], [0.48, 0.22]], 16, new THREE.Color(1, 1, 1), { tile: 1 });
    physics.addBox(f.x, f.y - 1.6, f.z, 4.2, 3.6, 3.2, g.yaw + 0.05);
    out.flameSites.ratneshwar = { pos: new THREE.Vector3(f.x, f.y, f.z), lamps: [new THREE.Vector3(f.x, f.y + 0.34, f.z)] };
  }

  // ---- Manikarnika woodpiles with rising smoke
  for (const p of layout.pyres) {
    const c = new THREE.Color(0.66, 0.52, 0.42);
    for (let layer = 0; layer < 4; layer++) {
      for (let k = 0; k < 5; k++) {
        const along = (k - 2) * 0.32;
        const yaw = p.yaw + (layer % 2 ? Math.PI / 2 : 0);
        const cx = p.x + Math.sin(yaw) * along;
        const cz = p.z + Math.cos(yaw) * along;
        _m.compose(_p.set(cx, p.y + 0.15 + layer * 0.28, cz), _q.setFromEuler(_e.set(0, yaw, Math.PI / 2)), _s.setScalar(1));
        wood.geometry(LOG_GEO, _m, c.clone().multiplyScalar(rng.range(0.8, 1.2)));
      }
    }
    physics.addBox(p.x, p.y + 0.6, p.z, 1.8, 1.2, 1.8, p.yaw);
    out.smokeSites.push({ pos: new THREE.Vector3(p.x, p.y + 1.3, p.z), kind: 'pyre' });
  }

  // ---- Peepal trees, each on its chabutra: a round stone platform people sit on, the trunk
  // tied with sacred red and yellow thread. Tapering limbs bend up into the canopy.
  const leafCards = [];
  const bark = new THREE.Color(0.55, 0.47, 0.4);
  const limb = (A, B, r0, r1) => {
    const d = new THREE.Vector3().subVectors(B, A);
    const len = d.length();
    const geo = new THREE.CylinderGeometry(r1, r0, len, 7, 1, true).translate(0, len / 2, 0);
    _q.setFromUnitVectors(UP, d.normalize());
    wood.geometry(geo, _m.compose(A, _q, _s.setScalar(1)), bark.clone().multiplyScalar(rng.range(0.9, 1.05)));
  };
  // a lane tree goes to whichever side of its lane has room, leaving the middle to walkers;
  // if neither side clears the house walls it is not planted
  const R = physics.RAPIER;
  const fits = (x, z, r) => {
    let hit = false;
    physics.world.intersectionsWithShape({ x, y: GHAT_TOP + 1.5, z }, { x: 0, y: 0, z: 0, w: 1 }, new R.Cylinder(1.2, r), () => {
      hit = true;
      return false;
    });
    return !hit;
  };
  const planted = [];
  for (const t of layout.trees) {
    if (!t.lane) {
      planted.push(t);
      continue;
    }
    const r = 1.8 * t.scale + 0.4;
    const f = frameAtX(t.lane.x);
    for (const side of rng.chance(0.5) ? [1, -1] : [-1, 1]) {
      const p = frameToWorld(f, 0, t.lane.v + side * (r + 1.7));
      if (fits(p.x, p.z, r)) {
        planted.push({ ...t, x: p.x, z: p.z });
        break;
      }
    }
  }
  layout.trees = planted;
  for (const t of layout.trees) {
    const s = t.scale;
    const deck = 0.45; // chabutra height
    stone.cylinder(t.x, t.y, t.z, 1.75 * s, 1.85 * s, deck, 22, new THREE.Color(0.86, 0.8, 0.72), { tile: 1.2 });
    stone.cylinder(t.x, t.y + deck, t.z, 1.8 * s, 1.8 * s, 0.06, 22, new THREE.Color(0.8, 0.74, 0.66), { tile: 1.2 });
    const base = t.y + deck + 0.06;
    wood.lathe(t.x, base, t.z, [[0.62 * s, 0], [0.46 * s, 0.9 * s], [0.38 * s, 2.6 * s], [0.27 * s, 4.2 * s], [0.16 * s, 5.6 * s], [0.08 * s, 6.6 * s]], 12, bark, {
      tile: 1.5,
      radiusFn: (th) => 1 + 0.14 * Math.sin(th * 5) + 0.05 * Math.sin(th * 11),
    });
    // the sacred thread, wound a few times round the trunk
    for (let k = 0; k < 3; k++) {
      const ring = new THREE.TorusGeometry(0.47 * s + 0.012, 0.016, 5, 20).rotateX(Math.PI / 2);
      wood.geometry(ring, _m.makeTranslation(t.x, base + (0.95 + k * 0.07) * s, t.z), k === 1 ? new THREE.Color(0.95, 0.75, 0.15) : new THREE.Color(0.75, 0.08, 0.06));
    }
    // limbs: out and up from the trunk, then bending up into the leaves
    const n = 7;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rng.range(-0.3, 0.3);
      const h0 = rng.range(3.3, 4.6) * s;
      const out1 = rng.range(1.2, 1.9) * s;
      const up1 = rng.range(0.9, 1.5) * s;
      const out2 = rng.range(0.9, 1.6) * s;
      const up2 = rng.range(1.2, 2.0) * s;
      const A = new THREE.Vector3(t.x + Math.cos(a) * 0.18 * s, base + h0, t.z + Math.sin(a) * 0.18 * s);
      const B = new THREE.Vector3(A.x + Math.cos(a) * out1, A.y + up1, A.z + Math.sin(a) * out1);
      const a2 = a + rng.range(-0.35, 0.35);
      const C = new THREE.Vector3(B.x + Math.cos(a2) * out2, B.y + up2, B.z + Math.sin(a2) * out2);
      limb(A, B, 0.2 * s, 0.13 * s);
      limb(B, C, 0.13 * s, 0.05 * s);
      // a twig off each limb
      const a3 = a2 + (k % 2 ? 0.8 : -0.8);
      limb(B, new THREE.Vector3(B.x + Math.cos(a3) * 1.1 * s, B.y + 0.9 * s, B.z + Math.sin(a3) * 1.1 * s), 0.07 * s, 0.03 * s);
    }
    physics.addCylinder(t.x, t.y, t.z, 1.8 * s, deck + 0.06);
    physics.addCylinder(t.x, t.y, t.z, 0.6 * s, 6 * s + deck);
    for (let k = 0; k < 190; k++) {
      const u = rng.next() * Math.PI * 2;
      const v = Math.acos(rng.range(-0.45, 1));
      const r = rng.range(2.0, 4.6) * s;
      const pos = new THREE.Vector3(t.x + Math.sin(v) * Math.cos(u) * r * 1.15, base + 6.6 * s + Math.cos(v) * r * 0.7, t.z + Math.sin(v) * Math.sin(u) * r * 1.15);
      _q.setFromEuler(_e.set(rng.range(-1.2, 1.2), rng.range(0, Math.PI * 2), rng.range(-1.2, 1.2)));
      leafCards.push(new THREE.Matrix4().compose(pos, _q.clone(), _s.setScalar(rng.range(1.6, 2.6) * s)));
    }
  }
  const leafMat = new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8 });
  leafMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = WORLD_UNIFORMS.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
          transformed.x += sin(uTime * 1.6 + ip.x * 0.7 + ip.y) * 0.05;
          transformed.y += cos(uTime * 1.3 + ip.z * 0.6) * 0.04;
        #endif`
      );
  };
  const leaves = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), leafMat, leafCards.length);
  leafCards.forEach((m, i) => leaves.setMatrixAt(i, m));
  leaves.castShadow = true;
  leaves.receiveShadow = true;
  leaves.computeBoundingSphere();
  group.add(leaves);

  // ---- Saffron flags on every temple spire
  const flagSpots = [...extraFlags, ...out.flagPositions];
  const flags = flagMesh(flagSpots);
  group.add(flags);

  // ---- Build the merged meshes
  const stoneMat = surfaceMaterial(textures.stone, { normalScale: 1 });
  const plasterMat = surfaceMaterial(textures.plaster, { normalScale: 0.8 });
  const goldMat = makeWaterAware(new THREE.MeshStandardMaterial({ color: 0xffbf52, metalness: 1, roughness: 0.3, vertexColors: true }));
  const woodMat = makeWaterAware(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, map: textures.wood?.map || null, normalMap: textures.wood?.normalMap || null }));
  const carvedMat = surfaceMaterial(textures.carving || textures.stone, { normalScale: 1.4 });
  // the sunken temple is floodlit at night too (brass lamps stay brass: the fire lights them)
  carvedMat.emissive = new THREE.Color(1.0, 0.6, 0.3);
  carvedMat.emissiveIntensity = 0;
  carvedMat.emissiveMap = carvedMat.map;
  out.setNight = (n) => {
    carvedMat.emissiveIntensity = n * 0.32;
  };
  for (const [b, mat, name] of [
    [stone, stoneMat, 'stone'],
    [plaster, plasterMat, 'plaster'],
    [gold, goldMat, 'gold'],
    [wood, woodMat, 'wood'],
    [carved, carvedMat, 'carved'],
  ]) {
    if (!b.vertexCount) continue;
    const mesh = new THREE.Mesh(b.build(), mat);
    mesh.name = `props-${name}`;
    mesh.castShadow = name !== 'gold'; // small brass fittings: not worth a shadow-pass draw
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return out;
}

const LOG_GEO = new THREE.CylinderGeometry(0.13, 0.15, 1.8, 7);

function umbrellaGeometry() {
  const c = new MeshBuilder();
  const straw = new THREE.Color(1.0, 0.92, 0.78);
  const strawDark = new THREE.Color(0.86, 0.76, 0.6);
  const border = new THREE.Color(0.75, 0.2, 0.1);
  // canopy: rim -> apex, woven straw texture with alternating panels and a cloth border
  c.lathe(0, 2.65, 0, [[2.4, -0.08], [2.32, 0], [1.5, 0.36], [0.7, 0.62], [0.03, 0.78]], 28, straw, {
    tile: 0.9,
    colorFn: (th, t) => (t < 0.12 ? border : Math.floor((th / (Math.PI * 2)) * 14) % 2 ? straw : strawDark),
  });
  const f = new MeshBuilder();
  // bamboo pole
  f.cylinder(0, 0.4, 0, 0.05, 0.045, 3.1, 6, new THREE.Color(0.85, 0.75, 0.55), { tile: 1 });
  // wooden takht
  const w = new THREE.Color(0.75, 0.6, 0.48);
  f.box(0, 0.42, 0, 1.9, 0.08, 1.2, 0, w, { tile: 1.2, faces: ['px', 'nx', 'py', 'pz', 'nz', 'ny'] });
  for (const [x, z] of [[-0.85, -0.5], [0.85, -0.5], [-0.85, 0.5], [0.85, 0.5]]) f.box(x, 0.19, z, 0.1, 0.38, 0.1, 0, w, { tile: 1 });
  return { canopy: c.build(), frame: f.build() };
}

function flagMesh(positions) {
  // Pole + triangular pennant; pennant waves in the vertex shader.
  const geo = new THREE.BufferGeometry();
  const pos = [];
  const uv = [];
  // pole (thin quad cross)
  const ph = 2.2;
  for (const a of [0, Math.PI / 2]) {
    const dx = Math.cos(a) * 0.03;
    const dz = Math.sin(a) * 0.03;
    pos.push(-dx, 0, -dz, dx, 0, dz, dx, ph, dz, -dx, 0, -dz, dx, ph, dz, -dx, ph, -dz);
    for (let i = 0; i < 6; i++) uv.push(0, 0);
  }
  // pennant: 6 segments along x for smooth waving
  const L = 1.5;
  const seg = 6;
  for (let i = 0; i < seg; i++) {
    const x0 = (i / seg) * L;
    const x1 = ((i + 1) / seg) * L;
    const h0 = 0.55 * (1 - i / seg);
    const h1 = 0.55 * (1 - (i + 1) / seg);
    const y = ph - 0.05;
    pos.push(x0, y, 0, x1, y - (0.55 - h1) / 2, 0, x1, y - (0.55 - h1) / 2 - h1, 0);
    pos.push(x0, y, 0, x1, y - (0.55 - h1) / 2 - h1, 0, x0, y - h0, 0);
    uv.push(x0 / L, 1, x1 / L, 1, x1 / L, 1, x0 / L, 1, x1 / L, 1, x0 / L, 1);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xff6a12, side: THREE.DoubleSide, roughness: 0.8, emissive: 0x3a1000 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = WORLD_UNIFORMS.uTime;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      float fx = uv.x;
      vec3 ipos = vec3(0.0);
      #ifdef USE_INSTANCING
        ipos = instanceMatrix[3].xyz;
      #endif
      transformed.z += sin(uTime * 6.0 - fx * 7.0 + ipos.x) * 0.18 * fx;
      transformed.y += cos(uTime * 4.0 - fx * 5.0 + ipos.z) * 0.05 * fx;`
    );
  };
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, positions.length));
  positions.forEach((p, i) => {
    _m.compose(_p.copy(p), _q.setFromAxisAngle(UP, 0.4 + i * 0.7), _s.setScalar(1.2));
    mesh.setMatrixAt(i, _m);
  });
  mesh.count = positions.length;
  mesh.computeBoundingSphere();
  mesh.castShadow = true;
  return mesh;
}

