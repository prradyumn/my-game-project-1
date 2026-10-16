// Carries the Asuras' motions (the enemy packs, made for the crowd body's skeleton) onto a villain
// body sculpted in Blender (tools/blender/villain.py: the same skeleton, other proportions).
// Open http://localhost:5173/tools/villains.html?v=<villain> — the clips are exposed as
// window.__bake (JSON); tools/bake-villains.mjs saves them.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { ASSET_MANIFEST } from '../src/core/Assets.js';
import { BVHLoader } from 'three/addons/loaders/BVHLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { solveTwoBone } from '../src/utils/bones.js';
import { bipedKey, cmuKey, retargetClip } from '../src/gameplay/Retarget.js';

const v = new URLSearchParams(location.search).get('v') || 'rakshasa';
const src = new URLSearchParams(location.search).get('src') || `/source-assets/villains/${v}.glb`;
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const E = ASSET_MANIFEST.enemies;
const [body, ...packs] = await Promise.all([E.body, E.packBase, E.pack, E.pack2].map((u) => loader.loadAsync(u)));
// ('person': the crowd body itself, its own clips steadied: the Asuras that keep that body)
const villain = v === 'person' ? await loader.loadAsync(E.body) : await loader.loadAsync(src);
const clips = new Map();
for (const g of packs) for (const c of g.animations) clips.set(c.name, c);
// Their feet: the enemy pack's walk was a CMU "weird walk" (bent double at the hips, 136_01), its
// sidestep a crouched sneak (139_15), its idle a "devil" bent double, rump out, rocking (55_23:
// the twerk), and there was no run (the walk sped up to 1.8x, sliding): a cripple's gait. Now
// plain, clean locomotion carried onto the crowd body first (the same one the pack was made
// for): Prady's own Mixamo idle, walk and run, and real sidesteps (CMU 69, the performer of his
// turns on the spot; 69_48 to the right, 69_59 to the left). The idle is crouched into a
// fighter's stance (stance() below); the game adds the predator's hunch on top (Asuras.js).
const LOCO = [
  { name: 'asuraIdle', xbot: 'idle' },
  { name: 'asuraWalk', xbot: 'walk' },
  { name: 'asuraRun', xbot: 'run' },
  { name: 'asuraStrafeR', cmu: '69_48', start: 1.0, end: 2.0, loopBlend: 0.2 },
  { name: 'asuraStrafeL', cmu: '69_59', start: 3.25, end: 5.25, loopBlend: 0.3 },
];
// The brutes (the Rakshasa, Andhaka) move like what they are: Mixamo's mutant (Adobe; royalty-free
// in a game, source-assets/mixamo/clips): a heavy, swaggering walk, a lumbering run, a breathing
// idle with the shoulders rolling, a roar. They replace the plain ones above for those bodies.
const MUTANT = { rakshasa: 1, andhaka: 1 };
if (MUTANT[v]) {
  const swap = { asuraIdle: { fbx: 'mutantIdle', loopBlend: 0.4 }, asuraWalk: { fbx: 'mutantWalk', loopBlend: 0.2 }, asuraRun: { fbx: 'mutantRun', loopBlend: 0.15 } };
  for (const m of LOCO) if (swap[m.name]) Object.assign(m, { xbot: null }, swap[m.name]);
  LOCO.push({ name: 'asuraRoar', fbx: 'mutantRoar' });
}
{
  const xbot = await loader.loadAsync('/source-assets/mixamo/Xbot.glb');
  body.scene.updateMatrixWorld(true);
  for (const m of LOCO) {
    let src;
    if (m.fbx) {
      const fbx = await new FBXLoader().loadAsync(`/source-assets/mixamo/clips/${m.fbx}.fbx`);
      fbx.updateMatrixWorld(true);
      src = { root: fbx, clip: fbx.animations[0] };
    } else if (m.xbot) src = { root: xbot.scene, clip: xbot.animations.find((c) => c.name === m.xbot) };
    else {
      const res = new BVHLoader().parse(await (await fetch(`/source-assets/cmu/${m.cmu}.bvh`)).text());
      const root = new THREE.Group();
      root.add(res.skeleton.bones[0]);
      src = { root, clip: res.clip, keyOf: cmuKey, restTime: 0, start: m.start, end: m.end };
    }
    const c = retargetClip(src, body.scene, { fps: 30, name: m.name, targetKeyOf: bipedKey, inPlace: m.name !== 'asuraRoar', rootYaw: !!m.cmu, loopBlend: m.loopBlend ?? 0, faceForward: true, staticKeys: /Hand(Thumb|Index|Middle|Ring|Pinky)|Finger/ });
    clips.set(m.name, c);
  }
}
// only what a role plays (Assets.js enemies.roles), each clip once
const names = new Set();
for (const list of Object.values(E.roles)) for (const n of list) if (clips.has(n.replace(/^-/, ''))) names.add(n.replace(/^-/, ''));
// The villains keep the crowd body's bone frames exactly (only lengths change), so the clips
// transfer joint for joint: every rotation as it is. Only the pelvis is re-expressed: on the
// crowd body it hangs under a rotated 'Bip01' node in centimetres, on a villain under the
// armature root in metres. (A general retarget through the rest poses lost the knees' bend in
// the crouching clips: the villains stood straight-legged and bent at the waist.)
const srcPelvis = body.scene.getObjectByName('Bip01_Pelvis');
const tgtPelvis = villain.scene.getObjectByName('Bip01_Pelvis');
body.scene.updateMatrixWorld(true);
villain.scene.updateMatrixWorld(true);
// parent frames relative to each character's root: crowd (Bip01, scaled) -> villain (armature root)
const relTo = (o, root) => new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(o.matrixWorld);
const Ms = relTo(srcPelvis.parent, body.scene);
const Mt = relTo(tgtPelvis.parent, villain.scene);
const M = new THREE.Matrix4().copy(Mt).invert().multiply(Ms); // source parent space -> target parent space
const qS = new THREE.Quaternion();
const qT = new THREE.Quaternion();
new THREE.Matrix4().extractRotation(Ms).decompose(new THREE.Vector3(), qS, new THREE.Vector3());
new THREE.Matrix4().extractRotation(Mt).decompose(new THREE.Vector3(), qT, new THREE.Vector3());
const qFix = qT.clone().invert().multiply(qS);
const have = new Set();
villain.scene.traverse((o) => o.isBone && have.add(o.name));
const out = [];
for (const name of names) {
  const c = clips.get(name).clone();
  c.tracks = c.tracks.filter((t) => have.has(t.name.split('.')[0]));
  for (const t of c.tracks) {
    if (t.name === 'Bip01_Pelvis.quaternion') {
      const q = new THREE.Quaternion();
      for (let i = 0; i < t.values.length; i += 4) {
        q.fromArray(t.values, i).premultiply(qFix);
        q.toArray(t.values, i);
      }
    } else if (t.name === 'Bip01_Pelvis.position') {
      const v = new THREE.Vector3();
      for (let i = 0; i < t.values.length; i += 3) {
        v.fromArray(t.values, i).applyMatrix4(M);
        v.toArray(t.values, i);
      }
    }
  }
  out.push(c);
}
// Steadier hips in the loops that play through every fight. The enemy pack's idle rocks the
// pelvis through ~45 degrees every 2.2 s and its sidestep (the circling) ~43: on a man's body that
// read as a brawler's crouch, on a demon's narrow-waisted one as twerking. Per frame the pelvis
// keeps only part of its swing about its mean (the spine and the whole upper body come with it),
// and each leg is solved again so the feet stay exactly where the take put them.
// (keep: how much of the pelvis's swing stays; spine: of the spine's own lurch, in the idle)
const STEADY = {};
function steady(clip, { keep, spine = 1 }) {
  const root = SkeletonUtils.clone(villain.scene);
  root.updateMatrixWorld(true);
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(clip).play();
  const B = (n) => root.getObjectByName(n);
  const pelvis = B('Bip01_Pelvis');
  const legs = ['L', 'R'].map((s) => [B(`Bip01_${s}_Thigh`), B(`Bip01_${s}_Calf`), B(`Bip01_${s}_Foot`)]);
  const fps = 30;
  const n = Math.max(2, Math.round(clip.duration * fps) + 1);
  const times = Array.from({ length: n }, (_, i) => Math.min(clip.duration, i / fps));
  // each steadied bone's mean orientation over the loop (the pelvis; the spine, if asked)
  const spines = spine < 1 ? ['Spine', 'Spine1', 'Spine2'].map((n) => B(`Bip01_${n}`)).filter(Boolean) : [];
  const steadied = [[pelvis, keep], ...spines.map((b) => [b, spine])];
  const means = new Map();
  const q = new THREE.Quaternion();
  for (const [b] of steadied) {
    const sum = new THREE.Vector4();
    let ref = null;
    for (const t of times) {
      mixer.setTime(t);
      q.copy(b.quaternion);
      if (ref && q.dot(ref) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      ref ||= q.clone();
      sum.x += q.x; sum.y += q.y; sum.z += q.z; sum.w += q.w;
    }
    means.set(b, new THREE.Quaternion(sum.x, sum.y, sum.z, sum.w).normalize());
  }
  const out = new Map([[pelvis, []], ...spines.map((b) => [b, []]), ...legs.flat().map((b) => [b, []])]);
  const fwd = new THREE.Vector3(0, 0, 1);
  const ank = legs.map(() => new THREE.Vector3());
  const footQ = legs.map(() => new THREE.Quaternion());
  const pq = new THREE.Quaternion();
  for (const t of times) {
    mixer.setTime(t);
    root.updateMatrixWorld(true);
    legs.forEach(([, , f], i) => {
      f.getWorldPosition(ank[i]);
      f.getWorldQuaternion(footQ[i]);
    });
    for (const [b, k] of steadied) {
      q.copy(b.quaternion); // (the take's own, before it is steadied)
      b.quaternion.copy(means.get(b)).slerp(q, k);
    }
    root.updateMatrixWorld(true);
    legs.forEach(([th, ca, f], i) => {
      solveTwoBone(th, ca, f, ank[i], fwd, 1);
      f.parent.getWorldQuaternion(pq);
      f.quaternion.copy(pq.invert().multiply(footQ[i]));
      f.updateMatrixWorld(true);
    });
    for (const [b, arr] of out) arr.push(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
  }
  const names = new Set([...out.keys()].map((b) => `${b.name}.quaternion`));
  clip.tracks = clip.tracks.filter((t) => !names.has(t.name));
  for (const [b, arr] of out) clip.tracks.push(new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, arr));
  mixer.stopAllAction();
}
for (const c of out) if (STEADY[c.name]) steady(c, STEADY[c.name]);

// A fighter's stance laid over a quiet idle: hips down, knees bent, chest over them, elbows out
// and the claws up in front of it. The feet stay exactly where the take put them (the legs are
// solved again), so it breathes and shifts without a foot moving. drop: of the leg's length;
// angles in radians.
function stance(clip, { drop = 0.1, lean = 0.45, spread = 0.3, fore = 0.55, raise = 1.2, out = -0.3, wrist = 0.35 } = {}) {
  const root = SkeletonUtils.clone(villain.scene);
  root.updateMatrixWorld(true);
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(clip).play();
  const B = (n) => root.getObjectByName(`Bip01_${n}`);
  const pelvis = B('Pelvis');
  const legs = ['L', 'R'].map((s) => [B(`${s}_Thigh`), B(`${s}_Calf`), B(`${s}_Foot`)]);
  const spines = ['Spine', 'Spine1', 'Spine2'].map(B).filter(Boolean);
  const neckHead = ['Neck', 'Head'].map(B).filter(Boolean);
  const arms = ['L', 'R'].map((s) => ({ s: s === 'L' ? 1 : -1, up: B(`${s}_UpperArm`), fore: B(`${s}_Forearm`), hand: B(`${s}_Hand`) }));
  // (the character faces +Z: X is its left, Z ahead)
  const X = new THREE.Vector3(1, 0, 0);
  const Y = new THREE.Vector3(0, 1, 0);
  const Z = new THREE.Vector3(0, 0, 1);
  const wq = new THREE.Quaternion();
  const pq = new THREE.Quaternion();
  const aq = new THREE.Quaternion();
  const rot = (b, axis, a) => {
    b.getWorldQuaternion(wq);
    b.parent.getWorldQuaternion(pq);
    wq.premultiply(aq.setFromAxisAngle(axis, a));
    b.quaternion.copy(pq.invert().multiply(wq));
    b.updateMatrixWorld(true);
  };
  const legLen = legs[0][0].getWorldPosition(new THREE.Vector3()).distanceTo(legs[0][2].getWorldPosition(new THREE.Vector3()));
  const fps = 30;
  const n = Math.max(2, Math.round(clip.duration * fps) + 1);
  const times = Array.from({ length: n }, (_, i) => Math.min(clip.duration, i / fps));
  const touched = [pelvis, ...spines, ...neckHead, ...legs.flat(), ...arms.flatMap((a) => [a.up, a.fore, a.hand]).filter(Boolean)];
  const outQ = new Map(touched.map((b) => [b, []]));
  const outP = [];
  const ank = legs.map(() => new THREE.Vector3());
  const footQ = legs.map(() => new THREE.Quaternion());
  const fwd = new THREE.Vector3(0, 0, 1);
  const wp = new THREE.Vector3();
  for (const t of times) {
    mixer.setTime(t);
    root.updateMatrixWorld(true);
    legs.forEach(([, , f], i) => {
      f.getWorldPosition(ank[i]);
      f.getWorldQuaternion(footQ[i]);
    });
    // hips down (in world, back into the pelvis's parent space)
    pelvis.getWorldPosition(wp);
    wp.y -= drop * legLen;
    pelvis.position.copy(pelvis.parent.worldToLocal(wp));
    pelvis.updateMatrixWorld(true);
    // the chest over the knees, the head brought back up to look ahead
    for (const b of spines) rot(b, X, lean / spines.length);
    for (const b of neckHead) rot(b, X, (-lean * 0.45));
    // elbows out, forearms up and forward, the claws cocked
    for (const a of arms) {
      if (a.up) rot(a.up, Z, a.s * spread);
      if (a.up) rot(a.up, X, -fore);
      if (a.fore) rot(a.fore, X, -raise);
      if (a.fore) rot(a.fore, Y, a.s * out);
      if (a.hand) rot(a.hand, X, wrist);
    }
    root.updateMatrixWorld(true);
    legs.forEach(([th, ca, f], i) => {
      solveTwoBone(th, ca, f, ank[i], fwd, 1);
      f.parent.getWorldQuaternion(pq);
      f.quaternion.copy(pq.invert().multiply(footQ[i]));
      f.updateMatrixWorld(true);
    });
    for (const [b, arr] of outQ) arr.push(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    outP.push(pelvis.position.x, pelvis.position.y, pelvis.position.z);
  }
  const names = new Set([...[...outQ.keys()].map((b) => `${b.name}.quaternion`), `${pelvis.name}.position`]);
  clip.tracks = clip.tracks.filter((t) => !names.has(t.name));
  for (const [b, arr] of outQ) clip.tracks.push(new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, arr));
  clip.tracks.push(new THREE.VectorKeyframeTrack(`${pelvis.name}.position`, times, outP));
  mixer.stopAllAction();
}
const STANCE = new URLSearchParams(location.search).get('stance');
for (const c of out) if (c.name === 'asuraIdle' && !MUTANT[v]) stance(c, STANCE ? JSON.parse(STANCE) : {});
// Each loop's own pace on this body (m/s at speed 1): the planted foot's speed under the hips,
// along the way it travels. The game plays it at the speed it really moves, so no foot slides.
function pace(clip, axis) {
  const root = SkeletonUtils.clone(villain.scene);
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(clip).play();
  const feet = ['L', 'R'].map((s) => root.getObjectByName(`Bip01_${s}_Foot`));
  const n = Math.round(clip.duration * 60);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  // (the floor: the lowest a foot gets; a foot within 2 cm of it is standing on it)
  let floor = Infinity;
  for (let i = 0; i <= n; i++) {
    mixer.setTime((clip.duration * i) / n);
    root.updateMatrixWorld(true);
    for (const f of feet) floor = Math.min(floor, f.getWorldPosition(a).y);
  }
  let sum = 0;
  let w = 0;
  let prev = null;
  for (let i = 0; i <= n; i++) {
    mixer.setTime((clip.duration * i) / n);
    root.updateMatrixWorld(true);
    feet[0].getWorldPosition(a);
    feet[1].getWorldPosition(b);
    const low = a.y < b.y ? a : b;
    const cur = { y: Math.min(a.y, b.y), p: low[axis], k: low === a ? 0 : 1 };
    // (only while one foot is clearly the one on the ground, and the same one as the last frame)
    if (prev && prev.k === cur.k && cur.y < floor + 0.02 && prev.y < floor + 0.02) {
      sum += Math.abs(cur.p - prev.p);
      w += clip.duration / n;
    }
    prev = cur;
  }
  mixer.stopAllAction();
  return w ? +(sum / w).toFixed(3) : null;
}
const speeds = {};
for (const c of out) {
  if (c.name === 'asuraWalk' || c.name === 'asuraRun') speeds[c.name] = pace(c, 'z');
  if (c.name === 'asuraStrafeR' || c.name === 'asuraStrafeL') speeds[c.name] = pace(c, 'x');
}
window.__bake = JSON.stringify({ source: `Asura motions (tools/people.js packs; locomotion: Mixamo walk/run, CMU 69_48/69_59 sidesteps) carried onto ${v} joint for joint`, speeds, clips: out.map((c) => THREE.AnimationClip.toJSON(c)) });
document.getElementById('info').textContent = `baked ${out.length} clips for ${v}: ${out.map((c) => `${c.name} ${c.duration.toFixed(2)}s`).join(', ')}; speeds ${JSON.stringify(speeds)}`;
