import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { softDotTexture } from '../utils/textures.js';

// How the Asuras look: darkness given a body. Any humanoid mesh (a Rocketbox person, a Mixamo
// creature) is re-dressed in a skin of wet obsidian with ember veins that pulse like breath, a
// cold violet rim where the light grazes it, horns, two coal eyes, and smoke and sparks rising
// off it. uDissolve burns the body in (rising from the river) or out (falling): noise eats it
// from the feet up with a glowing edge. uHurt flashes the veins white-hot when a blow lands.

const VEIN = new THREE.Color(1.0, 0.32, 0.06);
const RIM = new THREE.Color(0.5, 0.16, 0.06);

const noiseGLSL = /* glsl */ `
float ah(vec3 p){ p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float an(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(ah(i), ah(i + vec3(1,0,0)), f.x), mix(ah(i + vec3(0,1,0)), ah(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(ah(i + vec3(0,0,1)), ah(i + vec3(1,0,1)), f.x), mix(ah(i + vec3(0,1,1)), ah(i + vec3(1,1,1)), f.x), f.y), f.z); }
float afbm(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * an(p); p *= 2.07; a *= 0.5; } return s; }
`;

/**
 * Turn a mesh's material into an Asura skin. Returns the uniforms (shared by every material of
 * that body): uDissolve 0 solid .. 1 gone, uHurt 0..1 flash, uRage 0..1 (veins brighter, the
 * boss's later phases), uTime.
 */
