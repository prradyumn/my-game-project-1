import * as THREE from 'three';

// Height fog with sun in-scattering, installed into three.js's fog shader chunks so EVERY
// material (built-in and custom) gets it.
//
//   density(h) = d0 * exp(-falloff * (h - base))      (haze hugs the river, thins with height)
//   optical depth along a ray = d0 * e^(-f*h0) * L * (1 - e^(-f*dy)) / (f*dy)
//   fog colour = fogColor + sunColor * max(dot(ray, sun), 0)^power * strength
//
// Extra uniforms are shared PLAIN objects ({x,y,z}): three.js copies plain objects by reference
// when it clones material uniforms, so mutating FOG updates every program at once.

export const FOG = {
  sunDir: { x: 0, y: 1, z: 0 },
  sunColor: { x: 1, y: 0.8, z: 0.6 },
  params: { x: 0.035, y: 0, z: 8, w: 0.6 }, // falloff (1/m), base height, sun power, sun strength
};

let installed = false;

export function installHeightFog() {
  if (installed) return;
  installed = true;
  const extra = {
    fogSunDir: { value: FOG.sunDir },
    fogSunColor: { value: FOG.sunColor },
    fogParams: { value: FOG.params },
  };
  Object.assign(THREE.UniformsLib.fog, extra);
  for (const lib of Object.values(THREE.ShaderLib)) {
    if (lib.uniforms?.fogColor) Object.assign(lib.uniforms, extra);
  }

  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
#endif`;

  THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  // world position from view space (view rotation is orthonormal: inverse = transpose)
  vFogWorldPos = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);
#endif`;

  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform vec3 fogSunDir;
  uniform vec3 fogSunColor;
  uniform vec4 fogParams;
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;

  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    vec3 fogRay = vFogWorldPos - cameraPosition;
    float fogDist = length(fogRay);
    float fogFall = fogParams.x;
    float fogAmount;
    if (fogFall > 1e-4) {
      float h0 = cameraPosition.y - fogParams.y;
      float ft = fogFall * fogRay.y;
      float fk = abs(ft) > 1e-3 ? (1.0 - exp(-ft)) / ft : 1.0;
      fogAmount = fogDensity * exp(-fogFall * h0) * fogDist * fk;
    } else {
      fogAmount = fogDensity * fogDensity * vFogDepth * vFogDepth;
    }
    float fogFactor = 1.0 - exp(-max(fogAmount, 0.0));
    vec3 fogDir = fogRay / max(fogDist, 1e-4);
    float fogSun = pow(max(dot(fogDir, fogSunDir), 0.0), max(fogParams.z, 1.0)) * fogParams.w;
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor + fogSunColor * fogSun, fogFactor);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
  #endif
#endif`;
}
