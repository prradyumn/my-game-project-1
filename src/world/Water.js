import * as THREE from 'three';
import { FAR_BANK_V, RIVER, WATER_LEVEL, WORLD } from '../config.js';
import { bankCoords, frameAtX, groundHeight, PROFILE_LEN } from './WorldLayout.js';
import { WORLD_UNIFORMS } from './materials.js';
import { waterNormalTexture } from '../utils/textures.js';
import { clamp, lerp, smoothstep } from '../utils/math.js';

// The Ganga.
//  - Gentle sine waves, evaluated identically on the GPU (looks) and CPU (buoyancy, swimming).
//  - A baked height texture of the river bed gives depth-based colour, clarity and shore foam.
//  - Optional planar reflection (the ghats mirrored in the river at dawn), quality-scaled.
//  - `purity` (0..1, the quest) turns murky water into clear, glittering turquoise.

// Gerstner (trochoidal) waves: [dirX, dirZ, amplitude, wavelength]. Deep-water dispersion
// c = sqrt(g / k). Steepness Q is shared out so crests sharpen without ever looping over.
const WAVES = [
  [1.0, 0.18, 0.055, 9.5],
  [0.78, -0.62, 0.035, 5.7],
  [0.35, 1.0, 0.028, 3.9],
  [-0.55, 0.83, 0.018, 2.4],
];
const STEEPNESS = 0.55;
const WAVE_DATA = WAVES.map(([x, z, a, l]) => {
  const len = Math.hypot(x, z);
  const k = (Math.PI * 2) / l;
  return { dx: x / len, dz: z / len, a, k, c: Math.sqrt(9.81 / k), q: STEEPNESS / (k * a * WAVES.length) };
});

