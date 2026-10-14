import * as THREE from 'three';

// Spring bones: cloth that hangs from a body and swings with it. Each chain is a few bones in a
// line under a parent bone (Prady's hips, a villain's pelvis); after the clip and every IK has
// posed the body, each joint's tail is integrated on its own (verlet: it keeps its momentum,
// drag bleeds it off, a spring pulls it back to the way the cloth hangs at rest, gravity pulls it
// down), held to its length, and pushed out of the thighs and knees (spheres riding the legs), so
// a stride kicks the cloth forward and it falls back, a turn flares it, a stop swings it on.
// Fixed 60 Hz substeps: the same swing at any frame rate.
//
//   new SpringChain(bones, opts)        bones: root..last, each the parent of the next
//   chainFromPoints(parent, points)     bones made along world points (the rest pose), under parent
//   rigCloth(mesh, chains)              re-weight a skinned cloth mesh's vertices onto chains
//   makeDrape(...)                      a pleated cloth panel (its own skinned mesh) on a chain

const STEP = 1 / 60;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();

export class SpringChain {
  /**
   * @param bones  root .. end (the end bone only marks the last joint's tail)
   * @param opts { stiffness = 1.2 (pull back to rest), drag = 0.12 (of the velocity, per step),
   *   gravity = 9.8 (m/s², down), radius = 0.02 (the cloth's own, for collisions),
   *   colliders: () => [{ c: Vector3, r }] (world, refreshed every frame), maxAngle = 1.4 }
   */
  constructor(bones, opts = {}) {
    this.bones = bones;
    this.o = { stiffness: 1.2, drag: 0.12, gravity: 9.8, radius: 0.02, maxAngle: 1.4, ...opts };
    this.joints = bones.slice(0, -1).map((b, i) => {
      // the tail: the next bone's head
      const axis = bones[i + 1].position.clone();
      const len = axis.length() || 0.05;
      return { b, rest: b.quaternion.clone(), axis: axis.normalize(), len, tail: new THREE.Vector3(), prev: new THREE.Vector3(), worldLen: 0 };
    });
    this.acc = 0;
    this.ready = false;
  }

  reset() {
    this.ready = false;
  }

  /** The tail of joint J where the rest pose puts it now (world), into out. */
  restTail(J, out) {
    const b = J.b;
    b.parent.getWorldQuaternion(_q).multiply(J.rest);
    b.getWorldPosition(out);
    return out.add(_c.copy(J.axis).applyQuaternion(_q).multiplyScalar(J.worldLen));
  }

  update(dt) {
    const J0 = this.joints[0];
    if (!J0) return;
    // world lengths (the body's scale), and a fresh start: at rest, no momentum
    if (!this.ready) {
      J0.b.parent.updateWorldMatrix(true, true);
      const s = J0.b.getWorldScale(_a).x;
      for (const J of this.joints) {
        J.b.quaternion.copy(J.rest);
        J.worldLen = J.len * s;
      }
      J0.b.updateWorldMatrix(false, true);
      for (const J of this.joints) {
        this.restTail(J, J.tail);
        J.prev.copy(J.tail);
      }
      this.ready = true;
      this.acc = 0;
    }
    // (a jump in place: a warp, a respawn, a cut — start again rather than whip across the map)
    J0.b.getWorldPosition(_a);
    const warped = this.lastHead && _a.distanceToSquared(this.lastHead) > 4;
    (this.lastHead ||= new THREE.Vector3()).copy(_a);
    if (warped) {
      this.ready = false;
      return this.update(dt);
    }
    this.acc = Math.min(this.acc + dt, STEP * 4);
    const cols = this.o.colliders?.() || [];
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.step(cols);
    }
    this.pose();
  }

  step(cols) {
    const o = this.o;
    for (let i = 0; i < this.joints.length; i++) {
      const J = this.joints[i];
      // the head: where the joint before put this bone (the root's: wherever the body has it)
      const head = i === 0 ? J.b.getWorldPosition(_a) : _a.copy(this.joints[i - 1].tail);
      const rest = this.restTailFrom(J, i, head, _b);
      const next = _c.copy(J.tail).sub(J.prev).multiplyScalar(1 - o.drag).add(J.tail);
      next.addScaledVector(rest.sub(J.tail), Math.min(1, o.stiffness * STEP * 4));
      next.y -= o.gravity * STEP * STEP;
      // held to its length from the head
      next.sub(head).setLength(J.worldLen).add(head);
      // out of the legs
      for (let k = 0; k < cols.length; k++) {
        const C = cols[k];
        const r = C.r + o.radius;
        const d = next.distanceTo(C.c);
        if (d < r && d > 1e-5) {
          next.sub(C.c).multiplyScalar(r / d).add(C.c);
          next.sub(head).setLength(J.worldLen).add(head);
        }
      }
      J.prev.copy(J.tail);
      J.tail.copy(next);
    }
  }

  /** The rest tail of joint i given where its head is now (the chain above may have swung). */
  restTailFrom(J, i, head, out) {
    // rest orientation: the parent's (the body bone for the root, the swung joint above for the
    // others) times the bone's own rest rotation
    if (i === 0) J.b.parent.getWorldQuaternion(_q);
    else _q.copy(this.joints[i - 1].wq || J.b.parent.getWorldQuaternion(_q2));
    _q.multiply(J.rest);
    return out.copy(J.axis).applyQuaternion(_q).multiplyScalar(J.worldLen).add(head);
  }

  /** Turn each bone so its tail points at its simulated tail. */
  pose() {
    const o = this.o;
    for (let i = 0; i < this.joints.length; i++) {
      const J = this.joints[i];
      const b = J.b;
      b.quaternion.copy(J.rest);
      b.updateWorldMatrix(true, false);
      const head = b.getWorldPosition(_a);
      b.getWorldQuaternion(_q);
      const from = _b.copy(J.axis).applyQuaternion(_q);
      const to = _c.copy(J.tail).sub(head).normalize();
      // (never folded back through the body: a limit on the swing from rest)
      const ang = from.angleTo(to);
      if (ang > o.maxAngle) to.lerpVectors(from, to, o.maxAngle / ang).normalize();
      _q2.setFromUnitVectors(from, to);
      // world delta -> local: q_local = parentInv * delta * parentWorld * rest
      b.parent.getWorldQuaternion(_q);
      const pw = _q.clone();
      b.quaternion.copy(pw.clone().invert().multiply(_q2).multiply(pw).multiply(J.rest));
      b.updateWorldMatrix(false, false);
      J.wq = (J.wq || new THREE.Quaternion()).copy(b.getWorldQuaternion(_q));
    }
    this.joints[0].b.updateWorldMatrix(false, true);
  }
}