export function asuraMaterial(src, uniforms, { scale = 1 } = {}) {
  const m = new THREE.MeshStandardMaterial({
    map: src.map || null,
    normalMap: src.normalMap || null,
    color: new THREE.Color(0.11, 0.075, 0.09),
    roughness: 0.3,
    metalness: 0.15,
    envMapIntensity: 0.6,
    side: THREE.FrontSide,
  });
  if (m.normalMap) m.normalScale.set(1.2, 1.2);
  m.userData.asura = true;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.uniforms.uVeinScale = { value: 3.2 / scale };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vAPos;\nvarying float vAY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAPos = position;\nvAY = position.y;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uDissolve; uniform float uHurt; uniform float uRage; uniform float uTime; uniform float uVeinScale; uniform float uFeetY; uniform float uHeadY; uniform float uGhost;
varying vec3 vAPos; varying float vAY;
${noiseGLSL}`
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
float h01 = clamp((vAY - uFeetY) / max(0.01, uHeadY - uFeetY), 0.0, 1.0);
float dn = afbm(vAPos * 6.0) * 0.55 + h01 * 0.45; // burns from the feet up, ragged
float edge = dn - uDissolve * 1.12;
if (uDissolve > 0.001 && edge < 0.0) discard;
// a giant between the camera and Prady thins to a screen of embers so Prady stays in sight
if (uGhost > 0.001 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) < uGhost) discard;`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
// keep the shape of the clothes / muscles, lose their colours
float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
diffuseColor.rgb = vec3(0.045, 0.03, 0.035) * (0.6 + 0.8 * lum);`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  vec3 p = vAPos * uVeinScale;
  float n = afbm(p + vec3(0.0, uTime * 0.05, 0.0));
  // thin cracks of cooling lava: a ridged line, kept only where a second noise lets it through
  float crack = 1.0 - smoothstep(0.0, 0.022, abs(n - 0.5));
  float mask = smoothstep(0.42, 0.62, afbm(p * 0.6 + 3.7));
  float hot = 1.0 - smoothstep(0.0, 0.008, abs(n - 0.5));
  float breath = 0.6 + 0.4 * sin(uTime * 2.1 + n * 9.0);
  float v = (crack * mask + hot * mask * 1.5) * breath * (0.75 + uRage * 1.5);
  totalEmissiveRadiance += vec3(${VEIN.r.toFixed(3)}, ${VEIN.g.toFixed(3)}, ${VEIN.b.toFixed(3)}) * v * (2.0 + uHurt * 7.0);
  totalEmissiveRadiance += vec3(1.0, 0.85, 0.6) * uHurt * 0.35;
  // the dissolving edge glows
  if (uDissolve > 0.001) totalEmissiveRadiance += vec3(1.0, 0.45, 0.1) * (1.0 - smoothstep(0.0, 0.09, edge)) * 6.0;
}`
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
{
  float fr = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
  reflectedLight.directSpecular += vec3(${RIM.r.toFixed(3)}, ${RIM.g.toFixed(3)}, ${RIM.b.toFixed(3)}) * fr * 0.22;
}`
      );
  };
  m.customProgramCacheKey = () => 'asura-skin';
  return m;
}

/** Two curved horns (merged), built along +Y from the skull, sweeping back and out. */
export function hornsGeometry(size = 1) {
  const parts = [];
  for (const side of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      pts.push(new THREE.Vector3(side * (0.045 + t * 0.07), t * 0.17, -t * t * 0.13).multiplyScalar(size));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const g = new THREE.TubeGeometry(curve, 12, 0.022 * size, 7, false);
    // taper toward the tip
    const p = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const t = Math.floor(i / 8) / 12;
      const c = curve.getPoint(Math.min(1, t));
      v.sub(c).multiplyScalar(1 - t * 0.92).add(c);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    parts.push(g);
  }
  return mergeGeometries(parts);
}

export function hornMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 0.35, metalness: 0.3, emissive: 0x3a0800, emissiveIntensity: 0.6 });
}

/**
 * One shared particle system for every Asura: dark smoke rising off their bodies and embers
 * spat when they're struck or burn away. emit*(…) from gameplay; update(dt) per frame.
 */
export class AsuraParticles {
  constructor(n = 900) {
    this.n = n;
    this.next = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n).fill(1);
    this.kind = new Float32Array(n); // 0 smoke, 1 ember
    this.size = new Float32Array(n);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aMax', new THREE.BufferAttribute(this.max, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aKind', new THREE.BufferAttribute(this.kind, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uMap: { value: softDotTexture() }, uPixelRatio: { value: 1 }, uLight: { value: new THREE.Color(1, 1, 1) } };
    // smoke: dark, normal blending (it hides what is behind); embers: drawn hot and bright
    this.smoke = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: /* glsl */ `
          attribute float aLife; attribute float aMax; attribute float aKind; attribute float aSize;
          uniform float uPixelRatio; varying float vA; varying float vK;
          void main(){
            vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
            float t = 1.0 - aLife / max(aMax, 0.001);
            vK = aKind;
            vA = aLife > 0.0 ? (aKind < 0.5 ? smoothstep(0.0, 0.15, t) * (1.0 - t) * 0.55 : (1.0 - t)) : 0.0;
            float s = aKind < 0.5 ? aSize * (0.6 + t * 1.6) : aSize;
            gl_PointSize = aLife > 0.0 ? clamp(s * 520.0 * uPixelRatio / max(-mv.z, 0.4), 1.0, 220.0 * uPixelRatio) : 0.0;
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap; uniform vec3 uLight; varying float vA; varying float vK;
          void main(){
            float d = length(gl_PointCoord - 0.5) * 2.0;
            float a = texture2D(uMap, gl_PointCoord).a * vA;
            if (vK < 0.5) { a *= smoothstep(1.0, 0.2, d); if (a < 0.01) discard; gl_FragColor = vec4(vec3(0.05, 0.03, 0.04) * uLight, a); }
            else { float c = exp(-d * d * 5.0); if (c * vA < 0.02) discard; gl_FragColor = vec4(vec3(2.6, 0.9, 0.25) * c * vA, c * vA); }
          }`,
        transparent: true,
        depthWrite: false,
      })
    );
    this.smoke.frustumCulled = false;
    this.smoke.layers.set(2); // never in the water mirror
    this.smoke.visible = false;
    this.alive = 0;
  }

  _spawn(x, y, z, vx, vy, vz, life, kind, size) {
    const i = this.next++ % this.n;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.life[i] = life;
    this.max[i] = life;
    this.kind[i] = kind;
    this.size[i] = size;
  }

  /** Smoke curling off a body (call a few times a second per Asura). */
  emitSmoke(x, y, z, scale = 1) {
    this._spawn(x + (Math.random() - 0.5) * 0.4 * scale, y, z + (Math.random() - 0.5) * 0.4 * scale, (Math.random() - 0.5) * 0.25, 0.55 + Math.random() * 0.4, (Math.random() - 0.5) * 0.25, 1.4 + Math.random(), 0, (0.22 + Math.random() * 0.2) * scale);
  }

  /** A spray of embers (a blow landing, a body burning away). */
  emitEmbers(x, y, z, n, dir = null, power = 1) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const s = (0.6 + Math.random() * 2.2) * power;
      this._spawn(x, y, z, Math.cos(a) * s + (dir ? dir.x * 2.5 * power : 0), Math.random() * 2.8 * power + 0.5, Math.sin(a) * s + (dir ? dir.z * 2.5 * power : 0), 0.5 + Math.random() * 0.7, 1, 0.035 + Math.random() * 0.03);
    }
  }

  update(dt, pixelRatio, light) {
    this.uniforms.uPixelRatio.value = pixelRatio;
    if (light) this.uniforms.uLight.value.copy(light);
    let alive = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.life[i] = 0;
        continue;
      }
      alive++;
      const k = this.kind[i];
      const j = i * 3;
      if (k > 0.5) this.vel[j + 1] -= 7.5 * dt; // embers fall
      else {
        this.vel[j] *= 1 - dt * 0.5;
        this.vel[j + 2] *= 1 - dt * 0.5;
      }
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
    }
    this.alive = alive;
    this.smoke.visible = alive > 0;
    if (alive) {
      const a = this.smoke.geometry.attributes;
      a.position.needsUpdate = a.aLife.needsUpdate = a.aMax.needsUpdate = a.aKind.needsUpdate = a.aSize.needsUpdate = true;
    }
  }
}

/** The coal-red eyes: a pair of additive sprites (one draw call for every Asura). */
export class AsuraEyes {
  constructor(n = 24) {
    this.n = n;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3);
    this.glow = new Float32Array(n);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aGlow', new THREE.BufferAttribute(this.glow, 1).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        uniforms: { uPixelRatio: { value: 1 } },
        vertexShader: /* glsl */ `attribute float aGlow; uniform float uPixelRatio; varying float vG;
          void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; vG = aGlow;
            gl_PointSize = aGlow > 0.0 ? clamp(aGlow * 0.09 * 600.0 * uPixelRatio / max(-mv.z, 0.4), 2.0, 40.0 * uPixelRatio) : 0.0; }`,
        fragmentShader: /* glsl */ `varying float vG; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = exp(-d * d * 6.0) * min(vG, 1.5); if (a < 0.02) discard;
          gl_FragColor = vec4(vec3(3.0, 0.9, 0.3) * a + vec3(1.0) * pow(a, 4.0), a); }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.points.frustumCulled = false;
    this.points.layers.set(2);
    this.count = 0;
  }

  begin() {
    this.count = 0;
  }

  add(p, glow) {
    if (this.count >= this.n) return;
    this.pos.set([p.x, p.y, p.z], this.count * 3);
    this.glow[this.count++] = glow;
  }

  end(pixelRatio) {
    for (let i = this.count; i < this.n; i++) this.glow[i] = 0;
    this.points.material.uniforms.uPixelRatio.value = pixelRatio;
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.aGlow.needsUpdate = true;
    this.points.visible = this.count > 0;
  }
}

