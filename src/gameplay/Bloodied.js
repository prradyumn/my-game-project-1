import * as THREE from 'three';
import { BLOOD } from '../world/Blood.js';

// Prady after a fight: blood (his own, red) and the Asuras' ichor (near black) on his skin and his
// dhoti where it struck him, and on the talwar's blade. Each stain is fixed to his body (a point
// in the skin's rest pose, found through the nearest bone, so it rides every pose), wet and
// glossy at first, drying dark and matte. The Ganga washes it: whatever part of him is under the
// surface rinses clean in a moment, a red cloud drifting off on the current; the monsoon rinses it
// slowly. Two shader layers (his skin, the blade); up to 24 stains.

const MAX = 24;
const BONES = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'RightUpLeg', 'RightLeg'];
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _m = new THREE.Matrix4();

export class Bloodied {
  /** body: Prady's skinned mesh; sword: the talwar mesh; bladeLen: its blade's length (m). */
  constructor(body, sword, bladeLen = 0.8) {
    this.body = body;
    this.stains = [];
    this.gore = 'full';
    this.u = {
      uStain: { value: Array.from({ length: MAX }, () => new THREE.Vector4(0, 0, 0, 0)) }, // xyz (rest pose), radius
      uStainB: { value: Array.from({ length: MAX }, () => new THREE.Vector4(0, 0, 0, 0)) }, // amount, wet, kind
      uStainN: { value: 0 },
      uBloodUnit: { value: 1 },
      uRedWet: { value: BLOOD.red.wet },
      uRedDry: { value: BLOOD.red.dry },
      uIchWet: { value: BLOOD.ichor.wet },
      uIchDry: { value: BLOOD.ichor.dry },
    };
    this.bones = [];
    if (body?.skeleton) {
      const sk = body.skeleton;
      for (const n of BONES) {
        const i = sk.bones.findIndex((b) => b.name === n || b.name.endsWith(`:${n}`) || b.name.endsWith(`rig${n}`) || b.name.endsWith(n));
        if (i >= 0 && !this.bones.some((x) => x.i === i)) this.bones.push({ i, bone: sk.bones[i], name: n });
      }
      // metres -> rest-pose units (the skin's own scale)
      const hips = this.bones.find((b) => b.name === 'Hips');
      const head = this.bones.find((b) => b.name === 'Head');
      if (hips && head) {
        body.updateMatrixWorld(true);
        const a = this.toRest(hips, hips.bone.getWorldPosition(new THREE.Vector3()), new THREE.Vector3());
        const b = this.toRest(head, head.bone.getWorldPosition(new THREE.Vector3()), new THREE.Vector3());
        const world = hips.bone.getWorldPosition(_p).distanceTo(head.bone.getWorldPosition(_q));
        this.u.uBloodUnit.value = world > 0.05 ? a.distanceTo(b) / world : 1;
      }
      this.skin(body.material);
    }
    // the blade
    this.blade = { amount: 0, wet: 0 };
    this.bu = { uBlade: { value: 0 }, uBladeWet: { value: 0 }, uBladeLen: { value: bladeLen }, uRedWet: this.u.uRedWet, uRedDry: this.u.uRedDry, uIchWet: this.u.uIchWet };
    if (sword?.material) this.steel(sword.material);
  }

  /**
   * A world point on him, into the rest pose of his skin through `B` (its nearest bone): the
   * inverse of three's skinning for one bone (world = M * bindMatrixInverse * boneWorld *
   * boneInverse * bindMatrix * rest).
   */
  toRest(B, p, out) {
    const mesh = this.body;
    // (composed, then inverted once: the bones carry a scale of ~1e-4, and inverting each matrix
    // on its own threw the answer off by orders of magnitude)
    _m.copy(mesh.matrixWorld).multiply(mesh.bindMatrixInverse).multiply(B.bone.matrixWorld).multiply(mesh.skeleton.boneInverses[B.i]).multiply(mesh.bindMatrix);
    return out.copy(p).applyMatrix4(_m.invert());
  }

