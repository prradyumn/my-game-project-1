import * as THREE from 'three';
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';

// Reflections in wet stone, traced in screen space: monsoon puddles mirroring the havelis, the
// lamps and Prady; the soaked ghats a broken, smeared copy of the same; the band of step the
// river laps at. The materials already reflect the sky (makeWaterAware: wet stone goes glossy,
// puddles mirror-smooth); this adds what stands *on* the world, which the sky map can't hold.
//
// Per pixel: rebuild the surface from depth (position, and its normal from the neighbours), keep
// only upward faces that are wet by the same rules the materials use (the lap line; rain gloss and
// the puddle noise, copied), and not the river itself (where the ground lies under water, a flat
// pixel at the water's level is the water, which has its own mirror); then march the reflected
// ray through the depth buffer, refine the hit, and blend the colour found there in by Fresnel.
// Rough wet stone breaks the ray with a fixed, world-anchored wobble (no frame-to-frame grain).
// HDR, before the tone map: a lamp in a puddle is as bright as the lamp. Its own pass (it reads
// the picture at other pixels); Game switches it on only where something can be wet.

const fragment = /* glsl */ `
uniform mat4 uProj;
uniform mat4 uInvProj;
uniform mat4 uViewToWorld;
uniform sampler2D uHeightTex;
uniform vec4 uHeightBounds;
uniform float uWaterLevel;
uniform float uRainWet;
uniform float uTime;
uniform float uK;

vec3 wrView(vec2 uv, float d) {
  vec4 c = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return c.xyz / c.w;
}
float wrZ(float d) { return (cameraNear * cameraFar) / ((cameraFar - cameraNear) * d - cameraFar); }
float wrN(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
  float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
  float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  outputColor = inputColor;
  if (uK <= 0.001 || depth >= 0.99999) return;
  vec3 P = wrView(uv, depth);
  if (-P.z > 70.0) return;
  vec3 Px1 = wrView(uv + vec2(texelSize.x, 0.0), readDepth(uv + vec2(texelSize.x, 0.0)));
  vec3 Px0 = wrView(uv - vec2(texelSize.x, 0.0), readDepth(uv - vec2(texelSize.x, 0.0)));
  vec3 Py1 = wrView(uv + vec2(0.0, texelSize.y), readDepth(uv + vec2(0.0, texelSize.y)));
  vec3 Py0 = wrView(uv - vec2(0.0, texelSize.y), readDepth(uv - vec2(0.0, texelSize.y)));
  vec3 dx = abs(Px1.z - P.z) < abs(P.z - Px0.z) ? Px1 - P : P - Px0;
  vec3 dy = abs(Py1.z - P.z) < abs(P.z - Py0.z) ? Py1 - P : P - Py0;
  vec3 N = normalize(cross(dx, dy));
  vec3 Nw = (uViewToWorld * vec4(N, 0.0)).xyz;
  float flatUp = smoothstep(0.82, 0.97, Nw.y);
  if (flatUp <= 0.0) return;
  vec3 W = (uViewToWorld * vec4(P, 1.0)).xyz;
  // not the river's own surface
  float ground = texture2D(uHeightTex, (W.xz - uHeightBounds.xy) / uHeightBounds.zw).r;
  if (ground < uWaterLevel - 0.05 && W.y < uWaterLevel + 0.7) return;
  if (W.y < uWaterLevel - 0.02) return; // (under it: the water takes the reflection)
  // wet by the materials' rules (materials.js makeWaterAware)
  float lapS = fract(uTime * 0.16 + W.x * 0.035 + W.z * 0.02);
  float line = uWaterLevel + 0.06 + 0.1 * smoothstep(0.0, 0.18, lapS) * (1.0 - smoothstep(0.18, 1.0, lapS));
  float lap = 1.0 - smoothstep(line - 0.05, line + 0.45, W.y);
  float pn = wrN(W.xz * 0.45) * 0.65 + wrN(W.xz * 1.7) * 0.35;
  float puddle = flatUp * smoothstep(0.62 - uRainWet * 0.22, 0.7 - uRainWet * 0.2, pn) * smoothstep(0.35, 0.8, uRainWet);
  float gloss = max(lap * 0.8, uRainWet * 0.75) * flatUp;
  float wet = max(puddle, gloss * 0.55);
  if (wet < 0.02) return;
  // a puddle is a mirror; soaked stone breaks the image up (fixed in the world: no grain)
  float rough = mix(0.12, 0.0, puddle);
  vec2 wob = vec2(wrN(W.xz * 9.0), wrN(W.xz * 9.0 + 17.3)) - 0.5;
  wob += (vec2(wrN(W.xz * 31.0 + 3.1), wrN(W.xz * 31.0 + 8.7)) - 0.5) * 0.6;
  // (perturbed in the world, then back to view space: the view rotation is uViewToWorld's transpose)
  vec3 nW = normalize(Nw + vec3(wob.x, 0.0, wob.y) * rough * 2.0);
  vec3 Nr = normalize((vec4(nW, 0.0) * uViewToWorld).xyz);
  vec3 V = normalize(P);
  vec3 R = reflect(V, Nr);
  float facing = 1.0 - smoothstep(-0.1, 0.4, R.z); // (rays back toward the lens leave the screen)
  if (facing <= 0.0) return;
  // march: short steps near, longer ones far; then refine the crossing
  vec3 r = P + Nr * 0.02;
  float stepLen = 0.1 + -P.z * 0.007;
  float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  r += R * stepLen * j;
  vec2 hitUv = vec2(-1.0);
  float travelled = 0.0;
  for (int i = 0; i < 20; i++) {
    vec3 prev = r;
    r += R * stepLen;
    travelled += stepLen;
    vec4 c = uProj * vec4(r, 1.0);
    vec2 s = c.xy / c.w * 0.5 + 0.5;
    if (s.x <= 0.0 || s.y <= 0.0 || s.x >= 1.0 || s.y >= 1.0 || r.z > -cameraNear) break;
    float sz = wrZ(readDepth(s));
    float dz = sz - r.z; // > 0: the scene stands in front of the ray here
    if (dz > 0.0 && dz < 0.35 + stepLen * 1.5) {
      vec3 a = prev, b = r;
      for (int k = 0; k < 5; k++) {
        vec3 m = 0.5 * (a + b);
        vec4 cm = uProj * vec4(m, 1.0);
        vec2 sm = cm.xy / cm.w * 0.5 + 0.5;
        if (wrZ(readDepth(sm)) - m.z > 0.0) b = m; else a = m;
      }
      vec4 cb = uProj * vec4(b, 1.0);
      hitUv = cb.xy / cb.w * 0.5 + 0.5;
      break;
    }
    stepLen *= 1.19;
  }
  if (hitUv.x < 0.0) return;
  vec3 hit = texture2D(inputBuffer, hitUv).rgb;
  vec2 edge = smoothstep(0.0, 0.08, hitUv) * smoothstep(1.0, 0.92, hitUv);
  float fade = edge.x * edge.y * facing * (1.0 - smoothstep(30.0, 45.0, travelled)) * (1.0 - smoothstep(50.0, 70.0, -P.z));
  float cosT = clamp(dot(-V, Nr), 0.0, 1.0);
  float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
  float k = clamp(wet * mix(F, max(F, 0.35), puddle) * fade * uK, 0.0, 0.92);
  outputColor = vec4(mix(inputColor.rgb, hit, k), inputColor.a);
}
`;

