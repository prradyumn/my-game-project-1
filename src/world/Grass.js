import * as THREE from 'three';
import { FAR_BANK_V, WATER_LEVEL } from '../config.js';
import { bankCoords, frameAtX, frameToWorld, GHAT_X_MAX, GHAT_X_MIN, groundHeight, PROFILE_LEN } from './WorldLayout.js';
import { WORLD_UNIFORMS } from './materials.js';
import { fbm, RNG, smoothstep } from '../utils/math.js';

// The wild green of the river's edge, where no one has laid stone: the muddy banks past either
// end of the ghats and the long sand bank across the river.
//
//  * GrassField: a carpet of short grass round the camera (the way the open-world games grow
//    theirs). One instanced draw of tufts on a grid that moves with the camera a whole cell at a
//    time, each tuft placed, sized, tinted and thinned in the vertex shader from two baked maps:
//    the ground's height (Water's) and where grass grows (grassAt, baked once). Wind runs through
//    it, a gust rolls over it, it parts round Prady's legs, and a few tufts flower.
//  * WildBank: kans grass (Saccharum spontaneum), the tall grass of the Ganga's sandbanks, its
//    silver-white plumes nodding in the wind, in drifts across the far bank and the wild banks;
//    with low thorny scrub among them. Two instanced draws, scattered once.

const SPACING = { low: 0, medium: 0.72, high: 0.6, veryhigh: 0.55, ultra: 0.48 }; // m between tufts (0: none)
const WILD = { low: 0.35, medium: 0.65, high: 1, veryhigh: 1.15, ultra: 1.4 };
const HALF = 30; // m: the carpet's reach from the camera

// Ramnagar Fort's footprint across the river (RamnagarFort: BX -330, the wall at v 272): bare
const FORT = (() => {
  const p = frameToWorld(frameAtX(-330), 0, 285);
  return { x: p.x, z: p.z, r: 95 };
})();

/** Where the short grass grows: [density 0..1, dryness 0..1]. */
export function grassAt(x, z) {
  const { v, seg } = bankCoords(x, z);
  // the city's paving, the ghats' stone (their steps and terraces)
  if (v < 0.5 || (seg && v < PROFILE_LEN + 1.5)) return [0, 0];
  const above = groundHeight(x, z) - WATER_LEVEL;
  if (above < 0.3) return [0, 0];
  const fd = Math.hypot(x - FORT.x, z - FORT.z);
  if (fd < FORT.r) return [0, 0];
  const n = fbm(x * 0.03, z * 0.03, 3);
  const n2 = fbm(x * 0.13 + 5.1, z * 0.13, 2);
  // the bare wet sand at the water's edge, then drifts and bare patches
  let d = smoothstep(0.3, 1.0, above) * (0.35 + 0.65 * smoothstep(0.3, 0.55, n + (n2 - 0.5) * 0.3));
  d *= smoothstep(FORT.r, FORT.r + 30, fd);
  // greener down by the water, straw-dry up on the dunes
  const dry = Math.min(1, smoothstep(0.8, 3.2, above) * 0.75 + (1 - n) * 0.35);
  return [d, dry];
}

