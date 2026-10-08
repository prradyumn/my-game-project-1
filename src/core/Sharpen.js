import * as THREE from 'three';
import { Effect, EffectAttribute } from 'postprocessing';

// Contrast-adaptive sharpening (after AMD's CAS): the presets that render below the screen's
// native resolution are upscaled by the browser and look soft; this restores the edge detail
// without ringing (flat areas and strong edges are sharpened less). One cheap full-screen pass.

const fragment = /* glsl */ `
uniform float uSharpness;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  vec3 a = texture2D(inputBuffer, uv + vec2(0.0, -texelSize.y)).rgb;
  vec3 b = texture2D(inputBuffer, uv + vec2(-texelSize.x, 0.0)).rgb;
  vec3 d = texture2D(inputBuffer, uv + vec2(texelSize.x, 0.0)).rgb;
  vec3 e = texture2D(inputBuffer, uv + vec2(0.0, texelSize.y)).rgb;
  // work on display-referred values
  vec3 pa = sqrt(max(a, 0.0)), pb = sqrt(max(b, 0.0)), pc = sqrt(max(c, 0.0)), pd = sqrt(max(d, 0.0)), pe = sqrt(max(e, 0.0));
  vec3 mn = min(min(pa, pb), min(min(pc, pd), pe));
  vec3 mx = max(max(pa, pb), max(max(pc, pd), pe));
  vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, 1e-4), 0.0, 1.0));
  vec3 w = amp * (-1.0 / mix(8.0, 4.6, uSharpness));
  vec3 res = ((pa + pb + pd + pe) * w + pc) / (1.0 + 4.0 * w);
  res = clamp(res, 0.0, 1.0);
  outputColor = vec4(res * res, inputColor.a);
}`;

export class SharpenEffect extends Effect {
  constructor(sharpness = 0.4) {
    super('SharpenEffect', fragment, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map([['uSharpness', new THREE.Uniform(sharpness)]]),
    });
  }

  set sharpness(v) {
    this.uniforms.get('uSharpness').value = v;
  }
}