  /** Blood reached him at `p` (world): kind 'red' | 'ichor', amt (0..1). */
  hit(p, kind = 'ichor', amt = 0.3) {
    if (this.gore === 'off' || !this.bones.length) return;
    let best = null;
    let bd = Infinity;
    for (const B of this.bones) {
      const d = B.bone.getWorldPosition(_p).distanceToSquared(p);
      if (d < bd) (bd = d), (best = B);
    }
    const rest = this.toRest(best, p, new THREE.Vector3());
    const unit = this.u.uBloodUnit.value;
    const k = kind === 'ichor' ? 1 : 0;
    // onto a stain already there (it grows), or a new one
    for (const s of this.stains) {
      if (s.kind === k && s.pos.distanceTo(rest) < s.r * 0.8) {
        s.amount = Math.min(1, s.amount + amt * 0.5);
        s.r = Math.min(0.2 * unit, s.r * 1.08);
        s.wet = 1;
        return;
      }
    }
    const cap = this.gore === 'stylised' ? 8 : MAX;
    if (this.stains.length >= cap) {
      this.stains.sort((a, b) => a.amount - b.amount);
      this.stains.shift();
    }
    this.stains.push({ pos: rest, r: (0.07 + Math.random() * 0.08) * unit, amount: Math.min(1, amt + 0.25), wet: 1, kind: k, bone: best.bone });
  }

  /** A blow on the blade (each cut that bites an Asura). */
  bladeHit(kind = 'ichor') {
    if (this.gore === 'off') return;
    this.blade.amount = Math.min(1, this.blade.amount + 0.18);
    this.blade.wet = 1;
    this.blade.kind = kind;
  }

  /** water(x, z): the river's surface height; rain 0..1; onRinse(p): a cloud in the water. */
  update(dt, { water, rain = 0, onRinse, hand } = {}) {
    if (this.gore === 'off' && this.stains.length) this.stains.length = 0;
    for (let i = this.stains.length - 1; i >= 0; i--) {
      const s = this.stains[i];
      s.wet = Math.max(0, s.wet - dt / 55);
      s.bone.getWorldPosition(_p);
      const under = water && _p.y < water(_p.x, _p.z) - 0.02;
      if (under) {
        s.amount -= dt * 1.1;
        if (Math.random() < dt * 6) onRinse?.(_p, s.kind);
      }
      if (rain > 0.1) s.amount -= dt * 0.012 * rain;
      if (s.amount <= 0.02) this.stains.splice(i, 1);
    }
    const n = this.stains.length;
    const A = this.u.uStain.value;
    const B = this.u.uStainB.value;
    for (let i = 0; i < MAX; i++) {
      const s = this.stains[i];
      if (s) {
        A[i].set(s.pos.x, s.pos.y, s.pos.z, s.r);
        B[i].set(s.amount, s.wet, s.kind, 0);
      } else B[i].set(0, 0, 0, 0);
    }
    this.u.uStainN.value = n;
    // the blade: dries, and rinses when his sword hand is in the river
    const bl = this.blade;
    bl.wet = Math.max(0, bl.wet - dt / 40);
    if (hand && water && hand.y < water(hand.x, hand.z)) bl.amount = Math.max(0, bl.amount - dt * 1.5);
    if (rain > 0.1) bl.amount = Math.max(0, bl.amount - dt * 0.02 * rain);
    this.bu.uBlade.value = this.gore === 'off' ? 0 : bl.amount * (bl.kind === 'red' ? -1 : 1);
    this.bu.uBladeWet.value = bl.wet;
  }

  clear() {
    this.stains.length = 0;
    this.blade.amount = 0;
  }