function hash(i, j, k = 0) {
  const s = Math.sin(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/** A tuft: eight thin blades scattered over a hand-span and more, 2 segments and a point each
 *  (local metres, 0.25-0.6 m tall): wide enough that neighbouring tufts run together. */
function tuftGeometry() {
  const rng = new RNG(77);
  const pos = [];
  const nor = [];
  const tt = [];
  const idx = [];
  for (let b = 0; b < 8; b++) {
    const a = rng.next() * Math.PI * 2; // (the way the blade bends)
    const ra = rng.next() * Math.PI * 2;
    const rr = Math.sqrt(rng.next()) * 0.32; // (where its root is, round the tuft's middle)
    const ox = Math.cos(ra) * rr;
    const oz = Math.sin(ra) * rr;
    const h = rng.range(0.24, 0.58);
    const lean = rng.range(0.04, 0.2);
    const w = rng.range(0.018, 0.03);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const base = pos.length / 3;
    for (let s = 0; s <= 2; s++) {
      const t = s / 2;
      const r = lean * t * t;
      const cx = ox + ca * r;
      const cz = oz + sa * r;
      const y = t * h * (1 - lean * 0.6 * t);
      if (s < 2) {
        const ww = w * (1 - t * 0.6);
        pos.push(cx - sa * ww, y, cz + ca * ww, cx + sa * ww, y, cz - ca * ww);
        nor.push(ca, 0.3, sa, ca, 0.3, sa);
        tt.push(t, t);
      } else {
        pos.push(cx, y, cz);
        nor.push(ca, 0.3, sa);
        tt.push(1);
      }
    }
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(tt, 1));
  g.setIndex(idx);
  return g;
}

const GLSL_HASH = /* glsl */ `
float gHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }`;

export class GrassField {
  constructor(scene, { heightTex, bounds, quality = 'high' }) {
    const s = SPACING[quality] ?? SPACING.high;
    this.on = s > 0;
    if (!this.on) return;
    this.s = s;
    const n = Math.round((HALF * 2) / s);
    const geo = tuftGeometry();
    const cells = new Float32Array(n * n * 2);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) cells.set([i - n / 2, j - n / 2], (j * n + i) * 2);
    geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
    geo.instanceCount = n * n;
    this.count = n * n;
    this.mapTex = this.bakeMap(bounds);
    const U = {
      uCenter: { value: new THREE.Vector2() },
      uSpacing: { value: s },
      uHalf: { value: HALF },
      uCam: { value: new THREE.Vector3() },
      uHeight: { value: heightTex },
      uGrass: { value: this.mapTex },
      uBounds: { value: new THREE.Vector4(bounds.x0, bounds.z0, bounds.w, bounds.h) },
    };
    this.U = U;
    // (the sky's light kept low: the blades read pale and grey under the full of it)
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide, envMapIntensity: 0.45 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U, { uTime: WORLD_UNIFORMS.uTime, uGust: WORLD_UNIFORMS.uGust, uPusher: WORLD_UNIFORMS.uPusher });
      sh.vertexShader = sh.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform vec2 uCenter; uniform float uSpacing; uniform float uHalf; uniform vec3 uCam;
          uniform sampler2D uHeight; uniform sampler2D uGrass; uniform vec4 uBounds;
          uniform float uTime; uniform float uGust; uniform vec4 uPusher;
          attribute vec2 aCell; attribute float aT;
          varying float vTip; varying vec3 vTint; varying vec3 vBloom;
          ${GLSL_HASH}`
        )
        .replace(
          '#include <beginnormal_vertex>',
          `vec3 gPos;
          vec3 objectNormal;
          {
            vec2 gc = uCenter + aCell;
            float h1 = gHash(gc), h2 = gHash(gc + 17.3), h3 = gHash(gc + 41.7), h4 = gHash(gc + 73.1);
            vec2 gp = (gc + vec2(h1, h2)) * uSpacing; // (jittered in its cell: no rows)
            vec2 tuv = (gp - uBounds.xy) / uBounds.zw;
            vec4 gm = texture2D(uGrass, tuv);
            float gy = texture2D(uHeight, tuv).r;
            float dc = length(gp - uCam.xz);
            float live = step(h3, gm.r) * (1.0 - smoothstep(uHalf * 0.72, uHalf * 0.98, dc));
            float sc = (0.6 + h4 * 0.7) * mix(0.7, 1.25, gm.r) * live;
            float rot = h1 * 6.2831;
            float cr = cos(rot), sr = sin(rot);
            vec3 lp = position * vec3(1.0 + h2 * 0.6, 1.0, 1.0 + h2 * 0.6);
            vec3 rp = vec3(cr * lp.x - sr * lp.z, lp.y, sr * lp.x + cr * lp.z) * sc;
            float t = aT;
            // the wind (gusts roll through it) and Prady's legs parting it
            float ph = gp.x * 0.37 + gp.y * 0.21;
            float sway = sin(uTime * 1.6 + ph) * 0.5 + sin(uTime * 3.3 + ph * 1.7) * 0.2;
            vec2 wind = vec2(1.0, 0.25) * (sway * 0.07 + uGust * 0.2) * t * t * sc;
            vec2 dp = gp - uPusher.xz;
            float dl = length(dp);
            float push = uPusher.w > 0.0 && abs(gy - uPusher.y) < 1.2 ? 1.0 - smoothstep(0.0, uPusher.w * 1.15, dl) : 0.0;
            vec2 pd = dl > 1e-3 ? dp / dl : vec2(0.0);
            vec3 off = vec3(wind.x + pd.x * push * 0.32 * t, -push * 0.22 * t * t * sc, wind.y + pd.y * push * 0.32 * t);
            gPos = vec3(gp.x, gy - 0.02, gp.y) + rp + off;
            if (live < 0.001) gPos = vec3(0.0, -2000.0, 0.0);
            vec3 bn = vec3(cr * normal.x - sr * normal.z, normal.y, sr * normal.x + cr * normal.z);
            objectNormal = normalize(mix(bn, vec3(0.0, 1.0, 0.0), 0.6)); // (soft: no dark backs to the blades)
            vTip = t;
            vec3 green = mix(vec3(0.11, 0.19, 0.045), vec3(0.2, 0.27, 0.07), h2);
            vec3 straw = mix(vec3(0.36, 0.32, 0.15), vec3(0.47, 0.41, 0.2), h4);
            vTint = mix(green, straw, clamp(gm.g + (h3 - 0.5) * 0.35, 0.0, 1.0));
            // a few tufts in flower: yellow, white, a pale violet
            float fl = step(0.962, fract(h4 * 7.13));
            vBloom = fl * (h1 < 0.4 ? vec3(1.0, 0.78, 0.12) : h1 < 0.75 ? vec3(0.95, 0.94, 0.88) : vec3(0.7, 0.55, 0.9));
          }`
        )
        .replace('#include <begin_vertex>', 'vec3 transformed = gPos;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vTip; varying vec3 vTint; varying vec3 vBloom;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          diffuseColor.rgb = vTint * mix(0.42, 1.05, vTip);
          diffuseColor.rgb = mix(diffuseColor.rgb, vBloom, step(0.01, vBloom.r + vBloom.g) * smoothstep(0.82, 0.98, vTip));`
        );
    };
    mat.customProgramCacheKey = () => 'grass-field';
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'grass-field';
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
  }

  /** grassAt over the height map's bounds (R density, G dryness), once. */
  bakeMap(B) {
    const W = 640;
    const H = Math.round((W * B.h) / B.w);
    const data = new Uint8Array(W * H * 4);
    for (let j = 0; j < H; j++) {
      const z = B.z0 + ((j + 0.5) / H) * B.h;
      for (let i = 0; i < W; i++) {
        const x = B.x0 + ((i + 0.5) / W) * B.w;
        const [d, dry] = grassAt(x, z);
        const k = (j * W + i) * 4;
        data[k] = Math.round(d * 255);
        data[k + 1] = Math.round(dry * 255);
        data[k + 3] = 255;
      }
    }
    const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
    t.magFilter = t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  }

  update(camera) {
    if (!this.on) return;
    const c = camera.position;
    this.U.uCenter.value.set(Math.floor(c.x / this.s), Math.floor(c.z / this.s));
    this.U.uCam.value.copy(c);
  }
}

