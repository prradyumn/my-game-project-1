import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { TIME } from '../config.js';
import { lerp, smoothstep } from '../utils/math.js';
import { moonTexture } from '../utils/textures.js';
import { FOG } from './Atmosphere.js';

// Day/night cycle. The sun rises over the river (+Z, east), passes high to the south (-X)
// and sets behind the city (-Z, west) — exactly like dawn on the real ghats.

const C = (hex) => new THREE.Color(hex);
// Fog / haze colour keyed by sun elevation (sin of elevation).
const FOG_KEYS = [
  [-0.35, C(0x05070d)],
  [-0.12, C(0x141a2c)],
  [-0.02, C(0x6b4f5a)],
  [0.05, C(0xe0a072)],
  [0.16, C(0xe9c39a)],
  [0.4, C(0xcfd3cf)],
  [1.0, C(0xc4d1d8)],
];
const HEMI_SKY = [
  [-0.3, C(0x22325a)],
  [0.0, C(0x5a4a6a)],
  [0.12, C(0xf0b48a)],
  [0.45, C(0xbcd6ec)],
  [1.0, C(0xbcd6ec)],
];

function sampleKeys(keys, x, out) {
  if (x <= keys[0][0]) return out.copy(keys[0][1]);
  for (let i = 1; i < keys.length; i++) {
    if (x <= keys[i][0]) {
      const t = (x - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]);
      return out.copy(keys[i - 1][1]).lerp(keys[i][1], t);
    }
  }
  return out.copy(keys[keys.length - 1][1]);
}

export class SkySystem {
  constructor(renderer, scene, quality) {
    this.renderer = renderer;
    this.scene = scene;
    this.hours = TIME.startHour;
    this.timeSpeed = 1;
    this.frozen = false;

    this.sky = new Sky();
    this.sky.scale.setScalar(2500);
    // The stock sun disc is ~60,000 HDR units, which floods the bloom; keep it bright but sane.
    this.sky.material.fragmentShader = this.sky.material.fragmentShader.replace('( 760.0 * sundisc )', '( 0.25 * sundisc )');
    const u = this.sky.material.uniforms;
    u.turbidity.value = 6.5;
    u.rayleigh.value = 1.6;
    u.mieCoefficient.value = 0.0032;
    u.mieDirectionalG.value = 0.78;
    scene.add(this.sky);

    // Separate sky just for the environment map (lighting + reflections on metal/water).
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(50);
    this.envSky.material = this.sky.material;
    this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this.lastEnvSunY = -9;
    this.overcast = 0; // set by Weather: a grey, hazy sky (also in the reflections)
    this.lastEnvOvercast = 0;

    this.sunDir = new THREE.Vector3(0, 0.1, 1).normalize();
    this.sunColor = new THREE.Color();
    this.fogColor = new THREE.Color();
    this.horizonColor = new THREE.Color();
    this.zenithColor = new THREE.Color();

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = quality.shadows > 0;
    this.configureShadows(quality.shadows);
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbcd6ec, 0x6b5a45, 0.6);
    scene.add(this.hemi);

    scene.fog = new THREE.FogExp2(0xcccccc, 0.0022);

