import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { loadImage } from '../utils/textures.js';

// ONE place that maps game roles -> files in /public/assets. To swap any asset (your own
// model, a Mixamo clip, a new music track) change the path here; nothing else needs to know.
// Every entry is optional at runtime: if a file is missing the game uses a procedural
// fallback and logs a warning, so the build never breaks.

const A = '/assets';

export const ASSET_MANIFEST = {
  // The people of the ghats: Microsoft Rocketbox avatars (MIT) with CMU + Mixamo motion capture,
  // baked by tools/bake-people.mjs. Loaded lazily after the title screen (src/world/Crowd.js).
  people: {
    base: `${A}/people`,
    avatars: [
      { id: 'Male_Adult_15', role: 'pilgrim', sex: 'm', kurta: true },
      { id: 'Female_Adult_06', role: 'pilgrim', sex: 'f' },
      { id: 'Male_Adult_14', role: 'local', sex: 'm' },
      { id: 'Male_Adult_08', role: 'local', sex: 'm' },
      { id: 'Male_Adult_11', role: 'local', sex: 'm' },
      { id: 'Male_Adult_06', role: 'local', sex: 'm' },
      { id: 'Male_Adult_20', role: 'local', sex: 'm' },
      { id: 'Male_Adult_09', role: 'local', sex: 'm' },
      { id: 'Female_Adult_15', role: 'local', sex: 'f' },
      { id: 'Female_Adult_11', role: 'local', sex: 'f' },
      { id: 'Male_Adult_01', role: 'tourist', sex: 'm' },
      { id: 'Female_Adult_08', role: 'tourist', sex: 'f' },
      { id: 'Male_Child_01', role: 'child', sex: 'm' },
      { id: 'Male_Child_02', role: 'child', sex: 'm' },
      { id: 'Female_Child_01', role: 'child', sex: 'f' },
      { id: 'Female_Child_02', role: 'child', sex: 'f' },
    ],
    // shared motion packs (skeleton + clips) by body type: adult male / adult female / child;
    // mx: more for the grown men (a sprint)
    packs: { m: 'motions-m', f: 'motions-f', c: 'motions-c', mx: 'motions-mx' },
  },
  // The Asuras (src/gameplay/Asuras.js): a person's body re-skinned as darkness, driven by an
  // enemy motion pack (tools/people.js "asura" pack: CMU + Mixamo mocap on the same skeleton).
  // roles: which clip plays each part of a fight (the first one present wins).
  enemies: {
    body: `${A}/people/Male_Adult_11.glb`,
    packBase: `${A}/people/motions-m.glb`,
    pack: `${A}/people/motions-asura.glb`,
    // thrown flat and up again (Shiva's Damaru), the Vetala's leap, the Kavacha's guard
    pack2: `${A}/people/motions-asura2.glb`,
    bossBody: null,
    // ('-name': the clip played backwards)
    roles: {
      idle: ['asuraIdle', 'wait', 'idle'],
      walk: ['asuraWalk', 'walk'],
      run: ['asuraRun'],
      strafeL: ['asuraStrafeL', '-asuraStrafeR'],
      strafeR: ['asuraStrafeR'],
      attackA: ['asuraSwipe'],
      attackB: ['asuraLunge'],
      heavy: ['asuraSmash'],
      hit: ['asuraHit'],
      stagger: ['asuraStagger'],
      death: ['asuraDeath'],
      roar: ['asuraRoar'],
      fall: ['asuraFall'],
      getUp: ['asuraGetUp'],
      leap: ['asuraLeap'],
      block: ['asuraBlock'],
    },
  },
  character: {
    // Prady, rigged by Uthana with a Mixamo-named skeleton (game copy with 2K textures;
    // the full-resolution originals are in /source-assets, outside the web build).
    model: `${A}/characters/prady-game-2k.glb`,
    // Motion-capture idle/walk/run (Mixamo, from the three.js examples) retargeted onto Prady's
    // skeleton by tools/retarget.html (src/gameplay/Retarget.js). Preferred over the clips below.
    mocap: `${A}/characters/prady-mocap.json`,
    // + traversal (CMU, tools/retarget.js ?set=moves): the vault, the scramble up a ledge, a ladder
    moves: `${A}/characters/prady-moves.json`,
    // + hanging from a ledge (CMU 01_12, tools/retarget.js ?set=moves2)
    moves2: `${A}/characters/prady-moves2.json`,
    // + CMU motion capture: the greeting wave (G) and idle breaks
    mocapClips: {
      idle: 'idle', walk: 'walk', run: 'run', swim: 'swimCrawl',
      wave: 'wave', stretch: 'stretch', lookAround: 'lookAround', pranam: 'pranam',
      meditate: 'meditate', sitToStand: 'sitToStand', crouchReach: 'crouchReach', stepUp: 'stepUp', diveTakeoff: 'diveTakeoff',
      // combat (CMU: boxer 13, karate 135, swordplay 02, woodcutter 79)
      guard: 'guard', oneTwo: 'oneTwo', bodyShot: 'bodyShot', frontKick: 'frontKick', roundKick: 'roundKick',
      thrust: 'thrust', parry: 'parry', swordStance: 'swordStance', slashA: 'slashA', slashB: 'slashB', heavyCut: 'heavyCut',
      // defence (CMU): dodge roll / backstep, knockdown + get up, the fall
      dodgeRoll: 'dodgeRoll', dodgeBack: 'dodgeBack', knockdown: 'knockdown', getUp: 'getUp', death: 'death',
    },
    // Fallback clips (Genex / Uthana) used if the mocap file is missing.
    clips: {
      walk: `${A}/characters/animate-character-cmuyh89rq0f7i3fo0hz42w-cmuyhub7-walk-forward-mxnwapjk.glb`,
      run: `${A}/characters/animate-character-cmuyh89rq0f7i3fo0hz42w-cmuyhub7-run-forward-mf8nzlb9.glb`,
      // Add more and they replace the procedural versions automatically, e.g.
      // idle: `${A}/characters/mixamo-idle.glb`,
      // swim: `${A}/characters/mixamo-swimming.glb`,
      // jump: `${A}/characters/mixamo-jump.glb`,
    },
    height: 1.75,
  },
  boat: `${A}/models/boat-game-1k.glb`, // the boat you ride (1K textures, 23.7k tris)
  boatLod: `${A}/models/boat-lod.glb`, // moored boats (simplified to 3.5k tris)
  // the ghats' animals: Genex models, quadruped-rigged, one walk clip each (in place, 2.6 s);
  // baked to 1K WebP textures + meshopt from /source-assets/animals. front: the yaw that turns
  // the model's nose to +Z; scale: metres per model unit; stride: model units per second the
  // hooves travel at clip speed 1 (the walk is played at speed / (stride * scale))
  animals: {
    // rig: the bones that matter, read off each auto-rig's tree and skin weights (Tripo's names
    // don't say what a bone moves). pitch: the neck from the withers to the head, each bone's
    // share of a nod or a lowered head; look: the share of a turn of the head; then the tail and
    // the back. (The cow's neck runs tripoSpine_3..5 to tripoHead_1; the dog's head hangs off its
    // shoulder chain at bone_17/18; its tail is tripoTail_*.)
    cow: { url: `${A}/animals/cow.glb`, front: Math.PI, scale: 1.75, stride: 0.62, rig: { pitch: [['tripoSpine_3', 0.14], ['tripoSpine_4', 0.28], ['tripoSpine_5', 0.3], ['tripoHead_1', 0.28]], look: [['tripoSpine_5', 0.45], ['tripoHead_1', 0.55]], tail: ['bone_38', 'bone_39', 'bone_40'], spine: ['tripoSpine_1', 'tripoSpine_2'] } },
    dog: { url: `${A}/animals/dog.glb`, front: -Math.PI / 2, scale: 0.85, stride: 0.52, rig: { pitch: [['bone_17', 0.3], ['bone_18', 0.32], ['tripoHead_0', 0.2], ['tripoHead_1', 0.18]], look: [['bone_18', 0.45], ['tripoHead_1', 0.55]], tail: ['tripoTail_0', 'tripoTail_1', 'tripoTail_2', 'tripoTail_3', 'bone_40'], spine: ['tripoSpine_1'] } },
  },
  // fire: a CC0 flipbook of real simulated flame (Unity Labs, 16 x 4 frames; see
  // /source-assets/fx/LICENSE-unity-labs-vfx.txt) for the big fires (Fire.js)
  fx: {
    flame: `${A}/textures/fx/flame-16x4.webp`,
  },
  // Where things can walk (world/NavMesh.js): a Recast navmesh baked from the world's colliders
  // by `npm run bake:nav`, and the signature of the world it fits.
  nav: {
    mesh: `${A}/nav/kashi.navmesh.bin`,
    meta: `${A}/nav/kashi.navmesh.json`,
  },
  // Real PBR sets (Poly Haven, CC0; /source-assets/textures/polyhaven/LICENSE.txt): colour,
  // OpenGL normal and arm (R ambient occlusion, G roughness, B metal). Where a key has a set it
  // replaces the photo-derived set of the same name below; repeat: texture repeats per UV unit
  // (the UVs are metres / tile), scaled to each surface's real size.
  pbr: {
    // (the ghats keep their own worn Chunar stone: Poly Haven's sandstone_blocks_08, also here,
    // read too clean and cold side by side; the plaster's flaking is kept at a third of its
    // contrast so a haveli is old, not blotchy)
    plaster: { map: `${A}/textures/pbr/white_rough_plaster_diff_1k.jpg`, normal: `${A}/textures/pbr/white_rough_plaster_nor_gl_1k.jpg`, arm: `${A}/textures/pbr/white_rough_plaster_arm_1k.jpg`, repeat: 1.5, contrast: 0.35, level: 0.86 },
    wood: { map: `${A}/textures/pbr/weathered_brown_planks_diff_1k.jpg`, normal: `${A}/textures/pbr/weathered_brown_planks_nor_gl_1k.jpg`, arm: `${A}/textures/pbr/weathered_brown_planks_arm_1k.jpg`, repeat: 1 },
  },
  textures: {
    stone: `${A}/textures/seamless-tileable-texture-straight-top-d-cmuyhilb.png`,
    plaster: `${A}/textures/seamless-tileable-texture-flat-front-on-cmuyhin9.png`,
    sand: `${A}/textures/seamless-tileable-texture-straight-top-d-cmuyhip5.png`,
    // Generated with Gemini (tools/gemini-image.mjs); 2K originals in /source-assets/textures
    carving: `${A}/textures/gemini-temple-carving.jpg`,
    wood: `${A}/textures/gemini-wood-planks.jpg`,
    straw: `${A}/textures/gemini-straw-thatch.jpg`,
  },
  // voiced lines for the chapters (Gemini TTS, tools/gemini-tts.mjs), loaded a chapter at a time
  voice: `${A}/audio/voice`,
  keyArt: `${A}/images/cinematic-key-art-for-a-mythological-ope-cmuyh9f3.png`,
  // Kaal Bhairav's shringar in his sanctum (Gemini 3 Pro Image; 2K original in source-assets/images)
  murti: `${A}/images/gemini-bhairav-murti-v2.jpg`,
  // battle music, fetched once the game has begun (Lyria 3.5 via tools/gemini-music.mjs; 48 s
  // seamless loops cut on the bar, padded 0.5 s either side with their own wrapped audio: `loop`
  // is [loopStart, loopEnd] in seconds)
  // the score (gameplay/Score.js; Lyria 3.5 via tools/gemini-music.mjs, masters in
  // source-assets/music): a raga for each part of the day, played as cues; the tension before a
  // fight; the swell under an establishing shot
  score: {
    dawn: `${A}/audio/score/dawn.mp3`,
    day: `${A}/audio/score/day.mp3`,
    evening: `${A}/audio/score/evening.mp3`,
    night: `${A}/audio/score/night.mp3`,
    tension: `${A}/audio/score/tension.mp3`,
    reveal: `${A}/audio/score/reveal.mp3`,
  },
  // the crowd's voices (world/Barks.js; Gemini 2.5 Pro TTS via tools/gemini-tts.mjs): an id ends
  // -m / -f for a man's or a woman's line
  barks: {
    url: (id) => `${A}/audio/barks/${id}.mp3`,
    groups: {
      vendor: ['chai-m1', 'chai-m2', 'kachori-m', 'phool-f1', 'phool-f2', 'idhar-m'],
      pilgrim: ['harhar-m1', 'harhar-m2', 'harhar-f', 'ganga-f1', 'ganga-f2', 'bhole-m', 'sadhu-m'],
      boatman: ['naav-m1', 'naav-m2'],
      priest: ['om-priest'],
      dusk: ['aarti-f'],
      work: ['dhobi-m'],
      bumped: ['dhyan-m', 'dhyan-f', 'dekh-m'],
      climb: ['climb-m', 'climb-f'],
      sword: ['sword-m'],
      fear: ['asur-m', 'bachao-f', 'raksha-m'],
      cheer: ['jai-m1', 'jai-m2', 'jai-f'],
    },
  },
  battleMusic: {
    fight: { url: `${A}/audio/battle-ghats-loop.mp3`, loop: [0.5, 48.5015] },
    boss: { url: `${A}/audio/battle-andhaka-loop.mp3`, loop: [0.5, 48.5015] },
  },
  audio: {
    music: `${A}/audio/seamless-meditative-loop-for-a-sacred-ri-cmuyh8w5.mp3`,
    river: `${A}/audio/gentle-wide-river-water-lapping-against-cmuyh90m.mp3`,
    aartiAmbience: `${A}/audio/evening-ganga-aarti-ambience-distant-cro-cmuyh9dh.mp3`,
    underwater: `${A}/audio/underwater-muffled-ambience-low-rumble-a-cmuyhuv7.mp3`,
    fireLoop: `${A}/audio/small-oil-lamp-flames-crackling-softly-s-cmuyhuze.mp3`,
    swim: `${A}/audio/steady-swimming-strokes-in-calm-river-wa-cmuyh986.mp3`,
    bell: `${A}/audio/single-brass-temple-bell-strike-with-lon-cmuyh92b.mp3`,
    conch: `${A}/audio/sacred-conch-shell-shankh-blown-one-long-cmuyh94b.mp3`,
    splash: `${A}/audio/person-jumps-and-splashes-into-a-river-b-cmuyh969.mp3`,
    ignite: `${A}/audio/oil-lamp-flame-igniting-with-a-soft-whoo-cmuyh9a4.mp3`,
    chime: `${A}/audio/magical-sacred-chime-shimmer-small-bead-cmuyh9bt.mp3`,
    footstep: `${A}/audio/single-footstep-on-a-worn-stone-step-lea-cmuyhupr.mp3`,
    oar: `${A}/audio/wooden-oar-stroke-pulling-through-calm-r-cmuyhut0.mp3`,
    pigeons: `${A}/audio/flock-of-pigeons-taking-off-wings-flappi-cmuyhux9.mp3`,
    narrationIntro: `${A}/audio/kashi-older-than-history-the-city-of-lig-cmuyhulu.mp3`,
    narrationEnd: `${A}/audio/the-five-flames-burn-once-more-mother-ga-cmuyhunv.mp3`,
    // the Asuras (Genex sfx, pitched / levelled copies of the originals beside them)
    'asura-growl': `${A}/audio/sfx/asura-growl.mp3`,
    'asura-attack': `${A}/audio/sfx/asura-attack.mp3`,
    'asura-death': `${A}/audio/sfx/asura-death.mp3`,
    'andhaka-roar': `${A}/audio/sfx/andhaka-roar.mp3`,
    // the fight, recorded (Genex sfx, levelled and trimmed from /source-assets/sfx): these
    // replace the synthesized blade, guard and body sounds of the same names (AudioManager).
    // (-lv: the hit and the whooshes came out of the first levelling 25-37 dB too quiet, the
    // sword all but silent in a fight; brought up to peak with the others)
    'blade-hit': `${A}/audio/sfx/blade-hit-lv.mp3`,
    'blade-whoosh': `${A}/audio/sfx/blade-whoosh-lv.mp3`,
    'heavy-whoosh': `${A}/audio/sfx/heavy-whoosh-lv.mp3`,
    parry: `${A}/audio/sfx/parry-clang.mp3`,
    block: `${A}/audio/sfx/block-impact.mp3`,
    hurt: `${A}/audio/sfx/body-hit.mp3`,
    'heavy-hit': `${A}/audio/sfx/heavy-hit.mp3`,
    'shield-clang': `${A}/audio/sfx/shield-clang.mp3`,
    // cinematic beats: the finisher's slow motion in and its last blow
    'slowmo-swell': `${A}/audio/sfx/slowmo-swell.mp3`,
    'slowmo-boom': `${A}/audio/sfx/slowmo-boom-lv.mp3`,
    // stingers: a champion's or Andhaka's coming, the Third Eye opening, a fight won, the heart
    // at low prana, a chapter's title
    braam: `${A}/audio/sfx/braam.mp3`,
    riser: `${A}/audio/sfx/riser.mp3`,
    victory: `${A}/audio/sfx/victory.mp3`,
    heartbeat: `${A}/audio/sfx/heartbeat.mp3`,
    'title-shimmer': `${A}/audio/sfx/title-shimmer.mp3`,
    // the ghats' life: the crowd's murmur (a loop), the cows and the street dogs
    crowd: `${A}/audio/sfx/crowd-murmur.mp3`,
    'cow-moo': `${A}/audio/sfx/cow-moo-lv.mp3`,
    'dog-bark': `${A}/audio/sfx/dog-bark.mp3`,
    'dog-yelp': `${A}/audio/sfx/dog-yelp.mp3`,
  },
};

export class Assets {
  constructor() {
    // People GLBs are meshopt-compressed (tools/bake-people.mjs)
    this.gltf = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    this.progress = 0;
    this.total = 0;
    this.done = 0;
    this.onProgress = null;
  }

  _tick() {
    this.done++;
    this.onProgress?.(this.done / Math.max(1, this.total));
  }

  async track(promise) {
    this.total++;
    try {
      return await promise;
    } catch (e) {
      console.warn('[assets]', e.message || e);
      return null;
    } finally {
      this._tick();
    }
  }

  gltfAsync(url) {
    return this.track(this.gltf.loadAsync(url));
  }

  image(url) {
    return this.track(loadImage(url));
  }

  // Audio is fetched as ArrayBuffers now and decoded after the first click (AudioContext rule).
  audioBuffer(url) {
    return this.track(
      fetch(url).then((r) => {
        if (!r.ok) throw new Error(`audio ${url}: ${r.status}`);
        return r.arrayBuffer();
      })
    );
  }
}
