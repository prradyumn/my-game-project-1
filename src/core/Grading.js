import * as THREE from 'three';
import { BlendFunction, Effect } from 'postprocessing';
import { lerp, smoothstep } from '../utils/math.js';

// Cinematic colour grade, applied after tone mapping (display-referred, perceptual space).
//   split toning  cool shadows / warm highlights (the classic "golden hour" separation)
//   lift/gamma/gain, a gentle S-curve, saturation + vibrance, fine animated film grain
// Presets are keyed by sun elevation, and Ganga purity drives vibrance: Kashi starts a little
// dim and blooms into colour as the flames are lit.
//
// The Cinematic look (Settings: Look) prints all of that onto film, after the painterly grades of
// the great open-world westerns: the dyes bleed a little into each other so the palette holds
// together; greens lean to olive and gold, blues to teal, magentas fade, while saffron, marigold
// and skin keep their richness; the blacks lift into a warm umber (blue by night) and the whites
// roll off into cream paper instead of clipping; the mids get a print's density and contrast.
// Each hour has its own print (dawn rose, noon bleached gold, the golden hour amber over teal
// shadows, night moon-blue around firelight), and each place its mood (applyGrade's place: the
// lanes' ochre dusk, Manikarnika's smoke, the open river's clean light).

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
uniform float uDread; // 0..1: dread (Dread.js): colour drains, shadows sink cold, grain, the edges close in
uniform float uPulse; // 0..1: the heartbeat (the edges close with each beat)
uniform float uBlood; // 0..1: the eclipse (Grahan): the highlights go to blood, the shadows to rust
uniform float uLook; // 0 natural .. 1 cinematic (the film print below)
uniform vec3 uToe; // the print's black: what the deepest shadow lifts to
uniform vec3 uPaper; // the print's white: where the highlights roll off to
uniform vec3 uFilmShadow; // the shadows' cast (the hour's, times the place's)
uniform vec3 uFilmHigh; // the highlights' cast
uniform float uDensity; // a print's weight in the mids (0 none .. ~0.3)
uniform float uFilmContrast; // a print's S-curve (0..1)
uniform float uFilmSat; // overall saturation of the print
uniform float uHue; // how far the hue secondaries go (greens to olive, blues to teal)

float gradeLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// The film print (the Cinematic look). c: display-referred, 0..1.
vec3 filmPrint(vec3 c, vec2 uv) {
  c = clamp(c, 0.0, 1.0);
  // dye crosstalk: each channel takes a little of its neighbours (greys stay grey; green leans
  // warm, so foliage and the river weed go olive)
  c = mat3(0.93, 0.04, 0.02, 0.05, 0.93, 0.05, 0.02, 0.03, 0.93) * c;
  float y0 = gradeLuma(c);
  // hue secondaries, the luminance kept: greens to olive gold, blues deepen toward azure and
  // teal, magentas fade, the warm hues (saffron, marigold, skin, brick) richer
  vec3 hsv = rgb2hsv(c);
  float h = hsv.x;
  float green = smoothstep(0.14, 0.2, h) * (1.0 - smoothstep(0.4, 0.47, h));
  float blue = smoothstep(0.47, 0.52, h) * (1.0 - smoothstep(0.68, 0.75, h));
  float warm = (1.0 - smoothstep(0.09, 0.15, h)) + smoothstep(0.94, 0.99, h);
  float mag = smoothstep(0.77, 0.83, h) * (1.0 - smoothstep(0.9, 0.95, h));
  hsv.x += ((0.16 - h) * 0.35 * green + (0.56 - h) * 0.25 * blue) * uHue;
  hsv.y *= 1.0 - (0.16 * green + 0.4 * mag) * uHue;
  hsv.y *= 1.0 + (0.12 * warm + 0.08 * blue) * uHue * (1.0 - 0.5 * hsv.y);
  vec3 d = hsv2rgb(hsv);
  d *= mix(1.0, y0 / max(gradeLuma(d), 1e-4), 0.6);
  // the print's tone curve on luminance (hue kept): a dense toe about a low mid grey, the top
  // easing flat into white (the tone mapper has already rolled the highlights off; the cream
  // comes from the saturation falling away up there and the paper's warmth)
  float y = gradeLuma(d);
  float piv = 0.42;
  float t = y < piv ? y / piv : (y - piv) / (1.0 - piv);
  float sc = t * t * (3.0 - 2.0 * t);
  float ys = y < piv ? piv * mix(t, sc, 0.65) : piv + (1.0 - piv) * mix(t, sc, 0.45);
  float yc = mix(y, ys, uFilmContrast);
  yc = pow(max(yc, 0.0), 1.0 + uDensity);
  d *= yc / max(y, 1e-4);
  // the print's colour: richer through the mids, falling away in the deepest shadow and sharply
  // in the brightest fifth (film's subtractive colour: no neon whites, no neon sky)
  float yd = gradeLuma(d);
  // (the sky: a pale blue keeps its blue, it neither goes white nor takes the warm cast)
  float skyish = smoothstep(0.5, 0.56, hsv.x) * (1.0 - smoothstep(0.66, 0.72, hsv.x)) * smoothstep(0.06, 0.2, hsv.y);
  float satK = uFilmSat * (1.0 - 0.22 * (1.0 - smoothstep(0.0, 0.12, yd)) - 0.45 * smoothstep(0.78, 1.0, yd) * (1.0 - 0.85 * skyish));
  // the upper sky polarised: a heavier, deeper azure toward the top of the frame
  float upper = skyish * smoothstep(0.4, 0.85, uv.y);
  satK *= 1.0 + 0.15 * upper;
  d = mix(vec3(yd), d, satK) * (1.0 - 0.06 * upper);
  // the hour's casts: into the shadows, into the highlights (the warm one onto sunlit stone and
  // skin, not onto the sky)
  // (skin, saffron, brick: the cool shadow cast mostly kept off them, their shade stays warm)
  float skin = warm * smoothstep(0.12, 0.3, hsv.y);
  d *= mix(vec3(1.0), uFilmShadow, (1.0 - smoothstep(0.0, 0.5, yd)) * (1.0 - 0.45 * skin));
  d *= mix(vec3(1.0), uFilmHigh, smoothstep(0.62, 1.0, yd) * (1.0 - 0.85 * skyish));
  // the print's black and white: tinted, slightly lifted blacks; the paper's warm white
  return uToe + (uPaper - uToe) * clamp(d, 0.0, 1.0);
}

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
  if (uLook > 0.001) {
    g = mix(g, filmPrint(g, uv), uLook);
    // and a lens's vignette, heavier in the dark than over the highlights
    vec2 vc = (uv - 0.5) * vec2(1.15, 1.0);
    float vig = smoothstep(0.12, 0.62, dot(vc, vc)) * 0.22 * (1.0 - 0.6 * gradeLuma(g));
    g *= 1.0 - vig * uLook;
  }
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
  // dread: the colour drains out of the world, the shadows sink cold and green, the picture
  // goes grainy and the edges close in, a little more with every heartbeat
  if (uDread > 0.001) {
    float d = uDread;
    float y = gradeLuma(g);
    vec3 cold = mix(vec3(y) * vec3(0.86, 0.97, 1.02), g, 1.0 - 0.55 * d);
    float shadow = 1.0 - smoothstep(0.0, 0.45, y);
    cold *= mix(vec3(1.0), vec3(0.84, 0.95, 0.9), shadow * d);
    cold = mix(cold, cold * cold * (3.0 - 2.0 * cold), 0.35 * d);
    vec2 vc = (uv - 0.5) * vec2(1.25, 1.0);
    float r = dot(vc, vc);
    float close = smoothstep(0.08 - 0.05 * uPulse * d, 0.55, r) * d * (0.55 + 0.25 * uPulse);
    g = cold * (1.0 - close);
    grain = max(grain, 0.045 * d);
  }
  // Grahan: Rahu has the moon; the night goes to blood
  if (uBlood > 0.001) {
    float y = gradeLuma(g);
    vec3 blood = vec3(y) * mix(vec3(0.62, 0.1, 0.07), vec3(1.35, 0.38, 0.24), smoothstep(0.05, 0.7, y));
    // (fire stays fire: the brightest flames keep some of their own gold)
    float keep = smoothstep(0.75, 1.0, y) * 0.5;
    g = mix(g, mix(blood + g * 0.18, g, keep), 0.85 * uBlood);
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
        ['uDread', new THREE.Uniform(0)],
        ['uPulse', new THREE.Uniform(0)],
        ['uBlood', new THREE.Uniform(0)],
        ['uLook', new THREE.Uniform(0)],
        ['uToe', new THREE.Uniform(V(0, 0, 0))],
        ['uPaper', new THREE.Uniform(V(1, 1, 1))],
        ['uFilmShadow', new THREE.Uniform(V(1, 1, 1))],
        ['uFilmHigh', new THREE.Uniform(V(1, 1, 1))],
        ['uDensity', new THREE.Uniform(0)],
        ['uFilmContrast', new THREE.Uniform(0)],
        ['uFilmSat', new THREE.Uniform(1)],
        ['uHue', new THREE.Uniform(0)],
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
  { e: 0.25, sh: V(0.96, 1.0, 1.04), hi: V(1.05, 1.0, 0.92), lift: V(-0.004, -0.005, -0.004), gain: V(1.02, 1.0, 0.97), con: 0.27, sat: 1.12 }, // morning
  // (midday: blacks set down and a firmer curve: the noon picture read hazy)
  { e: 0.7, sh: V(0.97, 1.0, 1.03), hi: V(1.03, 1.0, 0.96), lift: V(-0.012, -0.012, -0.008), gain: V(1.01, 1, 0.99), con: 0.34, sat: 1.15 }, // midday
];

