import * as THREE from 'three';
import { Effect, EffectAttribute } from 'postprocessing';

// The air itself lit: the haze over the river and the ghats carries the light of the lamps near
// it, so at dusk and in the mist each diya, each lamp-post, each fire stands in its own glow in
// the air, and a body passing in front of one cuts a shadow out of it (the march stops at what is
// solid). A short ray march per pixel from the lens to the first surface (or 45 m), through a
// haze that hugs the water and thins with height; up to 12 lights (the nearest lamps, Game picks
// them), each scattering by the inverse square of its distance. In the HDR frame, before the
// bloom, so the brightest of it blooms.

const N = 12;

const fragment = /* glsl */ `
uniform vec3 uLightPos[${N}]; // view space
uniform vec3 uLightCol[${N}];
uniform int uLights;
uniform float uDensity;
uniform float uWaterY; // view-independent: the haze's floor (world y)
uniform mat4 uViewInv;
uniform mat4 uProjInv;
void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  if (uLights == 0 || uDensity < 1e-4) { outputColor = inputColor; return; }
  // the ray: from the lens through this pixel, to the surface (view space)
  vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 vp = uProjInv * ndc;
  vec3 hit = vp.xyz / vp.w;
  float dist = min(length(hit), 30.0);
  vec3 dir = normalize(hit);
  const int STEPS = 12;
  float stepLen = dist / float(STEPS);
  // (interleaved gradient noise: an even dither, no grain)
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  vec3 acc = vec3(0.0);
  for (int s = 0; s < STEPS; s++) {
    float t = (float(s) + jitter) * stepLen;
    vec3 p = dir * t;
    // the haze: thick down on the water, thinner up the ghats
    float wy = (uViewInv * vec4(p, 1.0)).y;
    float dens = uDensity * exp(-max(0.0, wy - uWaterY) * 0.18);
    vec3 L = vec3(0.0);
    for (int i = 0; i < ${N}; i++) {
      if (i >= uLights) break;
      vec3 d = uLightPos[i] - p;
      float d2 = dot(d, d);
      // (a glow round each lamp that dies out within a few metres: the air near it, not the sky)
      float fall = max(0.0, 1.0 - d2 / 64.0);
      L += uLightCol[i] * 5.5 * fall * fall / (1.0 + d2 * 0.7);
    }
    acc += L * dens * stepLen;
  }
  outputColor = vec4(inputColor.rgb + acc, inputColor.a);
}`;

export class HazeEffect extends Effect {
  constructor() {
    super('HazeEffect', fragment, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map([
        ['uLightPos', new THREE.Uniform(Array.from({ length: N }, () => new THREE.Vector3()))],
        ['uLightCol', new THREE.Uniform(Array.from({ length: N }, () => new THREE.Vector3()))],
        ['uLights', new THREE.Uniform(0)],
        ['uDensity', new THREE.Uniform(0)],
        ['uWaterY', new THREE.Uniform(0)],
        ['uViewInv', new THREE.Uniform(new THREE.Matrix4())],
        ['uProjInv', new THREE.Uniform(new THREE.Matrix4())],
      ]),
    });
    this._v = new THREE.Vector3();
  }

  /** lights: [{ p: Vector3 (world), col: [r,g,b] }] (nearest first); density: the haze (0 none). */
  set(camera, lights, density, waterY = 0) {
    const u = this.uniforms;
    u.get('uViewInv').value.copy(camera.matrixWorld);
    u.get('uProjInv').value.copy(camera.projectionMatrixInverse);
    const P = u.get('uLightPos').value;
    const C = u.get('uLightCol').value;
    let n = 0;
    for (const l of lights) {
      if (n >= N) break;
      P[n].copy(l.p).applyMatrix4(camera.matrixWorldInverse);
      C[n].set(l.col[0], l.col[1], l.col[2]);
      n++;
    }
    u.get('uLights').value = n;
    u.get('uDensity').value = density;
    u.get('uWaterY').value = waterY;
  }
}
