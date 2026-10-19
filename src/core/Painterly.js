import * as THREE from 'three';
import { Effect, EffectAttribute } from 'postprocessing';

// The Painterly look (Settings: Look): the finished frame repainted as if in oils on canvas.
//   * a Kuwahara filter (the picture's 5 x 5 neighbourhood seen as four overlapping 3 x 3
//     quadrants; each pixel takes the colour of the calmest of them): flat colour fills inside a
//     shape, soft strokes, and the edges between shapes kept sharp, which is what makes a frame
//     read as painted rather than blurred
//   * a soft ink line where light and shade meet (the luminance gradient), as a painter's
//     drawing shows through the paint
//   * a little canvas tooth and a touch more colour
// On the tone-mapped, graded frame (display-referred), before the upscale. One pass, 25 reads.

const fragment = /* glsl */ `
uniform float uStrength;
uniform float uInk;
uniform float uStep;
float lumOf(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  if (uStrength < 0.001) { outputColor = inputColor; return; }
  vec2 px = texelSize * uStep;
  vec3 m0 = vec3(0.0), m1 = vec3(0.0), m2 = vec3(0.0), m3 = vec3(0.0);
  vec3 s0 = vec3(0.0), s1 = vec3(0.0), s2 = vec3(0.0), s3 = vec3(0.0);
  float gx = 0.0, gy = 0.0;
  for (int j = -2; j <= 2; j++) {
    for (int i = -2; i <= 2; i++) {
      vec3 c = texture2D(inputBuffer, uv + vec2(float(i), float(j)) * px).rgb;
      vec3 c2 = c * c;
      // the four quadrants overlap on the centre row and column
      if (i <= 0 && j <= 0) { m0 += c; s0 += c2; }
      if (i >= 0 && j <= 0) { m1 += c; s1 += c2; }
      if (i <= 0 && j >= 0) { m2 += c; s2 += c2; }
      if (i >= 0 && j >= 0) { m3 += c; s3 += c2; }
      // Sobel on the inner 3 x 3
      if (abs(i) <= 1 && abs(j) <= 1) {
        float l = lumOf(c);
        float wx = float(i) * (j == 0 ? 2.0 : 1.0);
        float wy = float(j) * (i == 0 ? 2.0 : 1.0);
        gx += l * wx;
        gy += l * wy;
      }
    }
  }
  const float n = 9.0;
  m0 /= n; m1 /= n; m2 /= n; m3 /= n;
  float v0 = dot(abs(s0 / n - m0 * m0), vec3(1.0));
  float v1 = dot(abs(s1 / n - m1 * m1), vec3(1.0));
  float v2 = dot(abs(s2 / n - m2 * m2), vec3(1.0));
  float v3 = dot(abs(s3 / n - m3 * m3), vec3(1.0));
  // (weighted toward the calmest, not a hard pick: no blocky seams where two are close)
  float w0 = 1.0 / (1e-4 + v0 * v0 * 400.0);
  float w1 = 1.0 / (1e-4 + v1 * v1 * 400.0);
  float w2 = 1.0 / (1e-4 + v2 * v2 * 400.0);
  float w3 = 1.0 / (1e-4 + v3 * v3 * 400.0);
  vec3 paint = (m0 * w0 + m1 * w1 + m2 * w2 + m3 * w3) / (w0 + w1 + w2 + w3);
  // a little more colour, as pigment is
  float L = lumOf(paint);
  paint = mix(vec3(L), paint, 1.12);
  // the drawing under the paint
  float g = sqrt(gx * gx + gy * gy);
  // (strong edges only: the ripples on the river are not drawn, the shapes are)
  float ink = smoothstep(0.3, 0.7, g) * uInk;
  paint *= 1.0 - ink * 0.38;
  // canvas tooth (a weave, a few percent)
  vec2 fp = gl_FragCoord.xy;
  float weave = (sin(fp.x * 1.7) * sin(fp.y * 1.7)) * 0.012 + (hash(floor(fp * 0.5)) - 0.5) * 0.02;
  paint *= 1.0 + weave;
  outputColor = vec4(mix(inputColor.rgb, clamp(paint, 0.0, 1.0), uStrength), inputColor.a);
}`;

export class PainterlyEffect extends Effect {
  constructor() {
    super('PainterlyEffect', fragment, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map([
        ['uStrength', new THREE.Uniform(0)],
        ['uInk', new THREE.Uniform(0.8)],
        ['uStep', new THREE.Uniform(1)],
      ]),
    });
  }

  set(strength, { ink = 0.8, step = 1 } = {}) {
    this.uniforms.get('uStrength').value = strength;
    this.uniforms.get('uInk').value = ink;
    this.uniforms.get('uStep').value = step;
  }
}
