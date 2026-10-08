import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { GROUPS } from '../core/Physics.js';
import { GHAT_TOP } from '../config.js';
import { LANDING_1, LANDING_2, LANES_V, PROFILE, frameAtX, frameToWorld, ghatHeight, ghatToWorld, groundHeight, segmentForX } from './WorldLayout.js';
import { makeWaterAware } from './materials.js';
import { LifeProps, planLife } from './CrowdLife.js';
import { RNG, clamp, damp, dampAngle, smoothstep, wrapAngle } from '../utils/math.js';
import { rotateBoneAxis, solveTwoBone } from '../utils/bones.js';

// The people of the ghats: pilgrims on the takhts, friends talking on the terraces, bathers
// taking their dip at dawn, boatmen calling out to Prady, yoga at sunrise, priests circling
// their lamps at the evening aarti, and people strolling the ghats and lanes.
//
// Bodies are Microsoft Rocketbox avatars (≈7k triangles, 1K PBR textures) with motion capture
// (CMU + Mixamo) baked by tools/bake-people.mjs. A few hundred "slots" (who stands where,
// doing what, at which hours) are planned once from the world layout; only the nearest
// N of them (quality preset) get a real skinned body, recycled from a per-avatar pool, so the
// cost is bounded no matter how big the city gets. Far bodies animate at a lower rate, bodies
// off screen don't animate at all, and only the closest few cast shadows.
//
// Procedural layer on top of the mocap (same clean-pose rule as Prady's animator): feet IK
// so seated people plant their feet on the step below, head look toward Prady or whoever is
// talking, and the aarti arm (two-bone IK circling a brass lamp).

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = { x: 0, y: -1, z: 0 };
const SEAT_H = 0.41; // seat height of the baked sit / sitChin clips (pelvis at 0.5 m)
const ANKLE_H = 0.1; // ankle bone above the sole
const GESTURES = new Set(['wave', 'agree', 'headShake']);
const LOOPS_FROM_START = new Set(['wave', 'agree', 'headShake', 'stretch', 'wash', 'pranam']);

const BUDGETS = {
  low: { max: 12, radius: 45, shadows: 0 },
  medium: { max: 22, radius: 62, shadows: 6 },
  high: { max: 30, radius: 78, shadows: 10 },
  veryhigh: { max: 30, radius: 80, shadows: 10 },
  ultra: { max: 42, radius: 95, shadows: 16 },
};

// Pale-cloth tints for the kurta wearers (applied in the shader to near-white texels only).
const TINTS = {
  saffron: [1.0, 0.46, 0.1],
  marigold: [1.0, 0.72, 0.26],
  cream: [1.0, 0.92, 0.76],
  rose: [1.0, 0.7, 0.62],
  sky: [0.76, 0.86, 1.0],
};

const within = (h, r) => (r[0] <= r[1] ? h >= r[0] && h < r[1] : h >= r[0] || h < r[1]);

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _sphere = new THREE.Sphere();
const _e = new THREE.Euler();

// ------------------------------------------------------------------------------------------
// Materials: water-aware (night light, caustics, underwater tint), dithered fade-in, cloth tint

