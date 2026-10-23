import * as THREE from 'three';
import { WORLD_UNIFORMS } from './materials.js';

// The windows of the city, given depth they do not have. Each is still one flat quad on the wall
// (one instanced draw for them all), but the shader looks *into* it:
//   * the reveal: the opening's outline extruded a hand's span into the wall, found by walking the
//     view ray through the opening's shape (so arches stay arches); its sides and sill catch the light
//     and darken with depth
//   * the sun's shadow cast by the wall into that recess (the back point traced toward the sun:
//     out through the opening, or blocked by the wall around it)
//   * set back in it: painted wooden shutters, one leaf ajar, or an iron grille
//   * behind an open one, a room (interior mapping: the ray carried on into a box of floor, walls
//     and ceiling): lime-washed walls, a calendar, a dado; by day lit only by what comes in through
//     the window, at night by its own bulb (the lit windows: warm, and a curtain)
// windowMaterial({ map, lit }) replaces the flat textured material; setNight(n) on the lit one.
// The opening's outline is worked out, not looked up (winOpen): the march costs no texture reads.

const VERT_HEAD = /* glsl */ `
uniform vec3 uSunDir;
attribute vec3 aWall;
varying vec3 vWall;
varying vec3 vWinV;
varying vec3 vWinL;
varying vec2 vWinSize;
varying float vWinSeed;
`;

const VERT_BODY = /* glsl */ `
{
  mat4 wm = modelMatrix * instanceMatrix;
  vec3 ax = wm[0].xyz, ay = wm[1].xyz, az = wm[2].xyz;
  vec3 V = (wm * vec4(transformed, 1.0)).xyz - cameraPosition;
  // (x, y in the window's own uv per metre travelled; z in metres, + out of the wall)
  float wx = dot(ax, ax), wy = dot(ay, ay), lz = length(az);
  vWinV = vec3(dot(V, ax) / wx, dot(V, ay) / wy, dot(V, az) / lz);
  vWinL = vec3(dot(uSunDir, ax) / wx, dot(uSunDir, ay) / wy, dot(uSunDir, az) / lz);
  vWinSize = vec2(sqrt(wx), sqrt(wy));
  vWall = aWall;
  vWinSeed = fract(sin(dot(wm[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
}
`;

const FRAG_HEAD = /* glsl */ `
uniform float uLitAmt;
varying vec3 vWall;
varying vec3 vWinV;
varying vec3 vWinL;
varying vec2 vWinSize;
varying float vWinSeed;
float wShadow = 1.0;  // direct light kept
float wAO = 1.0;      // indirect light kept
vec3 wEmit = vec3(0.0);
// the opening, exactly as windowTexture draws it (128 x 256 px, 12 px frame): straight jambs up
// to y = 94 px from the top, then a quadratic arch to the crown; on the arch the curve's parameter
// for a height y is t = 1 - sqrt((y - 12) / 82), and its half-width there 52 (1 - t^2)
float winOpen(vec2 p) {
  float px = p.x * 128.0, py = (1.0 - p.y) * 256.0;
  if (px <= 12.0 || px >= 116.0 || py <= 12.0 || py >= 244.0) return 0.0;
  if (py >= 94.0) return 1.0;
  float t = 1.0 - sqrt((py - 12.0) / 82.0);
  return step(abs(px - 64.0), 52.0 * (1.0 - t * t));
}
float winH(float n) { return fract(sin(n * 91.3458) * 47453.5453); }
`;

