import * as THREE from 'three';
import { GROUPS } from '../core/Physics.js';

// A fallen body given over to physics. When an Asura dies its skeleton is wrapped in eleven
// Rapier bodies (hips, chest, head, upper and lower arms, thighs, calves) joined at the
// shoulders, elbows, hips, knees and neck, set moving with the blow that felled it, and left to
// fall: it crumples, slides and tumbles down the real treads of the ghat (not the smooth walking
// ramp) until the embers burn it away. Every frame the bones are written back from the bodies.
//
// Works for any Biped (Rocketbox Bip01_*) or Mixamo skeleton, at any scale.

const SEGS = [
  // name, bone, the bone it reaches to, radius (m at scale 1), mass (kg), parent segment
  ['pelvis', ['Pelvis', 'Hips'], ['Spine1', 'Spine1'], 0.14, 12, null],
  ['chest', ['Spine1', 'Spine1'], ['Neck', 'Neck'], 0.15, 16, 'pelvis'],
  ['head', ['Head', 'Head'], null, 0.11, 5, 'chest'],
  ['uarmL', ['L_UpperArm', 'LeftArm'], ['L_Forearm', 'LeftForeArm'], 0.055, 2.5, 'chest'],
  ['farmL', ['L_Forearm', 'LeftForeArm'], ['L_Hand', 'LeftHand'], 0.045, 1.6, 'uarmL'],
  ['uarmR', ['R_UpperArm', 'RightArm'], ['R_Forearm', 'RightForeArm'], 0.055, 2.5, 'chest'],
  ['farmR', ['R_Forearm', 'RightForeArm'], ['R_Hand', 'RightHand'], 0.045, 1.6, 'uarmR'],
  ['thighL', ['L_Thigh', 'LeftUpLeg'], ['L_Calf', 'LeftLeg'], 0.075, 8, 'pelvis'],
  ['calfL', ['L_Calf', 'LeftLeg'], ['L_Foot', 'LeftFoot'], 0.055, 4, 'thighL'],
  ['thighR', ['R_Thigh', 'RightUpLeg'], ['R_Calf', 'RightLeg'], 0.075, 8, 'pelvis'],
  ['calfR', ['R_Calf', 'RightLeg'], ['R_Foot', 'RightFoot'], 0.055, 4, 'thighR'],
];

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _UP = new THREE.Vector3(0, 1, 0);

function findBone(root, names) {
  for (const n of names) {
    const b = root.getObjectByName(`Bip01_${n}`) || root.getObjectByName(`mixamorig${n}`) || root.getObjectByName(`mixamorig:${n}`) || root.getObjectByName(n);
    if (b) return b;
  }
  return null;
}

const depth = (o) => {
  let d = 0;
  for (let p = o.parent; p; p = p.parent) d++;
  return d;
};

