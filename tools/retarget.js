// Bakes Mixamo mocap clips (three.js example characters) onto Prady's skeleton.
// Open http://localhost:5173/tools/retarget.html — the baked clips are exposed as
// window.__bake (JSON) and previewed side by side. Save them with tools/bake-mocap.mjs.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BVHLoader } from 'three/addons/loaders/BVHLoader.js';
import { ASSET_MANIFEST } from '../src/core/Assets.js';
import { cmuKey, retargetClip } from '../src/gameplay/Retarget.js';

const SOURCES = [
  // (only what the game plays: the sneak/sad/soldier/agree/headShake clips were never used)
  { url: '/source-assets/mixamo/Xbot.glb', clips: { idle: 'idle', walk: 'walk', run: 'run' } },
];

// CMU motion capture takes (free for any use, mocap.cs.cmu.edu): the same segments the crowd
// uses (tools/people-config.js), here as Prady's greeting and idle breaks.
const CMU = [
  { name: 'wave', file: '13_26', start: 20.4, end: 23.2, loopBlend: 0.6 },
  { name: 'stretch', file: '42_01', start: 1.0, end: 8.6, loopBlend: 1.0 },
  { name: 'lookAround', file: '40_10', start: 0.6, end: 6.0, loopBlend: 0.8 },
  // hands folded at the chest (Pranamasana, from a Sun Salutation take): held as a pose
  { name: 'pranam', file: '144_30', start: 3.85, end: 4.3, loopBlend: 0.2 },
  // seated cross-legged (meditation), and the get-up played backwards to sit down
  // (111_06 starts lying down: its rest frame sits at the lying hip height, so use subject 111's
  // standing hip height from 111_02)
  { name: 'meditate', file: '111_06', start: 3.0, end: 3.7, loopBlend: 0.3, restHipY: 15.7 },
  { name: 'sitToStand', file: '111_06', start: 3.4, end: 10.4, restHipY: 15.7 },
  // deep crouch reaching to the ground (floating a diya)
  { name: 'crouchReach', file: '139_06', start: 1.55, end: 3.4 },
  // stepping up onto a takht / ledge (the climb itself is driven by the controller)
  { name: 'stepUp', file: '141_07', start: 0.85, end: 1.9, lockY: true },
  // dive take-off: crouch, arms back, spring with arms up
  { name: 'diveTakeoff', file: '91_39', start: 0.55, end: 1.5, lockY: true },
  // front crawl, captured lying face down on a bench: stood upright so the swim tilt applies
  { name: 'swimCrawl', file: '126_10', start: 1.0, end: 9.3, loopBlend: 0.6, pitch: -Math.PI / 2, lockY: true },

  // ---- combat (all CMU, free for any use). Strikes keep their root motion (the game moves
  // Prady along it) so a lunge plants its feet.
  // a boxer (13_17): the guard, a one-two (jab + cross) back to guard, a body shot
  { name: 'guard', file: '13_17', start: 2.45, end: 2.95, loopBlend: 0.25 },
  { name: 'oneTwo', file: '13_17', start: 2.6, end: 3.75, rootMotion: true, strike: { t: 0.57, bone: 'RightHand' } },
  { name: 'bodyShot', file: '13_17', start: 10.45, end: 11.5, rootMotion: true, strike: { t: 0.48, bone: 'RightHand' } },
  // a karate practitioner (135): front kick (mae-geri), roundhouse (mawashi-geri),
  // lunge punch (oi-zuki: with a sword, a lunging thrust), knife-hand block (shuto-uke: a parry)
  { name: 'frontKick', file: '135_04', start: 2.45, end: 3.85, rootMotion: true, strike: { t: 0.65, bone: 'RightFoot' } },
  { name: 'roundKick', file: '135_07', start: 0.25, end: 1.75, rootMotion: true, strike: { t: 0.68, bone: 'RightFoot' } },
  { name: 'thrust', file: '135_09', start: 1.8, end: 3.15, rootMotion: true, strike: { t: 0.67, bone: 'RightHand' } },
  { name: 'parry', file: '135_10', start: 4.75, end: 5.45 },
  // the sword's ready stance is the swordplay actor's own pause just before his first cut, so a
  // slash starts from exactly this pose (a karate stance here twisted the torso mid-blend)
  { name: 'swordStance', file: '02_08', start: 5.95, end: 6.35, loopBlend: 0.2 },
  // sword cuts: two rising slashes from a swordplay take (02_08) and a woodcutter's overhead
  // chop (79_01) as the heavy two-handed cut
  { name: 'slashA', file: '02_08', start: 6.3, end: 7.55, rootMotion: true, strike: { t: 0.57, bone: 'RightHand' } },
  { name: 'slashB', file: '02_08', start: 8.9, end: 10.15, rootMotion: true, strike: { t: 0.6, bone: 'RightHand' } },
  { name: 'heavyCut', file: '79_01', start: 0.35, end: 1.7, rootMotion: true, strike: { t: 0.72, bone: 'RightHand' } },

  // ---- defence (CMU; segments found from the hip height over each take, tools/bvh-measure.mjs)
  // a dive roll out of a run: down at 0.8 s, inverted to 1.1 s, standing by 2.0 s (played fast)
  { name: 'dodgeRoll', file: '127_23', start: 0.55, end: 2.1 },
  // quick large steps backwards (a hop out of reach)
  { name: 'dodgeBack', file: '76_11', start: 0.3, end: 1.35 },
  // knocked flat on the back (a rug pulled from under him), and the same fall held as death
  { name: 'knockdown', file: '90_18', start: 0.6, end: 1.7 },
  { name: 'death', file: '90_18', start: 0.6, end: 3.0 },
  // getting up from lying on the back: rolls up to sitting, crouch, stands
  { name: 'getUp', file: '140_08', start: 2.0, end: 5.6, restHipY: 14.5 }, // (its first frame lies: standing hips from 6.5 s)
];

