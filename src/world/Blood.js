import * as THREE from 'three';

// Blood, and the Asuras' ichor, as liquid that obeys the world:
//   spray(at, dir, o)  droplets thrown out along the blow, falling under gravity, stretched along
//                      their flight; each that reaches the ground leaves a splat where it lands
//                      (on the real tread or takht under it); a killing blow gushes for a moment
//   pool(at, size, o)  a pool spreading under a fallen body
// Splats are wet and glossy at first and dry dark and matte over a minute; the monsoon washes
// them away. Ichor (an Asura's) is near-black red with embers in it that glow and cool; a man's
// blood is red. Droplets that strike Prady stain him instead (Bloodied.js).
//
// Settings: Gore (off | stylised | full). Two instanced draws; nothing drawn when none is alive.

const DROPS = 420;
const SPLATS = 160;
const G = 9.8;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export const BLOOD = {
  red: { wet: new THREE.Color(0.2, 0.008, 0.006), dry: new THREE.Color(0.085, 0.02, 0.014), ember: 0 },
  ichor: { wet: new THREE.Color(0.13, 0.016, 0.012), dry: new THREE.Color(0.05, 0.02, 0.015), ember: 1 },
};

const DROP_VERT = /* glsl */ `
attribute vec3 aCol; attribute float aEmber;
varying vec2 vUv; varying vec3 vCol; varying float vEmber;
void main(){ vUv = uv; vCol = aCol; vEmber = aEmber; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }`;
const DROP_FRAG = /* glsl */ `
uniform vec3 uLight;
varying vec2 vUv; varying vec3 vCol; varying float vEmber;
void main(){
  // a droplet: round head, tapering tail (x along the flight, y across)
  vec2 d = vec2(vUv.x * 2.0 - 1.0, (vUv.y * 2.0 - 1.0) / max(0.25, 1.0 - vUv.x * 0.7));
  float r = length(d * vec2(0.6, 1.0));
  if (r > 1.0) discard;
  float a = smoothstep(1.0, 0.6, r);
  // a glint where the light catches the wet surface
  float glint = smoothstep(0.35, 0.0, length(d - vec2(0.45, 0.35)));
  vec3 col = vCol * uLight + vec3(0.6, 0.35, 0.3) * glint * 0.35 * uLight;
  col += vec3(1.6, 0.5, 0.1) * vEmber;
  gl_FragColor = vec4(col, a);
}`;

const SPLAT_VERT = /* glsl */ `
attribute vec4 aSplat; // seed, born (s), kind (0 red, 1 ichor), shape (0 drop .. 1 pool)
attribute float aWash; // how much rain had fallen when it landed
varying vec2 vUv; varying vec4 vS; varying float vWash;
void main(){ vUv = uv; vS = aSplat; vWash = aWash; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }`;
const SPLAT_FRAG = /* glsl */ `
uniform vec3 uLight; uniform float uNow; uniform float uWash; uniform vec3 uRedWet; uniform vec3 uRedDry; uniform vec3 uIchWet; uniform vec3 uIchDry;
varying vec2 vUv; varying vec4 vS; varying float vWash;
float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
void main(){
  vec2 p = vUv * 2.0 - 1.0;
  float seed = vS.x;
  float age = uNow - vS.y;
  // the main splash: a ragged blob (a pool's edge smoother), and a scatter of satellite drops
  float a = atan(p.y, p.x);
  float rag = mix(0.32, 0.1, vS.w);
  float edge = 0.55 + rag * (vn(vec2(a * 2.2 + seed * 13.0, seed)) - 0.5) * 2.0 + 0.08 * sin(a * 7.0 + seed * 40.0);
  // (a pool spreads out over its first seconds)
  float grow = mix(1.0, smoothstep(0.0, 3.5, age), vS.w);
  float r = length(p) / max(0.05, grow);
  float m = smoothstep(edge, edge - 0.06, r);
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    vec2 c = vec2(cos(seed * 21.0 + fi * 2.4), sin(seed * 17.0 + fi * 2.4)) * (0.62 + 0.3 * h2(vec2(seed, fi)));
    float rr = 0.06 + 0.07 * h2(vec2(fi, seed));
    m = max(m, smoothstep(rr, rr * 0.6, length(p - c)) * (1.0 - vS.w));
  }
  // drying (a minute), the rain washing it (uWash), and gone after a few minutes
  float dry = smoothstep(4.0, 70.0, age);
  float fade = (1.0 - smoothstep(200.0, 240.0, age)) * (1.0 - clamp(uWash - vWash, 0.0, 1.0));
  m *= fade;
  if (m < 0.01) discard;
  vec3 wet = mix(uRedWet, uIchWet, vS.z);
  vec3 dried = mix(uRedDry, uIchDry, vS.z);
  vec3 col = mix(wet, dried, dry) * uLight;
  // wet: a sheen of the sky on it, strongest toward the middle of the pool
  col += uLight * vec3(0.18, 0.12, 0.12) * (1.0 - dry) * smoothstep(0.9, 0.2, r) * 0.6;
  // ichor: embers in it, glowing for a few seconds, then cooling to nothing
  if (vS.z > 0.5) {
    float e = step(0.93, vn(p * 9.0 + seed * 31.0)) * (1.0 - smoothstep(1.0, 6.0, age));
    col += vec3(2.2, 0.7, 0.12) * e;
  }
  gl_FragColor = vec4(col, m * mix(0.95, 0.8, dry));
}`;