function personMaterial(src) {
  const m = src.clone();
  m.alphaHash = true; // fade in/out without sorting problems
  m.envMapIntensity = 0.7;
  makeWaterAware(m, { caustics: true, wetness: false, puddles: false });
  const waterAware = m.onBeforeCompile;
  m.userData.tint = { value: new THREE.Color(1, 1, 1) };
  m.userData.tintAmt = { value: 0 };
  // body + head atlas: only the body (left) half is cloth
  m.userData.tintHalf = { value: /_skin$/.test(m.name) ? 1 : 0 };
  m.onBeforeCompile = (shader, renderer) => {
    waterAware(shader, renderer);
    shader.uniforms.uClothTint = m.userData.tint;
    shader.uniforms.uClothAmt = m.userData.tintAmt;
    shader.uniforms.uClothHalf = m.userData.tintHalf;
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uClothTint;\nuniform float uClothAmt;\nuniform float uClothHalf;').replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      float clothZone = 1.0;
      #ifdef USE_MAP
        if (uClothHalf > 0.5) clothZone = step(vMapUv.x, 0.5);
      #endif
      if (uClothAmt * clothZone > 0.0) {
        float cHi = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
        float cLo = min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));
        // off-white cloth (warm whites included); skin, hair and leather stay untouched
        float pale = smoothstep(0.2, 0.36, cLo) * (1.0 - smoothstep(0.22, 0.34, (cHi - cLo) / max(cHi, 1e-3)));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uClothTint, pale * uClothAmt);
      }`
    );
  };
  m.customProgramCacheKey = () => 'person';
  return m;
}

// ------------------------------------------------------------------------------------------
// A skinned body from an avatar's pool

class Body {
  constructor(avatar) {
    this.avatar = avatar;
    this.holder = new THREE.Group();
    this.root = SkeletonUtils.clone(avatar.gltf.scene);
    this.holder.add(this.root);
    this.meshes = [];
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = false;
      o.receiveShadow = true;
      if (avatar.sphere) o.boundingSphere = avatar.sphere.clone();
      this.meshes.push(o);
    });
    // Fully visible bodies use the avatar's SHARED materials (one material switch for every
    // body of that avatar, which matters: each switch re-uploads all the light uniforms).
    // Private dithered copies are only used while fading in or out.
    this.fadeMats = this.meshes.map((o) => {
      const m = personMaterial(o.material);
      m.alphaHash = true;
      return m;
    });
    this.materials = this.fadeMats;
    this.bodyMaterials = this.fadeMats.filter((m) => /body|skin/i.test(m.name));
    this.solid = null;
    this.isSolid = null;
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = {};
    for (const [name, clip] of avatar.clips) this.actions[name] = this.mixer.clipAction(clip);
    this.w = {};
    const B = (n) => this.root.getObjectByName(`Bip01_${n}`) || null;
    this.b = {
      neck: B('Neck'),
      head: B('Head'),
      lThigh: B('L_Thigh'),
      lCalf: B('L_Calf'),
      lFoot: B('L_Foot'),
      rThigh: B('R_Thigh'),
      rCalf: B('R_Calf'),
      rFoot: B('R_Foot'),
      lUpper: B('L_UpperArm'),
      lFore: B('L_Forearm'),
      lHand: B('L_Hand'),
      rUpper: B('R_UpperArm'),
      rFore: B('R_Forearm'),
      rHand: B('R_Hand'),
      rFinger: B('R_Finger2'),
      pelvis: B('Pelvis'),
      spine1: B('Spine1'),
    };
    // three's mixer only writes a bone whose animated value changed, so every bone the
    // procedural layer touches is restored to the mixer's clean output before each update.
    this.edit = Object.values(this.b).filter(Boolean);
    this.clean = this.edit.map((b) => b.quaternion.clone());
    this.opacity = -1;
    this.shadow = false;
  }

  begin(slot, time) {
    this.mixer.stopAllAction();
    this.w = {};
    this.setTint(slot.tint);
    this.opacity = -1;
    this.setOpacity(0);
    this.setLayer(slot.y > 2 ? 2 : 0);
    const s = slot.scale;
    this.holder.scale.set(s, s, s);
    this.holder.visible = true;
    this.lastTime = time;
  }

  setOpacity(o) {
    const solid = o >= 0.999;
    if (solid !== this.isSolid) {
      this.isSolid = solid;
      this.meshes.forEach((m, i) => (m.material = solid ? this.solid[i] : this.fadeMats[i]));
    }
    if (solid || Math.abs(o - this.opacity) < 0.004) return;
    this.opacity = o;
    for (const m of this.fadeMats) m.opacity = o;
  }

  setTint(key) {
    const t = key ? TINTS[key] : null;
    for (const m of this.bodyMaterials) {
      if (t) m.userData.tint.value.setRGB(t[0], t[1], t[2]);
      m.userData.tintAmt.value = t ? 1 : 0;
    }
    this.solid = this.avatar.solidMaterials(key);
    this.isSolid = null;
  }

  // Bodies up on the ghats stay out of the water mirror (layer 2); bathers and boatmen reflect.
  setLayer(n) {
    if (n === this.layer) return;
    this.layer = n;
    for (const m of this.meshes) m.layers.set(n);
  }

  setShadow(on) {
    if (on === this.shadow) return;
    this.shadow = on;
    for (const o of this.meshes) o.castShadow = on;
  }

  restore() {
    for (let i = 0; i < this.edit.length; i++) this.edit[i].quaternion.copy(this.clean[i]);
  }

  save() {
    for (let i = 0; i < this.edit.length; i++) this.clean[i].copy(this.edit[i].quaternion);
  }

  // Weights glide toward `targets` ({clip: weight}); a clip that starts plays from a random
  // phase (loops) or from the top (gestures).
  blend(targets, dt, phase, syncT) {
    for (const name in this.actions) {
      const a = this.actions[name];
      const tw = targets[name] || 0;
      let w = this.w[name] || 0;
      if (tw > 0 && w === 0) {
        a.reset();
        a.enabled = true;
        a.play();
        const d = a.getClip().duration;
        // groups that move together (yoga) share the crowd's clock
        a.time = syncT !== undefined ? syncT % d : LOOPS_FROM_START.has(name) && dt > 0 ? 0 : (phase * 0.37 * (1 + name.length)) % d;
      }
      w = dt > 0 ? damp(w, tw, 4.5, dt) : tw;
      if (tw === 0 && w < 0.01) {
        w = 0;
        if (a.isRunning()) a.stop();
      }
      this.w[name] = w;
      a.setEffectiveWeight(w);
    }
  }
}

// ------------------------------------------------------------------------------------------

export class Crowd {
  constructor({ scene, physics, layout, props, water, fx, ripples, fire, smoke, moored, renderer, camera, sun, exclude, manifest, quality = 'medium' }) {
    this.scene = scene;
    this.physics = physics;
    this.water = water;
    this.fx = fx;
    this.ripples = ripples;
    this.fire = fire;
    this.moored = moored;
    this.renderer = renderer;
    this.camera = camera;
    this.exclude = exclude;
    this.manifest = manifest;
    this.group = new THREE.Group();
    this.group.name = 'crowd';
    scene.add(this.group);
    this.time = 0;
    this.frame = 0;
    this.selectTimer = 0;
    this.live = [];
    this.inUse = 0;
    this.enabled = true;
    this.frustum = new THREE.Frustum();
    this.setQuality(quality);

    this.avatars = new Map();
    for (const def of manifest.avatars) {
      const av = { def, ready: false, free: [], clips: new Map(), solid: new Map() };
      // shared opaque materials, one set per cloth tint
      av.solidMaterials = (key) => {
        const k = key || 'none';
        if (!av.solid.has(k)) {
          const set = [];
          av.gltf.scene.traverse((o) => {
            if (!o.isMesh) return;
            const m = personMaterial(o.material);
            if (key && /body|skin/i.test(m.name)) {
              const t = TINTS[key];
              m.userData.tint.value.setRGB(t[0], t[1], t[2]);
              m.userData.tintAmt.value = 1;
            }
            set.push(m);
          });
          av.solid.set(k, set);
        }
        return av.solid.get(k);
      };
      this.avatars.set(def.id, av);
    }
    camera.layers.enable(2);
    if (sun) sun.shadow.camera.layers.enable(2);

    // the props' colliders only enter Rapier's query structures on a step
    physics.step(1 / 60);
    this.slots = [];
    this.walkers = [];
    this.groups = [];
    this.lampPosts = props?.lampPosts || [];
    this.clutter = layout.clutter || []; // laundry poles and lines (StreetLife)
    this.flameSpots = layout.flames.map((f) => new THREE.Vector3(f.x, f.y, f.z));
    this.pyres = layout.pyres || [];
    this.start = layout.playerStart;
    this.playerBoat = layout.boats.player;
    this.rejected = 0;
    this._plan(layout, new RNG(2718));
    // daily life from the shared motion packs, and the stalls / props it needs
    const stalls = planLife(this, layout, new RNG(1313));
    this.lifeProps = new LifeProps({ scene, fire, smoke, stalls });
    this._assignAvatars(new RNG(31));
    this._makeAartiLamps();
    this.stats = { slots: this.slots.length, walkers: this.walkers.length, groups: this.groups.length, rejected: this.rejected };
  }

  setQuality(q) {
    this.budget = BUDGETS[q] || BUDGETS.medium;
  }

  // ---------------------------------------------------------------- loading

  // Lazy: called once the title screen is up. People appear as each avatar arrives.
  load(loader) {
    const order = [...this.avatars.values()];
    // shared motion packs first (every body of that type plays them)
    this.packs = {};
    const packs = Promise.all(
      Object.entries(this.manifest.packs || {}).map(([k, file]) =>
        loader
          .loadAsync(`${this.manifest.base}/${file}.glb`)
          .then((g) => (this.packs[k] = g.animations))
          .catch((e) => console.warn('[crowd] pack', k, e.message || e))
      )
    );
    const loadOne = async (av) => {
      try {
        const g = await loader.loadAsync(`${this.manifest.base}/${av.def.id}.glb`);
        await packs;
        this._addAvatar(av, g);
      } catch (e) {
        console.warn('[crowd]', av.def.id, e.message || e);
      }
    };
    // a few at a time so the title screen stays smooth
    let i = 0;
    const next = () => (i < order.length ? loadOne(order[i++]).then(next) : null);
    return Promise.all([next(), next(), next()]).then(() => console.info(`[crowd] ${[...this.avatars.values()].filter((a) => a.ready).length} avatars, ${this.slots.length} people planned`));
  }

  _addAvatar(av, g) {
    av.gltf = g;
    for (const c of g.animations) av.clips.set(c.name, c);
    const pack = this.packs?.[av.def.role === 'child' ? 'c' : av.def.sex];
    for (const c of pack || []) if (!av.clips.has(c.name)) av.clips.set(c.name, c);
    const ud = g.scene.children[0]?.userData || g.scene.userData || {};
    av.walkSpeed = ud.walkSpeed || 1.5;
    av.height = ud.height || 1.75;
    // a missing motion stands in with idle. It must be its OWN copy: a mixer gives every name
    // that shares one clip the same action, and blend() stopping the unused alias "wait" would
    // stop "idle" itself (the person froze in the bind pose)
    for (const name of ['idle', 'walk', 'sit', 'sitChin', 'wash', 'wait', 'stretch', 'wave', 'talk', 'agree', 'headShake', 'pranam', 'surya', 'meditate', 'floorSit', 'danceA', 'danceB', 'drum', 'stir', 'buy', 'sweep', 'toss', 'hopscotch', 'play']) {
      if (av.clips.has(name)) continue;
      const stand = (av.clips.get('idle') || g.animations[0]).clone();
      stand.name = name;
      av.clips.set(name, stand);
    }
    // generous bounds (the bind pose doesn't cover a seated or stretching body)
    av.sphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.4);
    g.scene.traverse((o) => {
      if (!o.isMesh) return;
      // the sphere is in the mesh's local space: undo the baked scale of its parents
      o.updateWorldMatrix(true, false);
      const inv = _m.copy(o.matrixWorld).invert();
      const c = new THREE.Vector3(0, 0.9, 0).applyMatrix4(inv);
      const sc = new THREE.Vector3().setFromMatrixScale(o.matrixWorld).x || 1;
      av.sphere = new THREE.Sphere(c, 1.4 / sc);
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const mt of mats) for (const k of ['map', 'normalMap', 'roughnessMap']) if (mt[k]) this.renderer?.initTexture?.(mt[k]);
    });
    av.ready = true;
    // compile each new material layout (with / without hair cards) off the critical path
    const sig = g.scene.getObjectsByProperty('isMesh', true).length;
    this._compiled = this._compiled || new Set();
    if (!this._compiled.has(sig) && this.renderer?.compileAsync) {
      this._compiled.add(sig);
      const b = new Body(av);
      b.setTint(null);
      b.setOpacity(0.5);
      const solid = new Body(av);
      solid.setTint(null);
      solid.setOpacity(1);
      const both = new THREE.Group().add(b.holder, solid.holder);
      const done = () => {
        both.remove(b.holder, solid.holder);
        av.free.push(b, solid);
      };
      this.renderer.compileAsync(both, this.camera, this.scene).then(done, done);
    }
  }

  // ---------------------------------------------------------------- planning

  _slot(o, rng) {
    const s = {
      id: this.slots.length,
      kind: 'stand',
      clip: 'idle',
      yaw: 0,
      hours: [6, 21],
      aarti: false,
      roles: ['local', 'pilgrim'],
      scale: rng.range(0.965, 1.035),
      phase: rng.next() * 60,
      timer: rng.range(4, 20),
      ...o,
      inst: null,
      fade: 0,
      wanted: false,
      look: 0,
      acc: 0,
      gesture: null,
      dip: null,
      rip: rng.range(0.5, 2),
      collider: null,
    };
    s.yawNow = s.yaw;
    if (s.seatY !== undefined) s.y = s.seatY - SEAT_H * s.scale;
    this.slots.push(s);
    return s;
  }

  // Is the ground at (u, v) of ghat g free (no takht, platform, pillar…)?
  _clear(g, u, v, y, ru = 0.45, rv = 0.3) {
    for (const [du, dv] of [[0, 0], [ru, 0], [-ru, 0], [0, rv], [0, -rv]]) {
      const p = ghatToWorld(g, u + du, v + dv);
      const hit = this.physics.castRay({ x: p.x, y: y + 2.4, z: p.z }, DOWN, 3, this.exclude, GROUPS.feet);
      if (hit !== null && 2.4 - hit > 0.14) return false;
    }
    const c = ghatToWorld(g, u, v);
    const near = (list, r) => list.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < r);
    if (near(this.lampPosts, 0.9) || near(this.flameSpots, 3) || near(this.pyres, 4.5)) return false;
    if (this.clutter.some((q) => Math.hypot(q.x - c.x, q.z - c.z) < q.r)) return false;
    // nobody already planned there (people are not colliders yet while planning)
    const keep = Math.max(0.7, ru * 1.4);
    if (this.slots.some((o) => !o.walker && Math.abs((o.seatY ?? o.y ?? y) - y) < 1.2 && Math.hypot(o.x - c.x, o.z - c.z) < keep)) return false;
    if (Math.hypot(this.start.x - c.x, this.start.z - c.z) < 3) return false;
    if (Math.hypot(this.playerBoat.x - c.x, this.playerBoat.z - c.z) < 6) return false;
    return true;
  }

  _plan(layout, rng) {
    const P0 = PROFILE[0];
    const L1 = LANDING_1;
    const L2 = LANDING_2;
    const last = PROFILE[PROFILE.length - 1];
    const stepFor = (h) => {
      let best = null;
      for (let i = 0; i < last.steps; i++) {
        const hh = last.h0 - (i + 1) * last.rise;
        if (!best || Math.abs(hh - h) < Math.abs(best.h - h)) best = { v: last.v0 + (i + 0.5) * last.run, h: hh };
      }
      return best;
    };
    const bath = stepFor(-0.85);
    const dry = stepFor(0.3);
    const all = ['local', 'pilgrim', 'tourist'];
    const slot = (o) => this._slot(o, rng);
    const at = (g, u, v) => {
      const p = ghatToWorld(g, u, v);
      return { x: p.x, z: p.z, y: ghatHeight(v) };
    };
    // try a few random spots until one is clear
    const findSpot = (g, uRange, vRange, y, ru, rv, tries = 8) => {
      for (let t = 0; t < tries; t++) {
        const u = rng.range(uRange[0], uRange[1]);
        const v = rng.range(vRange[0], vRange[1]);
        if (this._clear(g, u, v, y, ru, rv)) return { u, v };
        this.rejected++;
      }
      return null;
    };
    const umbrellasOf = new Map();
    for (const um of layout.umbrellas) {
      const seg = segmentForX(um.x);
      if (!seg) continue;
      if (!umbrellasOf.has(seg.id)) umbrellasOf.set(seg.id, []);
      umbrellasOf.get(seg.id).push(um);
    }

    for (const g of layout.ghats) {
      const dash = !!g.aarti;
      const mani = !!g.pyres;
      const face = Math.atan2(g.N.x, g.N.z);
      const W = g.width;
      const flat = [
        { L: P0, v: [-2.6, 1.6], y: GHAT_TOP },
        { L: L1, v: [L1.v0 + 1.2, L1.v1 - 1.2], y: L1.h0 },
        { L: L2, v: [L2.v0 + 0.9, L2.v1 - 0.9], y: L2.h0 },
      ];

      // 1) pilgrims and pandas on the takhts under the straw umbrellas
      for (const um of umbrellasOf.get(g.id) || []) {
        if (!rng.chance(dash ? 0.72 : mani ? 0.25 : 0.5)) continue;
        const xs = rng.chance(0.3) ? [-0.48, 0.48] : [rng.range(-0.45, 0.45)];
        _m.compose(_v.set(um.x, um.y, um.z), _q.setFromEuler(_e.set(um.tilt, um.yaw, um.tilt * 0.6)), _s.set(1, 1, 1));
        for (const sx of xs) {
          const seat = new THREE.Vector3(sx, 0.46, 0.47).applyMatrix4(_m);
          slot({ kind: 'sit', seat: true, clip: rng.chance(0.65) ? 'sit' : 'sitChin', x: seat.x, z: seat.z, seatY: seat.y, feetY: um.y, yaw: um.yaw + rng.range(-0.2, 0.2), hours: rng.chance(0.3) ? [5.5, 23.5] : [6.5, 20.5], roles: ['local', 'pilgrim', 'pilgrim'] });
        }
      }

      // 2) people sitting on the edge of a landing, feet on the step below, watching the river
      const edges = [P0, L1, L2];
      const nEdge = dash ? 6 : mani ? 1 : 3;
      for (let k = 0; k < nEdge; k++) {
        const L = edges[k % 3];
        const spot = findSpot(g, [5, W - 5], [L.v1 - 0.3, L.v1 - 0.3], L.h0, 0.45, 0.15, 6);
        if (!spot) continue;
        const pair = rng.chance(0.35) ? [0, 0.62] : [0];
        for (const du of pair) {
          const p = at(g, spot.u + du, L.v1 - 0.12);
          slot({ kind: 'sit', seat: true, clip: rng.chance(0.7) ? 'sit' : 'sitChin', x: p.x, z: p.z, seatY: L.h0, feetY: L.h0 - 0.3, yaw: face + rng.range(-0.25, 0.25), hours: rng.chance(0.4) ? [5, 22.5] : [6, 20], roles: all });
        }
      }

      // 3) friends talking
      const nGroups = dash ? 3 : mani ? 0 : 1;
      for (let k = 0; k < nGroups; k++) {
        const f = rng.pick(flat);
        const spot = findSpot(g, [8, W - 8], f.v, f.y, 1.3, 1.0);
        if (!spot) continue;
        const n = rng.chance(0.4) ? 3 : 2;
        const r = n === 2 ? 0.62 : 0.8;
        const c = at(g, spot.u, spot.v);
        const a0 = rng.range(0, Math.PI * 2);
        const grp = { members: [], speaker: 0, timer: rng.range(1, 4), cx: c.x, cz: c.z };
        const hours = rng.chance(0.5) ? [7, 21.5] : [8.5, 19];
        for (let i = 0; i < n; i++) {
          const a = a0 + (i / n) * Math.PI * 2 + rng.range(-0.25, 0.25);
          const x = c.x + Math.sin(a) * r;
          const z = c.z + Math.cos(a) * r;
          const s = slot({ kind: 'group', clip: 'idle', x, z, y: f.y, yaw: Math.atan2(c.x - x, c.z - z), hours, roles: all, group: grp });
          grp.members.push(s);
        }
        this.groups.push(grp);
      }

      // 4) bathers waist-deep on the submerged steps
      const nBath = dash ? 5 : mani ? 1 : rng.int(2, 3);
      for (let k = 0; k < nBath; k++) {
        const u = rng.range(5, W - 5);
        if (g.sunkenTemple && u < 28) continue;
        const p = at(g, u, bath.v);
        if (Math.hypot(p.x - this.playerBoat.x, p.z - this.playerBoat.z) < 7) continue;
        const towardGhat = rng.chance(0.2);
        slot({ kind: 'bather', clip: 'wash', x: p.x, z: p.z, y: bath.h, yaw: face + (towardGhat ? Math.PI : 0) + rng.range(-0.5, 0.5), hours: rng.chance(0.65) ? [4.8, 11] : [15.5, 18.6], roles: ['local', 'pilgrim'] });
      }

      // 5) boatmen: one waits on the last dry step, another sits in his boat
      layout.boats.moored.forEach((b, bi) => {
        if (segmentForX(b.x) !== g) return;
        const u = (b.x - g.S.x) * g.T.x + (b.z - g.S.z) * g.T.z;
        if (rng.chance(0.6)) {
          const p = at(g, u + rng.range(-1.5, 1.5), dry.v);
          slot({ kind: 'boatman', clip: 'wait', x: p.x, z: p.z, y: dry.h, yaw: face + (rng.chance(0.6) ? Math.PI : 0) + rng.range(-0.4, 0.4), hours: [5.5, 21], roles: ['local'], sex: 'm' });
        }
        if (rng.chance(0.45)) {
          const end = rng.chance(0.5) ? 1 : -1;
          slot({ kind: 'boatSit', seat: true, clip: rng.chance(0.5) ? 'sit' : 'sitChin', boat: bi, local: { z: end * 2.1, yaw: end > 0 ? Math.PI : 0 }, x: b.x, z: b.z, y: 0, hours: [5.5, 22], roles: ['local'], sex: 'm' });
        }
      });

      // 6) sunrise yoga
      const nYoga = dash ? 3 : mani ? 0 : rng.int(1, 2);
      for (let k = 0; k < nYoga; k++) {
        const f = rng.pick(flat);
        const spot = findSpot(g, [6, W - 6], f.v, f.y, 0.8, 0.8);
        if (!spot) continue;
        const p = at(g, spot.u, spot.v);
        slot({ kind: 'stand', clip: 'stretch', x: p.x, z: p.z, y: f.y, yaw: face + rng.range(-0.3, 0.3), hours: [5, 9.5], roles: all });
      }

      // 7) people just standing, looking at the river (tourists among them)
      const nLook = dash ? 4 : 1 + (rng.chance(0.5) ? 1 : 0);
      for (let k = 0; k < nLook; k++) {
        const f = rng.pick(flat);
        const spot = findSpot(g, [6, W - 6], [f.v[1] - 0.2, f.v[1]], f.y, 0.5, 0.4);
        if (!spot) continue;
        const p = at(g, spot.u, spot.v);
        slot({ kind: 'stand', clip: rng.chance(0.5) ? 'idle' : 'wait', x: p.x, z: p.z, y: f.y, yaw: face + rng.range(-0.5, 0.5), hours: rng.chance(0.3) ? [6, 23] : [7, 19.5], roles: k === 0 ? ['tourist'] : all, friendly: true });
      }

      // 8) strollers along the top terrace and the landings
      const nTerrace = dash ? 2 : 1;
      for (let k = 0; k < nTerrace; k++) this._walker({ type: 'bank', v: rng.range(0.2, 1.8), a: g.x0 + 3, b: g.x1 - 3, band: [-0.9, 0.9] }, rng, [5, 22.5]); // on the open terrace, clear of temple plinths and house fronts
      const nLanding = dash ? 2 : mani ? 0 : 1;
      for (let k = 0; k < nLanding; k++) {
        const onL1 = rng.chance(0.6);
        const track = onL1 ? { type: 'ghat', g, v: L1.v0 + 0.55, a: 4, b: W - 4, band: [-0.15, 0.6] } : { type: 'ghat', g, v: L2.v1 - 0.6, a: 4, b: W - 4, band: [-0.5, 0.25] };
        this._walker(track, rng, [5.5, 21]);
      }
    }

    // Lanes of the old city
    for (let k = 0; k < 14; k++) {
      const v = rng.pick(LANES_V);
      const c = rng.range(-400, 400);
      const len = rng.range(50, 110);
      this._walker({ type: 'bank', v, a: Math.max(-440, c - len / 2), b: Math.min(440, c + len / 2), band: [-1.3, 1.3] }, rng, k < 4 ? [0, 24] : [6, 22]);
    }

    // Dashashwamedh at the evening aarti: priests on the seven platforms, devotees watching
    const dashG = layout.ghats.find((g) => g.aarti);
    for (const a of layout.aartiPlatforms) {
      const fwd = { x: Math.sin(a.yaw), z: Math.cos(a.yaw) };
      slot({ kind: 'priest', clip: 'idle', x: a.x - fwd.x * 1.15, z: a.z - fwd.z * 1.15, y: a.y + 0.95, yaw: a.yaw, aarti: true, avatarId: 'Male_Adult_15', tint: 'saffron', scale: rng.range(0.99, 1.03) });
    }
    if (dashG) {
      const face = Math.atan2(dashG.N.x, dashG.N.z);
      const mid = dashG.width * 0.5;
      for (let k = 0; k < 18; k++) {
        const onStairs = k % 3 === 2;
        const vRange = onStairs ? [L1.v1 + 0.2, L1.v1 + 2.6] : [L1.v0 + 1.4, L1.v1 - 0.8];
        let v = rng.range(vRange[0], vRange[1]);
        if (onStairs) v = L1.v1 + (Math.floor((v - L1.v1) / 0.45) + 0.5) * 0.45; // middle of a tread
        const u = mid + rng.range(-22, 22);
        const y = ghatHeight(v);
        if (!this._clear(dashG, u, v, y, 0.4, onStairs ? 0.1 : 0.4)) {
          this.rejected++;
          continue;
        }
        const p = at(dashG, u, v);
        slot({ kind: 'stand', clip: rng.chance(0.6) ? 'idle' : 'wait', x: p.x, z: p.z, y, yaw: face + rng.range(-0.35, 0.35), aarti: true, roles: ['pilgrim', 'local', 'pilgrim', 'tourist'], audience: true });
      }
    }
  }

  // A stroller (sometimes a pair walking side by side) going back and forth along a track.
  _walker(track, rng, hours) {
    track.ds = 1;
    const pair = rng.chance(0.3);
    const w = {
      track,
      s: rng.range(track.a, track.b),
      dir: rng.chance(0.5) ? 1 : -1,
      speed: 0,
      vMax: rng.range(0.9, 1.04),
      off: 0,
      offT: 0,
      state: 'walk',
      timer: 0,
      probe: rng.range(0, 0.2),
      blocked: 0,
      clearT: 0,
      yaw: 0,
      lat: pair ? [-0.36, 0.36] : [0],
      members: [],
    };
    // never start inside something solid (a tree's platform, a stall, a temple plinth)
    for (let k = 0; k < 24 && this._solidAt(this._trackPoint(track, w.s, 0)); k++) w.s = rng.range(track.a, track.b);
    const p = this._trackPoint(track, w.s, 0);
    w.yaw = Math.atan2(p.tx * w.dir, p.tz * w.dir);
    for (const lat of w.lat) {
      const s = this._slot({ kind: 'walker', clip: 'idle', x: p.x, z: p.z, y: groundHeight(p.x, p.z), yaw: w.yaw, hours, roles: ['local', 'pilgrim', 'tourist'], walker: w, lat }, rng);
      w.members.push(s);
    }
    this.walkers.push(w);
  }

  _solidAt(p) {
    const R = this.physics.RAPIER;
    this._ball = this._ball || new R.Ball(0.3);
    let hit = false;
    const y = groundHeight(p.x, p.z);
    for (const hy of [0.35, 1.0]) {
      this.physics.world.intersectionsWithShape({ x: p.x, y: y + hy, z: p.z }, { x: 0, y: 0, z: 0, w: 1 }, this._ball, () => {
        hit = true;
        return false;
      }, undefined, GROUPS.feet);
    }
    return hit;
  }

  _trackPoint(t, s, off) {
    if (t.type === 'ghat') {
      const p = ghatToWorld(t.g, s, t.v + off);
      return { x: p.x, z: p.z, tx: t.g.T.x, tz: t.g.T.z, nx: t.g.N.x, nz: t.g.N.z };
    }
    const f = frameAtX(s);
    const p = frameToWorld(f, 0, t.v + off);
    return { x: p.x, z: p.z, tx: f.T.x, tz: f.T.z, nx: f.N.x, nz: f.N.z };
  }

  // Spread the avatars so neighbours rarely share a face.
  _assignAvatars(rng) {
    const defs = this.manifest.avatars;
    const done = [];
    for (const s of this.slots) {
      if (!s.avatarId) {
        let cands = defs.filter((d) => s.roles.includes(d.role) && (!s.sex || d.sex === s.sex));
        if (!cands.length) cands = defs;
        let best = null;
        let bestScore = Infinity;
        for (const d of cands) {
          let score = rng.next() * 0.6;
          for (const o of done) if (o.avatarId === d.id && Math.abs(o.x - s.x) < 22 && Math.abs(o.z - s.z) < 22) score += 1;
          if (score < bestScore) {
            bestScore = score;
            best = d;
          }
        }
        s.avatarId = best.id;
      }
      // kurta-wearing pilgrims get a few traditional colours
      const def = defs.find((d) => d.id === s.avatarId);
      if (def?.kurta && !s.tint) s.tint = rng.pick([null, 'cream', 'marigold', 'rose', 'sky', 'saffron']);
      done.push(s);
    }
  }

  // Brass lamps for the aarti priests (one instanced mesh) + their flames.
  _makeAartiLamps() {
    this.priests = this.slots.filter((s) => s.kind === 'priest');
    const pts = [
      [0.012, -0.16],
      [0.02, -0.02],
      [0.05, 0],
      [0.05, 0.03],
      [0.02, 0.05],
      [0.17, 0.08],
      [0.18, 0.105],
      [0.04, 0.12],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const geo = new THREE.LatheGeometry(pts, 14);
    const mat = new THREE.MeshStandardMaterial({ color: 0xd9a441, metalness: 1, roughness: 0.32, emissive: 0x2a1500 });
    this.lampMesh = new THREE.InstancedMesh(geo, mat, Math.max(1, this.priests.length));
    this.lampMesh.count = 0;
    this.lampMesh.frustumCulled = false;
    this.lampMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(this.lampMesh);
    for (const s of this.priests) {
      s.flames = [];
      for (let k = 0; k < 5; k++) s.flames.push(this.fire ? this.fire.add(new THREE.Vector3(s.x, -50, s.z), 0.85, false) : -1);
      s.flameOn = false;
    }
  }

  // ---------------------------------------------------------------- runtime

  _isOn(s, ctx) {
    // a fight nearby (Asuras on the ghat): everyone but the story's own actors has fled
    const D = ctx.danger;
    if (D && !s.actor && Math.hypot((s.group ? s.group.cx : s.x) - D.x, (s.group ? s.group.cz : s.z) - D.z) < D.r) return false;
    if (s.aarti) return ctx.aarti;
    if (s.festival && !ctx.festival) return false;
    return within(ctx.hours, s.hours);
  }

  _select(ctx) {
    const cam = this.camera.position;
    this.camera.getWorldDirection(_v);
    const fx = _v.x;
    const fz = _v.z;
    const R = this.budget.radius;
    const cands = [];
    for (const s of this.slots) {
      s.wanted = false;
      const av = this.avatars.get(s.avatarId);
      if (s.gone || !av?.ready || !this._isOn(s, ctx)) continue;
      const cx = s.group ? s.group.cx : s.x;
      const cz = s.group ? s.group.cz : s.z;
      const dx = cx - cam.x;
      const dz = cz - cam.z;
      const d = Math.hypot(dx, dz, (s.y || 0) - cam.y);
      if (d > R) continue;
      const front = dx * fx + dz * fz > -6;
      s.score = s.actor ? -1 + d * 1e-3 : d * (front ? 1 : 1.7) + s.id * 1e-4;
      cands.push(s);
    }
    cands.sort((a, b) => a.score - b.score);
    const n = Math.min(cands.length, this.budget.max);
    for (let i = 0; i < n; i++) cands[i].wanted = true;
    // a group is all or nothing
    for (const g of this.groups) {
      const any = g.members.some((m) => m.wanted);
      if (any) for (const m of g.members) if (this._isOn(m, ctx) && this.avatars.get(m.avatarId)?.ready) m.wanted = true;
    }
    // acquire bodies for newly wanted slots
    for (const s of cands) if (s.wanted && !s.inst && this.inUse < this.budget.max + 8) this._acquire(s);
    // shadows for the nearest few
    const near = this.live.filter((s) => s.wanted).sort((a, b) => a.dist - b.dist);
    near.forEach((s, i) => s.inst.setShadow(i < this.budget.shadows && s.dist < 32));
  }

  _acquire(s) {
    const av = this.avatars.get(s.avatarId);
    const body = av.free.pop() || new Body(av);
    s.inst = body;
    s.fade = 0;
    s.acc = 0;
    s.dist = 999;
    body.begin(s, this.time);
    this.group.add(body.holder);
    this.live.push(s);
    this.inUse++;
    this._collider(s, true);
    // pose it once right away so it never shows the bind pose (restore first: a recycled
    // body still carries the last owner's head-look / IK edits)
    this._place(s, 0);
    body.restore();
    body.blend(this._targets(s), 0, s.phase, s.sync ? this.time : undefined);
    body.mixer.update(0);
    body.save();
  }

  _release(s) {
    const body = s.inst;
    body.holder.removeFromParent();
    body.setShadow(false);
    body.mixer.stopAllAction();
    this.avatars.get(s.avatarId).free.push(body);
    s.inst = null;
    this.live.splice(this.live.indexOf(s), 1);
    this.inUse--;
    this._collider(s, false);
    if (s.flames) this._priestLamp(s, null);
  }

  // People block Prady (and each other's walking paths) but never the camera.
  _collider(s, on) {
    if (s.kind === 'boatSit' || s.noCollider) return;
    const P = this.physics;
    const R = P.RAPIER;
    if (!s.collider && on) {
      const seated = s.seat;
      const low = s.low; // sitting on the stone (meditating, resting)
      const desc = (seated || low ? R.ColliderDesc.capsule(0.2, 0.32) : R.ColliderDesc.capsule(0.55, 0.28)).setCollisionGroups(GROUPS.people);
      const cy = seated ? s.seatY + 0.15 : low ? s.y + 0.45 : s.y + 0.85;
      if (s.walker || s.actor) {
        s.body = P.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(s.x, cy, s.z));
        s.collider = P.world.createCollider(desc, s.body);
      } else {
        desc.setTranslation(s.x, cy, s.z);
        s.collider = P.world.createCollider(desc, P.fixedBody);
      }
    }
    if (s.collider) {
      s.collider.setEnabled(on);
      if (on && s.body) s.body.setTranslation({ x: s.x, y: s.y + 0.85, z: s.z }, true);
    }
  }

  // which clips should be playing now
  _targets(s) {
    if (s.gesture) return { [s.gesture.name]: 1 };
    if (s.actor && s.actor.speed > 0.02) {
      const k = smoothstep(0.08, 0.5, s.actor.speed);
      return { walk: k, [s.clip]: 1 - k };
    }
    if (s.walker) {
      const w = s.walker;
      const k = smoothstep(0.08, 0.5, w.speed);
      if (k <= 0) return { [s.clip]: 1 };
      return { walk: k, [s.clip]: 1 - k };
    }
    return { [s.clip]: 1 };
  }

  update(dt, ctx) {
    if (!this.enabled) return;
    try {
      this._update(dt, ctx);
    } catch (e) {
      // never let the crowd take the game down with it
      console.error('[crowd] disabled after an error:', e);
      this.enabled = false;
      this.group.visible = false;
    }
  }

  _update(dt, ctx) {
    this.time += dt;
    this.frame++;
    const cam = this.camera.position;
    this.selectTimer -= dt;
    if (this.selectTimer <= 0) {
      this.selectTimer = 0.25;
      this._select(ctx);
    }
    this.frustum.setFromProjectionMatrix(_m2.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));

    for (const w of this.walkers) if (w.members.some((m) => m.inst)) this._walk(w, dt, ctx);
    for (const g of this.groups) if (g.members.some((m) => m.inst)) this._converse(g, dt, ctx);

    let lamps = 0;
    this.lifeProps.begin();
    for (let i = this.live.length - 1; i >= 0; i--) {
      const s = this.live[i];
      const body = s.inst;
      s.fade = clamp(s.fade + (s.wanted ? dt / 0.7 : -dt / 0.5), 0, 1);
      if (!s.wanted && s.fade <= 0) {
        this._release(s);
        continue;
      }
      body.setOpacity(s.fade);
      this._think(s, dt, ctx);
      this._place(s, dt);
      const p = body.holder.position;
      s.dist = p.distanceTo(cam);
      _sphere.center.set(p.x, p.y + 0.9, p.z);
      _sphere.radius = 1.4;
      const visible = this.frustum.intersectsSphere(_sphere);
      s.acc += dt;
      const every = s.dist > 48 ? 3 : s.dist > 26 ? 2 : 1;
      if (s.kind === 'priest') lamps = this._priest(s, ctx, lamps, visible);
      if (s.prop && s.fade > 0.3) {
        body.holder.updateMatrixWorld(true);
        if (s.prop === 'broom') this.lifeProps.broom(body, s.y);
        else if (s.prop === 'dhol') this.lifeProps.dholAt(body, body.holder.rotation.y);
      }
      if (!visible || (this.frame + s.id) % every !== 0) continue;
      const adt = s.acc;
      s.acc = 0;
      body.restore();
      body.blend(this._targets(s), adt, s.phase, s.sync ? this.time : undefined);
      if (s.walker || s.actor) {
        const sp = s.walker ? s.walker.speed : s.actor.speed;
        body.actions.walk.timeScale = Math.max(0.4, sp / (body.avatar.walkSpeed || 1.5));
      }
      body.mixer.update(adt);
      body.save();
      const ik = s.seat && s.dist < 30;
      const row = s.ride?.boat.oarHands && s.dist < 90;
      const look = row ? 0 : this._lookWeight(s, adt, ctx);
      if (ik || look > 0.01 || s.kind === 'priest' || row) {
        body.holder.updateMatrixWorld(true);
        if (ik) this._plantFeet(s, body);
        if (s.kind === 'priest') this._aartiArms(s, body);
        if (row) this._rowArms(s, body);
        if (look > 0.01) this._look(s, body, look);
      }
    }
    this.lampMesh.count = lamps;
    if (lamps) this.lampMesh.instanceMatrix.needsUpdate = true;
    this.lifeProps.end();
  }

  // Where the body goes this frame.
  _place(s, dt) {
    const h = s.inst.holder;
    if (s.ride) {
      const b = s.ride.boat.object;
      const L = s.ride.local;
      _v.set(L.x, L.y, L.z).applyMatrix4(b.matrixWorld);
      h.position.copy(_v);
      h.quaternion.copy(b.quaternion);
      s.x = _v.x;
      s.z = _v.z;
      s.y = _v.y;
      return;
    }
    if (s.kind === 'boatSit') {
      this.moored.mesh.getMatrixAt(s.boat, _m);
      _m2.compose(_v.set(0, 0.5 - SEAT_H * s.scale, s.local.z), _q.setFromAxisAngle(UP, s.local.yaw), _s.set(1, 1, 1));
      _m.multiply(_m2);
      _m.decompose(h.position, h.quaternion, _s);
      s.x = h.position.x;
      s.z = h.position.z;
      s.feetY = h.position.y + 0.12 - (0.5 - SEAT_H * s.scale) + 0.0;
      return;
    }
    let y = s.y;
    // the floor-sitting take (CMU 114_16) leaves the hips a hand's width above the stone:
    // sit them down onto it (eased, so a nod or a wave doesn't pop them up and down)
    const drop = s.clip === 'floorSit' && !s.gesture ? (s.avatarId?.includes('Child') ? 0.08 : 0.13) : 0;
    s.sitDrop = (s.sitDrop || 0) + (drop - (s.sitDrop || 0)) * Math.min(1, dt * 6 || 1);
    y -= s.sitDrop;
    if (s.dip) {
      const t = s.dip.t;
      y -= (smoothstep(0, 0.75, t) - smoothstep(1.25, 2.15, t)) * 1.02;
    }
    // turn toward whoever we're waving at, then back
    const goal = s.faceGoal ?? s.yaw;
    s.yawNow = dampAngle(s.yawNow, goal, 3.2, Math.min(0.1, dt));
    if (s.actor && s.actor.speed > 0.05) s.yawNow = dampAngle(s.yawNow, s.faceGoal ?? s.yaw, 8, Math.min(0.1, dt));
    h.position.set(s.x, y, s.z);
    h.rotation.set(0, s.walker ? s.yaw : s.yawNow, 0);
    if (s.actor && s.body) s.body.setNextKinematicTranslation({ x: s.x, y: s.y + 0.85, z: s.z });
  }

  _think(s, dt, ctx) {
    const T = this.time;
    if (s.pending && T >= s.pending.at) {
      if (!s.gesture) {
        s.gesture = { name: s.pending.name, until: T + s.pending.dur };
        if (s.pending.face !== undefined) s.faceGoal = s.pending.face;
      }
      s.pending = null;
    }
    if (s.gesture && T > s.gesture.until) {
      s.gesture = null;
      s.faceGoal = undefined;
    }
    const pp = ctx.playerPos;
    const pd = pp ? Math.hypot(pp.x - s.x, pp.z - s.z) : 99;
    switch (s.kind) {
      case 'sit':
      case 'boatSit':
        s.timer -= dt;
        if (s.timer < 0) {
          s.timer = 25 + Math.random() * 35;
          if (Math.random() < 0.35) s.clip = s.clip === 'sit' ? 'sitChin' : 'sit';
        }
        break;
      case 'customer':
        // at the counter: buy, then wait (chat) a while
        s.timer -= dt;
        if (s.timer < 0) {
          s.clip = s.clip === 'buy' ? (Math.random() < 0.5 ? 'idle' : 'talk') : 'buy';
          s.timer = s.clip === 'buy' ? 3.2 : 4 + Math.random() * 6;
        }
        break;
      case 'stand':
      case 'boatman':
        s.timer -= dt;
        if (s.timer < 0) {
          s.timer = 6 + Math.random() * 12;
          if (s.clip === 'idle' || s.clip === 'wait') s.clip = Math.random() < 0.5 ? 'idle' : 'wait';
          else if (s.clip === 'stretch' && Math.random() < 0.25) s.gesture = { name: 'agree', until: T + 1.7 };
        }
        // boatmen (and the odd friendly tourist) call out to Prady as he passes
        if ((s.kind === 'boatman' || s.friendly) && pd < 9 && pd > 1.5 && !s.gesture && T > (s.waveAt || 0) && Math.random() < dt * 0.8) {
          s.gesture = { name: 'wave', until: T + 2.6 };
          s.waveAt = T + 35 + Math.random() * 20;
          s.faceGoal = Math.atan2(pp.x - s.x, pp.z - s.z);
        }
        break;
      case 'bather':
        s.timer -= dt;
        if (s.dip) {
          s.dip.t += dt;
          if (!s.dip.splashed && s.dip.t > 1.35) {
            s.dip.splashed = true;
            if (s.dist < 45) this.fx?.splash?.(s.x, this.water.heightAt(s.x, s.z), s.z, 0.32);
          }
          if (s.dip.t > 2.4) s.dip = null;
        }
        if (s.timer < 0) {
          const r = Math.random();
          if (s.clip === 'wash' && r < 0.45) {
            // the holy dip
            s.dip = { t: 0, splashed: false };
            s.clip = 'idle';
            s.timer = 2.6 + 2 + Math.random() * 3;
          } else {
            s.clip = r < 0.75 ? 'wash' : 'idle';
            s.timer = s.clip === 'wash' ? 8.6 * (1 + Math.floor(Math.random() * 2)) - 0.6 : 3 + Math.random() * 3;
          }
        }
        s.rip -= dt;
        if (s.rip < 0 && s.dist < 40) {
          s.rip = 1.6 + Math.random() * 0.9;
          this.ripples?.spawn(s.x, this.water.heightAt(s.x, s.z), s.z, 0.9 + Math.random() * 0.4, 1.8);
        }
        break;
      default:
        break;
    }
  }

  // Conversation: one person talks (gesturing), the others listen, nod or shake their heads.
  _converse(g, dt) {
    g.timer -= dt;
    if (g.timer > 0) return;
    const n = g.members.length;
    g.speaker = (g.speaker + 1 + Math.floor(Math.random() * (n - 1))) % n;
    g.timer = 4 + Math.random() * 6;
    g.members.forEach((s, i) => {
      if (i === g.speaker) {
        s.clip = 'talk';
        s.gesture = null;
      } else {
        s.clip = Math.random() < 0.65 ? 'idle' : 'wait';
        if (Math.random() < 0.5) s.pending = { at: this.time + 0.5 + Math.random() * 1.5, name: Math.random() < 0.72 ? 'agree' : 'headShake', dur: 1.6 + Math.random() * 1.6 };
      }
    });
  }

  // Strolling: back and forth along the track, sidestepping Prady and anything in the way.
  _walk(w, dt, ctx) {
    const t = w.track;
    w.timer -= dt;
    let P = this._trackPoint(t, w.s, w.off);
    const heading = Math.atan2(P.tx * w.dir, P.tz * w.dir);
    const hx = Math.sin(heading);
    const hz = Math.cos(heading);
    const y0 = groundHeight(P.x, P.z);
    const pp = ctx.playerPos;
    let speedT = 0;
    if (w.state === 'walk') {
      speedT = w.vMax * (w.members[0].inst?.avatar.walkSpeed || 1.5);
      // Prady in the way?
      if (pp && Math.abs(pp.y - y0) < 2.2) {
        const dx = pp.x - P.x;
        const dz = pp.z - P.z;
        const d = Math.hypot(dx, dz);
        const ahead = dx * hx + dz * hz;
        if (d < 2.6 && ahead > -0.3) {
          const side = dx * P.nx + dz * P.nz; // + = Prady is on the river side of us
          const want = clamp(w.off + (side > 0 ? -1 : 1) * 0.95, t.band[0], t.band[1]);
          if (Math.abs(want - w.off) > 0.4) w.offT = want;
          w.clearT = 0;
          if (d < 1.15 && ahead > 0) {
            speedT = 0;
            w.blocked += dt;
          }
        }
      }
      // look ahead for takhts, pillars, other people…
      w.probe -= dt;
      if (w.probe <= 0) {
        w.probe = 0.2;
        const hit = this._ray(P.x, y0, P.z, hx, hz, w);
        if (hit !== null && hit < 1.5) {
          let moved = false;
          for (const dOff of [0.95, -0.95]) {
            const o = w.off + dOff;
            if (o < t.band[0] || o > t.band[1]) continue;
            const Q = this._trackPoint(t, w.s, o);
            const h2 = this._ray(Q.x, groundHeight(Q.x, Q.z), Q.z, hx, hz, w);
            if (h2 === null || h2 > 2.2) {
              w.offT = o;
              moved = true;
              break;
            }
          }
          if (!moved) w.blocked += 0.4;
          w.clearT = 0;
        } else {
          w.clearT += 0.2;
          if (w.clearT > 3 && Math.abs(w.offT) > 0.05) {
            const Q = this._trackPoint(t, w.s, 0);
            const h2 = this._ray(Q.x, groundHeight(Q.x, Q.z), Q.z, hx, hz, w);
            if (h2 === null || h2 > 2.5) w.offT = 0;
            w.clearT = 0;
          }
          w.blocked = Math.max(0, w.blocked - 0.1);
        }
      }
      const end = (w.dir > 0 && w.s >= t.b) || (w.dir < 0 && w.s <= t.a);
      if (end || w.blocked > 2.2) {
        w.state = 'pause';
        w.timer = 1.2 + Math.random() * 2.5;
        w.turnAfter = true;
        w.blocked = 0;
      } else if (Math.random() < dt * 0.01) {
        // stop for a moment to look at the river
        w.state = 'pause';
        w.timer = 3 + Math.random() * 4;
        w.turnAfter = false;
        w.lookRiver = true;
      }
    } else if (w.state === 'pause') {
      if (w.timer <= 0) {
        w.lookRiver = false;
        if (w.turnAfter) {
          w.dir *= -1;
          w.state = 'turn';
        } else w.state = 'walk';
      }
    } else if (w.state === 'turn') {
      const want = Math.atan2(P.tx * w.dir, P.tz * w.dir);
      if (Math.abs(wrapAngle(want - w.yaw)) < 0.2) w.state = 'walk';
    }
    w.speed = damp(w.speed, speedT, speedT > w.speed ? 2.2 : 4.5, dt);
    w.s += (w.dir * w.speed * dt) / t.ds;
    const offPrev = w.off;
    w.off = damp(w.off, w.offT, 1.4, dt);
    P = this._trackPoint(t, w.s, w.off);
    // face the way we're going, leaning into sidesteps; turn to the river when admiring it
    const lateral = (w.off - offPrev) / Math.max(dt, 1e-4);
    const latX = P.nx * lateral;
    const latZ = P.nz * lateral;
    const vx = P.tx * w.dir * Math.max(w.speed, 0.25) + latX;
    const vz = P.tz * w.dir * Math.max(w.speed, 0.25) + latZ;
    let yawT = w.state === 'turn' ? Math.atan2(P.tx * w.dir, P.tz * w.dir) : Math.atan2(vx, vz);
    if (w.lookRiver) yawT = Math.atan2(P.nx, P.nz);
    w.yaw = dampAngle(w.yaw, yawT, w.state === 'turn' ? 2.4 : 4, dt);
    const fx = Math.sin(w.yaw);
    const fz = Math.cos(w.yaw);
    for (let i = 0; i < w.members.length; i++) {
      const s = w.members[i];
      const lat = w.lat[i];
      const back = i > 0 ? 0.18 : 0;
      const x = P.x + P.nx * lat - fx * back;
      const z = P.z + P.nz * lat - fz * back;
      s.x = x;
      s.z = z;
      s.y = damp(s.y, groundHeight(x, z), 10, dt);
      s.yaw = w.yaw;
      s.clip = w.lookRiver ? 'wait' : 'idle';
      if (s.body && s.inst) s.body.setNextKinematicTranslation({ x, y: s.y + 0.85, z });
    }
  }

  _ray(x, y, z, hx, hz, w) {
    const ex = w.members.length === 1 ? w.members[0].collider : undefined;
    let best = null;
    for (const hy of [0.16, 0.45, 1.25]) {
      const h = this.physics.castRay({ x, y: y + hy, z }, { x: hx, y: 0, z: hz }, 2.6, ex, GROUPS.feet);
      if (h !== null && (best === null || h < best)) best = h;
    }
    return best;
  }

  // ---------------------------------------------------------------- procedural layer

  _lookWeight(s, dt, ctx) {
    let want = 0;
    s.lookTarget = null;
    const pp = ctx.playerPos;
    if (pp && s.kind !== 'priest' && !s.dip && s.dist < 25) {
      const dx = pp.x - s.x;
      const dz = pp.z - s.z;
      const d = Math.hypot(dx, dz);
      const rel = Math.abs(wrapAngle(Math.atan2(dx, dz) - s.inst.holder.rotation.y));
      if (d < 5.5 && rel < 1.9 && Math.abs(pp.y - s.y) < 3) {
        want = 1;
        _v3.set(pp.x, pp.y + 1.55, pp.z);
        s.lookTarget = _v3;
      }
    }
    // listeners look at whoever is talking
    if (!s.lookTarget && s.group) {
      const sp = s.group.members[s.group.speaker];
      if (sp && sp !== s) {
        want = 0.85;
        s.lookTarget = _v3.set(sp.x, sp.y + 1.5 * sp.scale, sp.z);
      }
    }
    s.look = damp(s.look, want, 3, dt);
    return s.look;
  }

  _look(s, body, w) {
    const { neck, head } = body.b;
    if (!head || !s.lookTarget) return;
    head.getWorldPosition(_v);
    _v2.subVectors(s.lookTarget, _v);
    const len = _v2.length();
    if (len < 0.2) return;
    _v2.divideScalar(len);
    const yaw = body.holder.rotation.y;
    const dYaw = clamp(wrapAngle(Math.atan2(_v2.x, _v2.z) - yaw), -1.15, 1.15);
    const pitch = clamp(Math.asin(clamp(_v2.y, -1, 1)), -0.45, 0.35);
    if (neck) rotateBoneAxis(neck, UP, dYaw * 0.4 * w);
    rotateBoneAxis(head, UP, dYaw * 0.6 * w);
    _v.set(Math.cos(yaw + dYaw), 0, -Math.sin(yaw + dYaw));
    rotateBoneAxis(head, _v, -pitch * 0.75 * w);
  }

  // Seated: put the soles flat on whatever is under the feet.
  _plantFeet(s, body) {
    const b = body.b;
    const fwd = _v2.set(Math.sin(body.holder.rotation.y), 0, Math.cos(body.holder.rotation.y));
    if (s.kind === 'boatSit') body.holder.getWorldDirection(fwd);
    for (const [th, ca, ft] of [
      [b.lThigh, b.lCalf, b.lFoot],
      [b.rThigh, b.rCalf, b.rFoot],
    ]) {
      if (!th || !ca || !ft) continue;
      ft.getWorldPosition(_v);
      const ty = s.feetY + ANKLE_H * s.scale;
      if (Math.abs(_v.y - ty) < 0.006) continue;
      _v.y = ty;
      solveTwoBone(th, ca, ft, _v, fwd, 1);
    }
  }

  // The aarti: a big brass lamp circled in slow vertical loops, a bell in the other hand.
  // A boatman at his oars: lean with the drive, hands on the grips (Oars.js), elbows out and down.
  _rowArms(s, body) {
    const b = body.b;
    const boat = s.ride.boat;
    const H = boat.oarHands;
    const R = _v3.set(-Math.cos(boat.yaw), 0, Math.sin(boat.yaw)); // his right (he faces the bow, +Z)
    if (b.spine1) {
      rotateBoneAxis(b.spine1, R, -(boat.oarLean ?? 0) * 0.26);
      b.spine1.updateMatrixWorld(true);
    }
    if (b.lUpper && b.lFore && b.lHand) solveTwoBone(b.lUpper, b.lFore, b.lHand, H[0], new THREE.Vector3().copy(R).multiplyScalar(-0.75).addScaledVector(UP, -0.65), 1);
    if (b.rUpper && b.rFore && b.rHand) solveTwoBone(b.rUpper, b.rFore, b.rHand, H[1], new THREE.Vector3().copy(R).multiplyScalar(0.75).addScaledVector(UP, -0.65), 1);
  }

  _aartiArms(s, body) {
    const b = body.b;
    if (!b.rUpper || !b.rFore || !b.rHand) return;
    const yaw = body.holder.rotation.y;
    const F = _v2.set(Math.sin(yaw), 0, Math.cos(yaw));
    const R = _v3.set(-Math.cos(yaw), 0, Math.sin(yaw)); // the body's right (model faces +Z)
    const t = this.time * ((Math.PI * 2) / 2.8) + s.phase;
    b.rUpper.getWorldPosition(_v);
    const sc = s.scale;
    const target = new THREE.Vector3()
      .copy(_v)
      .addScaledVector(F, 0.42 * sc)
      .addScaledVector(UP, -0.08 * sc + Math.sin(t) * 0.3 * sc)
      .addScaledVector(R, -0.12 * sc + Math.cos(t) * 0.24 * sc);
    const pole = new THREE.Vector3().copy(R).multiplyScalar(0.7).addScaledVector(UP, -0.7);
    solveTwoBone(b.rUpper, b.rFore, b.rHand, target, pole, 1);
    if (b.lUpper && b.lFore && b.lHand) {
      b.lUpper.getWorldPosition(_v);
      const bell = new THREE.Vector3()
        .copy(_v)
        .addScaledVector(F, 0.3 * sc)
        .addScaledVector(UP, -0.22 * sc + Math.sin(this.time * 15 + s.phase) * 0.018)
        .addScaledVector(R, 0.1 * sc);
      solveTwoBone(b.lUpper, b.lFore, b.lHand, bell, new THREE.Vector3().copy(R).multiplyScalar(-0.7).addScaledVector(UP, -0.7), 1);
    }
  }

  _priest(s, ctx, lamps, visible) {
    const body = s.inst;
    const hand = body.b.rFinger || body.b.rHand;
    if (!hand || s.fade < 0.05) {
      this._priestLamp(s, null);
      return lamps;
    }
    hand.getWorldPosition(_v);
    body.b.rHand?.getWorldPosition(_v2);
    _v.lerp(_v2, 0.4);
    _v.y += 0.06;
    if (visible) {
      _m.compose(_v, _q.identity(), _s.set(1, 1, 1));
      this.lampMesh.setMatrixAt(lamps++, _m);
    }
    this._priestLamp(s, _v);
    return lamps;
  }

  _priestLamp(s, pos) {
    if (!this.fire || !s.flames) return;
    const on = !!pos;
    if (on !== s.flameOn) {
      s.flameOn = on;
      for (const id of s.flames) if (id >= 0) this.fire.setLit(id, on ? 1 : 0);
    }
    if (!on) return;
    s.flames.forEach((id, k) => {
      if (id < 0) return;
      const a = (k / s.flames.length) * Math.PI * 2;
      const r = k === 0 ? 0 : 0.12;
      this.fire.setPosition(id, pos.x + Math.cos(a) * r * (k ? 1 : 0), pos.y + 0.1 + (k === 0 ? 0.03 : 0), pos.z + Math.sin(a) * r * (k ? 1 : 0));
    });
  }

  // Prady greets (G): people close by wave back or nod.
  // ---------------------------------------------------------------- mission actors
  // People the missions place and move: a giver waiting at a ghat, a passenger in Prady's
  // boat, a lost child who follows him home. Always drawn when near (ahead of the budget);
  // the mission sets x, y, z, yaw, clip and actor.speed (m/s, blends the walk) every frame.
  addActor({ avatarId, x, y, z, yaw = 0, clip = 'idle', seatY, feetY, noCollider = false, name = '', ride = null }) {
    const seat = seatY !== undefined;
    if (ride) noCollider = true; // (a boatman standing at his oars: the boat carries him)
    const s = this._slot({ kind: 'actor', actor: { speed: 0, name }, avatarId, clip, x, y, z, yaw, seat, seatY, feetY, hours: [0, 24], roles: ['local'], noCollider, scale: 1 }, this.rng || { range: (a, b) => (a + b) / 2, next: () => 0.5 });
    s.yawNow = yaw;
    s.ride = ride; // { boat (PlayerBoat), local: {x, y, z} }: stands in it, hands on its oars
    const def = this.manifest.avatars.find((d) => d.id === avatarId);
    if (def?.kurta && !s.tint) s.tint = 'cream';
    this.selectTimer = 0;
    return s;
  }

  removeActor(s) {
    if (!s) return;
    s.gone = true;
    s.wanted = false;
    if (s.inst) this._release(s);
    if (s.collider) {
      this.physics.world.removeCollider(s.collider, false);
      s.collider = null;
    }
    if (s.body) {
      this.physics.world.removeRigidBody(s.body);
      s.body = null;
    }
  }

  /** A short gesture now (wave, pranam, agree, talk…), facing a point if given. */
  gesture(s, name, dur, face) {
    if (!s) return;
    s.gesture = { name, until: this.time + dur };
    if (face) s.faceGoal = Math.atan2(face.x - s.x, face.z - s.z);
  }

  greet(pos) {
    let n = 0;
    for (const s of this.live) {
      if (!s.wanted || s.kind === 'priest' || s.kind === 'walker' || s.dip) continue;
      const d = Math.hypot(pos.x - s.x, pos.z - s.z);
      if (d > 9) continue;
      const at = this.time + 0.3 + Math.random() * 0.9 + d * 0.05;
      const def = this.avatars.get(s.avatarId)?.def;
      if (s.seat || s.low || s.kind === 'bather' || s.busy) s.pending = { at, name: 'agree', dur: 1.7 };
      else if (def?.role === 'tourist' && Math.random() < 0.6) s.pending = { at, name: 'wave', dur: 2.6, face: Math.atan2(pos.x - s.x, pos.z - s.z) };
      else s.pending = { at, name: 'pranam', dur: 2.0, face: Math.atan2(pos.x - s.x, pos.z - s.z) };
      n++;
    }
    return n;
  }

  debugInfo() {
    return { live: this.live.length, wanted: this.live.filter((s) => s.wanted).length, ready: [...this.avatars.values()].filter((a) => a.ready).length, ...this.stats };
  }
}

