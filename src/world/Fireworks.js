import * as THREE from 'three';
import { RNG } from '../utils/math.js';
import { ghatById, ghatToWorld, GHAT_SEGMENTS, PROFILE_LEN } from './WorldLayout.js';

// Fireworks over the Ganga. On festival nights (Dev Deepawali, once the Maha Aarti is restored)
// boats out on the river send up volleys in front of the ghats; on ordinary nights a wedding
// somewhere in the lanes lets off a few now and then. Every rocket is one block of GPU points
// (a rising head with a sparkling tail, then the stars): its whole flight is computed in the
// vertex shader from the launch data, so the CPU only writes a block when a rocket goes up.
// One draw call; the river mirrors it for free.

const TRAIL = 15;
const STARS = 120;
const SUB = 3; // each star draws itself at three moments, a short streak behind it
const PER = 1 + TRAIL + STARS * SUB;
const ROCKETS = 14;

const VS = /* glsl */ `
attribute vec4 aLaunch; // xyz launch point, w launch time
attribute vec4 aApex;   // xyz burst point, w rise time
attribute vec4 aDir;    // xyz star direction (unit), w star speed
attribute vec4 aCol;    // rgb, w kind (0 peony, 1 willow, 2 crackle, 3 ring)
attribute float aRole;  // 0 head, 1..TRAIL trail, > TRAIL star
uniform float uTime;
uniform float uPixelRatio;
varying vec3 vCol;
varying float vA;
varying float vHot;
float h1(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float t = uTime - aLaunch.w;
  float rise = aApex.w;
  vec3 p = vec3(0.0, -1000.0, 0.0);
  float a = 0.0;
  float size = 0.0;
  vHot = 0.0;
  vCol = aCol.rgb;
  if (aRole <= ${TRAIL}.5) {
    // the rocket: eases up to the burst point, a short tail of sparks behind it
    float lag = aRole * 0.035;
    float tt = t - lag;
    if (tt > 0.0 && t < rise) {
      float k = tt / rise;
      float e = 1.0 - (1.0 - k) * (1.0 - k);
      p = mix(aLaunch.xyz, aApex.xyz, e);
      p.x += sin(tt * 9.0 + aLaunch.w) * 0.25 * k;
      a = aRole < 0.5 ? 1.0 : (1.0 - aRole / ${TRAIL}.0) * 0.7 * step(0.5, h1(aRole + floor(t * 30.0)));
      size = aRole < 0.5 ? 0.5 : 0.28;
      vCol = vec3(1.0, 0.75, 0.4) * 3.0;
      vHot = 1.0;
    }
  } else {
    float sub = mod(aRole - ${TRAIL}.0 - 1.0, ${SUB}.0);
    float s = t - rise - sub * 0.045;
    float kind = aCol.w;
    float life = kind > 0.5 && kind < 1.5 ? 3.6 : 2.2;
    if (s > 0.0 && s < life) {
      float drag = kind > 0.5 && kind < 1.5 ? 1.7 : 2.3;
      float travel = (1.0 - exp(-drag * s)) / drag;
      float g = kind > 0.5 && kind < 1.5 ? 4.5 : 2.6;
      p = aApex.xyz + aDir.xyz * aDir.w * travel;
      p.y -= 0.5 * g * s * s;
      float k = s / life;
      a = pow(1.0 - k, 0.8);
      // crackle: the stars break into white flickers at the end
      if (kind > 1.5 && kind < 2.5 && k > 0.55) {
        a *= step(0.45, h1(aRole * 3.1 + floor(uTime * 24.0)));
        vCol = vec3(4.0, 3.8, 3.4);
      }
      size = mix(0.55, 0.32, k) * (1.0 - sub * 0.22);
      a *= 1.0 - sub * 0.32;
      vHot = smoothstep(0.15, 0.0, s); // the white flash at the instant of the burst
    }
  }
  vA = a;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = a > 0.001 ? clamp(size * 1100.0 * uPixelRatio / max(-mv.z, 1.0), 2.0, 28.0 * uPixelRatio) : 0.0;
}`;

const FS = /* glsl */ `
varying vec3 vCol;
varying float vA;
varying float vHot;
void main() {
  if (vA < 0.004) discard;
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float core = exp(-d * d * 32.0);
  float halo = exp(-d * d * 9.0) * 0.4;
  vec3 col = mix(vCol, vec3(4.0), vHot * 0.7) * (core * 1.6 + halo);
  gl_FragColor = vec4(col * vA, 1.0);
}`;

