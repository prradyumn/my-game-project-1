import * as THREE from 'three';
import { BANK } from '../config.js';
import { PROFILE_LEN } from './WorldLayout.js';

// Morning mist on the Ganga: three thin sheets just above the water, drifting with the river,
// thickest at first light, a faint veil at dusk and under the moon. Each sheet fades out
// before the ghat steps (by distance from the bank) so nothing slices visibly through stone.

const VS = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FS = /* glsl */ `
uniform float uTime;
uniform float uDensity;
uniform float uLayer;
uniform vec3 uColor;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform vec4 uBank; // z0, curve, halfLen, profileLen
varying vec3 vW;

float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int k = 0; k < 4; k++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
void main() {
  // distance from the ghat edge (the bank curve), in metres toward the river
  float t = vW.x / uBank.z;
  float bankZ = uBank.x + uBank.y * t * t;
  float v = vW.z - bankZ;
  float fadeBank = smoothstep(uBank.w + 1.0, uBank.w + 14.0, v);
  vec2 drift = vec2(uTime * (0.35 + uLayer * 0.12), uTime * 0.05);
  float n = fbm((vW.xz + drift) * (0.018 + uLayer * 0.006));
  n = smoothstep(0.38, 0.85, n + 0.12 * sin(uTime * 0.07 + uLayer));
  float camFade = smoothstep(1.5, 12.0, distance(cameraPosition, vW));
  float a = uDensity * n * fadeBank * camFade * (0.55 - uLayer * 0.12);
  if (a < 0.003) discard;
  vec3 dir = normalize(vW - cameraPosition);
  float sun = pow(max(dot(dir, uSunDir), 0.0), 6.0);
  vec3 col = uColor + uSunColor * sun * 0.9;
  gl_FragColor = vec4(col, a);
}`;

export class Mist {
  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'mist';
    this.uniforms = {
      uTime: { value: 0 },
      uDensity: { value: 0 },
      uColor: { value: new THREE.Color(0.85, 0.82, 0.78) },
      uSunColor: { value: new THREE.Color(1, 0.8, 0.6) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uBank: { value: new THREE.Vector4(BANK.z0, BANK.curve, BANK.halfLen, PROFILE_LEN) },
    };
    const geo = new THREE.PlaneGeometry(1300, 420, 1, 1).rotateX(-Math.PI / 2);
    this.sheets = [0, 1, 2].map((layer) => {
      const mat = new THREE.ShaderMaterial({
        vertexShader: VS,
        fragmentShader: FS,
        uniforms: { ...this.uniforms, uLayer: { value: layer } },
        transparent: true,
        depthWrite: false,
        fog: false,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(0, 0.35 + layer * 0.75, 160);
      m.renderOrder = 2;
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    });
    this.density = 0;
  }

  /** How misty it is now (0..1) for this hour, before weather. */
  static amountAt(hours) {
    const dawn = Math.max(0, 1 - Math.abs(hours - 6.1) / 2.6);
    const dusk = 0.32 * Math.max(0, 1 - Math.abs(hours - 18.6) / 1.4);
    const night = hours > 20 || hours < 4.5 ? 0.18 : 0;
    return Math.min(1, Math.max(dawn * dawn * (3 - 2 * dawn), dusk, night));
  }

  update(dt, { hours, sky, extra = 0 }) {
    this.uniforms.uTime.value += dt;
    const target = Math.min(1, Mist.amountAt(hours) + extra);
    this.density += (target - this.density) * Math.min(1, dt * 0.5);
    this.uniforms.uDensity.value = this.density;
    this.group.visible = this.density > 0.01;
    // lit by the sky: warm at sunrise, cool blue under the moon
    const day = Math.max(0, Math.min(1, sky.sunDir.y * 4 + 0.3));
    this.uniforms.uColor.value.copy(sky.hemi.color).multiplyScalar(0.55 + 0.45 * day);
    this.uniforms.uSunColor.value.copy(sky.sunColor).multiplyScalar(day);
    this.uniforms.uSunDir.value.copy(sky.sunDir);
    return this.density;
  }
}