const FRAG_MAP = /* glsl */ `
{
  vec4 frame = texture2D(map, vMapUv);
  if (winOpen(vMapUv) < 0.5) {
    diffuseColor *= frame;
  } else {
    const float D = 0.24;            // the reveal: how deep the opening is cut into the wall
    vec2 sz = vWinSize;
    bool door = sz.y > 2.4;
    float dz = max(-vWinV.z, 1e-3);
    vec2 slope = vWinV.xy / dz;      // uv moved per metre of depth
    // walk the opening's outline back into the wall
    float zHit = D;
    float prev = 0.0;
    // (half the steps past 30 m, where a window is a few pixels across)
    float nSteps = dot(vWinV, vWinV) * dot(sz, sz) > 0.0 && length(vec3(vWinV.xy * sz, vWinV.z)) > 30.0 ? 4.0 : 8.0;
    for (int i = 1; i <= 8; i++) {
      if (float(i) > nSteps) break;
      float z = D * float(i) / nSteps;
      if (winOpen(vMapUv + slope * z) < 0.5) {
        float a = prev, b = z;
        for (int k = 0; k < 3; k++) { float m = 0.5 * (a + b); if (winOpen(vMapUv + slope * m) < 0.5) b = m; else a = m; }
        zHit = b;
        break;
      }
      prev = z;
    }
    vec3 Lt = vWinL;
    float sunIn = step(0.02, Lt.z);  // (the sun on this side of the wall at all)
    // is a point at depth z (uv p) lit? out toward the sun until it clears the wall face
    #define WIN_LIT(PP, ZZ) (sunIn * winOpen((PP) + Lt.xy * ((ZZ) / max(Lt.z, 0.02))))
    float s1 = winH(vWinSeed * 7.0 + 1.0);
    float s2 = winH(vWinSeed * 13.0 + 2.0);
    vec3 col;
    if (zHit < D - 1e-4) {
      // the reveal: the house's own plaster, the sill worn stone
      vec2 p = vMapUv + slope * zHit;
      float sill = step(p.y, 0.12);
      col = mix(vWall * 0.78, vec3(0.5, 0.46, 0.4), sill);
      float lit = WIN_LIT(p, zHit - 0.01);
      wShadow = mix(0.12, 1.0, lit);
      wAO = mix(0.95, 0.55, zHit / D);
    } else {
      vec2 p = vMapUv + slope * D;   // where the ray meets the shutter plane
      float lit = 0.5 * (WIN_LIT(p, D) + WIN_LIT(p + vec2(0.012, 0.006) / sz, D));
      // what fills the opening
      float kind = s1;
      #ifdef WIN_LIT_ROOMS
        kind = 0.62 + 0.38 * s1;      // (a lit window is open: grille or curtain, never shut)
      #endif
      float leafX = p.x;
      float shut = kind < 0.36 ? 1.0 : (kind < 0.58 ? step(leafX, 0.5) : 0.0);
      // painted wooden shutters: faded teal, indigo, green or brown; planks, rails, a centre split
      vec3 paint = s2 < 0.25 ? vec3(0.28, 0.45, 0.43) : s2 < 0.5 ? vec3(0.27, 0.33, 0.48) : s2 < 0.75 ? vec3(0.33, 0.42, 0.27) : vec3(0.38, 0.26, 0.17);
      float plank = fract(p.x * sz.x / 0.11);
      float seam = smoothstep(0.0, 0.08, plank) * smoothstep(1.0, 0.92, plank);
      float rail = step(0.035, abs(fract(p.y * sz.y / 0.55) - 0.5));
      float split = smoothstep(0.004, 0.012, abs(p.x - 0.5) * sz.x);
      float grain = 0.85 + 0.3 * winH(floor(p.x * sz.x / 0.11) + vWinSeed * 31.0);
      vec3 shutter = paint * grain * mix(0.55, 1.0, seam * split) * mix(0.8, 1.0, rail);
      // the grille: iron bars in front of an open window
      float bars = kind > 0.82 ? 1.0 - step(0.012, abs(fract(p.x * sz.x / 0.13) - 0.5) * 0.13) : 0.0;
      bars = max(bars, kind > 0.82 ? 1.0 - step(0.012, abs(fract(p.y * sz.y / 0.45) - 0.5) * 0.45) : 0.0);
      if (shut > 0.5) {
        col = shutter;
        wShadow = mix(0.1, 1.0, lit);
        wAO = 0.5;
      } else if (bars > 0.5) {
        col = vec3(0.07, 0.065, 0.06);
        wShadow = mix(0.1, 1.0, lit);
        wAO = 0.5;
      } else {
        // the room behind: the ray carried on into it (metres; x across, y up from the sill)
        float sillH = door ? 0.0 : 0.75;
        vec3 o = vec3((p.x - 0.5) * sz.x, p.y * sz.y, 0.0);
        vec3 dir = normalize(vec3(vWinV.x * sz.x, vWinV.y * sz.y, vWinV.z));
        float halfW = max(1.9, sz.x * 1.4), depth = 3.6 + 1.2 * s2, ceilH = 3.0 - sillH;
        float tx = (sign(dir.x) * halfW - o.x) / (abs(dir.x) > 1e-4 ? dir.x : 1e-4);
        float ty = dir.y < 0.0 ? (-sillH - o.y) / dir.y : (ceilH - o.y) / max(dir.y, 1e-4);
        float tz = (-depth - o.z) / min(dir.z, -1e-4);
        float t = min(tx, min(ty, tz));
        vec3 h = o + dir * t;
        vec3 wallC = s2 < 0.4 ? vec3(0.5, 0.56, 0.6) : s2 < 0.7 ? vec3(0.55, 0.6, 0.5) : vec3(0.64, 0.55, 0.52);
        vec3 rc;
        if (t == ty && dir.y < 0.0) {
          rc = vec3(0.32, 0.28, 0.24) * (0.82 + 0.18 * mod(floor(h.x * 1.6) + floor(h.z * 1.6), 2.0)); // (stone tiles)
        } else if (t == ty) {
          rc = vec3(0.62, 0.6, 0.56) * mix(0.55, 1.0, step(0.12, fract(h.z / 0.6))); // (beams)
        } else {
          float hy = h.y + sillH;   // height above the floor
          rc = wallC * mix(0.7, 1.0, step(0.9, hy)); // (a darker dado)
          if (t == tz) {
            // a calendar on the back wall, a doorway into the next room
            vec2 cal = vec2(h.x - (s1 - 0.5) * 1.6, hy - 1.7);
            if (abs(cal.x) < 0.2 && abs(cal.y) < 0.28) rc = mix(vec3(0.85, 0.3, 0.15), vec3(0.9, 0.85, 0.75), step(0.0, cal.y));
            if (abs(h.x + (s2 - 0.5) * 2.0) < 0.45 && hy < 2.1) rc = vec3(0.04);
          } else if (abs(h.z + depth * 0.55) < 0.45 && hy < 1.9) {
            rc = vec3(0.24, 0.16, 0.1); // (an almirah)
          }
        }
        float into = -h.z;
        col = rc;
        wShadow = 0.0;                                  // (no sun inside)
        wAO = 0.13 * exp(-into * 0.45); // (daylight only through the window: dim, and dimmer deeper in)
        #ifdef WIN_LIT_ROOMS
          // its own bulb: warm, from the middle of the ceiling
          vec3 bulb = vec3(0.0, ceilH - 0.4, -depth * 0.45);
          float fall = 1.0 / (1.0 + dot(h - bulb, h - bulb) * 0.22);
          wEmit = rc * vec3(1.0, 0.62, 0.32) * fall * 3.2 * uLitAmt;
          // and a cotton curtain across part of the window, glowing with it
          float cur = s2 < 0.6 ? step(p.x, 0.3 + 0.3 * s1) : 0.0;
          if (cur > 0.5) {
            vec3 cc = s1 < 0.33 ? vec3(0.85, 0.35, 0.12) : s1 < 0.66 ? vec3(0.9, 0.7, 0.2) : vec3(0.7, 0.2, 0.25);
            float fold = 0.8 + 0.2 * sin(p.x * sz.x * 40.0);
            col = cc * fold;
            wShadow = mix(0.1, 1.0, lit);
            wAO = 0.5;
            wEmit = cc * fold * vec3(1.0, 0.7, 0.4) * 1.6 * uLitAmt;
          }
        #endif
      }
    }
    diffuseColor.rgb *= col;
  }
}
`;

/** The material for a set of window quads (map: the frame texture). */
export function windowMaterial({ map, lit = false }) {
  const m = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, roughness: 0.75 });
  const uLitAmt = { value: 0 };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSunDir = WORLD_UNIFORMS.uSunDir;
    sh.uniforms.uLitAmt = uLitAmt;
    if (lit) sh.fragmentShader = '#define WIN_LIT_ROOMS\n' + sh.fragmentShader;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_BODY}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_HEAD}`)
      .replace('#include <map_fragment>', FRAG_MAP)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += wEmit;')
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        reflectedLight.directDiffuse *= wShadow;
        reflectedLight.directSpecular *= wShadow;
        reflectedLight.indirectDiffuse *= wAO;
        reflectedLight.indirectSpecular *= wAO;`
      );
  };
  m.customProgramCacheKey = () => (lit ? 'window-lit' : 'window');
  m.setNight = (n) => (uLitAmt.value = n);
  return m;
}
