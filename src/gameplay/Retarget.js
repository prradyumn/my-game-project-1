import * as THREE from 'three';

// Motion retargeting between humanoid skeletons with different bone NAMES, AXES and rest poses
// (Mixamo Xbot: identity bones in a T-pose; CMU BVH: MotionBuilder names, T-pose on frame 0;
// Rocketbox: 3ds Max Biped "Bip01 ..." bones in an A-pose; Prady: Uthana bones in an A-pose
// with bent elbows). Every skeleton is mapped onto canonical Mixamo keys (Hips, Spine, ...,
// LeftForeArm, ...) and then:
//
//   torso / head / legs / feet / fingers   rest-relative WORLD delta:
//        q_tgt = (q_src * q_srcRest^-1) * q_tgtRest            (both in character space)
//   limbs (arm, forearm, hand, thigh, shin) then get their exact DIRECTION from the source:
//        swing the bone so (child - bone) points where the source's does (minimal rotation,
//        keeps the twist from the delta step). This removes any A-pose / T-pose mismatch.
//   hips translation  rest-relative offset scaled by the leg-length ratio (optionally in place).
//
// Output: a baked AnimationClip (local quaternions + hips position) for the target skeleton,
// optionally trimmed and blended into a seamless loop.

const AIM_CHAINS = [
  ['LeftArm', 'LeftForeArm'],
  ['LeftForeArm', 'LeftHand'],
  ['LeftHand', 'LeftHandMiddle1'],
  ['RightArm', 'RightForeArm'],
  ['RightForeArm', 'RightHand'],
  ['RightHand', 'RightHandMiddle1'],
  ['LeftUpLeg', 'LeftLeg'],
  ['LeftLeg', 'LeftFoot'],
  ['RightUpLeg', 'RightLeg'],
  ['RightLeg', 'RightFoot'],
];

// ---------------------------------------------------------------- skeleton name maps
export const mixamoKey = (name) => name.replace(/^mixamorig:?/, '');

// CMU BVH (MotionBuilder-friendly release): Hips > LowerBack > Spine > Spine1 > Neck > Neck1 > Head
const CMU = { LowerBack: 'Spine', Spine: 'Spine1', Spine1: 'Spine2', LeftHandIndex1: 'LeftHandMiddle1', RightHandIndex1: 'RightHandMiddle1', LThumb: 'LeftHandThumb1', RThumb: 'RightHandThumb1' };
const CMU_SKIP = new Set(['LHipJoint', 'RHipJoint', 'Neck1', 'LeftFingerBase', 'RightFingerBase']);
export const cmuKey = (name) => (CMU_SKIP.has(name) ? null : CMU[name] || name);

// 3ds Max Biped (Microsoft Rocketbox): Bip01_Pelvis, Bip01_L_UpperArm, Bip01_L_Finger21 ...
const BIP = {
  Pelvis: 'Hips', Spine: 'Spine', Spine1: 'Spine1', Spine2: 'Spine2', Neck: 'Neck', Head: 'Head',
  L_Clavicle: 'LeftShoulder', L_UpperArm: 'LeftArm', L_Forearm: 'LeftForeArm', L_Hand: 'LeftHand',
  R_Clavicle: 'RightShoulder', R_UpperArm: 'RightArm', R_Forearm: 'RightForeArm', R_Hand: 'RightHand',
  L_Thigh: 'LeftUpLeg', L_Calf: 'LeftLeg', L_Foot: 'LeftFoot', L_Toe0: 'LeftToeBase',
  R_Thigh: 'RightUpLeg', R_Calf: 'RightLeg', R_Foot: 'RightFoot', R_Toe0: 'RightToeBase',
};
const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
export const bipedKey = (name) => {
  const n = name.replace(/^Bip01[_ ]/, '').replace(/ /g, '_');
  if (BIP[n]) return BIP[n];
  const m = n.match(/^([LR])_Finger(\d)(\d?)$/);
  if (m) return `${m[1] === 'L' ? 'Left' : 'Right'}Hand${FINGERS[+m[2]]}${m[3] ? +m[3] + 1 : 1}`;
  return null;
};

