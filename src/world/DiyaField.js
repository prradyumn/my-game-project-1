import * as THREE from 'three';
import { RNG } from '../utils/math.js';
import { GHAT_SEGMENTS, ghatById, ghatToWorld, PROFILE } from './WorldLayout.js';

// Dev Deepawali: a diya on every step of every ghat, as on the night itself (the river front a
// staircase of light from Assi to Panchganga, tens of thousands of flames, the whole of it
// doubled in the Ganga). One Points draw: each sprite is a flame over its clay cup, premultiplied
// so the flame adds light and the cup hides what is behind it in the same pass. They light in a
// wave from Dashashwamedh along the river, a few rows at a time down the steps; paths are left
// clear down every flight (people walk between them), and on the landings they are laid out in
// mandalas, rings of diyas round a centre. The river's mirror draws them too (layer 0), flipped
// so the reflected flames hang down. Density follows the quality preset.

const SPRITE = 0.24; // metres: the sprite (cup + flame) at its own distance
const WAVE = 48; // m/s: how fast the lighting runs along the river from Dashashwamedh

export class DiyaField {
  constructor({ density = 1 } = {}) {
    const rng = new RNG(80108);
    const pos = [];
    const seed = [];
    const delay = [];
    const strips = [];
    const dash = ghatById('dashashwamedh');
    const dashX = (dash.x0 + dash.x1) / 2;
    const spacing = 0.42 / Math.max(0.25, density);
    for (const g of GHAT_SEGMENTS) {
      // the paths down the flight: a clear lane every 8-11 m
      const gaps = [];
      for (let u = rng.range(3, 6); u < g.width; u += rng.range(8, 11)) gaps.push(u);
      const inGap = (u) => gaps.some((c) => Math.abs(u - c) < 0.75);
      let row = 0;
      for (const s of PROFILE) {
        if (s.kind !== 'stairs') continue;
        for (let i = 0; i < s.steps; i++, row++) {
          const h = s.h0 - (i + 1) * s.rise;
          if (h < 0.25) continue; // (the steps the river covers)
          // just behind the nosing of the tread
          const v = s.v0 + (i + 1) * s.run - 0.1;
          for (let u = 0.6; u < g.width - 0.6; u += spacing * rng.range(0.8, 1.2)) {
            if (inGap(u) || rng.chance(0.05)) continue;
            const p = ghatToWorld(g, u, v + rng.range(-0.03, 0.03));
            pos.push(p.x, h + 0.035, p.z);
            seed.push(rng.next());
            // the wave along the river, a moment's lag down the steps, a little scatter
            delay.push(Math.abs(p.x - dashX) / WAVE + row * 0.06 + rng.range(0, 0.9));
          }
          // (the warm glow on the tread, for the night light map)
          const a = ghatToWorld(g, 0, v - s.run + 0.1);
          const b = ghatToWorld(g, g.width, v - s.run + 0.1);
          const c = ghatToWorld(g, g.width, v + 0.1);
          const d = ghatToWorld(g, 0, v + 0.1);
          strips.push({ corners: [a, b, c, d], y: h, i: 0.075, c: [1.0, 0.56, 0.2] });
        }
      }
      // mandalas on the landings: rings of diyas round a centre, every 16-22 m
      for (const s of PROFILE) {
        if (s.kind !== 'flat' || s.v1 - s.v0 < 4) continue;
        const vc = (s.v0 + s.v1) / 2;
        for (let u = rng.range(7, 12); u < g.width - 6; u += rng.range(16, 22)) {
          const c = ghatToWorld(g, u, vc);
          const rings = s.v1 - s.v0 > 5 ? [0.55, 1.05, 1.55] : [0.55, 1.05];
          rings.forEach((r, k) => {
            const n = Math.round((Math.PI * 2 * r) / (0.27 / Math.max(0.5, density)));
            for (let j = 0; j < n; j++) {
              const a = (j / n) * Math.PI * 2 + k * 0.3;
              pos.push(c.x + Math.cos(a) * r, s.h0 + 0.035, c.z + Math.sin(a) * r);
              seed.push(rng.next());
              delay.push(Math.abs(c.x - dashX) / WAVE + 0.8 + k * 0.35 + j * 0.012);
            }
          });
          pos.push(c.x, s.h0 + 0.035, c.z);
          seed.push(rng.next());
          delay.push(Math.abs(c.x - dashX) / WAVE + 0.6);
        }
      }
    }
    this.count = seed.length;
    this.strips = strips;
    this.lastDelay = Math.max(...delay);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
    geo.setAttribute('aDelay', new THREE.Float32BufferAttribute(delay, 1));
    geo.computeBoundingSphere();
    this.uniforms = {
      uTime: { value: 0 },
      uLit: { value: -1 }, // seconds since the lighting began (-1: none lit)
      uFade: { value: 0 }, // the whole field's brightness (dawn puts them out)
      uScale: { value: 600 }, // pixels per metre at 1 m (set per render target)
      uFlip: { value: 1 }, // -1 in the river's mirror
      uMinPx: { value: 1.6 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute float aSeed; attribute float aDelay;
        uniform float uTime; uniform float uLit; uniform float uFade; uniform float uScale; uniform float uMinPx;
        varying float vLit; varying float vFlick; varying float vSeed; varying float vEnergy; varying float vSize;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = max(-mv.z, 0.3);
          float px = ${SPRITE.toFixed(3)} * uScale / d;
          // a lit wick catches: a quick swell, a dip, then steady
          float t = uLit - aDelay;
          float lit = uLit < 0.0 ? 0.0 : smoothstep(0.0, 0.35, t) * (1.0 + 0.5 * exp(-t * 4.0) * step(0.0, t));
          vLit = lit * uFade;
          // flicker: two slow beats and a quick one, its own for every wick
          vFlick = 0.82 + 0.1 * sin(uTime * 3.1 + aSeed * 61.0) + 0.06 * sin(uTime * 7.3 + aSeed * 23.0) + 0.04 * sin(uTime * 17.0 + aSeed * 9.0);
          vSeed = aSeed;
          // far away a diya is a point of light: never smaller than uMinPx, its light spread over
          // the larger dot so the far ghats don't brighten as they shrink
          vSize = px;
          vEnergy = px < uMinPx ? (px * px) / (uMinPx * uMinPx) : 1.0;
          gl_PointSize = max(px, uMinPx);
          // (far past the city: nothing)
          if (d > 1100.0 || (vLit < 0.003 && px < 3.0)) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uFlip; uniform float uTime;
        varying float vLit; varying float vFlick; varying float vSeed; varying float vEnergy; varying float vSize;
        void main() {
          vec2 c = gl_PointCoord * 2.0 - 1.0;
          c.y = -c.y * uFlip; // up, in the sprite (down in the mirror)
          vec3 light = vec3(0.0);
          float cupA = 0.0;
          vec3 cupC = vec3(0.0);
          if (vSize < 5.0) {
            // a few pixels: a point of warm light
            float g = exp(-dot(c, c) * 3.0);
            light = vec3(1.0, 0.62, 0.24) * g * 2.6 * vLit * vFlick * vEnergy;
          } else {
            // the clay cup: a shallow bowl in the lower half, lit from its own flame
            vec2 q = vec2(c.x / 0.62, (c.y + 0.42) / 0.26);
            float bowl = (1.0 - smoothstep(0.85, 1.0, length(q))) * step(c.y, -0.36);
            float rim = (1.0 - smoothstep(0.0, 0.07, abs(c.y + 0.36))) * step(abs(c.x), 0.6);
            cupA = clamp(bowl + rim * 0.9, 0.0, 1.0);
            cupC = mix(vec3(0.05, 0.025, 0.012), vec3(0.42, 0.18, 0.06), (0.35 + 0.65 * vLit) * smoothstep(-0.8, -0.36, c.y));
            // the flame: a teardrop on the wick, swaying a little
            float sway = sin(uTime * 2.3 + vSeed * 40.0) * 0.06 * (c.y + 0.35);
            vec2 f = vec2((c.x - sway) / 0.16, (c.y + 0.1) / 0.42);
            float tear = length(vec2(f.x * (1.0 + max(f.y, 0.0) * 1.6), f.y));
            float flame = (1.0 - smoothstep(0.55, 1.0, tear)) * step(-0.36, c.y);
            float core = 1.0 - smoothstep(0.0, 0.5, tear);
            vec3 fc = mix(vec3(1.0, 0.36, 0.06), vec3(1.0, 0.86, 0.5), core);
            float halo = exp(-dot(c - vec2(0.0, 0.05), c - vec2(0.0, 0.05)) * 4.0) * 0.35;
            light = (fc * (flame * 3.2 + core * 3.0) + vec3(1.0, 0.5, 0.18) * halo) * vLit * vFlick;
          }
          float a = cupA;
          if (a < 0.002 && max(light.r, max(light.g, light.b)) < 0.002) discard;
          // premultiplied: the cup over what is behind, the flame added on top
          gl_FragColor = vec4(cupC * a + light, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.visible = false;
    this.points.name = 'diya-field';
    // pixels per metre for whichever target is being drawn (the river's mirror is smaller), and
    // the flames hang down in the mirror
    const _s = new THREE.Vector2();
    this.points.onBeforeRender = (renderer, scene, camera) => {
      const rt = renderer.getRenderTarget();
      const h = rt ? rt.height : renderer.getDrawingBufferSize(_s).y;
      const fov = camera.isPerspectiveCamera ? camera.fov : 50;
      this.uniforms.uScale.value = h / (2 * Math.tan((fov * Math.PI) / 360));
      this.uniforms.uFlip.value = camera === this.mainCamera ? 1 : -1;
      this.uniforms.uMinPx.value = 1.6 * (rt ? 0.75 : renderer.getPixelRatio());
    };
    this.mainCamera = null;
    this.lit = false;
    this.litAt = 0;
    this.clock = 0;
  }

  /** festival: Dev Deepawali tonight; night 0..1. Lights the wave at dusk, puts it out at dawn. */
  update(dt, { festival, night, camera }) {
    this.mainCamera = camera;
    this.clock += dt;
    const u = this.uniforms;
    u.uTime.value = this.clock;
    const want = festival && night > 0.45;
    if (want && !this.lit) {
      this.lit = true;
      this.litAt = this.clock;
    }
    if (!festival && this.lit) this.lit = false;
    if (this.lit) u.uLit.value = this.clock - this.litAt;
    // (by daybreak they have burnt down)
    const fadeT = this.lit ? Math.min(1, Math.max(0, (night - 0.3) / 0.25)) : 0;
    u.uFade.value += (fadeT - u.uFade.value) * Math.min(1, dt * (this.lit ? 3 : 1.2));
    if (!this.lit && u.uFade.value < 0.01) u.uLit.value = -1;
    this.points.visible = u.uLit.value >= 0 && u.uFade.value > 0.005;
  }

  /** Light the whole field now (no wave): a jump straight into the festival night. */
  lightNow() {
    this.lit = true;
    this.litAt = this.clock - this.lastDelay - 1;
    this.uniforms.uFade.value = 1;
  }
}
