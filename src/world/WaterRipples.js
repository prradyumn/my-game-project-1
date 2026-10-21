import * as THREE from 'three';

// The river's own ripples round Prady: a small height field (the wave equation on the GPU) that
// what touches the water disturbs (a wading stride, a swimmer's stroke, an oar, a splash, a boat's
// bow) and that spreads, interferes and turns back off the steps and the banks (where the river
// bed stands above the water there is no water to carry it). Water.js reads its height for the
// surface normal. 256² texels over 32 m, stepped at 24 Hz (waves run ~2 m/s, as short ripples do),
// following him, the field shifted a whole texel at a time so nothing smears.

const N = 256;
const SIZE = 32;
const HZ = 24;
const MAX_DROPS = 16;

const VS = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const FS = /* glsl */ `
uniform sampler2D uPrev;
uniform vec2 uShift;
uniform vec2 uCenter;
uniform float uSize;
uniform float uTexel;
uniform sampler2D uHeight;
uniform vec4 uBounds;
uniform float uLevel;
uniform vec4 uDrops[${MAX_DROPS}];
uniform int uCount;
varying vec2 vUv;
vec2 S(vec2 uv) {
  uv += uShift;
  return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec2(0.0) : texture2D(uPrev, uv).rg;
}
void main() {
  vec2 c = S(vUv); // r: the height now, g: a step ago
  float l = S(vUv - vec2(uTexel, 0.0)).r;
  float r = S(vUv + vec2(uTexel, 0.0)).r;
  float d = S(vUv - vec2(0.0, uTexel)).r;
  float u = S(vUv + vec2(0.0, uTexel)).r;
  // h' = 2h - h0 + c²(l + r + d + u - 4h), c² = 0.5; damped
  float h = ((l + r + d + u) * 0.5 - c.g) * 0.982;
  vec2 w = uCenter + (vUv - 0.5) * uSize;
  for (int i = 0; i < ${MAX_DROPS}; i++) {
    if (i >= uCount) break;
    vec2 q = w - uDrops[i].xy;
    h += uDrops[i].w * exp(-dot(q, q) / (uDrops[i].z * uDrops[i].z));
  }
  // the steps and the banks: no water, no wave (the ripples turn back off them)
  float g = texture2D(uHeight, (w - uBounds.xy) / uBounds.zw).r;
  if (g > uLevel - 0.03) h = 0.0;
  gl_FragColor = vec4(clamp(h, -0.4, 0.4), c.r, 0.0, 1.0);
}`;

export class WaterRipples {
  constructor(renderer, heightTex, bounds, level) {
    this.renderer = renderer;
    const opts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping };
    this.rts = [new THREE.WebGLRenderTarget(N, N, opts), new THREE.WebGLRenderTarget(N, N, opts)];
    this.cur = 0;
    this.drops = [];
    this.dropVecs = Array.from({ length: MAX_DROPS }, () => new THREE.Vector4());
    this.center = new THREE.Vector2(0, 0);
    this.size = SIZE;
    this.texel = 1 / N;
    this.acc = 0;
    this.cleared = false;
    this.uniforms = {
      uPrev: { value: null },
      uShift: { value: new THREE.Vector2() },
      uCenter: { value: new THREE.Vector2() },
      uSize: { value: SIZE },
      uTexel: { value: 1 / N },
      uHeight: { value: heightTex },
      uBounds: { value: new THREE.Vector4(bounds.x0, bounds.z0, bounds.w, bounds.h) },
      uLevel: { value: level },
      uDrops: { value: this.dropVecs },
      uCount: { value: 0 },
    };
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VS, fragmentShader: FS, depthTest: false, depthWrite: false }));
    this.quad.frustumCulled = false;
    this.simScene = new THREE.Scene();
    this.simScene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.active = false; // (nothing stirred lately: the field is flat, the steps skipped)
    this.quiet = 99;
  }

  get texture() {
    return this.rts[this.cur].texture;
  }

  /** Something touched the water at (x, z): a bump of `strength` metres, `radius` metres wide. */
  disturb(x, z, radius, strength) {
    const half = SIZE * 0.5;
    if (Math.abs(x - this.center.x) > half || Math.abs(z - this.center.y) > half) return;
    const D = this.drops;
    if (D.length >= MAX_DROPS) {
      // full: the weakest gives way
      let k = 0;
      for (let i = 1; i < D.length; i++) if (Math.abs(D[i][3]) < Math.abs(D[k][3])) k = i;
      if (Math.abs(D[k][3]) >= Math.abs(strength)) return;
      D.splice(k, 1);
    }
    D.push([x, z, Math.max(0.12, radius), strength]);
    this.quiet = 0;
  }

  /** Step the field (dt real seconds), centred on focus {x, z}. */
  update(dt, focus) {
    const r = this.renderer;
    this.quiet += dt;
    // (eight seconds after the last stir it has died away: cleared, and no steps until the next)
    const was = this.active;
    this.active = this.quiet < 8;
    if (was && !this.active) this.cleared = false;
    if (!this.cleared) {
      const prev = r.getRenderTarget();
      for (const rt of this.rts) {
        r.setRenderTarget(rt);
        r.setClearColor(0x000000, 0);
        r.clear(true, false, false);
      }
      r.setRenderTarget(prev);
      this.cleared = true;
    }
    if (!this.active) {
      this.center.set(Math.round(focus.x / (SIZE / N)) * (SIZE / N), Math.round(focus.z / (SIZE / N)) * (SIZE / N));
      return;
    }
    this.acc = Math.min(this.acc + dt, 3 / HZ);
    const U = this.uniforms;
    const prevTarget = r.getRenderTarget();
    const prevAuto = r.autoClear;
    r.autoClear = false;
    while (this.acc >= 1 / HZ) {
      this.acc -= 1 / HZ;
      // follow him a whole texel at a time
      const cell = SIZE / N;
      const nx = Math.round(focus.x / cell) * cell;
      const nz = Math.round(focus.z / cell) * cell;
      U.uShift.value.set((nx - this.center.x) / SIZE, (nz - this.center.y) / SIZE);
      this.center.set(nx, nz);
      U.uCenter.value.copy(this.center);
      U.uCount.value = this.drops.length;
      this.drops.forEach((d, i) => this.dropVecs[i].set(d[0], d[1], d[2], d[3]));
      this.drops.length = 0;
      U.uPrev.value = this.rts[this.cur].texture;
      this.cur = 1 - this.cur;
      r.setRenderTarget(this.rts[this.cur]);
      r.render(this.simScene, this.cam);
    }
    r.autoClear = prevAuto;
    r.setRenderTarget(prevTarget);
  }
}