  skin(material) {
    const mats = Array.isArray(material) ? material : [material];
    for (const m of mats) {
      const prev = m.onBeforeCompile;
      const prevKey = m.customProgramCacheKey;
      m.onBeforeCompile = (shader, r) => {
        prev?.call(m, shader, r);
        Object.assign(shader.uniforms, this.u);
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vBloodRest;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBloodRest = position;');
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>
varying vec3 vBloodRest;
uniform vec4 uStain[${MAX}]; uniform vec4 uStainB[${MAX}]; uniform int uStainN; uniform float uBloodUnit;
uniform vec3 uRedWet; uniform vec3 uRedDry; uniform vec3 uIchWet; uniform vec3 uIchDry;
float bH(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float bN(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(bH(i), bH(i + vec3(1,0,0)), f.x), mix(bH(i + vec3(0,1,0)), bH(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(bH(i + vec3(0,0,1)), bH(i + vec3(1,0,1)), f.x), mix(bH(i + vec3(0,1,1)), bH(i + vec3(1,1,1)), f.x), f.y), f.z); }
float gBloodM = 0.0; float gBloodWet = 0.0; vec3 gBloodCol = vec3(0.0); float gBloodEmber = 0.0;`
          )
          .replace(
            '#include <map_fragment>',
            `#include <map_fragment>
  {
    vec3 q = vBloodRest / uBloodUnit;
    float ragged = bN(q * 38.0) * 0.6 + bN(q * 90.0) * 0.4;
    float wsum = 0.0;
    for (int i = 0; i < ${MAX}; i++) {
      if (i >= uStainN) break;
      vec4 S = uStain[i]; vec4 T = uStainB[i];
      float d = distance(vBloodRest, S.xyz) / max(1e-4, S.w);
      // a ragged splash: solid in the middle, broken toward its edge, drips running down
      float m = smoothstep(1.0, 0.45, d + (ragged - 0.5) * 0.9) * T.x;
      if (m < 0.001) continue;
      vec3 c = T.z > 0.5 ? mix(uIchDry, uIchWet, T.y) : mix(uRedDry, uRedWet, T.y);
      gBloodCol += c * m; gBloodWet += T.y * m; wsum += m;
      // fresh ichor carries its embers: specks that glow, then cool as it dries
      if (T.z > 0.5) gBloodEmber += m * step(0.86, bN(q * 140.0 + float(i) * 3.1)) * T.y * T.y * T.y;
      gBloodM = max(gBloodM, m);
    }
    if (wsum > 0.0) { gBloodCol /= wsum; gBloodWet /= wsum; }
    gBloodM = clamp(gBloodM * 1.15, 0.0, 0.95);
    diffuseColor.rgb = mix(diffuseColor.rgb, gBloodCol, gBloodM);
  }`
          )
          .replace(
            '#include <roughnessmap_fragment>',
            `#include <roughnessmap_fragment>
  roughnessFactor = mix(roughnessFactor, mix(0.72, 0.16, gBloodWet), gBloodM);`
          )
          .replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
  totalEmissiveRadiance += vec3(1.6, 0.42, 0.08) * min(1.0, gBloodEmber);`
          );
      };
      m.customProgramCacheKey = () => `${prevKey ? prevKey.call(m) : ''}-blood`;
      m.needsUpdate = true;
    }
  }

  steel(material) {
    const prev = material.onBeforeCompile;
    const prevKey = material.customProgramCacheKey;
    material.onBeforeCompile = (shader, r) => {
      prev?.call(material, shader, r);
      Object.assign(shader.uniforms, this.bu);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vBladeP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBladeP = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vBladeP; uniform float uBlade; uniform float uBladeWet; uniform float uBladeLen;
uniform vec3 uRedWet; uniform vec3 uRedDry; uniform vec3 uIchWet;
float gBlade = 0.0;
float sH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
  {
    float amt = abs(uBlade);
    // from the tip down the edge, ragged (the steel above the hilt only)
    float along = clamp(vBladeP.y / uBladeLen, 0.0, 1.0);
    float reach = 1.0 - amt * 0.85;
    float n = sH(floor(vBladeP.yz * vec2(90.0, 300.0)));
    gBlade = step(0.03, vBladeP.y) * smoothstep(reach - 0.05, reach + 0.08, along + (n - 0.5) * 0.12) * smoothstep(0.0, 0.15, amt);
    vec3 c = uBlade < 0.0 ? mix(uRedDry, uRedWet, uBladeWet) : uIchWet;
    diffuseColor.rgb = mix(diffuseColor.rgb, c, gBlade * 0.9);
  }`
        )
        .replace(
          '#include <metalnessmap_fragment>',
          `#include <metalnessmap_fragment>
  metalnessFactor = mix(metalnessFactor, 0.0, gBlade);`
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
  roughnessFactor = mix(roughnessFactor, mix(0.9, 0.6, uBladeWet), gBlade);`
        );
    };
    material.customProgramCacheKey = () => `${prevKey ? prevKey.call(material) : ''}-bladeblood`;
    material.needsUpdate = true;
  }
}