// The Cinematic print by the hour (same elevations as KEYS): toe (black), paper (white), the
// casts into shadow and highlight, density, contrast, saturation, hue secondaries.
const FILM = [
  { e: -0.3, toe: V(0.027, 0.033, 0.049), paper: V(0.97, 0.965, 0.95), sh: V(0.84, 0.94, 1.14), hi: V(1.14, 1.0, 0.82), den: 0.04, con: 0.46, sat: 1.06, hue: 0.7 }, // night: moon-blue, firelight
  { e: -0.04, toe: V(0.03, 0.027, 0.047), paper: V(0.985, 0.965, 0.945), sh: V(0.86, 0.9, 1.12), hi: V(1.15, 0.98, 0.82), den: 0.05, con: 0.48, sat: 1.08, hue: 0.8 }, // blue hour: violet
  { e: 0.06, toe: V(0.03, 0.03, 0.042), paper: V(1.0, 0.975, 0.935), sh: V(0.87, 0.94, 1.1), hi: V(1.16, 1.0, 0.84), den: 0.1, con: 0.56, sat: 1.14, hue: 1.0 }, // dawn / dusk: rose and amber
  { e: 0.25, toe: V(0.03, 0.036, 0.05), paper: V(1.0, 0.985, 0.955), sh: V(0.88, 0.95, 1.08), hi: V(1.12, 1.02, 0.89), den: 0.1, con: 0.56, sat: 1.12, hue: 1.0 }, // the golden hours: amber over teal
  { e: 0.7, toe: V(0.018, 0.022, 0.032), paper: V(1.0, 0.99, 0.965), sh: V(0.89, 0.96, 1.07), hi: V(1.08, 1.015, 0.92), den: 0.1, con: 0.6, sat: 1.1, hue: 1.0 }, // noon: warm sun, cool shade
];

function lerpFilm(e, out) {
  let i = 0;
  while (i < FILM.length - 2 && e > FILM[i + 1].e) i++;
  const A = FILM[i];
  const B = FILM[i + 1];
  const t = smoothstep(A.e, B.e, e);
  for (const k of ['toe', 'paper', 'sh', 'hi']) out[k].lerpVectors(A[k], B[k], t);
  for (const k of ['den', 'con', 'sat', 'hue']) out[k] = lerp(A[k], B[k], t);
  return out;
}

const film = { toe: V(0, 0, 0), paper: V(1, 1, 1), sh: V(1, 1, 1), hi: V(1, 1, 1), den: 0, con: 0, sat: 1, hue: 0 };

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

/**
 * look: 0 natural .. 1 cinematic. place: the mood where he is ({ shadow, high, sat, density },
 * each eased in by Game as he walks between them; null for none).
 */
export function applyGrade(effect, { sunElevation, purity, underwater, filter = 0, dread = 0, pulse = 0, blood = 0, look = 0, place = null }) {
  effect.uniforms.get('uFilter').value = filter;
  effect.uniforms.get('uDread').value = filter ? 0 : dread;
  effect.uniforms.get('uPulse').value = pulse;
  effect.uniforms.get('uBlood').value = filter ? 0 : blood;
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
  // (the Neutral tone map keeps the scene's own saturation: the grade's lift is trimmed for it)
  u.get('uSaturation').value = tmp.sat * lerp(0.9, 1.04, purity) * (effect.satScale ?? 1);
  u.get('uVibrance').value = lerp(0.1, 0.35, purity);
  u.get('uGamma').value.set(1, 1, 1);
  // the film print (none under a photo filter: those were made on the natural grade)
  const L = filter ? 0 : look;
  u.get('uLook').value = L;
  if (L <= 0) return;
  lerpFilm(sunElevation, film);
  if (underwater) {
    film.sh.set(0.86, 1.0, 1.06);
    film.hi.set(0.96, 1.03, 1.02);
    film.toe.set(0.008, 0.02, 0.026);
  }
  u.get('uToe').value.copy(film.toe);
  u.get('uPaper').value.copy(film.paper);
  u.get('uFilmShadow').value.copy(film.sh);
  u.get('uFilmHigh').value.copy(film.hi);
  if (place) {
    u.get('uFilmShadow').value.multiply(place.shadow);
    u.get('uFilmHigh').value.multiply(place.high);
  }
  u.get('uDensity').value = film.den + (place?.density ?? 0);
  u.get('uFilmContrast').value = film.con;
  u.get('uFilmSat').value = film.sat * (place?.sat ?? 1);
  u.get('uHue').value = film.hue;
}
