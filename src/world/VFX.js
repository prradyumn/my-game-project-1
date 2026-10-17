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
//   pillar(p, r, h, o)   a column of streaks shooting up from a ring round a point (o.fire: flame)
//   debris(p, n, o)      chips of stone thrown up, bouncing down the steps
//   stars(p, n, o)       four-point star glints bursting out and twinkling (Fab: Anime Stars)
//
// The ground pieces (shockwaves, yantras) are fine grids laid over the real ground (heightAt:
// the stair treads included), so they climb and drop with the ghat's steps instead of sinking
// under them; a faint copy drawn through anything in front keeps their shape where stone hides it.
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
// (ground pieces: their world position, so the light keeps to the treads and leaves the risers
// between them dark: a grid laid over steps has near-vertical faces at each step's edge)
const GROUND_VERT = /* glsl */ `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FLAT = /* glsl */ `
varying vec3 vW;
float flatness(){ vec3 n = normalize(cross(dFdx(vW), dFdy(vW))); return smoothstep(0.22, 0.45, abs(n.y)); }
`;

function additive(uniforms, fragmentShader, side = THREE.DoubleSide) {
  return new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side, toneMapped: true });
}

// ---------------------------------------------------------------- shaders
const RING_FRAG = /* glsl */ `
uniform float uK; uniform vec3 uColor; uniform vec3 uCrack; uniform float uSeed; uniform float uCracks; uniform float uMul; uniform float uInstant;
varying vec2 vUv;
${NOISE}
${FLAT}
void main(){
  vec2 d = vUv * 2.0 - 1.0; float r = length(d); float a = atan(d.y, d.x);
  float k = uK;
  // the front: a band at radius ~k, ragged along its length, thinning as it goes
  float front = uInstant > 0.5 ? 1.0 : mix(0.05, 1.0, 1.0 - pow(1.0 - k, 2.2));
  float w = mix(0.11, 0.035, k);
  float rag = fbm(vec2(a * 3.0 + uSeed, k * 4.0)) * 0.06;
  float band = smoothstep(w, 0.0, abs(r - front + rag)) * 0.75;
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
    // (lingering cracks: the rock glows dull red a while, flickering, as it cools)
    if (uInstant > 0.5) cool = (1.0 - k) * (0.8 + 0.2 * vn(vec2(r * 8.0, k * 30.0)));
    col += uCrack * line * reach * cool * cool * uCracks * 1.4;
  }
  col *= uMul * flatness();
  float aOut = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
  if (aOut < 0.003) discard;
  gl_FragColor = vec4(col, aOut);
}`;

const YANTRA_FRAG = /* glsl */ `
uniform float uK; uniform float uDraw; uniform float uSpin; uniform vec3 uColor; uniform float uAlpha; uniform float uMul;
varying vec2 vUv;
${NOISE}
${FLAT}
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
  // (the angle from the top, wrapped: 0 there .. pi at the bottom, both ways round)
  float fromTop = abs(mod(a - 1.5707963 + 3.1415927, 6.2831853) - 3.1415927);
  float sweep = 1.0 - smoothstep(uDraw * 3.3 - 0.12, uDraw * 3.3, fromTop);
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
  vec3 col = uColor * (g * shimmer * sweep + glow * sweep) * uAlpha * uMul * flatness();
  float aOut = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
  if (aOut < 0.003) discard;
  gl_FragColor = vec4(col, aOut);
}`;

// a sigil on the ground: the crystal star from the Fab MagicCircle pack (its six points drawn out
// from the centre, turning), with a ring of light round it
const SIGIL_FRAG = /* glsl */ `
uniform float uK; uniform float uSpin; uniform vec3 uColor; uniform float uAlpha; uniform float uMul; uniform sampler2D uMask;
varying vec2 vUv;
${FLAT}
void main(){
  vec2 d = vUv * 2.0 - 1.0; float r = length(d);
  if (r > 1.0) discard;
  float c = cos(uSpin), s = sin(uSpin);
  vec2 q = mat2(c, -s, s, c) * d;
  float star = texture2D(uMask, q * 0.5 + 0.5).b;
  float grow = smoothstep(uK * 2.2 - 0.15, uK * 2.2, r);
  float g = star * (1.0 - grow) * 1.4;
  g += smoothstep(0.02, 0.0, abs(r - 0.97)) * min(1.0, uK * 4.0);
  g += smoothstep(1.0, 0.0, r) * 0.08;
  vec3 col = uColor * g * uAlpha * uMul * flatness();
  float aOut = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
  if (aOut < 0.003) discard;
  gl_FragColor = vec4(col, aOut);
}`;

const SLASH_FRAG = /* glsl */ `
uniform float uK; uniform vec3 uColor; uniform vec3 uCore; uniform float uFire; uniform float uSeed; uniform float uTail;
uniform sampler2D uMask; uniform float uHasMask;
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
  // (the Fab Niagara Slash's eroded energy mask, dragged along the arc, breaks it up like torn light)
  if (uHasMask > 0.5) erode = mix(erode, texture2D(uMask, vec2(fract(t * 1.4 - uK * 0.8 + uSeed * 0.13), 0.15 + vUv.y * 0.7)).g * 1.15, 0.6);
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
uniform vec3 uColor; uniform vec3 uCore; uniform float uAlpha; uniform sampler2D uMask; uniform float uHasMask;
varying vec2 vUv;
${NOISE}
void main(){
  // x: age (0 the newest sample .. 1 the oldest), y: across (0 the hilt or knee .. 1 the tip)
  float age = vUv.x;
  float fresh = pow(1.0 - age, 1.6);
  float edge = pow(vUv.y, 2.2);
  float wisp = 0.65 + 0.35 * vn(vec2(age * 9.0, vUv.y * 4.0));
  float m = fresh * (edge * 1.3 + 0.15) * wisp * uAlpha;
  // (the Fab Niagara Slash's knife-light streak: a hard bright line along the edge, smearing out
  // behind it)
  if (uHasMask > 0.5) m *= 0.3 + 1.7 * texture2D(uMask, vec2(age * 0.95, 0.5 + 0.48 * (1.0 - vUv.y))).r;
  vec3 col = mix(uColor, uCore, pow(fresh * vUv.y, 4.0)) * m;
  float a = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
}`;

// flipbooks: a camera-facing quad (turned by uRot) playing one cell of a sprite sheet after
// another, the two cells either side of the time cross-faded so a 64-frame sheet plays smooth
const FLIP_VERT = /* glsl */ `
uniform vec2 uSize; uniform float uRot; uniform float uLift;
varying vec2 vUv;
void main(){
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec2 c = (position.xy + vec2(0.0, uLift)) * uSize;
  float s = sin(uRot), co = cos(uRot);
  mv.xy += vec2(co * c.x - s * c.y, s * c.x + co * c.y);
  gl_Position = projectionMatrix * mv;
}`;
const FLIP_FRAG = /* glsl */ `
uniform sampler2D uMap; uniform vec2 uGrid; uniform float uFrame; uniform float uFrames;
uniform vec3 uColor; uniform float uAlpha; uniform float uAdd; uniform float uGlow; uniform vec3 uLight; uniform float uSoft;
varying vec2 vUv;
vec4 cell(float f){
  f = min(f, uFrames - 1.0);
  vec2 g = vec2(mod(f, uGrid.x), floor(f / uGrid.x));
  // (a hair in from each cell's edge: no bleed from the neighbour when mipmapped)
  vec2 uv = (g + clamp(vec2(vUv.x, 1.0 - vUv.y), 0.004, 0.996)) / uGrid;
  return texture2D(uMap, vec2(uv.x, 1.0 - uv.y));
}
void main(){
  float f = floor(uFrame);
  vec4 t = mix(cell(f), cell(f + 1.0), fract(uFrame));
  // (a sheet standing on the ground fades out along its bottom: no hard line where it meets stone)
  t.a *= mix(1.0, smoothstep(0.0, 0.16, vUv.y), uSoft);
  if (uAdd > 0.5) {
    // glow: the sheet's colour times its alpha, its hottest parts pushed past white for the bloom
    vec3 col = t.rgb * t.a * uColor * uAlpha;
    float l = max(col.r, max(col.g, col.b));
    col *= 1.0 + uGlow * smoothstep(0.45, 1.0, l);
    if (l < 0.004) discard;
    gl_FragColor = vec4(col, clamp(l, 0.0, 1.0));
  } else {
    // smoke, dust, fireballs: blended over the scene and lit like it (uLight: the sky's light, a
    // warm floor at night for the lamps), except their fire, which glows by itself
    float a = min(1.0, t.a * uAlpha);
    if (a < 0.004) discard;
    float l = max(t.r, max(t.g, t.b));
    float hot = smoothstep(0.55, 1.0, l) * smoothstep(0.2, 0.55, t.r - t.b);
    vec3 base = t.rgb * uColor;
    vec3 col = mix(base * uLight, base * (1.0 + uGlow), hot);
    gl_FragColor = vec4(col, a);
  }
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
  constructor(scene, { heightAt = null, starUrls = [], sheets = {}, masks = null } = {}) {
    this.scene = scene;
    this.heightAt = heightAt;
    // Fab masks packed in one texture (R: knife-light streak, G: torn-energy erosion, B: crystal
    // sigil); the shaders fall back to their own noise until it has loaded
    this.mask = { value: null };
    this.hasMask = { value: 0 };
    if (masks)
      new THREE.TextureLoader().load(masks, (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        this.mask.value = t;
        this.hasMask.value = 1;
      });
    // flipbook sheets (Fab packs, see ASSET_MANIFEST.fx.sheets): name -> { url, grid, frames,
    // add }; each texture loads lazily and an effect asked for before it has is skipped
    this.sheets = {};
    const sl = new THREE.TextureLoader();
    for (const [name, d] of Object.entries(sheets)) {
      const S = (this.sheets[name] = { ...d, tex: null });
      sl.load(d.url, (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        S.tex = t;
      });
    }
    // star glints: one sprite material per texture (loaded lazily, nothing drawn until they are)
    const tl = new THREE.TextureLoader();
    this.starMats = starUrls.map((u) => {
      const m = new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: true });
      tl.load(u, (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        m.map = t;
        m.needsUpdate = true;
      });
      return m;
    });
    this.group = new THREE.Group();
    this.group.name = 'vfx';
    scene.add(this.group);
    this.reduce = false; // (Reduce flashes: softer, smaller)
    this.light = new THREE.Color(1, 1, 1); // the scene's light on smoke and dust (Game sets it)
    // rings (shockwaves) and yantras: flat discs on the ground
    this.rings = this.pool(8, () => this.groundMesh({ uK: { value: 0 }, uColor: { value: new THREE.Color() }, uCrack: { value: new THREE.Color() }, uSeed: { value: 0 }, uCracks: { value: 0 }, uInstant: { value: 0 } }, RING_FRAG));
    this.sigils = this.pool(2, () => this.groundMesh({ uK: { value: 0 }, uSpin: { value: 0 }, uColor: { value: new THREE.Color() }, uAlpha: { value: 0 }, uMask: this.mask }, SIGIL_FRAG));
    this.yantras = this.pool(3, () => this.groundMesh({ uK: { value: 0 }, uDraw: { value: 0 }, uSpin: { value: 0 }, uColor: { value: new THREE.Color() }, uAlpha: { value: 0 } }, YANTRA_FRAG));
    // debris: chips of stone (lit, not glowing), one instanced mesh
    this.debrisMax = 90;
    this.debrisMesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x8a7a66, roughness: 0.95 }), this.debrisMax);
    this.debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.debrisMesh.castShadow = true;
    this.debrisMesh.count = 0;
    this.debrisMesh.frustumCulled = false;
    this.group.add(this.debrisMesh);
    this.debrisList = [];
    this.slashes = this.pool(14, () => new THREE.Mesh(arcGeometry(), additive({ uK: { value: 0 }, uColor: { value: new THREE.Color() }, uCore: { value: new THREE.Color() }, uFire: { value: 0 }, uSeed: { value: 0 }, uTail: { value: 0.55 }, uMask: this.mask, uHasMask: this.hasMask }, SLASH_FRAG)));
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
    this.sparkMax = 700;
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
      const m = new THREE.Mesh(g, additive({ uColor: { value: new THREE.Color() }, uCore: { value: new THREE.Color() }, uAlpha: { value: 0 }, uMask: this.mask, uHasMask: this.hasMask }, TRAIL_FRAG));
      m.userData.N = N;
      m.userData.hist = [];
      return m;
    });
    this.trailById = new Map();
    // flashes: sprites
    this.glow = glowTexture();
    // (no depth test: a glow metres across, cut by the stone and the takhts in front of it, read as
    // a pane of white glass; it lives a fifth of a second)
    this.flashes = this.pool(10, () => new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: true })));
    this.flips = this.pool(48, () => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.ShaderMaterial({
          uniforms: { uMap: { value: null }, uGrid: { value: new THREE.Vector2(8, 8) }, uFrame: { value: 0 }, uFrames: { value: 64 }, uColor: { value: new THREE.Color() }, uAlpha: { value: 1 }, uAdd: { value: 1 }, uGlow: { value: 0 }, uLight: { value: this.light }, uSoft: { value: 0 }, uSize: { value: new THREE.Vector2(1, 1) }, uRot: { value: 0 }, uLift: { value: 0 } },
          vertexShader: FLIP_VERT,
          fragmentShader: FLIP_FRAG,
          transparent: true,
          depthWrite: false,
          toneMapped: true,
        })
      );
      m.renderOrder = 5;
      return m;
    });
    this.live = [];
    this.t = 0;
  }

  /**
   * A ground piece: a fine grid (laid over the ground by conform()) drawn twice, once as usual and
   * once faintly through whatever stands in front of it.
   */
  groundMesh(uniforms, frag) {
    const geo = new THREE.PlaneGeometry(2, 2, 32, 32).rotateX(-Math.PI / 2);
    geo.userData.base = Float32Array.from(geo.attributes.position.array);
    const mat = additive({ ...uniforms, uMul: { value: 1 } }, frag);
    mat.vertexShader = GROUND_VERT;
    const m = new THREE.Mesh(geo, mat);
    const ghost = additive({ ...uniforms, uMul: { value: 0.28 } }, frag);
    ghost.vertexShader = GROUND_VERT;
    ghost.depthTest = false;
    const g = new THREE.Mesh(geo, ghost);
    g.renderOrder = 3;
    g.frustumCulled = false;
    m.add(g);
    m.renderOrder = 2;
    return m;
  }

  /** Lay a ground piece's grid over the ground under it (and keep it there while it moves). */
  conform(m) {
    const H = this.heightAt;
    const geo = m.geometry;
    const pos = geo.attributes.position;
    const base = geo.userData.base;
    const s = m.scale.x || 1;
    if (!H) return;
    const y0 = m.position.y;
    for (let i = 0; i < pos.count; i++) {
      const lx = base[i * 3];
      const lz = base[i * 3 + 2];
      const h = H(m.position.x + lx * s, m.position.z + lz * s);
      // (a drop or a wall too tall for the light to climb: it stops at the edge, flat)
      const dy = Math.max(-1.6, Math.min(1.6, h + 0.04 - y0));
      pos.setY(i, dy / s);
    }
    pos.needsUpdate = true;
    geo.computeBoundingSphere();
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
  shockwave(p, R, { color = [1.8, 1.25, 0.6], cracks = 0, crack = [2.2, 0.7, 0.15], dur = 0.75, linger = 0 } = {}) {
    const m = this.take(this.rings);
    m.position.set(p.x, p.y, p.z);
    m.scale.setScalar(R * 1.08);
    this.conform(m);
    const u = m.material.uniforms;
    u.uInstant.value = 0;
    u.uColor.value.setRGB(...color).multiplyScalar(this.reduce ? 0.5 : 1);
    u.uCrack.value.setRGB(...crack);
    u.uCracks.value = cracks;
    u.uSeed.value = Math.random() * 10;
    u.uK.value = 0;
    this.live.push({ m, t: 0, dur, step: (e, k) => (u.uK.value = k) });
    // the scorched cracks it leaves, cooling slowly after the light has gone
    if (linger > 0 && cracks > 0) {
      const L = this.take(this.rings);
      L.position.copy(m.position);
      L.scale.setScalar(R * 0.8);
      this.conform(L);
      const v = L.material.uniforms;
      v.uColor.value.setRGB(0, 0, 0);
      v.uCrack.value.setRGB(crack[0] * 0.7, crack[1] * 0.45, crack[2] * 0.3);
      v.uCracks.value = cracks;
      v.uSeed.value = u.uSeed.value;
      v.uInstant.value = 1;
      v.uK.value = 0;
      this.live.push({ m: L, t: -dur * 0.5, dur: linger, step: (e, k) => (v.uK.value = Math.max(0, k)) });
    }
  }

  /**
   * A column of light (or flame) rising round p: streaks shooting up from a ring of radius r to
   * height h, thick at first, thinning out over dur (no surface: it reads as energy, not a wall).
   */
  pillar(p, r, h, { color = [1.8, 1.3, 0.6], fire = false, dur = 0.7, grow = 1.5, intensity = 1 } = {}) {
    const col = fire ? [2.6, 0.9, 0.2] : color;
    const total = Math.round((fire ? 70 : 55) * intensity * (this.reduce ? 0.5 : 1));
    const speed = h / 0.45;
    let left = total;
    this.live.push({
      m: { visible: true, userData: {} },
      t: 0,
      dur,
      step: (e, k, dt) => {
        // (most of them at once, the rest trickling up after)
        const want = Math.round(total * (1 - Math.pow(1 - Math.min(1, k * 1.6), 2)));
        const n = Math.max(0, want - (total - left));
        for (let i = 0; i < n && left > 0; i++, left--) {
          const a = Math.random() * Math.PI * 2;
          const rr = r * (1 + (grow - 1) * k) * (0.75 + Math.random() * 0.35);
          this.spark({ x: p.x + Math.sin(a) * rr, y: p.y + Math.random() * 0.3, z: p.z + Math.cos(a) * rr }, { x: Math.sin(a) * 0.06, y: 1, z: Math.cos(a) * 0.06 }, speed * (0.55 + Math.random() * 0.6), {
            color: fire && Math.random() < 0.4 ? [3, 1.6, 0.4] : col,
            life: 0.35 + Math.random() * 0.35,
            size: fire ? 0.12 : 0.07,
            gravity: fire ? -2 : 0,
            drag: 0.6,
            stretch: 0.06,
          });
        }
      },
    });
  }

  /**
   * A burst of star glints round p: each flies out a little, spins, swells and twinkles out.
   * (The perfect dodge, a parry, a finisher's last cut.)
   */
  stars(p, n = 8, { color = [2.4, 2.1, 1.5], spread = 0.9, size = 0.6, life = 0.55 } = {}) {
    if (!this.starMats.length || !this.starMats[0].map) return;
    if (this.reduce) n = Math.ceil(n / 2);
    this.starPool ||= [];
    for (let i = 0; i < n; i++) {
      let sp = this.starPool.find((s) => !s.visible);
      if (!sp) {
        if (this.starPool.length >= 40) break;
        sp = new THREE.Sprite(this.starMats[0].clone());
        sp.frustumCulled = false;
        sp.renderOrder = 4;
        this.group.add(sp);
        this.starPool.push(sp);
      }
      const src = this.starMats[i % this.starMats.length];
      sp.material.map = src.map;
      sp.material.color.setRGB(...color);
      sp.visible = true;
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 - 0.2, Math.random() - 0.5).normalize();
      const at = new THREE.Vector3(p.x, p.y, p.z).addScaledVector(dir, spread * (0.3 + Math.random() * 0.5));
      const vel = dir.multiplyScalar(spread * (0.6 + Math.random()));
      const s0 = size * (0.5 + Math.random() * 0.9);
      const spin = (Math.random() - 0.5) * 6;
      const delay = Math.random() * 0.12;
      const L = life * (0.7 + Math.random() * 0.6);
      sp.position.copy(at);
      sp.scale.setScalar(0.0001);
      this.live.push({
        m: sp,
        t: -delay,
        dur: L,
        step: (e, k, dt) => {
          if (e.t < 0) return;
          sp.position.addScaledVector(vel, dt);
          vel.multiplyScalar(Math.max(0, 1 - dt * 3));
          sp.material.rotation += spin * dt;
          // swell in fast, a twinkle, shrink out
          const pop = k < 0.08 ? k / 0.08 : 1 - (k - 0.08) / 0.92;
          const tw = 0.75 + 0.25 * Math.sin(e.t * 40 + delay * 50);
          sp.scale.setScalar(Math.max(0.0001, s0 * pop * tw));
          sp.material.opacity = Math.min(1, pop * 1.4) * (this.reduce ? 0.6 : 1);
        },
      });
    }
  }

  /** Chips of stone thrown up from p, bouncing on the ground, then gone. */
  debris(p, n = 16, { speed = 5, size = 0.05, up = 0.9 } = {}) {
    if (this.reduce) n = Math.ceil(n * 0.6);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = new THREE.Vector3(Math.sin(a), up + Math.random() * 0.6, Math.cos(a)).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      if (this.debrisList.length >= this.debrisMax) this.debrisList.shift();
      this.debrisList.push({ p: new THREE.Vector3(p.x + Math.sin(a) * 0.3, p.y + 0.1, p.z + Math.cos(a) * 0.3), v, t: 0, life: 1.4 + Math.random() * 0.8, s: size * (0.5 + Math.random()), rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, 0), spin: (Math.random() - 0.5) * 18 });
    }
  }

  /** The crystal sigil (Fab MagicCircle) drawn out on the ground at p, turning, then fading. */
  sigil(p, r, { color = [0.8, 1.2, 2.6], dur = 1.2, spin = 1.2 } = {}) {
    if (!this.mask.value) return;
    const m = this.take(this.sigils);
    m.position.set(p.x, p.y, p.z);
    m.scale.setScalar(r);
    this.conform(m);
    const u = m.material.uniforms;
    u.uColor.value.setRGB(...color).multiplyScalar(this.reduce ? 0.6 : 1);
    u.uSpin.value = Math.random() * 6.283;
    this.live.push({
      m,
      t: 0,
      dur,
      step: (e, k, dt) => {
        u.uK.value = Math.min(1, e.t / 0.35);
        u.uSpin.value += dt * spin * (1 - k * 0.7);
        u.uAlpha.value = Math.min(1, e.t / 0.08) * (k > 0.6 ? (1 - k) / 0.4 : 1);
      },
    });
  }

  yantra(p, r, { color = [1.9, 1.15, 0.35], dur = 1.4, hold = 0, spin = 0.8, follow = null } = {}) {
    const m = this.take(this.yantras);
    m.position.set(p.x, p.y, p.z);
    m.scale.setScalar(r);
    this.conform(m);
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
          if (f && (Math.abs(f.x - m.position.x) > 0.02 || Math.abs(f.z - m.position.z) > 0.02 || Math.abs(f.y - m.position.y) > 0.02)) {
            m.position.set(f.x, f.y, f.z);
            this.conform(m);
          }
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

  /**
   * One sprite-sheet effect at p: `name` a sheet from the manifest, `size` metres across.
   * o.life: its run (the whole sheet once); o.vel: drift (m/s); o.grow: its size at the end, as
   * a multiple; o.rise: lift its bottom to p (fire, a fireball sitting on the ground) instead of
   * centring; o.fade: alpha over the last part of its life; o.from/o.to: a slice of the sheet;
   * o.glow: how far its hottest parts are pushed past white; o.over: drawn over everything.
   */
  flipbook(name, p, size, { life = 1, color = [1, 1, 1], alpha = 1, vel = null, grow = 1, rise = false, rot = Math.random() * 6.283, spin = 0, fade = 0.3, from = 0, to = 1, glow = 1.5, delay = 0, over = false, stretch = 1 } = {}) {
    const S = this.sheets[name];
    if (!S || !S.tex) return null;
    const m = this.take(this.flips);
    const u = m.material.uniforms;
    u.uMap.value = S.tex;
    u.uGrid.value.set(S.grid[0], S.grid[1]);
    u.uFrames.value = S.frames;
    u.uAdd.value = S.add ? 1 : 0;
    m.material.blending = S.add ? THREE.AdditiveBlending : THREE.NormalBlending;
    m.material.depthTest = !over;
    u.uColor.value.setRGB(...color);
    u.uGlow.value = this.reduce ? glow * 0.4 : glow;
    u.uLift.value = rise ? 0.44 : 0;
    u.uSoft.value = rise ? 1 : 0;
    u.uRot.value = rise ? 0 : rot;
    u.uAlpha.value = 0;
    u.uFrame.value = 0;
    m.position.set(p.x, p.y, p.z);
    const v = vel ? new THREE.Vector3(vel.x, vel.y, vel.z) : null;
    const f0 = from * (S.frames - 1);
    const f1 = to * (S.frames - 1);
    this.live.push({
      m,
      t: -delay,
      dur: life,
      step: (e, k, dt) => {
        if (e.t < 0) {
          u.uAlpha.value = 0;
          return;
        }
        if (v) {
          m.position.addScaledVector(v, dt);
          v.multiplyScalar(Math.max(0, 1 - dt * 1.5));
        }
        u.uRot.value += spin * dt;
        u.uFrame.value = f0 + (f1 - f0) * k;
        const s = size * (1 + (grow - 1) * (1 - (1 - k) * (1 - k)));
        u.uSize.value.set(s, s * stretch);
        const a = Math.min(1, e.t / 0.05) * (k > 1 - fade ? (1 - k) / fade : 1);
        u.uAlpha.value = alpha * a * (this.reduce && S.add ? 0.6 : 1);
      },
    });
    return m;
  }

  /** A fireball out of the ground at p (the sheet's own fire rolling up into black smoke). */
  explosion(p, size = 3, { life = 1.6, delay = 0 } = {}) {
    this.flipbook('explosion', { x: p.x, y: p.y - size * 0.03, z: p.z }, size, { life, rise: true, glow: 0.8, fade: 0.25, delay });
  }

  /** A burst of flame licking up off p (the Agni Chakra's rings, a burning hit). */
  fireburst(p, size = 1.4, { life = 0.9, n = 1, spread = 0.4, delay = 0, color = [1.4, 1.1, 0.9] } = {}) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = n > 1 ? spread * (0.4 + Math.random() * 0.6) : 0;
      this.flipbook('fireburst', { x: p.x + Math.sin(a) * r, y: p.y - 0.05, z: p.z + Math.cos(a) * r }, size * (0.8 + Math.random() * 0.4), { life: life * (0.8 + Math.random() * 0.4), rise: true, glow: 1.8, color, fade: 0.35, delay: delay + i * 0.05 });
    }
  }

  /**
   * Earth thrown up round p in a ring: n sprays of dirt (each one of the sheet's four), leaning out
   * from the middle, settling as they fade (a slam, a heavy landing, a trident driven into stone).
   */
  dirt(p, R = 1.2, n = 6, { size = 1.3, life = 0.9, color = [0.55, 0.45, 0.35], delay = 0 } = {}) {
    if (this.reduce) n = Math.ceil(n * 0.6);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
      const x = p.x + Math.sin(a) * R;
      const z = p.z + Math.cos(a) * R;
      const y = this.heightAt ? this.heightAt(x, z) : p.y;
      const v = Math.floor(Math.random() * 4) / 3;
      this.flipbook('dirt', { x, y: y - 0.05, z }, size * (0.7 + Math.random() * 0.5), { life: life * (0.8 + Math.random() * 0.4), rise: true, color, from: v, to: v, alpha: 1.7, grow: 1.35, fade: 0.55, vel: { x: Math.sin(a) * 1.2, y: 0.5, z: Math.cos(a) * 1.2 }, glow: 0, delay: delay + Math.random() * 0.06 });
    }
  }

  /** A column of dark smoke rising off p and lingering (what burns on after a fire attack). */
  smokeColumn(p, size = 2.4, { life = 4, alpha = 1.1, color = [0.6, 0.55, 0.52], delay = 0 } = {}) {
    this.flipbook('smokeColumn', { x: p.x, y: p.y, z: p.z }, size, { life, rise: true, alpha, color, glow: 0, fade: 0.5, grow: 1.25, vel: { x: 0.15, y: 0.25, z: 0 }, delay });
  }

  /** Smoke rolling off p: n puffs, drifting up and out, swelling, fading. */
  smoke(p, n = 4, { size = 1.6, life = 2.4, color = [0.62, 0.6, 0.58], alpha = 0.9, spread = 0.8, up = 0.6, delay = 0 } = {}) {
    if (this.reduce) n = Math.ceil(n / 2);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = spread * Math.random();
      this.flipbook('smoke', { x: p.x + Math.sin(a) * r, y: p.y + size * 0.3, z: p.z + Math.cos(a) * r }, size * (0.7 + Math.random() * 0.5), {
        life: life * (0.75 + Math.random() * 0.5),
        color,
        alpha,
        vel: { x: Math.sin(a) * spread, y: up * (0.6 + Math.random() * 0.8), z: Math.cos(a) * spread },
        grow: 1.9,
        spin: (Math.random() - 0.5) * 0.6,
        fade: 0.6,
        glow: 0,
        from: Math.random() * 0.5,
        to: Math.random() * 0.5 + 0.5,
        delay: delay + i * 0.04,
      });
    }
  }

  sparks(p, dir, n = 14, { speed = 7, spread = 0.7, color = [3, 1.8, 0.7], life = 0.45, size = 0.05 } = {}) {
    if (this.reduce) n = Math.ceil(n * 0.5);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(dir.x + (Math.random() - 0.5) * spread * 2, (dir.y ?? 0) + Math.random() * spread * 1.4, dir.z + (Math.random() - 0.5) * spread * 2)
        .normalize()
        .multiplyScalar(speed * (0.5 + Math.random() * 0.7));
      if (this.sparkList.length >= this.sparkMax) this.sparkList.shift();
      this.sparkList.push({ p: new THREE.Vector3(p.x, p.y, p.z), v, t: 0, life: life * (0.6 + Math.random() * 0.6), size, c: color, g: 7.8, drag: 1.8, stretch: 0.035 });
    }
  }

  /** One streak: from p along dir at speed (gravity: m/s² down, negative rises; drag per second). */
  spark(p, dir, speed, { color = [3, 1.8, 0.7], life = 0.4, size = 0.05, gravity = 7.8, drag = 1.8, stretch = 0.035 } = {}) {
    if (this.sparkList.length >= this.sparkMax) this.sparkList.shift();
    const v = new THREE.Vector3(dir.x, dir.y, dir.z).normalize().multiplyScalar(speed);
    this.sparkList.push({ p: new THREE.Vector3(p.x, p.y, p.z), v, t: 0, life, size, c: color, g: gravity, drag, stretch });
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
      s.v.y -= s.g * dt;
      s.v.multiplyScalar(Math.max(0, 1 - dt * s.drag));
      s.p.addScaledVector(s.v, dt);
    }
    for (const s of S) {
      const k = s.t / s.life;
      const speed = s.v.length();
      const len = Math.max(0.04, speed * s.stretch);
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
    // debris: thrown, falling, bouncing off the treads, settling, shrinking away
    const D = this.debrisList;
    const DM = this.debrisMesh;
    let dn = 0;
    for (let i = D.length - 1; i >= 0; i--) {
      const d = D[i];
      d.t += dt;
      if (d.t >= d.life) {
        D.splice(i, 1);
        continue;
      }
      d.v.y -= 14 * dt;
      d.p.addScaledVector(d.v, dt);
      const floor = this.heightAt ? this.heightAt(d.p.x, d.p.z) + d.s : -1e9;
      if (d.p.y < floor) {
        d.p.y = floor;
        d.v.y = Math.abs(d.v.y) * 0.35;
        d.v.x *= 0.6;
        d.v.z *= 0.6;
        d.spin *= 0.6;
      }
      d.rot.x += d.spin * dt;
      d.rot.y += d.spin * 0.7 * dt;
    }
    for (const d of D) {
      const k = d.t / d.life;
      _q.setFromEuler(d.rot);
      _m.compose(d.p, _q, _sc.setScalar(d.s * (k > 0.75 ? (1 - k) / 0.25 : 1)));
      DM.setMatrixAt(dn++, _m);
    }
    DM.count = dn;
    DM.instanceMatrix.needsUpdate = true;
    DM.visible = dn > 0;
  }
}

