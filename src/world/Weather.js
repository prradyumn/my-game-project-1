import * as THREE from 'three';
import { WORLD_UNIFORMS } from './materials.js';
import { groundHeight } from './WorldLayout.js';
import { clamp, damp, lerp, smoothstep } from '../utils/math.js';

// The monsoon. Modes: 'clear', 'rain', 'storm', or 'auto' (the odd shower rolls in by itself).
//   overcast   a grey cloud deck over the sky, the sun dimmed, the air hazier
//   rain       streaks falling around the camera, splashes on the stone, rings on the river
//   wetness    builds up while it rains and dries slowly after: stone darkens and turns glossy,
//              flat stone gathers mirror puddles (materials.js uRainWet)
//   storm      lightning lights the clouds and the ghats; thunder rolls in after it
// Sounds are synthesised (AudioManager.synth), so the monsoon costs no downloads.

const RAIN_VS = /* glsl */ `
attribute vec3 aOffset;
attribute float aRand;
attribute vec2 corner;
uniform float uTime;
uniform vec3 uCam;
uniform vec3 uBox;
uniform vec2 uWind;
uniform float uLen;
varying float vA;
void main() {
  float speed = 8.5 + aRand * 3.0;
  vec3 fall = normalize(vec3(uWind.x, -speed, uWind.y));
  vec3 p = aOffset + vec3(uWind.x, -speed, uWind.y) * uTime;
  // wrap into a box that follows the camera
  p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
  vec3 toCam = normalize(cameraPosition - p);
  vec3 side = normalize(cross(fall, toCam));
  vec3 pos = p + fall * corner.y * uLen * (0.7 + aRand * 0.6) + side * corner.x * 0.006;
  vec4 mv = viewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float d = length(p - cameraPosition);
  vA = (1.0 - corner.y) * 0.75 + 0.25;
  vA *= smoothstep(0.6, 2.0, d) * (1.0 - smoothstep(uBox.x * 0.35, uBox.x * 0.5, d));
}`;

const RAIN_FS = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying float vA;
void main() {
  gl_FragColor = vec4(uColor, uAlpha * vA);
}`;

const CLOUD_VS = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w * 0.9999;
}`;

const CLOUD_FS = /* glsl */ `
uniform float uTime;
uniform float uCover;
uniform float uFlash;
uniform vec3 uLit;
uniform vec3 uShade;
uniform vec3 uHaze;
varying vec3 vDir;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int k = 0; k < 5; k++) { s += a * vn(p); p = p * 2.07 + 13.3; a *= 0.5; } return s; }
void main() {
  if (vDir.y < -0.02) discard;
  // project onto a cloud deck
  vec2 uv = vDir.xz / (vDir.y + 0.12) * 1.6 + vec2(uTime * 0.012, uTime * 0.004);
  float n = fbm(uv);
  float cov = smoothstep(1.0 - uCover * 1.05, 1.25 - uCover * 0.6, n + uCover * 0.35);
  // full cover reaches down to a grey horizon (no strip of clear sky under the deck)
  float horizon = 1.0 - smoothstep(0.0, 0.22, vDir.y);
  float a = mix(cov, 1.0, horizon * smoothstep(0.5, 0.9, uCover)) * mix(smoothstep(-0.02, 0.12, vDir.y), 1.0, smoothstep(0.5, 0.9, uCover)) * clamp(uCover * 1.4, 0.0, 1.0);
  vec3 col = mix(uShade, uLit, smoothstep(0.35, 0.9, n));
  col = mix(col, uHaze, horizon * 0.85);
  col += vec3(0.75, 0.8, 1.0) * uFlash * (0.4 + n);
  gl_FragColor = vec4(col, a);
}`;

