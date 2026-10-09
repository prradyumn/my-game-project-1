import * as THREE from 'three';
import { clamp } from '../utils/math.js';
import { MOVES } from './Combat.js';
import { GROUPS } from '../core/Physics.js';

// Finishers: an Asura reeling (staggered, or held by the trishul) and nearly spent can be ended
// with one press of E. The camera cuts to the side of the two of them, the pack holds back, and
// Prady plays a short choreography of his own motion-captured strikes that cannot miss; the last
// blow comes in slow motion and throws the body (a ragdoll) down the steps. Andhaka, brought low,
// gets a final blow of his own. With the Final Mercy siddhi the window opens at half health and
// every finisher gives prana back.
//
//   sword:  thrust through the chest -> the overhead cut          (a giant: the same, slower)
//           or the rising slash -> the second slash -> the thrust
//   fists:  the one-two -> the front kick that throws it back
//           or the body shot -> the roundhouse

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _m = new THREE.Vector3();

const SEQ = {
  sword: [
    [{ name: 'thrust', ts: 1.0 }, { name: 'heavyCut', ts: 1.05, last: true }],
    [{ name: 'slashA', ts: 1.2 }, { name: 'slashB', ts: 1.2 }, { name: 'thrust', ts: 1.0, last: true }],
  ],
  fists: [
    [{ name: 'oneTwo', ts: 1.15 }, { name: 'frontKick', ts: 1.0, last: true }],
    [{ name: 'bodyShot', ts: 1.1 }, { name: 'roundKick', ts: 1.0, last: true }],
  ],
  giant: [[{ name: 'thrust', ts: 0.95 }, { name: 'heavyCut', ts: 0.9, last: true }]],
};

export class Finishers {
  constructor(game) {
    this.g = game;
    this.active = null;
    this.target = null; // the one that can be finished now (for the prompt and its marker)
    this.n = 0;
    this.pick = 0;
  }

