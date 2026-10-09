import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { ANIMALS } from '../config.js';
import { ASSET_MANIFEST } from '../core/Assets.js';
import { GROUPS } from '../core/Physics.js';
import { clamp, damp, dampAngle, wrapAngle } from '../utils/math.js';
import { PROFILE, ghatById, ghatToWorld, groundHeight } from './WorldLayout.js';

// The ghats' animals: sacred cows standing about the terraces and landings, and the street dogs
// of Kashi. Each is one skinned mesh with one walk clip (Genex, quadruped-rigged); standing still
// it eases into the model's own rest pose, and a tail, a head and a breath are moved by hand
// over whatever the clip does.
//
// They are solid (a kinematic box, Physics.addMover): Prady walks into a cow like a wall, and a
// cow pushed on for a moment lows and steps aside. A dog sprinted into yelps and runs; a dog he
// lingers by may take to him and trot along for a while. Asuras near: the dogs bark at them
// from a distance and bolt when one comes close, the cows amble off. Far ones are hidden and
// still (ANIMALS.viewDist).

const UP = new THREE.Vector3(0, 1, 0);
const _pq = new THREE.Quaternion();
const _rq = new THREE.Quaternion();
const _wq = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

function rotateWorld(bone, axis, angle) {
  bone.parent.getWorldQuaternion(_pq);
  bone.getWorldQuaternion(_wq);
  _wq.premultiply(_rq.setFromAxisAngle(axis, angle));
  bone.quaternion.copy(_pq.invert().multiply(_wq));
  bone.updateWorldMatrix(false, true);
}

// the flats of the ghat profile an animal keeps to: the top terrace, landing 1, landing 2
const FLATS = PROFILE.filter((s) => s.kind === 'flat');

export class Animals {
  constructor(game) {
    this.g = game;
    this.list = [];
    this.kinds = {};
    this.barkT = 30;
    this.time = 0;
    this.load();
  }

  async load() {
    const g = this.g;
    const M = ASSET_MANIFEST.animals;
    const [cow, dog] = await Promise.all([g.assets.gltfAsync(M.cow.url), g.assets.gltfAsync(M.dog.url)]);
    if (cow) this.kinds.cow = this.prepare(cow, M.cow);
    if (dog) this.kinds.dog = this.prepare(dog, M.dog);
    const avoid = [...(g.world.layout.umbrellas || []), ...(g.world.layout.aartiPlatforms || []), ...(g.world.layout.trees || [])];
    for (const [kind, defs] of [['cow', ANIMALS.cows], ['dog', ANIMALS.dogs]]) {
      if (!this.kinds[kind]) continue;
      for (const d of defs) this.spawn(kind, d, avoid);
    }
    console.info(`[animals] ${this.list.length} on the ghats`);
  }

  /** One kind: its source, the walk clip, a rest clip from the bind pose, where its tail and head are. */
  prepare(gltf, def) {
    const src = gltf.scene;
    const walk = gltf.animations[0];
    src.updateMatrixWorld(true);
    // the rest pose as a clip (the stand the walk eases out into)
    const tracks = [];
    for (const t of walk.tracks) {
      const [name, prop] = t.name.split('.');
      const node = src.getObjectByName(name);
      if (!node || !node[prop]) continue;
      const v = node[prop].toArray();
      tracks.push(prop === 'quaternion' ? new THREE.QuaternionKeyframeTrack(t.name, [0, 1], [...v, ...v]) : new THREE.VectorKeyframeTrack(t.name, [0, 1], [...v, ...v]));
    }
    const rest = new THREE.AnimationClip('rest', 1, tracks);
    // size, and where its feet are (the bind pose; the model's nose turned to +Z)
    const box = new THREE.Box3().setFromObject(src);
    // the tail: bones behind the hind legs' roots, nearest the spine first; the head: the last
    // head bone (named by the rigger: tripoHead_*)
    const fwd = new THREE.Vector3(Math.sin(-def.front), 0, Math.cos(-def.front)); // model space forward
    const bones = [];
    src.traverse((o) => o.isBone && bones.push(o));
    const at = (b) => b.getWorldPosition(new THREE.Vector3()).dot(fwd);
    const limbRoots = bones.filter((b) => /Limb_0$/.test(b.name));
    const hind = Math.min(...limbRoots.map(at));
    const tail = bones.filter((b) => !/Limb|Head/.test(b.name) && at(b) < hind - 0.04).sort((a, b) => at(b) - at(a)).map((b) => b.name);
    const heads = bones.filter((b) => /^tripoHead_\d+$/.test(b.name)).sort((a, b) => a.name.localeCompare(b.name));
    // (the bones the clip drives are set afresh every frame; the others keep whatever they were
    // given, so the hand-made turns must start from their rest pose each time: see layers())
    const driven = new Set(walk.tracks.map((t) => t.name.split('.')[0]));
    const spine = bones.filter((b) => /^tripoSpine_[12]$/.test(b.name)).map((b) => b.name);
    // (the manifest's rig roles when it has them: an auto-rig's names can mislead)
    const R = def.rig || {};
    const pitch = R.pitch || [[heads[0]?.name, 0.6], [heads[heads.length - 1]?.name, 0.4]];
    const look = R.look || [[heads[0]?.name, 0.45], [heads[heads.length - 1]?.name, 0.55]];
    return { src, walk, rest, def, box, tail: R.tail || tail, pitch, look, driven, spine: R.spine || spine };
  }

