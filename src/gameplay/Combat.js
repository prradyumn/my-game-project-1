import * as THREE from 'three';
import { GROUPS } from '../core/Physics.js';
import { dampAngle } from '../utils/math.js';
import { groundHeight } from '../world/WorldLayout.js';
import { BladeTrail, makeTalwar } from './Talwar.js';

// Prady fights: bare hands, or the talwar from Tulsi Akhara.
//   LMB  a three-strike combo   unarmed: one-two -> body shot -> front kick
//                               sword:   rising slash -> second slash -> lunging thrust
//   RMB  a heavy blow           unarmed: roundhouse kick   sword: two-handed overhead cut
//   Q    (hold) block / parry   R  draw or sheathe the talwar
// Every move is motion capture (CMU: a boxer, a karate practitioner, swordplay, a woodcutter's
// chop; see tools/retarget.js). Strikes carry their own root motion, applied through the
// character controller so a lunge plants its feet. Hits land on whatever can be struck (the
// akhara's dummies), with a moment of hit-stop, straw and a thump.

const MOVES = {
  oneTwo: { hits: [{ t: 0.4, limb: 'LeftHand', k: 0.6 }, { t: 0.57, limb: 'RightHand', k: 0.8 }], cancel: 0.82, ts: 1.15 },
  bodyShot: { hits: [{ t: 0.48, limb: 'RightHand', k: 0.9 }], cancel: 0.78, ts: 1.1 },
  frontKick: { hits: [{ t: 0.65, limb: 'RightFoot', k: 1.1 }], cancel: 1.02, ts: 1.05, kick: true },
  roundKick: { hits: [{ t: 0.68, limb: 'RightFoot', k: 1.3 }], cancel: 1.1, ts: 1.1, kick: true },
  slashA: { hits: [{ t: 0.57, blade: true, k: 1.0 }], cancel: 0.86, ts: 1.15, sword: true },
  slashB: { hits: [{ t: 0.6, blade: true, k: 1.0 }], cancel: 0.88, ts: 1.15, sword: true },
  thrust: { hits: [{ t: 0.67, blade: true, k: 1.1 }], cancel: 1.0, ts: 1.1, sword: true, wrist: 1.45 }, // a punch turned into a thrust: the blade down the line of the arm
  heavyCut: { hits: [{ t: 0.72, blade: true, k: 1.6 }], cancel: 1.1, ts: 1.0, sword: true, heavy: true },
};
const COMBO = { armed: ['slashA', 'slashB', 'thrust'], unarmed: ['oneTwo', 'bodyShot', 'frontKick'] };
const HEAVY = { armed: 'heavyCut', unarmed: 'roundKick' };
const LEG = 0.88; // Prady's hip height above the foot (m): root motion is baked in these units
const WINDOW = 0.085; // a strike connects within this much clip time of its peak

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _base = new THREE.Vector3();
const _tip = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const _hq = new THREE.Quaternion();
const _bq = new THREE.Quaternion();
const _hangQ = new THREE.Quaternion();
const _f = new THREE.Vector3();
const _t = new THREE.Vector3();
const _e3 = new THREE.Vector3();
const _x3 = new THREE.Vector3();
const _m4 = new THREE.Matrix4();

// turn a bone about a world axis (keeping its parent)
const _pq = new THREE.Quaternion();
const _rq = new THREE.Quaternion();
function rotateWorld(bone, axis, angle) {
  bone.parent.getWorldQuaternion(_pq);
  const wq = bone.getWorldQuaternion(new THREE.Quaternion());
  wq.premultiply(_rq.setFromAxisAngle(axis, angle));
  bone.quaternion.copy(_pq.invert().multiply(wq));
  bone.updateWorldMatrix(false, true);
}

