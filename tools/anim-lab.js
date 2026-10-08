// Animation lab (dev tool): http://localhost:5173/tools/anim-lab.html?clip=walk
// Measures a locomotion clip (speed, stride, cadence, foot contacts, foot slide) and draws an
// onion-skin side view so walk-cycle problems are visible at a glance.
//   ?clip=walk|run     which clip from ASSET_MANIFEST.character.clips
//   ?mode=onion|play   onion = 8 poses along the stride, play = live loop
//   ?game=1            play through the game's CharacterAnimator (in-place + speed)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { ASSET_MANIFEST } from '../src/core/Assets.js';
import { CharacterAnimator } from '../src/gameplay/CharacterAnimator.js';

const params = new URLSearchParams(location.search);
const clipName = params.get('clip') || 'walk';
const mode = params.get('mode') || 'onion';
const info = document.getElementById('info');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a241f);
scene.add(new THREE.HemisphereLight(0xfff2e0, 0x40342a, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(3, 6, 4);
scene.add(sun);
const grid = new THREE.GridHelper(20, 40, 0x8a7a66, 0x4a4038);
scene.add(grid);

const loader = new GLTFLoader();
const M = ASSET_MANIFEST.character;
// ?mocap=walk plays a baked clip from public/assets/characters/prady-mocap.json instead
const mocapName = params.get('mocap');
const [charG, clipG] = await Promise.all([loader.loadAsync(M.model), mocapName ? null : loader.loadAsync(M.clips[clipName])]);
let clip = clipG?.animations[0];
if (mocapName) {
  const j = await (await fetch('/assets/characters/prady-mocap.json')).json();
  clip = THREE.AnimationClip.parse(j.clips.find((c) => c.name === mocapName));
}

function prepare(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root, true);
  const s = M.height / (box.max.y - box.min.y);
  root.scale.multiplyScalar(s);
  root.position.y = -box.min.y * s;
  root.traverse((o) => {
    if (o.isMesh) o.frustumCulled = false;
  });
  return s;
}
const base = charG.scene;
const scale = prepare(base);
const bone = (root, name) => {
  let b = null;
  root.traverse((o) => {
    if (!b && o.isBone && o.name.endsWith(name)) b = o;
  });
  return b;
};

// ------------------------------------------------------------------ analysis
// The Uthana clips are IN PLACE (hips fixed). We measure the stance-foot slide speed, which is
// the speed the body must travel for the planted foot to stand still, then re-sample with that
// travel applied: a good speed match gives ~0 slide during contact.
const FWD = new THREE.Vector3(0, 0, 1); // characters face +Z
function sample(root, c, travelSpeed) {
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(c).play();
  const N = 240;
  const names = ['LeftToeBase', 'RightToeBase', 'LeftFoot', 'RightFoot', 'Hips', 'LeftHand', 'RightHand', 'Head', 'LeftUpLeg'];
  const bones = Object.fromEntries(names.map((n) => [n, bone(root, n)]));
  const S = [];
  const v = new THREE.Vector3();
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * c.duration;
    mixer.setTime(t);
    root.updateMatrixWorld(true);
    const f = { t };
    for (const n of names) f[n] = bones[n] ? bones[n].getWorldPosition(v).clone().addScaledVector(FWD, travelSpeed * t) : null;
    S.push(f);
  }
  mixer.stopAllAction();
  return S;
}
function contactStats(S, dur) {
  const N = S.length - 1;
  const feet = {};
  for (const side of ['Left', 'Right']) {
    const toe = S.map((f) => f[`${side}ToeBase`]);
    const ys = toe.map((p) => p.y);
    const minY = Math.min(...ys);
    const contact = ys.map((y) => y < minY + 0.025);
    let slide = 0;
    let frames = 0;
    let first = -1;
    for (let i = 1; i <= N; i++) {
      if (contact[i] && contact[i - 1]) {
        slide += toe[i].z - toe[i - 1].z;
        frames++;
      }
      if (first < 0 && contact[i] && !contact[i - 1]) first = i / N;
    }
    const ct = (frames / N) * dur;
    feet[side] = { minY: +minY.toFixed(3), contactRatio: +(frames / N).toFixed(2), slideSpeed: +(ct ? slide / ct : 0).toFixed(3), firstContactPhase: +first.toFixed(3), maxLift: +(Math.max(...ys) - minY).toFixed(3) };
  }
  return feet;
}
function analyse(root, c) {
  const S0 = sample(root, c, 0);
  const f0 = contactStats(S0, c.duration);
  const speed = -(f0.Left.slideSpeed + f0.Right.slideSpeed) / 2; // stance feet slide backward at -speed
  const S = sample(root, c, speed);
  const feet = contactStats(S, c.duration);
  const lateral = S.map((f) => f.Hips.x);
  const handZ = S.reduce((a, f) => a + ((f.LeftHand.z + f.RightHand.z) / 2 - f.Hips.z), 0) / S.length;
  const handY = S.reduce((a, f) => a + ((f.LeftHand.y + f.RightHand.y) / 2 - f.Hips.y), 0) / S.length;
  const stepW = S.reduce((a, f) => a + Math.abs(f.LeftToeBase.x - f.RightToeBase.x), 0) / S.length;
  return {
    clip: clipName,
    duration: +c.duration.toFixed(3),
    naturalSpeed: +speed.toFixed(3),
    strideLength: +(speed * c.duration).toFixed(3),
    cadenceStepsPerMin: Math.round((2 / c.duration) * 60),
    hipBob: +(Math.max(...S.map((f) => f.Hips.y)) - Math.min(...S.map((f) => f.Hips.y))).toFixed(3),
    hipSway: +(Math.max(...lateral) - Math.min(...lateral)).toFixed(3),
    handsForwardOfHips: +handZ.toFixed(3),
    handsBelowHips: +(-handY).toFixed(3),
    stepWidth: +stepW.toFixed(3),
    feetAfterSpeedMatch: feet,
    samples: S,
    dir: FWD.clone(),
  };
}

