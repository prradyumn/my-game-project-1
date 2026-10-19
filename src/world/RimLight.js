import * as THREE from 'three';

// A rim of light round the people who matter (Prady, the Asuras): where a surface turns away
// from the lens, a thin edge of the sky's light, as a cinematographer's back light gives them,
// so a figure always reads against the stone, the river and the night. One colour and strength
// for all (RIM, set each frame by Game from the sky: cool by day, warm lamp light at night).

export const RIM = {
  uRimColor: { value: new THREE.Color(0.8, 0.85, 1) },
  uRim: { value: 0.35 },
};

/** Give a standard / physical material the rim (k: its own share, 1 = the full rim). */
export function addRim(material, k = 1) {
  if (!material || material.userData.rim) return;
  material.userData.rim = true;
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  const own = { uRimK: { value: k } };
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    Object.assign(shader.uniforms, RIM, own);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor;\nuniform float uRim;\nuniform float uRimK;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          // (normal and vViewPosition: view space; the edge is where they part)
          float facing = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          float rim = pow(1.0 - facing, 3.2);
          totalEmissiveRadiance += uRimColor * rim * uRim * uRimK;
        }`
      );
  };
  material.customProgramCacheKey = () => `${prevKey ? prevKey.call(material) : ''}-rim`;
  material.needsUpdate = true;
}
