import * as THREE from 'three';

// The look of the big moves: every piece pooled, additive (the bloom catches it), no shadows,
// and only drawn while one is alive.
//
//   shockwave(p, R, o)   a ring of light racing over the ground to R, glowing cracks spreading
//                        under it and cooling (the Damaru's third beat, a Rakshasa's slam)
//   yantra(p, r, o)      a mandala drawn on the ground in light: circles, a ring of lotus petals,
//                        two interlocked triangles, the bindu; it draws itself in, turns, fades
//   slash(p, q, o)       a crescent of light swept round an arc (q: the arc's frame), its head
//                        bright, its tail eroding; o.fire makes it a sheet of flame
//   lightning(a, b, o)   a forked bolt from a to b, re-struck a few times while it lives
//   sparks(p, dir, n, o) hot streaks flying out along dir, falling, cooling from white to ember
//   flash(p, size, o)    a burst of glow at a point
//
// Colours are linear RGB multipliers (values above 1 bloom).

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _sc = new THREE.Vector3();

const NOISE = /* glsl */ `
float h1(float n){ return fract(sin(n) * 43758.5453); }
float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * vn(p); p *= 2.03; a *= 0.5; } return s; }
`;

const VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

function additive(uniforms, fragmentShader, side = THREE.DoubleSide) {
  return new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side, toneMapped: true });
}

// ---------------------------------------------------------------- shaders
const RING_FRAG = /* glsl */ `
uniform float uK; uniform vec3 uColor; uniform vec3 uCrack; uniform float uSeed; uniform float uCracks;
varying vec2 vUv;
${NOISE}
void main(){
  vec2 d = vUv * 2.0 - 1.0; float r = length(d); float a = atan(d.y, d.x);
  float k = uK;
  // the front: a band at radius ~k, ragged along its length, thinning as it goes
  float front = mix(0.05, 1.0, 1.0 - pow(1.0 - k, 2.2));
  float w = mix(0.11, 0.035, k);
  float rag = fbm(vec2(a * 3.0 + uSeed, k * 4.0)) * 0.06;
  float band = smoothstep(w, 0.0, abs(r - front + rag)) ;
  float inside = smoothstep(front, front - 0.25, r) * (1.0 - k) * 0.18;
  float fade = (1.0 - k) * (1.0 - k);
  vec3 col = uColor * (band * 1.6 + inside) * fade;
  // cracks: thin lines out from the centre (wandering, forking), glowing hot then cooling
  if (uCracks > 0.0) {
    float n = 11.0;
    float wob = fbm(vec2(r * 5.0, uSeed)) * 0.9 + fbm(vec2(r * 14.0, uSeed + 3.0)) * 0.25;
    float cell = fract((a / 6.2831853) * n + wob + uSeed);
    float line = smoothstep(0.035, 0.0, abs(cell - 0.5) * (0.6 + r * 0.8));
    float reach = smoothstep(min(front, 0.85), min(front, 0.85) - 0.1, r) * smoothstep(0.03, 0.12, r);
    float cool = clamp(1.0 - k * 1.15, 0.0, 1.0);
    col += uCrack * line * reach * cool * cool * uCracks * 1.4;
  }
  float aOut = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
  if (aOut < 0.003) discard;
  gl_FragColor = vec4(col, aOut);
}`;

