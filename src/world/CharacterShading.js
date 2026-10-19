// Skin and cloth that read as skin and cloth, in the shader alone (one texture atlas on Prady,
// so the parts are told apart by their colour):
//   * skin (warm, mid-saturation, mid-value): light scattered under it comes back warm and red in
//     its shadows, so a face or a shoulder in shade glows faintly instead of going flat grey-brown
//   * pale cloth (the white dhoti): a soft sheen at grazing angles, as cotton has
// addCharacterShading(material) on a MeshStandardMaterial (after its other layers).

export function addCharacterShading(material) {
  if (!material || material.userData.charShade) return;
  material.userData.charShade = true;
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, r) => {
    prev?.call(material, shader, r);
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <lights_fragment_end>',
      `#include <lights_fragment_end>
  {
    vec3 c = diffuseColor.rgb;
    float mx = max(c.r, max(c.g, c.b));
    float mn = min(c.r, min(c.g, c.b));
    float sat = mx > 1e-3 ? (mx - mn) / mx : 0.0;
    // skin: red over green over blue, moderately saturated, not too bright or dark
    float skin = step(c.b, c.g) * step(c.g, c.r) * smoothstep(0.3, 0.42, sat) * (1.0 - smoothstep(0.65, 0.85, sat)) * smoothstep(0.04, 0.12, mx) * (1.0 - smoothstep(0.75, 0.95, mx));
    vec3 lit = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
    float shade = 1.0 - clamp(dot(lit, vec3(0.3, 0.59, 0.11)) / max(1e-3, mx) * 0.9, 0.0, 1.0);
    reflectedLight.indirectDiffuse += c * vec3(0.32, 0.08, 0.04) * skin * (0.35 + shade * 0.65);
    // pale cloth: a sheen at grazing angles
    float cloth = (1.0 - smoothstep(0.08, 0.22, sat)) * smoothstep(0.5, 0.75, mx);
    float nv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
    reflectedLight.indirectSpecular += lit * pow(1.0 - nv, 4.0) * 0.35 * cloth;
  }`
    );
  };
  material.customProgramCacheKey = () => `${prevKey ? prevKey.call(material) : ''}-charshade`;
  material.needsUpdate = true;
}
