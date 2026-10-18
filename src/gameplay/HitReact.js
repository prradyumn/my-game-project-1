import * as THREE from 'three';

// Physical hit reactions for a skinned body, layered over whatever clip is playing.
//
// Each joint of the upper body (pelvis, spine, chest, neck, head, both arms) carries a small
// rotation of its own, a spring pulling it back to the clip. A blow lands as a real torque on
// every joint between where it struck and the hips: (hit point - joint) x force, so a cut at the
// shoulder twists the chest and throws that arm back, a kick to the head snaps the neck, a blow
// low on the side bends the body round it. Heavy blows, kicks and charged ones also leave it limp
// a moment (a partial ragdoll): the springs go slack and the arms fall and swing under gravity,
// then the muscles take them back. Driven at 60 Hz, applied after the clip and before any IK.
//
// Works on Rocketbox Bip01_* and Mixamo skeletons.

const JOINTS = [
  // name, bone names, parent joint, gain (how much a torque turns it), stiffness, max angle (rad)
  ['pelvis', ['Pelvis', 'Hips'], null, 0.35, 80, 0.1],
  ['spine', ['Spine', 'Spine'], 'pelvis', 1.0, 60, 0.18],
  ['chest', ['Spine1', 'Spine1'], 'spine', 1.1, 55, 0.2],
  ['neck', ['Neck', 'Neck'], 'chest', 1.3, 45, 0.22],
  ['head', ['Head', 'Head'], 'neck', 1.6, 40, 0.3],
  ['uarmL', ['L_UpperArm', 'LeftArm'], 'chest', 2.2, 38, 1.1],
  ['farmL', ['L_Forearm', 'LeftForeArm'], 'uarmL', 2.4, 34, 1.0],
  ['uarmR', ['R_UpperArm', 'RightArm'], 'chest', 2.2, 38, 1.1],
  ['farmR', ['R_Forearm', 'RightForeArm'], 'uarmR', 2.4, 34, 1.0],
];
const ARMS = new Set(['uarmL', 'farmL', 'uarmR', 'farmR']);
const STEP = 1 / 60;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _t = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _G = new THREE.Vector3(0, -1, 0);

function findBone(root, names) {
  for (const n of names) {
    const b = root.getObjectByName(`Bip01_${n}`) || root.getObjectByName(`mixamorig${n}`) || root.getObjectByName(`mixamorig:${n}`) || root.getObjectByName(n);
    if (b) return b;
  }
  return null;
}

export class HitReact {
  /** root: the skinned model's root; scale: the body's scale (bigger bodies react slower). */
  constructor(root, { scale = 1 } = {}) {
    this.joints = [];
    const by = {};
    for (const [name, names, parent, gain, k, max] of JOINTS) {
      const bone = findBone(root, names);
      if (!bone || !bone.parent) continue;
      // (the child bone along the limb: where the segment's weight hangs)
      const child = bone.children.find((c) => c.isBone) || null;
      const j = { name, bone, child, parent: by[parent] || null, gain: gain / Math.sqrt(scale), k, max, w: new THREE.Vector3(), v: new THREE.Vector3(), arm: ARMS.has(name) };
      by[name] = j;
      this.joints.push(j);
    }
    this.limp = 0; // 0 .. 1: how slack the muscles are (a partial ragdoll at 1)
    this.acc = 0;
    this.active = false;
  }

  /**
   * A blow: at (world point), dir (the push, horizontal or not), strength (1 a light cut, ~2.5 a
   * charged heavy), limp (seconds of slack arms, 0 for none).
   */
  hit(at, dir, strength = 1, { limp = 0 } = {}) {
    if (!this.joints.length) return;
    const F = _a.set(dir.x, dir.y ?? 0, dir.z);
    if (F.lengthSq() < 1e-6) return;
    F.normalize().multiplyScalar(strength);
    // the joint nearest the blow, and every joint from it down to the hips
    let near = null;
    let nd = Infinity;
    for (const j of this.joints) {
      const d = j.bone.getWorldPosition(_b).distanceToSquared(at);
      if (d < nd) {
        nd = d;
        near = j;
      }
    }
    const chain = new Set();
    for (let j = near; j; j = j.parent) chain.add(j);
    for (const j of this.joints) {
      // the struck chain takes the blow in full; the rest of the trunk feels a little of it
      const w = chain.has(j) ? 1 : j.arm ? 0.15 : 0.35;
      j.bone.getWorldPosition(_b);
      const r = _t.subVectors(at, _b);
      // (a lever too short to turn it: at least a hand's breadth, along the push)
      if (r.lengthSq() < 0.01) r.addScaledVector(F, 0.1 / Math.max(0.1, F.length()));
      const tq = r.cross(F);
      j.v.addScaledVector(tq, j.gain * w * 0.75);
    }
    this.limp = Math.max(this.limp, Math.min(1, limp));
    this.limpT = Math.max(this.limpT || 0, limp);
    this.active = true;
  }

  /** After the clip has posed the bones (and before IK): add the reaction on top. */
  update(dt) {
    if (!this.active) return;
    this.acc = Math.min(this.acc + dt, 0.1);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.step(STEP);
    }
    let any = this.limp > 0.01;
    // parents first: each joint's world-space turn carries its children with it
    for (const j of this.joints) {
      const ang = j.w.length();
      if (ang > 1e-4) {
        rotateWorld(j.bone, _b.copy(j.w).divideScalar(ang), ang);
        any = true;
      }
      if (j.v.lengthSq() > 1e-4) any = true;
    }
    if (!any) {
      this.active = false;
      for (const j of this.joints) j.w.set(0, 0, 0), j.v.set(0, 0, 0);
    }
  }

  step(h) {
    this.limpT = Math.max(0, (this.limpT || 0) - h);
    // slack while the blow's limp lasts, then the muscles come back over a third of a second
    if (this.limpT <= 0) this.limp = Math.max(0, this.limp - h * 3);
    for (const j of this.joints) {
      const slack = j.arm ? 1 - 0.88 * this.limp : 1 - 0.55 * this.limp;
      const k = j.k * slack;
      const c = 2 * Math.sqrt(k) * (j.arm ? 0.55 : 0.7); // (under-damped: it swings past and settles)
      j.v.addScaledVector(j.w, -k * h).addScaledVector(j.v, -c * h);
      // a limp arm falls: gravity on the limb about its shoulder or elbow
      if (j.arm && this.limp > 0 && j.child) {
        j.bone.getWorldPosition(_b);
        const limb = j.child.getWorldPosition(_t).sub(_b);
        j.v.addScaledVector(limb.cross(_G), 26 * this.limp * h);
      }
      j.w.addScaledVector(j.v, h);
      const ang = j.w.length();
      if (ang > j.max) {
        j.w.multiplyScalar(j.max / ang);
        // (it hits the end of the joint's reach: the swing stops there)
        j.v.multiplyScalar(0.4);
      }
    }
  }

  reset() {
    for (const j of this.joints) j.w.set(0, 0, 0), j.v.set(0, 0, 0);
    this.limp = 0;
    this.limpT = 0;
    this.active = false;
  }
}

function rotateWorld(bone, axis, angle) {
  bone.parent.getWorldQuaternion(_pq);
  const wq = bone.getWorldQuaternion(_q);
  wq.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
  bone.quaternion.copy(_pq.invert().multiply(wq));
  bone.updateWorldMatrix(false, true);
}
