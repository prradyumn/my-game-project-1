import * as THREE from 'three';
import { WATER_LEVEL } from '../config.js';

// Uniforms shared by every "water-aware" material. Updated once per frame by Game.
export const WORLD_UNIFORMS = {
  uTime: { value: 0 },
  uWaterLevel: { value: WATER_LEVEL },
  uSunColor: { value: new THREE.Color(1, 1, 1) },
  uCaustics: { value: 1 },
  uPurity: { value: 0 },
  uUnderwaterColor: { value: new THREE.Color(0.05, 0.08, 0.06) },
  // Baked night light (Night.js): warm candle/lamp light painted onto the ghats and facades.
  uNLMap: { value: null },
  uNLHeight: { value: null },
  uNLBounds: { value: new THREE.Vector4(0, 0, 1, 1) },
  uNightLight: { value: 0 },
  // monsoon: how wet the world is (0 dry .. 1 soaked); Weather.js drives it
  uRainWet: { value: 0 },
};

const GLSL_COMMON = /* glsl */ `
uniform float uTime;
uniform float uWaterLevel;
uniform vec3 uSunColor;
uniform float uCaustics;
uniform float uPurity;
uniform vec3 uUnderwaterColor;
uniform sampler2D uNLMap;
uniform sampler2D uNLHeight;
uniform vec4 uNLBounds;
uniform float uNightLight;
uniform float uRainWet;
uniform float uSelfWet;
varying vec3 vWorldPosW;

float wNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
  float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
  float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

vec2 wHash22(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
// Distance between the two nearest animated cell points: small on cell borders -> bright lines.
float wVoronoiEdge(vec2 x, float t) {
  vec2 n = floor(x);
  vec2 f = fract(x);
  float f1 = 8.0;
  float f2 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = wHash22(n + g);
      o = 0.5 + 0.42 * sin(t + 6.2831 * o);
      float d = length(g + o - f);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
  }
  return f2 - f1;
}
float wCaustic(vec2 p, float t) {
  float a = wVoronoiEdge(p * 0.6, t * 0.9);
  float b = wVoronoiEdge(p * 0.6 * 1.37 + 3.1, -t * 0.7 + 1.7);
  float c = (1.0 - smoothstep(0.0, 0.2, a)) * 0.65 + (1.0 - smoothstep(0.0, 0.2, b)) * 0.55;
  return c * c;
}
`;

/**
 * Patch a MeshStandardMaterial so it shows: wet darkening at the waterline, caustics and
 * depth tint under water. Works for plain and instanced meshes.
 */
export function makeWaterAware(material, { caustics = true, wetness = true, puddles = true, selfWet = null } = {}) {
  // selfWet: a per-material { value } (Prady fresh out of the river)
  const self = selfWet || { value: 0 };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, WORLD_UNIFORMS);
    shader.uniforms.uSelfWet = self;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPosW;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 wpW = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wpW = instanceMatrix * wpW;
        #endif
        vWorldPosW = (modelMatrix * wpW).xyz;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL_COMMON}`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float wLine = uWaterLevel + 0.1 + 0.06 * sin(uTime * 0.9 + vWorldPosW.x * 0.35 + vWorldPosW.z * 0.2);
        float wWet = ${wetness ? '1.0 - smoothstep(wLine - 0.05, wLine + 0.45, vWorldPosW.y)' : '0.0'};
        diffuseColor.rgb *= mix(1.0, 0.58, wWet);
        // rain: everything darkens and turns glossy; flat stone gathers mirror puddles
        float rWet = max(uRainWet, uSelfWet);
        float wPuddle = 0.0;
        if (rWet > 0.001) {
          ${puddles ? `#ifndef FLAT_SHADED
            vec3 wUpN = normalize((vec4(normalize(vNormal), 0.0) * viewMatrix).xyz);
            float flatUp = smoothstep(0.82, 0.97, wUpN.y);
          #else
            float flatUp = 0.0;
          #endif
          float pn = wNoise(vWorldPosW.xz * 0.45) * 0.65 + wNoise(vWorldPosW.xz * 1.7) * 0.35;
          wPuddle = flatUp * smoothstep(0.62 - uRainWet * 0.22, 0.7 - uRainWet * 0.2, pn) * smoothstep(0.35, 0.8, uRainWet);` : ''}
          diffuseColor.rgb *= mix(1.0, 0.7, rWet) * mix(1.0, 0.78, wPuddle);
        }`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.22, wWet * 0.85);
        roughnessFactor = mix(roughnessFactor, 0.3, max(uRainWet, uSelfWet) * 0.75);
        roughnessFactor = mix(roughnessFactor, 0.04, wPuddle);`
      )
      .replace(
        '#include <opaque_fragment>',
        `// warm light from the diyas and lamps (baked map, falls off with height above the lamps)
        if (uNightLight > 0.001) {
          vec2 nlUv = (vWorldPosW.xz - uNLBounds.xy) / uNLBounds.zw;
          if (nlUv.x > 0.0 && nlUv.x < 1.0 && nlUv.y > 0.0 && nlUv.y < 1.0) {
            vec3 nl = texture2D(uNLMap, nlUv).rgb;
            float lampY = texture2D(uNLHeight, nlUv).r * 40.0 - 5.0;
            float ndy = vWorldPosW.y - lampY;
            float fall = exp(-max(ndy, 0.0) * 0.45) * exp(min(ndy, 0.0) * 0.9);
            outgoingLight += diffuseColor.rgb * nl * fall * uNightLight * 2.4;
          }
        }
        float wDepth = uWaterLevel - vWorldPosW.y;
        if (wDepth > 0.0) {
          ${caustics ? 'float wc = wCaustic(vWorldPosW.xz, uTime * 1.3) * uCaustics * exp(-wDepth * 0.22) * smoothstep(0.0, 0.6, wDepth);\n          outgoingLight += diffuseColor.rgb * uSunColor * wc * mix(0.5, 1.2, uPurity);' : ''}
          float wAbsorb = 1.0 - exp(-wDepth * mix(0.5, 0.16, uPurity));
          outgoingLight = mix(outgoingLight, uUnderwaterColor, wAbsorb);
        }
        #include <opaque_fragment>`
      );
  };
  material.customProgramCacheKey = () => `water-aware-${caustics}-${wetness}-${puddles}`;
  return material;
}

export function surfaceMaterial(set, { tint = 0xffffff, normalScale = 1, roughness = 1, metalness = 0, waterAware = true } = {}) {
  const m = new THREE.MeshStandardMaterial({
    color: tint,
    map: set.map,
    normalMap: set.normalMap,
    roughnessMap: set.roughnessMap,
    normalScale: new THREE.Vector2(normalScale, normalScale),
    roughness,
    metalness,
    vertexColors: true,
  });
  return waterAware ? makeWaterAware(m) : m;
}