/**
 * The ground the grass grows on: under it the pale sand turns to darker, greener earth (no bare
 * sand showing between the tufts), from the same baked map. Patches a MeshStandardMaterial that
 * already carries vWorldPosW (makeWaterAware).
 */
export function addGrassGround(material, mapTex, B) {
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (sh, r) => {
    prev?.call(material, sh, r);
    sh.uniforms.uGrassMap = { value: mapTex };
    sh.uniforms.uGrassB = { value: new THREE.Vector4(B.x0, B.z0, B.w, B.h) };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uGrassMap; uniform vec4 uGrassB;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          vec4 gm = texture2D(uGrassMap, (vWorldPosW.xz - uGrassB.xy) / uGrassB.zw);
          vec3 earth = mix(vec3(0.3, 0.3, 0.17), vec3(0.46, 0.41, 0.26), gm.g);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * earth * 1.6, smoothstep(0.05, 0.6, gm.r));
        }`
      );
  };
  material.customProgramCacheKey = () => `${prevKey ? prevKey.call(material) : ''}-grassground`;
  material.needsUpdate = true;
}

// ------------------------------------------------------------------ kans grass and scrub

/** A clump of kans: ten tall blades arching out, four plumes nodding over them (local metres). */
function kansGeometry() {
  const pos = [];
  const nor = [];
  const uv = [];
  const kind = [];
  const idx = [];
  const blade = (a, h, lean, w) => {
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const base = pos.length / 3;
    for (let s = 0; s <= 2; s++) {
      const t = s / 2;
      const r = lean * t * t + 0.05;
      const cx = ca * r;
      const cz = sa * r;
      const y = t * h * (1 - lean * 0.25 * t);
      if (s < 2) {
        const ww = w * (1 - t * 0.6);
        pos.push(cx - sa * ww, y, cz + ca * ww, cx + sa * ww, y, cz - ca * ww);
        nor.push(ca, 0.4, sa, ca, 0.4, sa);
        uv.push(0, t, 1, t);
        kind.push(0, 0);
      } else {
        pos.push(cx, y, cz);
        nor.push(ca, 0.4, sa);
        uv.push(0.5, 1);
        kind.push(0);
      }
    }
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base + 2, base + 3, base + 4);
  };
  for (let b = 0; b < 10; b++) blade((b / 10) * Math.PI * 2 + b * 0.9, 1.25 + ((b * 53) % 9) / 14, 0.35 + (b % 3) * 0.18, 0.03);
  // plumes: tall narrow cards from the top of a stem, leaning out, feathered in the shader
  for (let p = 0; p < 4; p++) {
    const a = (p / 4) * Math.PI * 2 + 0.4;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const y0 = 1.55 + (p % 2) * 0.25;
    const y1 = y0 + 0.75;
    const r0 = 0.12;
    const r1 = 0.32 + (p % 2) * 0.1;
    const w = 0.11;
    const base = pos.length / 3;
    const px = -sa * w;
    const pz = ca * w;
    pos.push(ca * r0 + px, y0, sa * r0 + pz, ca * r0 - px, y0, sa * r0 - pz, ca * r1 + px * 1.4, y1, sa * r1 + pz * 1.4, ca * r1 - px * 1.4, y1, sa * r1 - pz * 1.4);
    for (let k = 0; k < 4; k++) nor.push(ca * 0.5, 0.8, sa * 0.5);
    uv.push(0, 0, 1, 0, 0, 1, 1, 1);
    kind.push(1, 1, 1, 1);
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  g.setIndex(idx);
  return g;
}

/** A low shrub: a cloud of small leaf cards round a short core, a flattened dome (local metres). */
function shrubGeometry() {
  const rng = new RNG(911);
  const pos = [];
  const nor = [];
  const uv = [];
  const kind = [];
  const idx = [];
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < 56; i++) {
    // a point in the dome, more of them toward its skin
    const a = rng.next() * Math.PI * 2;
    const r = Math.sqrt(rng.next()) * 0.4 + 0.6;
    const el = rng.range(-0.15, 1.2);
    const c = new THREE.Vector3(Math.cos(a) * Math.cos(el) * r, 0.42 + Math.sin(el) * r * 0.55, Math.sin(a) * Math.cos(el) * r);
    n.copy(c).sub(new THREE.Vector3(0, 0.3, 0)).normalize();
    // a card facing out of the dome, turned a little at random
    e1.set(-n.z, 0, n.x).normalize().applyAxisAngle(n, rng.range(0, 3.14));
    e2.crossVectors(n, e1).normalize();
    const w = rng.range(0.16, 0.26);
    const base = pos.length / 3;
    for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      pos.push(c.x + (e1.x * u + e2.x * v) * w, c.y + (e1.y * u + e2.y * v) * w, c.z + (e1.z * u + e2.z * v) * w);
      nor.push(n.x, n.y, n.z);
      uv.push((u + 1) / 2, (v + 1) / 2);
      kind.push(2);
    }
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  g.setIndex(idx);
  return g;
}

function windMaterial(base, { amp, plumes = false }) {
  const m = new THREE.MeshStandardMaterial(base);
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = WORLD_UNIFORMS.uTime;
    sh.uniforms.uGust = WORLD_UNIFORMS.uGust;
    sh.uniforms.uSunColor = WORLD_UNIFORMS.uSunColor;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime; uniform float uGust;\n${plumes ? 'attribute float aKind; varying float vKind; varying vec2 vUvK;' : ''}\nvarying float vH;`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float tip = clamp(position.y / 2.2, 0.0, 1.0);
          vH = tip;
          float ph = ip.x * 0.31 + ip.z * 0.17;
          float sway = sin(uTime * 1.1 + ph) * 0.6 + sin(uTime * 2.3 + ph * 1.9) * 0.25;
          float push = (0.3 + uGust * 1.1) * ${amp.toFixed(3)};
          transformed.x += (sway * 0.5 + uGust * 1.3) * push * tip * tip;
          transformed.z += sin(uTime * 1.7 + ph * 0.7) * 0.25 * push * tip * tip;
          ${plumes ? 'vKind = aKind; vUvK = uv;' : ''}
        }`
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 uSunColor;\n${plumes ? 'varying float vKind; varying vec2 vUvK;' : ''}\nvarying float vH;`)
      .replace(
        '#include <color_fragment>',
        plumes
          ? `#include <color_fragment>
          if (vKind > 1.5) {
            // a sprig of small leaves on the card: three pointed ovals fanned from its foot
            vec2 q = vUvK * 2.0 - 1.0;
            float leaf = 0.0;
            for (int i = 0; i < 3; i++) {
              float ang = (float(i) - 1.0) * 0.7;
              vec2 r = vec2(cos(ang) * q.x - sin(ang) * (q.y + 0.9), sin(ang) * q.x + cos(ang) * (q.y + 0.9));
              float l = length(vec2(r.x * 2.6, (r.y - 0.95) * 1.05));
              leaf = max(leaf, 1.0 - smoothstep(0.75, 0.9, l));
            }
            if (leaf < 0.5) discard;
            diffuseColor.rgb *= mix(0.65, 1.15, vUvK.y);
          } else if (vKind > 0.5) {
            // the plume: a spindle of silky fibres, combed out toward its tip
            vec2 q = vUvK;
            float spindle = sin(q.y * 3.14159) * (0.55 + 0.45 * q.y);
            float edge = abs(q.x - 0.5) * 2.0;
            float fibre = 0.55 + 0.45 * sin(q.x * 47.0 + q.y * 13.0 + sin(q.y * 31.0) * 2.0);
            float a = smoothstep(0.0, 0.25, spindle - edge * (0.75 + 0.25 * fibre)) ;
            if (a < 0.35) discard;
            diffuseColor.rgb = mix(vec3(0.78, 0.74, 0.66), vec3(0.97, 0.95, 0.9), q.y);
          } else {
            diffuseColor.rgb *= mix(0.5, 1.1, vH * 1.3);
          }`
          : `#include <color_fragment>
          diffuseColor.rgb *= mix(0.55, 1.05, smoothstep(0.1, 0.9, vH * 2.2));`
      );
  };
  m.customProgramCacheKey = () => `wild-${plumes}-${amp}`;
  return m;
}

