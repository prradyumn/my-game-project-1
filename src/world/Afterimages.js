import * as THREE from 'three';

// Afterimages: Prady's shape frozen where he was, glowing and fading (the shadow-step, the shadows
// of Chhaya Prahar, the run-in). A ghost is the same skinned meshes drawn with a copy of this
// frame's bone matrices and bind matrices (the skeleton's own update switched off), plus the talwar:
// no new geometry, one small bone texture each. A pool of them, each one draw per mesh while it
// lives. The look: a Fresnel rim, bright at the silhouette, a thin tint through the middle.

const MAX = 10;

const VERT = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
varying vec3 vN;
varying vec3 vV;
void main() {
  #include <skinbase_vertex>
  #include <begin_vertex>
  #include <beginnormal_vertex>
  #include <skinnormal_vertex>
  #include <skinning_vertex>
  vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
  vN = normalize(normalMatrix * objectNormal);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uAlpha;
varying vec3 vN; varying vec3 vV;
void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float rim = pow(f, 2.2);
  // a tinted body (it reads over the bright stone of a day) with a hot rim (bloom takes it)
  gl_FragColor = vec4(uColor * (0.32 + rim * 1.4), uAlpha * (0.38 + rim * 0.62));
}`;

const _m = new THREE.Matrix4();
const _a = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);

export class Afterimages {
  constructor(scene) {
    this.scene = scene;
    this.ghosts = [];
    this.next = 0;
    this.enabled = true;
  }

  /** The pool, built for this body the first time (its skinned meshes, its extra plain meshes). */
  build(root, extras) {
    const skinned = [];
    root.traverse((o) => o.isSkinnedMesh && skinned.push(o));
    const plain = [];
    for (const e of extras) e?.traverse?.((o) => o.isMesh && !o.isSkinnedMesh && plain.push(o));
    for (let i = 0; i < MAX; i++) {
      const mat = new THREE.ShaderMaterial({ uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 } }, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.FrontSide });
      const group = new THREE.Group();
      group.name = 'afterimage';
      group.visible = false;
      // (drawn after the water and the other see-through things: sorted by its origin, the world's
      // middle, it came first and the river covered it)
      group.renderOrder = 20;
      const parts = [];
      for (const src of skinned) {
        const sk = new THREE.Skeleton(src.skeleton.bones, src.skeleton.boneInverses);
        sk.update = () => {}; // (frozen: its matrices are copied in at spawn)
        const g = new THREE.SkinnedMesh(src.geometry, mat);
        g.bindMode = src.bindMode;
        g.bindMatrix.copy(src.bindMatrix);
        g.skeleton = sk;
        // (its bind matrices are the source's as they were at the spawn: three would rewrite them)
        g.updateMatrixWorld = function (force) {
          THREE.Object3D.prototype.updateMatrixWorld.call(this, force);
        };
        g.matrixAutoUpdate = false;
        g.frustumCulled = false;
        g.renderOrder = 20;
        group.add(g);
        parts.push({ g, src, sk });
      }
      for (const src of plain) {
        const g = new THREE.Mesh(src.geometry, mat);
        g.matrixAutoUpdate = false;
        g.frustumCulled = false;
        g.renderOrder = 20;
        group.add(g);
        parts.push({ g, src });
      }
      this.scene.add(group);
      this.ghosts.push({ group, parts, mat, t: 1, life: 1, alpha: 0 });
    }
    this.root = root;
  }

  /**
   * A ghost of root (and extras: the sword) as it stands this frame. o.color (HDR rgb), o.life (s),
   * o.alpha; o.place { from: {x,y,z,yaw}, to: {x,y,z,yaw} }: moved from where he is (feet, facing)
   * to somewhere else (a shadow cutting from another side).
   */
  spawn(root, { extras = [], color = [0.45, 0.8, 2.4], life = 0.4, alpha = 0.6, place = null } = {}) {
    if (!this.enabled || !root) return;
    if (!this.ghosts.length) this.build(root, extras);
    const G = this.ghosts[this.next];
    this.next = (this.next + 1) % this.ghosts.length;
    let rel = null;
    if (place) {
      // to: T(to) R(to.yaw) · inverse(T(from) R(from.yaw))
      _a.compose(_p.set(place.from.x, place.from.y, place.from.z), _q.setFromAxisAngle(UP, place.from.yaw), _s).invert();
      rel = _m.compose(_p.set(place.to.x, place.to.y, place.to.z), _q.setFromAxisAngle(UP, place.to.yaw), _s).multiply(_a);
    }
    for (const P of G.parts) {
      P.g.visible = P.src.visible !== false;
      // the source exactly as drawn this frame (its matrix, its bind matrices, its bones), moved by rel
      P.src.updateWorldMatrix(true, false);
      P.g.matrix.copy(P.src.matrixWorld);
      if (rel) P.g.matrix.premultiply(rel);
      P.g.matrixWorld.copy(P.g.matrix);
      if (P.sk) {
        P.g.bindMatrix.copy(P.src.bindMatrix);
        P.g.bindMatrixInverse.copy(P.src.bindMatrixInverse);
        P.sk.boneMatrices.set(P.src.skeleton.boneMatrices.subarray(0, P.sk.bones.length * 16));
        if (P.sk.boneTexture) P.sk.boneTexture.needsUpdate = true;
      }
    }
    G.mat.uniforms.uColor.value.setRGB(...color);
    G.alpha = alpha;
    G.t = 0;
    G.life = life;
    G.group.visible = true;
  }

  update(dt) {
    for (const G of this.ghosts) {
      if (!G.group.visible) continue;
      G.t += dt;
      const k = G.t / G.life;
      if (k >= 1) {
        G.group.visible = false;
        continue;
      }
      G.mat.uniforms.uAlpha.value = G.alpha * (1 - k) * (1 - k);
    }
  }
}