  spawn(kind, d, avoid) {
    const g = this.g;
    const K = this.kinds[kind];
    const gh = ghatById(d.ghat);
    const flat = FLATS[d.flat ?? 0];
    if (!gh || !flat) return;
    const v0 = flat.v0 + 0.9;
    const v1 = flat.v1 - 0.9;
    const clear = (p) => groundHeight(p.x, p.z) > 0.5 && avoid.every((q) => Math.hypot(q.x - p.x, q.z - p.z) > 3.2) && !this.crowdNear(p.x, p.z, 2.2, true);
    let u = clamp(d.u, 6, gh.width - 6);
    let p = ghatToWorld(gh, u, (v0 + v1) / 2);
    for (let i = 0; i < 12 && !clear(p); i++) {
      u = clamp(d.u + (i % 2 ? 1 : -1) * (2 + i * 1.5), 4, gh.width - 4);
      p = ghatToWorld(gh, u, (v0 + v1) / 2);
    }
    if (!clear(p)) return;
    const A = ANIMALS[kind];
    const root = new THREE.Group();
    root.name = `animal-${kind}`;
    const model = SkeletonUtils.clone(K.src);
    const s = K.def.scale;
    model.scale.setScalar(s);
    model.rotation.y = K.def.front;
    model.position.y = -K.box.min.y * s;
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false; // (skinned: the bind-pose box would cull a walking leg)
      }
    });
    root.add(model);
    g.scene.add(root);
    g.water?.skipInReflection(root);
    const mixer = new THREE.AnimationMixer(model);
    const walk = mixer.clipAction(K.walk);
    const rest = mixer.clipAction(K.rest);
    walk.play();
    rest.play();
    walk.time = Math.random() * K.walk.duration;
    const [bw, bh, bd] = A.box;
    const y = groundHeight(p.x, p.z);
    const mover = g.physics.addMover(p.x, y + bh / 2, p.z, bw, bh, bd, GROUPS.people);
    const yaw = Math.atan2(gh.T.x, gh.T.z) * (Math.random() < 0.5 ? 1 : -1);
    const find = (n) => (n ? model.getObjectByName(n) : null);
    const a = {
      kind,
      root,
      model,
      mixer,
      walk,
      rest,
      mover,
      x: p.x,
      z: p.z,
      y,
      yaw,
      pitch: 0,
      speed: 0,
      want: 0,
      state: 'idle',
      t: 0,
      wait: 2 + Math.random() * 8,
      target: null,
      home: { gh, u0: Math.max(3, u - 10), u1: Math.min(gh.width - 3, u + 10), v0, v1 },
      tail: K.tail.map(find).filter(Boolean),
      pitchBones: K.pitch.map(([n, w]) => [find(n), w]).filter(([b]) => b),
      lookBones: K.look.map(([n, w]) => [find(n), w]).filter(([b]) => b),
      spine: K.spine.map(find).filter(Boolean),
      hand: [],
      lookAng: 0,
      wag: 0,
      push: 0,
      seed: Math.random() * 100,
      adoptAt: -999,
      lastSound: -99,
      near: true,
    };
    // every bone moved by hand, with the clip's clean pose of it: put back before each mixer
    // update and taken again after it. (The mixer only writes a bone when its value changes:
    // standing still, nothing rewrote them, and each frame's turn wound onto the last)
    a.hand = [...new Set([...a.tail, ...a.pitchBones.map(([b]) => b), ...a.lookBones.map(([b]) => b), ...a.spine])].map((b) => [b, b.quaternion.clone()]);
    this.list.push(a);
    this.place(a);
  }

  /** Someone of the crowd within r of (x,z): the people about now, and (all) where people stay. */
  crowdNear(x, z, r, all = false) {
    const C = this.g.crowd;
    if (!C) return false;
    for (const s of all ? C.slots : C.live) {
      if (all && s.walker) continue;
      if (Math.abs(s.x - x) < r && Math.abs(s.z - z) < r && Math.hypot(s.x - x, s.z - z) < r) return true;
    }
    return false;
  }

  /** A blast or a stomp: everything nearby bolts away from it. */
  startle(x, z, r = 12) {
    for (const a of this.list) {
      const d = Math.hypot(a.x - x, a.z - z);
      if (d > r) continue;
      this.flee(a, x, z, a.kind === 'dog' ? 12 : 7);
      if (a.kind === 'dog') this.sound(a, 'dog-yelp', 0.8);
      else this.sound(a, 'cow-moo', 0.7, 1.1);
    }
  }

  sound(a, name, volume = 0.7, rate = 1) {
    if (this.time - a.lastSound < 0.8) return;
    a.lastSound = this.time;
    this.g.audio.play(name, { at: new THREE.Vector3(a.x, a.y + 0.8, a.z), volume, rate: rate * (0.94 + Math.random() * 0.12), ref: a.kind === 'cow' ? 12 : 9 });
  }

  /** Off, away from (x,z): a point that far on, kept to dry stone. */
  flee(a, x, z, dist) {
    const dx = a.x - x;
    const dz = a.z - z;
    const l = Math.hypot(dx, dz) || 1;
    let best = null;
    for (const turn of [0, 0.5, -0.5, 1, -1]) {
      const c = Math.cos(turn);
      const s = Math.sin(turn);
      const ux = (dx / l) * c - (dz / l) * s;
      const uz = (dx / l) * s + (dz / l) * c;
      const tx = a.x + ux * dist;
      const tz = a.z + uz * dist;
      if (groundHeight(tx, tz) > 0.5 && groundHeight((a.x + tx) / 2, (a.z + tz) / 2) > 0.4) {
        best = { x: tx, z: tz };
        break;
      }
    }
    if (!best) return;
    a.state = 'flee';
    a.target = best;
    a.t = 0;
  }

  update(dt) {
    if (!this.list.length) return;
    const g = this.g;
    this.time = (this.time || 0) + dt;
    const P = g.player.position;
    const cam = g.camera.position;
    const pv = g.player.velocity;
    const pSpeed = Math.hypot(pv.x, pv.z);
    const playing = g.state === 'play';
    const pOnFoot = g.player.state === 'ground' || g.player.state === 'air';
    const view2 = ANIMALS.viewDist * ANIMALS.viewDist;
    // the nearest Asura to each (only while the dark is up)
    const asuras = g.asuras?.active ? g.asuras.list.filter((x) => x.alive && x.state !== 'rise') : [];
    // a distant bark now and then: the city is full of them
    this.barkT -= dt;
    if (this.barkT <= 0) {
      this.barkT = 35 + Math.random() * 50;
      const dogs = this.list.filter((a) => a.kind === 'dog' && Math.hypot(a.x - P.x, a.z - P.z) < 60);
      if (dogs.length && playing) this.sound(dogs[(Math.random() * dogs.length) | 0], 'dog-bark', 0.45);
    }
    for (const a of this.list) {
      const d2c = (a.x - cam.x) ** 2 + (a.z - cam.z) ** 2;
      a.near = d2c < view2;
      a.root.visible = a.near;
      if (!a.near) continue;
      this.think(a, dt, P, pSpeed, playing && pOnFoot, asuras);
      this.move(a, dt);
      this.place(a);
      // the clip (half rate further off), then the hand-made layers up close
      const far = d2c > 40 * 40;
      a.skip = far ? !a.skip : false;
      if (!a.skip) {
        this.animate(a, far ? dt * 2 : dt);
        if (!far) this.layers(a, dt, P);
      }
      const shadow = d2c < 35 * 35;
      if (shadow !== a.shadow) {
        a.shadow = shadow;
        a.model.traverse((m) => m.isMesh && (m.castShadow = shadow));
      }
      // (the camera inside a cow: hide it rather than look out through its skin)
      a.root.visible = Math.hypot(a.x - cam.x, a.y + 0.6 - cam.y, a.z - cam.z) > (a.kind === 'cow' ? 1.3 : 0.7);
    }
  }

  think(a, dt, P, pSpeed, live, asuras) {
    const A = ANIMALS[a.kind];
    const dog = a.kind === 'dog';
    a.t += dt;
    const dp = Math.hypot(P.x - a.x, P.z - a.z);
    // the nearest Asura
    let th = null;
    let td = Infinity;
    for (const x of asuras) {
      const d = Math.hypot(x.pos.x - a.x, x.pos.z - a.z);
      if (d < td) {
        td = d;
        th = x;
      }
    }
    if (th && a.state !== 'flee') {
      if (td < (dog ? 5.5 : 11)) {
        this.flee(a, th.pos.x, th.pos.z, dog ? 14 : 8);
        if (dog) this.sound(a, 'dog-yelp', 0.6);
        return;
      }
      if (dog && td < 18) {
        // stand its ground at a distance and bark at it
        a.state = 'bark';
        a.target = null;
        a.face = Math.atan2(th.pos.x - a.x, th.pos.z - a.z);
        a.want = 0;
        a.barkT = (a.barkT ?? 0) - dt;
        if (a.barkT <= 0) {
          a.barkT = 1.3 + Math.random() * 1.4;
          this.sound(a, 'dog-bark', 0.85);
          a.wag = 1;
        }
        return;
      }
    }
    if (a.state === 'bark' && !th) a.state = 'idle';
    // Prady walking into it (it is solid: he is stopped against it, pushing)
    const inX = Math.abs((P.x - a.x) * Math.cos(a.yaw) - (P.z - a.z) * Math.sin(a.yaw));
    const inZ = Math.abs((P.x - a.x) * Math.sin(a.yaw) + (P.z - a.z) * Math.cos(a.yaw));
    const touching = live && inX < A.box[0] / 2 + 0.55 && inZ < A.box[2] / 2 + 0.55 && Math.abs(P.y - 0.9 - a.y) < 1.2;
    const g = this.g;
    const pushing = touching && (g.player.cmd?.mag ?? 0) > 0.3;
    a.push = pushing ? a.push + dt : Math.max(0, a.push - dt * 2);
    if (dog && touching && pSpeed > 3.2 && a.state !== 'flee') {
      // sprinted into: a yelp and away
      this.flee(a, P.x, P.z, 9);
      this.sound(a, 'dog-yelp', 0.9);
      a.adoptAt = this.time + 30;
      return;
    }
    if (!dog && a.push > 0.55 && a.state !== 'flee') {
      // leaned on long enough: a low, and it shifts aside, unhurried
      this.flee(a, P.x, P.z, 2.6);
      if (a.state === 'flee') a.state = 'walk';
      this.sound(a, 'cow-moo', 0.75, 0.95);
      a.push = 0;
      return;
    }
    // a dog may take to him: lingering near it, it follows a while
    if (dog && live && a.state !== 'follow' && a.state !== 'flee' && dp < 3.5 && this.time > a.adoptAt) {
      a.adoptAt = this.time + 40;
      if (Math.random() < A.adopt) {
        a.state = 'follow';
        a.t = 0;
        a.followFor = A.followSecs[0] + Math.random() * (A.followSecs[1] - A.followSecs[0]);
        a.wag = 1;
      }
    }
    switch (a.state) {
      case 'idle': {
        a.want = 0;
        // a cow lows now and then; it turns its head to him as he passes
        if (!dog && Math.random() < dt * 0.012) this.sound(a, 'cow-moo', 0.55);
        if (a.t > a.wait) {
          // somewhere on its ground clear of where people sit and stand (and the way there)
          const H = a.home;
          a.t = 0;
          for (let i = 0; i < 8; i++) {
            const T = ghatToWorld(H.gh, H.u0 + Math.random() * (H.u1 - H.u0), H.v0 + Math.random() * (H.v1 - H.v0));
            if (this.crowdNear(T.x, T.z, 1.8, true) || this.crowdNear((T.x + a.x) / 2, (T.z + a.z) / 2, 1.4, true)) continue;
            a.target = T;
            a.state = 'walk';
            break;
          }
        }
        break;
      }
      case 'walk':
      case 'home':
      case 'flee': {
        const T = a.target;
        const d = T ? Math.hypot(T.x - a.x, T.z - a.z) : 0;
        if (!T || d < 0.5 || a.t > 20) {
          a.state = 'idle';
          a.t = 0;
          a.wait = dog ? 3 + Math.random() * 9 : 6 + Math.random() * 16;
          a.want = 0;
          break;
        }
        a.face = Math.atan2(T.x - a.x, T.z - a.z);
        const fast = a.state === 'flee' ? (dog ? A.run : A.flee) : A.walk;
        a.want = fast * clamp(d / 1.2, 0.3, 1);
        break;
      }
      case 'follow': {
        if (!live || dp > 32 || a.t > a.followFor) {
          // back to its own ghat
          const H = a.home;
          a.target = ghatToWorld(H.gh, (H.u0 + H.u1) / 2, (H.v0 + H.v1) / 2);
          a.state = 'home';
          a.t = 0;
          break;
        }
        // at his heel, a little behind and to the side; waits when he stops
        const yaw = g.player.yaw;
        const tx = P.x - Math.sin(yaw) * 1.6 + Math.cos(yaw) * 1.1;
        const tz = P.z - Math.cos(yaw) * 1.6 - Math.sin(yaw) * 1.1;
        const d = Math.hypot(tx - a.x, tz - a.z);
        // (never into the river after him)
        if (groundHeight(tx, tz) < 0.4 || d < 0.6) {
          a.want = 0;
          a.face = Math.atan2(P.x - a.x, P.z - a.z);
        } else {
          a.face = Math.atan2(tx - a.x, tz - a.z);
          a.want = clamp((d - 0.5) * 1.3, 0, A.run);
        }
        a.wag = Math.max(a.wag, 0.6);
        break;
      }
      default:
        break;
    }
  }

  move(a, dt) {
    const A = ANIMALS[a.kind];
    // speeds up gently and slows to a stand; turns at an animal's pace (a cow swings round slowly)
    a.speed = damp(a.speed, a.want, a.want > a.speed ? 2.2 : 4, dt);
    if (a.face !== undefined) {
      const dy = wrapAngle(a.face - a.yaw);
      a.yaw += clamp(dy, -A.turn * dt, A.turn * dt);
      // (a sharp turn slows it: no gliding sideways)
      if (Math.abs(dy) > 0.9) a.speed = Math.min(a.speed, 0.35);
    }
    if (a.speed < 0.01) return;
    const nx = a.x + Math.sin(a.yaw) * a.speed * dt;
    const nz = a.z + Math.cos(a.yaw) * a.speed * dt;
    // dry stone only, and no stepping off a terrace's edge (a drop over a knee's height)
    const ny = groundHeight(nx, nz);
    if (ny < 0.35 || ny < a.y - 0.6 || ny > a.y + 0.6) {
      a.speed = 0;
      if (a.state !== 'follow') a.state = 'idle';
      a.t = 0;
      return;
    }
    // nor through the people: it stops for them, and after a moment goes another way
    const ahead = a.kind === 'cow' ? 1.1 : 0.6;
    if (this.crowdNear(nx + Math.sin(a.yaw) * ahead, nz + Math.cos(a.yaw) * ahead, a.kind === 'cow' ? 0.85 : 0.5)) {
      a.speed = 0;
      a.blockT = (a.blockT || 0) + dt;
      if (a.blockT > 1.2 && a.state !== 'follow') {
        a.blockT = 0;
        a.state = 'idle';
        a.t = 0;
        a.wait = 0.5;
      }
      return;
    }
    a.blockT = 0;
    // nor through Prady
    const P = this.g.player.position;
    if (Math.hypot(nx - P.x, nz - P.z) < (a.kind === 'cow' ? 1.25 : 0.75) && Math.hypot(nx - P.x, nz - P.z) < Math.hypot(a.x - P.x, a.z - P.z)) {
      a.speed = 0;
      return;
    }
    a.x = nx;
    a.z = nz;
  }

  /** Root, body pitch on the steps, and the collider. */
  place(a) {
    const A = ANIMALS[a.kind];
    const half = A.box[2] * 0.42;
    const fx = Math.sin(a.yaw) * half;
    const fz = Math.cos(a.yaw) * half;
    const hf = groundHeight(a.x + fx, a.z + fz);
    const hb = groundHeight(a.x - fx, a.z - fz);
    const want = (hf + hb) / 2;
    a.y = a.y === undefined ? want : damp(a.y, want, 10, 1 / 60);
    a.pitch = damp(a.pitch, Math.atan2(hb - hf, half * 2), 8, 1 / 60);
    a.root.position.set(a.x, a.y, a.z);
    a.root.rotation.set(0, a.yaw, 0);
    a.root.rotateX(a.pitch);
    this.g.physics.setMover(a.mover, a.x, a.y + A.box[1] / 2, a.z, a.yaw);
  }

  animate(a, dt) {
    const K = this.kinds[a.kind];
    // the walk's weight follows its real speed; its rate keeps the hooves planted
    const w = clamp(a.speed / 0.25, 0, 1);
    a.walk.setEffectiveWeight(w);
    a.rest.setEffectiveWeight(1 - w);
    a.walk.timeScale = w > 0 ? Math.max(0.35, a.speed / (K.def.stride * K.def.scale)) : 0;
    for (const [b, q] of a.hand) b.quaternion.copy(q);
    a.mixer.update(dt);
    for (const [b, q] of a.hand) q.copy(b.quaternion);
  }

  /** The tail, the head, the breath: by hand, over the clip. */
  layers(a, dt, P) {
    const dog = a.kind === 'dog';
    const t = this.time + a.seed;
    // (animate() has just put the clip's clean pose back on every bone moved here)
    a.model.updateMatrixWorld(true);
    // the tail: a dog's wags with its mood; a cow's swishes at the flies now and then
    a.wag = Math.max(0, a.wag - dt * 0.15);
    const amp = dog ? 0.12 + a.wag * 0.4 : Math.max(0, Math.sin(t * 0.37)) ** 6 * 0.45;
    const freq = dog ? 7 + a.wag * 6 : 3.1;
    a.tail.forEach((b, i) => rotateWorld(b, UP, Math.sin(t * freq - i * 0.7) * amp * (0.5 + i * 0.25)));
    // the head: toward him when he is close and it is standing (or following), else idly about
    const dp = Math.hypot(P.x - a.x, P.z - a.z);
    let want = Math.sin(t * 0.21) * 0.25;
    if (dp < 7 && a.speed < 0.3) want = clamp(wrapAngle(Math.atan2(P.x - a.x, P.z - a.z) - a.yaw), -0.75, 0.75);
    a.lookAng = dampAngle(a.lookAng, want, 3, dt);
    for (const [b, w] of a.lookBones) rotateWorld(b, UP, a.lookAng * w);
    // nose to the ground now and then while it stands: a cow grazing at a dropped garland, a dog
    // sniffing the stone (and up again whenever he comes close, or it moves off)
    a.grazeT = (a.grazeT ?? 4 + Math.random() * 8) - dt;
    if (a.grazeT <= 0) {
      a.grazing = !a.grazing;
      a.grazeT = a.grazing ? (dog ? 1.5 : 3) + Math.random() * (dog ? 2 : 5) : 4 + Math.random() * (dog ? 6 : 10);
    }
    const down = a.grazing && a.speed < 0.15 && (dp > 4 || a.state !== 'follow') ? (dog ? 0.9 : 1.0) : 0;
    a.down = damp(a.down ?? 0, down, 2.2, dt);
    // walking: the head nods twice a stride (a cow's heavily), the back sways a little with the legs
    const w = clamp(a.speed / 0.25, 0, 1);
    const phase = (a.walk.time / a.walk.getClip().duration) * Math.PI * 2;
    const nod = Math.sin(phase * 2) * (dog ? 0.04 : 0.075) * w;
    _v.set(Math.cos(a.yaw), 0, -Math.sin(a.yaw)); // its right: a turn about it lowers the head
    // (spread down the neck as a neck bends: the withers a little, the head most of the tilt)
    for (const [b, w] of a.pitchBones) rotateWorld(b, _v, (a.down + nod * 2) * w);
    for (const b of a.spine) rotateWorld(b, UP, Math.sin(phase) * 0.035 * w);
  }
}
