import * as THREE from 'three';
import { Pass } from 'postprocessing';

// The last pass: from the render resolution up to the screen's own. The presets draw below a
// Retina screen's native resolution (Very High at 1.6x of 2x) and the browser used to stretch the
// canvas up with a plain bilinear filter: a soft, smeared picture. Here the canvas is native and
// the stretch is a Catmull-Rom bicubic (nine bilinear taps), clamped to the four nearest texels
// so a hard edge can't ring. Then contrast-adaptive sharpening (after AMD's CAS) against the same
// four texels: the detail the render scale lost, without ringing. One pass at native resolution.

const fragmentShader = /* glsl */ `
uniform sampler2D tInput;
uniform vec2 uSize;
uniform float uSharpness;
varying vec2 vUv;
void main() {
  vec2 inv = 1.0 / uSize;
  vec2 sp = vUv * uSize;
  vec2 t1 = floor(sp - 0.5) + 0.5;
  vec2 f = sp - t1;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 t0 = (t1 - 1.0) * inv;
  vec2 t3 = (t1 + 2.0) * inv;
  vec2 t12 = (t1 + w2 / w12) * inv;
  vec3 c = texture2D(tInput, vec2(t0.x, t0.y)).rgb * w0.x * w0.y
    + texture2D(tInput, vec2(t12.x, t0.y)).rgb * w12.x * w0.y
    + texture2D(tInput, vec2(t3.x, t0.y)).rgb * w3.x * w0.y
    + texture2D(tInput, vec2(t0.x, t12.y)).rgb * w0.x * w12.y
    + texture2D(tInput, vec2(t12.x, t12.y)).rgb * w12.x * w12.y
    + texture2D(tInput, vec2(t3.x, t12.y)).rgb * w3.x * w12.y
    + texture2D(tInput, vec2(t0.x, t3.y)).rgb * w0.x * w3.y
    + texture2D(tInput, vec2(t12.x, t3.y)).rgb * w12.x * w3.y
    + texture2D(tInput, vec2(t3.x, t3.y)).rgb * w3.x * w3.y;
  // (no overshoot past the neighbourhood: bicubic rings a little at hard edges)
  vec2 p = t1 * inv;
  vec3 a = texture2D(tInput, p).rgb;
  vec3 b = texture2D(tInput, p + vec2(inv.x, 0.0)).rgb;
  vec3 d = texture2D(tInput, p + vec2(0.0, inv.y)).rgb;
  vec3 e = texture2D(tInput, p + inv).rgb;
  vec3 mn = min(min(a, b), min(d, e));
  vec3 mx = max(max(a, b), max(d, e));
  c = clamp(c, mn, mx);
  if (uSharpness > 0.0) {
    // CAS on display-referred values (the sqrt), weaker where contrast is already high
    vec3 pc = sqrt(max(c, 0.0));
    vec3 pmn = sqrt(max(mn, 0.0));
    vec3 pmx = sqrt(max(mx, 0.0));
    vec3 amp = sqrt(clamp(min(pmn, 1.0 - pmx) / max(pmx, 1e-4), 0.0, 1.0));
    vec3 w = amp * (-1.0 / mix(8.0, 4.6, uSharpness));
    vec3 sum = sqrt(max(a, 0.0)) + sqrt(max(b, 0.0)) + sqrt(max(d, 0.0)) + sqrt(max(e, 0.0));
    vec3 r = clamp((sum * w + pc) / (1.0 + 4.0 * w), 0.0, 1.0);
    c = r * r;
  }
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}`;

export class UpscalePass extends Pass {
  constructor(sharpness = 0) {
    super('UpscalePass');
    this.fullscreenMaterial = new THREE.ShaderMaterial({
      name: 'Upscale',
      uniforms: { tInput: { value: null }, uSize: { value: new THREE.Vector2(1, 1) }, uSharpness: { value: sharpness } },
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
  }

  render(renderer, inputBuffer, outputBuffer) {
    const u = this.fullscreenMaterial.uniforms;
    u.tInput.value = inputBuffer.texture;
    u.uSize.value.set(inputBuffer.width, inputBuffer.height);
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
    renderer.render(this.scene, this.camera);
  }
}
