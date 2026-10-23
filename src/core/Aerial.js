import * as THREE from 'three';
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';

// Aerial perspective: the sunlight the air itself scatters toward the lens. The scene's fog greys
// everything into one colour whichever way you look; real haze glows toward the sun (dust and
// water droplets throw light mostly forward) and stays clear and blue away from it. So per pixel,
// from its depth: how much air lies between the lens and the surface, thinning with height, times
// a forward-scattering lobe round the sun (Henyey-Greenstein) in the sun's colour. A low sun over
// the river fills the far bank and the water with its light; at noon it is a faint warmth only.
// HDR, before the tone map. Strength from Game (time of day, cloud; 0 under water).

const fragment = /* glsl */ `
uniform mat4 uProjInv;
uniform mat4 uViewInv;
uniform vec3 uSunV;     // toward the sun, view space
uniform vec3 uSunCol;   // its colour x strength
uniform float uK;       // the air's density (per metre, at the water)

float apHG(float c, float g) { float g2 = g * g; return (1.0 - g2) / (12.566 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  outputColor = inputColor;
  if (uK <= 0.0 || depth >= 0.99999) return;
  vec4 vp = uProjInv * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec3 P = vp.xyz / vp.w;
  float d = length(P);
  vec3 dir = P / d;
  // the air along the ray, thinning with height (a scale height of ~120 m): integrated exactly
  float y0 = uViewInv[3].y;
  float dy = (uViewInv * vec4(dir, 0.0)).y;
  float H = 120.0;
  float od = abs(dy) * d > 0.5 ? uK * H * exp(-max(y0, 0.0) / H) * (1.0 - exp(-dy * d / H)) / dy : uK * d * exp(-max(y0, 0.0) / H);
  float amt = 1.0 - exp(-od);
  float c = dot(dir, uSunV);
  // (a tight forward lobe for the glow round the sun, a broad one for the warmth in the air)
  float ph = apHG(c, 0.8) * 0.6 + apHG(c, 0.3) * 0.4;
  outputColor = vec4(inputColor.rgb + uSunCol * ph * amt, inputColor.a);
}
`;

const _v = new THREE.Vector3();

export class AerialPerspectiveEffect extends Effect {
  constructor() {
    super('AerialPerspectiveEffect', fragment, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map([
        ['uProjInv', new THREE.Uniform(new THREE.Matrix4())],
        ['uViewInv', new THREE.Uniform(new THREE.Matrix4())],
        ['uSunV', new THREE.Uniform(new THREE.Vector3(0, 1, 0))],
        ['uSunCol', new THREE.Uniform(new THREE.Vector3())],
        ['uK', new THREE.Uniform(0)],
      ]),
    });
  }

  /** sunDir: world, toward the sun; color: its colour; strength: 0 (none) .. 1; density: the
   *  air (per metre at the water's level). */
  set(camera, sunDir, color, strength, density = 0.0016) {
    const u = this.uniforms;
    u.get('uProjInv').value.copy(camera.projectionMatrixInverse);
    u.get('uViewInv').value.copy(camera.matrixWorld);
    u.get('uSunV').value.copy(_v.copy(sunDir).transformDirection(camera.matrixWorldInverse));
    u.get('uSunCol').value.set(color.r, color.g, color.b).multiplyScalar(strength * 6.0);
    u.get('uK').value = strength > 0.001 ? density : 0;
  }
}