export class Ragdoll {
  /**
   * root: the skinned model's root (its bones in their death pose, world matrices current).
   * opts: { scale, vel: {x,y,z} (m/s), spin (rad/s), mass multiplier }
   */
  constructor(physics, root, { scale = 1, vel = { x: 0, y: 0, z: 0 }, spin = 0, massK = 1 } = {}) {
    this.physics = physics;
    const R = physics.RAPIER;
    const W = physics.world;
    root.updateMatrixWorld(true);
    this.segs = [];
    const byName = {};
    for (const [name, boneNames, toNames, r0, mass, parent] of SEGS) {
      const bone = findBone(root, boneNames);
      if (!bone) continue;
      const to = toNames ? findBone(root, toNames) : null;
      const p0 = bone.getWorldPosition(new THREE.Vector3());
      let p1;
      const r = r0 * scale;
      if (to) p1 = to.getWorldPosition(new THREE.Vector3());
      else {
        // the head: a ball a little above the head bone, along the neck's line
        const nb = findBone(root, ['Neck']);
        const up = nb ? _a.copy(p0).sub(nb.getWorldPosition(_b)).normalize() : _a.set(0, 1, 0);
        p1 = p0.clone().addScaledVector(up, 0.2 * scale);
      }
      const dir = _b.copy(p1).sub(p0);
      const len = Math.max(dir.length(), r * 2.2);
      dir.normalize();
      const mid = p0.clone().addScaledVector(dir, len * 0.5);
      const rot = new THREE.Quaternion().setFromUnitVectors(_UP, dir);
      const body = W.createRigidBody(
        R.RigidBodyDesc.dynamic()
          .setTranslation(mid.x, mid.y, mid.z)
          .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w })
          .setLinearDamping(0.12)
          .setAngularDamping(1.6)
          .setCcdEnabled(true)
          .setLinvel(vel.x + (Math.random() - 0.5) * 0.4, vel.y + Math.random() * 0.3, vel.z + (Math.random() - 0.5) * 0.4)
          .setAngvel({ x: (Math.random() - 0.5) * spin, y: (Math.random() - 0.5) * spin * 0.5, z: (Math.random() - 0.5) * spin })
      );
      const half = Math.max(0.01, len / 2 - r);
      const shape = name === 'head' ? R.ColliderDesc.ball(r * 1.15) : R.ColliderDesc.capsule(half, r);
      shape.setMass(mass * massK * scale * scale * scale).setFriction(0.9).setRestitution(0.05).setCollisionGroups(GROUPS.ragdoll);
      W.createCollider(shape, body);
      // how the bone sits in its body, to write it back later
      const boneQ = bone.getWorldQuaternion(new THREE.Quaternion());
      const inv = rot.clone().invert();
      const seg = { name, bone, body, offQ: inv.clone().multiply(boneQ), offP: p0.clone().sub(mid).applyQuaternion(inv), parent, depth: depth(bone) };
      this.segs.push(seg);
      byName[name] = seg;
    }
    // the joints: at each child's root bone, a ball joint (neck, shoulders, hips, elbows, knees)
    this.joints = [];
    for (const seg of this.segs) {
      const par = seg.parent && byName[seg.parent];
      if (!par) continue;
      const at = seg.bone.getWorldPosition(new THREE.Vector3());
      const loc = (s) => {
        const t = s.body.translation();
        const r = s.body.rotation();
        return at.clone().sub(_a.set(t.x, t.y, t.z)).applyQuaternion(_q.set(r.x, r.y, r.z, r.w).invert());
      };
      const a1 = loc(par);
      const a2 = loc(seg);
      const j = W.createImpulseJoint(R.JointData.spherical({ x: a1.x, y: a1.y, z: a1.z }, { x: a2.x, y: a2.y, z: a2.z }), par.body, seg.body, true);
      j.setContactsEnabled?.(false);
      this.joints.push(j);
    }
    // write parents before children
    this.segs.sort((x, y) => x.depth - y.depth);
    this.root = this.segs[0];
    this.alive = true;
  }

  /** A push on the whole body (a parting kick, a shockwave). */
  impulse(x, y, z) {
    for (const s of this.segs) s.body.applyImpulse({ x: x * s.body.mass(), y: y * s.body.mass(), z: z * s.body.mass() }, true);
  }

  /** The pelvis' world position (for markers, embers, the camera). */
  center(out) {
    const t = this.root.body.translation();
    return out.set(t.x, t.y, t.z);
  }

  /** Pose the skeleton from the bodies (after the physics step, before the render). */
  apply() {
    if (!this.alive) return;
    for (const s of this.segs) {
      const r = s.body.rotation();
      _q.set(r.x, r.y, r.z, r.w);
      const bone = s.bone;
      const parent = bone.parent;
      parent.updateWorldMatrix(true, false);
      // the root segment also places the skeleton: its bone goes where its body went
      if (s === this.root) {
        const t = s.body.translation();
        _a.copy(s.offP).applyQuaternion(_q).add(_b.set(t.x, t.y, t.z));
        _m.copy(parent.matrixWorld).invert();
        bone.position.copy(_a.applyMatrix4(_m));
      }
      // world rotation = body * offset, expressed in the parent's frame
      _q2.copy(_q).multiply(s.offQ);
      parent.getWorldQuaternion(_q);
      bone.quaternion.copy(_q.invert().multiply(_q2));
      bone.updateMatrixWorld(true);
    }
  }

  dispose() {
    if (!this.alive) return;
    this.alive = false;
    const W = this.physics.world;
    for (const j of this.joints) W.removeImpulseJoint(j, true);
    for (const s of this.segs) W.removeRigidBody(s.body);
    this.segs = [];
    this.joints = [];
  }
}