export class Combat {
  constructor({ player, animator, scene, audio, camRig, rootMotion, akhara, onEvent }) {
    this.p = player;
    this.anim = animator;
    this.audio = audio;
    this.cam = camRig;
    this.akhara = akhara;
    this.rootMotion = rootMotion || {};
    this.onEvent = onEvent || (() => {});
    this.hasSword = false;
    this.armed = false;
    this.move = null; // { name, t, start, yaw, i, queued, struck:Set }
    this.combo = 0;
    this.lastEnd = -10;
    this.time = 0;
    this.stanceUntil = 0;
    this.blocking = false;
    this.hitStop = 0;
    const t = makeTalwar();
    this.sword = t.sword;
    this.scabbard = t.scabbard;
    this.bladeLen = t.length;
    this.sword.visible = this.scabbard.visible = false;
    scene.add(this.sword, this.scabbard);
    this.trail = new BladeTrail();
    scene.add(this.trail.mesh);
    // where the scabbard hangs, in the body frame (Prady faces +Z, his left is +X)
    this.hang = { pos: new THREE.Vector3(0.16, -0.06, 0.05), rot: new THREE.Euler(-2.78, 0.2, 0.1) };
    this.hipRef = null; // the hips' own turn in a relaxed stance (so the scabbard rides the hips)
    this.wristTilt = 0.55;
    this.bones = null;
  }

  get busy() {
    return !!this.move || this.blocking;
  }

  canFight() {
    const p = this.p;
    return p.state === 'ground' && p.grounded && !p.inputLocked && !p.actions?.act;
  }

  setHasSword(on) {
    this.hasSword = on;
    if (!on) this.armed = false;
  }

  toggleSword() {
    if (!this.hasSword) {
      this.onEvent('noSword', {});
      return;
    }
    if (this.move || this.p.state !== 'ground') return;
    this.armed = !this.armed;
    this.audio.play(this.armed ? 'blade-draw' : 'blade-sheathe', { volume: 0.7 });
    this.onEvent(this.armed ? 'draw' : 'sheathe', {});
    if (this.armed) this.stance(6);
  }

  attack() {
    if (this.move) {
      // a press during the move queues the next strike of the combo
      if (this.move.t > 0.3 && !MOVES[this.move.name].heavy && this.move.name !== HEAVY.unarmed) this.move.queued = true;
      return;
    }
    if (!this.canFight() || this.blocking) return;
    if (this.time - this.lastEnd > 0.7) this.combo = 0;
    this.start(COMBO[this.armed ? 'armed' : 'unarmed'][this.combo % 3]);
  }

  heavy() {
    if (this.move) {
      if (this.move.t > MOVES[this.move.name].cancel / MOVES[this.move.name].ts) this.move.queuedHeavy = true;
      return;
    }
    if (!this.canFight() || this.blocking) return;
    this.start(HEAVY[this.armed ? 'armed' : 'unarmed']);
  }

  setBlock(on) {
    if (on && !this.blocking && !this.move && this.canFight()) {
      this.blocking = true;
      this.anim.play('parry', { clamp: true, cancelOnMove: false, fadeIn: 0.1, fadeOut: 0.2, noLook: true });
      this.blockTime = 0;
      this.onEvent('block', {});
    } else if (!on && this.blocking) {
      this.blocking = false;
      this.anim.stop(0.2);
      this.stance(3);
    }
  }

  // Where the blow lands in the move's own frame (Prady at the origin facing +Z), in metres:
  // the root's travel up to the strike plus the limb's reach from the hips at that moment.
  landing(name) {
    const m = MOVES[name];
    const rm = this.rootMotion[name];
    if (!rm || rm.strikeYaw === undefined) return { x: 0, z: 0.6 * LEG };
    const f = Math.min(rm.path.length / 2 - 1, Math.round(m.hits[m.hits.length - 1].t * rm.fps));
    const rx = (rm.path[f * 2] - rm.path[0]) * LEG;
    const rz = (rm.path[f * 2 + 1] - rm.path[1]) * LEG;
    return { x: rx + Math.sin(rm.strikeYaw) * rm.reach * LEG, z: rz + Math.cos(rm.strikeYaw) * rm.reach * LEG };
  }

