import * as THREE from 'three';
import { DEFAULT_SETTINGS, DIFFICULTY, FAR_BANK_V, GHATS, PLAYER, SACRED_FLAMES, SHAKTI } from '../config.js';
import { ASSET_MANIFEST, Assets } from './Assets.js';
import { AudioManager } from './AudioManager.js';
import { ACTIONS, Input, keyName } from './Input.js';
import { Haptics } from './Haptics.js';
import { Physics } from './Physics.js';
import { RenderSystem } from './Renderer.js';
import { CameraRig } from '../gameplay/CameraRig.js';
import { CharacterAnimator } from '../gameplay/CharacterAnimator.js';
import { MooredBoats, PlayerBoat, prepareBoatGeometry, proceduralBoatGeometry } from '../gameplay/Boats.js';
import { Player } from '../gameplay/Player.js';
import { PradyActions } from '../gameplay/Actions.js';
import { ClothSway } from '../gameplay/ClothSway.js';
import { Missions } from '../gameplay/Missions.js';
import { Combat, synthBladeHit, synthBladeWhoosh, synthBlock, synthBodyHit, synthDraw, synthParry, synthSheathe, synthThump, synthWhoosh } from '../gameplay/Combat.js';
import { Health } from '../gameplay/Health.js';
import { AsuraSystem } from '../gameplay/Asuras.js';
import { Encounters } from '../gameplay/Encounters.js';
import { BattleMusic } from '../gameplay/BattleMusic.js';
import { Score } from '../gameplay/Score.js';
import { Establishing } from '../gameplay/Establishing.js';
import { Oars } from '../gameplay/Oars.js';
import { PhysicsProps, synthBrassClang, synthClayBreak, synthClayKnock, synthWicker } from '../world/PhysicsProps.js';
import { BoatRace } from '../gameplay/BoatRace.js';
import { RiverAarti } from '../gameplay/RiverAarti.js';
import { Siddhis } from '../gameplay/Siddhis.js';
import { Powers, synthDamaru, synthOm } from '../gameplay/Powers.js';
import { Finishers } from '../gameplay/Finishers.js';
import { Cinematics } from '../gameplay/Cinematics.js';
import { Projectiles, synthFireball } from '../gameplay/Projectiles.js';
import { Traversal } from '../gameplay/Traversal.js';
import { WorldEvents } from '../gameplay/WorldEvents.js';
import { Achievements } from '../gameplay/Achievements.js';
import { Journal } from '../ui/Journal.js';
import { Kitchen } from '../world/Kitchen.js';
import { BhairavTemple } from '../world/BhairavTemple.js';
import { RamnagarFort } from '../world/Ramnagar.js';
import { synthEmberHiss, synthHowl } from '../world/AsuraLook.js';
import { LockOn } from '../gameplay/LockOn.js';
import { Targets } from '../gameplay/Targets.js';
import { TestMenu } from '../gameplay/TestMenu.js';
import { Story } from '../gameplay/Story.js';
import { Quest } from '../gameplay/Quest.js';
import { UI } from '../ui/UI.js';
import { makeSurfaceSet, pbrSet, proceduralSurface } from '../utils/textures.js';
import { lerp } from '../utils/math.js';
import { PHOTO_FILTERS, applyGrade } from './Grading.js';
import { playIntro } from '../ui/IntroVideo.js';
import { FOG } from '../world/Atmosphere.js';
import { OCCLUDE, WORLD_UNIFORMS, makeWaterAware } from '../world/materials.js';
import { RippleSystem, SmokeSystem, SplashSystem } from '../world/Particles.js';
import { FireSystem } from '../world/Fire.js';
import { NightScene } from '../world/Night.js';
import { Birds, FloatingDiyas, GroundPigeons } from '../world/Life.js';
import { Crowd } from '../world/Crowd.js';
import { Animals } from '../world/Animals.js';
import { Navigation } from '../world/NavMesh.js';
import { Barks } from '../world/Barks.js';
import { SkySystem } from '../world/SkySystem.js';
import { Mist } from '../world/Mist.js';
import { Wake } from '../world/Wake.js';
import { FloatingFlowers } from '../world/FloatingFlowers.js';
import { Fireworks, synthBoom, synthCrackle, synthWhistle } from '../world/Fireworks.js';
import { SkyLanterns } from '../world/SkyLanterns.js';
import { Underwater } from '../world/Underwater.js';
import { Weather, synthRain, synthThunder } from '../world/Weather.js';
import { Water } from '../world/Water.js';
import { buildWorld } from '../world/World.js';
import { GHAT_SEGMENTS, LANDING_1, PROFILE_LEN, bankCoords, frameAtX, ghatById, ghatToWorld, groundHeight, segmentForX } from '../world/WorldLayout.js';

const frameN = (x) => frameAtX(x).N;

const SAVE_KEY = 'prady-save-v1'; // the single save from before journeys had slots (read once, kept)
const SLOTS = 3;
const slotKey = (i) => `lov-slot-${i}`;
const LAST_KEY = 'lov-last-slot';
const SETTINGS_KEY = 'prady-settings-v1';
const DEBUG = new URLSearchParams(location.search).has('debug');
const NO_CROWD = new URLSearchParams(location.search).has('nocrowd');
const FIXED_DT = 1 / 60;

function loadJSON(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}
function saveJSON(key, v) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode */
  }
}

const ZERO_VEL = new THREE.Vector3();

export class Game {
  constructor(canvas, uiRoot) {
    this.canvas = canvas;
    this.settings = { ...DEFAULT_SETTINGS, ...(loadJSON(SETTINGS_KEY) || {}) };
    this.ui = new UI(uiRoot, { keyArt: ASSET_MANIFEST.keyArt });
    this.state = 'loading';
    this.lastTime = performance.now();
    this.fpsAcc = { t: 0, n: 0, fps: 0 };
    this.photo = false;
    this.pradyWet = { value: 0 }; // wet skin: fresh out of the river, or in the rain
    const game = this;
    this.worldState = {
      shrines: new Set(),
      serialize() {
        return { shrines: [...this.shrines], raceBest: game.race?.serialize() ?? null, places: game.establishing?.serialize() };
      },
      restore(d) {
        this.shrines = new Set(d?.shrines || []);
        game.race?.restore(d?.raceBest);
        game.establishing?.restore(d?.places);
      },
    };
    this.timeScale = 1; // slow motion (a perfect parry, a fall)
    this.slowT = 0;
    this.timers = []; // [{ t, fn }] in game time (pause stops them)
  }

  /** Run fn after `secs` of game time. */
  after(secs, fn) {
    this.timers.push({ t: secs, fn });
  }

  /** Slow the whole world to `scale` for `secs` (real) seconds. */
  slowMo(scale, secs) {
    this.timeScale = scale;
    this.slowT = secs;
  }

  async init() {
    const ui = this.ui;
    const assets = new Assets();
    assets.onProgress = (p) => ui.setLoading(p * 0.75, 'Gathering the city…');

    // Kick off every download in parallel.
    const M = ASSET_MANIFEST;
    this.assets = assets;
    const pChar = assets.gltfAsync(M.character.model);
    const pClips = Object.fromEntries(Object.entries(M.character.clips).map(([k, url]) => [k, assets.gltfAsync(url)]));
    const pMocap = assets.track(fetch(M.character.mocap).then((r) => (r.ok ? r.json() : null)));
    const pMoves = M.character.moves ? assets.track(fetch(M.character.moves).then((r) => (r.ok ? r.json() : null))) : null;
    const pMoves2 = M.character.moves2 ? assets.track(fetch(M.character.moves2).then((r) => (r.ok ? r.json() : null))) : null;
    const pBoat = assets.gltfAsync(M.boat);
    const pBoatLod = assets.gltfAsync(M.boatLod);
    const pTex = Object.fromEntries(Object.entries(M.textures).map(([k, url]) => [k, assets.image(url)]));
    const pPbr = Object.fromEntries(Object.entries(M.pbr || {}).map(([k, s]) => [k, Promise.all([assets.image(s.map), assets.image(s.normal), assets.image(s.arm)])]));
    this.audio = new AudioManager();
    const pAudio = Object.entries(M.audio).map(([k, url]) => assets.audioBuffer(url).then((ab) => this.audio.setRaw(k, ab)));
    const physics = await Physics.create();
    this.physics = physics;

    // Renderer, scene, camera
    this.rs = new RenderSystem(this.canvas, this.settings);
    const renderer = this.rs.renderer;
    const scene = new THREE.Scene();
    // world matrices are updated once per frame in the loop, not again by every scene render
    // (the mirror and the main view): 3k objects, most of them crowd bones, ~2 ms a pass
    scene.matrixWorldAutoUpdate = false;
    this.scene = scene;
    const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 3000);
    this.camera = camera;
    camera.layers.enable(1); // sky-only extras (stars) that the water mirror skips
    camera.layers.enable(2); // things on or near the water the mirror skips (people, foam, petals)
    scene.add(camera);

    // Surfaces (photo -> seamless PBR set, or a procedural stand-in)
    const textures = {};
    for (const [k, p] of Object.entries(pTex)) {
      const img = await p;
      ui.setLoading(0.78, 'Weathering the sandstone…');
      const strength = { sand: 4, carving: 6, wood: 3.5, straw: 3.5 }[k] ?? 3;
      // a real PBR set where there is one (Poly Haven), else the photo made into a set
      const pbr = pPbr[k] ? await pPbr[k] : null;
      if (pbr && pbr.every(Boolean)) textures[k] = pbrSet(pbr, M.pbr[k]);
      else textures[k] = img ? makeSurfaceSet(img, { normalStrength: strength, roughness: k === 'plaster' ? [0.8, 0.98] : [0.7, 0.95] }) : proceduralSurface(k);
      for (const t of Object.values(textures[k])) t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    }

    ui.setLoading(0.8, 'Raising the ghats…');
    await new Promise((r) => setTimeout(r, 30));
    this.sky = new SkySystem(renderer, scene, this.rs.quality);
    this.sky.timeSpeed = this.settings.timeSpeed;
    this.world = buildWorld(scene, textures, physics);
    this.nav = new Navigation();
    this.water = new Water(renderer, scene, this.rs.quality);

    ui.setLoading(0.88, 'Lighting the lamps…');
    this.fire = new FireSystem(3200, 40);
    this.smoke = new SmokeSystem(24, 30);
    this.splash = new SplashSystem(700);
    this.ripples = new RippleSystem(72);
    scene.add(this.fire.points, this.smoke.points, this.splash.points, this.ripples.mesh);
    this.mist = new Mist();
    scene.add(this.mist.group);
    this.weather = new Weather({ scene, camera, audio: this.audio, splash: this.splash, ripples: this.ripples, water: this.water, quality: this.settings.quality });
    this.weather.setMode(this.settings.weather || 'auto');
    this.audio.synth('rain', synthRain);
    this.audio.synth('thunder', synthThunder);
    this.birds = new Birds(160);
    scene.add(this.birds.mesh);
    this.diyas = new FloatingDiyas(this.water, this.fire, 120);
    scene.add(this.diyas.group);
    this.pigeons = new GroundPigeons(this.world.layout.pigeonSpots, { audio: this.audio });
    scene.add(this.pigeons.mesh);
    // Amma's kitchen at Kedar Ghat (Chapter II)
    this.kitchen = new Kitchen({ scene, physics, textures, fire: this.fire, smoke: this.smoke });
    this.world.layout.clutter.push(...this.kitchen.clutter);
    // Kaal Bhairav's temple on the first lane behind Panchganga (Chapter V)
    this.bhairav = new BhairavTemple({ scene, physics, textures, fire: this.fire, lot: { ...this.world.layout.bhairav, bankX: 361 }, murtiUrl: M.murti });
    this.world.layout.clutter.push(...this.bhairav.clutter);
    // Ramnagar Fort on the far bank, upstream (Chapter V)
    this.ramnagar = new RamnagarFort({ scene, physics, textures, fire: this.fire });
    // the galis: a diya burns in every hidden shrine
    for (const f of this.world.galis.shrineFlames) this.fire.add(f, 0.45, true);
    // Manikarnika: two of the pyres smoulder day and night
    this.heatSources = [];
    this.world.layout.pyres.forEach((p, i) => {
      if (i % 2) return;
      this.fire.add(new THREE.Vector3(p.x, p.y + 1.15, p.z), 1, true, 'pyre');
      this.heatSources.push({ x: p.x, y: p.y + 1.3, z: p.z, h: 3.2, amt: 1 });
    });
    this.wake = new Wake(this.water, this.rs.qualityName === 'low' ? 200 : 360);
    this.flowers = new FloatingFlowers(this.water, this.rs.qualityName);
    scene.add(this.wake.mesh, this.flowers.mesh);
    this.underwater = new Underwater({ water: this.water, quality: this.rs.qualityName });
    scene.add(this.underwater.group);
    // Dev Deepawali: sky lanterns and fireworks (a wedding's fireworks on ordinary nights)
    this.lanterns = new SkyLanterns(this.rs.qualityName === 'low' ? 70 : 140);
    this.fireworks = new Fireworks({ audio: this.audio });
    scene.add(this.lanterns.mesh, this.fireworks.points);
    this.audio.synth('fw-whistle', synthWhistle);
    this.audio.synth('fw-boom', synthBoom);
    this.audio.synth('fw-crackle', synthCrackle);

