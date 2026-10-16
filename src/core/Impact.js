import * as THREE from 'three';
import { Effect, EffectAttribute } from 'postprocessing';

// The jolt of a blow on screen: the colour channels split outward from the impact (a lens
// pushed past its limit) and the picture streaks toward it for an instant. Driven by
// Cinematics.js (a parry, a heavy blow, a finisher's last cut, slow motion); its pass is switched
// off whenever both are spent, so it costs nothing the rest of the time. And the impact frame: a
// tenth of a second where the picture becomes a two-tone ink panel with lines bursting from the blow
// (a perfect parry, a finisher, a power's release).

const fragment = /* glsl */ `
uniform float uChroma;
uniform float uBlur;
uniform vec2 uCenter;
uniform float uFrame;
uniform float uInvert;
float hh(float n){ return fract(sin(n) * 43758.5453); }
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
  // the impact frame (a manga panel for a beat): the picture inked to two tones, lines rushing
  // out from the blow; inverted, the ink turns to light
  if (uFrame > 0.001) {
    float lum = dot(c, vec3(0.299, 0.587, 0.114));
    float ink = smoothstep(0.2, 0.3, lum);
    vec3 paper = vec3(1.0, 0.94, 0.84);
    vec3 m = mix(vec3(0.015, 0.01, 0.02), paper, ink);
    if (uInvert > 0.5) m = paper + vec3(0.015) - m;
    float ang = atan(d.y, d.x);
    float ray = step(0.9, hh(floor(ang * 110.0)));
    float rays = ray * smoothstep(0.1, 0.55, r);
    m = mix(m, uInvert > 0.5 ? vec3(0.0) : paper, rays * 0.9);
    c = mix(c, m, uFrame);
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
        ['uFrame', new THREE.Uniform(0)],
        ['uInvert', new THREE.Uniform(0)],
      ]),
    });
  }

  set(chroma, blur, cx = 0.5, cy = 0.5, frame = 0, invert = 0) {
    this.uniforms.get('uFrame').value = frame;
    this.uniforms.get('uInvert').value = invert;
    this.uniforms.get('uChroma').value = chroma;
    this.uniforms.get('uBlur').value = blur;
    this.uniforms.get('uCenter').value.set(cx, cy);
  }
}
