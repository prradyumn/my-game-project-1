import * as THREE from 'three';
import { aimBone, findBone, twistToward } from '../src/utils/bones.js';

// Joint positions -> an AnimationClip on Prady's own skeleton.
// The input is video motion capture: Motion2MixamoRig / GVHMR's 24 SMPL joints per frame, Y up,
// metres, on a world-grounded floor (source-assets/m2mr/*.json, written by
// ~/Desktop/PradyAnim/Scripts/npz_to_json.py).
// For each frame, a copy of Prady is posed from its rest:
//   - the hips turned to the pelvis frame (hip line and spine) and moved with the pelvis, scaled by leg length;
//   - every limb and spine bone aimed exactly along its joint pair (aimBone, minimal rotation);
//   - the chest twisted to the shoulder line.
// The result goes through retargetClip like any other source (identity map, same shaping).

const AIM = [
  ['Spine', 'Spine1', 'spine1', 'spine2'],
  ['Spine1', 'Spine2', 'spine2', 'spine3'],
  ['Spine2', 'Neck', 'spine3', 'neck'],
  ['Neck', 'Head', 'neck', 'head'],
  'chest',
  ['LeftShoulder', 'LeftArm', 'left_collar', 'left_shoulder'],
  ['LeftArm', 'LeftForeArm', 'left_shoulder', 'left_elbow'],
  ['LeftForeArm', 'LeftHand', 'left_elbow', 'left_wrist'],
  ['LeftHand', 'LeftHandMiddle1', 'left_wrist', 'left_hand'],
  ['RightShoulder', 'RightArm', 'right_collar', 'right_shoulder'],
  ['RightArm', 'RightForeArm', 'right_shoulder', 'right_elbow'],
  ['RightForeArm', 'RightHand', 'right_elbow', 'right_wrist'],
  ['RightHand', 'RightHandMiddle1', 'right_wrist', 'right_hand'],
  ['LeftUpLeg', 'LeftLeg', 'left_hip', 'left_knee'],
  ['LeftLeg', 'LeftFoot', 'left_knee', 'left_ankle'],
  ['LeftFoot', 'LeftToeBase', 'left_ankle', 'left_foot'],
  ['RightUpLeg', 'RightLeg', 'right_hip', 'right_knee'],
  ['RightLeg', 'RightFoot', 'right_knee', 'right_ankle'],
  ['RightFoot', 'RightToeBase', 'right_ankle', 'right_foot'],
];

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();

/** An orthonormal frame (matrix) from a side axis and an up axis: x side, y up, z forward. */
function frame(side, up, out) {
  const x = side.clone().normalize();
  const y = up.clone().addScaledVector(x, -up.dot(x)).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return out.makeBasis(x, y, z);
}

/**
 * root: a fresh copy of Prady (its loaded pose is the rest). data: { fps, names, frames, joints }.
 * opts.floor: [start, end] seconds. The hips' height is then measured from the floor under that
 * span (its lowest ankle) instead of from the take's first frame. Handheld takes drift, and their
 * first frame is often not someone standing (Mixkit 1222 starts half out of shot).
 * opts.air: { from, to, speed = 1 } seconds of flight (take-off to touch-down) inside that span.
 * Monocular capture loses height in the air, so the hips fly a ballistic arc there: the floor is
 * measured before and after the jump (it drifts) and blended across it, and the rise is g·T²/8
 * for the real flight time T = (to - from) / speed (speed: the take's slow motion).
 * Returns an AnimationClip on root's bones (local quaternions; hips position).
 */
