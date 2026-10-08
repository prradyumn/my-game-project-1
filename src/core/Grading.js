import * as THREE from 'three';
import { BlendFunction, Effect } from 'postprocessing';
import { lerp, smoothstep } from '../utils/math.js';

// Cinematic colour grade, applied after tone mapping (display-referred, perceptual space).
//   split toning  cool shadows / warm highlights (the classic "golden hour" separation)
//   lift/gamma/gain, a gentle S-curve, saturation + vibrance, fine animated film grain
// Presets are keyed by sun elevation, and Ganga purity drives vibrance: Kashi starts a little
// dim and blooms into colour as the flames are lit.

const fragment = /* glsl */ `
uniform vec3 uLift;
uniform vec3 uGamma;
uniform vec3 uGain;
uniform vec3 uShadowTint;
uniform vec3 uHighTint;
uniform float uContrast;
uniform float uSaturation;
uniform float uVibrance;
uniform float uGrain;
uniform float uTime;
uniform float uFilter; // photo mode look: 0 natural, 1 golden film, 2 monsoon teal, 3 Purana Kashi (sepia), 4 black & white, 5 festival, 6 faded instant

float gradeLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 g = pow(max(inputColor.rgb, 0.0), vec3(1.0 / 2.2));
  float l = gradeLuma(g);
  float sh = 1.0 - smoothstep(0.0, 0.5, l);
  float hi = smoothstep(0.5, 1.0, l);
  g *= mix(vec3(1.0), uShadowTint, sh);
  g *= mix(vec3(1.0), uHighTint, hi);
  g = pow(max(g * uGain + uLift * (1.0 - g), 0.0), 1.0 / uGamma);
  // S-curve contrast around mid grey, smooth at the ends
  vec3 s = clamp(g, 0.0, 1.0);
  g = mix(g, s * s * (3.0 - 2.0 * s), uContrast);
  l = gradeLuma(g);
  float mx = max(g.r, max(g.g, g.b));
  float mn = min(g.r, min(g.g, g.b));
  float sat = (mx - mn) / max(mx, 1e-4);
  g = mix(vec3(l), g, uSaturation * (1.0 + uVibrance * (1.0 - sat)));
  float n = fract(sin(dot(uv * vec2(1931.7, 1213.3) + fract(uTime * 7.31), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  // (no grain in normal play: on top of a sharpened, upscaled image it read as noise on faces;
  // the photo-mode looks add their own)
  float grain = uFilter > 0.5 ? uGrain : 0.0;
  if (uFilter > 0.5) {
    float f = uFilter;
    vec3 c = clamp(g, 0.0, 1.0);
    float y = gradeLuma(c);
    vec2 vc = uv - 0.5;
    float vig = 1.0 - dot(vc, vc) * 1.4;
    if (f < 1.5) {
      // golden film: warm highlights, lifted blacks, a soft roll-off
      c = mix(vec3(0.05, 0.035, 0.02), vec3(1.0, 0.97, 0.9), c);
      c *= mix(vec3(0.96, 0.98, 1.04), vec3(1.07, 1.0, 0.88), smoothstep(0.2, 0.9, y));
      grain *= 2.2;
    } else if (f < 2.5) {
      // monsoon teal: cool teal shadows, skin and marigold kept warm
      vec3 teal = vec3(0.86, 1.02, 1.06);
      vec3 warm = vec3(1.08, 0.99, 0.88);
      c *= mix(teal, warm, smoothstep(0.25, 0.75, y));
      c = mix(vec3(y), c, 0.92);
    } else if (f < 3.5) {
      // Purana Kashi: sepia print, heavy vignette, coarse grain
      vec3 sep = vec3(y * 1.07, y * 0.94, y * 0.74) + vec3(0.04, 0.025, 0.0);
      c = sep * (0.55 + 0.45 * vig);
      grain *= 3.5;
    } else if (f < 4.5) {
      // black & white: deep blacks, bright paper, red filter for skies and stone
      float bw = dot(c, vec3(0.45, 0.42, 0.13));
      bw = smoothstep(0.03, 0.97, bw);
      c = vec3(bw) * (0.75 + 0.25 * vig);
      grain *= 2.5;
    } else if (f < 5.5) {
      // festival: rich colour and punch
      c = mix(vec3(y), c, 1.32);
      c = c * c * (3.0 - 2.0 * c) * 0.35 + c * 0.65;
    } else {
      // faded instant: milky blacks, green-cyan shadows, cream highlights
      c = mix(vec3(0.09, 0.11, 0.1), vec3(0.97, 0.94, 0.86), c);
      c = mix(vec3(y), c, 0.82) * (0.88 + 0.12 * vig);
      grain *= 1.6;
    }
    g = c;
    l = gradeLuma(g);
  }
  g += n * grain * (1.0 - l * 0.6);
  outputColor = vec4(pow(clamp(g, 0.0, 1.0), vec3(2.2)), inputColor.a);
}
`;

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export class ColorGradeEffect extends Effect {
  constructor() {
    super('ColorGradeEffect', fragment, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([
        ['uLift', new THREE.Uniform(V(0, 0, 0))],
        ['uGamma', new THREE.Uniform(V(1, 1, 1))],
        ['uGain', new THREE.Uniform(V(1, 1, 1))],
        ['uShadowTint', new THREE.Uniform(V(1, 1, 1))],
        ['uHighTint', new THREE.Uniform(V(1, 1, 1))],
        ['uContrast', new THREE.Uniform(0.2)],
        ['uSaturation', new THREE.Uniform(1)],
        ['uVibrance', new THREE.Uniform(0.2)],
        ['uGrain', new THREE.Uniform(0.02)],
        ['uTime', new THREE.Uniform(0)],
        ['uFilter', new THREE.Uniform(0)],
      ]),
    });
  }

  update(_renderer, _input, dt) {
    this.uniforms.get('uTime').value += dt ?? 0.016;
  }
}

