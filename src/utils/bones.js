import * as THREE from 'three';

// Skeleton maths that works on ANY rig (no assumptions about bone axes): everything is done
// with world-space directions and converted back to each bone's local rotation.

const _wq = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _t = new THREE.Vector3();
const _d = new THREE.Vector3();
const _e = new THREE.Vector3();
const _ax0 = new THREE.Vector3();
const _ax1 = new THREE.Vector3();
const IDENTITY = new THREE.Quaternion();

const clamp1 = (x) => (x < -1 ? -1 : x > 1 ? 1 : x);

/** Rotate a bone by a WORLD-space rotation (premultiplied), keeping its parent untouched. */
export function rotateBoneWorld(bone, worldDelta) {
  bone.getWorldQuaternion(_wq);
  bone.parent.getWorldQuaternion(_pq);
  _wq.premultiply(worldDelta);
  bone.quaternion.copy(_pq.invert().multiply(_wq));
  bone.updateMatrixWorld(true);
}

/** Rotate a bone about a world axis by an angle (radians). */
export function rotateBoneAxis(bone, worldAxis, angle) {
  if (Math.abs(angle) < 1e-5) return;
  _q0.setFromAxisAngle(worldAxis, angle);
  rotateBoneWorld(bone, _q0);
}

/**
 * Turn `bone` so the segment bone -> child points along `dir` (world, normalised).
 * Minimal rotation, so the bone keeps its twist. `weight` blends from the current pose.
 */
export function aimBone(bone, child, dir, weight = 1) {
  if (weight <= 0) return;
  bone.getWorldPosition(_a);
  child.getWorldPosition(_b);
  _d.subVectors(_b, _a);
  if (_d.lengthSq() < 1e-10) return;
  _d.normalize();
  _q0.setFromUnitVectors(_d, dir);
  if (weight < 1) _q0.slerpQuaternions(IDENTITY, _q0, weight);
  rotateBoneWorld(bone, _q0);
}

/**
 * Analytic two-bone IK (hip-knee-ankle or shoulder-elbow-wrist).
 * Moves `end` toward `target` (world); the joint bends in its current plane, falling back to
 * `poleDir` when the limb is straight. The end bone keeps its world orientation (feet stay flat).
 */
export function solveTwoBone(upper, lower, end, target, poleDir, weight = 1) {
  if (weight <= 0) return;
  upper.getWorldPosition(_a);
  lower.getWorldPosition(_b);
  end.getWorldPosition(_c);
  _t.copy(_c).lerp(target, weight);
  end.getWorldQuaternion(_q2); // keep foot orientation
  const endWorld = _q2.clone();

  const lab = _a.distanceTo(_b);
  const lcb = _b.distanceTo(_c);
  const lat = Math.min(Math.max(_a.distanceTo(_t), 0.01), lab + lcb - 0.002);

  const ac = _d.subVectors(_c, _a).normalize().clone();
  const ab = _e.subVectors(_b, _a).normalize().clone();
  const ba = ab.clone().negate();
  const bc = new THREE.Vector3().subVectors(_c, _b).normalize();
  const at = new THREE.Vector3().subVectors(_t, _a).normalize();

  const ac_ab_0 = Math.acos(clamp1(ac.dot(ab)));
  const ba_bc_0 = Math.acos(clamp1(ba.dot(bc)));
  const ac_at_0 = Math.acos(clamp1(ac.dot(at)));
  const ac_ab_1 = Math.acos(clamp1((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat)));
  const ba_bc_1 = Math.acos(clamp1((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb)));

  _ax0.crossVectors(ac, ab);
  if (_ax0.lengthSq() < 1e-8) _ax0.crossVectors(ac, poleDir);
  _ax0.normalize();
  _ax1.crossVectors(ac, at);
  const hasAx1 = _ax1.lengthSq() > 1e-10;
  if (hasAx1) _ax1.normalize();

  upper.getWorldQuaternion(_wq);
  lower.getWorldQuaternion(_pq);
  const aInv = _wq.clone().invert();
  const bInv = _pq.clone().invert();
  _q0.setFromAxisAngle(_ax0.clone().applyQuaternion(aInv), ac_ab_1 - ac_ab_0);
  _q1.setFromAxisAngle(_ax0.clone().applyQuaternion(bInv), ba_bc_1 - ba_bc_0);
  if (hasAx1) _q0.multiply(new THREE.Quaternion().setFromAxisAngle(_ax1.clone().applyQuaternion(aInv), ac_at_0));
  upper.quaternion.multiply(_q0);
  lower.quaternion.multiply(_q1);
  upper.updateMatrixWorld(true);

  // restore the end bone's world orientation
  lower.getWorldQuaternion(_pq);
  end.quaternion.copy(_pq.invert().multiply(endWorld));
  end.updateMatrixWorld(true);
}

/**
 * Twist `bone` about `axisWorld` so that the world vector (from - to) of two marker bones
 * turns toward `wantWorld` (projected on the plane normal to the axis). Used to roll forearms
 * so the thumb leads and the palm faces the body.
 */
export function twistToward(bone, axisWorld, markerA, markerB, wantWorld, weight = 1) {
  markerA.getWorldPosition(_a);
  markerB.getWorldPosition(_b);
  _d.subVectors(_a, _b);
  _d.addScaledVector(axisWorld, -_d.dot(axisWorld));
  _e.copy(wantWorld).addScaledVector(axisWorld, -wantWorld.dot(axisWorld));
  if (_d.lengthSq() < 1e-8 || _e.lengthSq() < 1e-8) return;
  _d.normalize();
  _e.normalize();
  let ang = Math.acos(clamp1(_d.dot(_e)));
  if (_t.crossVectors(_d, _e).dot(axisWorld) < 0) ang = -ang;
  rotateBoneAxis(bone, axisWorld, ang * weight);
}

export function findBone(root, suffix) {
  let found = null;
  root.traverse((o) => {
    if (!found && o.isBone && o.name.endsWith(suffix)) found = o;
  });
  return found;
}
