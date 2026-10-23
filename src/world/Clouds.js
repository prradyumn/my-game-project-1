import * as THREE from 'three';

// Volumetric clouds: real cumulus over Kashi, raymarched through a slab of sky 1.5-3.4 km up.
//   * shape: a tiling 3D noise (Perlin-Worley for the billows, Worley for the eroded edges), made
//     once on the GPU at load (64^3), scrolled by the wind and slowly evolving
//   * light: Beer-Lambert through the cloud toward the sun (a few steps), the powder effect (the
//     dark crevices of a sunlit cumulus), a forward-and-back phase (the silver lining when you
//     look toward the sun), the sky's own light from above and the haze's from the horizon
//   * cost: marched at a third of the render resolution, a new jitter every frame, blended with
//     the last frames (reprojected by direction: the clouds are kilometres off, only the camera's
//     turn moves them on screen), so few steps look like many
//   * composited on a dome just inside the sky, after the opaque world (it stands in front of the
//     sky only); the river's mirror keeps the sky's own cheap clouds (Water.onReflect)
// Coverage follows the weather; dawn and dusk light them from below, the moon at night.

const SLAB0 = 1300;
const SLAB1 = 2900;

const QUAD_VS = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// ---- the 3D noise (one layer per draw)
const NOISE_FS = /* glsl */ `
precision highp float;
uniform float uZ;
varying vec2 vUv;
vec3 h33(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
float h31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
// tiling cellular noise (period P cells): 1 at the cell points, falling off between
float worley(vec3 p, float P) {
  vec3 id = floor(p);
  vec3 f = fract(p);
  float md = 1.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 o = vec3(float(x), float(y), float(z));
    vec3 r = o + h33(mod(id + o, P)) - f;
    md = min(md, dot(r, r));
  }
  return 1.0 - sqrt(md);
}
// tiling value noise, smoothed
float vnoise(vec3 p, float P) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = h31(mod(i, P)), b = h31(mod(i + vec3(1, 0, 0), P)), c = h31(mod(i + vec3(0, 1, 0), P)), d = h31(mod(i + vec3(1, 1, 0), P));
  float e = h31(mod(i + vec3(0, 0, 1), P)), g = h31(mod(i + vec3(1, 0, 1), P)), h = h31(mod(i + vec3(0, 1, 1), P)), k = h31(mod(i + vec3(1, 1, 1), P));
  return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
}
float remap(float v, float a, float b, float c, float d) { return c + (v - a) / (b - a) * (d - c); }
void main() {
  vec3 p = vec3(vUv, uZ);
  float pf = vnoise(p * 4.0, 4.0) * 0.55 + vnoise(p * 8.0, 8.0) * 0.28 + vnoise(p * 16.0, 16.0) * 0.17;
  float wf = worley(p * 4.0, 4.0) * 0.625 + worley(p * 8.0, 8.0) * 0.25 + worley(p * 16.0, 16.0) * 0.125;
  float pw = clamp(remap(pf, wf - 1.0, 1.0, 0.0, 1.0), 0.0, 1.0); // (Perlin-Worley: billows)
  float det = worley(p * 8.0, 8.0) * 0.625 + worley(p * 16.0, 16.0) * 0.25 + worley(p * 32.0, 32.0) * 0.125;
  gl_FragColor = vec4(pw, wf, det, 1.0);
}`;

