import * as THREE from 'three';
import { ASSET_MANIFEST } from '../core/Assets.js';

// Real-looking fire, all of it in two draw calls.
//
//  flames  an upright billboard per flame (it turns to face the camera but never tilts), shaded
//          by a flame shader: teardrop silhouette eaten away by rising turbulence (fbm noise),
//          a temperature field hottest at the core and base, a blackbody colour ramp
//          (deep red -> orange -> yellow -> white), a blue root on oil lamps, a flickering tip.
//  books   the big fires (pyres, the sacred bowls, torches, aarti lamps): real flame, a CC0
//          flipbook of simulated fire (64 frames, cross-faded), each tongue at its own frame and
//          pace; the little lamps keep the shaded teardrop (a wick's flame is calm).
//  halos   a soft glow billboard around every flame (feeds the bloom).
//  embers  sparks that rise, drift and wink out above the bigger fires.
//
// Flames ignite and die with a short fade. API: add / setLit / setPosition / update.

const flameVert = /* glsl */ `
  attribute vec3 aOrigin;
  attribute vec2 aSize;
  attribute float aSeed;
  attribute float aLit;
  attribute float aKind;
  uniform float uTime;
  varying vec2 vUv;
  varying float vSeed;
  varying float vLit;
  varying float vKind;
  varying float vFlick;
  void main() {
    vUv = uv;
    vSeed = aSeed;
    vLit = aLit;
    vKind = aKind;
    float flick = 0.86 + 0.09 * sin(uTime * 11.0 + aSeed * 40.0) + 0.05 * sin(uTime * 23.0 + aSeed * 13.0);
    vFlick = flick;
    vec3 p;
    if (aKind < 0.5 || aKind > 1.5) {
      // upright billboard: faces the camera around the vertical axis only
      vec3 toCam = cameraPosition - aOrigin;
      vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(1e-5, 0.0, 0.0));
      p = aOrigin + right * position.x * aSize.x + vec3(0.0, (position.y + 0.5) * aSize.y * flick, 0.0);
    } else {
      // halo: full billboard centred a little above the flame base
      vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
      p = aOrigin + vec3(0.0, aSize.y * 0.4, 0.0) + (camRight * position.x + camUp * position.y) * aSize.x * (0.9 + 0.1 * flick);
    }
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
    if (aLit < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // unlit: skip rasterising
  }
`;