const HEIGHT_BOUNDS = { x0: WORLD.xMin - 30, z0: WORLD.zMin - 10, w: WORLD.xMax - WORLD.xMin + 60, h: WORLD.zMax - WORLD.zMin + 20 };
const NEAR_SIZE = 180;
const NEAR_SEGMENTS = 220;
const _u = { x: 0, z: 0 };

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform vec4 uWaves[4];
  uniform float uSteep[4];
  uniform vec3 uNearCenter;
  uniform mat4 uTextureMatrix;
  varying vec3 vWorld;
  varying vec2 vUndisp;
  varying float vFade;
  varying vec4 vReflCoord;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vUndisp = wp.xz;
    vFade = 1.0;
    #ifdef NEAR_WATER
      vec2 rel = abs(wp.xz - uNearCenter.xz);
      float fade = 1.0 - smoothstep(${(NEAR_SIZE * 0.32).toFixed(1)}, ${(NEAR_SIZE * 0.48).toFixed(1)}, max(rel.x, rel.y));
      vec3 disp = vec3(0.0);
      for (int i = 0; i < 4; i++) {
        vec4 w = uWaves[i];
        float k = 6.2831853 / w.w;
        float f = k * (dot(w.xy, wp.xz) - sqrt(9.81 / k) * uTime);
        float qa = uSteep[i] * w.z * cos(f);
        disp += vec3(w.x * qa, w.z * sin(f), w.y * qa);
      }
      wp.xyz += disp * fade;
      vFade = fade;
    #endif
    vWorld = wp.xyz;
    vReflCoord = uTextureMatrix * vec4(wp.xyz, 1.0);
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec4 uWaves[4];
  uniform float uSteep[4];
  uniform vec3 uNearCenter;
  uniform sampler2D uNormalMap;
  uniform sampler2D uReflection;
  uniform sampler2D uHeightTex;
  uniform vec4 uHeightBounds;
  uniform float uUseReflection;
  uniform float uPurity;
  uniform float uSunIntensity;
  uniform float uLight;
  uniform float uNight;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyHorizon;
  uniform vec3 uSkyZenith;
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform vec2 uFlow;
  uniform float uRain;
  varying vec3 vWorld;
  varying vec2 vUndisp;
  varying float vFade;
  varying vec4 vReflCoord;
  #include <common>
  #include <fog_pars_fragment>

  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

  void main() {
    // Analytic Gerstner normal (GPU Gems ch.1), evaluated per pixel at the undisplaced point
    vec2 grad = vec2(0.0);
    float lift = 0.0;
    for (int i = 0; i < 4; i++) {
      vec4 w = uWaves[i];
      float k = 6.2831853 / w.w;
      float f = k * (dot(w.xy, vUndisp) - sqrt(9.81 / k) * uTime);
      float wa = k * w.z;
      grad += wa * cos(f) * w.xy;
      lift += uSteep[i] * wa * sin(f);
    }
    float dist = length(cameraPosition - vWorld);
    // Two scrolling detail layers that drift downstream with the current
    vec2 uv1 = vWorld.xz * 0.09 + uFlow * uTime * 0.09;
    vec2 uv2 = vWorld.xz * 0.031 + vec2(uFlow.x * 0.55, 0.03) * uTime * 0.031;
    vec3 n1 = texture2D(uNormalMap, uv1).xyz * 2.0 - 1.0;
    vec3 n2 = texture2D(uNormalMap, uv2).xyz * 2.0 - 1.0;
    float detail = mix(0.55, 0.12, smoothstep(30.0, 500.0, dist));
    vec3 N = normalize(vec3(-grad.x, 1.0 - lift, -grad.y) + vec3(n1.x + n2.x, 0.0, n1.y + n2.y) * detail);
    // rain: expanding rings from drops on a jittered grid (two offset layers)
    if (uRain > 0.01 && dist < 45.0) {
      vec2 ring = vec2(0.0);
      for (int L = 0; L < 1; L++) {
        vec2 gp = vWorld.xz * 1.6 + float(L) * 0.5;
        vec2 cell = floor(gp);
        for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
          vec2 c = cell + vec2(float(i), float(j));
          float h = hash12(c + float(L) * 7.0);
          vec2 ctr = c + 0.2 + 0.6 * vec2(h, fract(h * 13.7));
          float ph = fract(uTime * (0.9 + h * 0.6) + h * 5.0);
          vec2 d = gp - ctr;
          float r = length(d);
          float rad = ph * 0.75;
          float w = (1.0 - ph) * (1.0 - ph) * step(h, uRain);
          float wave = sin((r - rad) * 38.0) * exp(-abs(r - rad) * 14.0) * w;
          ring += (r > 1e-3 ? d / r : vec2(0.0)) * wave;
        }
      }
      N = normalize(N + vec3(ring.x, 0.0, ring.y) * 0.26 * (1.0 - smoothstep(20.0, 45.0, dist)));
    }

    #ifndef NEAR_WATER
      vec2 relF = abs(vWorld.xz - uNearCenter.xz);
      if (max(relF.x, relF.y) < ${(NEAR_SIZE / 2).toFixed(1)}) discard;
    #endif
    vec3 V = normalize(cameraPosition - vWorld);
    bool under = cameraPosition.y < vWorld.y - 0.02;

    vec2 huv = (vWorld.xz - uHeightBounds.xy) / uHeightBounds.zw;
    float ground = texture2D(uHeightTex, huv).r;
    float depth = max(vWorld.y - ground, 0.0);

    if (under) {
      vec3 Nd = -N;
      float cosU = clamp(dot(Nd, V), 0.0, 1.0);
      // Snell's window: the sky is visible straight up, a mirror of the deep elsewhere
      float window = smoothstep(0.62, 0.8, cosU);
      // the sun itself, a bright smear in the window when it is overhead
      vec3 Rs = refract(-V, -Nd, 1.33);
      float sunSpot = pow(max(dot(normalize(Rs + vec3(0.0, 0.001, 0.0)), uSunDir), 0.0), 60.0) * smoothstep(0.0, 0.2, uSunDir.y);
      vec3 col = mix(uDeep * uLight * 1.6, uSkyHorizon * 1.3 + uSunColor * uSunIntensity * 0.15, window) + uSunColor * uSunIntensity * sunSpot * window * 2.0;
      // opaque: the HDR sky behind would bleed through even a few percent of transparency
      gl_FragColor = vec4(col, 1.0);
      #include <fog_fragment>
      return;
    }

    float cosT = clamp(dot(N, V), 0.0, 1.0);
    float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);

    vec3 R = reflect(-V, N);
    vec3 refl = mix(uSkyHorizon, uSkyZenith, pow(clamp(R.y, 0.0, 1.0), 0.45));
    if (uUseReflection > 0.5) {
      vec2 distortion = N.xz * 0.045 * (1.0 - smoothstep(30.0, 300.0, dist));
      vec2 ruv = vReflCoord.xy / vReflCoord.w + distortion;
      refl = texture2D(uReflection, ruv).rgb;
    }

    // Sun glitter: a tight core plus a wide sheen
    vec3 H = normalize(uSunDir + V);
    float nh = max(dot(N, H), 0.0);
    float spec = pow(nh, 900.0) * 24.0 + pow(nh, 140.0) * 0.4 + pow(nh, 40.0) * 0.25 * uNight;
    vec3 sunSpec = uSunColor * spec * uSunIntensity * smoothstep(-0.02, 0.05, uSunDir.y);

    // Water body: shallow -> deep, lit by the sky
    float t = 1.0 - exp(-depth * mix(0.75, 0.24, uPurity));
    vec3 body = mix(uShallow, uDeep, t) * uLight;
    // Light scattering through the wave crests toward the sun
    float scatter = pow(max(dot(V, -uSunDir), 0.0), 4.0) * clamp(grad.x + grad.y + 0.2, 0.0, 1.0);
    body += uShallow * scatter * uSunIntensity * 0.15;

    // Shore foam where the water is shallow
    float foamTex = texture2D(uNormalMap, vWorld.xz * 0.27 + vec2(uTime * 0.05, 0.0)).r;
    float foam = (1.0 - smoothstep(0.0, 0.32, depth)) * smoothstep(0.45, 0.7, foamTex + 0.2 * sin(uTime * 1.5 + vWorld.x));

    vec3 col = mix(body, refl, F) + sunSpec;
    col = mix(col, vec3(0.9, 0.88, 0.82) * uLight, foam * 0.55);

    // Ganga's blessing: as purity rises, golden motes glitter on the surface
    vec2 sp = vWorld.xz * 2.2;
    vec2 cell = floor(sp);
    float rnd = hash12(cell);
    float tw = fract(uTime * (0.35 + rnd * 0.5) + rnd * 7.0);
    float glint = step(0.993, rnd) * smoothstep(0.18, 0.0, length(fract(sp) - 0.5)) * sin(tw * 3.14159);
    col += vec3(1.0, 0.72, 0.32) * glint * smoothstep(0.3, 1.0, uPurity) * (0.8 + uNight * 3.0) * (1.0 - smoothstep(15.0, 90.0, dist));

    float alpha = 1.0 - exp(-depth * mix(1.8, 0.6, uPurity));
    alpha = clamp(max(alpha, F * 0.9), 0.0, 1.0);
    alpha = max(alpha, foam * 0.7);
    gl_FragColor = vec4(col, alpha);
    #include <fog_fragment>
  }