export class WildBank {
  constructor(scene, quality = 'high') {
    const k = WILD[quality] ?? 1;
    const rng = new RNG(4242);
    const kans = [];
    const shrubs = [];
    // patches across the far bank and on the wild banks past the ghats; each a drift of clumps
    const tryPatch = (x, z, n, spread) => {
      for (let i = 0; i < n; i++) {
        const px = x + rng.range(-spread, spread);
        const pz = z + rng.range(-spread, spread);
        const { v, seg } = bankCoords(px, pz);
        if (v < 0.5 || (seg && v < PROFILE_LEN + 1.5)) continue;
        const y = groundHeight(px, pz);
        if (y - WATER_LEVEL < 0.5) continue;
        if (Math.hypot(px - FORT.x, pz - FORT.z) < FORT.r + 8) continue;
        kans.push({ x: px, y, z: pz, s: rng.range(0.95, 1.55), r: rng.next() * 6.28, tone: rng.next() });
      }
    };
    const fb = (x) => FAR_BANK_V + Math.sin(x * 0.006) * 22 + Math.sin(x * 0.017 + 1.3) * 7;
    const farPatches = Math.round(260 * k);
    for (let i = 0; i < farPatches; i++) {
      const x = rng.range(-600, 600);
      const p = frameToWorld(frameAtX(x), 0, fb(x) + rng.range(6, 150));
      if (fbm(p.x * 0.02, p.z * 0.02, 3) < 0.44) continue; // (in drifts, with open sand between)
      tryPatch(p.x, p.z, 10 + Math.floor(rng.next() * 16), rng.range(4, 11));
    }
    const nearPatches = Math.round(90 * k);
    for (let i = 0; i < nearPatches; i++) {
      const left = rng.next() < 0.5;
      const x = left ? rng.range(GHAT_X_MIN - 320, GHAT_X_MIN - 8) : rng.range(GHAT_X_MAX + 8, GHAT_X_MAX + 320);
      const p = frameToWorld(frameAtX(x), 0, rng.range(2, PROFILE_LEN + 4));
      tryPatch(p.x, p.z, 4 + Math.floor(rng.next() * 8), rng.range(2, 6));
    }
    // scrub among them and on its own
    const shrubN = Math.round(420 * k);
    for (let i = 0; i < shrubN * 3 && shrubs.length < shrubN; i++) {
      const far = rng.next() < 0.75;
      const x = far ? rng.range(-600, 600) : rng.next() < 0.5 ? rng.range(GHAT_X_MIN - 320, GHAT_X_MIN - 8) : rng.range(GHAT_X_MAX + 8, GHAT_X_MAX + 320);
      const p = frameToWorld(frameAtX(x), 0, far ? fb(x) + rng.range(10, 170) : rng.range(1, PROFILE_LEN + 3));
      const { v, seg } = bankCoords(p.x, p.z);
      if (v < 0.5 || (seg && v < PROFILE_LEN + 1.5)) continue;
      const y = groundHeight(p.x, p.z);
      if (y - WATER_LEVEL < 0.7 || Math.hypot(p.x - FORT.x, p.z - FORT.z) < FORT.r + 8) continue;
      shrubs.push({ x: p.x, y, z: p.z, s: rng.range(0.5, 1.5), r: rng.next() * 6.28, tone: rng.next() });
    }
    this.kans = this.build(scene, kans, kansGeometry(), windMaterial({ roughness: 0.8, side: THREE.DoubleSide }, { amp: 0.45, plumes: true }), ['#6f7a3c', '#87884a', '#9a8f52', '#7c8a44'], 'kans', 1);
    this.shrubs = this.build(scene, shrubs, shrubGeometry(), windMaterial({ roughness: 0.9, side: THREE.DoubleSide }, { amp: 0.06, plumes: true }), ['#3e5322', '#4f6128', '#626a2c', '#47592a'], 'scrub', 0.9);
  }

  build(scene, list, geo, mat, tones, name, ys) {
    if (!list.length) return null;
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    const UP = new THREE.Vector3(0, 1, 0);
    list.forEach((t, i) => {
      q.setFromAxisAngle(UP, t.r);
      m.compose(new THREE.Vector3(t.x, t.y - 0.05, t.z), q, new THREE.Vector3(t.s, t.s * ys * (0.85 + t.tone * 0.3), t.s));
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
