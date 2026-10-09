import * as THREE from 'three';
import { Effect, EffectAttribute } from 'postprocessing';

// The jolt of a blow on screen: the colour channels split outward from the impact (a lens
// pushed past its limit) and the picture streaks toward it for an instant. Driven by
// Cinematics.js (a parry, a heavy blow, a finisher's last cut, slow motion); its pass is switched
// off whenever both are spent, so it costs nothing the rest of the time.

const fragment = /* glsl */ `
uniform float uChroma;
uniform float uBlur;
uniform vec2 uCenter;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 d = uv - uCenter;
  float r = length(d);
  // split: red out, blue in, growing toward the edges of the frame
  vec2 off = d * uChroma * (0.35 + r);
  vec3 c = vec3(texture2D(inputBuffer, uv + off).r, inputColor.g, texture2D(inputBuffer, uv - off).b);
  // streak toward the impact: a few taps along the line to it, none at its centre
  if (uBlur > 0.0005) {
    vec3 acc = c;
    for (int i = 1; i < 7; i++) {
      float t = float(i) / 7.0 * uBlur * r;
      acc += texture2D(inputBuffer, uv - d * t).rgb;
    }
    c = acc / 7.0;
  }
  outputColor = vec4(c, inputColor.a);
}`;

export class ImpactEffect extends Effect {
  constructor() {
    super('ImpactEffect', fragment, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map([
        ['uChroma', new THREE.Uniform(0)],
        ['uBlur', new THREE.Uniform(0)],
        ['uCenter', new THREE.Uniform(new THREE.Vector2(0.5, 0.5))],
      ]),
    });
  }

  set(chroma, blur, cx = 0.5, cy = 0.5) {
    this.uniforms.get('uChroma').value = chroma;
    this.uniforms.get('uBlur').value = blur;
    this.uniforms.get('uCenter').value.set(cx, cy);
  }
}
