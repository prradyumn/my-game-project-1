// Carries the Asuras' motions (the enemy packs, made for the crowd body's skeleton) onto a villain
// body sculpted in Blender (tools/blender/villain.py: the same skeleton, other proportions).
// Open http://localhost:5173/tools/villains.html?v=<villain> — the clips are exposed as
// window.__bake (JSON); tools/bake-villains.mjs saves them.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { ASSET_MANIFEST } from '../src/core/Assets.js';
import { solveTwoBone } from '../src/utils/bones.js';

const v = new URLSearchParams(location.search).get('v') || 'rakshasa';
const src = new URLSearchParams(location.search).get('src') || `/source-assets/villains/${v}.glb`;
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const E = ASSET_MANIFEST.enemies;
const [body, ...packs] = await Promise.all([E.body, E.packBase, E.pack, E.pack2].map((u) => loader.loadAsync(u)));
// ('person': the crowd body itself, its own clips steadied: the Asuras that keep that body)
const villain = v === 'person' ? await loader.loadAsync(E.body) : await loader.loadAsync(src);
const clips = new Map();
for (const g of packs) for (const c of g.animations) clips.set(c.name, c);
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
const STEADY = { asuraIdle: { keep: 0.3, spine: 0.5 }, asuraStrafeR: { keep: 0.3 }, asuraWalk: { keep: 0.6 } };
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
window.__bake = JSON.stringify({ source: `Asura motions (tools/people.js packs) carried onto ${v} joint for joint`, clips: out.map((c) => THREE.AnimationClip.toJSON(c)) });
document.getElementById('info').textContent = `baked ${out.length} clips for ${v}: ${out.map((c) => `${c.name} ${c.duration.toFixed(2)}s`).join(', ')}`;