  start(name) {
    const m = MOVES[name];
    const p = this.p;
    // aim the blow itself (not the hips: fighting stances stand side-on) at a dummy in front
    // within reach, else along the camera; close or open the distance during the wind-up
    const L = this.landing(name);
    const la = Math.atan2(L.x, L.z);
    const camYaw = Math.atan2(this.cam.forward.x, this.cam.forward.z);
    let yaw = camYaw - la;
    let approach = 0;
    const t = this.nearestTarget(3.9, camYaw);
    if (t) {
      const ty = Math.atan2(t.x - p.position.x, t.z - p.position.z);
      const d = Math.hypot(t.x - p.position.x, t.z - p.position.z);
      yaw = ty - la;
      // with the talwar the middle of the blade should meet the target, not the fist
      approach = Math.max(-0.45, Math.min(1.2, d - Math.hypot(L.x, L.z) - 0.08 - (m.sword ? 0.42 : 0)));
      this.aimAt = ty;
    }
    this.move = { name, t: 0, start: p.position.clone(), yaw, i: this.combo, queued: false, queuedHeavy: false, struck: new Set(), whoosh: false, approach, approachYaw: t ? Math.atan2(t.x - p.position.x, t.z - p.position.z) : yaw };
    // (the facing turns over the wind-up in fixed(): snapping it popped the whole body)
    const chained = this.time - this.lastEnd < 0.05 || !!this.anim.cur;
    this.anim.play(name, { fadeIn: m.kick || m.heavy ? 0.2 : chained ? 0.16 : 0.18, fadeOut: 0.2, cancelOnMove: false, noLook: true, noFootIK: !!m.kick, timeScale: m.ts });
    this.onEvent('swing', { move: name });
  }

