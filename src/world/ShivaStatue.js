import * as THREE from 'three';
import { WATER_LEVEL } from '../config.js';
import { MeshBuilder } from '../utils/MeshBuilder.js';
import { frameAtX, frameToWorld, groundHeight } from './WorldLayout.js';
import { WORLD_UNIFORMS, makeWaterAware, surfaceMaterial } from './materials.js';
import { addStoneDetail } from './StoneDetail.js';
import { addRim } from './RimLight.js';

// Shiva in meditation over the river, past Assi where the ghats end: a colossal seated statue
// (Genex: generated from a reference image, baked to a 3 MB game copy) on a stepped plinth of
// the ghats' own Chunar stone built out into the shallows, the Ganga lapping its lowest course
// and mirroring him. A causeway runs to it from the bank; its steps climb from tier to tier to
// his lotus seat. He faces downriver, toward the ghats and the morning sun over the far bank.

const AT_X = -446; // along the bank: just past Assi (the ghats end at -420)
const AT_V = 88; // out from the bank: an island in the river, clear of Assi's end wall
const HEIGHT = 21; // metres, the statue and his lotus seat
const STONE = '#d9c6a2';

export class ShivaStatue {
  constructor({ scene, physics, textures, gltf, nandi }) {
    const f = frameAtX(AT_X);
    const c = frameToWorld(f, 0, AT_V);
    this.center = c;
    // the plinth's frame: +z out of it toward the bank (where the causeway and steps are)
    const yaw = Math.atan2(-f.N.x, -f.N.z);
    this.yaw = yaw;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const P = (lx, lz) => ({ x: c.x + lx * cy + lz * sy, z: c.z - lx * sy + lz * cy });
    const bed = Math.min(groundHeight(c.x, c.z), WATER_LEVEL - 1.5) - 1.5;

    // ---- the plinth: three courses, steps up the bank side, a causeway to the shore
    const mb = new MeshBuilder();
    const col = new THREE.Color(STONE);
    const tiers = [
      { w: 24, top: WATER_LEVEL + 0.7 },
      { w: 18.5, top: WATER_LEVEL + 2.3 },
      { w: 14.5, top: WATER_LEVEL + 3.7 },
    ];
    const boxes = [];
    let y0 = bed;
    tiers.forEach((t, i) => {
      const h = t.top - y0;
      mb.box(c.x, y0 + h / 2, c.z, t.w, h, t.w, yaw, col.clone().multiplyScalar(1 - i * 0.04), { tile: 2.5, grime: 0.35 });
      boxes.push([c.x, y0 + h / 2, c.z, t.w, h, t.w]);
      // a moulded lip round each course
      mb.box(c.x, t.top - 0.08, c.z, t.w + 0.5, 0.16, t.w + 0.5, yaw, col, { tile: 2.5 });
      y0 = t.top;
    });
    // steps between the courses, on the bank side
    for (let i = 0; i < tiers.length - 1; i++) {
      const lo = tiers[i];
      const hi = tiers[i + 1];
      const n = Math.max(2, Math.round((hi.top - lo.top) / 0.28));
      const rise = (hi.top - lo.top) / n;
      const run = (lo.w - hi.w) / 2 / n;
      for (let k = 0; k < n; k++) {
        const lz = hi.w / 2 + (n - k - 0.5) * run;
        const p = P(0, lz);
        const top = lo.top + rise * (k + 1);
        mb.box(p.x, (lo.top + top) / 2, p.z, 6, top - lo.top, run, yaw, col, { tile: 2 });
        boxes.push([p.x, (lo.top + top) / 2, p.z, 6, top - lo.top, run]);
      }
    }
    // the causeway to the shore: from the plinth's foot to where the bank rises above it
    let far = tiers[0].w / 2;
    for (let lz = tiers[0].w / 2; lz < 160; lz += 1) {
      const p = P(0, lz);
      far = lz;
      if (groundHeight(p.x, p.z) > tiers[0].top + 0.2) break;
    }
    const len = far - tiers[0].w / 2 + 2;
    const cm = P(0, tiers[0].w / 2 + len / 2 - 1);
    mb.box(cm.x, (bed + tiers[0].top) / 2, cm.z, 5, tiers[0].top - bed, len, yaw, col.clone().multiplyScalar(0.96), { tile: 2.5, grime: 0.4 });
    boxes.push([cm.x, (bed + tiers[0].top) / 2, cm.z, 5, tiers[0].top - bed, len]);
    const stoneMat = surfaceMaterial(textures.stone, { normalScale: 1.0 });
    addStoneDetail(stoneMat, { moss: true });
    this.plinth = new THREE.Mesh(mb.build(), stoneMat);
    this.plinth.name = 'shiva-plinth';
    this.plinth.castShadow = true;
    this.plinth.receiveShadow = true;
    scene.add(this.plinth);
    for (const b of boxes) physics?.addBox(b[0], b[1], b[2], b[3], b[4], b[5], yaw);

    // ---- Shiva, and Nandi on the causeway gazing at his lord (as before every Shiva shrine):
    // each placed from whichever copy is in, the light stand-in the game loads with or the full
    // model streamed in as Prady comes near (setDetail). (Both models face +X.)
    const top = tiers[tiers.length - 1].top;
    const look = frameToWorld(frameAtX(-330), 0, 12); // (downriver, at the ghats: Assi and Tulsi)
    const nat = P(0, tiers[0].w / 2 + 7);
    this.scene = scene;
    this.slots = {
      shiva: { pos: c, base: top, size: HEIGHT, by: 'y', yaw: Math.atan2(look.x - c.x, look.z - c.z) - Math.PI / 2, light: [top, HEIGHT], rim: 0.45 },
      nandi: { pos: nat, base: tiers[0].top, size: 3.4, by: 'x', yaw: Math.atan2(c.x - nat.x, c.z - nat.z) - Math.PI / 2, light: [tiers[0].top, 4], rim: 0.4 },
    };
    this.low = {};
    this.full = {};
    if (gltf?.scene) {
      const { root, dims } = this.place('shiva', gltf);
      this.low.shiva = root;
      this.statue = root;
      // solid: his lotus seat, his body (addCylinder takes the bottom)
      const r = dims.x / 2;
      physics?.addCylinder(c.x, top, c.z, r * 0.92, HEIGHT * 0.34);
      physics?.addCylinder(c.x, top + HEIGHT * 0.3, c.z, r * 0.55, HEIGHT * 0.6);
    }
    if (nandi?.scene) {
      const { root, dims } = this.place('nandi', nandi);
      this.low.nandi = root;
      physics?.addBox(nat.x, tiers[0].top + dims.y / 2, nat.z, dims.x, dims.y, dims.z, this.slots.nandi.yaw);
    }

    // ---- the lamps: oil lamps along the lip of every course, lit at dusk
    const lamps = [];
    tiers.forEach((t, i) => {
      const n = Math.round(t.w * 4 * 1.1);
      for (let k = 0; k < n; k++) {
        const e = (k / n) * 4;
        const side = Math.floor(e);
        const u = (e - side - 0.5) * t.w;
        const h = t.w / 2 + 0.05;
        const [lx, lz] = [[u, h], [h, -u], [-u, -h], [-h, u]][side];
        // (the steps' gap on the bank side left dark)
        if (side === 0 && Math.abs(u) < 3.4 && i < tiers.length - 1) continue;
        const q = P(lx, lz);
        lamps.push(q.x, t.top + 0.06, q.z, Math.random());
      }
    });
    this.lamps = lampPoints(lamps);
    scene.add(this.lamps);
  }