const YANTRA_FRAG = /* glsl */ `
uniform float uK; uniform float uDraw; uniform float uSpin; uniform vec3 uColor; uniform float uAlpha;
varying vec2 vUv;
${NOISE}
float ln(float x, float w){ return smoothstep(w, 0.0, abs(x)); }
// distance to an equilateral triangle (side s), pointing up
float tri(vec2 p, float s){ const float k = 1.7320508; p.x = abs(p.x) - s; p.y = p.y + s / k;
  if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0 * s, 0.0); return -length(p) * sign(p.y); }
void main(){
  vec2 d = vUv * 2.0 - 1.0; float r = length(d); float a = atan(d.y, d.x);
  if (r > 1.0) discard;
  float W = 0.012;
  // drawn in: everything inside the swept angle (from the top, round both ways)
  float sweep = smoothstep(uDraw * 3.3 - 0.1, uDraw * 3.3, abs(a - 1.5707963));
  sweep = 1.0 - sweep;
  float g = 0.0;
  g += ln(r - 0.96, W) + ln(r - 0.9, W * 0.7);
  // a turning ring of marks between the outer circles
  float ar = a + uSpin;
  g += step(0.5, fract(ar * 48.0 / 6.2831853)) * smoothstep(0.905, 0.915, r) * smoothstep(0.955, 0.945, r) * 0.6;
  // sixteen lotus petals
  float pet = 0.72 + 0.12 * abs(cos((a - uSpin * 0.5) * 8.0));
  g += ln(r - pet, W) * step(0.7, r);
  g += ln(r - 0.7, W);
  // the shatkona: two interlocked triangles, turning slowly the other way
  float c = cos(-uSpin * 0.6), s = sin(-uSpin * 0.6);
  vec2 q = mat2(c, -s, s, c) * d;
  g += ln(tri(q, 0.56), W) + ln(tri(vec2(q.x, -q.y), 0.56), W);
  g += ln(r - 0.3, W) ;
  // the bindu
  g += smoothstep(0.06, 0.0, r) * 1.5;
  float glow = smoothstep(0.98, 0.0, r) * 0.06;
  float shimmer = 0.75 + 0.25 * vn(vec2(a * 6.0, uK * 10.0));
  vec3 col = uColor * (g * shimmer * sweep + glow * sweep) * uAlpha;
  float aOut = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
  if (aOut < 0.003) discard;
  gl_FragColor = vec4(col, aOut);
}`;

const SLASH_FRAG = /* glsl */ `
uniform float uK; uniform vec3 uColor; uniform vec3 uCore; uniform float uFire; uniform float uSeed; uniform float uTail;
varying vec2 vUv;
${NOISE}
void main(){
  // x along the arc (0 tail end .. 1 head end), y across it (0 inner .. 1 outer edge)
  float head = mix(0.0, 1.25, uK);
  float t = vUv.x;
  float behind = head - t;
  if (behind < 0.0) discard;
  float life = 1.0 - smoothstep(0.0, uTail, behind);
  // the edge: thin and hot on the outer side, softer toward the inside
  float edge = pow(vUv.y, mix(3.0, 1.6, uFire));
  float erode = fbm(vec2(t * 7.0 - uK * 3.0 + uSeed, vUv.y * 3.0)) ;
  float m = life * edge * smoothstep(0.2, 0.55, erode + life * 0.4);
  float fade = 1.0 - smoothstep(0.65, 1.0, uK);
  vec3 col = mix(uColor, uCore, pow(edge * life, 3.0));
  if (uFire > 0.5) {
    float fl = fbm(vec2(t * 10.0 - uK * 8.0 + uSeed, vUv.y * 5.0 - uK * 6.0));
    m *= 0.6 + fl;
    // flame: deep red at the edges of the sheet, orange, a yellow core only where it is thickest
    float heat = clamp(edge * fl * 1.5, 0.0, 1.0);
    col = mix(vec3(0.9, 0.08, 0.01), vec3(1.5, 0.5, 0.06), heat);
    col = mix(col, vec3(1.9, 1.15, 0.3), heat * heat * heat);
  }
  col *= m * fade * (uFire > 0.5 ? 1.15 : 1.6);
  float aOut = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
  if (aOut < 0.004) discard;
  gl_FragColor = vec4(col, aOut);
}`;