`;

export class Water {
  constructor(renderer, scene, quality) {
    this.renderer = renderer;
    this.scene = scene;
    this.purity = 0;
    this.time = 0;
    this.flow = new THREE.Vector2(RIVER.flowDir[0] * RIVER.flowSpeed, RIVER.flowDir[1] * RIVER.flowSpeed);

    this.textureMatrix = new THREE.Matrix4();
    this.virtualCamera = new THREE.PerspectiveCamera();
    this.reflectionRT = null;

    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
    Object.assign(uniforms, {
      uRain: { value: 0 },
      uTime: { value: 0 },
      uWaves: { value: WAVE_DATA.map((w) => new THREE.Vector4(w.dx, w.dz, w.a, (Math.PI * 2) / w.k)) },
      uSteep: { value: WAVE_DATA.map((w) => w.q) },
      uNearCenter: { value: new THREE.Vector3() },
      uTextureMatrix: { value: this.textureMatrix },
      uNormalMap: { value: waterNormalTexture(256) },
      uReflection: { value: null },
      uHeightTex: { value: this.bakeHeightTexture() },
      uHeightBounds: { value: new THREE.Vector4(HEIGHT_BOUNDS.x0, HEIGHT_BOUNDS.z0, HEIGHT_BOUNDS.w, HEIGHT_BOUNDS.h) },
      uUseReflection: { value: 0 },
      uPurity: { value: 0 },
      uSunIntensity: { value: 1 },
      uLight: { value: 1 },
      uNight: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uSkyHorizon: { value: new THREE.Color(0.7, 0.75, 0.8) },
      uSkyZenith: { value: new THREE.Color(0.3, 0.45, 0.7) },
      uShallow: { value: new THREE.Color() },
      uDeep: { value: new THREE.Color() },
      uFlow: { value: this.flow },
    });
    this.uniforms = uniforms;

    const makeMat = (near) =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader,
        fragmentShader,
        defines: near ? { NEAR_WATER: '' } : {},
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: true,
      });

    // Near: dense, follows the camera, displaced by the waves.
    const nearGeo = new THREE.PlaneGeometry(NEAR_SIZE, NEAR_SIZE, NEAR_SEGMENTS, NEAR_SEGMENTS).rotateX(-Math.PI / 2);
    this.near = new THREE.Mesh(nearGeo, makeMat(true));
    this.near.frustumCulled = false;
    this.near.renderOrder = 2;
    scene.add(this.near);

    // Far: one big flat sheet to the horizon, with a hole cut where the near mesh is.
    const farGeo = this.makeFarGeometry();
    this.far = new THREE.Mesh(farGeo, makeMat(false));
    this.far.renderOrder = 1;
    this.far.frustumCulled = false;
    scene.add(this.far);
    this.farGeo = farGeo;

    this.setQuality(quality);
  }

  makeFarGeometry() {
    // One flat sheet; the fragment shader discards the part the near mesh already covers.
    const g = new THREE.PlaneGeometry(2600, 1800, 1, 1).rotateX(-Math.PI / 2);
    g.translate(0, WATER_LEVEL, 150);
    return g;
  }

  bakeHeightTexture() {
    const W = 1024;
    const H = Math.round((W * HEIGHT_BOUNDS.h) / HEIGHT_BOUNDS.w);
    const data = new Uint16Array(W * H);
    for (let j = 0; j < H; j++) {
      const z = HEIGHT_BOUNDS.z0 + ((j + 0.5) / H) * HEIGHT_BOUNDS.h;
      for (let i = 0; i < W; i++) {
        const x = HEIGHT_BOUNDS.x0 + ((i + 0.5) / W) * HEIGHT_BOUNDS.w;
        data[j * W + i] = THREE.DataUtils.toHalfFloat(groundHeight(x, z));
      }
    }
    const tex = new THREE.DataTexture(data, W, H, THREE.RedFormat, THREE.HalfFloatType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  setQuality(q) {
    this.reflectionScale = q.reflection;
    this.uniforms.uUseReflection.value = q.reflection > 0 ? 1 : 0;
    if (this.reflectionRT) {
      this.reflectionRT.dispose();
      this.reflectionRT = null;
    }
    if (q.reflection > 0) {
      this.reflectionRT = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: 0 });
      this.reflectionRT.texture.generateMipmaps = false;
      this.uniforms.uReflection.value = this.reflectionRT.texture;
    }
    this.lastRTSize = '';
  }

  // ---------------------------------------------------------------- CPU wave sampling
  // Gerstner points move sideways, so first find the undisplaced point that lands on (x, z):
  // fixed-point iteration x0 = x - D(x0) converges in a few steps for steepness < 1.
  undisplaced(x, z, t = this.time) {
    let x0 = x;
    let z0 = z;
    for (let it = 0; it < 3; it++) {
      let dx = 0;
      let dz = 0;
      for (const w of WAVE_DATA) {
        const qa = w.q * w.a * Math.cos(w.k * (w.dx * x0 + w.dz * z0 - w.c * t));
        dx += w.dx * qa;
        dz += w.dz * qa;
      }
      x0 = x - dx;
      z0 = z - dz;
    }
    _u.x = x0;
    _u.z = z0;
    return _u;
  }

  heightAt(x, z, t = this.time) {
    const p = this.undisplaced(x, z, t);
    let h = 0;
    for (const w of WAVE_DATA) h += w.a * Math.sin(w.k * (w.dx * p.x + w.dz * p.z - w.c * t));
    return WATER_LEVEL + h;
  }

  // Surface normal (boat pitch/roll, swimmer tilt)
  normalAt(x, z, out = new THREE.Vector3(), t = this.time) {
    const p = this.undisplaced(x, z, t);
    let gx = 0;
    let gz = 0;
    let lift = 0;
    for (const w of WAVE_DATA) {
      const f = w.k * (w.dx * p.x + w.dz * p.z - w.c * t);
      const wa = w.k * w.a;
      gx += wa * Math.cos(f) * w.dx;
      gz += wa * Math.cos(f) * w.dz;
      lift += w.q * wa * Math.sin(f);
    }
    return out.set(-gx, 1 - lift, -gz).normalize();
  }

  // Surface water velocity (m/s) - the Ganga's current. Fastest mid-river, slack at the banks,
  // following the bank tangent, with an eddy swirling behind the sunken temple.
  currentAt(x, z, out = { x: 0, z: 0 }) {
    const { v } = bankCoords(x, z);
    const span = FAR_BANK_V - PROFILE_LEN;
    const across = clamp((v - PROFILE_LEN) / span, 0, 1);
    const profile = Math.pow(Math.sin(Math.PI * across), 0.6) * smoothstep(PROFILE_LEN - 1, PROFILE_LEN + 6, v);
    const pulse = 1 + 0.12 * Math.sin(this.time * 0.09 + x * 0.013);
    const sp = RIVER.flowSpeed * (0.25 + 1.05 * profile) * pulse * smoothstep(PROFILE_LEN - 1, PROFILE_LEN + 2, v);
    const T = frameAtX(x).T;
    out.x = T.x * sp;
    out.z = T.z * sp;
    if (this.eddy) {
      const dx = x - this.eddy.x;
      const dz = z - this.eddy.z;
      const e = 0.09 * Math.exp(-(dx * dx + dz * dz) / 90);
      out.x += -dz * e;
      out.z += dx * e;
    }
    return out;
  }

  // From below, the surface is a ceiling: it writes depth so mist, ripples, smoke and rain
  // above it can't paint over it.
  setUnder(under) {
    this.near.material.depthWrite = under;
    this.far.material.depthWrite = under;
  }

  setEddy(x, z) {
    this.eddy = { x, z };
  }

  // ---------------------------------------------------------------- per frame
  update(dt, camera, sky) {
    this.time += dt;
    const u = this.uniforms;
    u.uTime.value = this.time;
    u.uPurity.value = this.purity;
    // By day the sun draws the glitter path; by night the moon lays a silver road on the river.
    if (sky.nightFactor > 0.5 && sky.moonDir) {
      u.uSunDir.value.copy(sky.moonDir);
      u.uSunColor.value.setRGB(0.78, 0.86, 1.0);
      u.uSunIntensity.value = 0.55 * sky.nightFactor;
    } else {
      u.uSunDir.value.copy(sky.sunDir);
      u.uSunColor.value.copy(sky.sunColor);
      u.uSunIntensity.value = sky.sun.intensity / 3.0;
    }
    const day = 1 - sky.nightFactor;
    u.uLight.value = lerp(0.06, 1.0, day) + sky.goldenFactor * 0.1;
    u.uNight.value = sky.nightFactor;
    u.uSkyHorizon.value.copy(sky.horizonColor);
    u.uSkyZenith.value.copy(sky.zenithColor).multiplyScalar(lerp(0.15, 1, day));

    // Murky -> sacred turquoise
    const p = this.purity;
    u.uShallow.value.setRGB(lerp(0.17, 0.05, p), lerp(0.16, 0.34, p), lerp(0.1, 0.3, p));
    u.uDeep.value.setRGB(lerp(0.04, 0.008, p), lerp(0.05, 0.075, p), lerp(0.032, 0.09, p));
    WORLD_UNIFORMS.uPurity.value = p;
    WORLD_UNIFORMS.uUnderwaterColor.value.copy(u.uDeep.value).multiplyScalar(u.uLight.value * 1.4);

    // Near mesh follows the camera, snapped to its grid so vertices don't swim.
    const cell = NEAR_SIZE / NEAR_SEGMENTS;
    this.near.position.set(Math.round(camera.position.x / cell) * cell, 0, Math.round(camera.position.z / cell) * cell);
    u.uNearCenter.value.copy(this.near.position);
  }

  // Planar reflection pass (call before the main render).
  renderReflection(camera) {
    if (!this.reflectionRT || this.reflectionScale <= 0) return;
    const r = this.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(64, Math.floor(size.x * this.reflectionScale));
    const h = Math.max(64, Math.floor(size.y * this.reflectionScale));
    const key = `${w}x${h}`;
    if (key !== this.lastRTSize) {
      this.reflectionRT.setSize(w, h);
      this.lastRTSize = key;
    }
    const camPos = camera.getWorldPosition(new THREE.Vector3());
    if (camPos.y < WATER_LEVEL + 0.05) return; // under water: no mirror

    const normal = new THREE.Vector3(0, 1, 0);
    const mirrorPos = new THREE.Vector3(camPos.x, WATER_LEVEL, camPos.z);
    const rot = new THREE.Matrix4().extractRotation(camera.matrixWorld);
    const lookAt = new THREE.Vector3(0, 0, -1).applyMatrix4(rot).add(camPos);
    const vc = this.virtualCamera;
    const view = mirrorPos.clone().sub(camPos).reflect(normal).negate().add(mirrorPos);
    const target = mirrorPos.clone().sub(lookAt).reflect(normal).negate().add(mirrorPos);
    vc.position.copy(view);
    vc.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
    vc.lookAt(target);
    vc.far = camera.far;
    vc.near = camera.near;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);

    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);

    // Oblique near plane = the water surface, so nothing below the water leaks into the mirror.
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(0, WATER_LEVEL - 0.05, 0));
    plane.applyMatrix4(vc.matrixWorldInverse);
    const clip = new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pm = vc.projectionMatrix.elements;
    const q = new THREE.Vector4(
      (Math.sign(clip.x) + pm[8]) / pm[0],
      (Math.sign(clip.y) + pm[9]) / pm[5],
      -1,
      (1 + pm[10]) / pm[14]
    );
    clip.multiplyScalar(2 / clip.dot(q));
    pm[2] = clip.x;
    pm[6] = clip.y;
    pm[10] = clip.z + 1;
    pm[14] = clip.w;

    this.near.visible = false;
    this.far.visible = false;
    const prevTarget = r.getRenderTarget();
    const prevShadow = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(this.reflectionRT);
    r.clear();
    r.render(this.scene, vc);
    r.setRenderTarget(prevTarget);
    r.shadowMap.autoUpdate = prevShadow;
    this.near.visible = true;
    this.far.visible = true;
  }
}

