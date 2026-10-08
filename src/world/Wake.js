import * as THREE from 'three';

// Foam on the river: the V of a rowing boat's wake, the churn behind its stern, and the white
// water around a swimmer. Each patch is a flat quad with procedural broken foam, laid on the
// wave surface, drifting with the current, spreading and fading. One draw call for all of it.

const VS = /* glsl */ `
attribute vec4 aFoam; // alpha, seed, age (0..1), churn
varying vec2 vUv;
varying vec4 vFoam;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vFoam = aFoam;
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FS = /* glsl */ `
uniform vec3 uLight;
uniform float uTime;
varying vec2 vUv;
varying vec4 vFoam;
#include <fog_pars_fragment>
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
// distance to the nearest and second-nearest cell point: their difference is small along
// the cell walls, which is where foam gathers on real water
vec2 cells(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(x, y);
      vec2 o = vec2(h21(i + g), h21(i + g + 19.7));
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
  return vec2(sqrt(d1), sqrt(d2));
}
void main() {
  float r = length(vUv - 0.5);
  vec2 q = vUv + vFoam.y * 7.0;
  float n = vnoise(q * 6.0);
  float m = vnoise(q * 2.5) * 0.65 + vnoise(q * 11.0) * 0.35;
  float mask = 1.0 - smoothstep(0.15, 0.5, r + (n - 0.5) * 0.25);
  vec2 c = cells(q * (8.0 + vFoam.w * 3.0));
  // fresh foam is a dense sheet; as it ages it opens into thin, broken lace
  float age = vFoam.z;
  float wall = mix(0.5, 0.05, sqrt(age)) * (0.45 + m);
  float lace = 1.0 - smoothstep(wall * 0.35, wall, c.y - c.x);
  float breakup = smoothstep(0.25 + age * 0.35, 0.6 + age * 0.2, m);
  float a = mask * lace * breakup * vFoam.x;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uLight * (0.86 + 0.14 * n), a);
  #include <fog_fragment>
}`;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _cur = { x: 0, z: 0 };

export class Wake {
  constructor(water, max = 360) {
    this.water = water;
    this.max = max;
    this.items = [];
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.foam = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.foam.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aFoam', this.foam);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VS,
      fragmentShader: FS,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uLight: { value: new THREE.Color(1, 1, 1) }, uTime: { value: 0 } }]),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      fog: true,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.layers.set(2); // never mirrored in the river
    this.mesh.count = 0;
    this.emitters = new Map();
  }

  /** One foam patch. vx/vz: its own spread (m/s), on top of the current. */
  spawn(x, z, { size = 0.8, grow = 0.5, life = 4, vx = 0, vz = 0, yaw = 0, stretch = 0, churn = 0, alpha = 1 } = {}) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push({ x, z, vx, vz, yaw, size, grow, life, t: 0, seed: Math.random(), stretch, churn, alpha });
  }

  /**
   * A moving hull, called every frame: lays the bow arms and the stern churn by distance
   * travelled, so the trail is even whatever the frame rate. key: one per hull.
   */
  hull(key, { x, z, yaw, speed, halfLen = 3.3, halfBeam = 0.95, strength = 1 }) {
    let e = this.emitters.get(key);
    if (!e) this.emitters.set(key, (e = { x, z, acc: 0 }));
    const d = Math.hypot(x - e.x, z - e.z);
    e.x = x;
    e.z = z;
    const sp = Math.abs(speed);
    if (sp < 0.25 || d > 3) return; // still, or teleported
    e.acc += d;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const rx = fz;
    const rz = -fx;
    const dir = Math.sign(speed) || 1;
    const k = Math.min(1, sp / 2.5) * strength;
    while (e.acc > 0.42) {
      e.acc -= 0.42;
      // bow arms: peel off at the bow and open outward (the Kelvin V)
      const bx = x + fx * halfLen * 0.75 * dir;
      const bz = z + fz * halfLen * 0.75 * dir;
      for (const side of [-1, 1]) {
        const out = side * halfBeam * 0.85;
        const spread = 0.28 + sp * 0.16;
        this.spawn(bx + rx * out, bz + rz * out, { size: 0.45 + k * 0.3, grow: 0.3, life: 3 + k * 2.5, vx: rx * side * spread, vz: rz * side * spread, yaw: yaw + side * 0.35, stretch: 1.2, alpha: 0.5 + k * 0.4 });
      }
      // stern: a broad, churned trail
      const sx = x - fx * halfLen * 0.85 * dir;
      const sz = z - fz * halfLen * 0.85 * dir;
      this.spawn(sx + rx * (Math.random() - 0.5) * 0.6, sz + rz * (Math.random() - 0.5) * 0.6, { size: halfBeam * 1.05, grow: 0.16, life: 4 + k * 3, yaw: yaw + (Math.random() - 0.5) * 0.6, stretch: 0.5, churn: 1, alpha: 0.35 + k * 0.45 });
    }
  }

  /** A swimmer: white water at the shoulders and a short trail. */
  swimmer(key, { x, z, yaw, speed }) {
    this.hull(key, { x, z, yaw, speed, halfLen: 0.55, halfBeam: 0.28, strength: 0.55 });
  }

  update(dt, light) {
    this.material.uniforms.uTime.value += dt;
    this.material.uniforms.uLight.value.copy(light);
    let n = 0;
    for (const f of this.items) {
      f.t += dt;
      const k = f.t / f.life;
      if (k >= 1) continue;
      this.water.currentAt(f.x, f.z, _cur);
      const drag = Math.exp(-dt * 0.7);
      f.vx *= drag;
      f.vz *= drag;
      f.x += (f.vx + _cur.x) * dt;
      f.z += (f.vz + _cur.z) * dt;
      const s = f.size * (1 + f.grow * f.t);
      _q.setFromAxisAngle(_up, f.yaw);
      _m.compose(_p.set(f.x, this.water.heightAt(f.x, f.z) + 0.025, f.z), _q, _s.set(s, 1, s * (1 + f.stretch)));
      this.mesh.setMatrixAt(n, _m);
      // in fast, out slow
      const a = Math.min(1, f.t * 6) * (1 - k) * (1 - k) * f.alpha;
      this.foam.setXYZW(n, a, f.seed, k, f.churn);
      n++;
    }
    this.items = this.items.filter((f) => f.t < f.life);
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.foam.needsUpdate = true;
  }
}
