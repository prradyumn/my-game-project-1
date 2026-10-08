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
    // shared motion packs (skeleton + clips) by body type: adult male / adult female / child
    packs: { m: 'motions-m', f: 'motions-f', c: 'motions-c' },
  },
  character: {
    // Prady, rigged by Uthana with a Mixamo-named skeleton (game copy with 2K textures;
    // the full-resolution originals are in /source-assets, outside the web build).
    model: `${A}/characters/prady-game-2k.glb`,
    // Motion-capture idle/walk/run (Mixamo, from the three.js examples) retargeted onto Prady's
    // skeleton by tools/retarget.html (src/gameplay/Retarget.js). Preferred over the clips below.
    mocap: `${A}/characters/prady-mocap.json`,
    // + CMU motion capture: the greeting wave (G) and idle breaks
    mocapClips: {
      idle: 'idle', walk: 'walk', run: 'run', swim: 'swimCrawl',
      wave: 'wave', stretch: 'stretch', lookAround: 'lookAround', pranam: 'pranam',
      meditate: 'meditate', sitToStand: 'sitToStand', crouchReach: 'crouchReach', stepUp: 'stepUp', diveTakeoff: 'diveTakeoff',
      // combat (CMU: boxer 13, karate 135, swordplay 02, woodcutter 79)
      guard: 'guard', oneTwo: 'oneTwo', bodyShot: 'bodyShot', frontKick: 'frontKick', roundKick: 'roundKick',
      thrust: 'thrust', parry: 'parry', swordStance: 'swordStance', slashA: 'slashA', slashB: 'slashB', heavyCut: 'heavyCut',
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
  textures: {
    stone: `${A}/textures/seamless-tileable-texture-straight-top-d-cmuyhilb.png`,
    plaster: `${A}/textures/seamless-tileable-texture-flat-front-on-cmuyhin9.png`,
    sand: `${A}/textures/seamless-tileable-texture-straight-top-d-cmuyhip5.png`,
    // Generated with Gemini (tools/gemini-image.mjs); 2K originals in /source-assets/textures
    carving: `${A}/textures/gemini-temple-carving.jpg`,
    wood: `${A}/textures/gemini-wood-planks.jpg`,
    straw: `${A}/textures/gemini-straw-thatch.jpg`,
  },
  keyArt: `${A}/images/cinematic-key-art-for-a-mythological-ope-cmuyh9f3.png`,
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
