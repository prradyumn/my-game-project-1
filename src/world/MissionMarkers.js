import * as THREE from 'three';

// Floating signs for the missions, one instanced mesh of camera-facing cards:
//   kind 0 'giver'     a small golden flame bobbing over someone with a task for Prady
//   kind 1 'objective' a soft column of light to steer by, with a bright point at its foot
//   kind 2 'item'      a glint over something to pick up
//   kind 3 'wisp'      the Yaksha's lantern: a cold blue flame that leads the way
// They fade with distance (the beam stays readable far away) and never cast shadows.

const MAX = 24;

const VS = /* glsl */ `
attribute vec3 aMark; // kind, seed, alpha
uniform float uTime;
varying vec2 vUv;
varying vec3 vMark;
varying float vDist;
void main() {
  vUv = uv;
  vMark = aMark;
  vec3 c = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float kind = aMark.x;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec2 size = kind < 0.5 ? vec2(0.42, 0.62) : kind < 1.5 ? vec2(0.9, 26.0) : kind < 2.5 ? vec2(0.7, 0.7) : vec2(0.9, 1.3);
  float d = distance(cameraPosition, c);
  vDist = d;
  // stay readable: the giver flame and the glint grow a little with distance
  if (kind < 0.5 || kind > 1.5) size *= 1.0 + smoothstep(8.0, 60.0, d) * 1.6;
  vec3 offset = kind < 0.5 || kind > 2.5 ? vec3(0.0, sin(uTime * 2.0 + aMark.y * 6.0) * 0.07, 0.0) : vec3(0.0);
  vec3 anchor = kind > 0.5 && kind < 1.5 ? vec3(0.0, size.y * 0.5, 0.0) : vec3(0.0);
  vec3 p = c + offset + anchor + right * position.x * size.x + up * position.y * size.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const FS = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec3 vMark;
varying float vDist;
void main() {
  float kind = vMark.x;
  float a = vMark.z;
  vec2 c = vUv - 0.5;
  vec3 col;
  float alpha;
  if (kind < 0.5 || kind > 2.5) {
    // a diya flame: teardrop, white-hot core, marigold rim (the wisp burns cold blue)
    vec2 q = vec2(c.x * 2.0, c.y + 0.12);
    float r = length(vec2(q.x * (1.0 + q.y * 1.8), q.y * 0.9));
    float flame = 1.0 - smoothstep(0.18, 0.34, r);
    float core = 1.0 - smoothstep(0.0, 0.16, r);
    float flick = 0.85 + 0.15 * sin(uTime * 13.0 + vMark.y * 9.0);
    col = kind > 2.5 ? mix(vec3(0.5, 1.6, 4.0), vec3(3.2, 3.8, 4.4), core) * flick : mix(vec3(3.0, 1.2, 0.25), vec3(4.0, 3.4, 2.2), core) * flick;
    alpha = flame + (1.0 - smoothstep(0.0, 0.5, length(c))) * (kind > 2.5 ? 0.32 : 0.25);
  } else if (kind < 1.5) {
    // a beam: soft across, fading upward, a slow shimmer
    float across = 1.0 - smoothstep(0.0, 0.5, abs(c.x));
    float up = pow(1.0 - vUv.y, 1.4);
    float shimmer = 0.8 + 0.2 * sin(vUv.y * 40.0 - uTime * 3.0);
    col = vec3(1.4, 1.9, 2.4);
    alpha = across * across * up * shimmer * 0.55 * smoothstep(4.0, 14.0, vDist);
  } else {
    // a four-point glint
    float star = max(1.0 - smoothstep(0.0, 0.05, abs(c.x)) * 1.0, 0.0) * (1.0 - smoothstep(0.0, 0.5, abs(c.y)));
    star = max(star, (1.0 - smoothstep(0.0, 0.05, abs(c.y))) * (1.0 - smoothstep(0.0, 0.5, abs(c.x))));
    float dot0 = 1.0 - smoothstep(0.0, 0.18, length(c));
    float pulse = 0.65 + 0.35 * sin(uTime * 4.0 + vMark.y * 5.0);
    col = vec3(3.2, 2.6, 1.4) * pulse;
    alpha = max(star * 0.8, dot0);
  }
  alpha *= a;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col * alpha, alpha);
}`;

export class MissionMarkers {
  constructor() {
    const geo = new THREE.PlaneGeometry(1, 1);
    this.attr = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aMark', this.attr);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VS,
      fragmentShader: FS,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.material, MAX);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    this.mesh.count = 0;
    this.list = [];
    this._m = new THREE.Matrix4();
  }

  /** Call once per frame: begin(), then add() each sign, then end(dt). */
  begin() {
    this.list.length = 0;
  }

  add(kind, pos, alpha = 1, seed = 0) {
    if (this.list.length < MAX) this.list.push({ kind: { giver: 0, objective: 1, item: 2, wisp: 3 }[kind] ?? 0, x: pos.x, y: pos.y, z: pos.z, alpha, seed });
  }

  end(dt) {
    this.material.uniforms.uTime.value += dt;
    this.list.forEach((m, i) => {
      this.mesh.setMatrixAt(i, this._m.makeTranslation(m.x, m.y, m.z));
      this.attr.setXYZ(i, m.kind, m.seed, m.alpha);
    });
    this.mesh.count = this.list.length;
    this.mesh.visible = this.list.length > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.attr.needsUpdate = true;
  }
}