// ---- the march
const MARCH_FS = /* glsl */ `
precision highp float;
precision highp sampler3D;
uniform sampler3D uNoise;
uniform sampler2D uHistory;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform mat4 uPrevVP;
uniform vec3 uCam;
uniform vec3 uSun;
uniform vec3 uSunCol;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform float uCover;
uniform float uDensity;
uniform float uTime;
uniform float uFrame;
uniform float uBlend;
uniform vec2 uWind;
varying vec2 vUv;

float remap(float v, float a, float b, float c, float d) { return c + (v - a) / (b - a) * (d - c); }

float density(vec3 p, bool cheap) {
  float h = clamp((p.y - ${SLAB0.toFixed(1)}) / ${(SLAB1 - SLAB0).toFixed(1)}, 0.0, 1.0);
  // cumulus: flat bases, rounded tops
  float shape = smoothstep(0.0, 0.08, h) * smoothstep(1.0, 0.55, h);
  vec3 q = p * 0.00019 + vec3(uWind.x, 0.0, uWind.y) * uTime;
  vec4 n = texture(uNoise, q);
  float base = remap(n.r, -(1.0 - n.g) * 0.55, 1.0, 0.0, 1.0);
  // big gaps of blue sky between the cloud fields
  float field = texture(uNoise, q * 0.12 + 0.37).g;
  float cov = clamp(uCover + (field - 0.55) * 0.9, 0.0, 1.0);
  float d = clamp(remap(base * shape, 1.0 - cov, 1.0, 0.0, 1.0), 0.0, 1.0);
  if (d <= 0.0 || cheap) return d * uDensity;
  // the edges eaten away by the finer noise (wispier at the base, puffier at the top)
  float det = texture(uNoise, q * 3.6 + vec3(0.0, uTime * 0.02, 0.0)).b;
  d = clamp(remap(d, mix(det, 1.0 - det, h) * 0.32, 1.0, 0.0, 1.0), 0.0, 1.0);
  return d * uDensity;
}

float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * 3.14159 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }

void main() {
  vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 rd = normalize((uCamWorld * vec4(vp.xyz / vp.w, 0.0)).xyz);
  vec4 res = vec4(0.0);
  if (rd.y > 0.012) {
    float t0 = (${SLAB0.toFixed(1)} - uCam.y) / rd.y;
    float t1 = (${SLAB1.toFixed(1)} - uCam.y) / rd.y;
    const int N = 28;
    t1 = min(t1, t0 + float(N) * 290.0); // (a step no longer than 240 m: no streaks toward the horizon)
    float dt = (t1 - t0) / float(N);
    // a new start each frame (interleaved gradient noise, shifted by the frame): the history
    // blend turns 30 steps into many
    float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy + uFrame * 5.588238, vec2(0.06711056, 0.00583715))));
    float t = t0 + dt * j;
    float cosT = dot(rd, uSun);
    float phase = mix(hg(cosT, 0.62), hg(cosT, -0.22), 0.35) * 4.0 * 3.14159;
    vec3 col = vec3(0.0);
    float T = 1.0;
    for (int i = 0; i < N; i++) {
      vec3 p = uCam + rd * t;
      float d = density(p, false);
      if (d > 0.002) {
        // toward the sun: how much cloud lies between
        float acc = 0.0;
        for (int k = 1; k <= 4; k++) acc += density(p + uSun * (float(k * k) * 55.0), true) * float(2 * k - 1) * 55.0;
        float sigma = 0.012;
        float Tl = exp(-acc * sigma * 0.85);
        float powder = 1.0 - exp(-d * dt * sigma * 2.0);
        float h = clamp((p.y - ${SLAB0.toFixed(1)}) / ${(SLAB1 - SLAB0).toFixed(1)}, 0.0, 1.0);
        // the sky's light: from above on the tops, little reaching the flat dark bases
        vec3 amb = mix(uHorizon * 0.5, uZenith * 0.8, h) * (0.3 + 0.7 * h);
        vec3 S = uSunCol * Tl * phase * mix(0.6, 1.0, powder) + amb;
        float a = exp(-d * dt * sigma);
        col += T * S * (1.0 - a);
        T *= a;
        if (T < 0.02) break;
      }
      t += dt;
    }
    // far off they melt into the haze of the horizon
    float fade = exp(-max(t0, 0.0) / 26000.0) * smoothstep(0.012, 0.09, rd.y);
    res = vec4(col * fade, (1.0 - T) * fade);
  }
  // the last frames, reprojected by the ray's direction
  vec4 pc = uPrevVP * vec4(rd, 0.0);
  vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
  if (pc.w > 0.0 && puv.x > 0.0 && puv.y > 0.0 && puv.x < 1.0 && puv.y < 1.0) res = mix(res, texture(uHistory, puv), uBlend);
  gl_FragColor = res;
}`;

