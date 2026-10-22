import * as THREE from 'three';
import { FAR_BANK_V, GHAT_TOP } from '../config.js';
import { frameAtX, frameToWorld, ghatById, ghatToWorld, groundHeight } from './WorldLayout.js';
import { WORLD_UNIFORMS, makeWaterAware } from './materials.js';
import { addRim } from './RimLight.js';

// Sacred peepal trees (Genex model: gnarled roots, red threads round the trunk, its own stone
// platform), the trees a ghat town grows by its river: at the end of Assi, on the wild banks past
// either end of the ghats, across the river on the sand bank. A mesh each (one geometry, one
// material), so the ones out of sight, and out of the shadow's reach, are left out; the canopy
// stirs in the wind (more toward its crown, a gust leans it); each trunk and platform is solid.

const SPOTS = [
  // [kind, ...]: 'ghat' (id, u, v), 'bank' (x, v): v metres from the bank line
  ['ghat', 'assi', 9, 1.4],
  ['bank', -472, 14],
  ['bank', -505, 28],
  ['bank', 438, 10],
  ['bank', 470, 22],
  ['far', -140, 58],
  ['far', 60, 82],
  ['far', 250, 64],
  ['far', 430, 48],
];

/** One copy of the tree (stand-in or full): its geometry in world units, its swaying material. */
function treeKit(gltf) {
  let mesh = null;
  gltf?.scene?.traverse((o) => !mesh && o.isMesh && (mesh = o));
  if (!mesh) return null;
  gltf.scene.updateMatrixWorld(true);
  const geo = mesh.geometry.clone();
  geo.applyMatrix4(mesh.matrixWorld);
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const h0 = bb.max.y - bb.min.y;
  const m = mesh.material.clone();
  m.metalness = 0;
  m.metalnessMap = null;
  m.envMapIntensity = 0.6;
  makeWaterAware(m, { puddles: false, caustics: false });
  addRim(m, 0.3);
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey;
  // (the sway's numbers in the model's own units, carried as uniforms: both copies share a program)
  const own = { uTreeY0: { value: bb.min.y + h0 * 0.35 }, uTreeY1: { value: bb.max.y } };
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    Object.assign(sh.uniforms, own, { uGust: WORLD_UNIFORMS.uGust, uTime: WORLD_UNIFORMS.uTime });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uGust;\nuniform float uTime;\nuniform float uTreeY0;\nuniform float uTreeY1;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 ip = vec3(modelMatrix[3][0], modelMatrix[3][1], modelMatrix[3][2]);
          float k = smoothstep(uTreeY0, uTreeY1, position.y);
          float ph = ip.x * 0.13 + ip.z * 0.07;
          // the crown sways slow, the leaves at its edge flutter
          float sw = sin(uTime * 0.7 + ph) * 0.5 + sin(uTime * 1.9 + ph * 2.0 + position.x * 9.0) * 0.18;
          transformed.x += (sw * 0.012 + uGust * 0.03) * k * k;
          transformed.z += sin(uTime * 1.1 + ph + position.z * 7.0) * 0.008 * k * k;
        }`
      );
  };
  m.customProgramCacheKey = () => `${prevKey ? prevKey.call(m) : ''}-peepal`;
  return { geo, mat: m, bb, h0 };
}

export class SacredTrees {
  constructor({ scene, physics, gltf, quality = 'high' }) {
    this.low = treeKit(gltf);
    if (!this.low) return;
    this.full = null;
    this.near = 190; // m: within this a tree wears the full model (once it is in)
    const spots = quality === 'low' ? SPOTS.slice(0, 5) : SPOTS;
    this.group = new THREE.Group();
    this.group.name = 'peepal-trees';
    this.trees = [];
    const UP = new THREE.Vector3(0, 1, 0);
    spots.forEach((s, i) => {
      let p;
      let y;
      if (s[0] === 'ghat') {
        p = ghatToWorld(ghatById(s[1]), s[2], s[3]);
        y = GHAT_TOP;
      } else {
        p = frameToWorld(frameAtX(s[1]), 0, s[0] === 'far' ? FAR_BANK_V + s[2] : s[2]);
        y = groundHeight(p.x, p.z);
      }
      const H = 12 + ((i * 37) % 6); // metres tall
      const mesh = new THREE.Mesh(this.low.geo, this.low.mat);
      mesh.quaternion.setFromAxisAngle(UP, i * 2.3);
      mesh.castShadow = mesh.receiveShadow = true;
      const tree = { mesh, x: p.x, y, z: p.z, H, kit: null };
      this.wear(tree, this.low);
      this.group.add(mesh);
      this.trees.push(tree);
      // the trunk and the platform (its stones ~45% of the tree's width across)
      const w = (this.low.bb.max.x - this.low.bb.min.x) * (H / this.low.h0);
      physics?.addCylinder(p.x, y - 0.2, p.z, w * 0.4, 0.75);
      physics?.addCylinder(p.x, y, p.z, w * 0.08, H * 0.45);
    });
    scene.add(this.group);
  }

  /** Put a copy of the model on a tree, sized to it. */
  wear(t, kit) {
    if (t.kit === kit) return;
    t.kit = kit;
    const sc = t.H / kit.h0;
    t.mesh.geometry = kit.geo;
    t.mesh.material = kit.mat;
    t.mesh.scale.setScalar(sc);
    t.mesh.position.set(t.x, t.y - kit.bb.min.y * sc - 0.1, t.z);
  }

  /** The nearest tree (the streamer's measure). */
  distance(pos) {
    let d = Infinity;
    for (const t of this.trees || []) d = Math.min(d, Math.hypot(t.x - pos.x, t.z - pos.z));
    return d;
  }

  /** Streaming: the full model in (gltf) or out (null). */
  setDetail(gltf) {
    if (this.full && !gltf) {
      for (const t of this.trees) this.wear(t, this.low);
      this.full.geo.dispose();
      this.full.mat.dispose();
    }
    this.full = gltf ? treeKit(gltf) : null;
    if (!this.full) for (const t of this.trees) this.wear(t, this.low);
  }

  /** Each tree in reach wears the full model, the rest the stand-in (twice a second is plenty). */
  update(pos) {
    if (!this.trees) return;
    for (const t of this.trees) this.wear(t, this.full && Math.hypot(t.x - pos.x, t.z - pos.z) < this.near ? this.full : this.low);
  }
}