// Presets by sun elevation (sin of elevation). Each: shadow tint, highlight tint, lift, gain,
// contrast (0..1 S-curve mix), saturation.
const KEYS = [
  { e: -0.3, sh: V(0.9, 0.97, 1.12), hi: V(1.08, 0.98, 0.86), lift: V(0.0, 0.006, 0.018), gain: V(1, 1, 1.02), con: 0.22, sat: 0.9 }, // night: moonlit blue, warm fire
  { e: -0.04, sh: V(0.92, 0.95, 1.1), hi: V(1.1, 0.96, 0.86), lift: V(0.01, 0.004, 0.016), gain: V(1.02, 1, 0.98), con: 0.24, sat: 1.0 }, // blue hour
  { e: 0.06, sh: V(0.93, 0.99, 1.06), hi: V(1.08, 1.0, 0.86), lift: V(0.008, 0.004, 0.0), gain: V(1.03, 1.0, 0.95), con: 0.26, sat: 1.12 }, // sunrise gold, teal shadows
  { e: 0.25, sh: V(0.96, 1.0, 1.04), hi: V(1.05, 1.0, 0.92), lift: V(0.004, 0.002, 0.0), gain: V(1.02, 1.0, 0.97), con: 0.22, sat: 1.08 }, // morning
  { e: 0.7, sh: V(0.97, 1.0, 1.03), hi: V(1.03, 1.0, 0.96), lift: V(0, 0, 0), gain: V(1, 1, 0.99), con: 0.28, sat: 1.1 }, // midday
];

function lerpKey(e, out) {
  let i = 0;
  while (i < KEYS.length - 2 && e > KEYS[i + 1].e) i++;
  const A = KEYS[i];
  const B = KEYS[i + 1];
  const t = smoothstep(A.e, B.e, e);
  out.sh.lerpVectors(A.sh, B.sh, t);
  out.hi.lerpVectors(A.hi, B.hi, t);
  out.lift.lerpVectors(A.lift, B.lift, t);
  out.gain.lerpVectors(A.gain, B.gain, t);
  out.con = lerp(A.con, B.con, t);
  out.sat = lerp(A.sat, B.sat, t);
  return out;
}

const tmp = { sh: V(1, 1, 1), hi: V(1, 1, 1), lift: V(0, 0, 0), gain: V(1, 1, 1), con: 0, sat: 1 };

export const PHOTO_FILTERS = ['Natural', 'Golden film', 'Monsoon teal', 'Purana Kashi', 'Black & white', 'Festival', 'Faded instant'];

export function applyGrade(effect, { sunElevation, purity, underwater, filter = 0 }) {
  effect.uniforms.get('uFilter').value = filter;
  const u = effect.uniforms;
  lerpKey(sunElevation, tmp);
  if (underwater) {
    tmp.sh.set(0.85, 1.02, 1.08);
    tmp.hi.set(0.95, 1.04, 1.02);
    tmp.sat *= 0.85;
  }
  u.get('uShadowTint').value.copy(tmp.sh);
  u.get('uHighTint').value.copy(tmp.hi);
  u.get('uLift').value.copy(tmp.lift);
  u.get('uGain').value.copy(tmp.gain);
  u.get('uContrast').value = tmp.con;
  // Kashi blooms into colour as the Ganga is purified
  u.get('uSaturation').value = tmp.sat * lerp(0.9, 1.04, purity);
  u.get('uVibrance').value = lerp(0.1, 0.35, purity);
  u.get('uGamma').value.set(1, 1, 1);
}
