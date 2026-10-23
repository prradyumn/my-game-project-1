import * as THREE from 'three';
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';

// Contact shadows: the small, sharp shadows the shadow map is too coarse to draw (a foot on the
// step, a lota on the stone, the gap under a takht, a fold of cloth), found in screen space. From
// each pixel a short ray walks toward the sun through the depth buffer; if the scene stands in
// front of it within a hand's thickness, the pixel is in a contact shadow. Sharpest where the
// occluder is nearest (the walk stops at the first hit and fades with distance along it), gone
// past 60 m (where the shadow map's own detail is all there is to see). HDR, before the tone map;
// strength follows the sun (Game: setSun).

const fragment = /* glsl */ `
uniform mat4 uProj;
uniform mat4 uInvProj;
uniform vec3 uL;        // toward the sun, in view space
uniform float uLen;     // metres walked (near; grows a little with distance)
uniform float uK;       // strength (0: off)

vec3 csView(vec2 uv, float d) {
  vec4 c = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return c.xyz / c.w;
}
// view-space z of a depth sample, without the matrix (cameraNear / cameraFar: the effect's own)
float csZ(float d) { return (cameraNear * cameraFar) / ((cameraFar - cameraNear) * d - cameraFar); }

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  outputColor = inputColor;
  if (uK <= 0.001 || depth >= 0.99999) return;
  float z0 = csZ(depth);
  if (-z0 > 42.0) return;
  vec3 P = csView(uv, depth);
  float dist = -P.z;
  float L = uLen * (0.7 + dist * 0.025);
  const int N = 10;
  vec3 st = uL * (L / float(N));
  // (a different start on every pixel: banding traded for a fine grain the AA smooths)
  float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  vec3 r = P + uL * (0.012 + dist * 0.0012) + st * j;
  float occ = 0.0;
  float thick = 0.12 + dist * 0.01;
  for (int i = 0; i < N; i++) {
    r += st;
    vec4 c = uProj * vec4(r, 1.0);
    vec2 s = c.xy / c.w * 0.5 + 0.5;
    if (s.x <= 0.0 || s.y <= 0.0 || s.x >= 1.0 || s.y >= 1.0) break;
    float dz = csZ(readDepth(s)) - r.z; // > 0: the scene is in front of the ray here
    if (dz > 0.004 && dz < thick) {
      occ = 1.0 - float(i) / float(N) * 0.6;
      break;
    }
  }
  float fade = 1.0 - smoothstep(26.0, 42.0, dist);
  outputColor = vec4(inputColor.rgb * (1.0 - occ * uK * fade), inputColor.a);
}
`;

const _v = new THREE.Vector3();

export class ContactShadowEffect extends Effect {
  constructor(camera) {
    super('ContactShadowEffect', fragment, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map([
        ['uProj', new THREE.Uniform(new THREE.Matrix4())],
        ['uInvProj', new THREE.Uniform(new THREE.Matrix4())],
        ['uL', new THREE.Uniform(new THREE.Vector3(0, 1, 0))],
        ['uLen', new THREE.Uniform(0.45)],
        ['uK', new THREE.Uniform(0.6)],
      ]),
    });
    this.camera = camera;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.strength = 0.6;
  }

  /** The sun's direction (world, toward it) and how strongly it casts (0 at night). */
  setSun(dir, k) {
    this.sunDir.copy(dir);
    this.strength = k;
  }

  update() {
    const c = this.camera;
    this.uniforms.get('uProj').value.copy(c.projectionMatrix);
    this.uniforms.get('uInvProj').value.copy(c.projectionMatrixInverse);
    _v.copy(this.sunDir).transformDirection(c.matrixWorldInverse);
    this.uniforms.get('uL').value.copy(_v);
    this.uniforms.get('uK').value = this.strength;
  }
}
