import * as THREE from 'three';
import { GHAT_TOP, WATER_LEVEL, WORLD } from '../config.js';
import { bankCoords, terrainHeight } from './WorldLayout.js';
import { makeWaterAware } from './materials.js';
import { fbm, smoothstep, lerp } from '../utils/math.js';

// Riverbed, far sand bank, natural banks beyond the ghats and the city paving.
// The physics collider is a trimesh built from the same height function.

const VIS = { x0: -620, x1: 620, z0: -300, z1: 760, step: 4 };
// The physics grid sits exactly on the visual grid (same vertices, same diagonals), so what
// you walk on is what you see. It covers the playable area plus a margin.
const PHYS = { x0: -484, x1: 484, z0: -188, z1: 404, step: 4 };
if (PHYS.x0 > WORLD.xMin - 12 || PHYS.x1 < WORLD.xMax + 12 || PHYS.z0 > WORLD.zMin - 12 || PHYS.z1 < WORLD.zMax + 12) console.warn('[terrain] physics grid smaller than the world');

// Behind the ghats the top terrace is widened 6 m into the city (Ghats.js) and the paving
// there drops 3 cm under it; a 4 m terrain cell that straddles the ghat edge would otherwise
// slope down toward the hidden ground under the steps (a trench behind every ghat).
const TERRACE_INLAND = 6;
function meshHeight(x, z) {
  const { v, seg } = bankCoords(x, z);
  if (seg && v <= 0 && v > -TERRACE_INLAND - 0.5) return GHAT_TOP - 0.03;
  return terrainHeight(x, z);
}
// a cell that crosses the ghat edge is left out (the widened terrace covers it)
function straddlesGhatEdge(xs, zs) {
  let any = false;
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k < 4; k++) {
    const { v, seg } = bankCoords(xs[k], zs[k]);
    if (seg) any = true;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return any && lo <= 0 && hi > 0;
}