  nearestTarget(range, yaw) {
    if (!this.akhara) return null;
    const p = this.p.position;
    let best = null;
    let bd = range;
    for (const d of this.akhara.dummies) {
      const dx = d.x - p.x;
      const dz = d.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist > bd || Math.abs(d.y - this.p.feetY) > 1.2) continue;
      const da = Math.abs(((Math.atan2(dx, dz) - yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (da > 1.9) continue;
      best = d;
      bd = dist;
    }
    return best;
  }

  stance(seconds) {
    this.stanceUntil = this.time + seconds;
    this.anim.play(this.armed ? 'swordStance' : 'guard', { loop: true, fadeIn: 0.25, fadeOut: 0.25, cancelOnMove: true, noLook: true });
  }

  // ------------------------------------------------------------ fixed 60 Hz (instead of the player)
  fixed(dt) {
    this.time += dt;
    const p = this.p;
    if (this.blocking) {
      if (!this.canFight() && p.state !== 'ground') this.setBlock(false);
      else return this.hold();
    }
    const mv = this.move;
    if (!mv) {
      // the stance drops when we've been idle a while
      if (this.stanceUntil && this.time > this.stanceUntil && !this.armed && this.anim.isPlaying('guard')) {
        this.stanceUntil = 0;
        this.anim.stop(0.4);
      }
      return false;
    }
    const m = MOVES[mv.name];
    const step = this.hitStop > 0 ? dt * 0.06 : dt;
    this.hitStop = Math.max(0, this.hitStop - dt);
    mv.t += step;
    const ct = mv.t * m.ts; // clip time
    p.yaw = dampAngle(p.yaw, mv.yaw, 11, dt);
    p.speed = 0;
    // root motion: follow the clip's hip path, turned to our facing, through the controller
    const rm = this.rootMotion[mv.name];
    p.prevPosition.copy(p.position);
    p.prevYaw = p.yaw;
    if (rm) {
      const f = Math.min(rm.path.length / 2 - 1, ct * rm.fps);
      const i = Math.floor(f);
      const a = f - i;
      const j = Math.min(rm.path.length / 2 - 1, i + 1);
      const x = (rm.path[i * 2] * (1 - a) + rm.path[j * 2] * a - rm.path[0]) * LEG;
      const z = (rm.path[i * 2 + 1] * (1 - a) + rm.path[j * 2 + 1] * a - rm.path[1]) * LEG;
      const c = Math.cos(mv.yaw);
      const s = Math.sin(mv.yaw);
      // the approach: eased in over the wind-up, along the line to the target
      const k = Math.min(1, ct / Math.max(0.2, m.hits[0].t));
      const ap = mv.approach * k * k * (3 - 2 * k);
      const wx = mv.start.x + x * c + z * s + Math.sin(mv.approachYaw) * ap;
      const wz = mv.start.z - x * s + z * c + Math.cos(mv.approachYaw) * ap;
      const dx = wx - p.position.x;
      const dz = wz - p.position.z;
      // never lunge off a step edge
      const drop = p.feetY - groundHeight(p.position.x + dx * 4, p.position.z + dz * 4);
      if (drop < 0.35 && (dx || dz)) {
        _v.set(dx, 0, dz);
        p.kcc.computeColliderMovement(p.collider, _v, undefined, GROUPS.mover);
        const d = p.kcc.computedMovement();
        p.position.x += d.x;
        p.position.y += d.y;
        p.position.z += d.z;
      }
    }
    p.body.setNextKinematicTranslation(p.position);
    p.velocity.set(0, 0, 0);
    // the swing's whoosh, just before the strike
    const peak = m.hits[0].t;
    if (!mv.whoosh && ct > peak - 0.16) {
      mv.whoosh = true;
      this.audio.play(m.sword ? 'blade-whoosh' : 'whoosh', { volume: m.heavy ? 0.9 : 0.55, rate: (m.heavy ? 0.8 : 1) * (0.92 + Math.random() * 0.16) });
    }
    // chain: the next strike of the combo (or the heavy) at the cancel point
    const dur = this.anim.clipActions[mv.name]?.getClip().duration ?? 1.2;
    if (ct >= m.cancel && (mv.queued || mv.queuedHeavy)) {
      const next = mv.queuedHeavy ? HEAVY[this.armed ? 'armed' : 'unarmed'] : COMBO[this.armed ? 'armed' : 'unarmed'][(mv.i + 1) % 3];
      this.combo = mv.queuedHeavy ? 0 : mv.i + 1;
      this.move = null;
      this.start(next);
      return true;
    }
    if (ct >= dur - 0.12) {
      this.move = null;
      this.lastEnd = this.time;
      this.combo = (mv.i + 1) % 3;
      if (m.heavy || mv.name === HEAVY.unarmed) this.combo = 0;
      this.stance(this.armed ? 8 : 3);
    }
    return true;
  }

  findBones() {
    if (this.bones) return;
    const root = this.anim.loco?.root || this.anim.root;
    const find = (n) => {
      let b = null;
      (root || this.p.mesh)?.traverse?.((o) => !b && o.isBone && o.name.endsWith(n) && (b = o));
      return b;
    };
    this.bones = {
      hips: find('Hips'),
      hand: find('RightHand'),
      fore: find('RightForeArm'),
      mid: find('RightHandMiddle1'),
      thumb: find('RightHandThumb1'),
      fingers: ['Index', 'Middle', 'Ring', 'Pinky'].map((n) => [1, 2, 3].map((k) => find(`RightHand${n}${k}`)).filter(Boolean)),
      index1: find('RightHandIndex1'),
      pinky1: find('RightHandPinky1'),
    };
  }

  // close the right hand round the grip (after the clip; the animator restores clean poses)
  fist(B) {
    if (!B.index1 || !B.pinky1) return;
    const axis = B.pinky1.getWorldPosition(_f).sub(B.index1.getWorldPosition(_t)).normalize();
    for (const chain of B.fingers) {
      for (const bone of chain) {
        if (this.curlSign === undefined) {
          // which way is "into the palm": the way that brings the fingertip toward the thumb
          const tip = chain[chain.length - 1];
          const th = B.thumb.getWorldPosition(new THREE.Vector3());
          const before = tip.getWorldPosition(new THREE.Vector3()).distanceTo(th);
          rotateWorld(bone, axis, 0.6);
          tip.updateWorldMatrix(true, false);
          const after = tip.getWorldPosition(new THREE.Vector3()).distanceTo(th);
          rotateWorld(bone, axis, -0.6);
          this.curlSign = after < before ? 1 : -1;
        }
        rotateWorld(bone, axis, this.curlSign * 1.15);
        bone.updateWorldMatrix(false, true);
      }
    }
  }

  hold() {
    const p = this.p;
    p.prevPosition.copy(p.position);
    p.prevYaw = p.yaw;
    p.body.setNextKinematicTranslation(p.position);
    p.velocity.set(0, 0, 0);
    p.speed = 0;
    return true;
  }

  // ------------------------------------------------------------ per rendered frame (after the pose)
  late(dt) {
    const p = this.p;
    // the talwar: in the fist when drawn, in the scabbard at the left hip when not
    const owned = this.hasSword;
    this.sword.visible = this.scabbard.visible = owned;
    this.anim.timeScale = this.hitStop > 0 ? 0.06 : 1;
    if (owned) {
      this.findBones();
      const B = this.bones;
      // the body frame from the hips (turns with a twisting strike), then the scabbard in it
      const hipsBone = B.hips;
      if (hipsBone) {
        hipsBone.updateWorldMatrix(true, false);
        hipsBone.matrixWorld.decompose(_v, _hq, _w);
        const yawQ = _q.setFromAxisAngle(UP, p.yaw);
        if (!this.hipRef && !this.move && !this.blocking) this.hipRef = _hq.clone().invert().multiply(yawQ); // hips -> body, relaxed
        const bodyQ = this.hipRef ? _bq.copy(_hq).multiply(this.hipRef) : yawQ;
        this.scabbard.position.copy(this.hang.pos).applyQuaternion(bodyQ).add(_v);
        this.scabbard.quaternion.copy(bodyQ).multiply(_hangQ.setFromEuler(this.hang.rot));
      }
      if (this.armed && B.hand && B.fore && B.thumb) {
        this.fist(B);
        // the grip from the arm itself: blade out of the thumb side of the fist, square to the
        // forearm; the wrist tilt then leans it along the forearm (all the way for a thrust)
        const h = B.hand.getWorldPosition(_v);
        const f = _f.subVectors(h, B.fore.getWorldPosition(_t)).normalize(); // the forearm's line
        const th = B.thumb.getWorldPosition(_t).sub(h);
        const up = th.addScaledVector(f, -th.dot(f)).normalize(); // perpendicular, thumb side
        const edge = _e3.copy(f);
        const side = _x3.crossVectors(up, edge).normalize();
        edge.crossVectors(side, up).normalize();
        _m4.makeBasis(side, up, edge);
        this.sword.quaternion.setFromRotationMatrix(_m4);
        // a relaxed wrist: the blade leans forward over the knuckles instead of standing straight up
        const want = this.move && MOVES[this.move.name].wrist ? MOVES[this.move.name].wrist : 0.55;
        this.wristTilt += (want - this.wristTilt) * Math.min(1, dt * 10);
        this.sword.quaternion.multiply(_hangQ.setFromAxisAngle(_x3.set(1, 0, 0), this.wristTilt));
        this.sword.position.copy(h).addScaledVector(f, 0.07).addScaledVector(up, -0.04);
      } else {
        this.sword.position.copy(this.scabbard.position);
        this.sword.quaternion.copy(this.scabbard.quaternion);
      }
      this.sword.updateMatrixWorld();
    }
    // strikes
    const mv = this.move;
    const m = mv && MOVES[mv.name];
    const live = !!(m && m.sword && this.armed);
    if (owned && this.armed) {
      _base.set(0, 0.12, 0).applyMatrix4(this.sword.matrixWorld);
      _tip.set(0, this.bladeLen, -0.11).applyMatrix4(this.sword.matrixWorld);
    }
    this.trail.update(dt, _base, _tip, live && mv.t * m.ts > m.hits[0].t - 0.22 && mv.t * m.ts < m.hits[0].t + 0.18);
    if (!m || !this.akhara) return;
    const ct = mv.t * m.ts;
    m.hits.forEach((h, hi) => {
      if (mv.struck.has(hi) || Math.abs(ct - h.t) > WINDOW) return;
      const pts = [];
      if (h.blade && this.armed) {
        for (const k of [0.1, 0.4, 0.7, 1.0]) pts.push(_w.lerpVectors(_base, _tip, k).clone());
      } else {
        const b = this.anim.boneWorld(h.limb, new THREE.Vector3());
        if (b) pts.push(b);
      }
      for (const pt of pts) {
        const d = this.akhara.touching(pt, h.blade ? 0.08 : 0.14);
        if (!d) continue;
        mv.struck.add(hi);
        const dir = { x: d.x - p.position.x, z: d.z - p.position.z };
        this.akhara.hit(d, dir.x, dir.z, h.k, pt);
        this.hitStop = h.k > 1.2 ? 0.09 : 0.055;
        this.audio.play(h.blade ? 'blade-hit' : 'thump', { volume: 0.5 + h.k * 0.3, rate: 0.9 + Math.random() * 0.2, at: pt });
        this.onEvent('hit', { move: mv.name, heavy: !!m.heavy || mv.name === HEAVY.unarmed, sword: !!h.blade, kick: !!m.kick, dummy: d.i });
        break;
      }
    });
  }
}

// ---------------------------------------------------------------- sounds (made in code)

const noiseBuf = (ctx, secs, fill) => {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * secs);
  const b = ctx.createBuffer(1, n, sr);
  fill(b.getChannelData(0), sr, n);
  return b;
};

/** A cloth-and-air swish: band-limited noise swept up then down. */
export function synthWhoosh(ctx) {
  return noiseBuf(ctx, 0.32, (d, sr, n) => {
    let lp = 0;
    let lp2 = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const env = Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 2;
      const k = 0.04 + 0.25 * Math.sin(Math.PI * t); // the "pitch" of the swish
      const w = Math.random() * 2 - 1;
      lp += (w - lp) * k;
      lp2 += (lp - lp2) * k;
      d[i] = (lp - lp2) * env * 2.4;
    }
  });
}

