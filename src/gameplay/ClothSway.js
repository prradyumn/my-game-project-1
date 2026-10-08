import * as THREE from 'three';

// Prady's cloth and skin, on top of the skinned mesh (no cloth sim, no extra bones):
//   * the dhoti below the waist trails his motion: it lags when he sets off, swings on with
//     him when he stops, flares on turns and flutters a little at a run. On this model the
//     dhoti is the leg surface from the hips to the ankles, so the region is found by height
//     alone (smooth, no seams): nothing above the hips, fading out above the feet, moving more
//     the further it hangs, never more than a few centimetres, so the body can't come apart.
//   * fresh out of the river his skin is glossy and beaded with water (texture-space beads,
//     so they ride the body instead of swimming over it).

const _v = new THREE.Vector3();

export class ClothSway {
  constructor(material) {
    this.u = {
      uClothDisp: { value: new THREE.Vector3() },
      uClothHipY: { value: 1 },
      uClothFootY: { value: 0 },
    };
    this.d = new THREE.Vector3(); // current trailing offset (world, m)
    this.dv = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.prevVel = new THREE.Vector3();
    this.t = 0;
    const prev = material.onBeforeCompile;
    const prevKey = material.customProgramCacheKey;
    material.onBeforeCompile = (shader, renderer) => {
      prev?.call(material, shader, renderer);
      Object.assign(shader.uniforms, this.u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nuniform vec3 uClothDisp;\nuniform float uClothHipY;\nuniform float uClothFootY;`)
        .replace(
          '#include <displacementmap_vertex>',
          `#include <displacementmap_vertex>
          {
            vec4 cw = modelMatrix * vec4(transformed, 1.0);
            float below = clamp((uClothHipY - 0.08 - cw.y) / 0.62, 0.0, 1.0);
            float ankle = smoothstep(uClothFootY + 0.1, uClothFootY + 0.3, cw.y);
            vec3 dW = uClothDisp * below * below * ankle;
            // world -> this mesh's model space (uniform scale + rotation)
            transformed += (vec4(dW, 0.0) * modelMatrix).xyz / dot(modelMatrix[0].xyz, modelMatrix[0].xyz);
          }`
        );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        #ifdef USE_MAP
        if (uSelfWet > 0.01) {
          float bead = smoothstep(0.74, 0.82, wNoise(vMapUv * 460.0)) * smoothstep(0.3, 0.7, wNoise(vMapUv * 37.0));
          roughnessFactor = mix(roughnessFactor, 0.2, uSelfWet * 0.7);
          roughnessFactor = mix(roughnessFactor, 0.05, bead * uSelfWet);
        }
        #endif`
      );
    };
    material.customProgramCacheKey = () => `${prevKey ? prevKey.call(material) : ''}-cloth`;
    material.needsUpdate = true;
  }

  /**
   * vel: Prady's world velocity (m/s), yawRate (rad/s), hipY: world height of his hips,
   * facing: unit forward vector.
   */
  update(dt, { vel, yawRate = 0, hipY, footY, facing, swimming = false }) {
    if (dt <= 0) return;
    this.t += dt;
    const sp = Math.hypot(vel.x, vel.z);
    // cloth trails a little behind the motion, and the hem flares outward on a turn
    this.target.set(-vel.x, 0, -vel.z).multiplyScalar(swimming ? 0.012 : 0.006);
    _v.set(facing.z, 0, -facing.x); // right
    this.target.addScaledVector(_v, THREE.MathUtils.clamp(yawRate, -3, 3) * 0.008);
    // at a run the hem flutters in time with the stride
    if (!swimming && sp > 2.5) {
      const f = Math.min(1, (sp - 2.5) / 3) * 0.008;
      this.target.addScaledVector(_v, Math.sin(this.t * 9.0) * f);
      this.target.y += Math.abs(Math.sin(this.t * 9.0)) * f * 0.5;
    }
    // underdamped spring: overshoots and settles when he stops
    const w = 9;
    const zeta = 0.45;
    this.dv.addScaledVector(_v.subVectors(this.target, this.d), w * w * dt).addScaledVector(this.dv, -2 * zeta * w * dt);
    this.d.addScaledVector(this.dv, dt);
    const L = this.d.length();
    if (L > 0.045) this.d.multiplyScalar(0.045 / L);
    this.u.uClothDisp.value.copy(this.d);
    this.u.uClothHipY.value = hipY;
    this.u.uClothFootY.value = footY;
    this.prevVel.copy(vel);
  }
}
