import * as THREE from 'three';
import { GHAT_TOP } from '../config.js';
import { RNG } from '../utils/math.js';
import { GHAT_SEGMENTS, ghatToWorld, LANDING_1, LANDING_2, LANES_V, PROFILE, frameAtX, frameToWorld, ghatById } from './WorldLayout.js';
import { WORLD_UNIFORMS } from './materials.js';

// Kashi after dark:
//   * rows of clay diyas along the ghat steps, lit in a wave spreading from Dashashwamedh
//     (every ghat lights up — Dev Deepawali — once the Maha Aarti has been performed)
//   * strings of festival bulbs: swagged between the terrace lamp posts, running down from the
//     temple spires, outlining the palace rooftops
//   * lanterns on every moored boat and on your boat
//   * a Milky Way dome over the river
// Fire comes from Fire.js; everything else here is instanced or one Points draw call.

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();

export class NightScene {
  constructor({ scene, layout, fire, lampPosts, moored, boat }) {
    this.fire = fire;
    this.moored = moored;
    this.boat = boat;
    this.group = new THREE.Group();
    this.group.name = 'night';
    scene.add(this.group);
    const rng = new RNG(4108);

    // ------------------------------------------------ diyas on the ghat steps
    const dash = ghatById('dashashwamedh');
    const dashX = (dash.x0 + dash.x1) / 2;
    const rows = [
      { v: PROFILE[0].v1 - 0.22, y: GHAT_TOP, always: true },
      { v: LANDING_1.v1 - 0.22, y: LANDING_1.h0 },
      { v: LANDING_2.v1 - 0.22, y: LANDING_2.h0 },
    ];
    this.diyas = [];
    for (const g of GHAT_SEGMENTS) {
      rows.forEach((row) => {
        for (let u = 1.2; u < g.width - 1.2; u += 0.95 + rng.range(-0.15, 0.2)) {
          if (rng.chance(0.08)) continue;
          const p = ghatToWorld(g, u, row.v + rng.range(-0.05, 0.05));
          const pos = new THREE.Vector3(p.x, row.y, p.z);
          const id = fire.add(new THREE.Vector3(p.x, row.y + 0.035, p.z), 0.36, false);
          const nightly = row.always || g.id === 'dashashwamedh';
          // light in a wave rolling outward from Dashashwamedh
          const delay = Math.abs(p.x - dashX) / 70 + rng.range(0, 0.6) + (row.always ? 0 : 0.4);
          this.diyas.push({ pos, id, nightly, delay, lit: false });
        }
      });
    }
    const cup = new THREE.CylinderGeometry(0.065, 0.042, 0.04, 8).translate(0, 0.02, 0);
    const cupMat = new THREE.MeshStandardMaterial({ color: 0x8a3f1c, roughness: 0.85 });
    this.cups = new THREE.InstancedMesh(cup, cupMat, this.diyas.length);
    this.diyas.forEach((d, i) => this.cups.setMatrixAt(i, _m.makeTranslation(d.pos.x, d.pos.y, d.pos.z)));
    this.cups.receiveShadow = true;
    this.cups.computeBoundingSphere();
    this.group.add(this.cups);

    // ------------------------------------------------ festival bulb strings
    const bulbs = [];
    const wires = [];
    const palette = [new THREE.Color(1.0, 0.82, 0.55), new THREE.Color(1.0, 0.55, 0.12), new THREE.Color(1.0, 0.3, 0.12), new THREE.Color(1.0, 0.9, 0.7)];
    const swag = (a, b, sag, spacing) => {
      const len = a.distanceTo(b);
      const n = Math.max(2, Math.round(len / spacing));
      let prev = null;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const p = new THREE.Vector3().lerpVectors(a, b, t);
        p.y -= sag * 4 * t * (1 - t); // parabola ~ catenary for a shallow sag
        if (i > 0 && i < n) bulbs.push({ p, c: palette[Math.floor(rng.next() * palette.length)] });
        if (prev) wires.push(prev, p);
        prev = p;
      }
    };
    // between consecutive lamp posts on the terraces
    for (let i = 1; i < lampPosts.length; i++) {
      const a = lampPosts[i - 1];
      const b = lampPosts[i];
      if (a.distanceTo(b) < 16) swag(a.clone().setY(a.y + 0.15), b.clone().setY(b.y + 0.15), 0.9, 0.55);
    }
    // from each temple spire down to its plinth corners
    for (const t of layout.temples) {
      const S = t.size;
      const apex = new THREE.Vector3(t.x, t.baseY + 1 + 2.85 * S, t.z);
      const c = Math.cos(t.yaw);
      const s = Math.sin(t.yaw);
      for (const [lx, lz] of [[-0.85, -1.0], [0.85, -1.0], [-0.85, 1.4], [0.85, 1.4]]) {
        const x = lx * S;
        const z = lz * S;
        swag(apex, new THREE.Vector3(t.x + x * c + z * s, t.baseY + 1.05, t.z - x * s + z * c), 0.6, 0.5);
      }
    }
    // along the palace and fort rooflines
    for (const b of layout.buildings) {
      if (b.kind !== 'palace' && b.kind !== 'fort') continue;
      const c = Math.cos(b.yaw);
      const s = Math.sin(b.yaw);
      const at = (lx, lz, y) => new THREE.Vector3(b.x + lx * c + lz * s, y, b.z - lx * s + lz * c);
      for (let k = 1; k <= Math.min(4, Math.floor(b.h / 6)); k++) {
        const y = b.baseY + b.h + 0.95 - (k - 1) * 6.4;
        swag(at(-b.w / 2, b.d / 2 + 0.15, y), at(b.w / 2, b.d / 2 + 0.15, y), 0.05, 0.6);
      }
    }
    const bg = new THREE.BufferGeometry();
    const bp = new Float32Array(bulbs.length * 3);
    const bc = new Float32Array(bulbs.length * 3);
    const bs = new Float32Array(bulbs.length);
    bulbs.forEach((b, i) => {
      bp.set([b.p.x, b.p.y, b.p.z], i * 3);
      bc.set([b.c.r, b.c.g, b.c.b], i * 3);
      bs[i] = rng.next();
    });
    bg.setAttribute('position', new THREE.BufferAttribute(bp, 3));
    bg.setAttribute('aColor', new THREE.BufferAttribute(bc, 3));
    bg.setAttribute('aSeed', new THREE.BufferAttribute(bs, 1));
    this.bulbMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uOn: { value: 0 }, uPixelRatio: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aSeed;
        uniform float uTime; uniform float uOn; uniform float uPixelRatio;
        varying vec3 vC; varying float vA;
        void main() {
          vC = aColor;
          vA = uOn * (0.8 + 0.2 * sin(uTime * 2.0 + aSeed * 40.0));
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(0.55 * 650.0 * uPixelRatio / max(-mv.z, 0.5), 2.6 * uPixelRatio, 30.0 * uPixelRatio);
          if (uOn < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vC; varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float core = smoothstep(0.26, 0.0, d);
          float glow = exp(-d * d * 4.0) * (1.0 - d);
          float a = (core * 0.9 + glow * 0.45) * vA;
          if (a < 0.004) discard;
          gl_FragColor = vec4(vC * (core * 5.0 + glow * 1.2) * vA, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.bulbs = new THREE.Points(bg, this.bulbMat);
    this.bulbs.frustumCulled = false;
    this.bulbs.renderOrder = 6;
    this.group.add(this.bulbs);
    const wg = new THREE.BufferGeometry().setFromPoints(wires);
    this.group.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x1a1612, transparent: true, opacity: 0.7 })));

    // ------------------------------------------------ boat lanterns
    this.lanterns = (moored?.spots ?? []).map(() => fire.add(new THREE.Vector3(0, -50, 0), 0.5, false));
    this.boatLantern = boat ? fire.add(new THREE.Vector3(0, -50, 0), 0.5, false) : -1;

    // ------------------------------------------------ Milky Way dome
    this.sky = makeMilkyWay();
    this.group.add(this.sky);

    // ------------------------------------------------ lane lamps
    // a lamp on a house wall every ~15 m along each lane, alternating sides (a warm glow on
    // the wall, a pool of light on the paving); without them the lanes went black at night
    this.laneLamps = [];
    {
      const rows = [0, 1, 2, 3].map((r) => layout.buildings.filter((b) => b.row === r));
      const T = (b) => ({ x: Math.cos(b.yaw), z: -Math.sin(b.yaw) });
      const N = (b) => ({ x: Math.sin(b.yaw), z: Math.cos(b.yaw) });
      const findAt = (list, x, z) => list.find((b) => Math.abs((x - b.x) * T(b).x + (z - b.z) * T(b).z) < b.w / 2 - 1.2);
      for (let lane = 0; lane < 3; lane++) {
        let k = 0;
        for (let x = -440; x <= 440; x += 15) {
          const f = frameAtX(x);
          const mid = frameToWorld(f, 0, LANES_V[lane]);
          const back = k++ % 2 === 0; // the back of row lane, or the front of row lane + 1
          const b = findAt(rows[back ? lane : lane + 1], mid.x, mid.z);
          if (!b || b.h < 6) continue;
          const n = N(b);
          const off = (back ? -1 : 1) * (b.d / 2 + 0.28);
          const along = (mid.x - b.x) * T(b).x + (mid.z - b.z) * T(b).z;
          const pos = new THREE.Vector3(b.x + T(b).x * along + n.x * off, GHAT_TOP + 3.9, b.z + T(b).z * along + n.z * off);
          this.laneLamps.push({ pos, id: fire.add(pos, 1.5, false, 'glow') });
        }
      }
    }

    // ------------------------------------------------ baked night light maps
    const lamps = (festive) => [
      ...this.diyas.filter((d) => festive || d.nightly).map((d) => ({ p: d.pos, r: 2.4, i: 0.1, c: [1.0, 0.55, 0.2] })),
      ...lampPosts.map((p) => ({ p: new THREE.Vector3(p.x, p.y - 3.4, p.z), r: 6.5, i: 0.22, c: [1.0, 0.72, 0.42] })),
      ...bulbs.filter((_, i) => i % 6 === 0).map((b) => ({ p: new THREE.Vector3(b.p.x, b.p.y - 2.5, b.p.z), r: 3.5, i: festive ? 0.06 : 0.035, c: [1.0, 0.6, 0.3] })),
      ...this.laneLamps.map((l) => ({ p: new THREE.Vector3(l.pos.x, GHAT_TOP + 0.8, l.pos.z), r: 10, i: 0.4, c: [1.0, 0.7, 0.4] })),
    ];
    this.lightMaps = { nightly: bakeLightMap(lamps(false)), festival: bakeLightMap(lamps(true)) };
    WORLD_UNIFORMS.uNLBounds.value.set(LM.x0, LM.z0, LM.w, LM.h);
    WORLD_UNIFORMS.uNLMap.value = this.lightMaps.nightly.color;
    WORLD_UNIFORMS.uNLHeight.value = this.lightMaps.nightly.height;

    this.on = false;
    this.clock = 0;
    this.switchedAt = -100;
    this.lightSpots = [];
    this.stats = { diyas: this.diyas.length, bulbs: bulbs.length };
  }

  update(dt, { night, festival, camera, pixelRatio, moonDir }) {
    if (moonDir) this.sky.material.uniforms.uMoonDir.value.copy(moonDir);
    this.clock += dt;
    const on = night > 0.5;
    if (on !== this.on) {
      this.on = on;
      this.switchedAt = this.clock;
    }
    const since = this.clock - this.switchedAt;
    // Diyas: light (or put out) in a wave
    let changed = false;
    for (const l of this.laneLamps) {
      if (l.lit !== on) {
        l.lit = on;
        this.fire.setLit(l.id, on ? 1 : 0);
      }
    }
    for (const d of this.diyas) {
      const want = on && (d.nightly || festival) && since > d.delay;
      const off = !on && since > d.delay * 0.5;
      if (want && !d.lit) {
        d.lit = true;
        this.fire.setLit(d.id, 1);
        changed = true;
      } else if ((off || (on && !d.nightly && !festival)) && d.lit) {
        d.lit = false;
        this.fire.setLit(d.id, 0);
        changed = true;
      }
    }
    if (changed || this.lightSpots.length === 0) {
      this.lightSpots = this.diyas.filter((d, i) => d.lit && i % 12 === 0).map((d) => d.pos);
    }
    // Bulbs fade in with the dusk; brighter on festival nights
    const target = Math.min(1, Math.max(0, (night - 0.35) / 0.4)) * (festival ? 1.25 : 0.85);
    const u = this.bulbMat.uniforms;
    u.uOn.value += (target - u.uOn.value) * Math.min(1, dt * 2);
    u.uTime.value += dt;
    u.uPixelRatio.value = pixelRatio;
    // Lanterns ride the boats
    if (this.moored) {
      const mesh = this.moored.mesh;
      this.lanterns.forEach((id, i) => {
        mesh.getMatrixAt(i, _m);
        _v.set(0, 0.62, 2.7).applyMatrix4(_m);
        this.fire.setPosition(id, _v.x, _v.y, _v.z);
        this.fire.setLit(id, on ? 1 : 0);
      });
    }
    if (this.boatLantern >= 0) {
      _v.set(0, 0.62, 2.7).applyMatrix4(this.boat.object.matrixWorld);
      this.fire.setPosition(this.boatLantern, _v.x, _v.y, _v.z);
      this.fire.setLit(this.boatLantern, on ? 1 : 0);
    }
    // Baked warm light rises with the lamps
    const maps = festival ? this.lightMaps.festival : this.lightMaps.nightly;
    WORLD_UNIFORMS.uNLMap.value = maps.color;
    WORLD_UNIFORMS.uNLHeight.value = maps.height;
    const lightTarget = on ? Math.min(1, since / 4) : Math.max(0, 1 - since / 2);
    WORLD_UNIFORMS.uNightLight.value += (lightTarget * Math.min(1, night * 1.3) - WORLD_UNIFORMS.uNightLight.value) * Math.min(1, dt * 3);
    // Milky Way follows the camera, fades with the dark
    this.sky.position.copy(camera.position);
    this.sky.material.uniforms.uNight.value = Math.max(0, (night - 0.55) / 0.45);
    // no draw calls by day for things only the night shows
    this.sky.visible = this.sky.material.uniforms.uNight.value > 0.002;
    this.bulbs.visible = this.bulbMat.uniforms.uOn.value > 0.01;
    this.cups.visible = night > 0.2;
  }
}