/** A blade cutting the air: thinner and brighter, with a faint ring. */
export function synthBladeWhoosh(ctx) {
  return noiseBuf(ctx, 0.3, (d, sr, n) => {
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const env = Math.sin(Math.PI * Math.min(1, t * 1.2)) ** 3;
      const w = Math.random() * 2 - 1;
      lp += (w - lp) * (0.25 + 0.5 * t);
      d[i] = ((w - lp) * 0.9 + Math.sin((i / sr) * 2 * Math.PI * (1800 + 900 * t)) * 0.05) * env;
    }
  });
}

/** A fist or foot into a straw dummy: a dull thump with a crunch of straw. */
export function synthThump(ctx) {
  return noiseBuf(ctx, 0.35, (d, sr, n) => {
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const body = Math.sin(2 * Math.PI * (95 - 40 * t) * t) * Math.exp(-t * 22);
      const w = Math.random() * 2 - 1;
      lp += (w - lp) * 0.35;
      d[i] = body * 0.9 + lp * Math.exp(-t * 30) * 0.7;
    }
  });
}

/** The talwar biting into straw and wood. */
export function synthBladeHit(ctx) {
  return noiseBuf(ctx, 0.4, (d, sr, n) => {
    let hp = 0;
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const w = Math.random() * 2 - 1;
      hp = 0.85 * (hp + w - prev);
      prev = w;
      const ring = (Math.sin(2 * Math.PI * 2350 * t) + 0.6 * Math.sin(2 * Math.PI * 3720 * t)) * Math.exp(-t * 14) * 0.12;
      d[i] = hp * Math.exp(-t * 45) * 0.8 + Math.sin(2 * Math.PI * 140 * t) * Math.exp(-t * 28) * 0.5 + ring;
    }
  });
}

