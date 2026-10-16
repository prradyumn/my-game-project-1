import * as THREE from 'three';
import { aimBone } from '../utils/bones.js';

// Hands that hold on. The motion capture's hands are open (their fingers are held still), so a
// hand IK'd onto a rung or an edge floated beside it. After the clip and the arm IK:
//
//   orient(R, palm, fingers, w)  turn the hand so its palm faces `palm` and its fingers point
//                                along `fingers` (world directions): onto the rung, onto the edge
//   grip(R, shape, k)            close the fingers round what the hand is on:
//                                  'bar'    a fist round a bamboo rung, the thumb wrapped back
//                                  'ledge'  hooked over a stone edge: knuckles and middle joints
//                                           bent, the tips less, the thumb along the edge
//                                  'top'    flat on a ledge's top, the fingers pressing into it
//
// The palm's own frame (finger and palm directions in the hand's local space) is measured once
// per hand from the rig, so it holds for any clip. Used by Traversal (ladders, ledges, mantles).

const SHAPES = {
  bar: [1.2, 1.5, 0.95],
  ledge: [0.95, 1.05, 0.55],
  // palm down on a ledge's top, the fingers along it into the wall, pressing: a little curl
  top: [0.1, 0.2, 0.16],
};

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _rq = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();

function rotateWorld(bone, axis, angle) {
  bone.parent.getWorldQuaternion(_pq);
  const wq = bone.getWorldQuaternion(new THREE.Quaternion());
  wq.premultiply(_rq.setFromAxisAngle(axis, angle));
  bone.quaternion.copy(_pq.invert().multiply(wq));
  bone.updateWorldMatrix(false, true);
}

/** The bones of one hand (side 'Left' | 'Right') under `root`. */
export function handRig(root, side) {
  const find = (n) => {
    let b = null;
    root.traverse((o) => !b && o.isBone && o.name.endsWith(n) && (b = o));
    return b;
  };
  const R = {
    side,
    hand: find(`${side}Hand`),
    thumb: find(`${side}HandThumb1`),
    thumb2: find(`${side}HandThumb2`),
    thumb3: find(`${side}HandThumb3`),
    fingers: ['Index', 'Middle', 'Ring', 'Pinky'].map((n) => [1, 2, 3].map((k) => find(`${side}Hand${n}${k}`)).filter(Boolean)),
    index1: find(`${side}HandIndex1`),
    middle1: find(`${side}HandMiddle1`),
    pinky1: find(`${side}HandPinky1`),
    curlSign: undefined,
    frame: null, // { finger, palm } unit vectors in the hand's local space
  };
  R.ok = !!(R.hand && R.index1 && R.pinky1 && R.middle1 && R.fingers.every((c) => c.length === 3));
  return R;
}

/** Which way the fingers curl (toward the thumb), and the palm's frame in the hand's space. */
function measure(R) {
  const axis = R.pinky1.getWorldPosition(_a).sub(R.index1.getWorldPosition(_b)).normalize();
  const chain = R.fingers[1];
  const tip = chain[2];
  const th = R.thumb.getWorldPosition(new THREE.Vector3());
  const t0 = tip.getWorldPosition(new THREE.Vector3());
  const save = chain.map((b) => b.quaternion.clone());
  for (const b of chain) rotateWorld(b, axis, 0.5);
  const t1 = tip.getWorldPosition(new THREE.Vector3());
  chain.forEach((b, i) => b.quaternion.copy(save[i]));
  chain[0].updateWorldMatrix(false, true);
  R.curlSign = t1.distanceTo(th) < t0.distanceTo(th) ? 1 : -1;
  // with the right sign the tip moves into the palm: that direction, square to the fingers,
  // is the palm's normal
  for (const b of chain) rotateWorld(b, axis, 0.5 * R.curlSign);
  const t2 = tip.getWorldPosition(new THREE.Vector3());
  chain.forEach((b, i) => b.quaternion.copy(save[i]));
  chain[0].updateWorldMatrix(false, true);
  const hand = R.hand.getWorldPosition(new THREE.Vector3());
  const finger = R.middle1.getWorldPosition(new THREE.Vector3()).sub(hand).normalize();
  const palm = t2.sub(t0);
  palm.addScaledVector(finger, -palm.dot(finger)).normalize();
  const inv = R.hand.getWorldQuaternion(new THREE.Quaternion()).invert();
  R.frame = { finger: finger.applyQuaternion(inv), palm: palm.applyQuaternion(inv.clone()) };
}

/** Turn the hand: palm facing `palm`, fingers along `fingers` (world), by weight w. */
export function orient(R, palm, fingers, w = 1) {
  if (!R.ok || w <= 0.001) return;
  if (!R.frame) measure(R);
  const hq = R.hand.getWorldQuaternion(new THREE.Quaternion());
  // the hand's frame now, and the one wanted
  const f0 = _a.copy(R.frame.finger).applyQuaternion(hq);
  const p0 = _b.copy(R.frame.palm).applyQuaternion(hq);
  const basis = (f, p, out) => {
    const pn = p.clone().addScaledVector(f, -p.dot(f)).normalize();
    _x.crossVectors(f, pn);
    _m.makeBasis(f, pn, _x);
    return out.setFromRotationMatrix(_m);
  };
  const qNow = basis(f0.clone(), p0.clone(), new THREE.Quaternion());
  const qWant = basis(_c.copy(fingers).normalize(), palm.clone().normalize(), new THREE.Quaternion());
  const delta = qWant.multiply(qNow.invert());
  const want = delta.multiply(hq);
  hq.slerp(want, w);
  R.hand.parent.getWorldQuaternion(_pq);
  R.hand.quaternion.copy(_pq.invert().multiply(hq));
  R.hand.updateWorldMatrix(false, true);
}

/** Close the fingers round what the hand holds ('bar' | 'ledge'), by k (0 open .. 1 shut). */
export function grip(R, shape, k = 1) {
  if (!R.ok || k <= 0.001) return;
  if (R.curlSign === undefined) measure(R);
  const ang = SHAPES[shape] || SHAPES.bar;
  const axis = R.pinky1.getWorldPosition(_a).sub(R.index1.getWorldPosition(_b)).normalize();
  R.fingers.forEach((chain, ci) => {
    // (the little finger closes a touch further, as a real grip does)
    const extra = 1 + ci * 0.05;
    chain.forEach((bone, j) => rotateWorld(bone, axis, R.curlSign * ang[j] * k * extra));
  });
  if (R.thumb2 && R.thumb3) {
    if (shape === 'bar') {
      // the thumb wrapped back round the bamboo, over the index finger's middle bone
      const over = R.fingers[0][1].getWorldPosition(new THREE.Vector3());
      aimBone(R.thumb, R.thumb2, new THREE.Vector3().lerpVectors(R.fingers[0][0].getWorldPosition(new THREE.Vector3()), over, 0.6), 0.85 * k);
      aimBone(R.thumb2, R.thumb3, over, 0.85 * k);
    } else {
      // along the edge beside the index finger, a little bent
      rotateWorld(R.thumb2, axis, R.curlSign * 0.35 * k);
      rotateWorld(R.thumb3, axis, R.curlSign * 0.3 * k);
    }
  }
}
