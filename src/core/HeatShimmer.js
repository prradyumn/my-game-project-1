import * as THREE from 'three';
import { Effect, EffectAttribute } from 'postprocessing';

// Hot air over the pyres and the chai stoves: a ripple in the picture above each fire, only
// for what lies behind the column (a person standing in front of the fire stays sharp).
// Screen-space: up to MAX sources are projected each frame; the pass switches itself off when
// none is in view.

const MAX = 6;

const fragment = /* glsl */ `
uniform vec4 uSrc[${MAX}]; // xy: base on screen (uv), z: column height (uv), w: distance (m)
uniform float uAmt[${MAX}];
uniform int uCount;

void mainUv(inout vec2 uv) {
  vec2 off = vec2(0.0);
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= uCount) break;
    vec4 s = uSrc[i];
    vec2 d = uv - s.xy;
    d.x *= aspect;
    float t = d.y / s.z; // 0 at the fire, 1 at the top of the column
    if (t < -0.08 || t > 1.0) continue;
    float w = s.z * 0.16 * (1.0 + t * 0.9);
    float m = (1.0 - smoothstep(w * 0.4, w, abs(d.x))) * smoothstep(-0.08, 0.12, t) * (1.0 - smoothstep(0.5, 1.0, t));
    if (m <= 0.0) continue;
    float vz = -getViewZ(readDepth(uv));
    m *= smoothstep(s.w - 1.2, s.w + 0.3, vz) * uAmt[i];
    vec2 q = d / s.z * 22.0;
    float k = time * 6.0;
    off += m * vec2(sin(q.y * 1.7 - k + sin(q.x * 2.3 + k * 0.4)), 0.6 * sin(q.x * 2.1 + q.y * 0.8 - k * 0.8)) * s.z * 0.014;
  }
  uv += off;
}
`;

const _p = new THREE.Vector3();

export class HeatShimmerEffect extends Effect {
  constructor() {
    super('HeatShimmerEffect', fragment, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map([
        ['uSrc', new THREE.Uniform(Array.from({ length: MAX }, () => new THREE.Vector4()))],
        ['uAmt', new THREE.Uniform(new Array(MAX).fill(0))],
        ['uCount', new THREE.Uniform(0)],
      ]),
    });
  }

  /**
   * sources: [{ x, y, z, h, amt }] (fire base in world, column height in m, strength 0..1).
   * Returns how many are on screen (0: the pass can sleep).
   */
  updateSources(camera, sources) {
    const src = this.uniforms.get('uSrc').value;
    const amt = this.uniforms.get('uAmt').value;
    const near = [];
    for (const s of sources) {
      if (s.amt <= 0.01) continue;
      const d = camera.position.distanceTo(_p.set(s.x, s.y, s.z));
      if (d > 45 || d < 0.8) continue;
      near.push({ s, d });
    }
    near.sort((a, b) => a.d - b.d);
    let n = 0;
    for (const { s, d } of near) {
      if (n >= MAX) break;
      _p.set(s.x, s.y, s.z).project(camera);
      if (_p.z > 1 || Math.abs(_p.x) > 1.3 || _p.y > 1.2 || _p.y < -1.6) continue;
      const bx = _p.x * 0.5 + 0.5;
      const by = _p.y * 0.5 + 0.5;
      _p.set(s.x, s.y + s.h, s.z).project(camera);
      const h = _p.y * 0.5 + 0.5 - by;
      if (h < 0.01) continue;
      src[n].set(bx, by, h, d);
      amt[n] = s.amt * (1 - THREE.MathUtils.smoothstep(d, 30, 45));
      n++;
    }
    this.uniforms.get('uCount').value = n;
    return n;
  }
}
