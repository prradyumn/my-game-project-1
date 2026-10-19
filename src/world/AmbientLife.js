import * as THREE from 'three';

// The small life of the air:
//   * moths round the lamps after dark (the nearest dozen lamps Game picks for the haze), a few
//     to each, looping and darting, catching the lamp's light
//   * ash off the pyres at Manikarnika, pale flakes drifting down on the wind, turning as they fall
//   * incense from a shrine near him: a thin thread of smoke now and then (VFX smoke)
// Moths and ash are one Points draw each, animated in their shaders from a time uniform.

const MOTHS_PER = 5;
const MAX_LAMPS = 12;
const ASH = 260;

const MOTH_VERT = /* glsl */ `
uniform float uTime; uniform vec3 uLamp[${MAX_LAMPS}]; uniform float uOn; uniform float uPx;
attribute float aLamp; attribute float aSeed;
varying float vA;
void main(){
  int li = int(aLamp);
  vec3 c = uLamp[li];
  float t = uTime * (1.4 + aSeed * 0.9) + aSeed * 40.0;
  // a looping, darting flight round the flame
  vec3 o = vec3(sin(t * 1.3) * 0.35 + sin(t * 3.7) * 0.08, sin(t * 2.1) * 0.22 + 0.15, cos(t * 1.1) * 0.35 + cos(t * 4.3) * 0.07) * (0.7 + aSeed * 0.6);
  vec4 mv = modelViewMatrix * vec4(c + o, 1.0);
  gl_Position = projectionMatrix * mv;
  vA = uOn * step(0.5, length(c)) * (0.6 + 0.4 * sin(t * 9.0));
  gl_PointSize = uPx * 0.045 / max(0.5, -mv.z);
}`;
const MOTH_FRAG = /* glsl */ `
varying float vA;
void main(){ vec2 d = gl_PointCoord - 0.5; if (dot(d, d) > 0.25 || vA < 0.01) discard; gl_FragColor = vec4(vec3(1.0, 0.85, 0.6) * 1.6, vA); }`;

const ASH_VERT = /* glsl */ `
uniform float uTime; uniform vec3 uCenter; uniform vec2 uWind; uniform float uOn; uniform float uPx;
attribute vec3 aOff; attribute float aSeed;
varying float vA;
void main(){
  float life = 9.0;
  float t = mod(uTime * (0.7 + aSeed * 0.5) + aSeed * life, life);
  // up off the fire, then drifting down on the wind, turning
  vec3 p = uCenter + aOff + vec3(uWind.x * t * 1.2 + sin(t * 2.0 + aSeed * 9.0) * 0.4, 3.5 + 1.2 * sin(t * 0.4) - t * 0.35, uWind.y * t * 1.2 + cos(t * 1.7 + aSeed * 7.0) * 0.4);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vA = uOn * smoothstep(0.0, 1.0, t) * (1.0 - smoothstep(life - 2.0, life, t)) * (0.5 + 0.5 * abs(sin(t * 5.0 + aSeed * 20.0)));
  gl_PointSize = uPx * (0.05 + aSeed * 0.04) / max(0.5, -mv.z);
}`;
const ASH_FRAG = /* glsl */ `
varying float vA;
void main(){ vec2 d = gl_PointCoord - 0.5; if (abs(d.x) + abs(d.y) * 1.6 > 0.5 || vA < 0.01) discard; gl_FragColor = vec4(0.72, 0.7, 0.68, vA * 0.8); }`;