const raw = analyse(base, clip.clone());
const report = { ...raw };
delete report.samples;
delete report.dir;
window.__lab = { report };
info.textContent = `${clipName}\n${JSON.stringify(report, null, 1)}`;

// ------------------------------------------------------------------ views
const cam = new THREE.OrthographicCamera(-4, 4, 2.4, -2.4, 0.1, 100);
if (mode === 'onion') {
  const n = 8;
  const d = raw.dir;
  for (let i = 0; i < n; i++) {
    const c = SkeletonUtils.clone(base);
    scene.add(c);
    const mx = new THREE.AnimationMixer(c);
    mx.clipAction(clip).play();
    mx.setTime((i / n) * clip.duration);
    c.position.addScaledVector(d, raw.naturalSpeed * (i / n) * clip.duration);
    c.traverse((o) => {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.material.transparent = i !== 0;
        o.material.opacity = i === 0 ? 1 : 0.55;
      }
    });
  }
  base.visible = false;
  // foot trails
  for (const [side, col] of [['Left', 0xff7a3a], ['Right', 0x5ad1ff]]) {
    const pts = raw.samples.map((f) => f[`${side}ToeBase`]);
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: col })));
  }
  const hp = raw.samples.map((f) => f.Hips);
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(hp), new THREE.LineBasicMaterial({ color: 0xffe08a })));
  const mid = raw.samples[Math.floor(raw.samples.length / 2)].Hips;
  const side = new THREE.Vector3(1, 0, 0);
  cam.position.copy(mid).addScaledVector(side, 10);
  cam.position.y = 1;
  cam.lookAt(mid.x, 1, mid.z);
  renderer.render(scene, cam);
} else {
  const game = params.get('game') === '1';
  const persp = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 100);
  const holder = new THREE.Group();
  holder.add(base);
  scene.add(holder);
  let anim = null;
  let mixer = null;
  if (game) {
    const clips = {};
    for (const [k, url] of Object.entries(M.clips)) clips[k] = (await loader.loadAsync(url)).animations[0];
    anim = new CharacterAnimator(base, clips);
    window.__lab.cal = anim.loco.cal;
    window.__lab.anim = anim;
    window.__lab.natural = anim.natural;
  } else {
    mixer = new THREE.AnimationMixer(base);
    mixer.clipAction(clip).play();
  }
  const speed = parseFloat(params.get('speed') || (clipName === 'run' ? '4.6' : '1.9'));
  let last = performance.now();
  let x = 0;
  const loop = (now) => {
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (anim) {
      x += speed * dt;
      holder.position.z = x;
      anim.update(dt, 'ground', speed);
    } else mixer.update(dt);
    const p = bone(base, 'Hips').getWorldPosition(new THREE.Vector3());
    persp.position.set(p.x + 4.5, 1.3, p.z);
    persp.lookAt(p.x, 1.0, p.z);
    grid.position.z = Math.round(p.z);
    renderer.render(scene, persp);
  };
  requestAnimationFrame(loop);
}
void scale;
