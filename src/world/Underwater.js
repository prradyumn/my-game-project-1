import * as THREE from 'three';
import { RNG } from '../utils/math.js';
import { ghatById, ghatToWorld, groundHeight, PROFILE_LEN } from './WorldLayout.js';
import { makeWaterAware } from './materials.js';

// Below the surface of the Ganga:
//   * shafts of sunlight slanting down through the water, rippling with the waves above
//     (brighter and deeper as the river is purified)
//   * motes and drifting petals of the day's offerings, sinking slowly in the current
//   * schools of fish over the bed in front of the ghats that scatter from a swimmer
// Shafts and motes only exist while the camera is under water; the fish are always there
// (in clear water you can see them from the steps).

const SHAFT_VS = /* glsl */ `
attribute vec4 aShaft; // seed, width, length, strength
uniform vec3 uDir;     // the refracted sun direction (pointing down)
uniform float uTime;
varying float vAlong;
varying float vAcross;
varying float vSeed;
varying float vStrength;
varying float vCamFade;
void main() {
  vSeed = aShaft.x;
  vStrength = aShaft.w;
  // a strip from the surface down along uDir, turned about its own axis to face the camera
  vec3 top = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 axis = normalize(uDir);
  vec3 toCam = normalize(cameraPosition - top);
  vec3 side = normalize(cross(axis, toCam));
  float along = position.y; // 0 at the surface .. 1 at the bottom
  float across = position.x; // -0.5 .. 0.5
  vec3 p = top + axis * along * aShaft.z + side * across * aShaft.y * (1.0 + along * 0.6);
  p.x += sin(uTime * 0.7 + vSeed * 20.0) * 0.4 * along;
  vAlong = along;
  vAcross = across;
  vCamFade = smoothstep(0.8, 4.0, distance(cameraPosition, p));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const SHAFT_FS = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uAmount;
varying float vAlong;
varying float vAcross;
varying float vSeed;
varying float vStrength;
varying float vCamFade;
void main() {
  float edge = 1.0 - smoothstep(0.15, 0.5, abs(vAcross));
  float fall = smoothstep(0.0, 0.08, vAlong) * pow(1.0 - vAlong, 1.6);
  // the waves above focus and scatter the light: the shaft breathes
  float flick = 0.55 + 0.45 * sin(uTime * (1.1 + vSeed) + vSeed * 30.0) * sin(uTime * 0.63 + vSeed * 11.0);
  float a = edge * fall * flick * vStrength * uAmount * vCamFade;
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

const MOTE_VS = /* glsl */ `
attribute vec4 aMote; // seed, kind (0 mote, 1 petal), size, sink speed
uniform float uTime;
uniform vec3 uCam;
uniform vec2 uFlow;
uniform float uPixelRatio;
varying float vKind;
varying float vSeed;
varying float vFade;
void main() {
  vKind = aMote.y;
  vSeed = aMote.x;
  // each mote lives in a 16 m box that wraps around the camera
  vec3 p = position + vec3(uFlow.x, -aMote.w, uFlow.y) * uTime;
  p.x += sin(uTime * 0.4 + vSeed * 30.0) * 0.4;
  p.z += cos(uTime * 0.33 + vSeed * 17.0) * 0.4;
  vec3 rel = mod(p - uCam + 8.0, 16.0) - 8.0;
  vec3 w = uCam + rel;
  vFade = 1.0 - smoothstep(4.0, 8.0, length(rel));
  vec4 mv = viewMatrix * vec4(w, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aMote.z * 260.0 * uPixelRatio / max(-mv.z, 0.3);
}`;

const MOTE_FS = /* glsl */ `
uniform vec3 uLight;
uniform vec3 uWater;
uniform float uSurfaceY;
varying float vKind;
varying float vSeed;
varying float vFade;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c * (vKind > 0.5 ? vec2(1.0, 1.8) : vec2(1.0)));
  float a = (1.0 - smoothstep(0.2, 0.5, d)) * vFade;
  if (a < 0.02) discard;
  vec3 petal = mix(vec3(0.95, 0.42, 0.04), vec3(0.75, 0.06, 0.08), step(0.6, fract(vSeed * 7.3)));
  vec3 col = vKind > 0.5 ? petal * uLight : uWater * 2.2 + uLight * 0.12;
  gl_FragColor = vec4(col, a * (vKind > 0.5 ? 0.95 : 0.4));
}`;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _v = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

function fishGeometry() {
  // a slim spindle with a forked tail, nose along +Z; aTail marks how much a vertex wags
  const g = new THREE.SphereGeometry(0.5, 10, 6);
  g.scale(0.13, 0.2, 0.55);
  const tail = new THREE.ConeGeometry(0.15, 0.24, 4).rotateX(-Math.PI / 2).scale(0.25, 1.1, 1).translate(0, 0, -0.37);
  const parts = [g.toNonIndexed(), tail.toNonIndexed()];
  const pos = [];
  for (const part of parts) pos.push(...part.attributes.position.array);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const n = pos.length / 3;
  const wag = new Float32Array(n);
  for (let i = 0; i < n; i++) wag[i] = Math.max(0, -pos[i * 3 + 2] - 0.03) / 0.45;
  geo.setAttribute('aTail', new THREE.BufferAttribute(wag, 1));
  geo.computeVertexNormals();
  return geo;
}

export class Underwater {
  constructor({ water, quality = 'medium' }) {
    this.water = water;
    this.rng = new RNG(5151);
    this.group = new THREE.Group();
    this.group.name = 'underwater';

    // ---- light shafts
    const shafts = quality === 'low' ? 10 : 18;
    const sGeo = new THREE.PlaneGeometry(1, 1, 1, 8).translate(0, 0.5, 0);
    // flip so y runs 0 (surface) .. 1 (down the shaft)
    this.shaftAttr = new THREE.InstancedBufferAttribute(new Float32Array(shafts * 4), 4);
    sGeo.setAttribute('aShaft', this.shaftAttr);
    this.shaftU = { uDir: { value: new THREE.Vector3(0, -1, 0) }, uTime: { value: 0 }, uColor: { value: new THREE.Color() }, uAmount: { value: 0 } };
    this.shafts = new THREE.InstancedMesh(
      sGeo,
      new THREE.ShaderMaterial({ vertexShader: SHAFT_VS, fragmentShader: SHAFT_FS, uniforms: this.shaftU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
      shafts
    );
    this.shafts.frustumCulled = false;
    this.shafts.renderOrder = 6;
    this.shaftSpots = Array.from({ length: shafts }, () => ({ x: 0, z: 0, set: false }));
    this.group.add(this.shafts);

    // ---- motes and petals
    const motes = quality === 'low' ? 260 : 520;
    const mp = new Float32Array(motes * 3);
    const ma = new Float32Array(motes * 4);
    for (let i = 0; i < motes; i++) {
      mp.set([this.rng.range(-8, 8), this.rng.range(-8, 8), this.rng.range(-8, 8)], i * 3);
      const petal = this.rng.chance(0.12);
      ma.set([this.rng.next(), petal ? 1 : 0, petal ? this.rng.range(0.05, 0.08) : this.rng.range(0.012, 0.03), petal ? this.rng.range(0.05, 0.12) : this.rng.range(0.005, 0.03)], i * 4);
    }
    const mGeo = new THREE.BufferGeometry();
    mGeo.setAttribute('position', new THREE.BufferAttribute(mp, 3));
    mGeo.setAttribute('aMote', new THREE.BufferAttribute(ma, 4));
    this.moteU = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uFlow: { value: new THREE.Vector2(0.15, 0) }, uPixelRatio: { value: 1 }, uLight: { value: new THREE.Color() }, uWater: { value: new THREE.Color() }, uSurfaceY: { value: 0 } };
    this.motes = new THREE.Points(mGeo, new THREE.ShaderMaterial({ vertexShader: MOTE_VS, fragmentShader: MOTE_FS, uniforms: this.moteU, transparent: true, depthWrite: false }));
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 6;
    this.group.add(this.motes);
    this.shafts.visible = this.motes.visible = false;

    // ---- fish
    const perSchool = quality === 'low' ? 7 : 11;
    this.schools = [];
    for (const [id, u] of [['dashashwamedh', 0.35], ['dashashwamedh', 0.75], ['assi', 0.5], ['scindia', 0.4], ['kedar', 0.6], ['panchganga', 0.5]]) {
      const g = ghatById(id);
      if (!g) continue;
      const home = ghatToWorld(g, g.width * u, PROFILE_LEN + 14);
      this.schools.push({ home, x: home.x, z: home.z, y: -2, t: this.rng.range(0, 100), radius: this.rng.range(6, 10), flee: 0, fx: 0, fz: 0, N: { x: g.N.x, z: g.N.z }, fish: [] });
    }
    const fishCount = this.schools.length * perSchool;
    const fishMat = makeWaterAware(new THREE.MeshStandardMaterial({ color: 0xc8d2c4, roughness: 0.32, metalness: 0.55 }), { wetness: false, puddles: false });
    const prevCompile = fishMat.onBeforeCompile;
    this.fishTime = { value: 0 };
    fishMat.onBeforeCompile = (sh, r) => {
      prevCompile(sh, r);
      sh.uniforms.uFishTime = this.fishTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uFishTime;\nattribute float aTail;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          float fph = float(gl_InstanceID) * 1.37;
          transformed.x += sin(uFishTime * 9.0 + fph - position.z * 6.0) * 0.08 * aTail;
          transformed.x += sin(uFishTime * 9.0 + fph) * 0.012;`
        );
    };
    const prevKey = fishMat.customProgramCacheKey;
    fishMat.customProgramCacheKey = () => `${prevKey()}-fish`;
    this.fishMesh = new THREE.InstancedMesh(fishGeometry(), fishMat, fishCount);
    this.fishMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fishMesh.frustumCulled = false;
    this.fishMesh.layers.set(2); // under the surface: never in the mirror
    let k = 0;
    for (const s of this.schools)
      for (let i = 0; i < perSchool; i++) {
        s.fish.push({ i: k++, ox: this.rng.range(-1.2, 1.2), oy: this.rng.range(-0.5, 0.5), oz: this.rng.range(-1.2, 1.2), ph: this.rng.range(0, 6.28), size: this.rng.range(0.75, 1.3), x: s.x, y: s.y, z: s.z, yaw: 0 });
        this.fishMesh.setColorAt(k - 1, new THREE.Color().setHSL(0.25 + this.rng.range(-0.06, 0.04), 0.12, this.rng.range(0.35, 0.55)));
      }
    this.group.add(this.fishMesh);
  }

  update(dt, { camera, under, sky, purity, swimmer, pixelRatio }) {
    const cam = camera.position;
    this.fishTime.value += dt;
    // ---- fish: each school circles its home over the bed; scatters from a swimmer
    for (const s of this.schools) {
      const d = Math.hypot(cam.x - s.home.x, cam.z - s.home.z);
      const active = d < 70;
      s.t += dt * 0.12;
      let tx = s.home.x + Math.cos(s.t) * s.radius + s.fx;
      let tz = s.home.z + Math.sin(s.t * 1.3) * s.radius * 0.6 + s.fz;
      if (swimmer) {
        const dx = s.x - swimmer.x;
        const dz = s.z - swimmer.z;
        const dd = Math.hypot(dx, dz);
        if (dd < 5) {
          s.fx += (dx / (dd || 1)) * dt * 6;
          s.fz += (dz / (dd || 1)) * dt * 6;
        }
      }
      s.fx *= Math.exp(-dt * 0.25);
      s.fz *= Math.exp(-dt * 0.25);
      const bed = groundHeight(tx, tz);
      const surf = this.water.heightAt(tx, tz);
      // keep to water at least 1.6 m deep, between the bed and the surface
      if (surf - bed < 1.6) {
        tx = s.home.x;
        tz = s.home.z;
      }
      const ty = Math.min(surf - 0.7, Math.max(bed + 0.5, (bed + surf) / 2 - 0.4));
      const lag = 1 - Math.exp(-dt * 1.5);
      s.x += (tx - s.x) * lag;
      s.z += (tz - s.z) * lag;
      s.y += (ty - s.y) * lag;
      for (const f of s.fish) {
        if (!active) {
          _m.makeScale(0, 0, 0);
          this.fishMesh.setMatrixAt(f.i, _m);
          continue;
        }
        const wx = s.x + f.ox + Math.sin(this.fishTime.value * 0.7 + f.ph) * 0.4;
        const wz = s.z + f.oz + Math.cos(this.fishTime.value * 0.6 + f.ph) * 0.4;
        const wy = s.y + f.oy + Math.sin(this.fishTime.value * 0.9 + f.ph) * 0.12;
        const vx = wx - f.x;
        const vz = wz - f.z;
        const sp = Math.hypot(vx, vz);
        if (sp > 1e-4) f.yaw += (((Math.atan2(vx, vz) - f.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, dt * 4);
        const follow = 1 - Math.exp(-dt * 3);
        f.x += vx * follow;
        f.z += vz * follow;
        f.y += (wy - f.y) * follow;
        _e.set(-(wy - f.y) * 0.8, f.yaw, 0);
        _q.setFromEuler(_e);
        _m.compose(_p.set(f.x, f.y, f.z), _q, _s.setScalar(f.size));
        this.fishMesh.setMatrixAt(f.i, _m);
      }
    }
    this.fishMesh.instanceMatrix.needsUpdate = true;

    // ---- shafts and motes only under water
    this.shafts.visible = this.motes.visible = under;
    if (!under) {
      for (const sp of this.shaftSpots) sp.set = false;
      return;
    }
    const day = Math.max(0, Math.min(1, sky.sunDir.y * 3));
    // the sun's direction after refraction at the surface (flatter sun -> steeper in water)
    _v.copy(sky.sunDir).negate();
    const horiz = Math.hypot(_v.x, _v.z);
    const sinI = horiz;
    const sinR = sinI / 1.33;
    const cosR = Math.sqrt(1 - sinR * sinR);
    this.shaftU.uDir.value.set((_v.x / (horiz || 1)) * sinR, -cosR, (_v.z / (horiz || 1)) * sinR);
    this.shaftU.uTime.value += dt;
    this.shaftU.uColor.value.copy(sky.sunColor).multiplyScalar(0.35).lerp(new THREE.Color(0.55, 0.8, 0.7), 0.35);
    this.shaftU.uAmount.value = day * (0.35 + 0.65 * purity);
    let n = 0;
    for (const sp of this.shaftSpots) {
      if (!sp.set || Math.hypot(sp.x - cam.x, sp.z - cam.z) > 16) {
        const a = this.rng.range(0, Math.PI * 2);
        const r = this.rng.range(1.5, 14);
        sp.x = cam.x + Math.cos(a) * r;
        sp.z = cam.z + Math.sin(a) * r;
        sp.seed = this.rng.next();
        sp.w = this.rng.range(0.5, 1.6);
        sp.str = this.rng.range(0.25, 0.7);
        sp.set = true;
      }
      const surf = this.water.heightAt(sp.x, sp.z);
      const len = Math.max(1, Math.min(12, surf - groundHeight(sp.x, sp.z)) + 1) * (0.6 + purity * 0.6);
      _m.makeTranslation(sp.x, surf - 0.05, sp.z);
      this.shafts.setMatrixAt(n, _m);
      this.shaftAttr.setXYZW(n, sp.seed, sp.w, len, sp.str);
      n++;
    }
    this.shafts.instanceMatrix.needsUpdate = true;
    this.shaftAttr.needsUpdate = true;
    // motes
    const mu = this.moteU;
    mu.uTime.value += dt;
    mu.uCam.value.copy(cam);
    mu.uPixelRatio.value = pixelRatio;
    mu.uLight.value.copy(sky.hemi.color).multiplyScalar(0.25 + 0.75 * day);
    mu.uWater.value.copy(this.water.uniforms.uShallow.value).multiplyScalar(0.4 + 0.6 * day);
  }
}