export class AmbientLife {
  constructor(scene) {
    // moths
    const n = MAX_LAMPS * MOTHS_PER;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aLamp', new THREE.Float32BufferAttribute(Float32Array.from({ length: n }, (_, i) => Math.floor(i / MOTHS_PER)), 1));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(Float32Array.from({ length: n }, () => Math.random()), 1));
    this.mothU = { uTime: { value: 0 }, uLamp: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector3()) }, uOn: { value: 0 }, uPx: { value: 800 } };
    this.moths = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: this.mothU, vertexShader: MOTH_VERT, fragmentShader: MOTH_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.moths.frustumCulled = false;
    this.moths.name = 'moths';
    scene.add(this.moths);
    // ash
    const a = new THREE.BufferGeometry();
    const off = new Float32Array(ASH * 3);
    for (let i = 0; i < ASH; i++) off.set([(Math.random() - 0.5) * 10, Math.random() * 2, (Math.random() - 0.5) * 10], i * 3);
    a.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(ASH * 3), 3));
    a.setAttribute('aOff', new THREE.Float32BufferAttribute(off, 3));
    a.setAttribute('aSeed', new THREE.Float32BufferAttribute(Float32Array.from({ length: ASH }, () => Math.random()), 1));
    this.ashU = { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector2(0.4, 0.1) }, uOn: { value: 0 }, uPx: { value: 800 } };
    this.ash = new THREE.Points(a, new THREE.ShaderMaterial({ uniforms: this.ashU, vertexShader: ASH_VERT, fragmentShader: ASH_FRAG, transparent: true, depthWrite: false }));
    this.ash.frustumCulled = false;
    this.ash.name = 'ash';
    scene.add(this.ash);
    this.incenseT = 3;
  }

  /** lamps: [{ p }] nearest first; night 0..1; pyres: [{x,y,z}]; wind: {x,z}; vfx; shrines: [Vector3]. */
  update(dt, { camera, renderer, lamps, night, pyres, wind, player, vfx, shrines }) {
    const px = renderer ? renderer.getDrawingBufferSize(new THREE.Vector2()).y : 800;
    this.mothU.uTime.value += dt;
    this.mothU.uPx.value = px;
    this.mothU.uOn.value = Math.max(0, night - 0.3) / 0.7;
    const L = this.mothU.uLamp.value;
    for (let i = 0; i < MAX_LAMPS; i++) {
      const l = lamps?.[i];
      if (l) L[i].set(l.p.x, l.p.y + 0.2, l.p.z);
      else L[i].set(0, 0, 0);
    }
    this.moths.visible = this.mothU.uOn.value > 0.01;
    // ash from the nearest burning pyre within reach
    this.ashU.uTime.value += dt;
    this.ashU.uPx.value = px;
    let best = null;
    let bd = 60 * 60;
    for (const f of pyres || []) {
      const d = (f.x - camera.position.x) ** 2 + (f.z - camera.position.z) ** 2;
      if (d < bd) (bd = d), (best = f);
    }
    const want = best ? 1 : 0;
    this.ashU.uOn.value += (want - this.ashU.uOn.value) * Math.min(1, dt * 0.8);
    if (best) this.ashU.uCenter.value.set(best.x, best.y, best.z);
    if (wind) this.ashU.uWind.value.set(wind.x, wind.z);
    this.ash.visible = this.ashU.uOn.value > 0.01;
    // incense: a thread of smoke from a shrine near him, now and then
    this.incenseT -= dt;
    if (this.incenseT <= 0 && vfx && player && shrines?.length) {
      this.incenseT = 1.6 + Math.random() * 1.4;
      let s = null;
      let sd = 18 * 18;
      for (const q of shrines) {
        const d = (q.x - player.x) ** 2 + (q.z - player.z) ** 2;
        if (d < sd) (sd = d), (s = q);
      }
      if (s) vfx.flipbook('smokeColumn', { x: s.x + (Math.random() - 0.5) * 0.2, y: s.y + 0.4, z: s.z + (Math.random() - 0.5) * 0.2 }, 0.9, { life: 5, rise: true, alpha: 0.35, color: [0.85, 0.82, 0.8], glow: 0, fade: 0.6, grow: 1.6, vel: { x: 0.05, y: 0.25, z: 0 } });
    }
  }
}