const DOME_VS = /* glsl */ `
void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const DOME_FS = /* glsl */ `
uniform sampler2D uClouds;
uniform vec2 uRes;
void main() {
  vec4 c = texture2D(uClouds, gl_FragCoord.xy / uRes);
  gl_FragColor = vec4(c.rgb, c.a);
}`;

export class VolumetricClouds {
  constructor(renderer, scene, { quality = 'high' } = {}) {
    this.renderer = renderer;
    this.scale = { low: 0, medium: 0.25, high: 0.28, veryhigh: 0.32, ultra: 0.45 }[quality] ?? 0.28;
    this.on = this.scale > 0 && !(typeof location !== 'undefined' && /[?&]noclouds/.test(location.search));
    if (!this.on) return;
    this.cover = 0.36;
    this.frame = 0;
    this.time = 0;
    this.prevVP = new THREE.Matrix4();
    this.hasPrev = false;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.makeNoise();
    const opts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.rts = [new THREE.WebGLRenderTarget(4, 4, opts), new THREE.WebGLRenderTarget(4, 4, opts)];
    this.cur = 0;
    this.U = {
      uNoise: { value: this.noise.texture },
      uHistory: { value: null },
      uInvProj: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      uPrevVP: { value: new THREE.Matrix4() },
      uCam: { value: new THREE.Vector3() },
      uSun: { value: new THREE.Vector3(0, 1, 0) },
      uSunCol: { value: new THREE.Color(1, 1, 1) },
      uZenith: { value: new THREE.Color(0.3, 0.45, 0.7) },
      uHorizon: { value: new THREE.Color(0.7, 0.75, 0.8) },
      uCover: { value: this.cover },
      uDensity: { value: 1 },
      uTime: { value: 0 },
      uFrame: { value: 0 },
      uBlend: { value: 0 },
      uWind: { value: new THREE.Vector2(0.0024, 0.0009) },
    };
    this.march = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: this.U, vertexShader: QUAD_VS, fragmentShader: MARCH_FS, depthTest: false, depthWrite: false }));
    this.march.frustumCulled = false;
    this.marchScene = new THREE.Scene();
    this.marchScene.add(this.march);
    // the dome: just inside the sky (2500), behind everything else, after the opaque world
    this.domeU = { uClouds: { value: null }, uRes: { value: new THREE.Vector2(1, 1) } };
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(2400, 24, 12),
      new THREE.ShaderMaterial({ uniforms: this.domeU, vertexShader: DOME_VS, fragmentShader: DOME_FS, side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, fog: false })
    );
    this.dome.name = 'clouds';
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1;
    scene.add(this.dome);
  }

  /** The 64^3 noise, one layer at a time, into a 3D target. */
  makeNoise() {
    const S = 64;
    const rt = new THREE.WebGL3DRenderTarget(S, S, S, { depthBuffer: false });
    rt.texture.wrapS = rt.texture.wrapT = rt.texture.wrapR = THREE.RepeatWrapping;
    rt.texture.minFilter = rt.texture.magFilter = THREE.LinearFilter;
    rt.texture.generateMipmaps = false;
    const mat = new THREE.ShaderMaterial({ uniforms: { uZ: { value: 0 } }, vertexShader: QUAD_VS, fragmentShader: NOISE_FS, depthTest: false, depthWrite: false });
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    q.frustumCulled = false;
    const sc = new THREE.Scene();
    sc.add(q);
    const r = this.renderer;
    const prev = r.getRenderTarget();
    for (let z = 0; z < S; z++) {
      mat.uniforms.uZ.value = (z + 0.5) / S;
      r.setRenderTarget(rt, z);
      r.render(sc, this.cam);
    }
    r.setRenderTarget(prev);
    mat.dispose();
    q.geometry.dispose();
    this.noise = rt;
  }

  /** March this frame's clouds (before the main render). size: the render size in pixels. */
  render(camera, size, sky, dt) {
    if (!this.on) return;
    const w = Math.max(64, Math.round(size.x * this.scale));
    const h = Math.max(36, Math.round(size.y * this.scale));
    if (this.rts[0].width !== w || this.rts[0].height !== h) {
      for (const rt of this.rts) rt.setSize(w, h);
      this.hasPrev = false;
    }
    this.time += dt;
    this.frame = (this.frame + 1) % 1024;
    const U = this.U;
    U.uInvProj.value.copy(camera.projectionMatrixInverse);
    U.uCamWorld.value.copy(camera.matrixWorld);
    U.uCam.value.setFromMatrixPosition(camera.matrixWorld);
    U.uTime.value = this.time;
    U.uFrame.value = this.frame;
    // light: the sun by day (warm and low at dawn and dusk), the moon at night
    const day = THREE.MathUtils.smoothstep(sky.sunDir.y, -0.06, 0.1);
    U.uSun.value.copy(day > 0.05 ? sky.sunDir : sky.moonDir || sky.sunDir);
    const sunK = day > 0.05 ? 3.2 * day : 0.25;
    U.uSunCol.value.copy(sky.sunColor).multiplyScalar(sunK);
    U.uZenith.value.copy(sky.zenithColor).multiplyScalar(0.9);
    U.uHorizon.value.copy(sky.horizonColor);
    U.uCover.value = THREE.MathUtils.lerp(this.cover, 0.95, sky.overcast || 0);
    U.uDensity.value = 1 + (sky.overcast || 0) * 0.8;
    // the history: last frame's view, the camera's turn only (the clouds are kilometres away)
    U.uPrevVP.value.copy(this.prevVP);
    U.uBlend.value = this.hasPrev ? 0.86 : 0;
    U.uHistory.value = this.rts[this.cur].texture;
    this.cur = 1 - this.cur;
    const r = this.renderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.rts[this.cur]);
    r.render(this.marchScene, this.cam);
    r.setRenderTarget(prev);
    this.domeU.uClouds.value = this.rts[this.cur].texture;
    this.domeU.uRes.value.copy(size);
    this.dome.position.copy(U.uCam.value);
    // (this frame's turn, for the next frame's reprojection)
    const rot = new THREE.Matrix4().extractRotation(camera.matrixWorld);
    this.prevVP.multiplyMatrices(camera.projectionMatrix, rot.invert());
    this.hasPrev = true;
  }
}