export class Blood {
  /** heightAt(x, z): the ground under a point (VFX's: treads and takhts included). */
  constructor(scene, { heightAt, light }) {
    this.heightAt = heightAt;
    this.gore = 'full';
    this.now = 0;
    this.wash = 0; // (the rain's work on every splat so far: Game feeds it)
    this.bloodied = null; // Prady's stains (Bloodied.js): droplets that hit him go there
    this.player = null; // { position, feetY } to test droplets against
    // droplets
    const dg = new THREE.PlaneGeometry(1, 1);
    dg.setAttribute('aCol', new THREE.InstancedBufferAttribute(new Float32Array(DROPS * 3), 3));
    dg.setAttribute('aEmber', new THREE.InstancedBufferAttribute(new Float32Array(DROPS), 1));
    this.dropMat = new THREE.ShaderMaterial({ uniforms: { uLight: { value: light } }, vertexShader: DROP_VERT, fragmentShader: DROP_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.drops = new THREE.InstancedMesh(dg, this.dropMat, DROPS);
    this.drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.drops.frustumCulled = false;
    this.drops.count = 0;
    this.drops.renderOrder = 6;
    scene.add(this.drops);
    this.dropList = [];
    // splats: flat quads on the ground, their shape and age in the shader
    const sg = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    sg.setAttribute('aSplat', new THREE.InstancedBufferAttribute(new Float32Array(SPLATS * 4), 4));
    sg.setAttribute('aWash', new THREE.InstancedBufferAttribute(new Float32Array(SPLATS), 1));
    this.splatMat = new THREE.ShaderMaterial({
      uniforms: { uLight: { value: light }, uNow: { value: 0 }, uWash: { value: 0 }, uRedWet: { value: BLOOD.red.wet }, uRedDry: { value: BLOOD.red.dry }, uIchWet: { value: BLOOD.ichor.wet }, uIchDry: { value: BLOOD.ichor.dry } },
      vertexShader: SPLAT_VERT,
      fragmentShader: SPLAT_FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.splats = new THREE.InstancedMesh(sg, this.splatMat, SPLATS);
    this.splats.frustumCulled = false;
    this.splats.count = 0;
    this.splats.renderOrder = 1;
    scene.add(this.splats);
    this.splatI = 0;
    this.splatN = 0;
    this.pending = []; // gushes and pools still to come
  }

  get on() {
    return this.gore !== 'off';
  }

  /**
   * A wound: at (world), dir (the blow's push, xz), o.kind 'red' | 'ichor', o.amount (1 a cut,
   * ~2 a heavy blow), o.kill (a gush that pulses a moment after).
   */
  spray(at, dir, { kind = 'red', amount = 1, kill = false } = {}) {
    if (!this.on) return;
    const k = this.gore === 'stylised' ? 0.4 : 1;
    const l = Math.hypot(dir.x, dir.z) || 1;
    const dx = dir.x / l;
    const dz = dir.z / l;
    const n = Math.round((10 + 14 * amount) * k);
    // most along the blow; some splash back, toward whoever struck it
    for (let i = 0; i < n; i++) {
      const back = Math.random() < 0.28 ? -1 : 1;
      this.drop(at, dx * back, dz * back, kind, back > 0 ? 2 + Math.random() * 3.5 * amount : 1.2 + Math.random() * 2.2);
    }
    if (kill) {
      // the gush: a few more pulses from the wound, weaker each time
      for (let j = 1; j <= 3; j++) this.pending.push({ t: j * 0.18, run: () => { for (let i = 0; i < Math.round(9 * k / j); i++) this.drop(at, dx, dz, kind, 1.2 + Math.random() * 2.2 / j); } });
    }
  }

  drop(at, dx, dz, kind, speed) {
    if (this.dropList.length >= DROPS) this.dropList.shift();
    // out along the blow, fanned, thrown up a little
    const side = (Math.random() - 0.5) * 1.4;
    const vx = (dx + -dz * side) * speed;
    const vz = (dz + dx * side) * speed;
    const vy = 0.5 + Math.random() * 2.4;
    const B = BLOOD[kind];
    this.dropList.push({ p: new THREE.Vector3(at.x, at.y, at.z), v: new THREE.Vector3(vx, vy, vz), s: 0.012 + Math.random() * 0.022, kind, col: B.wet, ember: kind === 'ichor' && Math.random() < 0.25 ? 0.6 : 0, t: 0 });
  }

  /** A pool under a fallen body (after `delay`, spreading for a few seconds). */
  pool(at, size = 0.8, { kind = 'ichor', delay = 0.6 } = {}) {
    if (this.gore !== 'full') return;
    this.pending.push({ t: delay, run: () => this.splat(at.x, at.z, size, kind, 1) });
  }

  splat(x, z, size, kind, shape = 0) {
    if (!this.heightAt) return;
    // (keep it on one tread: near a step's edge it shrinks rather than hang in the air)
    const y = this.heightAt(x, z);
    let s = size;
    for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (Math.abs(this.heightAt(x + ox * s * 0.45, z + oz * s * 0.45) - y) > 0.04) s *= 0.6;
    const i = this.splatI;
    this.splatI = (this.splatI + 1) % SPLATS;
    this.splatN = Math.min(SPLATS, this.splatN + 1);
    _q.setFromAxisAngle(UP, Math.random() * Math.PI * 2);
    _m.compose(_v.set(x, y + 0.005, z), _q, _s.set(s, 1, s));
    this.splats.setMatrixAt(i, _m);
    const A = this.splats.geometry.attributes.aSplat;
    A.setXYZW(i, Math.random(), this.now, kind === 'ichor' ? 1 : 0, shape);
    A.needsUpdate = true;
    const W = this.splats.geometry.attributes.aWash;
    W.setX(i, this.wash);
    W.needsUpdate = true;
    this.splats.count = this.splatN;
    this.splats.instanceMatrix.needsUpdate = true;
  }

  update(dt, camera) {
    this.now += dt;
    if (this.gore === 'off' && (this.splatN || this.dropList.length)) this.clear();
    this.splatMat.uniforms.uNow.value = this.now;
    this.splatMat.uniforms.uWash.value = this.wash;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const P = this.pending[i];
      P.t -= dt;
      if (P.t <= 0) {
        this.pending.splice(i, 1);
        P.run();
      }
    }
    const L = this.dropList;
    const M = this.drops;
    const col = M.geometry.attributes.aCol;
    const emb = M.geometry.attributes.aEmber;
    const pl = this.player;
    let n = 0;
    for (let i = L.length - 1; i >= 0; i--) {
      const d = L[i];
      d.t += dt;
      d.v.y -= G * dt;
      d.v.multiplyScalar(Math.max(0, 1 - dt * 0.4));
      d.p.addScaledVector(d.v, dt);
      // on Prady: it stains him where it struck
      if (pl && this.bloodied && d.t > 0.02) {
        const px = d.p.x - pl.position.x;
        const pz = d.p.z - pl.position.z;
        const py = d.p.y - pl.feetY;
        if (py > 0.1 && py < 1.85 && px * px + pz * pz < 0.08) {
          this.bloodied.hit(d.p, d.kind, 0.35);
          L.splice(i, 1);
          continue;
        }
      }
      const ground = this.heightAt ? this.heightAt(d.p.x, d.p.z) : -1e9;
      if (d.p.y <= ground || d.t > 3) {
        if (d.p.y <= ground + 0.2 && this.gore !== 'off') this.splat(d.p.x, d.p.z, d.s * (6 + Math.random() * 8), d.kind, 0);
        L.splice(i, 1);
      }
    }
    for (const d of L) {
      const sp = d.v.length();
      const len = Math.max(d.s * 1.6, sp * 0.022);
      const dir = _a.copy(d.v).normalize();
      const view = _w.subVectors(camera.position, d.p).normalize();
      const side = _b.crossVectors(dir, view).normalize();
      const nrm = _v.crossVectors(side, dir);
      _m.makeBasis(dir, side, nrm);
      _q.setFromRotationMatrix(_m);
      _m.compose(_s.copy(d.p).addScaledVector(dir, -len * 0.5), _q, _w.set(len, d.s, 1));
      M.setMatrixAt(n, _m);
      col.setXYZ(n, d.col.r, d.col.g, d.col.b);
      emb.setX(n, d.ember * Math.max(0, 1 - d.t * 1.5));
      n++;
    }
    M.count = n;
    M.visible = n > 0;
    if (n) {
      M.instanceMatrix.needsUpdate = true;
      col.needsUpdate = true;
      emb.needsUpdate = true;
    }
    this.splats.visible = this.splatN > 0;
  }

  /** Washed clean (a new journey, a test jump). */
  clear() {
    this.dropList.length = 0;
    this.pending.length = 0;
    this.splatN = 0;
    this.splats.count = 0;
  }
}

// ---------------------------------------------------------------- its sounds (made in code)
const noiseBuf = (ctx, secs, fill) => {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * secs);
  const b = ctx.createBuffer(1, n, sr);
  fill(b.getChannelData(0), sr, n);
  return b;
};

/** A wet splat: a short, dark, low burst with a sticky click at its start. */
export function synthBloodSplat(ctx) {
  return noiseBuf(ctx, 0.22, (d, sr, n) => {
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const env = Math.exp(-t * 26) * (t < 0.004 ? t / 0.004 : 1);
      lp += ((Math.random() * 2 - 1) - lp) * (0.12 + 0.3 * Math.exp(-t * 40));
      d[i] = (lp * 1.6 + Math.sin(t * 2 * Math.PI * (140 - t * 300)) * 0.35 * Math.exp(-t * 40)) * env;
    }
  });
}

/** A gush: a burbling pulse of liquid, three throbs falling away. */
export function synthBloodGush(ctx) {
  return noiseBuf(ctx, 0.75, (d, sr, n) => {
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const throb = Math.max(0, Math.sin(t * Math.PI * 2 * 4.2)) ** 2;
      const env = Math.exp(-t * 3.2) * (0.35 + 0.65 * throb);
      const bub = Math.sin(t * 2 * Math.PI * (90 + 60 * Math.sin(t * 37))) * 0.25;
      lp += ((Math.random() * 2 - 1) - lp) * 0.09;
      d[i] = (lp * 1.8 + bub) * env;
    }
  });
}