const loader = new GLTFLoader();
const prady = (await loader.loadAsync(ASSET_MANIFEST.character.model)).scene;
prady.updateMatrixWorld(true); // fresh load = rest pose
prady.traverse((o) => o.isBone && (o.userData.rest = { q: o.quaternion.clone(), p: o.position.clone() }));

const bone = (root, n) => {
  let b = null;
  root.traverse((o) => !b && o.isBone && o.name.endsWith(n) && (b = o));
  return b;
};
const facing = (root) => {
  root.updateMatrixWorld(true);
  const t = bone(root, 'LeftToeBase').getWorldPosition(new THREE.Vector3());
  const a = bone(root, 'LeftFoot').getWorldPosition(new THREE.Vector3());
  return Math.sign(t.z - a.z) || 1;
};
const pFacing = facing(prady);

const baked = [];
for (const src of SOURCES) {
  const g = await loader.loadAsync(src.url);
  const root = g.scene;
  if (facing(root) !== pFacing) root.rotation.y = Math.PI;
  root.updateMatrixWorld(true);
  for (const [name, clipName] of Object.entries(src.clips)) {
    const clip = g.animations.find((c) => c.name === clipName);
    if (!clip) continue;
    const out = retargetClip({ root, clip }, prady, { fps: 30, name });
    baked.push(out);
  }
}
const bvh = new BVHLoader();
for (const m of CMU) {
  const res = bvh.parse(await (await fetch(`/source-assets/cmu/${m.file}.bvh`)).text());
  const root = new THREE.Group();
  root.add(res.skeleton.bones[0]);
  const out = retargetClip({ root, clip: res.clip, keyOf: cmuKey, restTime: 0, start: m.start, end: m.end, restHipY: m.restHipY }, prady, {
    fps: 30,
    name: m.name,
    inPlace: true,
    loopBlend: m.loopBlend,
    faceForward: true,
    pitch: m.pitch || 0,
    lockY: !!m.lockY,
    rootMotion: !!m.rootMotion,
    staticKeys: /Hand(Thumb|Index|Middle|Ring|Pinky)/,
  });
  // where the blow lands, seen from the hips at the moment of impact: fighting stances stand
  // side-on, so the game turns Prady by this to aim the strike itself at the target
  if (m.strike && out.userData.rootMotion) {
    const mixer = new THREE.AnimationMixer(prady);
    mixer.clipAction(out).play();
    mixer.setTime(m.strike.t);
    prady.updateMatrixWorld(true);
    const hips = bone(prady, 'Hips').getWorldPosition(new THREE.Vector3());
    const limb = bone(prady, m.strike.bone).getWorldPosition(new THREE.Vector3());
    out.userData.rootMotion.strikeYaw = Math.round(Math.atan2(limb.x - hips.x, limb.z - hips.z) * pFacing * 1e3) / 1e3;
    out.userData.rootMotion.reach = Math.round((Math.hypot(limb.x - hips.x, limb.z - hips.z) / Math.max(1e-6, hips.y - bone(prady, 'LeftFoot').getWorldPosition(new THREE.Vector3()).y)) * 1e3) / 1e3;
    mixer.stopAllAction();
    mixer.uncacheRoot(prady);
    prady.traverse((o) => o.isBone && o.userData.rest && (o.quaternion.copy(o.userData.rest.q), o.position.copy(o.userData.rest.p)));
    prady.updateMatrixWorld(true);
  }
  baked.push(out);
}
const rootMotion = Object.fromEntries(baked.filter((c) => c.userData.rootMotion).map((c) => [c.name, c.userData.rootMotion]));
window.__bake = JSON.stringify({ source: 'three.js examples (Mixamo mocap) + CMU motion capture, retargeted onto Prady', clips: baked.map((c) => THREE.AnimationClip.toJSON(c)), rootMotion });
document.getElementById('info').textContent = `baked ${baked.length} clips: ${baked.map((c) => `${c.name} ${c.duration.toFixed(2)}s`).join(', ')}`;