/**
 * Bones along world points (the rest pose, top to bottom), the first a child of `parent`.
 * Returns the bones; the last point is the end of the last bone (it gets no bone of its own).
 */
export function chainFromPoints(parent, points, name = 'spring') {
  parent.updateWorldMatrix(true, false);
  const bones = [];
  let up = parent;
  for (let i = 0; i < points.length - 1; i++) {
    const b = new THREE.Bone();
    b.name = `${name}${i}`;
    up.add(b);
    up.updateWorldMatrix(true, false);
    b.position.copy(up.worldToLocal(points[i].clone()));
    // (no rotation of its own: its frame is its parent's, the axis is the offset to the next)
    b.quaternion.identity();
    up.getWorldQuaternion(_q);
    b.quaternion.copy(_q.invert());
    b.updateWorldMatrix(false, false);
    bones.push(b);
    up = b;
  }
  // the end: a tail bone placed at the last point (the last joint's axis)
  const tip = new THREE.Bone();
  tip.name = `${name}End`;
  up.add(tip);
  up.updateWorldMatrix(true, false);
  tip.position.copy(up.worldToLocal(points[points.length - 1].clone()));
  bones.push(tip);
  return bones;
}

/**
 * Hand a skinned cloth mesh's hanging part over to spring chains. Each chain: { bones (from
 * chainFromPoints, end included), pick(v world) -> bool, top, bottom (world y at rest) }. Each
 * vertex a chain picks gets the chain's weight by how far down it hangs (none at the waist, all
 * of it below a hand's breadth), on the chain bone at its height; its other influences keep the
 * rest. The skeleton is extended (the same way on every clone that shares the geometry).
 * Must be called with the body in its rest pose.
 */
export function rigCloth(mesh, chains) {
  const skel = mesh.skeleton;
  const geo = mesh.geometry;
  const base = skel.bones.length;
  // the bind relation of the existing bones (world * inverse), shared by the new ones
  skel.bones[0].updateWorldMatrix(true, false);
  const M = new THREE.Matrix4().multiplyMatrices(skel.bones[0].matrixWorld, skel.boneInverses[0]);
  const newBones = [];
  for (const ch of chains) for (const b of ch.bones.slice(0, -1)) newBones.push(b);
  const inverses = newBones.map((b) => {
    b.updateWorldMatrix(true, false);
    return new THREE.Matrix4().copy(b.matrixWorld).invert().multiply(M);
  });
  mesh.skeleton = new THREE.Skeleton([...skel.bones, ...newBones], [...skel.boneInverses, ...inverses]);
  mesh.bind(mesh.skeleton, mesh.bindMatrix);
  if (geo.userData.springRigged) return;
  geo.userData.springRigged = true;
  const si = geo.attributes.skinIndex;
  const sw = geo.attributes.skinWeight;
  const v = new THREE.Vector3();
  let off = base;
  const ranges = chains.map((ch) => {
    const n = ch.bones.length - 1;
    const r = { start: off, n };
    off += n;
    return r;
  });
  for (let i = 0; i < si.count; i++) {
    mesh.getVertexPosition(i, v);
    v.applyMatrix4(mesh.matrixWorld);
    const ci = chains.findIndex((ch) => ch.pick(v));
    if (ci < 0) continue;
    const ch = chains[ci];
    const span = ch.top - ch.bottom || 1;
    const down = (ch.top - v.y) / span; // 0 at the waist .. 1 at the hem
    const k = THREE.MathUtils.smoothstep(down, 0.04, 0.3);
    if (k <= 0.001) continue;
    const j = Math.min(ranges[ci].n - 1, Math.max(0, Math.floor(down * ranges[ci].n)));
    // the slot with the least weight makes room
    let low = 0;
    for (let s = 1; s < 4; s++) if (sw.getComponent(i, s) < sw.getComponent(i, low)) low = s;
    for (let s = 0; s < 4; s++) sw.setComponent(i, s, sw.getComponent(i, s) * (1 - k));
    let sum = 0;
    for (let s = 0; s < 4; s++) if (s !== low) sum += sw.getComponent(i, s);
    // (renormalise what is left to 1 - k, then the chain takes k)
    const scale = sum > 1e-5 ? (1 - k) / sum : 0;
    for (let s = 0; s < 4; s++) if (s !== low) sw.setComponent(i, s, sw.getComponent(i, s) * scale);
    si.setComponent(i, low, ranges[ci].start + j);
    sw.setComponent(i, low, sum > 1e-5 ? k : 1);
  }
  si.needsUpdate = true;
  sw.needsUpdate = true;
}

