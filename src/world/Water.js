import * as THREE from 'three';
import { FAR_BANK_V, RIVER, WATER_LEVEL, WORLD } from '../config.js';
import { bankSlope, bankV, groundHeight, PROFILE_LEN } from './WorldLayout.js';
import { WORLD_UNIFORMS } from './materials.js';
import { waterNormalTexture } from '../utils/textures.js';
import { clamp, lerp, smoothstep } from '../utils/math.js';
import { WaterRipples } from './WaterRipples.js';

// The Ganga.
//  - Gentle sine waves, evaluated identically on the GPU (looks) and CPU (buoyancy, swimming).
//  - A baked height texture of the river bed gives depth-based colour, clarity and shore foam.
//  - Optional planar reflection (the ghats mirrored in the river at dawn), quality-scaled.
//  - `purity` (0..1, the quest) turns murky water into clear, glittering turquoise.
//  - From Medium up (REFRACT): as the water starts to draw, the colour and depth already drawn
//    under it are copied (grab: a blit, no second render), and the surface bends what is under
//    it and absorbs it along the ray, red first then green (Beer-Lambert), into the silty olive
//    of the river: the steps and legs under it, the hull of a boat, fade with depth.
//  - The detail waves ride a flow map baked from currentAt (two phases crossfaded): faster in
//    mid-river, slack and swirling by the ghats; the scum lines drift with it.
//  - The ripples Prady and the boats stir (WaterRipples), the foam where the water meets things,
//    small waves lapping the steps, the sun's road widening with distance (GGX), light through
//    the crests toward a low sun.

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

export const HEIGHT_BOUNDS = { x0: WORLD.xMin - 30, z0: WORLD.zMin - 10, w: WORLD.xMax - WORLD.xMin + 60, h: WORLD.zMax - WORLD.zMin + 20 };
const NEAR_SIZE = 180;
const NEAR_SEGMENTS = 220;
const _u = { x: 0, z: 0 };