export class WetReflectionEffect extends Effect {
  constructor(camera) {
    super('WetReflectionEffect', fragment, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
      uniforms: new Map([
        ['uProj', new THREE.Uniform(new THREE.Matrix4())],
        ['uInvProj', new THREE.Uniform(new THREE.Matrix4())],
        ['uViewToWorld', new THREE.Uniform(new THREE.Matrix4())],
        ['uHeightTex', new THREE.Uniform(null)],
        ['uHeightBounds', new THREE.Uniform(new THREE.Vector4(0, 0, 1, 1))],
        ['uWaterLevel', new THREE.Uniform(0)],
        ['uRainWet', new THREE.Uniform(0)],
        ['uTime', new THREE.Uniform(0)],
        ['uK', new THREE.Uniform(1)],
      ]),
    });
    this.camera = camera;
    this.world = null;
  }

  /** The world's shared uniforms ({ value } objects: rain, time, water level) and the terrain's
   *  height texture with its bounds (Water.js), so wet means what it means to the materials. */
  bindWorld({ rain, time, waterLevel, heightTex, heightBounds }) {
    const u = this.uniforms;
    this.world = { rain, time, waterLevel };
    u.get('uHeightTex').value = heightTex;
    u.get('uHeightBounds').value.copy(heightBounds);
  }

  update() {
    const c = this.camera;
    this.uniforms.get('uProj').value.copy(c.projectionMatrix);
    this.uniforms.get('uInvProj').value.copy(c.projectionMatrixInverse);
    this.uniforms.get('uViewToWorld').value.copy(c.matrixWorld);
    const w = this.world;
    if (!w) return;
    this.uniforms.get('uRainWet').value = w.rain.value;
    this.uniforms.get('uTime').value = w.time.value;
    this.uniforms.get('uWaterLevel').value = w.waterLevel.value;
  }
}
