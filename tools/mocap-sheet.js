// Contact sheet of a CMU take retargeted onto Prady or a crowd avatar: poses laid out left to
// right over time, so a clean segment can be chosen by eye before baking.
//   /tools/mocap-sheet.html?bvh=126_10&target=prady&t0=0&t1=8&n=10&view=side
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BVHLoader } from 'three/addons/loaders/BVHLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { ASSET_MANIFEST } from '../src/core/Assets.js';
import { bipedKey, cmuKey, retargetClip } from '../src/gameplay/Retarget.js';

const q = new URLSearchParams(location.search);
const id = q.get('bvh') || '126_10';
const target = q.get('target') || 'prady';
const n = +(q.get('n') || 10);
const view = q.get('view') || 'side';
const inPlace = q.get('inplace') !== '0';

const r = new THREE.WebGLRenderer({ antialias: true });
r.setSize(innerWidth, innerHeight);
r.outputColorSpace = THREE.SRGBColorSpace;
r.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(r.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x26211c);
scene.add(new THREE.HemisphereLight(0xfff2e0, 0x40342a, 1.7));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(3, 6, 5);
scene.add(sun);

const bvh = new BVHLoader().parse(await (await fetch(`/source-assets/cmu/${id}.bvh`)).text());
const srcRoot = new THREE.Group();
srcRoot.add(bvh.skeleton.bones[0]);
const dur = bvh.clip.duration;
const t0 = +(q.get('t0') || 0);
const t1 = Math.min(dur, +(q.get('t1') || dur));

const gl = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
let tgt;
let keyOf;
if (target === 'prady') {
  tgt = (await gl.loadAsync(ASSET_MANIFEST.character.model)).scene;
} else {
  tgt = (await gl.loadAsync(`/assets/people/${target === 'person' ? 'Male_Adult_15' : target}.glb`)).scene;
  keyOf = bipedKey;
}
tgt.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(tgt, true);
const scale = 1.8 / (box.max.y - box.min.y);
const clip = retargetClip({ root: srcRoot, clip: bvh.clip, keyOf: cmuKey, restTime: 0, start: t0, end: t1 }, tgt, { fps: 30, name: id, targetKeyOf: keyOf, inPlace, faceForward: true, pitch: +(q.get('pitch') || 0), lockY: q.get('locky') === '1' });
const gap = 1.25;
const x0 = -((n - 1) * gap) / 2;
const labels = [];
for (let i = 0; i < n; i++) {
  const t = (clip.duration * i) / Math.max(1, n - 1);
  const m = SkeletonUtils.clone(tgt);
  const holder = new THREE.Group();
  holder.add(m);
  holder.scale.setScalar(scale);
  holder.position.x = x0 + i * gap;
  scene.add(holder);
  const mx = new THREE.AnimationMixer(m);
  mx.clipAction(clip).play();
  mx.setTime(Math.min(t, clip.duration - 1e-3));
  m.traverse((o) => o.isMesh && (o.frustumCulled = false));
  labels.push((t0 + t).toFixed(1));
}
scene.add(new THREE.GridHelper(40, 40, 0x8a7a66, 0x4a4038));
const W = n * gap + 1;
const cam = new THREE.PerspectiveCamera(22, innerWidth / innerHeight, 0.1, 200);
const d = W / (2 * Math.tan(THREE.MathUtils.degToRad(11)) * cam.aspect) + 2;
if (view === 'top') cam.position.set(0, d, 0.01);
else if (view === 'front') cam.position.set(0, 1.0, d);
else cam.position.set(0, 1.2, d);
cam.lookAt(0, view === 'top' ? 0 : 0.8, 0);
r.render(scene, cam);
document.getElementById('l').textContent = `${id} (${dur.toFixed(1)} s)  ${t0}-${t1}s  ${target}\n` + labels.join('      ');
window.__ready = true;