export function buildTerrain(textures, physics) {
  const nx = Math.round((VIS.x1 - VIS.x0) / VIS.step) + 1;
  const nz = Math.round((VIS.z1 - VIS.z0) / VIS.step) + 1;
  const pos = new Float32Array(nx * nz * 3);
  const col = new Float32Array(nx * nz * 3);
  const uv = new Float32Array(nx * nz * 2);
  const vArr = new Float32Array(nx * nz);
  const c = new THREE.Color();

  for (let j = 0; j < nz; j++) {
    // Coarser rows far beyond the river to save triangles
    const z = VIS.z0 + j * VIS.step;
    for (let i = 0; i < nx; i++) {
      const x = VIS.x0 + i * VIS.step;
      let y = meshHeight(x, z);
      const { v } = bankCoords(x, z);
      // Distant land rises a little into low fields so the horizon isn't a flat line.
      if (z > WORLD.zMax) y += smoothstep(WORLD.zMax, VIS.z1, z) * 6 * fbm(x * 0.01, z * 0.01, 3);
      if (Math.abs(x) > WORLD.xMax + 30 && v < 0) y += smoothstep(WORLD.xMax + 30, VIS.x1, Math.abs(x)) * 8;
      const k = (j * nx + i) * 3;
      pos[k] = x;
      pos[k + 1] = y;
      pos[k + 2] = z;
      uv[(j * nx + i) * 2] = x / 4;
      uv[(j * nx + i) * 2 + 1] = z / 4;
      vArr[j * nx + i] = v;

      // Vertex tint: dark wet silt under water, damp band at the waterline, pale dry sand above.
      const n = fbm(x * 0.05, z * 0.05, 3);
      if (v < -0.5) {
        c.setRGB(0.78, 0.7, 0.6).multiplyScalar(0.85 + n * 0.3);
      } else if (y < WATER_LEVEL - 0.5) {
        c.setRGB(0.62, 0.6, 0.5).multiplyScalar(0.8 + n * 0.3);
      } else {
        const dry = smoothstep(WATER_LEVEL + 0.2, WATER_LEVEL + 2.0, y);
        c.setRGB(lerp(0.7, 1.05, dry), lerp(0.66, 1.0, dry), lerp(0.56, 0.9, dry)).multiplyScalar(0.88 + n * 0.25);
      }
      col[k] = c.r;
      col[k + 1] = c.g;
      col[k + 2] = c.b;
    }
  }

  // Split triangles into two material groups: sand/silt (river side) and paving (city).
  const sandIdx = [];
  const paveIdx = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const d = a + nx;
      const e = d + 1;
      if (straddlesGhatEdge([pos[a * 3], pos[b * 3], pos[d * 3], pos[e * 3]], [pos[a * 3 + 2], pos[b * 3 + 2], pos[d * 3 + 2], pos[e * 3 + 2]])) continue;
      // paving for the city; the band under the ghat terrace is hidden anyway, so give it paving too
      const city = (vArr[a] + vArr[b] + vArr[d] + vArr[e]) / 4 < 2.5;
      const list = city ? paveIdx : sandIdx;
      list.push(a, d, b, b, d, e);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex([...sandIdx, ...paveIdx]);
  geo.addGroup(0, sandIdx.length, 0);
  geo.addGroup(sandIdx.length, paveIdx.length, 1);
  geo.computeVertexNormals();

  const sandMap = textures.sand;
  const sandMat = makeWaterAware(
    new THREE.MeshStandardMaterial({
      map: sandMap.map,
      normalMap: sandMap.normalMap,
      roughnessMap: sandMap.roughnessMap,
      normalScale: new THREE.Vector2(1.2, 1.2),
      vertexColors: true,
    })
  );
  const pave = cloneSet(textures.stone, 1.6);
  // the lanes: lit by the lane lamps at night, wet and puddled in the rain
  const paveMat = makeWaterAware(
    new THREE.MeshStandardMaterial({
      map: pave.map,
      normalMap: pave.normalMap,
      roughnessMap: pave.roughnessMap,
      vertexColors: true,
    }),
    { caustics: false }
  );
  const mesh = new THREE.Mesh(geo, [sandMat, paveMat]);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';

  // Physics trimesh over the playable area only.
  const px = Math.round((PHYS.x1 - PHYS.x0) / PHYS.step) + 1;
  const pz = Math.round((PHYS.z1 - PHYS.z0) / PHYS.step) + 1;
  const pv = new Float32Array(px * pz * 3);
  for (let j = 0; j < pz; j++) {
    for (let i = 0; i < px; i++) {
      const x = PHYS.x0 + i * PHYS.step;
      const z = PHYS.z0 + j * PHYS.step;
      const k = (j * px + i) * 3;
      pv[k] = x;
      pv[k + 1] = meshHeight(x, z);
      pv[k + 2] = z;
    }
  }
  const pi = new Uint32Array((px - 1) * (pz - 1) * 6);
  let o = 0;
  for (let j = 0; j < pz - 1; j++) {
    for (let i = 0; i < px - 1; i++) {
      const a = j * px + i;
      const X = (q) => pv[q * 3];
      const Z = (q) => pv[q * 3 + 2];
      if (straddlesGhatEdge([X(a), X(a + 1), X(a + px), X(a + px + 1)], [Z(a), Z(a + 1), Z(a + px), Z(a + px + 1)])) continue;
      pi[o++] = a;
      pi[o++] = a + px;
      pi[o++] = a + 1;
      pi[o++] = a + 1;
      pi[o++] = a + px;
      pi[o++] = a + px + 1;
    }
  }
  physics.addTrimesh(pv, pi.subarray(0, o));

  return { mesh, materials: [sandMat, paveMat] };
}

// Clone a texture set with a different repeat (shares the GPU image).
export function cloneSet(set, repeat) {
  const out = {};
  for (const k of ['map', 'normalMap', 'roughnessMap', 'aoMap']) {
    if (!set[k]) continue;
    const t = set[k].clone();
    t.repeat.set(repeat, repeat);
    t.needsUpdate = true;
    out[k] = t;
  }
  return out;
}

// City lane surface sits exactly at GHAT_TOP; exported for anyone placing props there.
export const CITY_GROUND = GHAT_TOP;
export { TERRACE_INLAND };