// Light-map footprint: the ghats and every lane behind them (~0.45 m a texel).
const LM = { x0: -460, z0: -112, w: 920, h: 170, W: 2048, H: 384 };

function bakeLightMap(lamps) {
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = LM.W;
    c.height = LM.H;
    const ctx = c.getContext('2d');
    ctx.setTransform(LM.W / LM.w, 0, 0, LM.H / LM.h, (-LM.x0 * LM.W) / LM.w, (-LM.z0 * LM.H) / LM.h);
    return { c, ctx };
  };
  const col = mk();
  const hgt = mk();
  col.ctx.fillStyle = '#000';
  col.ctx.fillRect(LM.x0, LM.z0, LM.w, LM.h);
  hgt.ctx.fillStyle = 'rgb(32,32,32)';
  hgt.ctx.fillRect(LM.x0, LM.z0, LM.w, LM.h);
  // height channel first (lamp level), then additive colour
  for (const l of lamps) {
    const v = Math.round(((l.p.y + 5) / 40) * 255);
    hgt.ctx.fillStyle = `rgb(${v},${v},${v})`;
    hgt.ctx.beginPath();
    hgt.ctx.arc(l.p.x, l.p.z, l.r * 0.9, 0, Math.PI * 2);
    hgt.ctx.fill();
  }
  col.ctx.globalCompositeOperation = 'lighter';
  for (const l of lamps) {
    const g = col.ctx.createRadialGradient(l.p.x, l.p.z, 0, l.p.x, l.p.z, l.r);
    const [r, gg, b] = l.c.map((x) => Math.round(x * 255));
    g.addColorStop(0, `rgba(${r},${gg},${b},${l.i})`);
    g.addColorStop(0.45, `rgba(${r},${gg},${b},${l.i * 0.45})`);
    g.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    col.ctx.fillStyle = g;
    col.ctx.fillRect(l.p.x - l.r, l.p.z - l.r, l.r * 2, l.r * 2);
  }
  const tex = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    t.flipY = false; // canvas row 0 = z0, matching the shader's uv.y = (z - z0) / h
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  };
  return { color: tex(col.c, true), height: tex(hgt.c, false) };
}

