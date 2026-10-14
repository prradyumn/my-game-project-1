import * as THREE from 'three';
import { SpringChain, chainFromPoints, makeDrape, legSpheres } from './SpringBones.js';

// Prady's loose cloth, on spring bones (SpringBones.js): the model's dhoti is painted onto his
// legs, so nothing on him could swing. Two pieces are added, cut from his own texture:
//   * the dhoti's front pleats: the gathered fold that hangs from the tuck at his navel to his
//     knees, pleated, kicked forward by each stride and swinging back, flaring on a turn
//   * the end of the red sash at his left hip, hanging from its knot
// Each is its own small skinned mesh on a chain of bones under his hips, posed after every clip
// and IK; the thighs and knees push the cloth (spheres riding the legs). Both share his material
// (no new shader), and are drawn as thin two-sided slabs.

const _v = new THREE.Vector3();
const _p = new THREE.Vector3();

export class Drapes {
  /** model: Prady's glTF root (posed at rest here); body: his skinned mesh; scene: the world. */
  constructor(model, body, scene) {
    this.model = model;
    this.scene = scene;
    this.chains = [];
    this.meshes = [];
    const find = (n) => {
      let b = null;
      model.traverse((o) => !b && o.isBone && o.name.endsWith(n) && (b = o));
      return b;
    };
    const hips = find('Hips');
    const legs = ['Left', 'Right'].map((s) => [find(`${s}UpLeg`), find(`${s}Leg`), find(`${s}Foot`)]);
    if (!hips || legs.some((l) => l.some((b) => !b)) || !body?.skeleton) return;
    // the rest pose: no clip has posed him yet, so his bones stand as the file put them
    // (skeleton.pose() would rebuild them from the bind matrices, and on this rig hand the
    // armature's scale to the hips, which no clip ever sets back)
    model.updateMatrixWorld(true);
    const fwd = new THREE.Vector3(0, 0, 1).transformDirection(model.matrixWorld).setY(0).normalize();
    const left = new THREE.Vector3(0, 1, 0).cross(fwd).normalize(); // his left
    // the body's own surface at rest (world), for where the cloth sits and what colour it is
    const pos = body.geometry.attributes.position;
    const uvA = body.geometry.attributes.uv;
    const n = pos.count;
    const P = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      body.getVertexPosition(i, _v);
      _v.applyMatrix4(body.matrixWorld);
      P[i * 3] = _v.x;
      P[i * 3 + 1] = _v.y;
      P[i * 3 + 2] = _v.z;
    }
    const nearest = (q) => {
      let best = 0;
      let bd = Infinity;
      for (let i = 0; i < n; i++) {
        const dx = P[i * 3] - q.x;
        const dy = P[i * 3 + 1] - q.y;
        const dz = P[i * 3 + 2] - q.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      return best;
    };
    const uvAt = (q) => {
      const i = nearest(q);
      return [uvA.getX(i), uvA.getY(i)];
    };
    // how far forward (or out to a side) the body reaches at a height, within a band across it
    const front = (axis, y, across, half, dy = 0.025) => {
      let best = -Infinity;
      const o = hips.getWorldPosition(new THREE.Vector3());
      const side = axis === fwd ? left : fwd;
      for (let i = 0; i < n; i++) {
        _v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
        if (Math.abs(_v.y - y) > dy) continue;
        _p.subVectors(_v, o);
        if (Math.abs(_p.dot(side) - across) > half) continue;
        best = Math.max(best, _p.dot(axis));
      }
      return best;
    };
    const hipP = hips.getWorldPosition(new THREE.Vector3());
    const kneeY = (legs[0][1].getWorldPosition(_v).y + legs[1][1].getWorldPosition(_p).y) / 2;
    const scale = model.getWorldScale(_v).x;
    void scale;
    // ---- the front pleats: from the tuck under the navel to just above the knees
    {
      const top = hipP.y + 0.06;
      const bottom = kneeY + 0.06;
      const nJ = 5;
      const pts = [];
      let reach = 0;
      for (let j = 0; j < nJ; j++) {
        const y = top + (bottom - top) * (j / (nJ - 1));
        // (hanging straight from the belly, in front of whichever is further out: belly or thighs)
        reach = Math.max(reach, front(fwd, y, 0, 0.07) + 0.018);
        if (!isFinite(reach)) reach = 0.15;
        pts.push(hipP.clone().setY(y).addScaledVector(fwd, reach));
      }
      const bones = chainFromPoints(hips, pts, 'pleat');
      // (one colour, the dhoti's own off the front of his thigh: a texture lookup per vertex
      // crossed the atlas's seams and came out patchwork; the pleats' folds give the detail)
      const thigh = legs[0][0].getWorldPosition(new THREE.Vector3()).lerp(legs[0][1].getWorldPosition(new THREE.Vector3()), 0.45);
      thigh.addScaledVector(fwd, Math.max(0.05, front(fwd, thigh.y, thigh.clone().sub(hipP).dot(left), 0.03)) - thigh.clone().sub(hipP).dot(fwd));
      const cloth = uvAt(thigh);
      this.addPiece(bones, pts, { width: 0.19, taper: 0.5, normal: fwd, side: left, uvAt: () => cloth, pleats: 0.012, folds: 4, wrap: 0.035 }, body.material, legs, { stiffness: 1.8, drag: 0.16, maxAngle: 1.0 });
    }
    // ---- the sash's end, hanging from its knot at his left hip
    {
      const y = hipP.y + 0.1;
      const out = front(left, y, 0, 0.08);
      const knot = hipP.clone().setY(y).addScaledVector(left, (isFinite(out) ? out : 0.16) + 0.012).addScaledVector(fwd, 0.04);
      const pts = [0, 1, 2, 3].map((j) => knot.clone().addScaledVector(new THREE.Vector3(0, -1, 0), 0.11 * j).addScaledVector(left, 0.008 * j));
      const bones = chainFromPoints(hips, pts, 'sash');
      this.addPiece(bones, pts, { width: 0.065, normal: left, side: fwd.clone().negate(), uvAt: () => uvAt(knot), pleats: 0.004, folds: 1, wrap: 0.008, cols: 3 }, body.material, legs, { stiffness: 1.3, drag: 0.12, maxAngle: 1.1 });
    }
    model.updateMatrixWorld(true);
  }

  addPiece(bones, pts, drape, material, legs, spring) {
    const mesh = makeDrape({ bones, points: pts, material, ...drape });
    this.scene.add(mesh);
    this.meshes.push(mesh);
    const cols = [];
    this.chains.push(
      new SpringChain(bones, {
        ...spring,
        colliders: () => {
          let k = legSpheres(legs[0][0], legs[0][1], legs[0][2], 0.085, cols, 0);
          k = legSpheres(legs[1][0], legs[1][1], legs[1][2], 0.085, cols, k);
          cols.length = k;
          return cols;
        },
      })
    );
  }

  /** After every pose and IK of the frame. */
  update(dt) {
    let vis = true;
    for (let o = this.model; o; o = o.parent) if (!o.visible) vis = false;
    for (const m of this.meshes) m.visible = vis;
    if (!vis) return;
    for (const c of this.chains) c.update(dt);
  }

  reset() {
    for (const c of this.chains) c.reset();
  }
}