    // Prady
    const gltf = await pChar;
    const clips = {};
    const mocap = await pMocap;
    this.rootMotion = mocap?.rootMotion || {};
    if (mocap?.clips) {
      for (const [role, name] of Object.entries(M.character.mocapClips)) {
        const j = mocap.clips.find((c) => c.name === name);
        if (j) clips[role] = THREE.AnimationClip.parse(j);
      }
      clips.mocap = true;
    }
    // the traversal moves (vault, scramble, ladder) from their own file
    const moves = await pMoves;
    for (const j of moves?.clips || []) clips[j.name] = THREE.AnimationClip.parse(j);
    const moves2 = await pMoves2;
    for (const j of moves2?.clips || []) clips[j.name] = THREE.AnimationClip.parse(j);
    for (const [k, p] of Object.entries(pClips)) {
      const g = await p;
      if (!clips[k] && g?.animations?.length) {
        clips[k] = g.animations[0];
        clips[k].name = k;
      }
    }
    this.buildCharacter(gltf, clips);

    // Boats
    const boatG = await pBoat;
    const boatGeo = (boatG && prepareBoatGeometry(boatG.scene)) || proceduralBoatGeometry();
    makeWaterAware(boatGeo.material, { wetness: false, puddles: false });
    const lodG = await pBoatLod;
    const lodGeo = (lodG && prepareBoatGeometry(lodG.scene)) || boatGeo;
    if (lodGeo !== boatGeo) makeWaterAware(lodGeo.material, { wetness: false, puddles: false });
    this.moored = new MooredBoats(lodGeo, this.world.layout.boats.moored);
    // solid hulls: a swimmer goes round them (or climbs aboard), never through
    // the moored hulls as they are built (measured off the boat model, the same for all): the
    // bottom boards, the sides to the gunwale, three thwarts and the raised decks at bow and stern.
    // [x, y, z, w, h, d] in the boat's frame. Walked onto from the steps, he stands on the boards
    // and steps over the seats; he no longer wades through planking or floats over the bilge.
    const HULL = [
      [0, -0.15, 0.2, 1.9, 0.5, 4.1],
      [-0.99, 0.42, 0.2, 0.14, 0.66, 4.1],
      [0.99, 0.42, 0.2, 0.14, 0.66, 4.1],
      [0, 0.4, -1.0, 1.84, 0.6, 0.32],
      [0, 0.37, 0.5, 1.84, 0.54, 0.32],
      [0, 0.38, 2.0, 1.84, 0.56, 0.32],
      [0, 0.4, -2.68, 1.7, 1.0, 1.66],
      [0, 0.36, 2.92, 1.5, 0.92, 1.36],
    ];
    for (const b of this.world.layout.boats.moored) {
      const c = Math.cos(b.yaw);
      const s = Math.sin(b.yaw);
      for (const [x, y, z, w, h, d] of HULL) physics.addBox(b.x + c * x + s * z, y, b.z - s * x + c * z, w, h, d, b.yaw);
    }
    scene.add(this.moored.mesh);
    this.boat = new PlayerBoat(boatGeo, this.world.layout.boats.player);
    this.boat.moored = this.moored; // (hull against hull)
    this.boatGeo = boatGeo;
    // the oars (every rowing boat's pair, one instanced mesh)
    this.oars = new Oars(scene);
    this.oars.add(this.boat);
    scene.add(this.boat.object);

    // Kashi after dark: ghat diyas, festival lights, boat lanterns, Milky Way
    this.night = new NightScene({ scene, layout: this.world.layout, fire: this.fire, lampPosts: this.world.props.lampPosts, moored: this.moored, boat: this.boat });
    console.info(`[night] ${this.night.stats.diyas} diyas, ${this.night.stats.bulbs} festival bulbs`);

    // Player + camera
    const start = this.world.layout.playerStart;
    this.input = new Input(this.canvas);
    this.camRig = new CameraRig(camera, physics);
    this.camRig.yaw = start.yaw;
    this.fx = this.makeFx();
    // loose things that tumble, shatter and float (pots, lotas, baskets)
    this.looseProps = new PhysicsProps(this);
    this.player = new Player({ physics, water: this.water, model: this.character, animator: this.animator, start, fx: this.fx });
    this.camRig.excludeCollider = this.player.collider;
    this.actions = new PradyActions(this.player, {
      scene,
      physics,
      water: this.water,
      fx: this.fx,
      animator: this.animator,
      diyas: this.diyas,
      ripples: this.ripples,
      splash: this.splash,
      sky: this.sky,
      camRig: this.camRig,
      ui,
      audio: this.audio,
      onEvent: (type, data) => this.missions?.onEvent?.(type, data),
    });
    // fighting: bare hands, or the talwar once Tulsi Akhara's guru gives it. Everything that can
    // be struck is in one registry (the akhara's dummies here; Asuras add themselves).
    this.targets = new Targets();
    const ak = this.world.akhara;
    for (const d of ak?.dummies ?? []) {
      this.targets.add({ kind: 'dummy', pos: d, radius: 0.24, height: 2, alive: true, enemy: false, touch: (pt, r) => ak.touching(pt, r) === d, hit: (h) => ak.hit(d, h.dir.x, h.dir.z, h.k, h.at) });
    }
    this.health = new Health(100);
    this.combat = new Combat({
      player: this.player,
      animator: this.animator,
      scene,
      audio: this.audio,
      camRig: this.camRig,
      rootMotion: this.rootMotion,
      targets: this.targets,
      health: this.health,
      onEvent: (type, data) => this.onCombatEvent(type, data),
    });
    this.combat.props = this.looseProps; // (a strike that meets a pot or a lota moves it)
    this.player.combat = this.combat;
    this.manifestEnemies = M.enemies;
    this.asuras = new AsuraSystem(this);
    this.encounters = new Encounters(this);
    this.battleMusic = new BattleMusic(this);
    this.score = new Score(this);
    this.barks = new Barks(this);
    this.establishing = new Establishing(this);
    this.race = new BoatRace(this);
    this.riverAarti = new RiverAarti(this);
    this.audio.synth('ember-hiss', synthEmberHiss);
    this.audio.synth('howl', synthHowl);
    this.lockOn = new LockOn({ targets: this.targets, camRig: this.camRig, player: this.player, combat: this.combat, camera, ui });
    // what Prady earns and what he can do with it; how he gets over things; what is earned
    this.haptics = new Haptics(this.input);
    this.achievements = new Achievements(this);
    this.siddhis = new Siddhis(this);
    this.projectiles = new Projectiles(this);
    this.powers = new Powers(this);
    this.player.powers = this.powers;
    this.finishers = new Finishers(this);
    this.cinematics = new Cinematics(this);
    this.traversal = new Traversal(this);
    this.player.traversal = this.traversal;
    this.player.onHardLanding = (impact, speed) => this.hardLanding(impact, speed);
    this.tracker = null; // what the journal pins: { label, x, y, z }
    this.audio.synth('damaru', synthDamaru);
    this.audio.synth('om', synthOm);
    this.audio.synth('fireball', synthFireball);
    for (const [n, f] of [['whoosh', synthWhoosh], ['blade-whoosh', synthBladeWhoosh], ['thump', synthThump], ['blade-hit', synthBladeHit], ['blade-draw', synthDraw], ['blade-sheathe', synthSheathe], ['block', synthBlock], ['parry', synthParry], ['hurt', synthBodyHit], ['clay-knock', synthClayKnock], ['clay-break', synthClayBreak], ['brass-clang', synthBrassClang], ['wicker', synthWicker]]) this.audio.synth(n, f);
    this.player.actions = this.actions;
    this.camRig.waterHeightAt = (x, z) => this.water.heightAt(x, z);
    const rat = this.world.layout.flames.find((f) => f.id === 'ratneshwar');
    if (rat) this.water.setEddy(rat.x, rat.z);

    // Quest + HUD
    this.quest = new Quest({ scene, layout: this.world.layout, props: this.world.props, fire: this.fire, smoke: this.smoke, water: this.water, audio: this.audio, ui, sky: this.sky });
    this.quest.onLit = (id, silent) => {
      if (silent) return;
      this.story?.onEvent('flame', { id });
      this.achievements?.event('flames', { n: this.quest.litCount });
    };
    this.quest.onBead = (n) => this.achievements?.event('beads', { n });
    this.quest.onComplete = () => {
      this.player.blessing = true;
      ui.setObjectives(this.quest.objectives(), true);
      this.save();
    };
    ui.setObjectives(this.quest.objectives(), false);