const BOLT_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uAlpha;
varying vec2 vUv;
void main(){
  float x = abs(vUv.y - 0.5) * 2.0;
  float core = exp(-x * x * 40.0);
  float glow = exp(-x * x * 4.0) * 0.45;
  vec3 col = (vec3(2.2) * core + uColor * glow) * uAlpha;
  float a = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
}`;

const TRAIL_FRAG = /* glsl */ `
uniform vec3 uColor; uniform vec3 uCore; uniform float uAlpha;
varying vec2 vUv;
${NOISE}
void main(){
  // x: age (0 the newest sample .. 1 the oldest), y: across (0 the hilt or knee .. 1 the tip)
  float age = vUv.x;
  float fresh = pow(1.0 - age, 1.6);
  float edge = pow(vUv.y, 2.2);
  float wisp = 0.65 + 0.35 * vn(vec2(age * 9.0, vUv.y * 4.0));
  float m = fresh * (edge * 1.3 + 0.15) * wisp * uAlpha;
  vec3 col = mix(uColor, uCore, pow(fresh * vUv.y, 4.0)) * m;
  float a = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
}`;

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function streakTexture() {
  // a spark: bright head, a tail fading out (along x), soft across (y)
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 16;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 64, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.75, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,1)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 16);
  const m = x.getImageData(0, 0, 64, 16);
  for (let j = 0; j < 16; j++) {
    const k = Math.max(0, 1 - Math.abs(j - 7.5) / 7.5);
    for (let i = 0; i < 64; i++) m.data[(j * 64 + i) * 4 + 3] *= k * k;
  }
  x.putImageData(m, 0, 0);
  return new THREE.CanvasTexture(c);
}

/** A crescent: n segments round `arc` radians at radius r, `width` wide (uv x along, y across). */
function arcGeometry(n = 40) {
  const pos = [];
  const uv = [];
  const idx = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    for (const s of [0, 1]) {
      pos.push(t, s, 0); // (placed in the vertex shader-free way: rebuilt per use by setArc)
      uv.push(t, s);
    }
    if (i < n) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export class VFX {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'vfx';
    scene.add(this.group);
    this.reduce = false; // (Reduce flashes: softer, smaller)
    // rings (shockwaves) and yantras: flat discs on the ground
    this.rings = this.pool(6, () => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), additive({ uK: { value: 0 }, uColor: { value: new THREE.Color() }, uCrack: { value: new THREE.Color() }, uSeed: { value: 0 }, uCracks: { value: 0 } }, RING_FRAG));
      m.renderOrder = 2;
      return m;
    });
    this.yantras = this.pool(3, () => new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), additive({ uK: { value: 0 }, uDraw: { value: 0 }, uSpin: { value: 0 }, uColor: { value: new THREE.Color() }, uAlpha: { value: 0 } }, YANTRA_FRAG)));
    this.slashes = this.pool(14, () => new THREE.Mesh(arcGeometry(), additive({ uK: { value: 0 }, uColor: { value: new THREE.Color() }, uCore: { value: new THREE.Color() }, uFire: { value: 0 }, uSeed: { value: 0 }, uTail: { value: 0.55 } }, SLASH_FRAG)));
    this.bolts = this.pool(8, () => {
      const g = new THREE.BufferGeometry();
      const N = 48;
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
      const uv = new Float32Array(N * 2 * 2);
      for (let i = 0; i < N; i++) uv.set([i / (N - 1), 0, i / (N - 1), 1], i * 4);
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      const idx = [];
      for (let i = 0; i < N - 1; i++) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
      g.setIndex(idx);
      const m = new THREE.Mesh(g, additive({ uColor: { value: new THREE.Color() }, uAlpha: { value: 1 } }, BOLT_FRAG));
      m.userData.N = N;
      return m;
    });
    // sparks: one instanced quad mesh, each instance stretched along its velocity
    this.sparkMax = 160;
    this.sparkMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: streakTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: false, toneMapped: true }),
      this.sparkMax
    );
    this.sparkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sparkMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.sparkMax * 3), 3);
    this.sparkMesh.count = 0;
    this.sparkMesh.frustumCulled = false;
    this.group.add(this.sparkMesh);
    this.sparkList = [];
    // trails: a ribbon behind a blade (or a kicking shin), from the last few frames' positions
    this.trails = this.pool(4, () => {
      const N = 20;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
      const uv = new Float32Array(N * 2 * 2);
      for (let i = 0; i < N; i++) uv.set([i / (N - 1), 0, i / (N - 1), 1], i * 4);
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      const idx = [];
      for (let i = 0; i < N - 1; i++) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
      g.setIndex(idx);
      const m = new THREE.Mesh(g, additive({ uColor: { value: new THREE.Color() }, uCore: { value: new THREE.Color() }, uAlpha: { value: 0 } }, TRAIL_FRAG));
      m.userData.N = N;
      m.userData.hist = [];
      return m;
    });
    this.trailById = new Map();
    // flashes: sprites
    this.glow = glowTexture();
    this.flashes = this.pool(10, () => new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: true })));
    this.live = [];
    this.t = 0;
  }

  pool(n, make) {
    const list = [];
    for (let i = 0; i < n; i++) {
      const m = make();
      m.visible = false;
      m.frustumCulled = false;
      m.userData.busy = false;
      this.group.add(m);
      list.push(m);
    }
    return list;
  }

  take(list) {
    // (the oldest is reused when all are busy)
    let m = list.find((x) => !x.userData.busy);
    if (!m) {
      m = list.reduce((a, b) => ((a.userData.born ?? 0) < (b.userData.born ?? 0) ? a : b));
      this.live = this.live.filter((e) => e.m !== m);
    }
    m.userData.busy = true;
    m.userData.born = this.t;
    m.visible = true;
    return m;
  }

  // ------------------------------------------------------------ effects
  shockwave(p, R, { color = [1.8, 1.25, 0.6], cracks = 0, crack = [2.2, 0.7, 0.15], dur = 0.75 } = {}) {
    const m = this.take(this.rings);
    m.position.set(p.x, p.y + 0.04, p.z);
    m.scale.setScalar(R * 1.08);
    const u = m.material.uniforms;
    u.uColor.value.setRGB(...color).multiplyScalar(this.reduce ? 0.5 : 1);
    u.uCrack.value.setRGB(...crack);
    u.uCracks.value = cracks;
    u.uSeed.value = Math.random() * 10;
    u.uK.value = 0;
    this.live.push({ m, t: 0, dur, step: (e, k) => (u.uK.value = k) });
  }

  yantra(p, r, { color = [1.9, 1.15, 0.35], dur = 1.4, hold = 0, spin = 0.8, follow = null } = {}) {
    const m = this.take(this.yantras);
    m.position.set(p.x, p.y + 0.05, p.z);
    m.scale.setScalar(r);
    const u = m.material.uniforms;
    u.uColor.value.setRGB(...color).multiplyScalar(this.reduce ? 0.6 : 1);
    u.uAlpha.value = 0;
    this.live.push({
      m,
      t: 0,
      dur: dur + hold,
      step: (e, k, dt) => {
        const T = e.t;
        u.uDraw.value = Math.min(1, T / 0.45);
        u.uSpin.value += dt * spin;
        u.uK.value = T;
        // in quickly, held, out over the last third of its own time
        const outStart = (dur + hold) * 0.7;
        u.uAlpha.value = Math.min(1, T / 0.2) * (T < outStart ? 1 : 1 - (T - outStart) / ((dur + hold) * 0.3));
        if (follow) {
          const f = follow();
          if (f) m.position.set(f.x, f.y + 0.05, f.z);
        }
      },
    });
    return m;
  }

  /**
   * A crescent swept round `arc` radians at radius r about `center`, in the plane of `frame` (a
   * quaternion: the arc runs from its -X round through +Z), width w. o.dur: the sweep's time.
   */
  slash(center, frame, { r = 1.1, w = 0.35, arc = 2.4, start = 0, color = [1.6, 1.4, 1.1], core = [3, 2.8, 2.4], fire = false, dur = 0.28, tail = 0.55 } = {}) {
    const m = this.take(this.slashes);
    const pos = m.geometry.attributes.position;
    const n = pos.count / 2 - 1;
    for (let i = 0; i <= n; i++) {
      const a = start + (i / n) * arc;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      pos.setXYZ(i * 2, -ca * (r - w), 0, sa * (r - w));
      pos.setXYZ(i * 2 + 1, -ca * r, 0, sa * r);
    }
    pos.needsUpdate = true;
    m.geometry.computeBoundingSphere();
    m.position.copy(center);
    m.quaternion.copy(frame);
    const u = m.material.uniforms;
    u.uColor.value.setRGB(...color);
    u.uCore.value.setRGB(...core);
    u.uFire.value = fire ? 1 : 0;
    u.uSeed.value = Math.random() * 10;
    u.uTail.value = tail;
    u.uK.value = 0;
    this.live.push({ m, t: 0, dur: dur / 0.65, step: (e, k) => (u.uK.value = k) });
  }

  /** A forked bolt from a to b (world), struck again every `rate` seconds while it lives. */
  lightning(a, b, { color = [0.6, 0.75, 2.4], width = 0.07, life = 0.32, rate = 0.06, jag = 0.18, follow = null } = {}) {
    const m = this.take(this.bolts);
    const A = a.clone();
    const B = b.clone();
    const pts = [];
    const N = m.userData.N;
    const strike = () => {
      if (follow) follow(A, B);
      const len = A.distanceTo(B);
      pts.length = 0;
      // midpoint displacement, sideways to the bolt
      const dir = _v.subVectors(B, A).normalize();
      const s1 = _w.set(-dir.z, 0, dir.x);
      if (s1.lengthSq() < 1e-4) s1.set(1, 0, 0);
      s1.normalize();
      const s2 = new THREE.Vector3().crossVectors(dir, s1).normalize();
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1);
        const p = new THREE.Vector3().lerpVectors(A, B, t);
        const env = Math.sin(t * Math.PI);
        const amp = len * jag * env;
        const o1 = (Math.sin(t * 17.3 + this.t * 61) * 0.5 + (Math.random() - 0.5)) * amp * 0.5;
        const o2 = (Math.cos(t * 13.1 + this.t * 47) * 0.5 + (Math.random() - 0.5)) * amp * 0.5;
        p.addScaledVector(s1, o1).addScaledVector(s2, o2);
        pts.push(p);
      }
    };
    strike();
    const u = m.material.uniforms;
    u.uColor.value.setRGB(...color);
    const e = {
      m,
      t: 0,
      dur: life,
      next: rate,
      step: (e, k, dt, cam) => {
        e.next -= dt;
        if (e.next <= 0) {
          e.next = rate;
          strike();
        }
        u.uAlpha.value = (1 - k) * (0.7 + Math.random() * 0.3) * (this.reduce ? 0.5 : 1);
        // the ribbon faces the camera
        const P = m.geometry.attributes.position;
        for (let i = 0; i < N; i++) {
          const p = pts[i];
          const q = pts[Math.min(N - 1, i + 1)];
          const r0 = pts[Math.max(0, i - 1)];
          const tan = _v.subVectors(q, r0).normalize();
          const view = _w.subVectors(cam.position, p).normalize();
          const side = tan.cross(view).normalize().multiplyScalar(width * (0.6 + Math.sin((i / N) * Math.PI) * 0.6));
          P.setXYZ(i * 2, p.x - side.x, p.y - side.y, p.z - side.z);
          P.setXYZ(i * 2 + 1, p.x + side.x, p.y + side.y, p.z + side.z);
        }
        P.needsUpdate = true;
        m.geometry.computeBoundingSphere();
      },
    };
    this.live.push(e);
    return e;
  }

  sparks(p, dir, n = 14, { speed = 7, spread = 0.7, color = [3, 1.8, 0.7], life = 0.45, size = 0.05 } = {}) {
    if (this.reduce) n = Math.ceil(n * 0.5);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(dir.x + (Math.random() - 0.5) * spread * 2, (dir.y ?? 0) + Math.random() * spread * 1.4, dir.z + (Math.random() - 0.5) * spread * 2)
        .normalize()
        .multiplyScalar(speed * (0.5 + Math.random() * 0.7));
      if (this.sparkList.length >= this.sparkMax) this.sparkList.shift();
      this.sparkList.push({ p: new THREE.Vector3(p.x, p.y, p.z), v, t: 0, life: life * (0.6 + Math.random() * 0.6), size, c: color });
    }
  }

  flash(p, size = 1.5, { color = [2, 1.5, 0.9], life = 0.22 } = {}) {
    const m = this.take(this.flashes);
    m.position.set(p.x, p.y, p.z);
    m.material.color.setRGB(...color);
    this.live.push({
      m,
      t: 0,
      dur: life,
      step: (e, k) => {
        const s = size * (0.6 + k * 0.6);
        m.scale.set(s, s, 1);
        m.material.opacity = (1 - k) * (1 - k) * (this.reduce ? 0.5 : 1);
      },
    });
  }

  /**
   * A trail: call every frame a blade (or shin) is in its blow with its two ends; it lives on
   * a moment after the last call, fading out from its old end.
   */
  trail(id, a, b, { color = [1.5, 1.25, 0.9], core = [3, 2.8, 2.4] } = {}) {
    let m = this.trailById.get(id);
    if (!m || !m.userData.busy) {
      m = this.take(this.trails);
      m.userData.hist.length = 0;
      m.userData.last = 0;
      this.trailById.set(id, m);
      const u = m.material.uniforms;
      u.uColor.value.setRGB(...color);
      u.uCore.value.setRGB(...core);
      const e = { m, t: 0, dur: 1e9, step: (e, k, dt) => this.stepTrail(e, dt) };
      this.live.push(e);
    }
    const H = m.userData.hist;
    H.unshift([a.x, a.y, a.z, b.x, b.y, b.z]);
    if (H.length > m.userData.N) H.length = m.userData.N;
    m.userData.last = this.t;
  }

  stepTrail(e, dt) {
    const m = e.m;
    const H = m.userData.hist;
    const idle = this.t - m.userData.last;
    // (no new points: the old end catches up to the new, then it is gone)
    if (idle > 0.02 && H.length) H.pop();
    m.material.uniforms.uAlpha.value = (this.reduce ? 0.55 : 1) * Math.min(1, H.length / 4);
    if (H.length < 2) {
      if (idle > 0.05) e.t = e.dur = 0.0001;
      m.visible = false;
      return;
    }
    m.visible = true;
    const P = m.geometry.attributes.position;
    const N = m.userData.N;
    for (let i = 0; i < N; i++) {
      const h = H[Math.min(H.length - 1, i)];
      P.setXYZ(i * 2, h[0], h[1], h[2]);
      P.setXYZ(i * 2 + 1, h[3], h[4], h[5]);
    }
    P.needsUpdate = true;
    m.geometry.computeBoundingSphere();
  }

  /** A frame for an arc swept horizontally round a point, its middle facing `yaw` (the arc's +Z). */
  static flatFrame(yaw, tilt = 0, roll = 0) {
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, yaw, roll, 'YXZ'));
  }

  // ------------------------------------------------------------ per frame
  update(dt, camera) {
    this.t += dt;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const e = this.live[i];
      e.t += dt;
      const k = Math.min(1, e.t / e.dur);
      e.step(e, k, dt, camera);
      if (k >= 1) {
        e.m.visible = false;
        e.m.userData.busy = false;
        this.live.splice(i, 1);
      }
    }
    // sparks
    const S = this.sparkList;
    const M = this.sparkMesh;
    let n = 0;
    for (let i = S.length - 1; i >= 0; i--) {
      const s = S[i];
      s.t += dt;
      if (s.t >= s.life) {
        S.splice(i, 1);
        continue;
      }
      s.v.y -= 9.8 * dt * 0.8;
      s.v.multiplyScalar(1 - dt * 1.8);
      s.p.addScaledVector(s.v, dt);
    }
    for (const s of S) {
      const k = s.t / s.life;
      const speed = s.v.length();
      const len = Math.max(0.04, speed * 0.035);
      // the quad lies along the velocity, turned to face the camera about that axis
      const dir = _v.copy(s.v).normalize();
      const view = _w.subVectors(camera.position, s.p).normalize();
      const side = _a.crossVectors(dir, view).normalize();
      const nrm = _b.crossVectors(side, dir);
      _m.makeBasis(dir, side, nrm);
      _q.setFromRotationMatrix(_m);
      _m.compose(_w.copy(s.p).addScaledVector(dir, -len * 0.5), _q, _sc.set(len, s.size * (1 - k * 0.5), 1));
      M.setMatrixAt(n, _m);
      const cool = 1 - k;
      M.instanceColor.setXYZ(n, s.c[0] * cool, s.c[1] * cool * cool, s.c[2] * cool * cool * cool);
      n++;
    }
    M.count = n;
    M.instanceMatrix.needsUpdate = true;
    M.instanceColor.needsUpdate = true;
    M.visible = n > 0;
  }
}