function makeMilkyWay() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uNight: { value: 0 }, uMoonDir: { value: new THREE.Vector3(0, 0.5, 0.8).normalize() } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // on the far plane
      }`,
    fragmentShader: /* glsl */ `
      uniform float uNight;
      uniform vec3 uMoonDir;
      varying vec3 vDir;
      float h31(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float n3(vec3 x) {
        vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h31(i), h31(i + vec3(1,0,0)), f.x), mix(h31(i + vec3(0,1,0)), h31(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(h31(i + vec3(0,0,1)), h31(i + vec3(1,0,1)), f.x), mix(h31(i + vec3(0,1,1)), h31(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
      float fbm3(vec3 p) { return 0.5 * n3(p) + 0.25 * n3(p * 2.1) + 0.125 * n3(p * 4.3) + 0.0625 * n3(p * 8.7); }
      void main() {
        vec3 d = normalize(vDir);
        if (d.y < -0.06) discard;
        // the night itself is not black: deep blue overhead, a lighter band at the horizon,
        // a warm glow of the city's lamps low over Kashi (west, -Z), a halo round the moon
        float up = clamp(d.y, 0.0, 1.0);
        vec3 skyCol = mix(vec3(0.05, 0.075, 0.16), vec3(0.012, 0.02, 0.055), pow(up, 0.45));
        float cityGlow = exp(-up * 9.0) * smoothstep(0.1, -0.7, d.z) * 0.9;
        skyCol += vec3(0.16, 0.08, 0.035) * cityGlow;
        float md = max(dot(d, uMoonDir), 0.0);
        skyCol += vec3(0.35, 0.42, 0.6) * (pow(md, 60.0) * 0.6 + pow(md, 8.0) * 0.08);
        // the galactic band: a great circle tilted across the sky over the river
        vec3 nrm = normalize(vec3(0.35, 0.55, -0.76));
        float lat = dot(d, nrm);
        float band = exp(-lat * lat / 0.022);
        float dust = fbm3(d * 6.0);
        float lanes = smoothstep(0.35, 0.75, fbm3(d * 11.0 + 3.0));
        float core = exp(-pow(distance(d, normalize(vec3(-0.2, 0.35, 0.92))), 2.0) / 0.12);
        vec3 glow = mix(vec3(0.55, 0.6, 0.85), vec3(1.0, 0.85, 0.65), core) * band * (0.35 + 0.65 * dust) * (1.0 - 0.6 * lanes * band);
        // star dust: many faint stars, denser in the band
        vec3 cell = floor(d * 420.0);
        float s = h31(cell);
        float star = step(0.9965 - band * 0.004, s) * (0.4 + 0.6 * h31(cell + 7.0));
        float horizon = smoothstep(-0.02, 0.25, d.y);
        vec3 col = (skyCol + glow * 0.09 * horizon + vec3(0.9, 0.93, 1.0) * star * 0.55 * horizon) * uNight;
        gl_FragColor = vec4(col, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}
