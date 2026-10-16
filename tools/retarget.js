// Bakes Mixamo mocap clips (three.js example characters) onto Prady's skeleton.
// Open http://localhost:5173/tools/retarget.html — the baked clips are exposed as
// window.__bake (JSON) and previewed side by side. Save them with tools/bake-mocap.mjs.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { BVHLoader } from 'three/addons/loaders/BVHLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { ASSET_MANIFEST } from '../src/core/Assets.js';
import { cmuKey, retargetClip } from '../src/gameplay/Retarget.js';
import { jointsToClip } from './joints-to-clip.js';

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

// Prady's second file of moves (public/assets/characters/prady-moves.json, beside the first so
// it is never rewritten): traversal over the ghats and the rooftops. ?set=moves bakes these.
const MOVES = [
  // a running leap over a railing or a takht: take-off, knees tucked, landing on the other foot
  { name: 'vault', file: '141_08', start: 0.9, end: 2.1, lockY: true },
  // scrambling up onto a high ledge on hands and feet (a playground climb)
  { name: 'scramble', file: '01_02', start: 4.6, end: 7.6, lockY: true },
  // climbing a ladder: one rung after the other, hands reaching up (a loop; the game lifts him)
  { name: 'ladder', file: '13_33', start: 2.6, end: 4.7, lockY: true, loopBlend: 0.35 },
];
// Prady's third file (public/assets/characters/prady-moves2.json): hanging from a ledge, the
// hands overhead on it (a loop; the game places him on the ledge and moves his hands). ?set=moves2
const MOVES2 = [
  // hanging from a bar by both hands, the legs loose, a little sway (a playground take)
  { name: 'hang', file: '01_12', start: 1.9, end: 3.2, lockY: true, loopBlend: 0.35 },
];
// Prady's fourth file (public/assets/characters/prady-moves3.json): the small motions between
// the big ones. ?set=moves3
//   turnL / turnR: a quarter turn on the spot, stepping round (the turn itself is taken out of
//   the take, rootYaw, and the game turns him by it, so his feet stay planted)
//   runStop: a jog braking hard to a standstill, the hips dropping into the plant (root motion)
//   akimbo: hands on the hips, waiting (an idle break)
// ?set=video: motion from video (Motion2MixamoRig / GVHMR joints, source-assets/m2mr/<file>.json;
// the video-to-mocap skill). Whole takes for now: ranges once a take is judged worth keeping.
const VIDEO = [
  // Mixkit 49634: a head-high roundhouse with the right leg (chamber 1.6 s, impact 2.44 s, down by 4.2 s)
  { name: 'roundKick', file: 'mixkit-49634-roundkick', start: 1.6, end: 4.3, rootMotion: true, strike: { t: 0.84, bone: 'RightFoot' } },
  // (tried and kept out: a one-two from Mixkit 49632's kata and a low punch from 49633. Kata
  // punches snap out and hold, and the take jittered; the CMU boxer's suit a brawl better)
  // Mixkit 12971: a head-high side kick with the right leg (peak 2.30 s)
  { name: 'sideKick', file: 'mixkit-12971-kickdemo', start: 1.6, end: 3.3, rootMotion: true, strike: { t: 0.7, bone: 'RightFoot' } },
  // Mixkit 1222 (beach, handheld): a standing tucked backflip, take-off 6.3 s, landed 7.9 s. Its
  // travel is noise (the camera moves), so in place: the game moves him. Floor from its own span;
  // the take is about 2x slow motion (1.3 s in the air), so the flight is rebuilt as a 0.65 s arc.
  { name: 'backFlip', file: 'mixkit-1222-backflip', start: 5.95, end: 8.2, floor: true, air: { from: 6.23, to: 7.57, speed: 2 } },
  // Mixkit 49223 (studio, slow motion ~4x): an aerial, a no-hands cartwheel, travelling to his
  // left (the head goes over that way). Mirrored for the right. In place: the game moves him.
  { name: 'aerialL', file: 'mixkit-49223-acro', start: 3.3, end: 7.4, floor: true },
  { name: 'aerialR', file: 'mixkit-49223-acro', start: 3.3, end: 7.4, floor: true, mirror: true },
];
// ?set=videoPreview: whole takes, travel kept, to look at before cutting (never shipped; the
// takes judged so far: tools/retarget.js history and the video-to-mocap skill)
const VIDEO_PREVIEW = ['49223-acro', '21754-cartwheel', '47897-breakdance'].map((f) => ({ name: `pv_${f.split('-')[1]}`, file: `mixkit-${f}`, start: 0, end: 600, inPlace: false }));
const MOVES3 = [
  { name: 'turnL', file: '69_17', start: 0.9, end: 2.3, rootYaw: true, inPlace: 'sway' },
  { name: 'turnR', file: '69_19', start: 0.85, end: 2.45, rootYaw: true, inPlace: 'sway' },
  { name: 'runStop', file: '16_08', start: 0.5, end: 1.9, rootMotion: true },
  { name: 'akimbo', file: '40_11', start: 20.6, end: 24.0 },
];
// ?set=mixamo: Mixamo motion capture (Adobe, royalty-free for use inside a game), each exported
// on Y Bot without a skin at 30 fps into source-assets/mixamo/clips/<file>.fbx (downloaded with
// the user's own Mixamo sign-in). Same options as the CMU entries.
const MIXAMO = [
  // ---- on a ledge (the game places him and IKs the hands; these give the body its life)
  { name: 'mxBracedIdle', lockY: true, file: 'bracedIdle', loopBlend: 0.3 }, // hanging, feet on the wall
  { name: 'mxFreeHang', lockY: true, file: 'freeHangIdle', loopBlend: 0.3 }, // hanging free, legs loose
  { name: 'mxShimmyL', lockY: true, file: 'shimmyL', loopBlend: 0.15 }, // braced, hand over hand to his left
  { name: 'mxShimmyR', lockY: true, file: 'shimmyR', loopBlend: 0.15 },
  { name: 'mxFreeShimmyL', lockY: true, file: 'freeShimmyL', loopBlend: 0.15 }, // hanging free, to his left
  { name: 'mxFreeShimmyR', lockY: true, file: 'freeShimmyR', loopBlend: 0.15 },
  // ---- onto, up, off and between ledges (the hips held level: the game moves him along its own
  // path, the clip only poses him, timed to the move)
  { name: 'mxClimbUp', file: 'climbUp', lockY: true }, // braced hang up over the edge to a crouch
  { name: 'mxFreehangClimb', file: 'freehangClimb', lockY: true }, // free hang up to standing
  { name: 'mxJumpToHang', file: 'jumpToHang', lockY: true }, // hitting the wall, catching braced
  { name: 'mxCatchAir', file: 'bracedHangAir', lockY: true }, // caught from mid-air
  { name: 'mxHopUp', file: 'hopUp', lockY: true }, // braced hop up to the ledge above
  { name: 'mxHopL', file: 'hopL', lockY: true },
  { name: 'mxHopR', file: 'hopR', lockY: true },
  { name: 'mxHangDrop', file: 'hangDropHang', lockY: true }, // down to the ledge below
  { name: 'mxWallUp', lockY: true, file: 'wallUp', loopBlend: 0.2 }, // climbing a wall's face (holds)
  { name: 'mxWallDown', lockY: true, file: 'wallDown', loopBlend: 0.2 },
  // ---- acrobatics and the ground
  { name: 'mxKipUp', file: 'kipUp', rootMotion: true }, // flat on his back to his feet in one spring
  // (the wind-up's standing second cut away: the spin from 0.7 s, the feet at 1.9 and 2.1 s)
  { name: 'mxButterflyKick', file: 'butterflyKick', start: 0.7, end: 2.8, rootMotion: true },
  { name: 'mxButterflyTwirl', file: 'butterflyTwirl', rootMotion: true },
  { name: 'mxFallRoll', file: 'fallRoll', rootMotion: true }, // from a fall into a forward roll
  { name: 'mxHardLanding', file: 'hardLanding', rootMotion: true },
  { name: 'mxDodgeBack', file: 'dodgeBackJump', rootMotion: true },
  // ---- taking a blow
  { name: 'mxReactFront', file: 'reactFront', rootMotion: true },
  { name: 'mxReactRight', file: 'reactRight', rootMotion: true },
  { name: 'mxReactBack', file: 'reactBack', rootMotion: true },
  { name: 'mxReactSmallL', file: 'reactSmallL', rootMotion: true },
  { name: 'mxReactSmallR', file: 'reactSmallR', rootMotion: true },
  { name: 'mxGetUpBack', file: 'getUpBack', rootMotion: true },
  { name: 'mxGetUpStomach', file: 'getUpStomach', rootMotion: true },
];
const SET = new URLSearchParams(location.search).get('set');
// ?src=ue: each CMU take as Unreal's IK Retargeter put it onto Prady (Desktop/PradyAnim: IK goals on
// hands and feet, pelvis scaled to his legs; exported per take as /ue-export/P_<take>.glb, served by
// tools/bake-mocap.mjs), shaped here exactly as the BVH path does (ranges, loops, root motion)
const SRC = new URLSearchParams(location.search).get('src');
const ueKey = (n) => n.replace(/^mixamorig_?/, '');

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder); // (the manifest's models are meshopt copies)
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
for (const src of SET === 'moves' || SET === 'moves2' || SET === 'moves3' || SET === 'video' || SET === 'videoPreview' || SET === 'mixamo' ? [] : SOURCES) {
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
const ONLY = new URLSearchParams(location.search).get('only')?.split(',');
const LIST = SET === 'moves' ? MOVES : SET === 'moves2' ? MOVES2 : SET === 'moves3' ? MOVES3 : SET === 'video' ? VIDEO : SET === 'videoPreview' ? VIDEO_PREVIEW : SET === 'mixamo' ? MIXAMO : CMU;
for (const m of ONLY ? LIST.filter((x) => ONLY.includes(x.name)) : LIST) {
  let source;
  if (SET === 'mixamo') {
    // (a skeleton-only FBX: its bones stand in the T-pose as loaded, the clip on them)
    const fbx = await new FBXLoader().loadAsync(`/source-assets/mixamo/clips/${m.file}.fbx`).catch(() => null);
    if (!fbx) continue; // (not downloaded yet)
    if (facing(fbx) !== pFacing) fbx.rotation.y = Math.PI;
    fbx.updateMatrixWorld(true);
    source = { root: fbx, clip: fbx.animations[0], start: m.start, end: m.end };
  } else if (SET === 'video' || SET === 'videoPreview') {
    // Prady himself, posed frame by frame from the joints (tools/joints-to-clip.js)
    const g = await loader.loadAsync(ASSET_MANIFEST.character.model);
    const data = await (await fetch(`/source-assets/m2mr/${m.file}.json`)).json();
    source = { root: g.scene, clip: jointsToClip(g.scene, data, m.name, { floor: m.floor && [m.start, m.end], air: m.air, mirror: m.mirror }), start: m.start, end: m.end };
  } else if (SRC === 'ue') {
    // (already on Prady's skeleton, standing in its bind pose: that is the rest)
    const g = await loader.loadAsync(`/ue-export/P_${m.file}.glb`);
    source = { root: g.scene, clip: g.animations[0], keyOf: ueKey, start: m.start, end: m.end };
  } else {
    const res = bvh.parse(await (await fetch(`/source-assets/cmu/${m.file}.bvh`)).text());
    const root = new THREE.Group();
    root.add(res.skeleton.bones[0]);
    source = { root, clip: res.clip, keyOf: cmuKey, restTime: 0, start: m.start, end: m.end, restHipY: m.restHipY };
  }
  const out = retargetClip(source, prady, {
    fps: 30,
    name: m.name,
    inPlace: m.inPlace ?? true,
    loopBlend: m.loopBlend,
    faceForward: true,
    pitch: m.pitch || 0,
    lockY: !!m.lockY,
    rootMotion: !!m.rootMotion,
    rootYaw: !!m.rootYaw,
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
window.__bake = JSON.stringify({ source: SET === 'mixamo' ? 'Mixamo motion capture (Adobe; royalty-free in a game), retargeted onto Prady' : SRC === 'ue' ? 'three.js examples (Mixamo mocap) + CMU motion capture, retargeted onto Prady by Unreal Engine 5.8 (IK Retargeter)' : 'three.js examples (Mixamo mocap) + CMU motion capture, retargeted onto Prady', clips: baked.map((c) => THREE.AnimationClip.toJSON(c)), rootMotion });
document.getElementById('info').textContent = `baked ${baked.length} clips: ${baked.map((c) => `${c.name} ${c.duration.toFixed(2)}s`).join(', ')}`;