  /** Fit a copy of a model into its slot (scaled by one dimension, turned, on its base). */
  place(name, gltf) {
    const S = this.slots[name];
    const root = gltf.scene;
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const s = S.size / size[S.by];
    root.scale.setScalar(s);
    root.rotation.y = S.yaw;
    root.position.set(S.pos.x, S.base - box.min.y * s, S.pos.z);
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = true;
      const m = o.material;
      // carved stone: no metal (the generated ORM map says otherwise), the sky's light kept low
      m.metalness = 0;
      m.metalnessMap = null;
      m.envMapIntensity = 0.55;
      makeWaterAware(m, { puddles: false, caustics: false });
      addRim(m, S.rim);
      floodlit(m, S.light[0], S.light[1]);
      m.needsUpdate = true;
    });
    root.name = name;
    this.scene.add(root);
    return { root, dims: size.multiplyScalar(s) };
  }

  /** Streaming: the full model in (gltf) or out (null); the stand-in shows while it is out. */
  setDetail(name, gltf) {
    const old = this.full[name];
    if (old) this.scene.remove(old);
    this.full[name] = gltf ? this.place(name, gltf).root : null;
    if (this.low[name]) this.low[name].visible = !gltf;
  }
}

/** Night: warm light thrown up the statue from lamps at its feet, fading with height. */
function floodlit(m, base, height) {
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.uniforms.uNightLight = WORLD_UNIFORMS.uNightLight;
    // (uNightLight is declared already: makeWaterAware's common block)
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float hk = clamp((vWorldPosW.y - ${base.toFixed(2)}) / ${height.toFixed(1)}, 0.0, 1.0);
          vec3 wn = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
          float up = 0.45 + 0.55 * clamp(-wn.y * 0.6 + length(wn.xz) * 0.6, 0.0, 1.0); // (faces the lamps below)
          totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.62, 0.32) * uNightLight * 0.55 * up * (0.25 + 0.75 * pow(1.0 - hk, 1.6));
        }`
      );
  };
  m.customProgramCacheKey = () => `${prevKey ? prevKey.call(m) : ''}-floodlit`;
}

/** The plinth's lamps: one Points draw, a flame and a glow each, only at night. */
function lampPoints(arr) {
  const n = arr.length / 4;
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos.set([arr[i * 4], arr[i * 4 + 1], arr[i * 4 + 2]], i * 3);
    seed[i] = arr[i * 4 + 3];
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: WORLD_UNIFORMS.uTime, uNightLight: WORLD_UNIFORMS.uNightLight },
    vertexShader: /* glsl */ `
      attribute float aSeed; uniform float uTime; uniform float uNightLight; varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position + vec3(0.0, 0.12, 0.0), 1.0);
        gl_Position = projectionMatrix * mv;
        float fl = 0.85 + 0.1 * sin(uTime * 7.0 + aSeed * 40.0) + 0.05 * sin(uTime * 17.0 + aSeed * 9.0);
        vA = clamp(uNightLight * 1.5, 0.0, 1.0) * fl;
        gl_PointSize = vA > 0.01 ? clamp(0.5 * 900.0 / max(-mv.z, 1.0), 2.0, 64.0) : 0.0;
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        vec2 c = gl_PointCoord * 2.0 - 1.0;
        float core = exp(-dot(c * vec2(2.2, 1.2), c * vec2(2.2, 1.2)) * 3.0);
        float halo = exp(-dot(c, c) * 2.2) * 0.35;
        float a = (core + halo) * vA;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vec3(1.0, 0.66, 0.28) * (core * 3.0 + halo), a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, mat);
  pts.name = 'shiva-lamps';
  pts.frustumCulled = false;
  pts.renderOrder = 5;
  return pts;
}
