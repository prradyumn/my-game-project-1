import * as THREE from 'three';
import { smokeTexture, softDotTexture } from '../utils/textures.js';

// GPU-animated smoke (one draw call for every smoke column), plus CPU splashes and ripples
// (short-lived). Fire lives in Fire.js.

export class SmokeSystem {
  constructor(maxEmitters = 40, perEmitter = 16) {
    this.per = perEmitter;
    this.max = maxEmitters;
    this.count = 0;
    const n = maxEmitters * perEmitter;
    this.origin = new Float32Array(n * 3);
    this.seed = new Float32Array(n);
    this.strength = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.origin, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1));
    geo.setAttribute('aStrength', new THREE.BufferAttribute(this.strength, 1));
    geo.setDrawRange(0, 0);
    this.geo = geo;
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uMap: { value: smokeTexture() }, uPixelRatio: { value: 1 }, uLight: { value: new THREE.Color(1, 1, 1) }, uGlow: { value: new THREE.Color(0, 0, 0) }, uNight: { value: 0 }, uWind: { value: new THREE.Vector2(0.6, 0.25) } },
      vertexShader: /* glsl */ `
        attribute float aSeed; attribute float aStrength;
        uniform float uTime; uniform float uPixelRatio; uniform vec2 uWind;
        varying float vLife; varying float vStrength; varying float vRot; varying float vSeed;
        void main() {
          float life = fract(uTime * 0.07 + aSeed);
          vRot = aSeed * 37.0 + life * (fract(aSeed * 13.7) - 0.5) * 3.0;
          vSeed = aSeed;
          vec3 p = position + vec3(uWind.x * life * 12.0 + sin(aSeed * 50.0 + uTime * 0.4) * life * 1.5, life * 14.0, uWind.y * life * 10.0);
          vLife = life; vStrength = aStrength;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = min((1.5 + life * 9.0) * 300.0 * uPixelRatio / max(-mv.z, 0.5), 220.0 * uPixelRatio);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; uniform vec3 uLight; uniform vec3 uGlow; uniform float uNight;
        varying float vLife; varying float vStrength; varying float vRot; varying float vSeed;
        float sh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float sn(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(sh(i), sh(i + vec2(1, 0)), u.x), mix(sh(i + vec2(0, 1)), sh(i + vec2(1, 1)), u.x), u.y);
        }
        void main() {
          // each puff turned its own way and torn by noise, so no two read as the same disc
          vec2 c = gl_PointCoord - 0.5;
          float cs = cos(vRot), sn0 = sin(vRot);
          c = vec2(c.x * cs - c.y * sn0, c.x * sn0 + c.y * cs);
          float tex = texture2D(uMap, c + 0.5).r;
          float n = sn(c * 5.0 + vSeed * 40.0) * 0.6 + sn(c * 11.0 - vSeed * 17.0) * 0.4;
          float edge = 1.0 - smoothstep(0.25, 0.5, length(c));
          float a = tex * edge * smoothstep(0.2, 0.75, n + tex * 0.6) * smoothstep(0.0, 0.12, vLife) * (1.0 - vLife) * vStrength * 1.25;
          // after dark the smoke is thinner and lit from below by the flames it rises from,
          // so it never blacks out the lamps behind it
          a *= mix(1.0, 0.5, uNight);
          if (a < 0.003) discard;
          float lowGlow = pow(1.0 - vLife, 3.0);
          vec3 col = uLight * vec3(0.78, 0.76, 0.74) * (0.85 + 0.3 * n) + uGlow * lowGlow;
          gl_FragColor = vec4(col, a);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  add(pos, strength = 1) {
    if (this.count >= this.max) return -1;
    const id = this.count++;
    for (let i = 0; i < this.per; i++) {
      const k = id * this.per + i;
      this.origin.set([pos.x + (Math.random() - 0.5) * 0.6, pos.y, pos.z + (Math.random() - 0.5) * 0.6], k * 3);
      this.seed[k] = i / this.per + Math.random() * 0.05;
      this.strength[k] = strength;
    }
    this.geo.setDrawRange(0, this.count * this.per);
    for (const a of ['position', 'aSeed', 'aStrength']) this.geo.attributes[a].needsUpdate = true;
    return id;
  }

  setStrength(id, s) {
    if (id < 0) return;
    for (let i = 0; i < this.per; i++) this.strength[id * this.per + i] = s;
    this.geo.attributes.aStrength.needsUpdate = true;
  }

  update(dt, pixelRatio, light, night = 0) {
    const u = this.material.uniforms;
    u.uTime.value += dt;
    u.uPixelRatio.value = pixelRatio;
    u.uLight.value.copy(light);
    u.uNight.value = night;
    u.uGlow.value.setRGB(0.42, 0.2, 0.06).multiplyScalar(night);
  }
}

// CPU droplets for splashes and the water-run spray.
export class SplashSystem {
  constructor(max = 600) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.geo = geo;
    this.material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: softDotTexture() }, uPixelRatio: { value: 1 }, uLight: { value: new THREE.Color(1, 1, 1) } },
      vertexShader: /* glsl */ `
        attribute float aAlpha; uniform float uPixelRatio; varying float vA;
        void main() { vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = min(0.05 * 600.0 * uPixelRatio / max(-mv.z, 0.5), 16.0 * uPixelRatio); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; uniform vec3 uLight; varying float vA;
        void main() { float a = texture2D(uMap, gl_PointCoord).r * vA; if (a < 0.01) discard; gl_FragColor = vec4(uLight * vec3(0.9, 0.95, 1.0), a); }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
  }

  spawn(p, count = 20, power = 3, spread = 0.6) {
    for (let i = 0; i < count; i++) {
      const k = this.next;
      this.next = (this.next + 1) % this.max;
      this.pos.set([p.x + (Math.random() - 0.5) * spread, p.y, p.z + (Math.random() - 0.5) * spread], k * 3);
      const a = Math.random() * Math.PI * 2;
      const h = Math.random() * power * 0.45;
      this.vel.set([Math.cos(a) * h, power * (0.5 + Math.random() * 0.7), Math.sin(a) * h], k * 3);
      this.life[k] = 0.6 + Math.random() * 0.6;
    }
  }

  update(dt, pixelRatio, light) {
    let alive = 0;
    for (let k = 0; k < this.max; k++) {
      if (this.life[k] <= 0) {
        this.alpha[k] = 0;
        continue;
      }
      alive++;
      this.life[k] -= dt;
      this.vel[k * 3 + 1] -= 9.8 * dt;
      this.pos[k * 3] += this.vel[k * 3] * dt;
      this.pos[k * 3 + 1] += this.vel[k * 3 + 1] * dt;
      this.pos[k * 3 + 2] += this.vel[k * 3 + 2] * dt;
      this.alpha[k] = Math.min(1, this.life[k] * 2) * 0.6;
    }
    this.points.visible = alive > 0;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.material.uniforms.uPixelRatio.value = pixelRatio;
    this.material.uniforms.uLight.value.copy(light);
  }
}

// Expanding rings on the water surface (swimming strokes, splashes, boats, diyas).
export class RippleSystem {
  constructor(max = 64) {
    this.max = max;
    this.items = [];
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 30, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.85, 'rgba(255,255,255,0.3)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    this.material = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.count = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  }

  spawn(x, y, z, size = 1.5, life = 1.6) {
    if (this.items.length >= this.max) this.items.shift();
    this.items.push({ x, y, z, size, life, t: 0 });
  }

  update(dt, waterHeightAt, light) {
    let n = 0;
    for (const r of this.items) {
      r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) continue;
      const s = r.size * (0.3 + k * 1.7);
      this._m.compose(this._p.set(r.x, waterHeightAt(r.x, r.z) + 0.03, r.z), this._q, this._s.set(s, 1, s));
      this.mesh.setMatrixAt(n, this._m);
      const a = (1 - k) * (1 - k) * 0.24;
      this.mesh.instanceColor.setXYZ(n, light.r * a, light.g * a, light.b * a);
      n++;
    }
    this.items = this.items.filter((r) => r.t < r.life);
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}
