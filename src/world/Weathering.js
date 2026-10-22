import * as THREE from 'three';

// Monsoon on the walls of the city, in the shader alone (no textures):
//   * rain streaks: dark wet runs down the plaster from every sill and roofline, in columns that
//     wander along the wall, longer and fainter as they fall
//   * a grime band at street level: soot, splashed mud and damp, darkest at the foot, with a
//     greenish damp line on the stone
//   * patchy repaint: broad patches a little fresher or more faded (each house repainted bit by bit)
//   * worn edges: corners and the arrises of mouldings rubbed paler (where the surface turns)
// addWeathering(material, { streaks, grime, patches }) on a MeshStandardMaterial already made
// water-aware (it uses vWorldPosW).

const NOISE = /* glsl */ `
float wtH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wtN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wtH(i), wtH(i + vec2(1, 0)), f.x), mix(wtH(i + vec2(0, 1)), wtH(i + vec2(1, 1)), f.x), f.y); }`;

export function addWeathering(material, { streaks = 1, grime = 1, patches = 1, ground = 10.5 } = {}) {
  if (!material || material.userData.weathering) return material;
  material.userData.weathering = true;
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (sh, r) => {
    prev?.call(material, sh, r);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE}`)
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec3 P = vWorldPosW;
          vec3 wn = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
          float wall = 1.0 - smoothstep(0.35, 0.7, abs(wn.y)); // (upright surfaces only)
          // the run along the wall, whichever way it faces
          float hz = P.x * abs(wn.z) + P.z * abs(wn.x);
          // rain streaks: columns (a few per metre) that start at each floor's sills and fade down
          float col = wtN(vec2(hz * 1.6, 0.5)) * 0.65 + wtN(vec2(hz * 5.3, 2.5)) * 0.35;
          float floorY = fract((P.y - ${ground.toFixed(2)}) / 3.4);
          float fall = pow(1.0 - floorY, 1.6); // (darkest just under the sill, gone a floor down)
          float wob = wtN(vec2(hz * 0.9, P.y * 0.15));
          float streak = smoothstep(0.5, 0.74, col + (wob - 0.5) * 0.3) * fall * ${streaks.toFixed(2)};
          // long stains from the roof down the whole face, here and there
          streak = max(streak, smoothstep(0.78, 0.9, wtN(vec2(hz * 0.7, 7.0))) * smoothstep(${ground.toFixed(2)}, ${ground.toFixed(2)} + 14.0, P.y) * 0.6 * ${streaks.toFixed(2)});
          // grime at street level: darker toward the foot, broken up
          float above = P.y - ${ground.toFixed(2)};
          float g = (1.0 - smoothstep(0.0, 3.0, above)) * (0.65 + 0.35 * wtN(vec2(hz * 0.8, P.y * 1.3))) * ${grime.toFixed(2)};
          // patchy repaint
          float pt = (wtN(vec2(hz * 0.18, P.y * 0.22)) - 0.5) * ${patches.toFixed(2)};
          // worn edges: where the surface turns faster than a pixel
          float edge = clamp(length(fwidth(wn)) * 2.0, 0.0, 1.0);
          vec3 c = diffuseColor.rgb;
          c *= 1.0 + pt * 0.32;
          c = mix(c, c * vec3(0.42, 0.4, 0.37), streak * wall * 0.85);
          c = mix(c, c * vec3(0.36, 0.35, 0.31), g * wall);
          c = mix(c, c * vec3(0.7, 0.78, 0.62), g * wall * smoothstep(0.6, 0.0, above) * 0.6); // (the damp line)
          c = mix(c, min(c * 1.25, vec3(1.0)), edge * 0.35);
          diffuseColor.rgb = c;
          roughnessFactor = clamp(roughnessFactor - streak * wall * 0.12, 0.05, 1.0);
        }`
      );
  };
  material.customProgramCacheKey = () => `${prevKey ? prevKey.call(material) : ''}-weathering`;
  material.needsUpdate = true;
  return material;
}