const PALETTE = [
  [3.6, 0.9, 0.2], // marigold
  [3.4, 0.35, 0.35], // red
  [0.5, 2.6, 0.9], // green
  [0.6, 1.2, 4.0], // blue
  [3.4, 2.6, 0.6], // gold
  [2.8, 0.6, 3.0], // magenta
  [3.4, 3.2, 3.0], // white
];

export class Fireworks {
  constructor({ audio } = {}) {
    this.audio = audio;
    this.rng = new RNG(31337);
    const n = PER * ROCKETS;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.attr = {};
    for (const [name, size] of [['aLaunch', 4], ['aApex', 4], ['aDir', 4], ['aCol', 4], ['aRole', 1]]) {
      const a = new THREE.BufferAttribute(new Float32Array(n * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, a);
      this.attr[name] = a;
    }
    for (let r = 0; r < ROCKETS; r++) for (let i = 0; i < PER; i++) this.attr.aRole.array[r * PER + i] = i;
    // parked far in the past so nothing shows
    for (let i = 0; i < n; i++) this.attr.aLaunch.array[i * 4 + 3] = -1000;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VS,
      fragmentShader: FS,
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.next = 0;
    this.time = 0;
    this.volleyTimer = 4;
    this.queue = [];
    this.flash = 0; // brief glow for the sky / water after a big burst
    const dash = ghatById('dashashwamedh');
    this.festivalCentre = ghatToWorld(dash, dash.width / 2, PROFILE_LEN + 70);
  }

  /** Send one rocket from `from` to burst at `apex`. size: 1 big festival shell, 0.5 small. */
  launch(from, apex, { size = 1, kind, color, delay = 0 } = {}) {
    const rng = this.rng;
    const r = this.next;
    this.next = (this.next + 1) % ROCKETS;
    kind = kind ?? rng.pick([0, 0, 1, 2, 3]);
    const col = color || rng.pick(PALETTE);
    const col2 = rng.chance(0.35) ? rng.pick(PALETTE) : col;
    const rise = 1.3 + size * 1.2;
    // shells open 40-60 m wide (drag sets how far the stars fly: speed / drag)
    const speed = (kind === 1 ? 42 : 62) * (0.45 + size * 0.55);
    // a ring lies in a random tilted plane
    const ax = new THREE.Vector3(rng.range(-1, 1), rng.range(0.4, 1), rng.range(-1, 1)).normalize();
    const u = new THREE.Vector3().crossVectors(ax, new THREE.Vector3(0, 1, 0.3)).normalize();
    const w = new THREE.Vector3().crossVectors(ax, u);
    const A = this.attr;
    const jitter = Array.from({ length: STARS }, () => rng.range(-0.05, 0.05));
    const spread = Array.from({ length: STARS }, () => rng.next());
    for (let i = 0; i < PER; i++) {
      const k = r * PER + i;
      A.aLaunch.array.set([from.x, from.y, from.z, this.time + delay], k * 4);
      A.aApex.array.set([apex.x, apex.y, apex.z, rise], k * 4);
      let dx;
      let dy;
      let dz;
      const star = Math.max(0, Math.floor((i - TRAIL - 1) / SUB)); // the sub-points of one star share it
      if (kind === 3) {
        const a = (star / STARS) * Math.PI * 2;
        dx = u.x * Math.cos(a) + w.x * Math.sin(a);
        dy = u.y * Math.cos(a) + w.y * Math.sin(a);
        dz = u.z * Math.cos(a) + w.z * Math.sin(a);
      } else {
        // even spread on a sphere (golden spiral) with a little jitter
        const y = 1 - (2 * (star + 0.5)) / STARS;
        const rr = Math.sqrt(1 - y * y);
        const th = star * 2.39996 + jitter[star];
        dx = Math.cos(th) * rr;
        dy = y;
        dz = Math.sin(th) * rr;
      }
      const sp = speed * (kind === 3 ? 1 : 0.88 + spread[star] * 0.16);
      A.aDir.array.set([dx, dy, dz, sp], k * 4);
      const c = star % 2 ? col : col2;
      A.aCol.array.set([c[0], c[1], c[2], kind === 1 ? 1 : kind], k * 4);
    }
    for (const a of Object.values(A)) {
      if (a === A.aRole) continue;
      // ranges add up until the next upload (several rockets can go up in one frame)
      a.addUpdateRange(r * PER * a.itemSize, PER * a.itemSize);
      a.needsUpdate = true;
    }
    // sound: the whistle now, the bang when it bursts (late by the distance it has to travel)
    const cam = this._cam;
    if (this.audio && cam) {
      const d = cam.distanceTo(new THREE.Vector3(apex.x, apex.y, apex.z));
      if (d < 600) {
        const v = Math.min(1, 90 / d) * (0.5 + size * 0.5);
        this.audio.play('fw-whistle', { volume: v * 0.35, rate: 0.9 + rng.next() * 0.3, delay });
        this.audio.play('fw-boom', { volume: v, rate: 0.85 + rng.next() * 0.3 - size * 0.15, delay: delay + rise + d / 343 });
        if (kind === 2) this.audio.play('fw-crackle', { volume: v * 0.7, delay: delay + rise + 1.2 + d / 343 });
      }
    }
    this.queue.push({ at: this.time + delay + rise, size });
    this.liveUntil = Math.max(this.liveUntil || 0, this.time + delay + rise + 4);
    this.last = { x: apex.x, y: apex.y, z: apex.z };
  }

  /** festival: a full show over the river; night: an occasional wedding in the lanes. */
  update(dt, { camera, pixelRatio, night, festival, raining }) {
    this._cam = camera.position;
    this.time += dt;
    const u = this.material.uniforms;
    u.uTime.value = this.time;
    u.uPixelRatio.value = pixelRatio;
    this.flash *= Math.exp(-dt * 5);
    this.points.visible = this.time < (this.liveUntil || 0);
    for (const q of this.queue) if (q.at <= this.time) this.flash = Math.min(1, this.flash + 0.35 * q.size);
    this.queue = this.queue.filter((q) => q.at > this.time);
    if (night < 0.7 || raining) return;
    this.volleyTimer -= dt;
    if (this.volleyTimer > 0) return;
    const rng = this.rng;
    if (festival) {
      this.volleyTimer = rng.range(5, 12);
      const n = rng.int(2, 5);
      const c = this.festivalCentre;
      for (let i = 0; i < n; i++) {
        const from = { x: c.x + rng.range(-110, 110), y: 0.6, z: c.z + rng.range(-25, 25) };
        const apex = { x: from.x + rng.range(-8, 8), y: rng.range(55, 95), z: from.z + rng.range(-8, 8) };
        this.launch(from, apex, { size: 1, delay: i * rng.range(0.25, 0.7) });
      }
    } else {
      this.volleyTimer = rng.range(70, 160);
      // a baraat somewhere in the city
      const g = rng.pick(GHAT_SEGMENTS);
      const at = ghatToWorld(g, g.width * rng.range(0.2, 0.8), -55);
      const n = rng.int(1, 3);
      for (let i = 0; i < n; i++) this.launch({ x: at.x, y: 12, z: at.z }, { x: at.x + rng.range(-6, 6), y: rng.range(38, 55), z: at.z + rng.range(-6, 6) }, { size: 0.5, delay: i * rng.range(0.8, 2) });
    }
  }
}

// ---------------------------------------------------------------- sounds (made in code)

export function synthWhistle(ctx) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 1.6);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const f = 900 + 1700 * (t / 1.6);
    ph += (f / sr) * Math.PI * 2;
    const env = Math.min(1, t * 8) * Math.exp(-t * 1.2);
    d[i] = (Math.sin(ph) * 0.25 + (Math.random() * 2 - 1) * 0.15) * env;
  }
  return buf;
}

export function synthBoom(ctx) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 2.4);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    let lp2 = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const w = Math.random() * 2 - 1;
      lp += (w - lp) * 0.12;
      lp2 += (lp - lp2) * 0.05;
      const thump = Math.sin(t * 2 * Math.PI * (55 - t * 12)) * Math.exp(-t * 6);
      d[i] = (lp2 * 7 * Math.exp(-t * 1.6) + thump * 0.7 + w * Math.exp(-t * 40) * 0.5) * 0.8;
    }
  }
  return buf;
}

export function synthCrackle(ctx) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 1.8);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let k = 0; k < 160; k++) {
      const at = Math.floor(Math.pow(Math.random(), 0.7) * (len - 400));
      const amp = 0.2 + Math.random() * 0.4;
      for (let i = 0; i < 300; i++) d[at + i] += (Math.random() * 2 - 1) * amp * Math.exp(-i / 40);
    }
  }
  return buf;
}