    // A soft key light that keeps Prady readable at night (the moon alone leaves him a black
    // shape against the river): warm, no shadows, riding above his shoulder on the camera side.
    this.heroLight = new THREE.PointLight(0xffc89a, 0, 7, 2);
    scene.add(this.heroLight);
    // Four pooled point lights give real warm light around the nearest flames and lamps.
    this.lightPool = [];
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xff9a48, 0, 26, 2);
      scene.add(l);
      this.lightPool.push(l);
    }
    this.lightTimer = 0;

    // The people of the ghats (bodies stream in after the title screen is up)
    if (!NO_CROWD) {
      try {
        this.crowd = new Crowd({
          scene,
          physics,
          layout: this.world.layout,
          props: this.world.props,
          water: this.water,
          fx: this.fx,
          ripples: this.ripples,
          fire: this.fire,
          smoke: this.smoke,
          moored: this.moored,
          renderer,
          camera,
          sun: this.sky.sun,
          exclude: this.player.collider,
          manifest: M.people,
          quality: this.settings.quality,
        });
        this.crowd.audio = this.audio; // (a bumped townsman scuffs his feet)
        console.info(`[crowd] ${this.crowd.stats.slots} people planned (${this.crowd.stats.walkers} strollers, ${this.crowd.stats.groups} conversations)`);
      } catch (e) {
        console.error('[crowd] disabled:', e);
        this.crowd = null;
      }
    }
    // the cows and street dogs of the ghats (their bodies stream in like the crowd's)
    try {
      this.animals = new Animals(this);
    } catch (e) {
      console.error('[animals] disabled:', e);
      this.animals = null;
    }
    ui.setCompassMarkers([
      ...this.quest.objectives().map((o) => ({ ...o, kind: 'flame' })),
      { id: 'boat', name: 'Your boat', pos: this.boat.object.position, kind: 'boat' },
    ]);

    await Promise.all(pAudio);
    const pSound = this.audio.prepare(); // decodes off the main thread while shaders compile
    this.rs.buildComposer(scene, camera);
    this.applySettings();

    // Warm up: one update + render so shaders compile behind the title screen.
    ui.setLoading(0.95, 'Compiling shaders…');
    this.update(0.016, true);
    scene.updateMatrixWorld();
    renderer.compile(scene, camera);
    this.rs.render(this.sky.exposure);
    await pSound;
    ui.setLoading(1, 'Ready');

    window.addEventListener('resize', () => this.rs.resize());
    this.input.onLockChange = (locked) => {
      // (freed on purpose with Cmd / Option: keep playing, the cursor is the player's)
      if (!locked && this.input.freed) return;
      if (locked) this.input.freed = false;
      // a lock that lands while a menu is open (a late request from a jump or a resume) would
      // hide the cursor and send every click to the canvas: give the mouse back
      if (locked && (this.state === 'journal' || this.state === 'paused' || this.state === 'title')) return this.input.exitLock();
      if (!locked && this.state === 'play' && !this.photo) this.pause();
    };
    this.canvas.addEventListener('click', () => {
      if (this.state === 'play') this.input.requestLock();
    });

    this.missions = new Missions(this, null);
    this.worldEvents = new WorldEvents(this);
    this.journal = new Journal(this, this.ui.root);
    this.story = new Story(this);
    this.testMenu = new TestMenu(this);
    this.registerChapterJumps();
    this.registerMissionJumps();
    this.registerFightJumps();
    this.registerRiverJumps();
    this.registerExtraJumps();
    this.migrateSave();
    const last = loadJSON(LAST_KEY);
    const lastSave = last ? loadJSON(slotKey(last)) : null;
    ui.showTitle({
      hasSave: !!lastSave,
      settings: this.settings,
      onBegin: () => this.newJourney(),
      onContinue: () => this.startSlot(last),
      onLoad: this.slotList().some(Boolean) ? () => this.openSlots('load') : null,
      onTest: () => this.testMenu.open('title'),
      onQuality: (q) => this.setSetting('quality', q),
      onDifficulty: (d) => this.setSetting('difficulty', d),
      onIntro: () => playIntro({ force: true }),
    });
    this.state = 'title';
    this.loop();
    this.crowd?.load(assets.gltf);
    // where things can walk: once every static collider exists (the navmesh is checked against them)
    this.nav.load(this.physics);
  }

  buildCharacter(gltf, clips) {
    const wrapper = new THREE.Group();
    wrapper.name = 'prady';
    if (gltf) {
      const model = gltf.scene;
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model, true);
      const h = box.max.y - box.min.y || 1;
      const s = ASSET_MANIFEST.character.height / h;
      model.scale.multiplyScalar(s);
      const c = box.getCenter(new THREE.Vector3());
      model.position.set(-c.x * s, -box.min.y * s, -c.z * s);
      model.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          o.frustumCulled = false;
          if (o.material) {
            makeWaterAware(o.material, { caustics: true, wetness: false, puddles: false, selfWet: this.pradyWet });
            if (o.isSkinnedMesh && o.material.map && !this.cloth) this.cloth = new ClothSway(o.material);
          }
        }
      });
      wrapper.add(model);
      wrapper.updateMatrixWorld(true);
      this.animator = new CharacterAnimator(model, clips);
    } else {
      // Fallback body so the game still runs without the asset.
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 1.1, 6, 12).translate(0, 0.85, 0), new THREE.MeshStandardMaterial({ color: 0xff8a2a }));
      body.castShadow = true;
      wrapper.add(body);
      this.animator = { update() {} };
    }
    this.character = wrapper;
    this.scene.add(wrapper);
  }

  // Photo mode: save exactly what is on screen (read straight after the render, same frame)
  savePhoto() {
    this._snap = false;
    this.missions?.emit('photo', {});
    if (this.photo) this.achievements.event('photo', {});
    const canvas = this.rs.renderer.domElement;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      const t = new Date();
      a.download = `kashi-${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}-${String(t.getHours()).padStart(2, '0')}${String(t.getMinutes()).padStart(2, '0')}${String(t.getSeconds()).padStart(2, '0')}.png`;
      a.href = URL.createObjectURL(blob);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      this.ui.toast(this.photo ? 'Photo saved' : 'Screenshot saved', `${a.download} · in your Downloads`, 2.5);
    }, 'image/png');
  }

  // world height of Prady's lower ankle (the cloth sway fades out above it)
  footY() {
    const a = this.animator.boneWorld('LeftFoot', this._fl || (this._fl = new THREE.Vector3()));
    const b = this.animator.boneWorld('RightFoot', this._fr || (this._fr = new THREE.Vector3()));
    return a && b ? Math.min(a.y, b.y) : this.player.feetY + 0.08;
  }

  // Foam behind the boat and around a swimmer; floating offerings part around both.
  updateRiverSurface(dt, light) {
    const b = this.boat;
    const pushers = this._pushers || (this._pushers = [{ x: 0, z: 0, r: 0 }, { x: 0, z: 0, r: 0 }]);
    if (dt > 0) {
      this.wake.hull('boat', { x: b.x, z: b.z, yaw: b.yaw, speed: b.speed });
      const p = this.player;
      if (p.state === 'swim') this.wake.swimmer('prady', { x: p.position.x, z: p.position.z, yaw: p.yaw, speed: p.speed });
      else this.wake.emitters.delete('prady');
    }
    this.wake.update(dt, light);
    pushers[0].x = b.x;
    pushers[0].z = b.z;
    pushers[0].r = 3.4;
    const swim = this.player.state === 'swim' || this.player.state === 'dive';
    pushers[1].x = this.player.position.x;
    pushers[1].z = this.player.position.z;
    pushers[1].r = swim ? 1.1 : 0;
    this.flowers.update(dt, { camera: this.camera, pushers });
  }

  makeFx() {
    const g = this;
    let swimOn = false;
    return {
      splash(x, y, z, power) {
        g.splash.spawn(new THREE.Vector3(x, y, z), Math.round(30 * power + 10), 2 + power * 3);
        g.ripples.spawn(x, y, z, 2.5 * power + 1, 2.2);
        g.audio.play('splash', { at: new THREE.Vector3(x, y, z), volume: 0.5 + power * 0.5 });
      },
      spray(x, y, z) {
        g.splash.spawn(new THREE.Vector3(x, y, z), 6, 1.8, 0.5);
        if (Math.random() < 0.3) g.ripples.spawn(x, y, z, 1.2, 1.2);
      },
      wade(x, y, z) {
        g.ripples.spawn(x, y, z, 1.2, 1.2);
        g.splash.spawn(new THREE.Vector3(x, y, z), 4, 1.2, 0.3);
        g.audio.play('splash', { at: new THREE.Vector3(x, y, z), volume: 0.18, rate: 1.3 + Math.random() * 0.2 });
      },
      ripple(x, y, z, size) {
        g.ripples.spawn(x, y, z, size, 1.8);
      },
      footstep(speed) {
        g.audio.play('footstep', { volume: 0.25 + Math.min(speed, 7) * 0.04, rate: 0.9 + Math.random() * 0.2 });
      },
      // wet prints on the stone after the river or in the rain
      footprint(side) {
        const foot = g.animator.boneWorld?.(side === 'Left' ? 'LeftFoot' : 'RightFoot', new THREE.Vector3());
        if (!foot) return;
        const y = groundHeight(foot.x, foot.z);
        if (foot.y - y > 0.35) return;
        g.weather?.footstep(foot.x, y, foot.z, g.player.yaw, side === 'Left' ? 1 : -1, g.actions?.wet ?? 0);
      },
      land(impact = 4) {
        g.audio.play('footstep', { volume: Math.min(1, 0.4 + impact * 0.06), rate: 0.8 });
        if (impact > 6) g.camRig.shake(Math.min(0.55, (impact - 6) / 14));
      },
      // wood on wood: one boat knocking another
      bump(x, z, speed) {
        g.audio.play('thump', { at: new THREE.Vector3(x, 0.4, z), volume: Math.min(1, 0.3 + speed * 0.25), rate: 0.7 + Math.random() * 0.15, ref: 8 });
        g.ripples.spawn(x, 0, z, 1.2 + speed * 0.4, 1.4);
      },
      oar(x, z) {
        g.audio.play('oar', { at: new THREE.Vector3(x, 0, z), volume: 0.8, rate: 0.95 + Math.random() * 0.1 });
      },
      swimming(on) {
        if (on === swimOn) return;
        swimOn = on;
        g.loops?.swim?.setVolume(on ? 0.6 : 0, 0.25);
      },
    };
  }

  // ---------------------------------------------------------------- journeys (save slots)
  migrateSave() {
    if (this.slotList().some(Boolean)) return;
    const old = loadJSON(SAVE_KEY);
    if (!old) return;
    saveJSON(slotKey(1), { ...old, meta: { when: Date.now(), chapter: 'Journey from before', flames: old.quest?.flames?.length ?? 0, punya: old.missions?.punya ?? 0 } });
    saveJSON(LAST_KEY, 1);
  }

  slotList() {
    return Array.from({ length: SLOTS }, (_, i) => loadJSON(slotKey(i + 1)));
  }

  newJourney() {
    const list = this.slotList();
    const free = list.findIndex((x) => !x);
    if (free < 0) return this.openSlots('new');
    this.startSlot(free + 1, true);
  }

  startSlot(i, fresh = false) {
    this.ui.closeMenu();
    this.slot = i;
    saveJSON(LAST_KEY, i);
    const data = fresh ? null : loadJSON(slotKey(i));
    if (fresh) {
      try {
        localStorage.removeItem(slotKey(i));
      } catch {
        /* ignore */
      }
    }
    this.begin(data);
  }

  /** mode 'load': pick a journey (an empty slot starts a new one); 'new': choose one to replace. */
  openSlots(mode) {
    const list = this.slotList();
    const when = (t) => (t ? new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
    this.ui.openMenu({
      title: mode === 'new' ? 'Begin a New Journey' : 'Journeys',
      note: mode === 'new' ? 'All three journeys are in use. Choose one to begin again in its place (it will be replaced).' : 'Choose a journey to continue, or an empty one to begin anew.',
      sections: [
        {
          items: list.map((d, k) => ({
            label: `Journey ${k + 1}`,
            sub: d ? `${d.meta?.chapter || ''} · ${d.meta?.flames ?? d.quest?.flames?.length ?? 0} of 5 flames · ${d.meta?.punya ?? d.missions?.punya ?? 0} punya<br>${when(d.meta?.when)}` : 'Empty — begin a new journey here',
            tag: d ? '' : 'new',
            onClick: () => {
              if (mode === 'new' && d && !confirm(`Replace Journey ${k + 1}? Its progress will be lost.`)) return;
              this.startSlot(k + 1, mode === 'new' || !d);
            },
          })),
        },
      ],
    });
  }

  // ---------------------------------------------------------------- flow
  async begin(save, opts = {}) {
    if (this.state !== 'title') return;
    this.state = 'starting';
    await this.audio.unlock();
    this.ui.hideTitle();
    this.rs.rest(150); // the first seconds stream in shaders and textures: not a reason to drop resolution
    this.loops = {
      river: this.audio.loop('river', { volume: 0.5 }),
      aarti: this.audio.loop('aartiAmbience', { volume: 0, at: this.quest.flames.find((f) => f.id === 'dashashwamedh').pos, ref: 25 }),
      underwater: this.audio.loop('underwater', { volume: 0 }),
      fire: this.audio.loop('fireLoop', { volume: 0, at: new THREE.Vector3(), ref: 4, channel: 'sfx' }),
      swim: this.audio.loop('swim', { volume: 0, channel: 'sfx' }),
      rain: this.audio.loop('rain', { volume: 0 }),
      crowd: this.audio.loop('crowd', { volume: 0 }),
    };
    // the score (the hours' ragas, the tension, the reveal) and the battle music: fetched once the
    // city is up, decoded off the main thread
    this.after(3, () => this.score.prefetch());
    this.after(5, () => this.barks.load());
    this.after(6, () => this.battleMusic.prefetch());
    // the mirror on the river skips the small things (Water.renderReflection): props, stalls,
    // the saris and kites, the ladders, the rooftop tanks
    this.scene.traverse((o) => /^(props(-\w+)?|stalls|street-life|ladders|tanks)$/.test(o.name) && this.water.skipInReflection(o));
    this.missions.restore(save?.missions);
    this.worldState.restore(save?.world);
    this.siddhis.restore(save?.siddhis);
    this.powers.restore(save?.powers);
    this.health.revive(1);
    this.combat.revive();
    this.storySave = save?.story ?? null;
    if (save) {
      this.quest.restore(save.quest);
      if (save.hours !== undefined) this.sky.setHours(save.hours);
      if (save.player) this.player.teleport(save.player.x, save.player.y, save.player.z);
      if (this.quest.complete) this.player.blessing = true;
      this.siddhis.apply();
      this.ui.setObjectives(this.quest.objectives(), this.quest.complete);
      this.story.restore(save.story, save.quest?.flames || []);
      this.after(1.5, () => this.story.showCard());
      this.state = 'play';
      this.input.requestLock();
      this.ui.showRegion('Kashi');
      return;
    }
    this.quest.restore(null);
    if (!this.testSession) this.story.restore(null, []);
    if (opts.skipIntro) {
      this.state = 'play';
      this.ui.setCinematic(false);
      this.input.requestLock();
      return;
    }
    this.startIntro();
  }

  /** The test menu's jumps into the side missions: at the giver, at a good hour, already accepted. */
  registerMissionJumps() {
    for (const def of this.missions.defs) {
      this.testMenu.add('Side missions', def.title, def.giver.name, (g) => {
        const h = def.giver.hours;
        if (h && !this.missions.available({ ...def, id: '__test' })) g.sky.setHours(h[0] <= h[1] ? (h[0] + h[1]) / 2 : h[0] + 0.5);
        g.missions.done.delete(def.id);
        const at = def.giver.at();
        const back = 2.2;
        g.testMenu.place(at.x + Math.sin(at.yaw) * back, at.y, at.z + Math.cos(at.yaw) * back, at.yaw + Math.PI);
        g.missions.update(0);
        g.missions.start(def);
      });
    }
  }

  /** Speak a voiced line (key = file under the voice folder). Returns { duration } once loaded. */
  voice(key) {
    return this.audio.speak(`${ASSET_MANIFEST.voice}/${key}.mp3`);
  }

  stopVoice() {
    this.audio.stopVoice();
  }

  preloadVoices(keys) {
    for (const k of keys) this.audio.loadVoice(`${ASSET_MANIFEST.voice}/${k}.mp3`);
  }

  /** Test menu: every chapter, and every step of it, with nothing required first. */
  registerChapterJumps() {
    const R = ['', 'I', 'II', 'III', 'IV', 'V'];
    this.story.chapters.forEach((c, ci) => {
      const grp = `Chapter ${R[c.num]} · ${c.title}`;
      c.steps.forEach((st, si) => {
        this.testMenu.add(grp, si === 0 ? 'Start the chapter' : `${si + 1}. ${st.title || st.text}`, si === 0 ? c.legend : st.text, async (g) => {
          await g.story.jump(ci, si);
        });
      });
    });
  }

  /** Test menu: the fights on their own (the chapters stage them with story around them). */
  registerFightJumps() {
    const F = 'Fights';
    const arm = (g) => {
      g.combat.setHasSword(true);
      g.combat.armed = true;
      g.combat.stance(4);
    };
    const win = (t) => () => this.ui.toast(t, 'The darkness sinks back into the river.', 4);
    this.testMenu.add(F, 'Asuras rise from the river', 'Three shades walk up out of the Ganga at Manikarnika, night', async (g) => {
      g.testMenu.placeOnGhat('manikarnika', 40, 1, 0.6);
      g.sky.setHours(21);
      arm(g);
      await g.encounters.start({ ghat: 'manikarnika', u: 40, waves: [{ n: 3, kind: 'shade' }], onWin: win('The shades are gone') });
    });
    this.testMenu.add(F, 'Waves of the dark', 'Two waves, then a Rakshasa, dusk at Scindia Ghat', async (g) => {
      g.testMenu.placeOnGhat('scindia', 40, 1, 0.6);
      g.sky.setHours(18.9);
      arm(g);
      await g.encounters.start({ ghat: 'scindia', u: 40, waves: [{ n: 2, kind: 'shade' }, { n: 3, kind: 'shade' }, { n: 1, kind: 'brute' }], onWin: win('Scindia Ghat is quiet again') });
    });
    this.testMenu.add(F, 'Andhaka, the Blind Darkness', 'The boss rises at Panchganga, midnight (three phases)', async (g) => {
      g.testMenu.placeOnGhat('panchganga', 62, 1, 0.6);
      g.sky.setHours(23.5);
      arm(g);
      await g.encounters.start({ ghat: 'panchganga', u: 62, waves: [{ kind: 'boss', name: 'Andhaka', title: 'the Blind Darkness' }], onWin: win('Andhaka is no more') });
    });
    // the new kinds, one at a time, then together, then the chapters' champions
    const one = (label, sub, ghat, u, hours, waves, done, landing = 1) =>
      this.testMenu.add(F, label, sub, async (g) => {
        g.testMenu.placeOnGhat(ghat, u, landing, landing === 0 ? 0 : 0.6);
        g.sky.setHours(hours);
        arm(g);
        await g.encounters.start({ ghat, u, waves, onWin: win(done) });
      });
    one('Pishachas: fire from afar', 'Two hurl ghost fire and keep their distance (parry it back!)', 'manikarnika', 30, 20.5, [{ n: 2, kind: 'pishacha' }], 'The fire-throwers are ash');
    one('Kavachas: the shield wall', 'Two behind bronze shields: heavy cuts and kicks break the guard', 'scindia', 30, 20.5, [{ n: 2, kind: 'kavacha' }], 'The shields are broken');
    one('Vetalas: the leapers', 'Two that bound off the haveli walls and pounce from afar (on the top of the ghat)', 'manmandir', 20, 21, [{ n: 2, kind: 'vetala' }], 'The leapers are down', 0);
    one('Every kind of the dark', 'A shade, a Rakshasa, a Pishacha, a Kavacha and a Vetala at once', 'darbhanga', 40, 21.5, [{ mix: [{ n: 1, kind: 'shade' }, { n: 1, kind: 'brute' }, { n: 1, kind: 'pishacha' }, { n: 1, kind: 'kavacha' }, { n: 1, kind: 'vetala' }] }], 'The pack is broken');
    one('Champion: Mahodara', 'Chapter II’s shielded glutton (mini-boss)', 'kedar', 40, 13, [{ kind: 'kavacha', mini: true, name: 'Mahodara', title: 'the Bottomless Belly' }], 'Mahodara is no more');
    one('Champion: Agnimukha', 'Chapter III’s fire-mouth (mini-boss)', 'dashashwamedh', 42, 19.5, [{ kind: 'pishacha', mini: true, name: 'Agnimukha', title: 'the Fire-Mouth' }], 'Agnimukha is no more');
    one('Champion: the Corpse-Rider', 'Chapter IV’s Vetala (mini-boss)', 'scindia', 18, 22, [{ kind: 'vetala', mini: true, name: 'Vetala', title: 'the Corpse-Rider of Manikarnika' }], 'The Vetala is no more');
    one('Finisher practice', 'Three shades: wear one down, break its poise (heavy cuts, a parry) and press E as it reels', 'tulsi', 50, 17, [{ n: 3, kind: 'shade' }], 'Practice done');
  }

  /** Test menu: the powers and siddhis, the rooftops, the calls for help, the achievements. */
  registerExtraJumps() {
    const S = 'Powers & siddhis';
    const T = this.testMenu;
    T.add(S, 'Every siddhi, full Shakti', 'All twelve unlocked: 1 Damaru · 2 Trishul · 3 Third Eye, charged heavy, riposte, Fourth Strike', (g) => {
      g.siddhis.grantAll();
      g.powers.shakti = SHAKTI.max;
      g.combat.setHasSword(true);
      g.combat.armed = true;
      g.combat.stance(4);
    });
    T.add(S, 'Rudraksha and embers to spend', '+40 rudraksha, +150 embers (open the journal: J, Siddhis)', (g) => {
      for (let i = 0, n = 0; i < g.quest.beads.length && n < 40; i++) if (!g.quest.beads[i].taken) (g.quest.take(i, true), n++);
      g.siddhis.embers += 150;
      g.siddhis.embersTotal += 150;
      g.openJournal('siddhis');
    });
    T.add(S, 'Powers against a pack', 'Every siddhi, full Shakti, five shades at night on Assi Ghat', async (g) => {
      g.siddhis.grantAll();
      g.powers.shakti = SHAKTI.max;
      g.combat.setHasSword(true);
      g.combat.armed = true;
      g.testMenu.placeOnGhat('assi', 40, 1, 0.6);
      g.sky.setHours(21);
      await g.encounters.start({ ghat: 'assi', u: 40, waves: [{ n: 5, kind: 'shade' }], onWin: () => g.ui.toast('The pack is gone', '', 3) });
    });
    const R = 'Rooftops & traversal';
    const ladderAt = (i) => {
      const L = this.traversal.ladders.filter((x) => !x.roof)[i] || this.traversal.ladders[0];
      if (!L) return;
      const f = this.traversal.ladderPoint(L, L.y0, new THREE.Vector3());
      this.testMenu.place(f.x + L.out.x * 1.3, L.y0, f.z + L.out.z * 1.3, Math.atan2(-L.out.x, -L.out.z));
    };
    T.add(R, 'At a ladder to the rooftops', 'Walk into it (or press E); W / S climb, Shift fast, C slides, Space lets go', (g) => {
      g.sky.setHours(15);
      ladderAt(3);
    });
    T.add(R, 'On the rooftops', 'Up on a haveli roof above Dashashwamedh: vault the parapets, climb the higher roofs, cross the planks', (g) => {
      g.sky.setHours(16.5);
      const b = g.world.layout.buildings.filter((x) => x.row === 0 && x.kind === 'haveli').sort((a, c) => Math.abs(a.x - 30) - Math.abs(c.x - 30))[0];
      g.testMenu.place(b.x, b.baseY + b.h, b.z, Math.atan2(frameN(b.x).x, frameN(b.x).z) + Math.PI / 2);
    });
    T.add(R, 'Vaults on the landing', 'Run at a takht or a railing on Dashashwamedh’s first landing', (g) => {
      g.sky.setHours(10);
      g.testMenu.placeOnGhat('dashashwamedh', 20, 1, 0);
    });
    const E = 'Establishing shots';
    for (const name of ['Dashashwamedh Ghat', 'Manikarnika Ghat', 'Assi Ghat', 'Panchganga Ghat', 'Mother Ganga', 'The Lanes of Kashi']) {
      T.add(E, name, 'The first-visit shot of this place (played once per journey in a real game)', (g) => {
        g.sky.setHours(name === 'Mother Ganga' ? 17.5 : 7.5);
        const seg = GHATS.find((x) => x.name === name);
        if (seg) g.testMenu.placeOnGhat(seg.id, 30, 1, 0);
        else if (name === 'The Lanes of Kashi') g.testMenu.place(42, 10.6, -62, 0);
        g.after(1.2, () => g.establishing.play(name));
      });
    }
    T.add(R, 'Wall run to a ledge', 'Kaal Bhairav’s compound wall: Shift + W at it, Space to run up; A / D shimmy, W climbs over, S lets go', (g) => {
      g.sky.setHours(10);
      const P = g.bhairav.L(4.5, 0, 5);
      const W = g.bhairav.L(4.5, 0, 0);
      g.testMenu.place(P.x, P.y, P.z, Math.atan2(W.x - P.x, W.z - P.z));
    });
    const W = 'Calls for help';
    const ev = (kind, label, sub, place, hours) =>
      T.add(W, label, sub, (g) => {
        g.sky.setHours(hours);
        place(g);
        g.testSession = true;
        // (calls only come once Chapter I is told: the talwar is his by then, R draws it)
        g.combat.setHasSword(true);
        g.after(0.4, () => g.worldEvents.start(kind) || g.ui.toast('Nothing fits here', '', 2));
      });
    ev('chor', 'Chor! The pickpocket', 'Catch the thief along the top of the ghats', (g) => g.testMenu.placeOnGhat('dashashwamedh', 30, 0, 0), 11);
    ev('bachao', 'Bachao! Someone in the river', 'Swim out and tow them back to the steps', (g) => g.testMenu.placeOnGhat('darbhanga', 40, 2, 0), 9);
    ev('ambush', 'Darkness at the boats', 'Asuras rise beside a boatman at night', (g) => g.testMenu.placeOnGhat('manmandir', 40, 2, 0), 22);
    ev('patang', 'Pench! A kite duel', 'Climb to the rooftops and cut a rival’s kite string', (g) => g.testMenu.placeOnGhat('dashashwamedh', 40, 0, 0), 15);
    T.add('World & test tools', 'Achievement banner', 'Show how an achievement looks when earned', (g) => g.ui.achievement('A Postcard from Kashi', 'Take a picture in photo mode.'));
  }

  registerRiverJumps() {
    const R = 'River life';
    // in his boat on the water before Dashashwamedh, bow to the river
    const inBoat = (g, out = 22) => {
      const gh = ghatById('dashashwamedh');
      const p = ghatToWorld(gh, gh.width * 0.5, PROFILE_LEN + out);
      const b = g.boat;
      if (g.player.state !== 'boat') g.player.enterBoat(b);
      b.x = b.prev.x = p.x;
      b.z = b.prev.z = p.z;
      b.vx = b.vz = 0;
      b.yaw = b.prev.yaw = Math.atan2(-gh.N.x, -gh.N.z); // facing the ghat
      g.camRig.yaw = b.yaw;
      g.camRig.first = true;
    };
    this.testMenu.add(R, 'Nauka Daud · the boat race', 'Race three boatmen downstream to Panchganga, 9:00', (g) => {
      g.sky.setHours(9);
      g.race.begin();
    });
    this.testMenu.add(R, 'Nauka Daud · the last gates', 'Start past the fifth gate (to test the finish)', (g) => {
      g.sky.setHours(9);
      g.race.begin({ fromGate: 5 });
    });
    this.testMenu.add(R, 'Aarti from the water', 'Dusk, in your boat before Dashashwamedh (E to watch)', (g) => {
      g.sky.setHours(18.6);
      inBoat(g);
    });
    this.testMenu.add(R, 'The start of the race', 'Row up to the Nauka Daud banner yourself (E to race)', (g) => {
      g.sky.setHours(8.5);
      inBoat(g, 14);
    });
  }

  /** End whatever is running (a mission, a fight, an activity) before a test jump. */
  stopActivities() {
    const m = this.missions;
    if (m?.dialogue) m.endTalk();
    if (m?.active) m.abandon(m.active);
    this.encounters?.clear?.();
    this.asuras.clear();
    this.race?.stop();
    this.riverAarti?.stop();
    this.story?.stopForTest?.();
    this.worldEvents?.stop();
    this.finishers?.reset();
    this.powers?.reset();
    this.traversal?.reset();
    this.projectiles?.clear();
    this.lockOn.release();
    if (this.health.dead || this.combat.dead) {
      this.combat.revive();
      this.health.revive(1);
    }
    this.ui.setBoss(null);
    this.ui.closeMenu();
  }

  startIntro() {
    this.state = 'intro';
    this.ui.setCinematic(true);
    const dash = ghatById('dashashwamedh');
    const P = (u, v, y) => {
      const p = ghatToWorld(dash, u, v);
      return new THREE.Vector3(p.x, y, p.z);
    };
    const pl = this.player.position;
    const back = new THREE.Vector3(-Math.sin(this.camRig.yaw), 0, -Math.cos(this.camRig.yaw));
    const endPos = new THREE.Vector3(pl.x, pl.y + 1.4, pl.z).addScaledVector(back, 4.6);
    this.camRig.playCinematic(
      [
        { t: 0, pos: P(-140, 210, 38), look: P(30, 0, 16) },
        { t: 7, pos: P(-40, 110, 16), look: P(45, 5, 12) },
        { t: 12.5, pos: P(48, 48, 7), look: new THREE.Vector3(pl.x, pl.y + 1.2, pl.z) },
        { t: 15, pos: endPos, look: new THREE.Vector3(pl.x, pl.y + 1.3, pl.z) },
      ],
      () => {
        this.state = 'play';
        this.ui.setCinematic(false);
        this.input.requestLock();
        this.ui.showRegion('Dashashwamedh Ghat');
        this.after(2.5, () => this.story.showCard());
        this.after(10, () => this.ui.toast('The Legend begins', 'Your chapter and its task are at the top left; the compass shows where to go.', 6));
      }
    );
    this.audio.play('conch', { volume: 0.7 });
    this.audio.play('narrationIntro', { channel: 'voice', delay: 1.2 });
    this.ui.subtitle('Kashi. Older than history… the city of light, where Shiva dwells. The five sacred flames of the ghats have gone dark, and Mother Ganga grows dim. Prady… rekindle the flames.', 14);
  }

  pause() {
    if (this.state !== 'play') return;
    this.state = 'paused';
    this.ui.showPause(this.settings, {
      onSetting: (k, v) => this.setSetting(k, v),
      onResume: () => this.resume(),
      onTest: () => this.testMenu.open('pause'),
      onControls: () => this.openControls(),
      onJournal: () => {
        this.ui.hidePause();
        this.state = 'play';
        this.openJournal('map');
      },
      onTime: (h) => {
        this.setTimeOfDay(h, 2.5);
        this.resume();
      },
      onReset: () => {
        try {
          if (this.slot) localStorage.removeItem(slotKey(this.slot));
        } catch {
          /* ignore */
        }
        location.reload();
      },
    });
    this.save();
  }

  resume() {
    this.ui.hidePause();
    this.state = 'play';
    this.input.requestLock();
  }

  setSetting(k, v) {
    this.settings[k] = v;
    saveJSON(SETTINGS_KEY, this.settings);
    this.applySettings(k);
  }

  applySettings(changed) {
    const s = this.settings;
    if (changed === 'quality') {
      this.rs.setQuality(s.quality);
      this.sky.configureShadows(this.rs.quality.shadows);
      this.water.setQuality(this.rs.quality);
      this.crowd?.setQuality(s.quality);
    }
    this.rs.adaptive = s.adaptiveResolution;
    this.audio.setVolume('music', s.musicVolume);
    this.audio.setVolume('sfx', s.sfxVolume);
    this.audio.setVolume('voice', Math.min(1, s.sfxVolume * 1.25));
    this.audio.setVolume('ambience', s.ambienceVolume);
    this.camRig.sensitivity = s.mouseSensitivity;
    this.camRig.invertY = s.invertY;
    this.sky.timeSpeed = s.timeSpeed;
    this.weather?.setMode(s.weather || 'auto');
    this.ui.setFpsVisible(s.showFps || DEBUG);
    // difficulty and accessibility
    const d = DIFFICULTY[s.difficulty] || DIFFICULTY.balanced;
    if (this.combat) this.combat.parryWindow = d.parryWindow;
    if (this.health) this.health.regenDiff = d.regen;
    this.camRig.shakeScale = s.shake ?? 1;
    this.ui.setAccess({ subtitleSize: s.subtitleSize ?? 1, reduceFlashes: !!s.reduceFlashes });
    this.asuras?.eyes.setWarnColor(s.telegraph);
    this.ui.root.classList.toggle('blueflare', s.telegraph === 'blue');
    if (this.haptics) this.haptics.enabled = s.rumble !== false;
    this.input.setBindings(s.bindings || {});
    // (prompts show the keys the player actually presses)
    const k = (code) => keyName(this.input.keyFor(code));
    this.ui.keys = { interact: k('KeyE'), damaru: k('Digit1'), trishul: k('Digit2'), thirdEye: k('Digit3') };
  }

  save() {
    if (!this.player || !this.slot || this.testSession) return;
    saveJSON(slotKey(this.slot), {
      quest: this.quest.serialize(),
      missions: this.missions?.serialize(),
      story: this.story?.serialize?.(),
      world: this.worldState?.serialize?.(),
      siddhis: this.siddhis?.serialize(),
      powers: this.powers?.serialize(),
      hours: this.sky.hours,
      player: this.player.state === 'boat' ? null : { x: this.player.position.x, y: this.player.feetY, z: this.player.position.z },
      meta: { when: Date.now(), chapter: this.story?.label?.() || `The Five Flames`, flames: this.quest.litCount, punya: this.missions?.punya ?? 0 },
    });
  }

  // ---------------------------------------------------------------- loop
  loop() {
    const frame = (now) => {
      requestAnimationFrame(frame);
      const dt = Math.min(0.05, Math.max(0, (now - this.lastTime) / 1000));
      this.lastTime = now;
      const t0 = performance.now();
      this.update(dt);
      this.scene.updateMatrixWorld();
      this.water.renderReflection(this.camera);
      this.rs.render(this.sky.exposure * this.weather.exposureScale());
      if (this.state === 'play' || this.state === 'intro') this.rs.adapt(dt, (performance.now() - t0) / 1000);
      if (this._snap) this.savePhoto();
      this.input.endFrame();
      this.countFps(dt);
    };
    requestAnimationFrame(frame);
  }

  countFps(dt) {
    const f = this.fpsAcc;
    f.t += dt;
    f.n++;
    if (f.t > 0.5) {
      f.fps = Math.round(f.n / f.t);
      f.t = 0;
      f.n = 0;
    }
  }

  update(dt, warmup = false) {
    const playing = this.state === 'play';
    const paused = this.state === 'paused' || this.state === 'journal';
    if (this.slowT > 0) {
      this.slowT -= dt;
      if (this.slowT <= 0) this.timeScale = 1;
    }
    const simDt = paused ? 0 : dt * this.timeScale;
    const input = this.input;
    // F9 any time: a screenshot of the game itself (no HUD), saved as a PNG
    if (!warmup && input.hit('F9') && this.state !== 'title' && this.state !== 'loading') this._snap = true;
    if (simDt > 0 && this.timers.length) {
      const due = [];
      for (const t of this.timers) if ((t.t -= simDt) <= 0) due.push(t);
      if (due.length) {
        this.timers = this.timers.filter((t) => t.t > 0);
        for (const t of due) t.fn();
      }
    }

    this.ui.padMode = input.usingPad;
    this.pollMenus(input);
    if (playing) this.handleKeys();
    if (this.state === 'intro' && (input.hit('Space') || input.hit('Enter') || input.hit('KeyE'))) this.camRig.skipCinematic();
    if (this.state === 'cutscene') this.story.updateScene(dt, input);

    // Time of day + world uniforms
    this.sky.update(simDt, this.camera.position);
    WORLD_UNIFORMS.uTime.value += simDt;
    // what the camera must keep in view (umbrellas in the way fade): Prady, and the enemy he's
    // locked on to (or Andhaka, who fills the frame anyway)
    {
      const c = this.character?.position || this.player.position;
      OCCLUDE.uFocusA.value.set(c.x, c.y + 1.1, c.z);
      const L = this.lockOn?.target?.alive ? this.lockOn.target : this.asuras?.list.find((a) => a.alive && a.K.boss);
      if (L) L.lockPoint ? L.lockPoint(OCCLUDE.uFocusB.value) : OCCLUDE.uFocusB.value.set(L.pos.x, L.pos.y + 1.2, L.pos.z);
      else OCCLUDE.uFocusB.value.y = -999;
    }
    WORLD_UNIFORMS.uSunColor.value.copy(this.sky.sunColor).multiplyScalar(Math.min(1.2, this.sky.sun.intensity / 3.0) + 0.05);
    WORLD_UNIFORMS.uCaustics.value = this.sky.sunDir.y > 0 ? 1 : 0.15;
    this.weather.applyToSky(this.sky, this.scene);
    this.weather.update(simDt, { sky: this.sky, underwater: this._under, hours: this.sky.hours });
    this.pradyWet.value = this.actions?.wet ?? 0;
    this.water.update(simDt, this.camera, this.sky);
    this.world.city.setNight(this.sky.nightFactor);
    this.world.props.setNight?.(this.sky.nightFactor);
    this.ramnagar.setNight(this.sky.nightFactor);
    if (this.timeTween) {
      // fast, smooth time-lapse to a chosen hour (always forward)
      const tw = this.timeTween;
      tw.t = Math.min(1, tw.t + dt / tw.dur);
      const e = tw.t * tw.t * (3 - 2 * tw.t);
      this.sky.setHours(tw.from + tw.span * e);
      if (tw.t >= 1) this.timeTween = null;
    }

    // Simulation: fixed 60 Hz steps (deterministic physics at any frame rate), rendered with
    // interpolation between the last two steps.
    if (!paused) {
      const controlBoat = this.player.state === 'boat';
      this.player.inputLocked = !playing || this.photo || controlBoat || !!this.missions?.dialogue || !!this.ui.rh || !!this.travelling || !!this.finishers?.active;
      this.player.readInput(input, this.camRig);
      this.boat.readInput(input, controlBoat && playing && !this.photo && !this.race?.holdInput);
      this.simAcc = (this.simAcc || 0) + simDt;
      let steps = 0;
      while (this.simAcc >= FIXED_DT && steps < 5) {
        this.player.fixedUpdate(FIXED_DT);
        this.boat.fixedUpdate(FIXED_DT, this.water, this.fx);
        this.race.fixed(FIXED_DT);
        this.looseProps.fixed(FIXED_DT);
        this.physics.step(FIXED_DT);
        this.simAcc -= FIXED_DT;
        steps++;
      }
      if (steps === 5) this.simAcc = 0; // fell far behind (tab was hidden): don't spiral
    }
    const alpha = Math.min(1, (this.simAcc || 0) / FIXED_DT);
    this.boat.lateUpdate(alpha);
    this.race.late(alpha);
    this.oars.update(simDt);
    this.player.lateUpdate(simDt, alpha);
    this.combat?.late(simDt);
    this.powers?.late();
    if (this.health) {
      const near = this.targets.enemies().some((e) => Math.hypot(e.pos.x - this.player.position.x, e.pos.z - this.player.position.z) < 25 && e.awake !== false);
      this.inCombat = near;
      this.health.update(simDt, near);
      if (playing || paused) this.ui.setHealth(this.health.frac, this.health.frac < 0.995 || near);
      if (playing) this.lockOn.update(dt, input);
      else if (this.lockOn.active && this.state !== 'paused') this.lockOn.release();
    }
    this.world.akhara?.update(simDt);
    if (this.cloth && this.animator.boneWorld) {
      const pl = this.player;
      const hips = this.animator.boneWorld('Hips', this._hipW || (this._hipW = new THREE.Vector3()));
      const vel = pl.state === 'boat' ? ZERO_VEL : pl.velocity;
      this.cloth.update(simDt, { vel, yawRate: pl.state === 'boat' ? 0 : pl.yawRate, hipY: hips ? hips.y : pl.feetY + 0.95, footY: this.footY(), facing: { x: Math.sin(pl.yaw), z: Math.cos(pl.yaw) }, swimming: pl.state === 'swim' || pl.state === 'dive' });
    }
    this.moored.update(simDt, this.water, this.camera.position);
    this.quest.update(simDt, this.rs.pixelRatio, this.sky.nightFactor, playing ? this.player.position : null);
    if (!warmup) {
      const camOpts = this.player.state === 'boat' ? { distance: 8, height: 2.2 } : this.player.state === 'swim' || this.player.state === 'dive' ? { height: 1.0 } : {};
      const boss = this.asuras.list.find((a) => a.K.boss && a.alive && Math.hypot(a.pos.x - this.player.position.x, a.pos.z - this.player.position.z) < 28);
      if (boss && !camOpts.distance) camOpts.distance = this.camRig.targetDistance + 1.3;
      const camFocus = this.player.state === 'swim' || this.player.state === 'dive' ? new THREE.Vector3(this.player.position.x, this.character.position.y + 0.9, this.player.position.z) : this.character.position;
      this.cinematics?.update(dt);
      this.camRig.update(dt, input, camFocus, camOpts);
    } else {
      const s = this.world.layout.playerStart;
      this.camera.position.set(s.x - 40, 30, s.z + 60);
      this.camera.lookAt(s.x, s.y + 5, s.z);
    }

    // Effects
    const pr = this.rs.pixelRatio;
    const light = new THREE.Color().copy(this.sky.hemi.color).multiplyScalar(lerp(0.25, 1.1, 1 - this.sky.nightFactor));
    this.fire.update(simDt, pr);
    this.smoke.update(simDt, pr, light, this.sky.nightFactor);
    this.splash.update(simDt, pr, light);
    this.ripples.update(simDt, (x, z) => this.water.heightAt(x, z), light);
    this.updateRiverSurface(simDt, light);
    if (!this._heatAll && this.crowd?.lifeProps) this._heatAll = [...this.heatSources, ...this.crowd.lifeProps.heatSpots];
    this.rs.updateHeat(this.camera, this._under ? [] : this._heatAll || this.heatSources);
    this.birds.update(simDt);
    this.pigeons.update(simDt, { camera: this.camera, player: this.state === 'play' ? this.character.position : null, playerSpeed: this.player.speed, time: WORLD_UNIFORMS.uTime.value });
    // diyas float out from Dashashwamedh every evening and night (more once the aarti is restored)
    this.diyas.update(simDt, this.quest.eveningAarti || this.quest.complete || this.sky.nightFactor > 0.6, this.ripples);
    // dawn mist on the river (and a little more haze in the air with it); sun shafts
    const mist = this.mist.update(simDt, { hours: this.sky.hours, sky: this.sky, extra: this.weather?.mistExtra ?? 0 });
    if (this.scene.fog) this.scene.fog.density *= 1 + mist * 0.9;
    {
      const e = this.sky.sunDir.y;
      const low = Math.max(0, Math.min(1, (e + 0.03) / 0.08)) * (1 - Math.max(0, Math.min(1, (e - 0.22) / 0.4)));
      const amount = (0.25 + 0.75 * low) * (e > -0.04 ? 1 : 0) * (1 - (this.weather?.overcast ?? 0));
      this.rs.updateGodRays(this.camera, this.sky.sunDir, this.sky.sunColor, amount);
    }
    this.world.street.update(1 - this.sky.nightFactor);
    this.lanterns.update(simDt, { night: this.sky.nightFactor, festival: this.quest.complete, aarti: this.quest.eveningAarti || this.quest.aartiLit, hours: this.sky.hours });
    this.fireworks.update(simDt, { camera: this.camera, pixelRatio: pr, night: this.sky.nightFactor, festival: this.quest.complete, raining: (this.weather?.rain ?? 0) > 0.3 });
    // a big burst lights the ghats and the river for a moment
    if (this.fireworks.flash > 0.01) this.sky.hemi.intensity += this.fireworks.flash * 0.6;
    this.night.update(simDt, { night: this.sky.nightFactor, festival: this.quest.complete, camera: this.camera, pixelRatio: pr, moonDir: this.sky.moonDir });
    if (this.missions && this.state === 'play') this.missions.update(simDt);
    if (!paused) this.worldEvents?.update(simDt);
    this.journal?.update();
    if (!warmup && (playing || this.state === 'cutscene')) this.story.update(simDt);
    // the Asuras (and the people keeping well away from them)
    if (!paused) this.encounters.update(simDt);
    if (!paused) this.race.update(simDt);
    if (!paused) this.looseProps.update(simDt);
    if (!paused) this.riverAarti.update(simDt);
    this.score.update(Math.min(dt, 0.1));
    if (!paused) this.barks.update(simDt);
    if (!paused && !this.testSession) this.establishing.update(simDt);
    this.battleMusic.update(Math.min(dt, 0.1));
    this.asuras.update(simDt, { pixelRatio: pr, light });
    this.projectiles.update(simDt, pr);
    this.powers.update(simDt);
    this.finishers.update(simDt);
    if (playing || paused) this.asuras.hud(this.camera, this.ui);
    let danger = null;
    if (this.asuras.active) {
      const P = this.player.position;
      danger = { x: P.x, z: P.z, r: 32 };
    }
    if (!warmup) this.animals?.update(simDt);
    if (!warmup) this.crowd?.update(simDt, { hours: this.sky.hours, aarti: this.quest.aartiLit, festival: this.quest.complete, danger, playerPos: this.player.state === 'boat' ? null : this.character.position, playerVel: this.player.velocity });

    this.updateLightPool(dt);
    {
      const c = this.character.position;
      const cam = this.camera.position;
      const dx = cam.x - c.x;
      const dz = cam.z - c.z;
      const l = Math.hypot(dx, dz) || 1;
      this.heroLight.position.set(c.x + (dx / l) * 1.6 - (dz / l) * 0.8, c.y + 2.3, c.z + (dz / l) * 1.6 + (dx / l) * 0.8);
      this.heroLight.intensity = this.sky.nightFactor * (this._under ? 0.4 : 1) * (this.inCombat ? 3.2 : 2.2);
    }

    // Underwater camera
    const camWater = this.water.heightAt(this.camera.position.x, this.camera.position.z);
    const under = this.camera.position.y < camWater - 0.05;
    this._under = under;
    this.water.setUnder(under);
    this.sky.setUnderwater(under, this.scene.fog.color);
    if (this.weather?.dome && under) this.weather.dome.visible = false;
    {
      const pl = this.player;
      const swimming = pl.state === 'swim' || pl.state === 'dive';
      this.underwater.update(simDt, { camera: this.camera, under, sky: this.sky, purity: this.water.purity, swimmer: swimming ? pl.position : null, pixelRatio: this.rs.pixelRatio });
    }
    if (under) {
      this.scene.fog.color.copy(WORLD_UNIFORMS.uUnderwaterColor.value).multiplyScalar(1.6);
      this.scene.fog.density = lerp(0.11, 0.035, this.water.purity);
      FOG.params.x = 0; // uniform murk under water, no sun shafts through the haze
      this.rs.updateGodRays(this.camera, this.sky.sunDir, this.sky.sunColor, 0);
      FOG.params.w = 0;
    }
    // Bloom is for flames, lamps and glitter: strong at night, gentle against the daylight sky.
    if (this.rs.bloom) {
      const nf = this.sky.nightFactor;
      this.rs.bloom.intensity = lerp(0.28, 1.15, nf) + this.sky.goldenFactor * 0.08;
      // at night every flame, bulb and lit window should bloom; by day only the sun glitter
      if (this.rs.bloom.luminanceMaterial) this.rs.bloom.luminanceMaterial.threshold = lerp(3.2, 1.05, nf);
      this.fire.material.uniforms.uHalo.value = lerp(0.45, 0.85, nf);
    }
    if (this.rs.grade) applyGrade(this.rs.grade, { sunElevation: this.sky.sunDir.y, purity: this.water.purity, underwater: under, filter: this.photo ? this.photoFilter || 0 : 0 });
    if (this.photo && this.rs.dofLevel > 0) this.rs.dofTarget.copy(this.character.position).add(this._dofUp || (this._dofUp = new THREE.Vector3(0, 1.45, 0)));
    this.audio.setUnderwater(under);
    this.audio.updateListener(this.camera);
    this.updateAmbience(under);

    // HUD
    if (playing || paused) {
      const inter = this.currentInteraction();
      this.interaction = inter;
      this.ui.updateHud({
        purity: this.water.purity,
        clock: this.sky.clockString(),
        beads: this.quest.collected,
        breath: this.player.breath / this.player.breathMax,
        underwater: under,
        prompt: inter?.prompt,
        lockHint: playing && !this.input.locked && !this.photo && !this.input.freed,
        fps: this.settings.showFps || DEBUG ? `${this.fpsAcc.fps} fps · ${this.rs.renderer.info.render.calls} draws · ${(this.rs.renderer.info.render.triangles / 1e6).toFixed(2)}M tris · x${this.rs.scale.toFixed(2)}` : undefined,
      });
      for (const m of this.ui.compassMarks) if (m.kind === 'flame') m.hidden = this.quest.flames.find((f) => f.id === m.id)?.lit;
      this.updateTracker();
      this.ui.updateCompass(this.camRig.yaw, this.player.position);
      this.updateRegion();
      this.saveTimer = (this.saveTimer || 0) + dt;
      if (this.saveTimer > 15) {
        this.saveTimer = 0;
        this.save();
      }
    }
  }

  // Six pooled point lights follow the nearest flames and lamps: chosen every 0.3 s,
  // flickering every frame (firelight), so the ghats glow without hundreds of real lights.
  updateLightPool(dt) {
    const night = this.sky.nightFactor;
    this.lightTimer -= dt;
    if (this.lightTimer <= 0) {
      this.lightTimer = 0.3;
      const cam = this.camera.position;
      const cands = [];
      for (const f of this.quest.flames) if (f.lit) cands.push({ p: f.lamps[f.lamps.length - 1], k: 1.4, fire: true });
      if (this.quest.aartiLit) {
        const lamps = this.world.props.aartiLamps;
        for (let i = 0; i < lamps.length; i += 10) cands.push({ p: lamps[i], k: 1.2, fire: true });
      }
      if (night > 0.45) {
        for (const p of this.world.props.lampPosts) cands.push({ p, k: 0.8 });
        for (const p of this.world.galis.lamps) cands.push({ p, k: 0.55 });
        for (const p of this.ramnagar.lamps) cands.push({ p, k: 1.2, fire: true });
      }
      {
        // the temple's sanctum glows with its lamps day and night
        const cam = this.camera.position;
        for (const p of this.bhairav.lightSpots) if (p.distanceToSquared(cam) < 40 * 40) cands.push({ p, k: 0.5, fire: true });
        for (const p of this.night?.lightSpots ?? []) cands.push({ p, k: 0.7, fire: true });
      }
      for (const c of cands) c.d = c.p.distanceToSquared(cam);
      cands.sort((a, b) => a.d - b.d);
      this.lightChoice = this.lightPool.map((_, i) => (cands[i] && cands[i].d < 90 * 90 ? cands[i] : null));
    }
    const t = performance.now() * 0.001;
    this.lightPool.forEach((l, i) => {
      const c = this.lightChoice?.[i];
      if (!c) {
        l.intensity = 0;
        return;
      }
      l.position.copy(c.p);
      l.position.y += 0.9; // above the flame so nearby stone isn't blown out
      const flick = c.fire ? 0.84 + 0.09 * Math.sin(t * 9.1 + i * 2.3) + 0.05 * Math.sin(t * 17.3 + i) + 0.03 * Math.sin(t * 31.7 + i * 5.1) : 1;
      l.intensity = c.k * lerp(4, 30, night) * flick;
    });
  }

  currentInteraction() {
    const p = this.player;
    // E advances the open dialogue: no other prompt beside it
    if (this.missions?.dialogue) return null;
    // in a fight, an Asura that can be finished comes first
    const fin = this.finishers?.interaction();
    if (fin) return fin;
    const si = this.story?.interaction();
    if (si) return si;
    const mi = this.missions?.interaction();
    if (mi) return mi;
    const ri = this.race?.interaction() || this.riverAarti?.interaction();
    if (ri) return ri;
    const ev = this.worldEvents?.interaction();
    if (ev) return ev;
    // (racing: E would only end it; no prompt over the stroke ring)
    if (p.state === 'boat' && (this.race.phase === 'race' || this.race.phase === 'count')) return null;
    if (p.state === 'boat') return { prompt: 'Step off the boat', action: () => this.leaveBoat() };
    const q = this.quest.interactionAt(p.position);
    if (q && this.story.canLight(q.flameId)) return q;
    if (q && !this.inCombat && this._flameHint !== q.flameId) {
      // (once per flame: a dark flame whose chapter hasn't come yet)
      this._flameHint = q.flameId;
      this.ui.toast('This flame will not take yet', `Its story is still to be told. ${this.story.label() || ''}`, 4);
    }
    // (mid-fight, the quiet things wait: no holy dip, shrine or boat prompt over the Asuras)
    if (this.inCombat) return null;
    if (this.actions.holyDipAvailable()) return { prompt: 'Ganga Snan: take the holy dip', action: () => this.actions.startHolyDip() };
    const sh = this.nearShrine();
    if (sh) return { prompt: 'Offer a pranam at the hidden shrine', action: () => this.offerShrine(sh) };
    const tr = this.traversal?.interaction();
    if (tr) return tr;
    const b = this.boat.object.position;
    if (this.boat.distanceTo(p.position) < 4.2 && Math.abs(p.feetY - b.y) < 3) return { prompt: 'Board the boat  (W/S row · A/D steer)', action: () => this.boardBoat() };
    return null;
  }

  // ---------------------------------------------------------------- combat events
  onCombatEvent(type, data) {
    if ((type === 'hit' && data.enemy) || type === 'hurt') this.score.hitAt = this.health.time;
    if (type === 'noSword') this.ui.toast('No sword yet', 'The guru of Tulsi Akhara keeps a talwar for those who train.', 3);
    if (type === 'hit' && data.enemy) {
      this.powers.gain(SHAKTI.hit * (data.k || 1) * (data.riposte ? 2 : 1));
      this.haptics.play(data.heavy || data.charged || data.riposte ? 'heavyHit' : 'hit');
      // the weight of it on screen: a heavy, charged or killing blow jolts the frame
      if (data.heavy || data.charged || data.riposte || data.killed) this.cinematics?.impact(data.charged || data.riposte ? 0.6 : data.killed ? 0.35 : 0.3, this.player.position);
      if (data.riposte) {
        this.slowMo(0.35, 0.3);
        this.ui.toast('Pratyuttara', '', 1);
      }
    }
    if (type === 'hurt') {
      this.ui.hurtFlash(data.heavy ? 1 : 0.6);
      if (data.heavy) this.cinematics?.impact(0.45);
      this.camRig.shake(data.heavy ? 0.5 : 0.28);
      this.haptics.play(data.heavy ? 'hurtHeavy' : 'hurt');
      this.achievements.event('hurt', {});
      this.powers.interrupt();
    }
    if (type === 'blocked') {
      this.camRig.shake(data.heavy ? 0.3 : 0.12);
      this.haptics.play('block', data.heavy ? 1.4 : 1);
    }
    if (type === 'parry') {
      this.slowMo(0.22, 0.42);
      this.camRig.shake(0.22);
      this.cinematics?.impact(0.65, data.at ? { x: data.at.x, y: this.player.position.y + 0.4, z: data.at.z } : null);
      // steel on claw: a spray of sparks where the blow was turned aside
      if (data.at) this.asuras.particles.emitEmbers(data.at.x, this.player.position.y + 0.45, data.at.z, 34, null, 1.5);
      if (!this.settings.reduceFlashes) this.ui.flash();
      this.haptics.play('parry');
      this.powers.gain(SHAKTI.parry);
      this.achievements.event('parry', {});
    }
    if (type === 'dodged' && data.roll && this.combat.perks?.windStep) this.powers.gain(SHAKTI.dodge);
    if (type === 'shielded') this.camRig.shake(0.16);
    if (type === 'charged') {
      const h = this.animator.boneWorld('RightHand', new THREE.Vector3());
      if (h) this.asuras.particles.emitEmbers(h.x, h.y, h.z, 24, null, 0.6);
      this.haptics.pulse(0.25, 0.6, 120);
    }
    if (type === 'dying') {
      this.slowMo(0.3, 1.1);
      this.lockOn.release();
      this.finishers.reset();
    }
    if (type === 'death') this.respawn();
    this.missions?.onEvent?.(`combat:${type}`, data);
    this.story?.onEvent?.(`combat:${type}`, data);
    this.encounters?.onEvent?.(`combat:${type}`, data);
  }

  /** Where Prady wakes after a fall: the story's checkpoint, else the nearest ghat's first landing. */
  respawnPoint() {
    if (this.checkpoint) return this.checkpoint;
    const p = this.player.position;
    let g = segmentForX(p.x);
    if (!g) g = p.x < 0 ? GHAT_SEGMENTS[0] : GHAT_SEGMENTS[GHAT_SEGMENTS.length - 1];
    const { u } = bankCoords(p.x, p.z);
    const w = ghatToWorld(g, Math.max(4, Math.min(g.width - 4, u)), (LANDING_1.v0 + LANDING_1.v1) / 2);
    return { x: w.x, y: LANDING_1.h0, z: w.z, yaw: Math.atan2(g.N.x, g.N.z) };
  }

  respawn() {
    this.powers.reset();
    this.traversal.reset();
    this.projectiles.clear();
    this.ui.showRevive(true, 'Mother Ganga lifts you out of the dark…');
    this.after(2.2, () => {
      const r = this.respawnPoint();
      this.player.teleport(r.x, r.y + 0.1, r.z);
      if (r.yaw !== undefined) this.player.yaw = this.camRig.yaw = r.yaw;
      this.camRig.first = true;
      this.combat.revive();
      if (this.combat.armedBeforeDeath === false) this.combat.armed = false;
      this.health.revive(1);
      this.encounters?.onPlayerRevived?.();
      this.story?.onPlayerRevived?.();
      this.after(0.6, () => this.ui.showRevive(false));
    });
  }

  // ---------------------------------------------------------------- the journal, tracking, travel
  openJournal(tab = 'map') {
    if (this.state !== 'play' || this.photo) return;
    this.state = 'journal';
    this.input.exitLock();
    this.journal.openAt(tab);
  }

  closeJournal() {
    if (this.state !== 'journal') return;
    this.journal.close();
    this.input.pressed.clear(); // (the J that closed it must not open it again next frame)
    this.state = 'play';
    this.input.requestLock();
  }

  /** Pin something (the journal): a marker in the world and on the compass. null clears it. */
  setTracker(t) {
    this.tracker = t ? { label: t.label, x: t.x, y: t.y ?? 0, z: t.z } : null;
    if (t) this.ui.toast('Tracking', t.label, 2);
  }

  updateTracker() {
    const T = this.tracker;
    if (!T) return this.ui.setTrack(null);
    const P = this.player.position;
    const d = Math.hypot(T.x - P.x, T.z - P.z);
    if (d < 5 && Math.abs(T.y - this.player.feetY) < 4) {
      this.ui.toast('Arrived', T.label, 2);
      this.tracker = null;
      return this.ui.setTrack(null);
    }
    this.ui.setTrack({ label: T.label, dist: Math.round(d) });
  }

  /** Travel to a lit flame or an honoured shrine: a fade, the hour passes, he is there. */
  fastTravel(d) {
    const why = this.asuras.active ? 'Not while the dark is near.' : this.race?.active ? 'Not in the middle of the race.' : this.missions.dialogue ? 'Finish the conversation first.' : this.story?.cut ? 'Not now.' : null;
    if (why) return this.ui.toast('You cannot travel now', why, 3);
    this.closeJournal();
    this.travelling = true;
    this.ui.fadeBlack(true);
    this.after(1.2, () => {
      if (this.player.state === 'boat') this.player.exitBoat(d.x, d.y ?? 10.5, d.z);
      // stand on whatever is really there (a platform, a step)
      const hit = this.physics.castRay({ x: d.x, y: (d.y ?? groundHeight(d.x, d.z)) + 4, z: d.z }, { x: 0, y: -1, z: 0 }, 12, this.player.collider, undefined);
      const y = hit !== null ? (d.y ?? groundHeight(d.x, d.z)) + 4 - hit : groundHeight(d.x, d.z);
      this.player.teleport(d.x, y + 0.05, d.z);
      this.traversal.reset();
      this.camRig.first = true;
      this.sky.setHours(this.sky.hours + 0.5);
      this.after(0.5, () => {
        this.ui.fadeBlack(false);
        this.travelling = false;
        this.ui.showRegion(d.label);
      });
    });
  }

  /** Controls: every action and its key; choose one, then press its new key. */
  openControls(listening = null) {
    const b = this.settings.bindings || {};
    this.ui.openMenu({
      title: 'Controls',
      note: 'Choose an action, then press the key you want for it (Esc keeps the old one). Two actions never share a key: the other one takes the old key. Mouse: strike (left), heavy (right, hold to charge), guard (middle). The gamepad layout is fixed.',
      sections: [
        { heading: 'Keyboard', items: ACTIONS.map((a) => ({ label: a.label, sub: listening === a.id ? '<b class="listen">Press a key…</b>' : keyName(b[a.id] || a.key), tag: b[a.id] ? 'changed' : '', onClick: () => this.listenFor(a.id) })) },
        { items: [{ label: 'Reset to defaults', sub: 'Every key back as it began', onClick: () => (this.setSetting('bindings', {}), this.openControls()) }] },
      ],
      onClose: () => {
        this.input.listen = null;
        this.ui.listening = false;
      },
    });
  }

  listenFor(id) {
    this.openControls(id);
    this.ui.listening = true;
    this.input.listen = (code) => {
      this.ui.listening = false;
      if (code === 'Escape' || /^(Meta|Alt|OS)/.test(code)) return this.openControls();
      const b = { ...(this.settings.bindings || {}) };
      const cur = (aid) => b[aid] || ACTIONS.find((a) => a.id === aid).key;
      const mine = cur(id);
      const other = ACTIONS.find((a) => a.id !== id && cur(a.id) === code);
      if (other) b[other.id] = mine; // (a swap: the other action takes the old key)
      b[id] = code;
      for (const a of ACTIONS) if (b[a.id] === a.key) delete b[a.id];
      this.setSetting('bindings', b);
      this.openControls();
    };
  }

  /** A long drop: a roll if he lands running from not too high, else it hurts. */
  hardLanding(impact, speed) {
    if (this.combat.dead || this.player.state !== 'ground') return;
    if (speed > 2.2 && impact < 24) {
      this.animator.play('dodgeRoll', { timeScale: 1.75, fadeIn: 0.06, fadeOut: 0.2, cancelOnMove: false, noLook: true, noFootIK: true });
      this.camRig.shake(0.2);
      this.haptics.play('land');
      this.achievements.event('rollLanding', {});
      return;
    }
    const dmg = Math.min(60, (impact - 13.5) * 3.2);
    this.health.damage(dmg, { ignoreGrace: true });
    this.ui.hurtFlash(0.7);
    this.camRig.shake(0.45);
    this.haptics.play('hurtHeavy');
    this.audio.play('hurt', { volume: 0.8, rate: 0.8 });
    if (this.health.dead) this.combat.die({ x: 0, z: 0 });
  }

  // ---------------------------------------------------------------- hidden shrines (the galis)
  nearShrine() {
    const p = this.player.position;
    for (const s of this.world.galis.shrines) {
      if (this.worldState.shrines.has(s.id)) continue;
      if (Math.hypot(s.center.x - p.x, s.center.z - p.z) < 1.9 && Math.abs(this.player.feetY - s.y) < 1) return s;
    }
    return null;
  }

  offerShrine(s) {
    const pr = this.actions.pranam();
    this.player.yaw = Math.atan2(s.x - this.player.position.x, s.z - this.player.position.z);
    this.worldState.shrines.add(s.id);
    const n = this.worldState.shrines.size;
    const total = this.world.galis.shrines.length;
    this.missions.punya += 5;
    this.ui.setPunya(this.missions.punya);
    this.audio.play('bell', { at: s.center, volume: 0.5, rate: 1.25 });
    this.ui.toast(`Hidden shrine ${n} / ${total}`, n === total ? 'Every hidden shrine of the galis has your pranam. Kashi notices.' : '+5 punya', 3.5);
    if (n === total) this.siddhis.apply(); // (every shrine: +10 prana)
    this.achievements.event('shrines', { all: n === total });
    void pr;
    this.save();
  }

  boardBoat() {
    this.player.enterBoat(this.boat);
    this.audio.play('oar', { volume: 0.6 });
  }

  leaveBoat() {
    const land = this.boat.findLanding();
    if (land) this.player.exitBoat(land.x, land.y, land.z);
    else {
      const r = new THREE.Vector3(Math.cos(this.boat.yaw), 0, -Math.sin(this.boat.yaw));
      this.player.exitBoat(this.boat.x + r.x * 2.2, -0.8, this.boat.z + r.z * 2.2);
      this.fx.splash(this.boat.x + r.x * 2.2, 0, this.boat.z + r.z * 2.2, 0.6);
    }
  }

  /** Gamepad on the title screen, the pause menu and the lists: stick / d-pad move, A chooses, B backs out. */
  pollMenus(input) {
    const ui = this.ui;
    if (!(ui.menuOpen || this.state === 'title' || this.state === 'paused' || this.state === 'journal')) return;
    if (this.state === 'journal' && !ui.menuOpen) {
      if (input.hit('Pad4')) this.journal.cycle(-1);
      if (input.hit('Pad5')) this.journal.cycle(1);
      if (input.hit('Pad1') || input.hit('Pad8') || input.hit('Pad9')) return this.closeJournal();
    }
    // (on the journal's map the stick pans the map; the d-pad still moves between the buttons)
    const mapPans = this.state === 'journal' && this.journal.tab === 'map' && !ui.menuOpen;
    for (const [code, dir] of [['Pad12', 'up'], ['Pad13', 'down'], ['Pad14', 'left'], ['Pad15', 'right'], ['Stickup', 'up'], ['Stickdown', 'down'], ['Stickleft', 'left'], ['Stickright', 'right']]) if (input.hit(code) && !(mapPans && code.startsWith('Stick'))) ui.navigate(dir);
    if (input.hit('Pad0')) ui.activate();
    if (input.hit('Pad1')) {
      if (ui.menuOpen) ui.els.menu.querySelector('.close').click();
      else if (this.state === 'paused') this.resume();
    }
    if (input.hit('Pad9') && this.state === 'paused' && !ui.menuOpen) this.resume();
  }

  handleKeys() {
    const input = this.input;
    // talking: the keys belong to the conversation
    if (this.missions?.dialogue) {
      for (const code of ['KeyE', 'KeyQ', 'Space', 'Enter', 'Digit1', 'Digit2', 'Digit3', 'Pad2']) if (input.hit(code)) this.missions.key(code === 'Pad2' ? 'KeyE' : code);
      return;
    }
    // gamepad: A jump · B dodge (dive in the water) · X interact · Y draw / sheathe · RB strike ·
    // RT heavy · LB guard · LT or R3 lock-on · L3 sprint · Start pause · Back task · d-pad: up diya,
    // down meditate, left pranam, right photo mode
    // (LT held: the face buttons are the powers)
    const lt = input.gpButton(6);
    if (input.hit('KeyE') || (input.hit('Pad2') && !lt)) this.interaction?.action();
    if (input.hit('KeyF') || input.hit('Pad12')) this.floatDiya();
    if (input.hit('KeyN')) this.toggleNight();
    if (input.hit('KeyG') || input.hit('Pad14')) this.greet();
    if (input.hit('KeyM') || input.hit('Pad13')) this.actions.toggleMeditate();
    if (input.hit('KeyJ') || input.hit('Pad8')) return this.openJournal(this.missions?.active ? 'tasks' : 'map');
    if (input.hit('Pad9')) return this.pause();
    // the powers (Shakti)
    if (input.hit('Digit1') || (lt && input.hit('Pad2'))) this.powers.press('damaru');
    if (input.hit('Digit2') || (lt && input.hit('Pad3'))) this.powers.press('trishul');
    if (input.hit('Digit3') || (lt && input.hit('Pad1'))) this.powers.press('thirdEye');
    // fighting
    const atk = input.hit('Mouse0') || input.hit('Pad5');
    const dodge = (input.hit('KeyC') || input.hit('ControlLeft') || (input.hit('Pad1') && !lt)) && this.player.state === 'ground';
    if (atk) this.combat.attack();
    if (input.hit('Mouse2') || input.hit('Pad7')) this.combat.heavy();
    this.combat.heavyHeld = input.down('Mouse2') || input.gpButton(7);
    if (input.hit('KeyR') || (input.hit('Pad3') && !lt)) this.combat.toggleSword();
    // the guard: held, or (accessibility) toggled with a tap; a strike or a roll lowers a toggled guard
    if (this.settings.guardToggle) {
      if (input.hit('KeyQ')) this.guardOn = !this.guardOn;
      if (atk || dodge) this.guardOn = false;
    } else this.guardOn = input.down('KeyQ');
    this.combat.setBlock(this.guardOn || input.down('Mouse1') || input.gpButton(4));
    if (dodge) {
      const c = this.player.cmd;
      this.combat.dodge(c.mag > 0.2 ? { x: c.wish.x, z: c.wish.z } : null);
    }
    if (input.hit('Tab') || input.hit('Pad11')) this.lockOn.toggle();
    if ((input.hit('Space') || input.hit('Pad0')) && this.player.state === 'boat') {
      // in the race, Space is the stroke's catch; otherwise it's over the side
      if (this.race.phase === 'race') this.race.catchStroke();
      // (never over the side by accident while lined up, racing or just over the line)
      else if (input.hit('Space') && !this.race.active) this.actions.diveFromBoat(this.boat);
    }
    if (input.hit('KeyP') || input.hit('Pad15')) {
      this.photo = !this.photo;
      this.ui.setPhotoMode(this.photo);
      this.sky.frozen = this.photo;
      if (!this.photo) {
        this.rs.setDof(0, null);
        this.ui.setLetterbox(false);
      }
    }
    if (this.photo) {
      if (input.down('BracketRight')) this.sky.setHours(this.sky.hours + 0.04);
      if (input.down('BracketLeft')) this.sky.setHours(this.sky.hours - 0.04);
      if (input.hit('KeyC')) {
        this.photoFilter = ((this.photoFilter || 0) + 1) % PHOTO_FILTERS.length;
        this.ui.toast(PHOTO_FILTERS[this.photoFilter], '', 1.4);
      }
      if (input.hit('KeyB')) {
        const level = ((this.rs.dofLevel || 0) + 1) % 3;
        this.rs.setDof(level, this.rs.dofTarget || new THREE.Vector3());
        this.ui.toast(['Depth of field off', 'Soft focus on Prady', 'Shallow focus on Prady'][level], '', 1.4);
      }
      if (input.hit('KeyL')) this.ui.setLetterbox();
      if (input.hit('Enter')) this._snap = true;
    }
    if (DEBUG) {
      // (F1–F4: the number keys are the powers)
      if (input.hit('F1')) for (const f of SACRED_FLAMES) this.quest.lightFlame(f.id);
      if (input.hit('F2')) this.sky.setHours(this.sky.hours + 1);
      if (input.hit('F3')) {
        this._tp = ((this._tp ?? -1) + 1) % this.quest.flames.length;
        const f = this.quest.flames[this._tp];
        this.player.teleport(f.pos.x + 2.5, groundHeight(f.pos.x + 2.5, f.pos.z) + 0.2, f.pos.z);
      }
      if (input.hit('F4')) this.player.blessing = !this.player.blessing;
    }
  }

  // Time-lapse to an hour of the day (always forward, over ~3 s).
  setTimeOfDay(hours, dur = 3) {
    const from = this.sky.hours;
    const span = (((hours - from) % 24) + 24) % 24;
    this.timeTween = { from, span, t: 0, dur };
  }

  toggleNight() {
    const h = this.sky.hours;
    const isNight = h > 19 || h < 5;
    this.setTimeOfDay(isNight ? 6.6 : 20.4);
    this.ui.toast(isNight ? 'Dawn over the Ganga' : 'Night falls on Kashi', isNight ? '' : 'The diyas wake along the ghats.', 3);
  }

  // Prady folds his hands in pranam; people nearby answer.
  greet() {
    if (!this.actions.pranam()) return;
    this.crowd?.greet(this.character.position);
  }

  floatDiya() {
    // on the bottom steps: kneel and set it on the water (animation-driven)
    if (this.actions.floatDiya()) return;
    const p = this.player.position;
    const surface = this.water.heightAt(p.x, p.z);
    if (this.player.state === 'swim' || this.player.state === 'boat' || (this.player.feetY < surface + 0.4 && surface - groundHeight(p.x, p.z) > 0.15)) {
      const f = new THREE.Vector3(Math.sin(this.player.yaw), 0, Math.cos(this.player.yaw));
      this.diyas.launch(p.x + f.x * 1.2, p.z + f.z * 1.2);
      this.missions?.emit('diya', { x: p.x + f.x * 1.2, z: p.z + f.z * 1.2 });
      this.ripples.spawn(p.x + f.x * 1.2, surface, p.z + f.z * 1.2, 1, 1.6);
      if (!this._diyaToast) {
        this._diyaToast = true;
        this.ui.toast('Deep Daan', 'A small flame offered to Mother Ganga drifts downstream.', 4);
      }
    }
  }

  updateRegion() {
    const p = this.player.position;
    const { v } = bankCoords(p.x, p.z);
    let name;
    const seg = segmentForX(p.x);
    if (v > FAR_BANK_V - 10) name = 'The Sand Bank';
    else if (v > 60) name = 'Mother Ganga';
    else if (v > -6 && seg) name = seg.name;
    else if (v < -10) name = 'The Lanes of Kashi';
    if (name && !this.race?.active) this.ui.showRegion(name);
    this.score.region(name);
    if (!this.testSession) this.establishing.arrive(name);
  }

  updateAmbience(under) {
    if (!this.loops) return;
    const L = this.loops;
    const p = this.player.position;
    const { v } = bankCoords(p.x, p.z);
    const nearRiver = 1 - Math.min(1, Math.max(0, (-v - 5) / 60));
    L.river?.setVolume(under ? 0.05 : 0.15 + nearRiver * 0.55);
    L.underwater?.setVolume(under ? 0.9 : 0, 0.15);
    L.rain?.setVolume(this.weather.rain * 0.85, 0.6);
    const evening = this.quest.eveningAarti || this.quest.complete;
    L.aarti?.setVolume(evening ? 1 : 0, 2);
    // fire crackle follows the nearest lit flame
    let best = null;
    let bd = 25;
    for (const f of this.quest.flames) {
      if (!f.lit) continue;
      const d = f.pos.distanceTo(p);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    if (best) {
      L.fire?.setPosition(best.lamps[best.lamps.length - 1]);
      L.fire?.setVolume(0.7);
    } else L.fire?.setVolume(0);
    // low prana: his heart in the ears, slower and louder the closer he is to falling
    const hpK = this.health.hp / this.health.max;
    this._heartT = (this._heartT ?? 0) - 1 / 60;
    if (hpK < 0.3 && !this.health.dead && this.state === 'play' && this._heartT <= 0) {
      this._heartT = 0.85 + hpK * 1.2;
      this.audio.play('heartbeat', { volume: 0.4 + (0.3 - hpK) * 1.8, rate: 0.95 });
    }
    // the crowd's murmur: as many voices as there are people about (hushed while the dark is up)
    this._crowdT = (this._crowdT ?? 0) - 1 / 60;
    if (this._crowdT <= 0) {
      this._crowdT = 0.5;
      let n = 0;
      for (const s of this.crowd?.live || []) if (Math.abs(s.x - p.x) < 24 && Math.abs(s.z - p.z) < 24) n++;
      this._crowdK = Math.min(1, n / 14);
    }
    L.crowd?.setVolume(under ? 0 : (this._crowdK || 0) * (this.asuras?.active ? 0.2 : 0.65), 1.2);
    // the odd flutter of pigeons near Dashashwamedh
    this._pigeonT = (this._pigeonT ?? 20) - (1 / 60);
    if (this._pigeonT < 0) {
      this._pigeonT = 25 + Math.random() * 30;
      const f = this.birds.flocks[0];
      if (Math.hypot(p.x - f.cx, p.z - f.cz) < 90) this.audio.play('pigeons', { at: new THREE.Vector3(f.cx, f.y, f.cz), volume: 0.7, ref: 20 });
    }
  }
}