/** Embers hissing where a blow bites into an Asura: a sizzle with a few crackles. */
export function synthEmberHiss(ctx) {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * 0.7);
  const b = ctx.createBuffer(1, n, sr);
  const d = b.getChannelData(0);
  let hp = 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const w = Math.random() * 2 - 1;
    hp = 0.7 * (hp + w - prev);
    prev = w;
    const env = Math.min(1, t * 40) * Math.exp(-t * 4.5);
    const crackle = Math.random() < 0.0016 * Math.exp(-t * 3) ? (Math.random() - 0.5) * 3 : 0;
    d[i] = hp * env * 0.35 + crackle;
  }
  return b;
}

/** A dog's howl in the night (Bhairav's hound): a long rising-falling voice with a waver. */
export function synthHowl(ctx) {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * 2.6);
  const b = ctx.createBuffer(1, n, sr);
  const d = b.getChannelData(0);
  let ph = 0;
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const k = t / 2.6;
    // pitch: a climb to the cry, a long hold that sags, a fall
    const f0 = 520 + 260 * Math.sin(Math.min(1, k * 2.2) * Math.PI * 0.5) - 180 * Math.max(0, k - 0.62) * 2.6;
    const vib = 1 + 0.012 * Math.sin(t * 2 * Math.PI * 5.5);
    ph += (2 * Math.PI * f0 * vib) / sr;
    const env = Math.min(1, t * 3) * (1 - Math.max(0, (k - 0.75) / 0.25)) ** 1.5;
    const tone = Math.sin(ph) * 0.6 + Math.sin(2 * ph) * 0.25 + Math.sin(3 * ph) * 0.1;
    const w = Math.random() * 2 - 1;
    lp += (w - lp) * 0.08;
    d[i] = (tone * 0.85 + lp * 0.35) * env * 0.5;
  }
  return b;
}