const flameFrag = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform float uHalo;
  uniform sampler2D uBook;
  uniform float uBookReady;
  uniform float uBookIntensity;
  varying vec2 vUv;
  varying float vSeed;
  varying float vLit;
  varying float vKind;
  varying float vFlick;

  float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) { return 0.5 * vnoise(p) + 0.3 * vnoise(p * 2.03 + 7.1) + 0.2 * vnoise(p * 4.07 + 3.7); }

  vec3 blackbody(float t) {
    vec3 c = mix(vec3(0.0), vec3(0.55, 0.04, 0.0), smoothstep(0.0, 0.22, t));
    c = mix(c, vec3(1.0, 0.32, 0.03), smoothstep(0.22, 0.45, t));
    c = mix(c, vec3(1.0, 0.68, 0.18), smoothstep(0.45, 0.7, t));
    c = mix(c, vec3(1.0, 0.93, 0.72), smoothstep(0.7, 0.95, t));
    return c;
  }

  void main() {
    if (vKind > 1.5 && uBookReady > 0.5) {
      // flipbook fire: 16 x 4 frames (frame 0 top-left), the next frame cross-faded in
      float fps = 26.0 * (0.8 + fract(vSeed * 7.31) * 0.4);
      float f = uTime * fps + vSeed * 64.0;
      float i0 = mod(floor(f), 64.0);
      float i1 = mod(i0 + 1.0, 64.0);
      vec2 cell = vec2(1.0 / 16.0, 1.0 / 4.0);
      vec2 uv = vec2(fract(vSeed * 3.17) > 0.5 ? vUv.x : 1.0 - vUv.x, vUv.y); // (half of them mirrored)
      vec2 uv0 = (vec2(mod(i0, 16.0), 3.0 - floor(i0 / 16.0)) + uv) * cell;
      vec2 uv1 = (vec2(mod(i1, 16.0), 3.0 - floor(i1 / 16.0)) + uv) * cell;
      vec3 c = mix(texture2D(uBook, uv0).rgb, texture2D(uBook, uv1).rgb, fract(f));
      // the hottest parts run past white into the bloom; the edges stay deep orange
      float lum = dot(c, vec3(0.35, 0.5, 0.15));
      c *= 1.0 + lum * lum * 2.5;
      float a = clamp(lum * 1.8, 0.0, 1.0) * vLit * vFlick;
      gl_FragColor = vec4(c * uBookIntensity * vLit * vFlick, a);
      return;
    }
    if (vKind > 0.5 && vKind < 1.5) {
      float d = length(vUv - 0.5) * 2.0;
      float a = exp(-d * d * 4.5) * (1.0 - smoothstep(0.7, 1.0, d)) * vLit * vFlick;
      gl_FragColor = vec4(vec3(1.0, 0.5, 0.15) * a * uHalo, a);
      return;
    }
    float t = uTime * (1.5 + fract(vSeed * 7.31) * 0.7) + vSeed * 23.0;
    vec2 uv = vUv;
    float n1 = fbm(vec2(uv.x * 2.4 + vSeed * 11.0, uv.y * 2.0 - t * 1.3));
    float n2 = fbm(vec2(uv.x * 5.2 - vSeed * 5.0, uv.y * 4.6 - t * 2.7));
    // the tip leans and wanders more than the root
    float sway = (n1 - 0.5) * 0.55 * uv.y * uv.y + sin(t * 0.8) * 0.035 * uv.y;
    float x = (uv.x - 0.5 - sway) * 2.0;
    float y = uv.y;
    // teardrop: round, steady root; narrow, torn, flickering top
    float w = 0.6 * pow(max(1.0 - y, 0.0), 0.7) * smoothstep(-0.02, 0.16, y) * (0.82 + 0.36 * n2);
    float shape = 1.0 - smoothstep(w * 0.35, w, abs(x));
    shape *= 1.0 - smoothstep(0.5 + 0.32 * n1, 0.97, y);
    float temp = shape * (1.18 - y * 0.95 - abs(x) * 0.55) + (n2 - 0.5) * 0.3 * shape;
    vec3 col = blackbody(clamp(temp, 0.0, 1.0));
    // blue root where the oil burns cleanly
    float blue = smoothstep(0.16, 0.02, y) * (1.0 - smoothstep(0.0, 0.55, abs(x))) * shape;
    col = mix(col, vec3(0.3, 0.45, 1.0), blue * 0.55);
    float a = clamp(shape * 1.5, 0.0, 1.0) * vLit;
    gl_FragColor = vec4(col * a * uIntensity, a);
  }
`;

const emberVert = /* glsl */ `
  attribute float aSeed;
  attribute float aLit;
  attribute float aHeight;
  uniform float uTime;
  uniform float uPixelRatio;
  varying float vA;
  void main() {
    float life = fract(uTime * (0.35 + fract(aSeed * 3.7) * 0.4) + aSeed);
    vec3 p = position;
    p.y += life * aHeight;
    p.x += sin(aSeed * 31.0 + uTime * 2.1 + life * 6.0) * 0.25 * life * aHeight * 0.3;
    p.z += cos(aSeed * 17.0 + uTime * 1.7 + life * 5.0) * 0.25 * life * aHeight * 0.3;
    vA = aLit * (1.0 - life) * smoothstep(0.0, 0.08, life) * (0.6 + 0.4 * sin(uTime * 20.0 + aSeed * 60.0));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(0.035 * 700.0 * uPixelRatio / max(-mv.z, 0.5), 1.0, 6.0 * uPixelRatio);
    if (aLit < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }
`;
const emberFrag = /* glsl */ `
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = (1.0 - d) * vA;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vec3(1.0, 0.55, 0.18) * 4.0 * a, a);
  }