/** Steel drawn from the scabbard: a scrape and a ring. */
export function synthDraw(ctx) {
  return noiseBuf(ctx, 0.75, (d, sr, n) => {
    let hp = 0;
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const w = Math.random() * 2 - 1;
      hp = 0.9 * (hp + w - prev);
      prev = w;
      const scrape = hp * Math.min(1, t * 20) * Math.exp(-Math.max(0, t - 0.22) * 18) * 0.35;
      const ring = [2210, 3315, 5180, 6620].reduce((a, f, k) => a + Math.sin(2 * Math.PI * f * t) / (k + 1), 0) * Math.exp(-Math.max(0, t - 0.2) * 5) * (t > 0.2 ? 0.12 : 0);
      d[i] = scrape + ring;
    }
  });
}

/** Steel slid home: a short scrape and a click. */
export function synthSheathe(ctx) {
  return noiseBuf(ctx, 0.45, (d, sr, n) => {
    let hp = 0;
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const w = Math.random() * 2 - 1;
      hp = 0.9 * (hp + w - prev);
      prev = w;
      d[i] = hp * Math.exp(-t * 7) * Math.min(1, t * 30) * 0.3 + (t > 0.3 && t < 0.31 ? w * 0.8 : 0) + Math.sin(2 * Math.PI * 900 * t) * Math.exp(-Math.max(0, t - 0.3) * 60) * (t > 0.3 ? 0.3 : 0);
    }
  });
}