/**
 * A cloth panel hanging on a chain: `width` wide, its rows following the chain's rest points,
 * pleated (vertical folds `pleats` deep) and curved round the body (`wrap`), two-sided as a thin
 * slab so one-sided materials see both faces. taper: the top's width as a share of the hem's. uvAt(world point) -> [u, v] colours it from the
 * body's own texture. Returns a SkinnedMesh (bind mode 'detached': the bones place it).
 */
export function makeDrape({ bones, points: joints, width, normal, side, material, uvAt, pleats = 0.012, folds = 5, wrap = 0.04, thick = 0.006, cols = 8, sub = 3, taper = 1 }) {
  // rows: `sub` per bone between the joints, each with its bone and its share of the next
  const points = [];
  const rowBone = [];
  for (let j = 0; j < joints.length - 1; j++) {
    for (let k = 0; k < sub; k++) {
      const t = k / sub;
      points.push(new THREE.Vector3().lerpVectors(joints[j], joints[j + 1], t));
      rowBone.push([j, t]);
    }
  }
  points.push(joints[joints.length - 1].clone());
  rowBone.push([joints.length - 2, 1]);
  const rows = points.length;
  const pos = [];
  const uv = [];
  const si = [];
  const sw = [];
  const idx = [];
  const nBones = bones.length - 1;
  const p = new THREE.Vector3();
  for (const face of [0, 1]) {
    const base = pos.length / 3;
    for (let r = 0; r < rows; r++) {
      const P = points[r];
      // (the fold deepens toward the hem)
      const kd = 0.5 + 0.5 * (r / (rows - 1));
      for (let c = 0; c <= cols; c++) {
        // (gathered at the top: `taper` of the width there, the full width at the hem)
        const x = (c / cols - 0.5) * width * (taper + (1 - taper) * (r / (rows - 1)));
        const pleat = Math.sin((c / cols) * Math.PI * 2 * folds) * pleats * kd;
        const curve = -wrap * (2 * (c / cols) - 1) ** 2;
        p.copy(P).addScaledVector(side, x).addScaledVector(normal, pleat + curve + (face ? -thick : 0));
        pos.push(p.x, p.y, p.z);
        const tex = uvAt(p);
        uv.push(tex[0], tex[1]);
        // on its segment's bone, easing toward the next one's near the joint (a soft bend)
        const [j, t] = rowBone[r];
        const nx = j + 1 < nBones ? j + 1 : j;
        const w2 = nx !== j ? THREE.MathUtils.smoothstep(t, 0.55, 1) * 0.5 : 0;
        si.push(j, nx, 0, 0);
        sw.push(1 - w2, w2, 0, 0);
      }
    }
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols; c++) {
        const a = base + r * (cols + 1) + c;
        const b = a + cols + 1;
        if (face === 0) idx.push(a, b, a + 1, a + 1, b, b + 1);
        else idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.SkinnedMesh(g, material);
  mesh.bindMode = THREE.DetachedBindMode;
  const used = bones.slice(0, -1);
  for (const b of used) b.updateWorldMatrix(true, false);
  const skel = new THREE.Skeleton(used, used.map((b) => new THREE.Matrix4().copy(b.matrixWorld).invert()));
  mesh.bind(skel, new THREE.Matrix4());
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Spheres along a leg (thigh, knee, shin) into out[k..k+3] from the bones; returns the next k. */
export function legSpheres(upLeg, leg, foot, rThigh, out, k = 0) {
  upLeg.getWorldPosition(_a);
  leg.getWorldPosition(_b);
  foot.getWorldPosition(_c);
  const put = (from, to, t, r) => {
    out[k] ||= { c: new THREE.Vector3(), r };
    out[k].c.lerpVectors(from, to, t);
    out[k].r = r;
    k++;
  };
  put(_a, _b, 0.35, rThigh);
  put(_a, _b, 0.7, rThigh * 0.85);
  put(_a, _b, 1, rThigh * 0.7);
  put(_b, _c, 0.5, rThigh * 0.6);
  return k;
}