`;

const EMBERS_PER_FIRE = 14;

export class FireSystem {
  constructor(maxEmitters = 3000, maxEmberFires = 40) {
    this.max = maxEmitters;
    this.count = 0;
    const n = maxEmitters * 2 + maxEmberFires * 6; // flame + halo, plus extra tongues for big fires
    this.capacity = n;
    this.used = 0;
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    geo.setAttribute('uv', quad.attributes.uv);
    const attr = (size) => new THREE.InstancedBufferAttribute(new Float32Array(n * size), size).setUsage(THREE.DynamicDrawUsage);
    this.aOrigin = attr(3);
    this.aSize = attr(2);
    this.aSeed = attr(1);
    this.aLit = attr(1);
    this.aKind = attr(1);
    geo.setAttribute('aOrigin', this.aOrigin);
    geo.setAttribute('aSize', this.aSize);
    geo.setAttribute('aSeed', this.aSeed);
    geo.setAttribute('aLit', this.aLit);
    geo.setAttribute('aKind', this.aKind);
    geo.instanceCount = 0;
    this.geo = geo;
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uIntensity: { value: 3.4 }, uHalo: { value: 0.5 }, uBook: { value: null }, uBookReady: { value: 0 }, uBookIntensity: { value: 1.7 } },
      vertexShader: flameVert,
      fragmentShader: flameFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    // the flipbook: until it has loaded the big fires burn with the shaded teardrop
    new THREE.TextureLoader().load(ASSET_MANIFEST.fx.flame, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      this.material.uniforms.uBook.value = t;
      this.material.uniforms.uBookReady.value = 1;
    });

    // embers
    const m = maxEmberFires * EMBERS_PER_FIRE;
    const eg = new THREE.BufferGeometry();
    this.ePos = new Float32Array(m * 3);
    this.eSeed = new Float32Array(m);
    this.eLit = new Float32Array(m);
    this.eHeight = new Float32Array(m);
    eg.setAttribute('position', new THREE.BufferAttribute(this.ePos, 3));
    eg.setAttribute('aSeed', new THREE.BufferAttribute(this.eSeed, 1));
    eg.setAttribute('aLit', new THREE.BufferAttribute(this.eLit, 1));
    eg.setAttribute('aHeight', new THREE.BufferAttribute(this.eHeight, 1));
    eg.setDrawRange(0, 0);
    this.emberGeo = eg;
    this.emberCount = 0;
    this.maxEmberFires = maxEmberFires;
    this.emberMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 } },
      vertexShader: emberVert,
      fragmentShader: emberFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.embers = new THREE.Points(eg, this.emberMat);
    this.embers.frustumCulled = false;
    this.embers.renderOrder = 6;

    this.points = new THREE.Group(); // kept name: Game adds fire.points to the scene
    this.points.add(this.mesh, this.embers);
    this.emitters = []; // { target, lit, ember, slots: [{ i, dx, dy, dz }] }
    this.fading = new Set();
  }

  /**
   * pos: Vector3 (base of the flame). scale: ~1 = a 24 cm lamp flame.
   * kind: 'flame' (flame + halo), 'pyre' (a woodpile's fire) or 'glow' (halo only, electric lamps).
   */
  slot(pos, dx, dy, dz, w, h, kind, seed, lit) {
    const i = this.used++;
    this.aOrigin.setXYZ(i, pos.x + dx, pos.y + dy, pos.z + dz);
    this.aSize.setXY(i, w, h);
    this.aSeed.setX(i, seed);
    this.aKind.setX(i, kind);
    this.aLit.setX(i, lit ? 1 : 0);
    return { i, dx, dy, dz };
  }

  add(pos, scale = 1, lit = false, kind = 'flame') {
    if (this.count >= this.max || this.used + 7 > this.capacity) return -1;
    const id = this.count++;
    const h = 0.24 * scale;
    const w = h * 0.52;
    const seed = Math.random();
    const slots = [];
    if (kind === 'glow') {
      slots.push(this.slot(pos, 0, 0, 0, 0.9 * scale, 0.15 * scale, 1, seed, lit));
    } else if (kind === 'pyre') {
      // a cremation pyre: fire along the whole woodpile, a tall centre and lower tongues out
      // to its corners, each its own frame and pace (scale ~1: a 1.8 m pile)
      const bh = 1.9 * scale;
      slots.push(this.slot(pos, 0, -0.05, 0, bh * 0.62, bh, 2, seed, lit));
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + seed * 6 + 0.4;
        const r = 0.5 * scale;
        const s = 0.55 + Math.random() * 0.25;
        slots.push(this.slot(pos, Math.cos(a) * r, -0.08, Math.sin(a) * r, bh * 0.62 * s, bh * s, 2, Math.random(), lit));
      }
      slots.push(this.slot(pos, 0, 0, 0, bh * 1.7, bh * 0.7, 1, seed, lit));
    } else if (scale >= 2) {
      // a bowl fire, a pyre: three tongues of real flame (each its own frame and pace, crossed
      // so the fire has a body from any side), the low roots of the shaded flame under them,
      // one wide halo
      const bh = h * 2.1;
      slots.push(this.slot(pos, 0, -bh * 0.04, 0, bh * 0.62, bh, 2, seed, lit));
      for (let k = 0; k < 2; k++) {
        const a = seed * 6 + k * Math.PI;
        const s = 0.72 + Math.random() * 0.15;
        slots.push(this.slot(pos, Math.cos(a) * w * 0.4, -bh * 0.04, Math.sin(a) * w * 0.4, bh * 0.62 * s, bh * s, 2, Math.random(), lit));
      }
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + seed * 6;
        slots.push(this.slot(pos, Math.cos(a) * w * 0.35, 0, Math.sin(a) * w * 0.35, w * 0.7, h * 0.45, 0, Math.random(), lit));
      }
      slots.push(this.slot(pos, 0, 0, 0, h * 2.4, h, 1, seed, lit));
    } else if (scale >= 0.9 && kind === 'flame') {
      // a torch, a stove, an aarti lamp's wicks: one tongue of real flame and its glow
      const bh = h * 1.7;
      slots.push(this.slot(pos, 0, -bh * 0.04, 0, bh * 0.6, bh, 2, seed, lit));
      slots.push(this.slot(pos, 0, 0, 0, Math.max(h * 2.3, 0.46), h, 1, seed, lit));
    } else {
      slots.push(this.slot(pos, 0, 0, 0, w, h, 0, seed, lit));
      // small lamps get a generous glow so rows of diyas read as lines of light from afar
      slots.push(this.slot(pos, 0, 0, 0, Math.max(h * 2.3, 0.46), h, 1, seed, lit));
    }
    let ember = -1;
    if ((kind === 'pyre' || (kind === 'flame' && scale >= 2)) && this.emberCount < this.maxEmberFires) {
      ember = this.emberCount++;
      for (let i = 0; i < EMBERS_PER_FIRE; i++) {
        const k = ember * EMBERS_PER_FIRE + i;
        this.ePos.set([pos.x + (Math.random() - 0.5) * w, pos.y + h * 0.4, pos.z + (Math.random() - 0.5) * w], k * 3);
        this.eSeed[k] = Math.random();
        this.eLit[k] = lit ? 1 : 0;
        this.eHeight[k] = h * 3.5;
      }
      this.emberGeo.setDrawRange(0, this.emberCount * EMBERS_PER_FIRE);
      for (const a of ['position', 'aSeed', 'aLit', 'aHeight']) this.emberGeo.attributes[a].needsUpdate = true;
    }
    this.emitters.push({ target: lit ? 1 : 0, lit: lit ? 1 : 0, ember, slots });
    this.geo.instanceCount = this.used;
    for (const a of [this.aOrigin, this.aSize, this.aSeed, this.aLit, this.aKind]) a.needsUpdate = true;
    return id;
  }

  // Lighting and extinguishing fade over ~0.4 s.
  setLit(id, value) {
    const e = this.emitters[id];
    if (!e || e.target === value) return;
    e.target = value;
    this.fading.add(id);
  }

  setPosition(id, x, y, z) {
    if (id < 0) return;
    for (const s of this.emitters[id].slots) this.aOrigin.setXYZ(s.i, x + s.dx, y + s.dy, z + s.dz);
    this.aOrigin.needsUpdate = true;
  }

  writeLit(id, v) {
    const e = this.emitters[id];
    for (const s of e.slots) this.aLit.setX(s.i, v);
    if (e.ember >= 0) {
      for (let i = 0; i < EMBERS_PER_FIRE; i++) this.eLit[e.ember * EMBERS_PER_FIRE + i] = v;
      this.emberGeo.attributes.aLit.needsUpdate = true;
    }
  }

  update(dt, pixelRatio) {
    this.material.uniforms.uTime.value += dt;
    this.emberMat.uniforms.uTime.value += dt;
    this.emberMat.uniforms.uPixelRatio.value = pixelRatio;
    if (!this.fading.size) return;
    for (const id of this.fading) {
      const e = this.emitters[id];
      const step = dt > 0 ? dt / 0.4 : 1;
      e.lit = e.target > e.lit ? Math.min(e.target, e.lit + step) : Math.max(e.target, e.lit - step * 1.5);
      this.writeLit(id, e.lit);
      if (e.lit === e.target) this.fading.delete(id);
    }
    this.aLit.needsUpdate = true;
  }
}