    // Stars
    const starGeo = new THREE.BufferGeometry();
    const n = 1800;
    const pos = new Float32Array(n * 3);
    const size = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2;
      const y = Math.random() * 0.95 + 0.05;
      const r = Math.sqrt(1 - y * y);
      pos.set([Math.cos(th) * r * 2000, y * 2000, Math.sin(th) * r * 2000], i * 3);
      size[i] = Math.random() < 0.06 ? 3.2 : 1.4 + Math.random() * 1.2;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute('size', new THREE.BufferAttribute(size, 1));
    this.starMat = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float size; varying float vTw; uniform float uTime;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
          gl_Position.z = gl_Position.w * 0.9999;
          vTw = 0.75 + 0.25 * sin(uTime * 2.0 + position.x * 0.13 + position.z * 0.07);
          gl_PointSize = size; }`,
      fragmentShader: /* glsl */ `
        uniform float uOpacity; varying float vTw;
        void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vec3(1.0, 0.97, 0.9) * 2.0, a * uOpacity * vTw); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.stars = new THREE.Points(starGeo, this.starMat);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -1;
    this.stars.layers.set(1); // not mirrored in the river (main camera enables layer 1)
    scene.add(this.stars);

    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTexture(), transparent: true, depthWrite: false, fog: false, color: 0xffffff }));
    this.moon.scale.setScalar(130);
    scene.add(this.moon);

    this.update(0, new THREE.Vector3());
  }

  configureShadows(size) {
    const s = this.sun;
    s.castShadow = size > 0;
    if (!size) return;
    s.shadow.mapSize.set(size, size);
    const ext = size >= 2048 ? 70 : 55;
    const cam = s.shadow.camera;
    cam.left = -ext;
    cam.right = ext;
    cam.top = ext;
    cam.bottom = -ext;
    cam.near = 1;
    cam.far = 400;
    s.shadow.bias = -0.0004;
    s.shadow.normalBias = 0.04;
    if (s.shadow.map) {
      s.shadow.map.dispose();
      s.shadow.map = null;
    }
    cam.updateProjectionMatrix();
  }

  get moonDir() {
    return this._moonDir;
  }

  get nightFactor() {
    return 1 - smoothstep(-0.12, 0.06, this.sunDir.y);
  }

  // 0 at noon/midnight, 1 at sunrise/sunset: drives warm haze and the golden hour look.
  get goldenFactor() {
    return smoothstep(-0.08, 0.04, this.sunDir.y) * (1 - smoothstep(0.08, 0.35, this.sunDir.y));
  }

  setHours(h) {
    this.hours = ((h % 24) + 24) % 24;
  }

  update(dt, focus) {
    if (!this.frozen) this.hours = (this.hours + (dt * this.timeSpeed) / (60 * TIME.minutesPerHour)) % 24;
    const theta = ((this.hours - 6) / 12) * Math.PI; // 0 sunrise, PI sunset
    this.sunDir.set(-0.38 * Math.sin(theta), Math.sin(theta) * 0.93, Math.cos(theta)).normalize();
    const elev = this.sunDir.y;

    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
    const oc = this.overcast;
    this.sky.material.uniforms.rayleigh.value = lerp(lerp(2.6, 1.3, smoothstep(0.0, 0.5, elev)), 0.6, oc);
    this.sky.material.uniforms.turbidity.value = lerp(lerp(9, 5.5, smoothstep(0.0, 0.6, elev)), 18, oc);
    this.sky.position.copy(focus);

    // Sun / moon light
    const day = smoothstep(-0.04, 0.12, elev);
    const night = this.nightFactor;
    const warm = 1 - smoothstep(0.02, 0.45, elev);
    this.sunColor.setRGB(1.0, lerp(0.93, 0.56, warm), lerp(0.86, 0.32, warm));
    const moonDir = this._moonDir || (this._moonDir = new THREE.Vector3());
    moonDir.copy(this.sunDir).negate();
    moonDir.y = Math.max(moonDir.y, 0.25);
    moonDir.normalize();
    const lightDir = day > 0.02 ? this.sunDir : moonDir;
    this.sun.intensity = day > 0.02 ? lerp(0.0, 3.0, day) : 0.75 * night;
    if (day <= 0.02) this.sunColor.setRGB(0.6, 0.72, 1.0); // cool moonlight against warm lamps
    this.sun.color.copy(this.sunColor);
    this.sun.position.copy(focus).addScaledVector(lightDir, 180);
    this.sun.target.position.copy(focus);
    // Snap the shadow camera to texels to avoid shimmering.
    if (this.sun.castShadow) {
      const texel = (this.sun.shadow.camera.right * 2) / this.sun.shadow.mapSize.x;
      this.sun.target.position.x = Math.round(this.sun.target.position.x / texel) * texel;
      this.sun.target.position.z = Math.round(this.sun.target.position.z / texel) * texel;
      this.sun.position.x = this.sun.target.position.x + lightDir.x * 180;
      this.sun.position.z = this.sun.target.position.z + lightDir.z * 180;
    }

    sampleKeys(HEMI_SKY, elev, this.hemi.color);
    this.hemi.groundColor.setRGB(0.42, 0.34, 0.26).multiplyScalar(lerp(0.15, 1, day));
    this.hemi.intensity = lerp(0.42, 0.45, day);

    sampleKeys(FOG_KEYS, elev, this.fogColor);
    this.scene.fog.color.copy(this.fogColor).multiplyScalar(0.85);
    // Height fog: a low river mist at dawn and dusk, clearer at noon, thin blue haze at night.
    this.scene.fog.density = lerp(0.0017, 0.0034, this.goldenFactor) + night * 0.0006;
    FOG.params.x = lerp(0.03, 0.055, this.goldenFactor); // denser near the water when the sun is low
    FOG.params.y = 0;
    FOG.params.z = lerp(6, 10, this.goldenFactor);
    FOG.params.w = day > 0.02 ? lerp(0.12, 0.42, this.goldenFactor) : 0.12 * night;
    const fogLight = day > 0.02 ? this.sunDir : moonDir;
    FOG.sunDir.x = fogLight.x;
    FOG.sunDir.y = fogLight.y;
    FOG.sunDir.z = fogLight.z;
    FOG.sunColor.x = this.sunColor.r * (day > 0.02 ? 1.0 : 0.25);
    FOG.sunColor.y = this.sunColor.g * (day > 0.02 ? 0.82 : 0.3);
    FOG.sunColor.z = this.sunColor.b * (day > 0.02 ? 0.6 : 0.45);
    this.horizonColor.copy(this.fogColor);
    this.zenithColor.copy(this.hemi.color);

    this.starMat.uniforms.uOpacity.value = smoothstep(0.35, 0.9, night);
    this.starMat.uniforms.uTime.value += dt;
    this.stars.position.copy(focus);
    this.moon.position.copy(focus).addScaledVector(moonDir, 1500);
    this.moon.material.opacity = smoothstep(0.2, 0.7, night);
    this.moon.visible = this.moon.material.opacity > 0.01 && !this.underwater;

    this.scene.environmentIntensity = lerp(0.1, 0.4, day);

    // Refresh the environment map when the sun has moved enough to matter.
    if (Math.abs(elev - this.lastEnvSunY) > 0.02 || Math.abs(oc - this.lastEnvOvercast) > 0.08) {
      this.lastEnvSunY = elev;
      this.lastEnvOvercast = oc;
      const old = this.envRT;
      this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 100);
      this.scene.environment = this.envRT.texture;
      if (old) old.dispose();
    }
  }

  // Exposure that keeps dawn, noon and the night aarti all readable.
  get exposure() {
    const elev = this.sunDir.y;
    return (lerp(1.95, 0.72, smoothstep(-0.12, 0.14, elev)) + this.goldenFactor * 0.08) * lerp(1, 0.84, smoothstep(0.3, 0.85, elev));
  }

  clockString() {
    const h = Math.floor(this.hours);
    const m = Math.floor((this.hours - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  // Under the river the sky is gone: the surface is the ceiling and the murk fills the rest
  // (the un-fogged HDR sky would otherwise peek past the far edge of the water).
  setUnderwater(under, fogColor) {
    this.underwater = under;
    this.sky.visible = !under;
    this.stars.visible = !under;
    if (under) this.moon.visible = false;
    this.scene.background = under ? fogColor : null;
  }

  dispose() {
    this.pmrem.dispose();
    this.envRT?.dispose();
  }
}