// The lap of the river at the steps: a quick surge, a slow draining back, travelling along the
// bank. (The same in materials.js: the wet line on the stone follows the water's edge.)
export const LAP_GLSL = /* glsl */ `
  float waterLap(vec2 p, float t) {
    float s = fract(t * 0.16 + p.x * 0.035 + p.y * 0.02);
    return smoothstep(0.0, 0.18, s) * (1.0 - smoothstep(0.18, 1.0, s));
  }`;

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform vec4 uWaves[4];
  uniform float uSteep[4];
  uniform vec3 uNearCenter;
  uniform mat4 uTextureMatrix;
  uniform sampler2D uHeightTex;
  uniform vec4 uHeightBounds;
  varying vec3 vWorld;
  varying vec2 vUndisp;
  varying float vFade;
  varying vec4 vReflCoord;
  #include <common>
  #include <fog_pars_vertex>
  ${LAP_GLSL}
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
      // lapping: in the shallows the water surges up the bottom step and drains back
      float gv = texture2D(uHeightTex, (wp.xz - uHeightBounds.xy) / uHeightBounds.zw).r;
      wp.y += waterLap(wp.xz, uTime) * 0.1 * (1.0 - smoothstep(0.0, 1.2, ${WATER_LEVEL.toFixed(2)} - gv));
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
  uniform sampler2D uFlowTex;
  uniform sampler2D uSceneColor;
  uniform sampler2D uSceneDepth;
  uniform vec2 uSceneRes;
  uniform float uCamNear;
  uniform float uCamFar;
  uniform sampler2D uRipple;
  uniform vec4 uRipple0; // centre x, z; size (m); on
  uniform float uRipTexel;
  uniform vec3 uAbsorb;  // per metre along the ray (r, g, b)
  uniform vec3 uScatter; // the colour the depths turn to (light scattered back by the silt)
  uniform vec3 uSSS;     // light through a crest
  uniform float uReflBlur;
  varying vec3 vWorld;
  varying vec2 vUndisp;
  varying float vFade;
  varying vec4 vReflCoord;
  #include <common>
  #include <fog_pars_fragment>

  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float viewZ(float d) { float z = d * 2.0 - 1.0; return 2.0 * uCamNear * uCamFar / (uCamFar + uCamNear - z * (uCamFar - uCamNear)); }
  ${LAP_GLSL}

  void main() {
    // Analytic Gerstner normal (GPU Gems ch.1), evaluated per pixel at the undisplaced point
    vec2 grad = vec2(0.0);
    float lift = 0.0;
    float hw = 0.0;
    for (int i = 0; i < 4; i++) {
      vec4 w = uWaves[i];
      float k = 6.2831853 / w.w;
      float f = k * (dot(w.xy, vUndisp) - sqrt(9.81 / k) * uTime);
      float wa = k * w.z;
      grad += wa * cos(f) * w.xy;
      lift += uSteep[i] * wa * sin(f);
      hw += w.z * sin(f);
    }
    float dist = length(cameraPosition - vWorld);
    vec2 P = vWorld.xz;
    vec2 huv = (P - uHeightBounds.xy) / uHeightBounds.zw;
    float ground = texture2D(uHeightTex, huv).r;
    float depth = max(vWorld.y - ground, 0.0);
    // the current here (baked from currentAt): the small waves ride it, in two phases crossfaded
    // so they never stretch (the flow-map method)
    vec2 flow = texture2D(uFlowTex, huv).rg;
    float ph0 = fract(uTime * 0.3);
    float ph1 = fract(uTime * 0.3 + 0.5);
    float wA = 1.0 - abs(1.0 - 2.0 * ph0);
    vec2 dA = flow * ph0 * 3.333;
    vec2 dB = flow * ph1 * 3.333;
    vec2 nA = texture2D(uNormalMap, (P - dA) * 0.09).xy + texture2D(uNormalMap, (P - dA) * 0.031 + 0.21).xy - 1.0;
    vec2 nB = texture2D(uNormalMap, (P - dB) * 0.09 + 0.5).xy + texture2D(uNormalMap, (P - dB) * 0.031 + 0.71).xy - 1.0;
    // (the blend of the two is flatter at mid-phase: lifted back only part way, or the surface
    // turns rough and scatters the sun's road)
    vec2 nd = (nA * wA + nB * (1.0 - wA)) * 2.0 / mix(1.0, sqrt(wA * wA + (1.0 - wA) * (1.0 - wA)), 0.4);
    float detail = mix(0.55, 0.12, smoothstep(30.0, 500.0, dist));
    vec3 N = normalize(vec3(-grad.x, 1.0 - lift, -grad.y) + vec3(nd.x, 0.0, nd.y) * detail);
    // the ripples stirred round him (WaterRipples), turned back off the steps
    float ripH = 0.0;
    vec2 rv = (P - uRipple0.xy) / uRipple0.z + 0.5;
    if (uRipple0.w > 0.5 && rv.x > 0.0 && rv.y > 0.0 && rv.x < 1.0 && rv.y < 1.0) {
      float h0 = texture2D(uRipple, rv).r;
      float hx = texture2D(uRipple, rv + vec2(uRipTexel, 0.0)).r;
      float hz = texture2D(uRipple, rv + vec2(0.0, uRipTexel)).r;
      float edge = smoothstep(0.0, 0.1, min(min(rv.x, rv.y), min(1.0 - rv.x, 1.0 - rv.y)));
      vec2 rs = vec2(hx - h0, hz - h0) / (uRipple0.z * uRipTexel) * edge;
      rs *= min(1.0, 0.45 / max(length(rs), 1e-4)); // (a ripple tilts the surface a little)
      N = normalize(N + vec3(-rs.x, 0.0, -rs.y) * 0.6);
      ripH = h0 * edge;
    }
    // rain: expanding rings from drops on a jittered grid
    if (uRain > 0.01 && dist < 45.0) {
      vec2 ring = vec2(0.0);
      vec2 gp = P * 1.6;
      vec2 cell = floor(gp);
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        vec2 c = cell + vec2(float(i), float(j));
        float h = hash12(c);
        vec2 ctr = c + 0.2 + 0.6 * vec2(h, fract(h * 13.7));
        float ph = fract(uTime * (0.9 + h * 0.6) + h * 5.0);
        vec2 d = gp - ctr;
        float r = length(d);
        float rad = ph * 0.75;
        float w = (1.0 - ph) * (1.0 - ph) * step(h, uRain);
        float wave = sin((r - rad) * 38.0) * exp(-abs(r - rad) * 14.0) * w;
        ring += (r > 1e-3 ? d / r : vec2(0.0)) * wave;
      }
      N = normalize(N + vec3(ring.x, 0.0, ring.y) * 0.26 * (1.0 - smoothstep(20.0, 45.0, dist)));
    }

    #ifndef NEAR_WATER
      vec2 relF = abs(P - uNearCenter.xz);
      if (max(relF.x, relF.y) < ${(NEAR_SIZE / 2).toFixed(1)}) discard;
    #endif
    vec3 V = normalize(cameraPosition - vWorld);
    bool under = cameraPosition.y < vWorld.y - 0.02;

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
    // roughness: the waves too small to see far off still tilt the light (the sun's long road)
    float rough = 0.035 + 0.2 * smoothstep(25.0, 650.0, dist) + 0.06 * uRain;

    vec3 R = reflect(-V, N);
    vec3 refl = mix(uSkyHorizon, uSkyZenith, pow(clamp(R.y, 0.0, 1.0), 0.45));
    refl += uSunColor * uSunIntensity * pow(max(dot(R, uSunDir), 0.0), 6.0) * 0.18 * (1.0 - uNight);
    if (uUseReflection > 0.5) {
      vec2 ruv = vReflCoord.xy / vReflCoord.w + N.xz * 0.045 * (1.0 - smoothstep(30.0, 300.0, dist));
      // blurred by the ripples, and stretched upright as a mirror on moving water is
      float b = (rough * 0.03 + length(nd) * detail * 0.0035) * uReflBlur;
      vec3 r0 = texture2D(uReflection, ruv).rgb;
      vec3 r1 = texture2D(uReflection, ruv + vec2(0.0, b)).rgb + texture2D(uReflection, ruv - vec2(0.0, b)).rgb;
      vec3 r2 = texture2D(uReflection, ruv + vec2(b * 0.35, b * 2.2)).rgb + texture2D(uReflection, ruv - vec2(b * 0.35, b * 2.2)).rgb;
      refl = r0 * 0.32 + r1 * 0.22 + r2 * 0.12;
    }

    // the sun: GGX, its highlight widening with the roughness into a road toward the horizon; near,
    // the tight glitter of each wavelet as before; and single glints flashing in the road
    vec3 H = normalize(uSunDir + V);
    float nh = max(dot(N, H), 0.0);
    float a2 = rough * rough;
    float dg = nh * nh * (a2 - 1.0) + 1.0;
    float ggx = a2 / (3.14159 * dg * dg);
    float fh = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
    float nearK = 1.0 - smoothstep(40.0, 260.0, dist);
    float spec = ggx * fh * 0.5 + (pow(nh, 900.0) * 24.0 + pow(nh, 140.0) * 0.4) * nearK + pow(nh, 40.0) * 0.25 * uNight;
    // (each a tiny facet at a random point of its 20 cm cell, tilted its own way, flashing only
    // where that tilt throws the sun into the eye, for a moment)
    vec2 gcell = floor(P * 5.0);
    float gr = hash12(gcell);
    float gt = hash12(gcell + floor(uTime * (5.0 + gr * 6.0)));
    vec2 go = vec2(gr, fract(gr * 37.3)) * 0.7 + 0.15;
    float gdot = 1.0 - smoothstep(0.05, 0.14, length(fract(P * 5.0) - go));
    vec3 facet = normalize(N + vec3(fract(gr * 91.7) - 0.5, 0.0, fract(gr * 53.1) - 0.5) * 0.3);
    spec += step(0.45, gt) * gdot * pow(max(dot(facet, H), 0.0), 320.0) * 26.0 * (1.0 - smoothstep(10.0, 160.0, dist)) * (1.0 - 0.7 * uNight);
    vec3 sunSpec = uSunColor * spec * uSunIntensity * smoothstep(-0.02, 0.05, uSunDir.y);

    // the water body
    vec3 body;
    float thick = depth;
    #ifdef REFRACT
      // what is under it (copied as the water began to draw), bent by the surface, absorbed
      // along the ray: red first, then green, into the silt's olive
      vec2 suv = gl_FragCoord.xy / uSceneRes;
      float zS = viewZ(gl_FragCoord.z);
      float zB0 = viewZ(texture2D(uSceneDepth, suv).r);
      vec2 off = N.xz * clamp(zB0 - zS, 0.0, 1.5) * 0.9 / max(zS, 1.0);
      vec2 ruv2 = clamp(suv + off, vec2(0.001), vec2(0.999));
      float zB = viewZ(texture2D(uSceneDepth, ruv2).r);
      // (something standing in front of the surface there: not bent)
      if (zB < zS) { ruv2 = suv; zB = zB0; }
      vec3 under0 = texture2D(uSceneColor, ruv2).rgb;
      float ray = max(zB - zS, 0.0) * dist / max(zS, 1e-3);
      thick = min(depth, ray);
      vec3 T = exp(-uAbsorb * ray);
      body = under0 * T + uScatter * uLight * (1.0 - T);
    #else
      float t = 1.0 - exp(-depth * mix(0.75, 0.24, uPurity));
      body = mix(uShallow, uDeep, t) * uLight;
    #endif
    // light through the crests toward a low sun: they glow
    float crest = clamp(hw * 7.0 + 0.5, 0.0, 1.0);
    float low = 1.0 - smoothstep(0.08, 0.6, uSunDir.y);
    body += uSSS * pow(max(dot(-V, uSunDir), 0.0), 3.0) * crest * (0.35 + low) * uSunIntensity * (1.0 - uNight) * 0.7;

    // foam: where the water meets things (the steps, a post, a hull, a leg: from what is under
    // it), the lapping lines running in to the shore, the scum the current draws out in streaks
    float foamTex = texture2D(uNormalMap, (P - dA) * 0.27 + vec2(uTime * 0.05, 0.0)).r;
    float edgeFoam = (1.0 - smoothstep(0.0, 0.14, thick)) * smoothstep(0.55, 0.78, foamTex + 0.15 * sin(uTime * 1.5 + vWorld.x));
    // (the river's lap is small: thin broken lines in the last hand's depth, not surf)
    float lapLine = (1.0 - smoothstep(0.02, 0.35, depth)) * smoothstep(0.9, 1.0, sin(depth * 14.0 + uTime * 1.4 + foamTex * 3.0)) * smoothstep(0.45, 0.7, foamTex);
    lapLine += (1.0 - smoothstep(0.0, 0.08, depth)) * waterLap(P, uTime) * 0.5;
    vec2 fd = normalize(flow + vec2(1e-4, 0.0));
    vec2 fp = vec2(-fd.y, fd.x);
    float sc = texture2D(uNormalMap, vec2(dot(P - dA, fd), dot(P - dA, fp)) * vec2(0.02, 0.16)).g * wA
             + texture2D(uNormalMap, vec2(dot(P - dB, fd), dot(P - dB, fp)) * vec2(0.02, 0.16) + 0.37).g * (1.0 - wA);
    float scum = smoothstep(0.74, 0.92, sc) * (1.0 - smoothstep(25.0, 140.0, dist)) * mix(0.22, 0.05, uPurity);
    float foam = clamp(max(edgeFoam * 0.35, lapLine * 0.25) + scum, 0.0, 1.0);

    vec3 col = mix(body, refl, F) + sunSpec;
    col = mix(col, vec3(0.9, 0.88, 0.82) * uLight, foam);

    // Ganga's blessing: as purity rises, golden motes glitter on the surface
    vec2 sp = P * 2.2;
    vec2 cell = floor(sp);
    float rnd = hash12(cell);
    float tw = fract(uTime * (0.35 + rnd * 0.5) + rnd * 7.0);
    float glint = step(0.993, rnd) * smoothstep(0.18, 0.0, length(fract(sp) - 0.5)) * sin(tw * 3.14159);
    col += vec3(1.0, 0.72, 0.32) * glint * smoothstep(0.3, 1.0, uPurity) * (0.8 + uNight * 3.0) * (1.0 - smoothstep(15.0, 90.0, dist));

    #ifdef REFRACT
      float alpha = 1.0;
    #else
      float alpha = 1.0 - exp(-depth * mix(1.8, 0.6, uPurity));
      alpha = clamp(max(alpha, F * 0.9), 0.0, 1.0);
      alpha = max(alpha, foam * 0.7);
    #endif
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
    this.noReflect = []; // objects the mirror skips (skipInReflection)

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
      uFlowTex: { value: null },
      uSceneColor: { value: null },
      uSceneDepth: { value: null },
      uSceneRes: { value: new THREE.Vector2(1, 1) },
      uCamNear: { value: 0.1 },
      uCamFar: { value: 3000 },
      uRipple: { value: null },
      uRipple0: { value: new THREE.Vector4(0, 0, 32, 0) },
      uRipTexel: { value: 1 / 256 },
      uAbsorb: { value: new THREE.Vector3() },
      uScatter: { value: new THREE.Color() },
      uSSS: { value: new THREE.Color() },
      uReflBlur: { value: typeof location !== 'undefined' && /[?&]noblur/.test(location.search) ? 0 : 1 },
    });
    this.uniforms = uniforms;
    uniforms.uFlowTex.value = this.bakeFlowTexture();
    this.ripples = new WaterRipples(renderer, uniforms.uHeightTex.value, HEIGHT_BOUNDS, WATER_LEVEL);
    uniforms.uRipTexel.value = this.ripples.texel;

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
    // (the first of the two to draw copies what is already drawn under it: REFRACT)
    const grab = (r) => this.refract && this.grab(r);
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
    this.near.onBeforeRender = grab;
    this.far.onBeforeRender = grab;

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
    // refraction from Medium up (the grab is a full-frame copy: Low keeps the see-through sheet)
    // (?norefract: the old see-through sheet, for side-by-side comparison)
    this.refract = q.reflection > 0 && !(typeof location !== 'undefined' && /[?&]norefract/.test(location.search));
    for (const m of [this.near?.material, this.far?.material]) {
      if (!m) continue;
      if (this.refract) m.defines.REFRACT = '';
      else delete m.defines.REFRACT;
      // (still drawn with the see-through things, after every opaque one it copies; it writes
      // alpha 1 and covers what is under it with its own bent, absorbed copy)
      m.needsUpdate = true;
    }
    this.reflectionScale = q.reflection;
    this.uniforms.uUseReflection.value = q.reflection > 0 ? 1 : 0;
    if (this.reflectionRT) {
      this.reflectionRT.dispose();
      this.reflectionRT = null;
    }
    if (q.reflection > 0) {
      // (multisampled from High up: thin things in the mirror, oars, poles, railings, were stair-stepped)
      this.reflectionRT = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: q.reflection >= 0.45 ? 4 : 0 });
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
      for (let i = 0; i < WAVE_DATA.length; i++) {
        const w = WAVE_DATA[i];
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
    // (the undisplaced point solved in locals, not through _u: this runs thousands of times a
    // frame, and every number stored on an object was a fresh heap allocation)
    let x0 = x;
    let z0 = z;
    const n = WAVE_DATA.length;
    for (let it = 0; it < 3; it++) {
      let dx = 0;
      let dz = 0;
      for (let i = 0; i < n; i++) {
        const w = WAVE_DATA[i];
        const qa = w.q * w.a * Math.cos(w.k * (w.dx * x0 + w.dz * z0 - w.c * t));
        dx += w.dx * qa;
        dz += w.dz * qa;
      }
      x0 = x - dx;
      z0 = z - dz;
    }
    let h = 0;
    for (let i = 0; i < n; i++) {
      const w = WAVE_DATA[i];
      h += w.a * Math.sin(w.k * (w.dx * x0 + w.dz * z0 - w.c * t));
    }
    return WATER_LEVEL + h;
  }

  // Surface normal (boat pitch/roll, swimmer tilt)
  normalAt(x, z, out = new THREE.Vector3(), t = this.time) {
    const p = this.undisplaced(x, z, t);
    let gx = 0;
    let gz = 0;
    let lift = 0;
    for (let i = 0; i < WAVE_DATA.length; i++) {
      const w = WAVE_DATA[i];
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
    const v = bankV(x, z); // (no objects: this runs for every flower, boat and swimmer each frame)
    const span = FAR_BANK_V - PROFILE_LEN;
    const across = clamp((v - PROFILE_LEN) / span, 0, 1);
    const profile = Math.pow(Math.sin(Math.PI * across), 0.6) * smoothstep(PROFILE_LEN - 1, PROFILE_LEN + 6, v);
    const pulse = 1 + 0.12 * Math.sin(this.time * 0.09 + x * 0.013);
    const sp = RIVER.flowSpeed * (0.25 + 1.05 * profile) * pulse * smoothstep(PROFILE_LEN - 1, PROFILE_LEN + 2, v);
    const slope = bankSlope(x);
    const tl = Math.hypot(1, slope);
    out.x = sp / tl;
    out.z = (slope / tl) * sp;
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
    this.uniforms.uFlowTex.value?.dispose();
    this.uniforms.uFlowTex.value = this.bakeFlowTexture();
  }

  /** The current over the whole river (currentAt, m/s), as a texture over the height map's bounds. */
  bakeFlowTexture() {
    const W = 512;
    const H = Math.round((W * HEIGHT_BOUNDS.h) / HEIGHT_BOUNDS.w);
    const data = new Uint16Array(W * H * 2);
    const c = { x: 0, z: 0 };
    const t = this.time;
    this.time = 0; // (the slow pulse left out: the map holds the steady current)
    for (let j = 0; j < H; j++) {
      const z = HEIGHT_BOUNDS.z0 + ((j + 0.5) / H) * HEIGHT_BOUNDS.h;
      for (let i = 0; i < W; i++) {
        const x = HEIGHT_BOUNDS.x0 + ((i + 0.5) / W) * HEIGHT_BOUNDS.w;
        this.currentAt(x, z, c);
        data[(j * W + i) * 2] = THREE.DataUtils.toHalfFloat(c.x);
        data[(j * W + i) * 2 + 1] = THREE.DataUtils.toHalfFloat(c.z);
      }
    }
    this.time = t;
    const tex = new THREE.DataTexture(data, W, H, THREE.RGFormat, THREE.HalfFloatType);
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * As the water starts to draw (the opaque world done): copy the colour and depth drawn so far
   * into textures of its own (a framebuffer blit), for the refraction. Once a frame.
   */
  grab(renderer) {
    const frame = renderer.info.render.frame;
    if (this.grabFrame === frame) return;
    this.grabFrame = frame;
    const gl = renderer.getContext();
    const src = renderer.getRenderTarget();
    const w = src ? src.width : gl.drawingBufferWidth;
    const h = src ? src.height : gl.drawingBufferHeight;
    let rt = this.grabRT;
    if (!rt || rt.width !== w || rt.height !== h) {
      rt?.dispose();
      const dt = new THREE.DepthTexture(w, h);
      dt.type = src?.depthTexture?.type ?? THREE.UnsignedIntType;
      dt.format = src?.depthTexture?.format ?? THREE.DepthFormat;
      rt = this.grabRT = new THREE.WebGLRenderTarget(w, h, { type: src?.texture.type ?? THREE.HalfFloatType, depthBuffer: true, depthTexture: dt, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
      rt.texture.generateMipmaps = false;
      renderer.initRenderTarget(rt);
      renderer.setRenderTarget(src); // (its target bound again, through three's own state)
      this.grabChecked = 0;
      this.uniforms.uSceneColor.value = rt.texture;
      this.uniforms.uSceneDepth.value = rt.depthTexture;
    }
    this.uniforms.uSceneRes.value.set(w, h);
    const sp = src ? renderer.properties.get(src) : null;
    const from = sp ? sp.__webglMultisampledFramebuffer || sp.__webglFramebuffer : null;
    const to = renderer.properties.get(rt).__webglFramebuffer;
    // (through three's state cache, so its own later blits, the mirror's resolve, read from the
    // framebuffer it believes is bound)
    const st = renderer.state;
    const bind = (t, f) => {
      gl.bindFramebuffer(t, f);
      st.bindFramebuffer(t, f);
    };
    bind(gl.READ_FRAMEBUFFER, from);
    bind(gl.DRAW_FRAMEBUFFER, to);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT | (this.noDepthBlit ? 0 : gl.DEPTH_BUFFER_BIT), gl.NEAREST);
    // (the first few: a depth format that will not blit is caught, and the colour still copied)
    if (this.grabChecked < 3) {
      this.grabChecked++;
      if (gl.getError() !== gl.NO_ERROR && !this.noDepthBlit) {
        this.noDepthBlit = true;
        console.warn('Water: the depth would not copy; refraction without it');
        gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      }
    }
    bind(gl.DRAW_FRAMEBUFFER, from); // (drawing on into it, as three left it)
  }

  /** Something touched the river at (x, z): ripples (radius m, strength m). */
  disturb(x, z, radius, strength) {
    this.ripples.disturb(x, z, radius, strength);
  }

  /** Step the ripples round focus (before the frame's render). */
  simulate(dt, focus) {
    this.ripples.update(dt, focus);
    const u = this.uniforms;
    u.uRipple.value = this.ripples.texture;
    u.uRipple0.value.set(this.ripples.center.x, this.ripples.center.y, this.ripples.size, this.ripples.active ? 1 : 0);
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
    // along the ray: the silt takes the blue and the water the red; purified, only the red goes
    u.uAbsorb.value.set(lerp(0.85, 0.34, p), lerp(0.5, 0.075, p), lerp(0.72, 0.06, p));
    u.uScatter.value.setRGB(lerp(0.06, 0.006, p), lerp(0.066, 0.055, p), lerp(0.038, 0.07, p));
    u.uSSS.value.setRGB(lerp(0.32, 0.08, p), lerp(0.3, 0.45, p), lerp(0.1, 0.4, p));
    u.uCamNear.value = camera.near;
    u.uCamFar.value = camera.far;
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
    const size = this.drawSize ? this.drawSize(new THREE.Vector2()) : r.getDrawingBufferSize(new THREE.Vector2());
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
    // (the small things never read in a quarter-resolution mirror under ripples: props, stalls,
    // the saris and kites, ladders, the animals. Skipping them halves the pass's draw calls)
    for (const o of this.noReflect) {
      o.userData.rv = o.visible;
      o.visible = false;
    }
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
    for (const o of this.noReflect) o.visible = o.userData.rv;
  }

  /** Leave these out of the mirror (small things: they cost draw calls and never read in it). */
  skipInReflection(...objs) {
    for (const o of objs) if (o && !this.noReflect.includes(o)) this.noReflect.push(o);
  }
}