  /** The Asura that could be finished from here, or null. */
  candidate() {
    const g = this.g;
    const c = g.combat;
    if (this.active || !c || c.dead || c.react || c.roll || g.player.state !== 'ground' || !g.player.grounded || g.powers?.act) return null;
    const P = g.player.position;
    const thr = c.perks?.mercy ? 0.5 : 0.34;
    let best = null;
    let bd = Infinity;
    for (const a of g.asuras.list) {
      if (!a.alive || a.removed || a.airborne) continue;
      if (a.state !== 'stagger' && a.state !== 'pinned') continue;
      const f = a.hp / a.maxHp;
      const limit = a.K.boss ? 0.12 : a.mini ? 0.2 : thr;
      if (f > limit) continue;
      const d = Math.hypot(a.pos.x - P.x, a.pos.z - P.z) - a.radius;
      if (d > (a.K.boss ? 5 : 4) || Math.abs(a.pos.y - g.player.feetY) > (a.K.boss ? 3 : 1.6)) continue;
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  }

  /** The E prompt (Game.currentInteraction asks first, in a fight). */
  interaction() {
    const a = this.target;
    if (!a) return null;
    return { prompt: a.K.boss ? 'Strike the final blow' : a.mini ? `Finish ${a.name}` : 'Finish it', action: () => this.start(a), finisher: true };
  }

  start(a) {
    const g = this.g;
    const c = g.combat;
    if (this.active || !a.alive) return;
    const kind = a.K.boss || a.scale > 1.8 ? 'giant' : c.armed ? 'sword' : 'fists';
    const list = SEQ[kind];
    const seq = list[this.pick++ % list.length];
    this.active = { a, seq, i: 0, t: 0, kind, done: false, cam: { ang: 0, side: this.openSide(a) }, slow: false, relock: !!g.lockOn?.active };
    // everyone else steps back from it; nothing touches him while it plays
    c.invuln = true;
    if (c.blocking) c.setBlock(false, true);
    c.cancelMove();
    c.dash = null;
    g.asuras.holdAttacks(6);
    for (const o of g.asuras.list) if (o !== a && o.alive && o.state === 'attack' && !o.struck) o.stagger(0.3);
    a.hold(true);
    g.lockOn?.release?.();
    g.camRig.override = (dt, cam) => this.camera(dt, cam);
    g.ui.setCinematic?.(true);
    g.ui.setLetterbox?.(true);
    g.ui.setFinisherMark?.(null);
    g.audio.play('blade-draw', { volume: 0.6, rate: 0.7 });
    g.audio.play('slowmo-swell', { volume: 0.7 });
    g.slowMo(0.6, 0.35);
    this.next();
  }

  /** Which side of the two of them has room for the camera (+1 / -1): the one a ray goes further on. */
  openSide(a) {
    const g = this.g;
    const P = g.player.position;
    const dx = a.pos.x - P.x;
    const dz = a.pos.z - P.z;
    const l = Math.hypot(dx, dz) || 1;
    const big = a.K.boss ? 1 : 0;
    const from = { x: (P.x + a.pos.x) / 2, y: Math.max(P.y, a.pos.y) + 1.6 + big * 2.8, z: (P.z + a.pos.z) / 2 };
    const room = (s) => g.physics.sphereCast(from, { x: (-dz / l) * s, y: 0.12, z: (dx / l) * s }, 0.25, 12, g.player.collider, GROUPS.ignorePeople) ?? 12;
    const r1 = room(1);
    const r2 = room(-1);
    return Math.abs(r1 - r2) < 0.5 ? (Math.random() < 0.5 ? 1 : -1) : r1 > r2 ? 1 : -1;
  }

  /** The choreography begins: its first strike, each chaining to the next at its cancel point. */
  next() {
    const F = this.active;
    const mv = this.g.combat.forceMove(F.seq[0].name, F.a, this.optsFor(F.seq[0], F));
    if (!mv) this.finish();
  }

  optsFor(step, F) {
    const nxt = F.seq[F.seq.indexOf(step) + 1];
    const hits = MOVES[step.name]?.hits.length ?? 1;
    const o = {
      ts: step.ts,
      // the killing blow: the last hit of the last strike
      onHit: (hi, at, h) => this.blow(F, at, h, !!step.last && hi === hits - 1),
      onEnd: () => this.finish(),
    };
    if (nxt) {
      const self = this;
      o.chain = {
        name: nxt.name,
        get opts() {
          return self.optsFor(nxt, F);
        },
      };
    }
    return o;
  }

  /** A blow of the choreography lands. */
  blow(F, at, h, last) {
    const g = this.g;
    const a = F.a;
    if (!a.alive) return;
    const P = g.player.position;
    const dir = { x: a.pos.x - P.x, z: a.pos.z - P.z };
    const sword = g.combat.armed;
    if (last) {
      // the killing blow: slow motion, the camera pushes in, the body thrown
      a.hit({ k: 1.8, dir, at, sword, heavy: true, kick: !sword, finisher: true, push: a.K.boss ? 2.5 : 5.2 });
      g.slowMo(0.22, 0.75);
      F.slow = true;
      F.killT = F.t;
      g.camRig.shake(a.K.boss ? 0.7 : 0.4);
      g.haptics?.play('finisher');
      if (!g.settings.reduceFlashes) g.ui.flash();
      g.cinematics?.impact(1, at);
      g.audio.play('slowmo-boom', { volume: a.K.boss ? 1 : 0.85, rate: a.K.boss ? 0.85 : 1 });
      g.audio.play('blade-hit', { at, volume: 1, rate: 0.7 });
      g.asuras.particles.emitEmbers(at.x, at.y, at.z, 70, { x: dir.x * 0.4, z: dir.z * 0.4 }, 1.8);
      if (g.combat.perks?.mercy) g.health.heal(15);
      g.powers?.gain(12);
      this.n++;
      g.achievements?.event('finisher', { n: this.n, boss: !!a.K.boss, mini: a.mini });
    } else {
      a.hit({ k: 1.1, dir, at, sword, heavy: !!h?.k && h.k > 1.2, kick: false });
      // (a harder jolt than an ordinary blow's flinch)
      if (a.alive && a.flinch) a.flinch.vel *= 1.6;
      g.camRig.shake(0.12);
      g.haptics?.play('hit');
    }
  }

  finish() {
    const F = this.active;
    if (!F || F.done) return;
    F.done = true;
    const g = this.g;
    this.active = null;
    g.combat.invuln = false;
    g.health.grace = Math.max(g.health.grace, 0.8);
    if (F.a.alive && F.a.state === 'held') F.a.hold(false);
    g.asuras.holdAttacks(1.2);
    // back to the follow camera, looking the way the shot looked
    const cam = g.camera.position;
    const P = g.player.position;
    g.camRig.override = null;
    g.camRig.yaw = Math.atan2(P.x - cam.x, P.z - cam.z);
    g.camRig.first = true;
    // (eased out of the shot, never a cut back to the wide follow view)
    g.camRig.blendFrom(0.8);
    g.ui.setCinematic?.(false);
    g.ui.setLetterbox?.(false);
    this.endedAt = g.health.time;
    if (g.combat.armed) g.combat.stance(4);
    // locked on before it: on to the next one (the camera turns to it as the shot eases out)
    if (F.relock && g.lockOn && !g.lockOn.active) g.lockOn.acquire(F.a.alive ? null : F.a, 0, true);
  }

  /** The shot: low beside the two of them, turning slowly; it pushes in for the last blow. */
  camera(dt, cam) {
    const F = this.active;
    const g = this.g;
    if (!F) return;
    const a = F.a;
    const P = g.character.position;
    const big = a.K.boss ? 1 : 0;
    _m.set((P.x + a.pos.x) / 2, 0, (P.z + a.pos.z) / 2);
    _m.y = Math.max(P.y, a.pos.y) + 1.15 + big * 2.2;
    const dx = a.pos.x - P.x;
    const dz = a.pos.z - P.z;
    const l = Math.hypot(dx, dz) || 1;
    F.cam.ang += dt * 0.32;
    const push = F.slow ? clamp((F.t - F.killT) / 0.6, 0, 1) : 0;
    const dist = (3.4 + big * 6.5) * (1 - push * 0.22);
    const s = F.cam.side;
    // square across the line between them, a little behind Prady, turning slowly round them
    let cx = (-dz / l) * s - (dx / l) * 0.45;
    let cz = (dx / l) * s - (dz / l) * 0.45;
    const r = F.cam.ang * s * 0.6;
    [cx, cz] = [cx * Math.cos(r) - cz * Math.sin(r), cx * Math.sin(r) + cz * Math.cos(r)];
    const cl = Math.hypot(cx, cz) || 1;
    _v.set(_m.x + (cx / cl) * dist, _m.y + 0.45 + big * 2.0 - push * 0.2, _m.z + (cz / cl) * dist);
    // (never through a wall: pull in like the follow camera does; the bodies don't count)
    const dir = _w.copy(_v).sub(_m);
    const len = dir.length();
    dir.normalize();
    const hit = g.physics.sphereCast(_m, dir, 0.2, len, g.player.collider, GROUPS.ignorePeople);
    if (hit !== null) _v.copy(_m).addScaledVector(dir, Math.max(1.6, hit - 0.1));
    if (!F.camInit) {
      F.camInit = true;
      cam.position.copy(_v);
    } else cam.position.lerp(_v, Math.min(1, dt * 7));
    cam.lookAt(_m.x, _m.y - 0.1, _m.z);
  }

  update(dt) {
    const g = this.g;
    const F = this.active;
    if (F) {
      F.t += dt;
      // (a failsafe: whatever happens, it ends)
      if (F.t > 6 || (!F.a.alive && F.slow && F.t - F.killT > 1.3)) this.finish();
      return;
    }
    this.target = g.state === 'play' ? this.candidate() : null;
    // the mark over the one that can be finished
    if (this.target) {
      const a = this.target;
      _v.set(a.pos.x, a.pos.y + a.height + 0.45, a.pos.z).project(g.camera);
      g.ui.setFinisherMark?.(_v.z < 1 ? { x: (_v.x * 0.5 + 0.5) * innerWidth, y: (-_v.y * 0.5 + 0.5) * innerHeight, key: g.ui.padMode ? 'X' : g.ui.keys?.interact || 'E' } : null);
    } else g.ui.setFinisherMark?.(null);
  }

  reset() {
    if (this.active) this.finish();
    this.target = null;
    this.g.ui.setFinisherMark?.(null);
  }
}