export function jointsToClip(root, data, name = 'video', opts = {}) {
  root.updateMatrixWorld(true);
  const B = {};
  for (const k of ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'RightShoulder', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'LeftFoot', 'RightLeg', 'RightFoot']) B[k] = findBone(root, k);
  const bones = [];
  root.traverse((o) => o.isBone && bones.push(o));
  const rest = new Map(bones.map((b) => [b, { q: b.quaternion.clone(), p: b.position.clone() }]));
  const J = (f, n) => {
    const i = data.names.indexOf(n);
    const o = (f * data.names.length + i) * 3;
    return new THREE.Vector3(data.joints[o], data.joints[o + 1], data.joints[o + 2]);
  };
  const W = (b) => b.getWorldPosition(new THREE.Vector3());
  // scale: Prady's leg (hip, knee, ankle) over the source's, in its first frame
  const pLeg = W(B.LeftUpLeg).distanceTo(W(B.LeftLeg)) + W(B.LeftLeg).distanceTo(W(B.LeftFoot));
  const sLeg = J(0, 'left_hip').distanceTo(J(0, 'left_knee')) + J(0, 'left_knee').distanceTo(J(0, 'left_ankle'));
  const s = pLeg / sLeg;
  // the hips' rest frame (Prady) and world placement
  const restHipsQ = B.Hips.getWorldQuaternion(new THREE.Quaternion());
  const restHipsP = W(B.Hips);
  const pFrame = frame(W(B.LeftUpLeg).sub(W(B.RightUpLeg)), W(B.Spine).sub(W(B.Hips)), new THREE.Matrix4());
  const pFrameInv = pFrame.clone().invert();
  const pel0 = J(0, 'pelvis');
  // the hips' height above the floor per frame, in source metres (opts.floor; null: from frame 0)
  let above = null;
  if (opts.floor) {
    const fr = (t) => Math.max(0, Math.min(data.frames - 1, Math.round(t * data.fps)));
    const lowest = (a, b) => {
      let lo = Infinity;
      for (let f = fr(a); f <= fr(b); f++) lo = Math.min(lo, J(f, 'left_ankle').y, J(f, 'right_ankle').y);
      return lo;
    };
    const air = opts.air;
    const lo0 = lowest(opts.floor[0], air ? air.from : opts.floor[1]);
    const lo1 = air ? lowest(air.to, opts.floor[1]) : lo0;
    above = [];
    for (let f = 0; f < data.frames; f++) {
      const u = air ? THREE.MathUtils.clamp((f / data.fps - air.from) / (air.to - air.from), 0, 1) : 0;
      above.push(J(f, 'pelvis').y - THREE.MathUtils.lerp(lo0, lo1, u));
    }
    if (air) {
      const a = fr(air.from), b = fr(air.to);
      const T = (air.to - air.from) / (air.speed || 1);
      const rise = (9.81 * T * T) / 8;
      for (let f = a; f <= b; f++) {
        const u = (f - a) / Math.max(1, b - a);
        above[f] = THREE.MathUtils.lerp(above[a], above[b], u) + 4 * rise * u * (1 - u);
      }
    }
  }
  const footY = W(B.LeftFoot).y;
  const times = [];
  const quats = new Map(bones.map((b) => [b, []]));
  const hipPos = [];
  for (let f = 0; f < data.frames; f++) {
    for (const b of bones) {
      b.quaternion.copy(rest.get(b).q);
      b.position.copy(rest.get(b).p);
    }
    root.updateMatrixWorld(true);
    // the hips: the source pelvis frame relative to Prady's
    const sFrame = frame(J(f, 'left_hip').sub(J(f, 'right_hip')), J(f, 'spine1').sub(J(f, 'pelvis')), new THREE.Matrix4());
    const want = new THREE.Quaternion().setFromRotationMatrix(_m.multiplyMatrices(sFrame, pFrameInv)).multiply(restHipsQ);
    B.Hips.parent.getWorldQuaternion(_q);
    B.Hips.quaternion.copy(_q.invert().multiply(want));
    // moved with the pelvis
    const world = restHipsP.clone().add(J(f, 'pelvis').sub(pel0).multiplyScalar(s));
    // (on a measured floor: the source's ankle on it maps to Prady's ankle at rest)
    if (above) world.y = footY + above[f] * s;
    B.Hips.position.copy(B.Hips.parent.worldToLocal(world));
    B.Hips.updateMatrixWorld(true);
    for (const a of AIM) {
      if (a === 'chest') {
        // the chest's twist to the shoulder line, about the spine's own axis
        const axis = W(B.Neck).sub(W(B.Spine2)).normalize();
        twistToward(B.Spine2, axis, B.LeftShoulder, B.RightShoulder, J(f, 'left_collar').sub(J(f, 'right_collar')));
        continue;
      }
      const [bn, cn, j0, j1] = a;
      const bone = B[bn] || (B[bn] = findBone(root, bn));
      const child = B[cn] || (B[cn] = findBone(root, cn));
      if (!bone || !child) continue;
      _v.copy(J(f, j1)).sub(J(f, j0));
      if (_v.lengthSq() < 1e-10) continue;
      aimBone(bone, child, _w.copy(_v).normalize());
    }
    times.push(f / data.fps);
    for (const b of bones) quats.get(b).push(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    hipPos.push(B.Hips.position.x, B.Hips.position.y, B.Hips.position.z);
  }
  for (const b of bones) {
    b.quaternion.copy(rest.get(b).q);
    b.position.copy(rest.get(b).p);
  }
  root.updateMatrixWorld(true);
  const tracks = bones.map((b) => new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, quats.get(b)));
  tracks.push(new THREE.VectorKeyframeTrack(`${B.Hips.name}.position`, times, hipPos));
  return new THREE.AnimationClip(name, times.at(-1), tracks);
}
