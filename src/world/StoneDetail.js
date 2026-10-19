import * as THREE from 'three';

// What hides a small texture budget on the ghats' stone, all in the shader (no new textures):
//   * no visible repeat: the texture is read twice at offsets that change from patch to patch
//     over the stone (Inigo Quilez's "texture repetition", the two-sample version) and the two
//     blended where they meet, so the same block pattern never lines up across a flight of steps;
//     colour, relief and roughness move together
//   * large-scale variation: broad patches a little warmer, cooler, lighter, darker
//   * wear from shape: where the surface turns (step nosings, corners) the stone is rubbed paler
//     and smoother by a few centuries of feet; in the creases it gathers grime
//   * the river's marks: a band of moss and silt stain above the water line on the lower steps
// addStoneDetail(material, { moss }) on a MeshStandardMaterial already made water-aware.

const NOISE = /* glsl */ `
float sdH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sdN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(sdH(i), sdH(i + vec2(1, 0)), f.x), mix(sdH(i + vec2(0, 1)), sdH(i + vec2(1, 1)), f.x), f.y); }
// the patch offset field for the no-repeat lookups (same uv in, same offsets out, for every map)
float sdK(vec2 uv){ return sdN(uv * 0.11) * 0.7 + sdN(uv * 0.37) * 0.3; }
vec4 noTile(sampler2D s, vec2 uv){
  float l = sdK(uv) * 7.0;
  float ia = floor(l);
  float f = fract(l);
  vec2 oa = sin(vec2(3.0, 7.0) * ia);
  vec2 ob = sin(vec2(3.0, 7.0) * (ia + 1.0));
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  vec4 a = textureGrad(s, uv + oa, dx, dy);
  vec4 b = textureGrad(s, uv + ob, dx, dy);
  vec4 d = a - b;
  return mix(a, b, smoothstep(0.2, 0.8, f - 0.1 * (d.x + d.y + d.z)));
}`;

export function addStoneDetail(material, { moss = true, macro = 0.18, wear = 1 } = {}) {
  if (!material || material.userData.stoneDetail) return material;
  material.userData.stoneDetail = true;
  const swap = (chunk, from, to) => {
    const src = THREE.ShaderChunk[chunk];
    return src.includes(from) ? src.split(from).join(to) : src;
  };
  const mapChunk = swap('map_fragment', 'texture2D( map, vMapUv )', 'noTile( map, vMapUv )');
  const normChunk = swap('normal_fragment_maps', 'texture2D( normalMap, vNormalMapUv )', 'noTile( normalMap, vNormalMapUv )');
  const roughChunk = swap('roughnessmap_fragment', 'texture2D( roughnessMap, vRoughnessMapUv )', 'noTile( roughnessMap, vRoughnessMapUv )');
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, r) => {
    prev?.call(material, shader, r);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE}\nfloat sdWear = 0.0;`)
      .replace('#include <map_fragment>', `${mapChunk}
  {
    // broad patches of warmer, cooler, lighter, darker stone (vWorldPosW: makeWaterAware)
    vec2 wp = vWorldPosW.xz;
    float m1 = sdN(wp * 0.045) - 0.5;
    float m2 = sdN(wp * 0.17 + 7.3) - 0.5;
    diffuseColor.rgb *= 1.0 + (m1 * 1.4 + m2 * 0.6) * ${macro.toFixed(3)};
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.05, 0.98, 0.9), clamp(m1 + 0.5, 0.0, 1.0) * 0.35);
    // where the surface turns (the step nosings, corners): rubbed paler; in the creases, grime
    vec3 gN = normalize(cross(dFdx(vWorldPosW), dFdy(vWorldPosW)));
    float bend = clamp(length(fwidth(gN)) * 1.6, 0.0, 1.0);
    float up = clamp(gN.y, 0.0, 1.0);
    // (only where a pixel is small enough to see an edge: far off, every pixel spans edges)
    float px = length(fwidth(vWorldPosW));
    sdWear = bend * ${wear.toFixed(2)} * (1.0 - smoothstep(0.02, 0.08, px));
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.18 + 0.03, sdWear * up * 0.8);
    diffuseColor.rgb *= 1.0 - sdWear * (1.0 - up) * 0.25;
    ${
      moss
        ? `// the river's marks: moss and silt in a band above the water line, thickest just above it,
    // in patches, on the stone the river reaches in the monsoon
    float above = vWorldPosW.y - uWaterLevel;
    float band = smoothstep(-0.2, 0.15, above) * (1.0 - smoothstep(0.4, 1.6, above + (sdN(wp * 0.9) - 0.5) * 0.6));
    float patchy = smoothstep(0.35, 0.7, sdN(wp * 0.6 + 3.1) * 0.7 + sdN(wp * 2.3) * 0.3);
    // (a tint that darkens and greens the stone under it: moss is darker than the stone)
    vec3 moss = mix(vec3(0.5, 0.6, 0.34), vec3(0.62, 0.6, 0.42), sdN(wp * 4.0));
    diffuseColor.rgb *= mix(vec3(1.0), moss, band * patchy * 0.75);`
        : ''
    }
  }`)
      .replace('#include <normal_fragment_maps>', normChunk)
      .replace('#include <roughnessmap_fragment>', `${roughChunk}
  roughnessFactor = clamp(roughnessFactor - sdWear * 0.25, 0.04, 1.0);`);
  };
  material.customProgramCacheKey = () => `${prevKey ? prevKey.call(material) : ''}-stone${moss ? 'm' : ''}`;
  material.needsUpdate = true;
  return material;
}