function boneMap(root, keyOf) {
  const m = new Map();
  root.traverse((o) => {
    if (!o.isBone) return;
    const k = keyOf(o.name);
    if (k && !m.has(k)) m.set(k, o);
  });
  return m;
}

// Bones ordered parents-first.
function ordered(root) {
  const out = [];
  root.traverse((o) => {
    if (o.isBone) out.push(o);
  });
  return out;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

function charQuat(bone, rootInvQ, out) {
  bone.getWorldQuaternion(out);
  return out.premultiply(rootInvQ);
}
function charPos(bone, rootInvM, out) {
  return bone.getWorldPosition(out).applyMatrix4(rootInvM);
}

/**
 * @param src  { root, clip, keyOf?, restTime?, start?, end?, restHipY? }
 *             root: source character (Object3D); keyOf maps bone names -> Mixamo keys;
 *             restTime: clip time that shows the source's rest (T-)pose (default: pose as loaded);
 *             start/end: trim (seconds); restHipY: the actor's STANDING hip height (source
 *             units) when the rest frame was recorded somewhere else (CMU 111_06 starts lying on
 *             the floor: its T-pose frame sits at the lying hip height, so every pose would come
 *             out ~0.7 m too high)
 * @param tgtRoot  target character root (its skeleton must be in its rest pose now)
 * @param opts { fps = 30, name, targetKeyOf, inPlace = false, loopBlend = 0 (seconds),
 *               faceForward = false (turn the take so the actor faces +Z on average),
 *               pitch = 0 (extra turn about the character's X axis, radians: e.g. -PI/2 stands a
 *                          take captured lying face down, like the CMU swimmers, upright),
 *               lockY = false (keep the hips at their rest height: no vertical root motion),
 *               rootMotion = false (with inPlace: keep the removed horizontal hip path in
 *               clip.userData.rootMotion as [x, z] per frame, in hip-above-foot heights, for the game to
 *               move the character by: a lunge plants its feet instead of sliding),
 *               staticKeys = RegExp of keys stored as a held pose (e.g. fingers) }
 */
export function retargetClip(src, tgtRoot, opts = {}) {
  const fps = opts.fps ?? 30;
  const srcKey = src.keyOf || mixamoKey;
  const tgtKey = opts.targetKeyOf || mixamoKey;
  const srcRoot = src.root;
  const S = boneMap(srcRoot, srcKey);
  const T = boneMap(tgtRoot, tgtKey);
  const tBones = ordered(tgtRoot).filter((b) => {
    const k = tgtKey(b.name);
    return k && T.get(k) === b && S.has(k);
  });
  const hips = { s: S.get('Hips'), t: T.get('Hips') };

  const mixer = new THREE.AnimationMixer(srcRoot);
  mixer.clipAction(src.clip).play();
  if (typeof src.restTime === 'number') mixer.setTime(src.restTime);

  srcRoot.updateMatrixWorld(true);
  tgtRoot.updateMatrixWorld(true);
  const sInvM = srcRoot.matrixWorld.clone().invert();
  const tInvM = tgtRoot.matrixWorld.clone().invert();
  const sInvQ = srcRoot.getWorldQuaternion(new THREE.Quaternion()).invert();
  const tInvQ = tgtRoot.getWorldQuaternion(new THREE.Quaternion()).invert();

  // --- rest poses (target: node transforms as loaded; never Skeleton.pose(), which writes
  // bind-space matrices into the root bone and double-applies the armature transform)
  const restS = new Map();
  const restT = new Map();
  for (const tb of tBones) {
    const k = tgtKey(tb.name);
    restS.set(k, charQuat(S.get(k), sInvQ, new THREE.Quaternion()));
    restT.set(k, charQuat(tb, tInvQ, new THREE.Quaternion()));
  }
  const restLocalT = new Map(tBones.map((b) => [b, b.quaternion.clone()]));
  const sHip0 = charPos(hips.s, sInvM, new THREE.Vector3());
  const tHip0 = charPos(hips.t, tInvM, new THREE.Vector3());
  const tHipLocal0 = hips.t.position.clone();
  const sFoot = charPos(S.get('LeftFoot'), sInvM, new THREE.Vector3());
  const tFoot = charPos(T.get('LeftFoot'), tInvM, new THREE.Vector3());
  const ratio = (tHip0.y - tFoot.y) / Math.max(1e-6, sHip0.y - sFoot.y);
  // (after the leg-length ratio, which the rest frame still measures correctly)
  if (typeof src.restHipY === 'number') sHip0.y = src.restHipY;

  const start = Math.max(0, src.start ?? 0);
  const end = Math.min(src.clip.duration, src.end ?? src.clip.duration);
  const duration = Math.max(1 / fps, end - start);

  // Turn the take so the actor faces +Z on average (mocap actors face wherever the scene had
  // them face). Measured from the hip line: forward = (left hip - right hip) x up.
  const yawFix = new THREE.Quaternion();
  if (opts.faceForward && S.get('LeftUpLeg') && S.get('RightUpLeg')) {
    let fx = 0;
    let fz = 0;
    for (let t = start; t <= end; t += 0.25) {
      mixer.setTime(t);
      srcRoot.updateMatrixWorld(true);
      const l = charPos(S.get('LeftUpLeg'), sInvM, new THREE.Vector3());
      const r = charPos(S.get('RightUpLeg'), sInvM, new THREE.Vector3());
      const lr = l.sub(r);
      fx += -lr.z; // (lr x up).x  = -lr.z
      fz += lr.x; //  (lr x up).z  =  lr.x
    }
    yawFix.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.atan2(fx, fz));
  }
  if (opts.pitch) yawFix.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), opts.pitch));
  const frames = Math.max(2, Math.round(duration * fps) + 1);
  const times = [];
  const qData = new Map(tBones.map((b) => [b, []]));
  const hipData = [];
  const rootPath = [];
  const legT = Math.max(1e-6, tHip0.y - tFoot.y); // hip height above the foot, target units

  for (let f = 0; f < frames; f++) {
    const tt = Math.min(duration, f / fps);
    times.push(tt);
    mixer.setTime(start + tt);
    srcRoot.updateMatrixWorld(true);

    // 1) rest-relative world deltas, parents first
    for (const tb of tBones) {
      const k = tgtKey(tb.name);
      const sq = charQuat(S.get(k), sInvQ, _q).premultiply(yawFix);
      const delta = sq.multiply(_q2.copy(restS.get(k)).invert());
      const want = delta.multiply(restT.get(k));
      const parentQ = charQuat(tb.parent, tInvQ, new THREE.Quaternion());
      tb.quaternion.copy(parentQ.invert().multiply(want));
      tb.updateMatrixWorld(true);
    }

    // 2) hips translation (rest-relative, scaled, optionally in place)
    const sh = charPos(hips.s, sInvM, _a);
    const off = _b.subVectors(sh, sHip0).applyQuaternion(yawFix).multiplyScalar(ratio);
    if (opts.rootMotion) rootPath.push(off.x / legT, off.z / legT);
    if (opts.inPlace) off.x = off.z = 0;
    if (opts.lockY) off.y = 0;
    const wantWorld = _v.copy(tHip0).add(off).applyMatrix4(tgtRoot.matrixWorld);
    hips.t.parent.updateMatrixWorld(true);
    _m.copy(hips.t.parent.matrixWorld).invert();
    hips.t.position.copy(wantWorld.applyMatrix4(_m));
    hips.t.updateMatrixWorld(true);

    // 3) exact limb directions
    for (const [bName, cName] of AIM_CHAINS) {
      const tb = T.get(bName);
      const tc = T.get(cName);
      const sb = S.get(bName);
      const sc = S.get(cName);
      if (!tb || !tc || !sb || !sc || !qData.has(tb)) continue;
      const sDir = charPos(sc, sInvM, new THREE.Vector3()).sub(charPos(sb, sInvM, new THREE.Vector3())).normalize().applyQuaternion(yawFix);
      const tDir = charPos(tc, tInvM, new THREE.Vector3()).sub(charPos(tb, tInvM, new THREE.Vector3())).normalize();
      if (sDir.lengthSq() < 1e-8 || tDir.lengthSq() < 1e-8) continue;
      const r = new THREE.Quaternion().setFromUnitVectors(tDir, sDir);
      const rootQ = tgtRoot.getWorldQuaternion(new THREE.Quaternion());
      const rWorld = rootQ.clone().multiply(r).multiply(rootQ.clone().invert());
      const wq = tb.getWorldQuaternion(new THREE.Quaternion());
      const pq = tb.parent.getWorldQuaternion(new THREE.Quaternion());
      tb.quaternion.copy(pq.invert().multiply(wq.premultiply(rWorld)));
      tb.updateMatrixWorld(true);
    }

    for (const tb of tBones) {
      const arr = qData.get(tb);
      if (arr.length >= 4) {
        const n = arr.length;
        const dot = arr[n - 4] * tb.quaternion.x + arr[n - 3] * tb.quaternion.y + arr[n - 2] * tb.quaternion.z + arr[n - 1] * tb.quaternion.w;
        if (dot < 0) tb.quaternion.set(-tb.quaternion.x, -tb.quaternion.y, -tb.quaternion.z, -tb.quaternion.w);
      }
      arr.push(tb.quaternion.x, tb.quaternion.y, tb.quaternion.z, tb.quaternion.w);
    }
    hipData.push(hips.t.position.x, hips.t.position.y, hips.t.position.z);
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(srcRoot);

  for (const tb of tBones) tb.quaternion.copy(restLocalT.get(tb));
  hips.t.position.copy(tHipLocal0);
  tgtRoot.updateMatrixWorld(true);

  // Seamless loop: ease the last `loopBlend` seconds into the first frame.
  const nBlend = Math.min(frames - 1, Math.round((opts.loopBlend ?? 0) * fps));
  if (nBlend > 1) {
    const qa = new THREE.Quaternion();
    const q0 = new THREE.Quaternion();
    for (const arr of qData.values()) {
      q0.fromArray(arr, 0);
      for (let k = 0; k < nBlend; k++) {
        const i = frames - nBlend + k;
        const w = (k + 1) / nBlend;
        const e = w * w * (3 - 2 * w);
        qa.fromArray(arr, i * 4);
        if (qa.dot(q0) < 0) qa.set(-qa.x, -qa.y, -qa.z, -qa.w);
        qa.slerp(q0, e).toArray(arr, i * 4);
      }
    }
    for (let k = 0; k < nBlend; k++) {
      const i = frames - nBlend + k;
      const w = (k + 1) / nBlend;
      const e = w * w * (3 - 2 * w);
      for (let c = 0; c < 3; c++) hipData[i * 3 + c] += (hipData[c] - hipData[i * 3 + c]) * e;
    }
  }

  const tracks = [];
  for (const tb of tBones) {
    const q = qData.get(tb);
    // held pose (e.g. fingers): two keys with the first frame's value, a fraction of the size
    if (opts.staticKeys && opts.staticKeys.test(tgtKey(tb.name))) {
      tracks.push(new THREE.QuaternionKeyframeTrack(`${tb.name}.quaternion`, [0, duration], [...q.slice(0, 4), ...q.slice(0, 4)]));
    } else tracks.push(new THREE.QuaternionKeyframeTrack(`${tb.name}.quaternion`, times, q));
  }
  tracks.push(new THREE.VectorKeyframeTrack(`${hips.t.name}.position`, times, hipData));
  const clip = new THREE.AnimationClip(opts.name || src.clip.name, duration, tracks);
  if (opts.rootMotion) clip.userData.rootMotion = { fps, path: rootPath.map((v) => Math.round(v * 1e4) / 1e4) };
  return clip;
}
