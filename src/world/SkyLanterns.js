import * as THREE from 'three';
import { RNG } from '../utils/math.js';
import { ghatById, ghatToWorld, GHAT_SEGMENTS, LANDING_2 } from './WorldLayout.js';

// Paper sky lanterns (akash deep) rising from the ghats after dark: a handful on any night
// from Dashashwamedh after the aarti, hundreds along every ghat on Dev Deepawali. Each one
// glows from the flame in its open mouth, flickers, drifts on the wind toward the river and
// fades as it climbs out of sight. One InstancedMesh; the river reflects them.

const VS = /* glsl */ `
attribute vec2 aLamp; // seed, brightness 0..1
varying float vY;
varying float vSeed;
varying float vBright;
#include <fog_pars_vertex>
void main() {
  vY = position.y;
  vSeed = aLamp.x;
  vBright = aLamp.y;
  vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FS = /* glsl */ `
uniform float uTime;
varying float vY;
varying float vSeed;
varying float vBright;
#include <fog_pars_fragment>
void main() {
  if (vBright < 0.01) discard;
  // the flame sits at the open bottom: paper glows hottest there, dimmer toward the crown
  float glow = mix(1.0, 0.3, smoothstep(-0.28, 0.3, vY));
  float flick = 0.85 + 0.15 * sin(uTime * 11.0 + vSeed * 40.0) * sin(uTime * 7.3 + vSeed * 13.0);
  vec3 col = vec3(2.3, 0.85, 0.22) * glow * flick * vBright;
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}`;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

export class SkyLanterns {
  constructor(max = 140) {
    this.max = max;
    this.rng = new RNG(2024);
    // a slightly tapered paper box, open below
    const geo = new THREE.CylinderGeometry(0.3, 0.24, 0.62, 8, 3, true);
    this.lamp = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2);
    this.lamp.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aLamp', this.lamp);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VS,
      fragmentShader: FS,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
      side: THREE.DoubleSide,
      fog: true,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.items = [];
    this.timer = 0;
    this.dash = ghatById('dashashwamedh');
    this.wind = new THREE.Vector3(0.5, 0, 0.86).normalize(); // as the street cloth (StreetLife)
  }

  release(x, y, z) {
    if (this.items.length >= this.max) return;
    const r = this.rng;
    this.items.push({ x, y, z, vy: r.range(0.45, 0.8), age: 0, seed: r.next(), drift: r.range(0.6, 1.3), sway: r.range(0, 6.28), life: r.range(150, 230), fade: 1 });
  }

  /** night 0..1; festival: Dev Deepawali (every ghat); aarti: the evening aarti is lit. */
  update(dt, { night, festival, aarti, hours }) {
    this.material.uniforms.uTime.value += dt;
    const r = this.rng;
    // releases: dusk to midnight; many on the festival, a few after the aarti otherwise
    const evening = night > 0.6 && (hours > 18 || hours < 0.5);
    if (evening && (festival || aarti)) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = festival ? r.range(0.5, 1.4) : r.range(9, 20);
        const g = festival ? r.pick(GHAT_SEGMENTS) : this.dash;
        const p = ghatToWorld(g, g.width * r.range(0.1, 0.9), (LANDING_2.v0 + LANDING_2.v1) / 2 + r.range(-1.5, 1.5));
        this.release(p.x, LANDING_2.h0 + 1.6, p.z);
      }
    }
    let n = 0;
    for (const l of this.items) {
      l.age += dt;
      // lanterns burn out and fade; at daybreak the last ones go out
      if (night < 0.3) l.fade = Math.max(0, l.fade - dt * 0.3);
      const k = l.age / l.life;
      // rise (slowing as the flame dies), drift with the wind, a slow sway
      l.y += l.vy * (1.15 - k * 0.6) * dt;
      l.x += (this.wind.x * l.drift + Math.sin(l.age * 0.31 + l.sway) * 0.3) * dt;
      l.z += (this.wind.z * l.drift + Math.cos(l.age * 0.27 + l.sway) * 0.3) * dt;
      const bright = Math.min(1, l.age * 1.5) * (1 - Math.max(0, (k - 0.75) / 0.25)) * l.fade;
      _e.set(Math.sin(l.age * 0.9 + l.sway) * 0.08, l.seed * 6, Math.cos(l.age * 0.8 + l.sway) * 0.08);
      _m.compose(_p.set(l.x, l.y, l.z), _q.setFromEuler(_e), _s.setScalar(1));
      this.mesh.setMatrixAt(n, _m);
      this.lamp.setXY(n, l.seed, bright);
      n++;
    }
    this.items = this.items.filter((l) => l.age < l.life && l.fade > 0);
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.lamp.needsUpdate = true;
  }
}
