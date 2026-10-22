import * as THREE from 'three';
import { FAR_BANK_V } from '../config.js';
import { GHAT_SEGMENTS, GHAT_X_MAX, GHAT_X_MIN, PROFILE_LEN, frameAtX, frameToWorld, ghatHeight, ghatToWorld, terrainHeight } from './WorldLayout.js';
import { RNG } from '../utils/math.js';
import { WORLD_UNIFORMS, makeWaterAware } from './materials.js';

// Green things that grow where nobody walks, made on the GPU (as Ghost of Tsushima grows its
// fields): tufts of grass and weeds in the angle between each ghat's steps and its side walls,
// and reeds and tall grass along the river's sandy far bank and the unpaved banks beyond the
// ghats. Each a few crossed blades, tinted and sized per tuft, swaying with the one wind of the
// world (uGust: Game's gusts roll through them), the tips more than the roots. Two instanced draws.

const COUNTS = { low: 0.4, medium: 0.7, high: 1, veryhigh: 1.2, ultra: 1.5 };

/** A tuft: n blades fanned round a point, tapering, bending out a little (local y up, 1 m). */
function tuftGeometry(n, bend) {
  const pos = [];
  const uv = [];
  const idx = [];
  for (let b = 0; b < n; b++) {
    const a = (b / n) * Math.PI * 2 + b * 0.7;
    const lean = 0.18 + (b % 3) * 0.08;
    const h = 0.75 + ((b * 37) % 10) / 40;
    const w = 0.05;
    const base = pos.length / 3;
    const segs = 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const r = lean * t + bend * t * t;
      const cx = Math.cos(a) * r;
      const cz = Math.sin(a) * r;
      const ww = w * (1 - t * 0.85);
      const px = -Math.sin(a) * ww;
      const pz = Math.cos(a) * ww;
      pos.push(cx - px, t * h, cz - pz, cx + px, t * h, cz + pz);
      uv.push(0, t, 1, t);
      if (s < segs) {
        const i = base + s * 2;
        idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function swayMaterial(stiff) {
  const m = makeWaterAware(new THREE.MeshStandardMaterial({ roughness: 0.85, side: THREE.DoubleSide, vertexColors: false }), { puddles: false, caustics: false });
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, r) => {
    prev?.call(m, shader, r);
    shader.uniforms.uTime = WORLD_UNIFORMS.uTime;
    shader.uniforms.uGust = WORLD_UNIFORMS.uGust;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uGust;\nvarying float vTip;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          // the wind: a slow lean with the gusts and a quicker flutter, more toward the tips
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float tip = clamp(position.y, 0.0, 1.0);
          vTip = tip;
          float ph = ip.x * 0.37 + ip.z * 0.21;
          float sway = sin(uTime * 1.3 + ph) * 0.5 + sin(uTime * 2.9 + ph * 1.7) * 0.25;
          float push = (0.25 + uGust * 0.9) * ${stiff.toFixed(2)};
          transformed.x += (sway * 0.6 + uGust * 1.2) * push * tip * tip;
          transformed.z += sin(uTime * 2.1 + ph * 0.8) * 0.3 * push * tip * tip;
        }`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vTip;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= mix(0.55, 1.15, vTip); // (darker at the root, sunlit tips)');
  };
  m.customProgramCacheKey = () => `veg-sway-${stiff}`;
  return m;
}

export class Vegetation {
  constructor(scene, quality = 'high') {
    this.scene = scene;
    this.k = COUNTS[quality] ?? 1;
    const k = this.k;
    const rng = new RNG(1717);
    const reeds = [];
    // ---- reeds and tall grass at the water's edge: the far bank's sand, the unpaved near banks
    const shore = (x, v0, v1, dir) => {
      const f = frameAtX(x);
      for (let v = v0; dir > 0 ? v < v1 : v > v1; v += dir * 0.5) {
        const p = frameToWorld(f, 0, v);
        if (terrainHeight(p.x, p.z) > 0.05) return { f, v };
      }
      return null;
    };
    const xs = Math.round(1100 * k);
    for (let i = 0; i < xs; i++) {
      const x = rng.range(GHAT_X_MIN - 260, GHAT_X_MAX + 260);
      const far = rng.next() < 0.65;
      const s = far ? shore(x, FAR_BANK_V - 90, FAR_BANK_V + 30, 1) : x < GHAT_X_MIN || x > GHAT_X_MAX ? shore(x, 40, -10, -1) : null;
      if (!s) continue;
      // a clump of them, back from the edge a little
      const cv = s.v + (far ? 1 : -1) * rng.range(0.2, 5);
      const cl = 3 + Math.floor(rng.next() * 6);
      for (let j = 0; j < cl; j++) {
        const p = frameToWorld(s.f, rng.range(-1.2, 1.2), cv + rng.range(-0.8, 0.8));
        const y = terrainHeight(p.x, p.z);
        if (y < -0.05) continue;
        reeds.push({ x: p.x, y, z: p.z, s: rng.range(0.7, 1.6), tone: rng.next() });
      }
    }
    this.reeds = this.build(scene, reeds, tuftGeometry(9, 0.05), swayMaterial(1), ['#7d8a46', '#9c9658', '#6e7f3c', '#b3a36a'], 'veg-reeds');
  }

  /** The weeds at the walls' feet: once the world's colliders answer rays (a moment after it loads). */
  plantGrass(physics) {
    if (this.grass) return;
    const k = this.k;
    const rng = new RNG(1718);
    const grass = [];
    // ---- in clumps along the back of each ghat's top terrace, where the stone meets the fronts
    // of the buildings and no one walks
    for (const g of GHAT_SEGMENTS) {
      const clumps = Math.round(16 * k);
      for (let c = 0; c < clumps; c++) {
        const uc = rng.range(1, g.width - 1);
        // (at the foot of the wall behind: found by a ray toward the city from the terrace)
        let vc = 0.6;
        if (physics) {
          const o = ghatToWorld(g, uc, 0.6);
          const d = physics.castRay({ x: o.x, y: ghatHeight(0.6) + 0.3, z: o.z }, { x: -g.N.x, y: 0, z: -g.N.z }, 14);
          if (d === null || d < 0.5) continue;
          vc = 0.6 - d + 0.28;
        }
        const n = 3 + Math.floor(rng.next() * 7);
        for (let i = 0; i < n; i++) {
          const u = uc + rng.range(-0.7, 0.7);
          const v = vc + rng.range(-0.15, 0.35);
          const w = ghatToWorld(g, u, v);
          const y = physics ? (physics.castRay({ x: w.x, y: ghatHeight(0.6) + 1.5, z: w.z }, { x: 0, y: -1, z: 0 }, 4) ?? null) : null;
          grass.push({ x: w.x, y: y !== null ? ghatHeight(0.6) + 1.5 - y : ghatHeight(Math.max(0.05, v)), z: w.z, s: rng.range(0.22, 0.5), tone: rng.next() });
        }
      }
    }
    // ---- weeds in the joints of the steps: where a riser meets the tread below it (the damp
    // lower flights most), small tufts against the stone
    const risers = [];
    for (let v = 0.2, prev = ghatHeight(0.2); v < PROFILE_LEN - 0.3; v += 0.04) {
      const h = ghatHeight(v);
      if (prev - h > 0.08) risers.push(v + 0.04);
      prev = h;
    }
    for (const g of GHAT_SEGMENTS) {
      const n = Math.round(55 * k);
      for (let i = 0; i < n; i++) {
        // (more of them toward the water: the low steps stay damp)
        const r = risers[Math.min(risers.length - 1, Math.floor(Math.pow(rng.next(), 0.55) * risers.length))];
        if (r === undefined) break;
        const v = r + rng.range(0.02, 0.07);
        const y = ghatHeight(v);
        if (y < 0.25) continue;
        const u = rng.range(0.6, g.width - 0.6);
        const cl = 1 + Math.floor(rng.next() * 3);
        for (let j = 0; j < cl; j++) {
          const w = ghatToWorld(g, u + rng.range(-0.25, 0.25), v + rng.range(0, 0.04));
          grass.push({ x: w.x, y, z: w.z, s: rng.range(0.1, 0.24), tone: rng.next() });
        }
      }
    }
    this.grass = this.build(this.scene, grass, tuftGeometry(7, 0.12), swayMaterial(0.5), ['#4d6b2a', '#6b7d34', '#8a8a3e', '#5a7a30'], 'veg-grass');
  }

  build(scene, list, geo, mat, tones, name) {
    if (!list.length) return null;
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    mesh.name = name;
    mesh.receiveShadow = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    const UP = new THREE.Vector3(0, 1, 0);
    list.forEach((t, i) => {
      q.setFromAxisAngle(UP, (t.x * 13.7 + t.z * 7.1) % 6.283);
      m.compose(new THREE.Vector3(t.x, t.y - 0.02, t.z), q, new THREE.Vector3(t.s, t.s * (0.8 + t.tone * 0.5), t.s));
      mesh.setMatrixAt(i, m);
      c.set(tones[Math.floor(t.tone * tones.length) % tones.length]).multiplyScalar(0.85 + t.tone * 0.3);
      mesh.setColorAt(i, c);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    scene.add(mesh);
    return mesh;
  }
}
