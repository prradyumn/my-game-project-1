import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, wrapAngle } from '../utils/math.js';
import { PROFILE_LEN, frameAtX, frameToWorld } from '../world/WorldLayout.js';
import { makeWaterAware } from '../world/materials.js';
import { PlayerBoat } from './Boats.js';

// Nauka Daud: the boat race on the Ganga. The boatmen of Dashashwamedh race downstream to
// Panchganga through seven gates of bamboo poles hung with marigolds. Prady rows his own boat
// against three of them. Holding W rows; pressing Space on the catch (the instant one stroke
// ends and the next begins, the ring at the bottom of the screen) makes that stroke a power
// stroke, and a run of them builds josh. A gate missed costs three seconds. The start banner
// stands in the water before Dashashwamedh all day; row up to it to race.
//
// Rival boats are PlayerBoats steered by a simple helmsman (aim at the next gate, one-oar
// strokes to turn), with their own oars (Oars.js) and a boatman standing at them (a crowd actor
// riding the boat). They stay in touch with Prady (a gentle rubber band) so the timing decides it.

const COURSE = {
  start: 40, // bank x of the start line (off Dashashwamedh)
  lanes: [19, 30, 41, 52], // metres out from the waterline; Prady rows lane 1 (room for the oars)
  gates: [
    [86, 31],
    [130, 47],
    [174, 29],
    [218, 49],
    [258, 32],
    [298, 47],
    [338, 35],
  ],
  finish: [376, 36], // Panchganga
  half: 6.5, // a gate is 13 m wide
};
const RIVALS = [
  { name: 'Bhola', avatarId: 'Male_Adult_06', skill: 1.0, lane: 0, tint: 0xa9dcff, offset: -3 },
  { name: 'Raju', avatarId: 'Male_Adult_09', skill: 1.05, lane: 2, tint: 0xffcf96, offset: 2.5 },
  { name: 'Shambhu Kaka', avatarId: 'Male_Adult_14', skill: 0.96, lane: 3, tint: 0xcdeec0, offset: 0 },
];
const POWER = 1.42; // a stroke caught on the beat
const JOSH = 1.55; // ...four in a row
const CYCLE = 1.1; // PlayerBoat's stroke cycle
const RIDE = { x: 0, y: 0.12, z: -1.6 }; // where a boatman stands (as Prady does)

const at = (bx, out) => {
  const f = frameAtX(bx);
  const p = frameToWorld(f, 0, PROFILE_LEN + out);
  return { x: p.x, z: p.z, T: f.T, N: f.N };
};
const fmt = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

// ---------------------------------------------------------------- the props
function colored(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

/** Two bamboo poles across the course (along N), flags on top, a marigold garland between. */
function gateGeometry(c, half, { tall = 6.4, flags = true } = {}) {
  const parts = [];
  const ends = [-1, 1].map((s) => ({ x: c.x + c.N.x * half * s, z: c.z + c.N.z * half * s }));
  for (const [i, e] of ends.entries()) {
    const pole = new THREE.CylinderGeometry(0.07, 0.1, tall + 1.6, 7);
    pole.translate(e.x, (tall - 1.6) / 2, e.z);
    parts.push(colored(pole, 0xb99a62));
    for (let k = 0; k < 4; k++) {
      // bamboo nodes
      const ring = new THREE.CylinderGeometry(0.105, 0.105, 0.06, 7);
      ring.translate(e.x, 0.6 + k * 0.95, e.z);
      parts.push(colored(ring, 0x8a6f3e));
    }
    // a float at the foot, striped red and white
    for (let k = 0; k < 3; k++) {
      const f = new THREE.CylinderGeometry(0.34, 0.34, 0.16, 12);
      f.translate(e.x, -0.05 + k * 0.16, e.z);
      parts.push(colored(f, k % 2 ? 0xf3ecdf : 0xc4291c));
    }
    if (flags) {
      // a saffron pennant streaming downstream (+T)
      const fl = new THREE.BufferGeometry();
      const y = tall + 0.05;
      const p0 = [e.x, y, e.z];
      const p1 = [e.x, y - 0.55, e.z];
      const p2 = [e.x + c.T.x * 1.1, y - 0.2, e.z + c.T.z * 1.1];
      fl.setAttribute('position', new THREE.Float32BufferAttribute([...p0, ...p1, ...p2, ...p0, ...p2, ...p1], 3));
      fl.computeVertexNormals();
      parts.push(colored(fl, i ? 0xff8a1e : 0xffb02e));
    }
  }
  // the garland: marigolds strung pole to pole, sagging in the middle
  const n = Math.round((half * 2) / 0.2);
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const x = ends[0].x + (ends[1].x - ends[0].x) * t;
    const z = ends[0].z + (ends[1].z - ends[0].z) * t;
    const y = tall - 0.25 - Math.sin(Math.PI * t) * 1.1;
    const m = new THREE.IcosahedronGeometry(k % 3 === 0 ? 0.1 : 0.085, 0);
    m.translate(x, y, z);
    parts.push(colored(m, k % 2 ? 0xffb21a : 0xff7a10));
  }
  return mergeGeometries(parts);
}