function makeRain(count) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([-1, 0, 1, 0, 1, 1, -1, 0, 1, 1, -1, 1]), 2));
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18), 3));
  const off = new Float32Array(count * 3);
  const rnd = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    off[i * 3] = Math.random() * 40;
    off[i * 3 + 1] = Math.random() * 26;
    off[i * 3 + 2] = Math.random() * 40;
    rnd[i] = Math.random();
  }
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 3));
  geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(rnd, 1));
  geo.instanceCount = count;
  const mat = new THREE.ShaderMaterial({
    vertexShader: RAIN_VS,
    fragmentShader: RAIN_FS,
    uniforms: {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(40, 26, 40) },
      uWind: { value: new THREE.Vector2(0.9, 0.3) },
      uLen: { value: 0.55 },
      uColor: { value: new THREE.Color(0.8, 0.84, 0.9) },
      uAlpha: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  return mesh;
}

// ------------------------------------------------------------------------------------------
// Wet footprints: Prady leaves dark prints on the stone for a while after the river.

const FOOT_VS = /* glsl */ `
attribute float aFade;
varying vec2 vUv;
varying float vFade;
void main() {
  vUv = uv;
  vFade = aFade;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const FOOT_FS = /* glsl */ `
varying vec2 vUv;
varying float vFade;
void main() {
  vec2 p = vUv - 0.5;
  // sole + heel + a row of toes
  float sole = smoothstep(0.5, 0.42, length(vec2(p.x * 2.6, (p.y + 0.05) * 1.25)));
  float toes = 0.0;
  for (int i = 0; i < 5; i++) {
    vec2 t = vec2(-0.13 + float(i) * 0.065, 0.38 - abs(float(i) - 1.0) * 0.025);
    toes = max(toes, smoothstep(0.045, 0.03, length(p - t)));
  }
  float a = max(sole, toes) * vFade;
  if (a < 0.01) discard;
  gl_FragColor = vec4(0.05, 0.045, 0.04, a * 0.42);
}`;

export class Footprints {
  constructor(max = 48) {
    this.max = max;
    const geo = new THREE.PlaneGeometry(0.13, 0.27).rotateX(-Math.PI / 2);
    this.fade = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    geo.setAttribute('aFade', this.fade);
    const mat = new THREE.ShaderMaterial({ vertexShader: FOOT_VS, fragmentShader: FOOT_FS, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.prints = [];
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
  }

  add(x, y, z, yaw, side, strength) {
    if (this.prints.length >= this.max) this.prints.shift();
    this.prints.push({ x: x + Math.cos(yaw) * 0.09 * side, y: y + 0.012, z: z - Math.sin(yaw) * 0.09 * side, yaw, life: 1, s: strength });
  }

  update(dt) {
    let n = 0;
    for (const p of this.prints) {
      p.life -= dt / 26;
      if (p.life <= 0) continue;
      this._q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.yaw);
      this._m.compose(new THREE.Vector3(p.x, p.y, p.z), this._q, new THREE.Vector3(1, 1, 1));
      this.mesh.setMatrixAt(n, this._m);
      this.fade.setX(n, Math.min(1, p.life * 1.6) * p.s);
      n++;
    }
    this.prints = this.prints.filter((p) => p.life > 0);
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.fade.needsUpdate = true;
  }
}

// ------------------------------------------------------------------------------------------

export class Weather {
  constructor({ scene, camera, audio, splash, ripples, water, quality = 'medium' }) {
    this.scene = scene;
    this.camera = camera;
    this.audio = audio;
    this.splash = splash;
    this.ripples = ripples;
    this.water = water;
    this.mode = 'auto';
    this.rain = 0; // falling now (0..1)
    this.overcast = 0;
    this.wet = 0; // how wet the ground is
    this.flash = 0;
    this.mistExtra = 0;
    this.autoRain = 0;
    this.autoTimer = 60;
    this.boltTimer = 6;
    this.flashSeq = [];
    this.rainMesh = makeRain(quality === 'low' ? 3000 : quality === 'medium' ? 5500 : 9000);
    scene.add(this.rainMesh);
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 16),
      new THREE.ShaderMaterial({
        vertexShader: CLOUD_VS,
        fragmentShader: CLOUD_FS,
        uniforms: { uTime: { value: 0 }, uCover: { value: 0 }, uFlash: { value: 0 }, uLit: { value: new THREE.Color() }, uShade: { value: new THREE.Color() }, uHaze: { value: new THREE.Color() } },
        transparent: true,
        depthWrite: false,
        side: THREE.BackSide,
        fog: false,
      })
    );
    dome.scale.setScalar(2000);
    dome.renderOrder = -1;
    dome.frustumCulled = false;
    this.dome = dome;
    scene.add(dome);
    this.footprints = new Footprints();
    scene.add(this.footprints.mesh);
    this.splashAcc = 0;
  }

  setMode(m) {
    this.mode = m;
  }

  // targets for this moment
  targets(dt, hours) {
    if (this.mode === 'auto') {
      // an occasional monsoon shower: a few in-game hours apart, a while each
      this.autoTimer -= dt;
      if (this.autoTimer <= 0) {
        this.autoTimer = 90 + Math.random() * 240;
        this.autoRain = this.autoRain > 0 ? 0 : Math.random() < 0.3 ? 0.55 + Math.random() * 0.4 : 0;
      }
      return { rain: this.autoRain, cloud: this.autoRain > 0 ? 0.75 : 0.0, storm: false };
    }
    if (this.mode === 'rain') return { rain: 0.75, cloud: 0.85, storm: false };
    if (this.mode === 'storm') return { rain: 1, cloud: 1, storm: true };
    void hours;
    return { rain: 0, cloud: 0, storm: false };
  }

  update(dt, { sky, underwater = false, hours = 12 }) {
    const t = this.targets(dt, hours);
    this.overcast = damp(this.overcast, t.cloud, 0.25, dt);
    // rain starts once the clouds are in and eases off before they part
    this.rain = damp(this.rain, this.overcast > 0.45 ? t.rain : 0, 0.5, dt);
    this.wet = this.rain > 0.15 ? Math.min(1, this.wet + dt / 35) : Math.max(0, this.wet - dt / 140);
    this.mistExtra = this.overcast * 0.35;
    sky.overcast = this.overcast;
    WORLD_UNIFORMS.uRainWet.value = this.wet;
    if (this.water?.uniforms?.uRain) this.water.uniforms.uRain.value = this.rain;

    // rain streaks around the camera
    const rm = this.rainMesh.material.uniforms;
    rm.uTime.value += dt;
    rm.uCam.value.copy(this.camera.position);
    rm.uAlpha.value = this.rain * (underwater ? 0 : 0.42);
    rm.uColor.value.copy(sky.hemi.color).multiplyScalar(0.65 + this.flash * 1.5).addScalar(0.12);
    this.rainMesh.visible = rm.uAlpha.value > 0.005;

    // splashes on the stone and rings on the river near the camera
    if (this.rain > 0.1 && !underwater && dt > 0) {
      this.splashAcc += dt * this.rain * 26;
      const cam = this.camera.position;
      while (this.splashAcc > 1) {
        this.splashAcc -= 1;
        const a = Math.random() * Math.PI * 2;
        const r = 2 + Math.sqrt(Math.random()) * 13;
        const x = cam.x + Math.cos(a) * r;
        const z = cam.z + Math.sin(a) * r;
        const g = groundHeight(x, z);
        const s = this.water.heightAt(x, z);
        if (g > s + 0.02) this.splash.spawn(new THREE.Vector3(x, g + 0.02, z), 2, 0.9, 0.05);
        else if (Math.random() < 0.25) this.ripples?.spawn(x, s, z, 0.35, 0.8);
      }
    }

    // the cloud deck
    const cu = this.dome.material.uniforms;
    cu.uTime.value += dt;
    cu.uCover.value = this.overcast;
    const day = clamp(sky.sunDir.y * 3 + 0.25, 0, 1);
    cu.uLit.value.setRGB(0.62, 0.64, 0.68).multiplyScalar(0.25 + 0.75 * day);
    cu.uShade.value.setRGB(0.3, 0.32, 0.36).multiplyScalar(0.2 + 0.8 * day);
    cu.uHaze.value.copy(this.scene.fog.color);
    this.dome.position.copy(this.camera.position);
    this.dome.visible = this.overcast > 0.01;
    // the same deck in the sky's reflection scene, so wet stone and puddles mirror grey cloud
    if (!this.envDome && sky.envScene) {
      this.envDome = new THREE.Mesh(this.dome.geometry, this.dome.material);
      this.envDome.scale.setScalar(45);
      this.envDome.renderOrder = -1;
      sky.envScene.add(this.envDome);
    }
    if (this.envDome) this.envDome.visible = this.dome.visible;

    // lightning
    this.flash = 0;
    if (t.storm && this.overcast > 0.7) {
      this.boltTimer -= dt;
      if (this.boltTimer <= 0) {
        this.boltTimer = 5 + Math.random() * 11;
        const n = 2 + Math.floor(Math.random() * 3);
        let at = 0;
        for (let i = 0; i < n; i++) {
          this.flashSeq.push({ at, dur: 0.05 + Math.random() * 0.1, k: i === 0 ? 1 : 0.4 + Math.random() * 0.6 });
          at += 0.08 + Math.random() * 0.18;
        }
        const dist = 0.6 + Math.random() * 2.6; // seconds before the thunder
        setTimeout(() => this.audio?.play('thunder', { volume: clamp(1.2 - dist * 0.2, 0.4, 1), rate: 0.85 + Math.random() * 0.3 }), dist * 1000);
      }
    }
    for (const f of this.flashSeq) {
      f.at -= dt;
      if (f.at <= 0 && f.at > -f.dur) this.flash = Math.max(this.flash, f.k);
    }
    this.flashSeq = this.flashSeq.filter((f) => f.at > -f.dur);
    cu.uFlash.value = this.flash;

    this.footprints.update(dt);
  }

  // dim the sun and grey the light (after SkySystem.update has set its values)
  applyToSky(sky, scene) {
    const o = this.overcast;
    if (o < 0.001 && this.flash === 0) return;
    sky.sun.intensity *= 1 - 0.82 * o;
    const grey = new THREE.Color(0.58, 0.62, 0.68).multiplyScalar(lerp(0.25, 1, clamp(sky.sunDir.y * 3 + 0.25, 0, 1)));
    sky.hemi.color.lerp(grey, o * 0.7);
    sky.hemi.intensity *= 1 + 0.25 * o + this.flash * 2.2;
    scene.fog.color.lerp(grey, o * 0.75);
    scene.fog.density *= 1 + 1.6 * o;
    // the env map is the clear sky: reflections (puddles, wet stone) go grey and dim under cloud
    scene.environmentIntensity *= 1 - 0.65 * o;
  }

  exposureScale() {
    return 1 - 0.18 * this.overcast + this.flash * 0.9;
  }

  // footstep hook: wet prints for a while after the river (or in the rain)
  footstep(x, y, z, yaw, side, wetness) {
    const w = Math.max(wetness, this.wet * 0.5);
    if (w > 0.08) this.footprints.add(x, y, z, yaw, side, Math.min(1, w * 1.2));
  }
}

// --- synthesised sounds (no downloads): rain hiss with droplets, rolling thunder ---------
export function synthRain(ctx) {
  const sr = ctx.sampleRate;
  const len = sr * 5;
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      // pinkish noise
      b0 = 0.99765 * b0 + w * 0.099;
      b1 = 0.963 * b1 + w * 0.2965;
      b2 = 0.57 * b2 + w * 1.0527;
      const pink = (b0 + b1 + b2 + w * 0.1848) * 0.18;
      lp += (pink - lp) * 0.35;
      d[i] = pink - lp * 0.6;
    }
    // droplets: short bright ticks
    for (let k = 0; k < 900; k++) {
      const at = Math.floor(Math.random() * (len - 600));
      const f = 1800 + Math.random() * 4500;
      const amp = 0.05 + Math.random() * 0.12;
      for (let i = 0; i < 500; i++) d[at + i] += Math.sin((i / sr) * f * 6.283) * amp * Math.exp(-i / 70);
    }
    // seamless loop: crossfade the ends
    const fade = Math.floor(sr * 0.3);
    for (let i = 0; i < fade; i++) {
      const a = i / fade;
      d[i] = d[i] * a + d[len - fade + i] * (1 - a);
    }
  }
  return buf;
}

export function synthThunder(ctx) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 6.5);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let brown = 0;
    let lp = 0;
    const swells = [0.0, 0.6 + Math.random() * 0.5, 1.8 + Math.random(), 3.2 + Math.random()];
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const w = Math.random() * 2 - 1;
      brown = (brown + w * 0.02) * 0.998;
      lp += (brown - lp) * 0.08;
      let env = 0;
      for (const s of swells) env += Math.exp(-Math.max(0, t - s) * 1.3) * smoothstep(s - 0.05, s + 0.25, t);
      const crack = t < 0.25 ? w * Math.exp(-t * 18) * 0.6 : 0;
      d[i] = lp * 9 * env * Math.exp(-t * 0.35) + crack;
    }
  }
  return buf;
}