function bannerTexture() {
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = 256;
  const ctx = cv.getContext('2d');
  for (const [row, deva, latin] of [
    [0, 'नौका दौड़', 'NAUKA DAUD · START'],
    [1, 'पंचगंगा', 'FINISH · PANCHGANGA'],
  ]) {
    const y0 = row * 128;
    const g = ctx.createLinearGradient(0, y0, 0, y0 + 128);
    g.addColorStop(0, '#e2551a');
    g.addColorStop(1, '#b8360f');
    ctx.fillStyle = g;
    ctx.fillRect(0, y0, 1024, 128);
    ctx.fillStyle = '#ffcf5a';
    ctx.fillRect(0, y0 + 6, 1024, 5);
    ctx.fillRect(0, y0 + 117, 1024, 5);
    ctx.fillStyle = '#fff4dc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold 62px "Noto Sans Devanagari", "Kohinoor Devanagari", "Devanagari Sangam MN", sans-serif`;
    ctx.fillText(deva, 300, y0 + 66);
    ctx.font = `600 34px Georgia, serif`;
    ctx.fillText(latin, 730, y0 + 66);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A banner hung between the tops of a gate's poles: row 0 = start, 1 = finish. */
function bannerGeometry(c, half, tall, row) {
  const w = half * 2 - 0.3;
  const g = new THREE.PlaneGeometry(w, w / 8);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - (row + (1 - uv.getY(i))) * 0.5);
  // facing the boats as they come down the river (its front toward -T)
  g.rotateY(Math.atan2(-c.T.x, -c.T.z));
  g.translate(c.x, tall - 0.55, c.z);
  return g;
}

export class BoatRace {
  constructor(game) {
    this.g = game;
    this.phase = 'idle'; // idle | count | race | done
    this.marks = [];
    this.music = 0;
    this.rivals = [];
    this.gates = COURSE.gates.map(([bx, out]) => ({ ...at(bx, out), half: COURSE.half }));
    const [fx, fo] = COURSE.finish;
    this.finish = { ...at(fx, fo), half: 40, banner: COURSE.half + 1 };
    this.startAt = at(COURSE.start, 34);
    // the bamboo poles are solid: hulls bounce off them
    this.poles = [];
    for (const c of [...this.gates, { ...this.finish, half: 7.5 }, { ...this.startAt, half: 7.5 }]) for (const s of [-1, 1]) this.poles.push({ x: c.x + c.N.x * c.half * s, z: c.z + c.N.z * c.half * s });
    // the props: the gates (shown for a race) and the start / finish banners (always there)
    const mat = makeWaterAware(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide }), { puddles: false });
    this.gateMesh = new THREE.Mesh(mergeGeometries(this.gates.map((c) => gateGeometry(c, c.half))), mat);
    this.gateMesh.visible = false;
    this.gateMesh.castShadow = true;
    const fin = { ...this.finish };
    const st = { ...this.startAt };
    this.lineMesh = new THREE.Mesh(mergeGeometries([gateGeometry(st, 7.5, { tall: 7.4, flags: true }), gateGeometry(fin, 7.5, { tall: 7.4, flags: true })]), mat);
    this.lineMesh.castShadow = true;
    const bannerMat = new THREE.MeshStandardMaterial({ map: bannerTexture(), roughness: 0.85, side: THREE.DoubleSide, emissive: 0x2a0d00 });
    this.bannerMesh = new THREE.Mesh(mergeGeometries([bannerGeometry(st, 7.5, 7.4, 0), bannerGeometry(fin, 7.5, 7.4, 1)]), bannerMat);
    for (const m of [this.gateMesh, this.lineMesh, this.bannerMesh]) game.scene.add(m);
    this.best = null;
    this.hulls = new THREE.InstancedMesh(game.boatGeo.geometry, (() => {
      const m = game.boatGeo.material.clone();
      makeWaterAware(m, { wetness: false, puddles: false });
      return m;
    })(), RIVALS.length);
    this.hulls.castShadow = true;
    this.hulls.receiveShadow = true;
    this.hulls.frustumCulled = false;
    this.hulls.count = 0;
    RIVALS.forEach((r, i) => this.hulls.setColorAt(i, new THREE.Color(r.tint)));
    game.scene.add(this.hulls);
  }

  get active() {
    return this.phase !== 'idle';
  }

  /** The boat's controls are held during the count. */
  get holdInput() {
    return this.phase === 'count';
  }

  // ---------------------------------------------------------------- starting
  interaction() {
    const g = this.g;
    if (this.active || g.player.state !== 'boat' || g.encounters.active || g.story?.cut) return null;
    const S = this.startAt;
    if (Math.hypot(g.boat.x - S.x, g.boat.z - S.z) > 18) return null;
    // a daylight race (at dusk the boats gather here for the aarti instead)
    const h = g.sky.hours;
    if (h < 6 || h > 17.5) return null;
    return { prompt: 'Race the boatmen to Panchganga (Nauka Daud)', action: () => this.begin() };
  }

  /** Fade, line up, count down. opts.fromGate: start further down the course (tests). */
  begin(opts = {}) {
    const g = this.g;
    if (this.phase === 'count' || this.phase === 'race') return;
    g.ui.fadeBlack(true);
    this.phase = 'count';
    this.t = -0.8;
    g.after(0.75, () => {
      this.setup(opts);
      g.ui.fadeBlack(false);
    });
  }

  setup({ fromGate = 0 } = {}) {
    const g = this.g;
    this.clearRivals();
    const bx = fromGate > 0 ? COURSE.gates[fromGate - 1][0] + 12 : COURSE.start - 6;
    const lane = (k) => at(bx, COURSE.lanes[k]);
    const yaw = (c) => Math.atan2(c.T.x, c.T.z);
    // Prady's boat in lane 1, bow downstream
    const b = g.boat;
    if (g.player.state !== 'boat') g.player.enterBoat(b);
    const p = lane(1);
    b.x = b.prev.x = p.x;
    b.z = b.prev.z = p.z;
    b.vx = b.vz = 0;
    b.yaw = b.prev.yaw = yaw(p);
    b.yawRate = 0;
    b.boost = 1;
    b.pendingBoost = 0;
    g.camRig.yaw = b.yaw;
    g.camRig.first = true;
    // the rivals
    for (const r of RIVALS) {
      const c = lane(r.lane);
      // (its hull is drawn by the shared instanced mesh: the boat's own mesh stays hidden)
      const boat = new PlayerBoat({ geometry: g.boatGeo.geometry, material: g.boatGeo.material }, { x: c.x, z: c.z, yaw: 0 });
      boat.object.children[0].visible = false;
      boat.yaw = boat.prev.yaw = yaw(c);
      boat.lateUpdate(1);
      g.scene.add(boat.object);
      g.oars.add(boat);
      const actor = g.crowd?.addActor({ avatarId: r.avatarId, x: c.x, y: 0.2, z: c.z, yaw: boat.yaw, clip: 'idle', name: r.name, ride: { boat, local: RIDE } });
      this.rivals.push({ ...r, boat, actor, next: fromGate, px: boat.x, pz: boat.z, done: null, band: 1 });
    }
    this.me = { name: 'Prady', you: true, boat: b, next: fromGate, px: b.x, pz: b.z, done: null };
    this.entrants = [this.me, ...this.rivals];
    this.gateMesh.visible = true;
    this.penalty = 0;
    this.streak = 0;
    this.time = 0;
    this.clock = 0;
    this.t = 0;
    this.counted = -1;
    this.flash = null;
    this.resulted = false;
    this.basePower = Math.max(1, b.power);
    g.ui.toast('Nauka Daud', 'Hold W to row · Space on the catch for a power stroke · through all seven gates', 4.5);
  }

  clearRivals() {
    const g = this.g;
    for (const r of this.rivals) {
      g.oars.remove(r.boat);
      g.scene.remove(r.boat.object);
      if (r.actor) g.crowd?.removeActor(r.actor);
    }
    this.rivals = [];
    this.hulls.count = 0;
  }

  /** Off the course (a test jump, the player left his boat): everyone goes home. */
  stop(note) {
    if (!this.active) return;
    const g = this.g;
    if (note) g.ui.toast('Race abandoned', note, 3);
    this.phase = 'idle';
    this.clearRivals();
    this.gateMesh.visible = false;
    this.marks = [];
    g.ui.setRace(null);
    g.ui.setStroke(null);
    g.ui.countdown('');
  }

  // ---------------------------------------------------------------- the player's timing
  /** Space during the race: was it on the catch? */
  catchStroke() {
    if (this.phase !== 'race' || this.me.done) return;
    const g = this.g;
    const b = g.boat;
    const st = b.strokeTimer;
    if (st <= 0) {
      this.flash = 'miss';
      g.ui.toast('', 'Hold W to row, then Space as each stroke begins', 2);
      return;
    }
    const late = st > CYCLE - 0.13; // just after the catch: this stroke
    const early = st < 0.2; // just before it: the next one
    if (!late && !early) {
      this.streak = 0;
      this.flash = 'miss';
      return;
    }
    this.streak++;
    const k = this.streak >= 4 ? JOSH : POWER;
    if (late) b.boost = k;
    else b.pendingBoost = k;
    this.flash = 'good';
    g.audio.play('thump', { volume: 0.75, rate: 0.62 + Math.min(4, this.streak) * 0.03 });
    const f = b.forward;
    g.fx.ripple?.(b.x - f.x * 3.2, 0, b.z - f.z * 3.2, 2.6);
    if (this.streak === 4) g.ui.toast('Josh!', 'Four strokes on the beat: the boat flies', 1.8);
  }

  // ---------------------------------------------------------------- simulation (fixed 60 Hz)
  fixed(dt) {
    if (!this.rivals.length) return;
    const g = this.g;
    for (const r of this.rivals) {
      const b = r.boat;
      const racing = this.phase === 'race' && !r.done;
      if (racing) {
        const tgt = this.aim(r);
        // give the boats alongside room for their oars: drift away from any within ~9 m
        const G = r.next < this.gates.length ? this.gates[r.next] : this.finish;
        let side = 0;
        for (const o of [g.boat, ...this.rivals.map((q) => q.boat)]) {
          if (o === b) continue;
          const dx = b.x - o.x;
          const dz = b.z - o.z;
          const d = Math.hypot(dx, dz);
          if (d > 9.5 || d < 1e-3) continue;
          side += Math.sign(dx * G.N.x + dz * G.N.z || 1) * (9.5 - d) * 0.55;
        }
        // (but never toward a pole: the line stays well inside the gate)
        const lim = (G.half ?? 6.5) - 2.8;
        const base = clamp(r.offset, -lim, lim);
        side = clamp(base + clamp(side, -4, 4), -lim, lim) - base;
        tgt.x += G.N.x * side;
        tgt.z += G.N.z * side;
        const des = Math.atan2(tgt.x - b.x, tgt.z - b.z);
        const err = wrapAngle(des - b.yaw);
        b.input.thrust = 1;
        b.input.turn = clamp(err * 1.7, -1, 1);
        b.power = this.basePower * r.skill * r.band;
      } else {
        b.input.thrust = 0;
        b.input.turn = 0;
      }
      b.fixedUpdate(dt, g.water, g.fx);
    }
    this.collide();
  }

  late(alpha) {
    this.rivals.forEach((r, i) => {
      r.boat.lateUpdate(alpha);
      this.hulls.setMatrixAt(i, r.boat.object.matrixWorld);
    });
    if (this.rivals.length) {
      this.hulls.count = this.rivals.length;
      this.hulls.instanceMatrix.needsUpdate = true;
    }
  }

  /** Where a rival steers: its line through the next gate, then on to the finish. */
  aim(r) {
    const G = r.next < this.gates.length ? this.gates[r.next] : this.finish;
    const off = r.next < this.gates.length ? clamp(r.offset, -G.half + 2.8, G.half - 2.8) : r.offset * 2;
    // aim a little beyond the gate's line, so the boat goes through it rather than at a pole
    return { x: G.x + G.N.x * off + G.T.x * 6, z: G.z + G.N.z * off + G.T.z * 6 };
  }

  /** Hulls don't pass through each other or the gate poles: each is three circles on its keel. */
  collide() {
    const boats = [this.g.boat, ...this.rivals.map((r) => r.boat)];
    const pts = (b) => {
      const f = { x: Math.sin(b.yaw), z: Math.cos(b.yaw) };
      return [-2.4, 0, 2.4].map((k) => ({ x: b.x + f.x * k, z: b.z + f.z * k }));
    };
    // (the hull tapers: beamy amidships, narrow at bow and stern, so a boat pivoting by a pole
    // swings its ends past it instead of jamming)
    const R = [0.7, 1.45, 0.7];
    for (const b of boats) {
      for (const P of this.poles) {
        if (Math.abs(P.x - b.x) > 5 || Math.abs(P.z - b.z) > 5) continue;
        for (const [i, q] of pts(b).entries()) {
          const dx = q.x - P.x;
          const dz = q.z - P.z;
          const d = Math.hypot(dx, dz);
          if (d >= R[i] || d < 1e-4) continue;
          const nx = dx / d;
          const nz = dz / d;
          b.x += nx * (R[i] - d);
          b.z += nz * (R[i] - d);
          const vn = b.vx * nx + b.vz * nz;
          if (vn < 0) {
            b.vx -= vn * nx * 1.3;
            b.vz -= vn * nz * 1.3;
          }
        }
      }
    }
    for (let i = 0; i < boats.length; i++) {
      for (let j = i + 1; j < boats.length; j++) {
        const A = boats[i];
        const B = boats[j];
        if (Math.abs(A.x - B.x) > 9 || Math.abs(A.z - B.z) > 9) continue;
        let px = 0;
        let pz = 0;
        let hit = 0;
        for (const a of pts(A)) {
          for (const b of pts(B)) {
            const dx = a.x - b.x;
            const dz = a.z - b.z;
            const d = Math.hypot(dx, dz);
            if (d < 2.6 && d > 1e-4) {
              px += (dx / d) * (2.6 - d);
              pz += (dz / d) * (2.6 - d);
              hit++;
            }
          }
        }
        if (!hit) continue;
        px /= hit;
        pz /= hit;
        const l = Math.hypot(px, pz) || 1;
        A.x += px * 0.5;
        A.z += pz * 0.5;
        B.x -= px * 0.5;
        B.z -= pz * 0.5;
        // take out the closing speed along the contact
        const nx = px / l;
        const nz = pz / l;
        const rv = (A.vx - B.vx) * nx + (A.vz - B.vz) * nz;
        if (rv < 0) {
          A.vx -= rv * nx * 0.6;
          A.vz -= rv * nz * 0.6;
          B.vx += rv * nx * 0.6;
          B.vz += rv * nz * 0.6;
        }
      }
    }
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    const g = this.g;
    this.music += ((this.phase === 'race' ? 1 : 0) - this.music) * Math.min(1, dt * (this.phase === 'race' ? 1.2 : 0.3));
    if (this.phase === 'idle') {
      // the start banner's beacon in the day, when he's out in his boat
      this.marks = [];
      return;
    }
    if (!this.me) return;
    this.t += dt;
    if (this.phase === 'count') {
      const n = Math.floor(this.t - 1.4);
      if (n > this.counted && n >= 0) {
        this.counted = n;
        if (n < 3) {
          g.ui.countdown(String(3 - n));
          g.audio.play('thump', { volume: 0.9, rate: 0.55 });
        } else {
          g.ui.countdown('Chalo!');
          g.audio.play('conch', { volume: 0.8 });
          this.phase = 'race';
          this.time = 0;
        }
      }
    }
    if (g.player.state !== 'boat' && this.phase !== 'done') return this.stop('You left your boat.');
    if (this.phase === 'race' && !this.me.done) this.time += dt;
    if (this.phase === 'race' || this.phase === 'done') this.clock += dt;
    // gates, finishes
    for (const e of this.entrants) this.track(e);
    // the rubber band: close enough that the timing decides it
    const myP = this.progress(this.me);
    for (const r of this.rivals) {
      const gap = this.progress(r) - myP;
      const want = this.me.done ? 1 : gap > 25 ? 0.92 : gap < -25 ? 1.08 : 1 - gap * 0.002;
      r.band += (want - r.band) * Math.min(1, dt * 0.5);
    }
    // the next gate, for the marker and the compass
    const G = this.me.next < this.gates.length ? this.gates[this.me.next] : this.finish;
    this.marks = this.me.done ? [] : [{ kind: 'objective', pos: { x: G.x, y: 0.5, z: G.z }, compass: true }];
    this.hud();
    if (this.phase === 'done') {
      this.doneT += dt;
      if (!this.resulted && this.clock >= this.resultAt) this.results();
      const P = g.player.position;
      if (this.doneT > 40 || (this.doneT > 8 && Math.hypot(P.x - this.finish.x, P.z - this.finish.z) > 90)) this.stop();
    }
  }

  progress(e) {
    const G = e.next < this.gates.length ? this.gates[e.next] : this.finish;
    if (e.done) return 1e6 - e.done;
    return e.next * 1000 - Math.hypot(e.boat.x - G.x, e.boat.z - G.z);
  }

  track(e) {
    const b = e.boat;
    if (e.done) return;
    const last = e.next >= this.gates.length;
    const G = last ? this.finish : this.gates[e.next];
    const s0 = (e.px - G.x) * G.T.x + (e.pz - G.z) * G.T.z;
    const s1 = (b.x - G.x) * G.T.x + (b.z - G.z) * G.T.z;
    if (s0 < 0 && s1 >= 0) {
      const a = s0 / (s0 - s1);
      const cx = e.px + (b.x - e.px) * a;
      const cz = e.pz + (b.z - e.pz) * a;
      const off = Math.abs((cx - G.x) * G.N.x + (cz - G.z) * G.N.z);
      if (off < 70) {
        if (last) this.finished(e);
        else {
          const through = off <= G.half + 0.6;
          if (e.you) this.gatePassed(through);
          e.next++;
        }
      }
    }
    e.px = b.x;
    e.pz = b.z;
  }

  gatePassed(through) {
    const g = this.g;
    if (through) {
      g.audio.play('bell', { volume: 0.35, rate: 1.5 });
      return;
    }
    this.penalty += 3;
    g.ui.toast(`Missed gate ${this.me.next + 1}`, '+3 seconds on your time', 2.2);
  }

  finished(e) {
    const g = this.g;
    e.done = e.you ? this.time + this.penalty : this.clock + Math.random() * 0.01;
    if (!e.you) return;
    // Prady over the line; his result once any penalty seconds have run (a boat finishing
    // inside them beats him)
    this.phase = 'done';
    this.doneT = 0;
    this.resultAt = this.clock + this.penalty;
    g.ui.setStroke(null);
  }

  results() {
    const g = this.g;
    const e = this.me;
    this.resulted = true;
    const place = 1 + this.rivals.filter((r) => r.done && r.done < e.done).length;
    const total = e.done;
    const best = this.best === null || total < this.best;
    if (best) this.best = total;
    const punya = [0, 11, 5, 3, 2][place];
    const m = g.missions;
    if (m) {
      m.punya += punya;
      g.ui.setPunya(m.punya);
    }
    g.audio.play(place === 1 ? 'conch' : 'bell', { volume: 0.8 });
    g.ui.countdown(place === 1 ? 'Pratham!' : `${place}${['', 'st', 'nd', 'rd', 'th'][place]}`);
    const head = place === 1 ? 'You won the Nauka Daud!' : place === 2 ? 'Second, by a boat’s length' : `You came ${['', 'first', 'second', 'third', 'fourth'][place]}`;
    g.ui.toast(head, `${fmt(total)}${this.penalty ? ` (with ${this.penalty} s for missed gates)` : ''}${best ? ' · your best' : ` · best ${fmt(this.best)}`} · +${punya} punya`, 6);
    g.ui.setStroke(null);
    g.crowd?.greet?.(g.player.position);
    g.save?.();
  }

  hud() {
    const g = this.g;
    if (this.phase === 'count' && !this.entrants) return;
    const order = [...this.entrants].sort((a, b) => this.progress(b) - this.progress(a));
    const pos = order.indexOf(this.me) + 1;
    const gate = this.me.next < this.gates.length ? `Gate ${this.me.next + 1} of ${this.gates.length}` : 'On to the finish at Panchganga';
    g.ui.setRace({ pos, of: this.entrants.length, time: fmt(this.me.done ?? this.time + this.penalty), gate: this.me.done ? 'Finished' : gate, board: order.map((e) => ({ name: e.name, you: !!e.you, done: !!e.done })) });
    if (this.phase === 'race' && !this.me.done) {
      const b = g.boat;
      const k = b.strokeTimer > 0 ? 1 - b.strokeTimer / CYCLE : 0;
      g.ui.setStroke({ k, win: 0.3 / CYCLE, streak: this.streak, flash: this.flash });
      this.flash = null;
    } else g.ui.setStroke(null);
  }

  serialize() {
    return this.best;
  }

  restore(best) {
    this.best = typeof best === 'number' ? best : null;
  }
}
