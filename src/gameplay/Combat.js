import * as THREE from 'three';
import { PLAYER } from '../config.js';
import { GROUPS } from '../core/Physics.js';
import { solveTwoBone } from '../utils/bones.js';
import { dampAngle, wrapAngle } from '../utils/math.js';
import { groundHeight } from '../world/WorldLayout.js';
import { BladeTrail, makeTalwar } from './Talwar.js';

// Prady fights: bare hands, or the talwar from Tulsi Akhara.
//   LMB  a three-strike combo   unarmed: one-two -> body shot -> front kick
//                               sword:   rising slash -> second slash -> lunging thrust
//   RMB  a heavy blow           unarmed: roundhouse kick   sword: two-handed overhead cut
//   Q    (hold) block; raised just as a blow lands it is a parry that staggers the attacker
//   C    dodge roll (a moment of grace inside it); standing still, a backflip      R  draw or sheathe the talwar
//   A dodge just as a blow comes (its first beat) is a perfect dodge: the world slows, the attacker
//   reels, and the next strike is a counter (Pratyuttara). LMB out of a roll is a strike straight
//   out of it; LMB at a sprint is a running heavy blow; LMB falling from a height is a plunge
//   that throws every Asura round the landing flat. LMB on a wall run kicks off the wall onto
//   the nearest Asura; Space with one right in front vaults over it (a front flip over its
//   shoulders, landing at its back: the next strike is a counter).
// Every move is motion capture (CMU: a boxer, a karate practitioner, swordplay, a woodcutter's
// chop; see tools/retarget.js). Strikes carry their own root motion, applied through the
// character controller so a lunge plants its feet. Hits land on whatever can be struck (the
// akhara's dummies, the Asuras: everything in the Targets registry), with a moment of hit-stop.
// Blows taken (receive()) are dodged, parried, blocked or land: a flinch for a light one, a
// knockdown for a heavy one, and at zero prana Prady falls (Health.js).

const MOVES = {
  oneTwo: { hits: [{ t: 0.4, limb: 'LeftHand', k: 0.6 }, { t: 0.57, limb: 'RightHand', k: 0.8 }], cancel: 0.82, ts: 1.15 },
  bodyShot: { hits: [{ t: 0.48, limb: 'RightHand', k: 0.9 }], cancel: 0.78, ts: 1.1 },
  frontKick: { hits: [{ t: 0.65, limb: 'RightFoot', k: 1.1 }], cancel: 1.02, ts: 1.05, kick: true },
  // (the roundhouse is from video capture: a head-high chamber-and-snap, the leg held out a beat)
  roundKick: { hits: [{ t: 0.84, limb: 'RightFoot', k: 1.3 }], cancel: 1.9, ts: 1.6, kick: true },
  // (video capture too: a head-high side kick, the combo's last blow every other round)
  sideKick: { hits: [{ t: 0.7, limb: 'RightFoot', k: 1.15 }], cancel: 1.25, ts: 1.45, kick: true },
  slashA: { hits: [{ t: 0.57, blade: true, k: 1.0 }], cancel: 0.86, ts: 1.15, sword: true },
  slashB: { hits: [{ t: 0.6, blade: true, k: 1.0 }], cancel: 0.88, ts: 1.15, sword: true },
  thrust: { hits: [{ t: 0.67, blade: true, k: 1.1 }], cancel: 1.0, ts: 1.1, sword: true, wrist: 1.45 }, // a punch turned into a thrust: the blade down the line of the arm
  heavyCut: { hits: [{ t: 0.72, blade: true, k: 1.6 }], cancel: 1.1, ts: 1.15, sword: true, heavy: true, track: 1.0 },
  // the Fourth Strike siddhi: the combo ends in the overhead cut (fists: the roundhouse), quicker
  comboCut: { clip: 'heavyCut', hits: [{ t: 0.72, blade: true, k: 1.35 }], cancel: 1.1, ts: 1.32, sword: true, heavy: true, track: 1.4 },
  comboKick: { clip: 'roundKick', hits: [{ t: 0.84, limb: 'RightFoot', k: 1.15 }], cancel: 1.9, ts: 1.8, kick: true, heavy: true },
  // the butterfly kick (Mixamo): off a sprint, the body flat in the air, one foot then the other
  mxButterflyKick: { hits: [{ t: 1.2, limb: 'RightFoot', k: 1.15 }, { t: 1.4, limb: 'LeftFoot', k: 1.4 }], cancel: 1.85, ts: 1.4, kick: true, heavy: true },
};
export { MOVES };
const COMBO = { armed: ['slashA', 'slashB', 'thrust'], unarmed: ['oneTwo', 'bodyShot', 'frontKick'] };
const COMBO4 = { armed: [...COMBO.armed, 'comboCut'], unarmed: [...COMBO.unarmed, 'comboKick'] };
// bare-handed, every other round ends in the side kick instead of the front kick
const KICK2 = (l) => l.map((n) => (n === 'frontKick' ? 'sideKick' : n));
const COMBO_ALT = { 3: KICK2(COMBO.unarmed), 4: KICK2(COMBO4.unarmed) };
const HEAVY = { armed: 'heavyCut', unarmed: 'roundKick' };
const FEET = PLAYER.halfHeight + PLAYER.radius; // (his capsule's centre above his feet)
const LEG = 0.88; // Prady's hip height above the foot (m): root motion is baked in these units
const WINDOW = 0.085; // a strike connects within this much clip time of its peak

const _v = new THREE.Vector3();
const DOWN = { x: 0, y: -1, z: 0 };
// (the draw: scratch vectors)
const _dA = new THREE.Vector3();
const _dP = new THREE.Vector3();
const _dP2 = new THREE.Vector3();
const _dQ = new THREE.Quaternion();
const _dQ2 = new THREE.Quaternion();
const _dG = new THREE.Vector3();
const _dF = new THREE.Vector3();
const _dF2 = new THREE.Vector3();
const _dH = new THREE.Vector3();
const _dW = new THREE.Vector3();
const _dPole = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _base = new THREE.Vector3();
const _tip = new THREE.Vector3();
const _kn = new THREE.Vector3();
const _ft = new THREE.Vector3();
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
const _ax = new THREE.Vector3();
const _sw0 = new THREE.Vector3();
const _sw1 = new THREE.Vector3();
// per joint of a finger: knuckle, middle, tip (radians into the palm)
const GRIP_CURL = [1.25, 1.6, 0.9];
const _g1 = new THREE.Vector3();
const _g2 = new THREE.Vector3();
const _g3 = new THREE.Vector3();
const _g4 = new THREE.Vector3();
const _g5 = new THREE.Vector3();

/** Turn bone so its child points (up to maxAng radians nearer) at target (world). */
function aimBone(bone, child, target, maxAng) {
  const bp = bone.getWorldPosition(_g3);
  const from = child.getWorldPosition(_g4).sub(bp).normalize();
  const to = _g5.copy(target).sub(bp).normalize();
  const ang = Math.acos(Math.max(-1, Math.min(1, from.dot(to))));
  if (ang < 1e-3) return;
  rotateWorld(bone, from.cross(to).normalize(), Math.min(ang, maxAng));
}

function rotateWorld(bone, axis, angle) {
  bone.parent.getWorldQuaternion(_pq);
  const wq = bone.getWorldQuaternion(new THREE.Quaternion());
  wq.premultiply(_rq.setFromAxisAngle(axis, angle));
  bone.quaternion.copy(_pq.invert().multiply(wq));
  bone.updateWorldMatrix(false, true);
}

export class Combat {
  constructor({ player, animator, scene, audio, camRig, rootMotion, targets, health, onEvent }) {
    this.p = player;
    this.anim = animator;
    this.audio = audio;
    this.cam = camRig;
    this.targets = targets;
    this.health = health;
    this.rootMotion = rootMotion || {};
    this.onEvent = onEvent || (() => {});
    this.hasSword = false;
    this.armed = false;
    this.move = null; // { name, t, start, yaw, i, queued, struck:Set }
    this.combo = 0;
    this.rounds = 0; // combos begun (the bare-handed finish alternates)
    this.counterUntil = -9; // a perfect dodge: the next strike before this is a counter
    this.plunge = null; // falling on them from a height: { t, tgt }
    this.arc = null; // through the air on a set path: a vault over one, a flying kick off a wall
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
    // where the scabbard hangs, in the body frame (Prady faces +Z, his left is +X): off the hip,
    // its tip 40 degrees back, as a sword hangs from a sash (nearer upright, the thigh went
    // through it at every stride of a walk)
    this.hang = { pos: new THREE.Vector3(0.2, -0.06, 0.05), rot: new THREE.Euler(-2.44, 0.2, 0.16) };
    this.hipRef = null; // the hips' own turn in a relaxed stance (so the scabbard rides the hips)
    this.wristTilt = 0.55;
    this.bones = null;
    // defence
    this.roll = null; // { t, dur, dir:{x,z}, dist, yaw, clip }
    this.react = null; // { kind: 'light'|'heavy'|'block'|'down', t, dur, push:{x,z}, dist }
    this.dead = null; // { t }
    this.flinch = { amt: 0, vel: 0, axis: new THREE.Vector3(1, 0, 0), head: 0, headVel: 0 };
    this.lockTarget = null; // set by LockOn: strikes aim at it first
    this.blockTime = 0;
    this.dash = null; // { name, tgt, t, need }: closing on a target out of a strike's reach
    this.aimPitch = 0; // the chest bent toward a target up or down the steps
    this.prevBlade = null; // last frame's blade (base, tip): strikes sweep between frames
    this.perks = {}; // Siddhis.js: combo4, riposte, charged, mercy, windStep, vajra
    this.parryWindow = 0.42; // seconds after raising the guard that count as a parry (difficulty)
    this.lastParryT = -9;
    this.heavyHeld = false; // the heavy button is down (a charged blow with the siddhi)
    this.invuln = false; // a finisher in progress: nothing touches him
  }

  /** The combo in hand (three blows, four with the Fourth Strike siddhi). */
  comboList() {
    if (!this.armed && this.rounds % 2 && this.anim.clipActions.sideKick) return COMBO_ALT[this.perks.combo4 ? 4 : 3];
    return (this.perks.combo4 ? COMBO4 : COMBO)[this.armed ? 'armed' : 'unarmed'];
  }

  clipOf(name) {
    return MOVES[name]?.clip || name;
  }

  get busy() {
    return !!this.move || !!this.dash || this.blocking || !!this.roll || !!this.react || !!this.dead;
  }

  canFight() {
    const p = this.p;
    return p.state === 'ground' && p.grounded && !p.inputLocked && !p.actions?.act && !this.roll && !this.react && !this.dead && !this.drawing;
  }

  /** Inside the dodge's moment of grace (or knocked down / getting up). */
  get untouchable() {
    if (this.arc) return true; // (in the air over it, or flying off the wall)
    const r = this.roll;
    // (at least the half second an Asura's eyes flare before its blow: roll on the flare)
    if (r && r.t > 0.03 && r.t < Math.min(r.dur * 0.9, Math.max(r.dur * 0.68, this.perks.windStep ? 0.68 : 0.56))) return true;
    return this.react?.kind === 'down' && this.react.t > 0.25;
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
    if (this.move || this.p.state !== 'ground' || this.drawing) return;
    // drawn or put away by hand: the right hand crosses to the hilt at his left hip, the blade
    // slides out along the scabbard and comes up into the stance (or the reverse); late() moves
    // the arm (two-bone IK) and the blade through it, armed flips when the steel leaves or meets
    // the scabbard's mouth
    this.drawing = { t: 0, dur: this.armed ? 0.7 : 0.62, draw: !this.armed, flipped: false };
    this.onEvent(this.drawing.draw ? 'draw' : 'sheathe', {});
    if (!this.drawing.draw && this.anim.isPlaying('swordStance')) {
      // blade away: the sword stance goes with it (it loops, and only moving cancels it)
      this.stanceUntil = 0;
      this.anim.stop(0.5);
    }
  }

  /** A draw or a sheathe cut short (a blow, a fall): it ends where it was going. */
  endDrawing() {
    const D = this.drawing;
    if (!D) return;
    this.drawing = null;
    if (!D.flipped) {
      this.armed = D.draw;
      if (D.draw) this.stance(6);
    }
  }

  attack() {
    if (this.dash) {
      this.dash.queued = true;
      return;
    }
    if (this.move) {
      // a press during the move queues the next strike of the combo (from early in it: a
      // mashed button isn't lost)
      if (this.move.t > 0.15 && !this.move.force && !MOVES[this.move.name].heavy && this.move.name !== HEAVY.unarmed) this.move.queued = true;
      return;
    }
    // on a wall run: kick off the wall onto the nearest one
    const tr = this.p.traversal;
    if (tr?.act?.type === 'wallrun' && !this.dead) {
      const t = this.nearestEnemy(8);
      if (t) {
        tr.end();
        this.leapKick(t);
        return;
      }
    }
    // out of a roll: remembered, and struck as soon as he is on his feet (rollAttack)
    if (this.roll) {
      this.roll.queuedAttack = true;
      return;
    }
    // falling from a height: a plunge onto whatever is under him
    if (this.p.state === 'air' && !this.plunge && !this.dead && this.canPlunge()) return this.startPlunge();
    if (!this.canFight() || this.blocking) return;
    // at a full sprint: a running heavy blow (the roundhouse off the run, a two-handed cleave)
    const p = this.p;
    if (p.cmd?.sprint && p.speed > 4.2 && this.time - this.lastEnd > 0.3) {
      this.combo = 0;
      // (bare-handed, every other one the butterfly kick)
      this.sprintAlt = !this.sprintAlt;
      this.start(this.armed ? 'heavyCut' : this.sprintAlt && this.anim.clipActions.mxButterflyKick ? 'mxButterflyKick' : 'roundKick');
      if (this.move) this.move.sprint = true;
      return;
    }
    if (this.time - this.lastEnd > 0.7) this.combo = 0;
    if (this.combo % this.comboList().length === 0) this.rounds++;
    const list = this.comboList();
    this.start(list[this.combo % list.length]);
  }

  /** A strike straight out of a roll or the backflip, the moment he is on his feet: a kick out of
   *  the roll bare-handed, a lunging thrust with the talwar (a counter, after a perfect dodge). */
  rollAttack() {
    const r = this.roll;
    this.roll = null;
    if (r?.clip && this.anim.isPlaying(r.clip)) this.anim.stop(0.1);
    this.lastEnd = this.time;
    this.combo = 0;
    const name = this.armed ? 'thrust' : this.anim.clipActions.sideKick ? 'sideKick' : this.comboList()[0];
    this.start(name);
    if (this.move) this.move.fromRoll = true;
  }

  /** The nearest Asura standing within range (any direction). */
  nearestEnemy(range) {
    const P = this.p.position;
    let best = null;
    let bd = range;
    for (const t of this.targets.list ?? []) {
      if (!t.enemy || !t.alive || t.state === 'rise') continue;
      const d = Math.hypot(t.pos.x - P.x, t.pos.z - P.z);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }

  /** Space with an Asura right in front (not a giant): over it. */
  tryVault() {
    const p = this.p;
    if (!this.canFight() || this.move || this.arc || this.blocking) return false;
    const t = this.nearestEnemy(2.3);
    if (!t || (t.height || 1.8) > 2.9 || t.K?.boss) return false;
    const dx = t.pos.x - p.position.x;
    const dz = t.pos.z - p.position.z;
    const ahead = Math.abs(wrapAngle(Math.atan2(dx, dz) - p.yaw)) < 0.9;
    if (!ahead || Math.abs(t.pos.y - p.feetY) > 0.8) return false;
    this.vaultOver(t);
    return true;
  }

  /** A front flip over its shoulders, landing a body's length behind it, facing its back. */
  vaultOver(t) {
    const p = this.p;
    const P = p.position;
    const dx = t.pos.x - P.x;
    const dz = t.pos.z - P.z;
    const d = Math.hypot(dx, dz) || 1;
    const far = d + 1.35 + (t.radius || 0.4);
    const to = new THREE.Vector3(P.x + (dx / d) * far, 0, P.z + (dz / d) * far);
    to.y = groundHeight(to.x, to.z);
    this.arc = { kind: 'vault', t: 0, dur: 0.62, from: new THREE.Vector3(P.x, p.feetY, P.z), to, apex: Math.max(1.0, (t.height || 1.8) * 0.85 - Math.max(0, p.feetY - t.pos.y)), yaw: Math.atan2(dx, dz), tgt: t };
    // (the backflip, played backwards from its landing: a front flip)
    if (this.anim.clipActions.backFlip) this.anim.play('backFlip', { reverse: true, at: 1.66, timeScale: 2.3, fadeIn: 0.06, fadeOut: 0.2, cancelOnMove: false, noLook: true, noFootIK: true });
    this.audio.play('whoosh', { volume: 0.55, rate: 0.9 });
    this.onEvent('vault', {});
  }

  /** Off the wall in an arc onto t, the kick landing as he reaches it. */
  leapKick(t) {
    const p = this.p;
    const P = p.position;
    const dx = t.pos.x - P.x;
    const dz = t.pos.z - P.z;
    const d = Math.hypot(dx, dz) || 1;
    const stop = Math.max(0.2, d - 0.95 - (t.radius || 0.4));
    const to = new THREE.Vector3(P.x + (dx / d) * stop, t.pos.y, P.z + (dz / d) * stop);
    const dur = THREE.MathUtils.clamp(d / 11, 0.35, 0.7);
    this.arc = { kind: 'kick', t: 0, dur, from: new THREE.Vector3(P.x, p.feetY, P.z), to, apex: 0.7, yaw: Math.atan2(dx, dz), tgt: t };
    p.state = 'ground';
    const clip = this.armed ? 'thrust' : this.anim.clipActions.sideKick ? 'sideKick' : 'frontKick';
    const hitT = MOVES[clip].hits[0].t;
    const at = Math.max(0, hitT - dur * 1.1);
    this.arc.clip = clip;
    this.anim.play(clip, { at, timeScale: (hitT - at) / dur, fadeIn: 0.06, fadeOut: 0.25, cancelOnMove: false, noLook: true, noFootIK: true });
    this.audio.play('whoosh', { volume: 0.6, rate: 0.75 });
    this.onEvent('leapKick', {});
  }

  /** Through the air along the arc (it owns him while it lasts). */
  arcStep(dt) {
    const p = this.p;
    const a = this.arc;
    a.t += dt;
    const k = Math.min(1, a.t / a.dur);
    const x = THREE.MathUtils.lerp(a.from.x, a.to.x, k);
    const z = THREE.MathUtils.lerp(a.from.z, a.to.z, k);
    const y = THREE.MathUtils.lerp(a.from.y, a.to.y, k) + 4 * a.apex * k * (1 - k);
    p.position.set(x, y + FEET, z);
    p.yaw = dampAngle(p.yaw, a.yaw, 20, dt);
    if (k >= 1) {
      this.arc = null;
      p.velocity.set(0, 0, 0);
      p.state = 'ground';
      const t = a.tgt;
      if (a.kind === 'vault') {
        // landed at its back, turned to face it: the next blow is a counter
        if (t?.alive) p.yaw = Math.atan2(t.pos.x - p.position.x, t.pos.z - p.position.z);
        this.counterUntil = this.time + 0.9;
        this.audio.play('footstep', { volume: 0.8, rate: 0.8 });
      } else if (t?.alive) {
        // the flying kick lands
        const dir = { x: t.pos.x - a.from.x, z: t.pos.z - a.from.z };
        t.hit({ k: 1.7, dir, at: { x: t.pos.x, y: t.pos.y + (t.height || 1.7) * 0.6, z: t.pos.z }, sword: this.armed, heavy: true, kick: !this.armed, move: 'leapKick' });
        this.hitStop = Math.max(this.hitStop, 0.09);
        this.audio.play('heavy-hit', { volume: 0.9, rate: 0.85 });
        this.onEvent('hit', { move: 'leapKick', heavy: true, kick: !this.armed, sword: this.armed, enemy: true, target: t.kind, k: 1.7, at: t.pos, dir });
      }
      return this.hold(true);
    }
    return this.hold(true);
  }

  /** High enough above the ground to come down on them (not a hop off a step). */
  canPlunge() {
    const p = this.p;
    return p.feetY - groundHeight(p.position.x, p.position.z) > 1.5 && p.velocity.y < 4;
  }

  /** Down on them: he drops hard toward the nearest Asura below and ahead; the landing (Player
   *  onLand -> plungeLand) is the blow. */
  startPlunge() {
    const p = this.p;
    const t = this.nearestTargetObj(6, p.yaw);
    this.plunge = { t: 0, tgt: t?.enemy ? t : null };
    p.velocity.y = Math.min(p.velocity.y, -9);
    if (this.armed) this.anim.play('heavyCut', { fadeIn: 0.08, fadeOut: 0.2, cancelOnMove: false, noLook: true, noFootIK: true, timeScale: 0.35 });
    else if (this.anim.clipActions.backFlip) this.anim.play('backFlip', { fadeIn: 0.1, fadeOut: 0.2, cancelOnMove: false, noLook: true, noFootIK: true, timeScale: 0.15, at: 0.45 });
    this.audio.play('whoosh', { volume: 0.5, rate: 0.55 });
    this.onEvent('plunge', {});
  }

  /** The plunge lands: every Asura round the impact is struck and thrown flat. */
  plungeLand(impact) {
    const p = this.p;
    this.plunge = null;
    const R = 2.8;
    const P = p.position;
    let n = 0;
    for (const t of this.targets.list ?? []) {
      if (!t.enemy || !t.alive || t.state === 'rise') continue;
      const dx = t.pos.x - P.x;
      const dz = t.pos.z - P.z;
      const d = Math.hypot(dx, dz);
      if (d > R + (t.radius || 0.4) || Math.abs(t.pos.y - p.feetY) > 2.5) continue;
      const dir = { x: dx / (d || 1), z: dz / (d || 1) };
      const k = (1.4 + Math.min(1, impact / 20) * 0.6) * (1 - (d / R) * 0.35);
      t.hit({ k, dir, at: { x: t.pos.x, y: t.pos.y + (t.height || 1.7) * 0.5, z: t.pos.z }, sword: this.armed, heavy: true, kick: !this.armed, move: 'plunge' });
      if (t.alive && t.floor) t.floor(dir, 1.3 - (d / R) * 0.5);
      n++;
    }
    // the landing: the blade comes down at the impact (or a crouched, hand-to-stone landing)
    if (this.armed) this.anim.play('heavyCut', { fadeIn: 0.05, fadeOut: 0.25, cancelOnMove: false, noLook: true, noFootIK: true, timeScale: 1.4, at: 0.66 });
    else if (this.anim.clipActions.backFlip) this.anim.play('backFlip', { fadeIn: 0.05, fadeOut: 0.3, cancelOnMove: false, noLook: true, noFootIK: true, timeScale: 1.3, at: 1.42 });
    this.hitStop = Math.max(this.hitStop, 0.08);
    this.audio.play('thump', { volume: 1, rate: 0.5 });
    this.audio.play('heavy-hit', { volume: 0.8, rate: 0.75 });
    this.onEvent('plungeLand', { at: { x: P.x, y: p.feetY, z: P.z }, n, impact });
    return true;
  }

  heavy() {
    if (this.move) {
      if (!this.move.force && this.move.t > MOVES[this.move.name].cancel / MOVES[this.move.name].ts) this.move.queuedHeavy = true;
      return;
    }
    if (!this.canFight() || this.blocking) return;
    this.start(HEAVY[this.armed ? 'armed' : 'unarmed']);
    // Gathered Storm: held, the wind-up waits and the blow gathers (released, it falls)
    if (this.move && this.perks.charged) {
      this.move.charging = true;
      this.move.charge = 0;
    }
  }

  /**
   * A strike that cannot miss (a finisher's choreography, Finishers.js): played at `target`,
   * every blow lands on it at the clip's own moment. opts: { ts, onHit(hitIndex), chain: { name,
   * opts } (the next one, at this one's cancel point), k }.
   */
  forceMove(name, target, opts = {}) {
    this.move = null;
    this.dash = null;
    // further than the strike's lunge reaches: a few quick strides in first (the dash), then it
    const p = this.p;
    const L = this.landing(name);
    const reach = Math.hypot(L.x, L.z) + 0.08 + (MOVES[name].sword ? 0.42 : 0);
    const d = Math.hypot(target.pos.x - p.position.x, target.pos.z - p.position.z) - (target.radius ?? 0.3) * 0.6;
    if (!opts.noDash && d - reach > 1.1) {
      this.dash = { name, tgt: target, t: 0, need: reach + 0.25, max: 0.7, forced: opts };
      return { opts, dashing: true };
    }
    this.start(name, true, target);
    const mv = this.move;
    if (!mv) return null;
    mv.force = target;
    mv.opts = opts;
    if (opts.ts) {
      mv.ts = opts.ts;
      this.anim.cur && (this.anim.cur.a.timeScale = opts.ts);
    }
    return mv;
  }

  setBlock(on, force = false) {
    const pressed = on && !this.guardHeld;
    this.guardHeld = on;
    if (on && !this.blocking) {
      // a strike still winding up gives way to the guard; a blow already on its way plays out
      // and the guard comes up the instant it's done (a tap on the flare is never lost)
      if (pressed && this.move) {
        if (this.moveYields()) this.cancelMove();
        else this.pendingBlock = this.time + 0.4;
      }
      if (!this.move && this.canFight()) this.raiseGuard();
      else if (pressed && !this.move) this.pendingBlock = this.time + 0.32;
    } else if (!on && this.blocking) {
      // a tap on the guard still holds it long enough for the parry window (tap to parry)
      if (!force && this.time - this.blockStart < 0.46) return;
      this.blocking = false;
      this.anim.stop(0.2);
      this.stance(3);
    }
  }

  /** A strike gives way to defence while winding up or once its blow has landed (its follow-through). */
  moveYields() {
    const mv = this.move;
    if (!mv) return true;
    const m = MOVES[mv.name];
    const ct = mv.t * mv.ts;
    if (mv.force) return false;
    return ct < m.hits[0].t - 0.1 || ct > m.hits[m.hits.length - 1].t + 0.06;
  }

  cancelMove() {
    if (!this.move) return;
    this.move = null;
    this.lastEnd = this.time;
    this.anim.stop(0.1);
  }

  raiseGuard() {
    this.blocking = true;
    this.pendingBlock = 0;
    this.anim.play('parry', { clamp: true, cancelOnMove: false, fadeIn: 0.1, fadeOut: 0.2, noLook: true });
    this.blockTime = 0;
    this.blockStart = this.time;
    this.onEvent('block', {});
  }

  // ------------------------------------------------------------ defence
  /**
   * C: a dodge roll toward wish (world {x,z}, or null = back away from where Prady faces).
   * Allowed from a stand, a run, a raised guard, or the tail of a strike (after it has landed).
   */
  dodge(wish, buffered = false) {
    const p = this.p;
    // pressed a moment too soon (mid-blow, mid-flinch, still rolling): remembered, and it
    // happens the instant it can (a dodge the player asked for is never simply dropped)
    const later = () => {
      if (!buffered) this.pendingDodge = { wish, until: this.time + 0.4 };
      return false;
    };
    if (this.dead || p.state !== 'ground' || p.inputLocked || p.actions?.act) return false;
    if (this.roll || (this.react && this.react.kind !== 'block' && this.react.kind !== 'down') || !p.grounded) return later();
    if (this.react?.kind === 'down') return false;
    if (this.move) {
      const m = MOVES[this.move.name];
      const ct = this.move.t * this.move.ts;
      if (this.move.force) return false;
      // the wind-up can be abandoned for a roll; the blow itself plays out, then the roll
      const winding = ct < m.hits[0].t - 0.1;
      if (!winding && ct < m.hits[m.hits.length - 1].t + 0.06) return later();
      this.move = null;
      this.lastEnd = this.time;
      if (winding) this.anim.stop(0.08);
    }
    this.pendingDodge = null;
    this.dash = null;
    if (this.blocking) this.setBlock(false, true);
    this.react = null;
    let dx = wish?.x ?? -Math.sin(p.yaw);
    let dz = wish?.z ?? -Math.cos(p.yaw);
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    // a forward roll toward the way he dodges; a backflip when he only wants distance (a hop
    // backwards without that clip)
    const back = !wish;
    const flip = back && !!this.anim.clipActions.backFlip;
    // straight out to his side: an aerial that way (a no-hands cartwheel), still facing his foe
    const lat = back ? 0 : dx * Math.cos(p.yaw) - dz * Math.sin(p.yaw); // (+: toward his left hand)
    const aerial = Math.abs(lat) > 0.75 ? (lat > 0 ? 'aerialL' : 'aerialR') : null;
    const side = !!(aerial && this.anim.clipActions[aerial]);
    const clip = flip ? 'backFlip' : side ? aerial : back && this.anim.clipActions.dodgeBack ? 'dodgeBack' : this.anim.clipActions.dodgeRoll ? 'dodgeRoll' : null;
    // a dive roll is ~1 s of the 1.55 s take played fast; the backstep ~0.65 s; the backflip 1 s
    // (a slow-motion take: in the air from 12% to 72% of it, and he only travels then); the aerial
    // ~0.95 s of a slow-motion take, travelling while it turns over (12% to 88%)
    const dur = clip ? (flip ? 1.0 : side ? 0.95 : back ? 0.65 : 0.95) : 0.55;
    const far = this.perks.windStep ? 1.3 : 1;
    this.roll = { t: 0, dur, dir: { x: dx, z: dz }, dist: (flip ? 2.4 : side ? 3.0 : back ? 2.2 : 3.6) * far, yaw: back || side ? p.yaw : Math.atan2(dx, dz), clip, done: 0, air: flip ? [0.12, 0.72] : side ? [0.12, 0.88] : null };
    if (clip) this.anim.play(clip, { fadeIn: 0.08, fadeOut: 0.2, cancelOnMove: false, noLook: true, noFootIK: true, timeScale: this.anim.clipActions[clip].getClip().duration / dur });
    this.audio.play('whoosh', { volume: 0.35, rate: 0.7 });
    this.onEvent('dodge', {});
    return true;
  }

  /**
   * A blow aimed at Prady: { from:{x,z}, dmg, heavy, knock (floors him), unblockable, attacker?:{ parried() } }.
   * Returns 'dodged' | 'parried' | 'blocked' | 'hit' | 'none'.
   */
  receive(a) {
    const p = this.p;
    if (this.dead || !this.health || this.invuln) return 'none';
    if (this.untouchable) {
      // a perfect dodge: the blow came in the roll's first beat (he moved as it fell, not before)
      const perfect = !!this.roll && this.roll.t < 0.3 && this.time > this.counterUntil;
      if (perfect) {
        this.counterUntil = this.time + 1.4;
        a.attacker?.stagger?.(0.8); // (it struck at nothing and is left open)
        this.onEvent('perfectDodge', { at: a.from });
      }
      this.onEvent('dodged', { roll: !!this.roll, perfect });
      return 'dodged';
    }
    const dx = a.from.x - p.position.x;
    const dz = a.from.z - p.position.z;
    const l = Math.hypot(dx, dz) || 1;
    const away = { x: -dx / l, z: -dz / l };
    const facing = Math.abs(wrapAngle(Math.atan2(dx, dz) - p.yaw)) < 1.75;
    if (this.blocking && facing && !a.unblockable) {
      if (this.time - this.blockStart < this.parryWindow) {
        // a perfect guard: the blow glances off and the attacker reels
        a.attacker?.parried?.();
        this.flinchHit(away, 0.25);
        this.audio.play('parry', { volume: 0.9, rate: 0.95 + Math.random() * 0.1 });
        this.onEvent('parry', { at: { x: p.position.x - away.x * 0.5, z: p.position.z - away.z * 0.5 } });
        this.blockStart = this.time - 1; // one parry per raise
        this.lastParryT = this.time; // (Pratyuttara: a strike now is a riposte)
        return 'parried';
      }
      this.health.damage(a.dmg * (a.heavy ? 0.3 : 0.12), { ignoreGrace: true });
      this.react = { kind: 'block', t: 0, dur: a.heavy ? 0.5 : 0.3, push: away, dist: a.heavy ? 0.85 : 0.4 };
      this.flinchHit(away, a.heavy ? 0.7 : 0.4);
      this.audio.play('block', { volume: a.heavy ? 1 : 0.75, rate: this.armed ? 1 : 0.7 });
      this.onEvent('blocked', { heavy: !!a.heavy });
      if (a.heavy && !this.perks.vajra && this.health.time - (this.lastGuardBreak ?? -9) > 0.1) {
        // a heavy blow breaks the guard
        this.lastGuardBreak = this.health.time;
        this.setBlock(false, true);
        this.react = { kind: 'light', t: 0, dur: 0.55, push: away, dist: 0.9 };
      }
      return 'blocked';
    }
    const taken = this.health.damage(a.dmg);
    if (taken <= 0) return 'none';
    this.move = null;
    this.dash = null;
    if (this.blocking) this.setBlock(false, true);
    this.roll = null;
    this.endDrawing();
    this.audio.play('hurt', { volume: 0.8, rate: 0.95 + Math.random() * 0.1 });
    this.hitStop = a.heavy ? 0.1 : 0.06;
    this.onEvent('hurt', { dmg: taken, heavy: !!a.heavy, from: a.from });
    if (this.health.dead) return this.die(away), 'hit';
    // floored at most once in a while: up from one knockdown, the next big blow only drives him back
    if (a.knock && this.anim.clipActions.knockdown && this.time - (this.lastDown ?? -99) > 7) {
      this.lastDown = this.time;
      // knocked flat (0.9 s), a beat on the ground, then up (2 s): untouchable from the fall on
      this.react = { kind: 'down', t: 0, dur: 3.2, push: away, dist: 1.6, stage: 0 };
      this.anim.play('knockdown', { clamp: true, fadeIn: 0.08, fadeOut: 0.3, cancelOnMove: false, noLook: true, noFootIK: true, timeScale: 1.2 });
    } else {
      this.react = { kind: a.heavy ? 'heavy' : 'light', t: 0, dur: a.heavy ? 0.75 : 0.42, push: away, dist: a.heavy ? 1.1 : 0.35 };
      // a heavy blow drives him back: real steps (the backward-stepping take), not a slide
      // which way the blow came from, against the way he faces: a reaction for that side (Mixamo's
      // large reactions for a heavy blow from the front, the back or his right; the small ones for
      // a light blow from a side)
      const fx = Math.sin(p.yaw);
      const fz = Math.cos(p.yaw);
      const front = -(away.x * fx + away.z * fz);
      const right = -(away.x * -fz + away.z * fx);
      const A = this.anim.clipActions;
      let clip = null;
      if (a.heavy) clip = front > 0.5 ? 'mxReactFront' : front < -0.5 ? 'mxReactBack' : right > 0 ? 'mxReactRight' : 'mxReactSmallL';
      else if (Math.abs(right) > 0.45) clip = right > 0 ? 'mxReactSmallR' : 'mxReactSmallL';
      if (!clip || !A[clip]) clip = a.heavy && A.hitHeavy ? 'hitHeavy' : a.heavy && A.dodgeBack ? 'dodgeBack' : A.hitLight ? 'hitLight' : null;
      this.react.clip = clip;
      if (clip) this.anim.play(clip, { fadeIn: 0.07, fadeOut: 0.25, cancelOnMove: false, noLook: true, timeScale: clip === 'dodgeBack' ? 1.35 : clip.startsWith('mx') ? 1.25 : 1 });
    }
    this.flinchHit(away, a.heavy ? 1.3 : 0.9);
    return 'hit';
  }

  die(away) {
    this.dead = { t: 0, reported: false };
    this.react = null;
    this.roll = null;
    this.dash = null;
    this.armedBeforeDeath = this.armed;
    const clip = this.anim.clipActions.death ? 'death' : this.anim.clipActions.knockdown ? 'knockdown' : null;
    if (clip) this.anim.play(clip, { clamp: true, fadeIn: 0.1, fadeOut: 0.4, cancelOnMove: false, noLook: true, noFootIK: true });
    this.deathPush = away;
    this.onEvent('dying', {});
  }

  /** Back on his feet (Mother Ganga's grace after a fall). */
  revive() {
    this.dead = null;
    this.react = null;
    this.roll = null;
    this.move = null;
    this.dash = null;
    this.blocking = false;
    this.anim.stop(0.3);
    this.flinch.amt = this.flinch.vel = 0;
  }

  /** The torso and head recoil away from a blow: a damped spring added over the clip. */
  flinchHit(away, k) {
    this.flinch.axis.set(away.z, 0, -away.x).normalize(); // bends the chest back along "away"
    this.flinch.vel += 7.2 * k;
  }

  /** Move the capsule by (dx, dz) through the controller; refuses to go off a drop of more than maxDrop. */
  slide(dx, dz, maxDrop = 0.4, dry = false) {
    const p = this.p;
    if (!dx && !dz) return;
    const ahead = groundHeight(p.position.x + dx * 4, p.position.z + dz * 4);
    const drop = p.feetY - ahead;
    if (drop > maxDrop) return;
    // (nothing in a fight carries him into the river: a roll, a blow's push, the run-in all
    // stop where the water would come over his knees, half a metre short of it)
    if (dry) {
      const l = Math.hypot(dx, dz) || 1;
      const far = groundHeight(p.position.x + (dx / l) * 0.6, p.position.z + (dz / l) * 0.6);
      if (Math.min(ahead, far) < -0.45 && Math.min(ahead, far) < p.feetY - 0.05) return;
    }
    // (flat: a downward push in the same controller call makes Rapier drop whole frames of the
    // move at random, ~1 in 8 here, a stutter in every roll; settle() and snap-to-ground keep
    // his feet down. Player.js's walk had the same.)
    _v.set(dx, 0, dz);
    p.kcc.computeColliderMovement(p.collider, _v, undefined, GROUPS.mover);
    const d = p.kcc.computedMovement();
    p.position.x += d.x;
    p.position.y += d.y;
    p.position.z += d.z;
  }

  /**
   * Gravity under a strike, a dash, a roll or a blow taken: their travel is flat, so a lunge off a
   * step (down at an Asura below him) would leave him standing on air till it ended. He drops onto
   * what is below like any fall (the controller's snap only reaches half a metre).
   */
  settle(dt) {
    const p = this.p;
    const hit = p.physics.castRay({ x: p.position.x, y: p.position.y, z: p.position.z }, DOWN, 40, p.collider, GROUPS.mover); // (the ramps he walks on, as the controller)
    const floor = hit !== null ? p.position.y - hit : groundHeight(p.position.x, p.position.z);
    const gap = p.feetY - floor;
    if (gap > 0.04) {
      this.fallV = Math.min(16, (this.fallV || 0) + 22 * dt);
      p.position.y -= Math.min(gap, this.fallV * dt);
    } else this.fallV = 0;
  }

  // Where the blow lands in the move's own frame (Prady at the origin facing +Z), in metres:
  // the root's travel up to the strike plus the limb's reach from the hips at that moment.
  landing(name) {
    const m = MOVES[name];
    const rm = this.rootMotion[this.clipOf(name)];
    if (!rm || rm.strikeYaw === undefined) return { x: 0, z: 0.6 * LEG };
    const f = Math.min(rm.path.length / 2 - 1, Math.round(m.hits[m.hits.length - 1].t * rm.fps));
    const rx = (rm.path[f * 2] - rm.path[0]) * LEG;
    const rz = (rm.path[f * 2 + 1] - rm.path[1]) * LEG;
    return { x: rx + Math.sin(rm.strikeYaw) * rm.reach * LEG, z: rz + Math.cos(rm.strikeYaw) * rm.reach * LEG };
  }

  /** What a strike goes for: the lock; else an Asura winding up a blow close by (meet it
   *  first); else the nearest along the camera; else anyone right beside him. */
  pickTarget(camYaw) {
    const p = this.p;
    const L = this.lockTarget;
    // (locked on, a strike goes for it from further: the run-in closes the distance)
    if (L?.alive && Math.hypot(L.pos.x - p.position.x, L.pos.z - p.position.z) < (L.K?.boss ? 12 : 9)) return L;
    const T = this.targets;
    if (!T) return null;
    const prev = this.lastTgt?.alive ? this.lastTgt : null;
    return (
      T.best(p.position, 7, camYaw, 0.75, p.feetY, prev) ||
      T.nearest(p.position, 4.6, camYaw, 1.9, null, p.feetY) ||
      T.nearest(p.position, 2.8, camYaw, Math.PI, (t) => t.enemy, p.feetY)
    );
  }

  /** How far down a step a lunge may carry him: only toward a target below, never into the river. */
  dropAllow(t) {
    const p = this.p;
    return t?.enemy && t.pos.y < p.feetY - 0.2 ? Math.min(2.4, p.feetY - t.pos.y + 0.45) : 0.35;
  }

  start(name, noDash = false, forced = null) {
    const m = MOVES[name];
    const p = this.p;
    // aim the blow itself (not the hips: fighting stances stand side-on) at a dummy in front
    // within reach, else along the camera; close or open the distance during the wind-up
    const L = this.landing(name);
    const la = Math.atan2(L.x, L.z);
    const camYaw = Math.atan2(this.cam.forward.x, this.cam.forward.z);
    let yaw = camYaw - la;
    let approach = 0;
    const tt = forced || this.pickTarget(camYaw);
    if (tt?.enemy) this.lastTgt = tt;
    const t = tt?.pos;
    if (t) {
      const ty = Math.atan2(t.x - p.position.x, t.z - p.position.z);
      // aim at the body's surface, not its centre (a broad Rakshasa is met sooner than a post)
      const d = Math.hypot(t.x - p.position.x, t.z - p.position.z) - (tt.enemy ? tt.radius * 0.6 : 0);
      yaw = ty - la;
      // with the talwar the middle of the blade should meet the target, not the fist; against
      // an enemy the lunge reaches further (the lock pulls the blow in, as in any action game)
      // standing above it (the steps): get down to it, so the blade crosses its body
      const below = tt.enemy ? Math.max(0, p.feetY - tt.pos.y - 0.3) : 0;
      const reachAt = Math.hypot(L.x, L.z) + 0.08 + (m.sword ? 0.42 : 0) - below * 0.9;
      const need = d - reachAt;
      // further than a lunge covers: run in first (a few quick strides), then strike
      if (tt.enemy && !noDash && need > 2.05) {
        const need2 = Math.max((tt.radius ?? 0.3) * 0.4 + 0.5, reachAt + 1.4);
        this.dash = { name, tgt: tt, t: 0, need: need2, max: Math.min(1.5, Math.max(0.6, (d - need2) / 6.2 + 0.3)) };
        this.move = null;
        return;
      }
      approach = Math.max(-0.45, Math.min(tt.enemy ? 1.9 : 1.2, need));
      this.aimAt = ty;
    }
    this.move = { name, t: 0, ts: m.ts, start: p.position.clone(), yaw, i: this.combo, queued: false, queuedHeavy: false, struck: new Set(), whoosh: false, approach, approachYaw: t ? Math.atan2(t.x - p.position.x, t.z - p.position.z) : yaw, la, pathYaw: yaw, tgt: tt?.enemy ? tt : null, tgt0: tt?.enemy ? new THREE.Vector3(tt.pos.x, 0, tt.pos.z) : null, track: { x: 0, z: 0 } };
    // Pratyuttara: the first strike after a parry is a riposte
    if ((this.perks.riposte && this.time - this.lastParryT < 1.1) || this.time < this.counterUntil) {
      this.move.riposte = true;
      this.lastParryT = -9;
      this.counterUntil = -9;
    }
    // (the facing turns over the wind-up in fixed(): snapping it popped the whole body)
    const chained = this.time - this.lastEnd < 0.05 || !!this.anim.cur;
    this.anim.play(this.clipOf(name), { fadeIn: m.kick || m.heavy ? 0.2 : chained ? 0.16 : 0.18, fadeOut: 0.2, cancelOnMove: false, noLook: true, noFootIK: !!m.kick, timeScale: m.ts });
    this.onEvent('swing', { move: name });
  }

  nearestTarget(range, yaw) {
    return this.nearestTargetObj(range, yaw)?.pos ?? null;
  }

  nearestTargetObj(range, yaw) {
    if (!this.targets) return null;
    const p = this.p.position;
    const L = this.lockTarget;
    if (L?.alive && Math.hypot(L.pos.x - p.x, L.pos.z - p.z) < range + 1.5) return L;
    return this.targets.nearest(p, range, yaw, 1.9, null, this.p.feetY);
  }

  stance(seconds) {
    this.stanceUntil = this.time + seconds;
    this.anim.play(this.armed ? 'swordStance' : 'guard', { loop: true, fadeIn: 0.25, fadeOut: 0.25, cancelOnMove: true, noLook: true });
  }

  // ------------------------------------------------------------ fixed 60 Hz (instead of the player)
  fixed(dt) {
    this.time += dt;
    const p = this.p;
    // the hit-stop runs out whatever Prady is doing (a blow taken freezes him for a beat too)
    const stopped = this.hitStop > 0;
    this.hitStop = Math.max(0, this.hitStop - dt);
    if (this.pendingDodge) {
      if (this.time > this.pendingDodge.until) this.pendingDodge = null;
      else if (this.dodge(this.pendingDodge.wish, true)) this.pendingDodge = null;
    }
    if (this.pendingBlock && !this.blocking) {
      if (this.time > this.pendingBlock) this.pendingBlock = 0;
      else if (!this.roll && this.moveYields()) {
        this.cancelMove();
        if (this.canFight()) this.raiseGuard();
      }
    }
    if (this.plunge) {
      const pl = this.plunge;
      pl.t += dt;
      // a hard, straight drop, steered onto the one below
      p.velocity.y = Math.min(p.velocity.y, -14);
      if (pl.tgt?.alive) {
        const dx = pl.tgt.pos.x - p.position.x;
        const dz = pl.tgt.pos.z - p.position.z;
        const d = Math.hypot(dx, dz);
        const v = Math.min(9, d / 0.3);
        p.velocity.x = (dx / (d || 1)) * v;
        p.velocity.z = (dz / (d || 1)) * v;
        p.yaw = dampAngle(p.yaw, Math.atan2(dx, dz), 14, dt);
      }
      // (never stuck in it: a ledge he caught, a long way down)
      if (pl.t > 2.5 || p.state !== 'air') this.plunge = null;
      return false;
    }
    if (this.arc && !this.dead) return this.arcStep(dt);
    if (this.dead) {
      this.dead.t += dt;
      if (this.dead.t < 0.5) this.slide(this.deathPush.x * dt * 1.2, this.deathPush.z * dt * 1.2, 0.6, true);
      if (this.dead.t > 2.2 && !this.dead.reported) {
        this.dead.reported = true;
        this.onEvent('death', {});
      }
      return this.hold(true);
    }
    if (this.roll) {
      const r = this.roll;
      r.t += dt;
      const k = Math.min(1, r.t / r.dur);
      // fast out of the gate, slowing into the recovery (a flip: steady through the air)
      const ease = r.air ? THREE.MathUtils.clamp((k - r.air[0]) / (r.air[1] - r.air[0]), 0, 1) : 1 - Math.pow(1 - k, 2.4);
      const step = (ease - r.done) * r.dist;
      r.done = ease;
      p.yaw = dampAngle(p.yaw, r.yaw, 18, dt);
      this.slide(r.dir.x * step, r.dir.z * step, 1.2, true);
      this.settle(dt);
      // (a strike pressed during it: out of the roll once he is up, out of the flip once he lands)
      if (r.queuedAttack && k > (r.air ? r.air[1] + 0.04 : 0.55)) {
        this.rollAttack();
        return this.hold(true);
      }
      if (r.t >= r.dur) {
        this.roll = null;
        if (r.clip && this.anim.isPlaying(r.clip)) this.anim.stop(0.18);
      }
      return this.hold(true);
    }
    if (this.react) {
      const r = this.react;
      r.t += dt;
      const pushDur = r.kind === 'down' ? 0.55 : r.kind === 'heavy' ? 0.55 : Math.min(0.3, r.dur);
      const k0 = Math.min(1, (r.t - dt) / pushDur);
      const k1 = Math.min(1, r.t / pushDur);
      const e = (x) => 1 - (1 - x) * (1 - x);
      const step = (e(k1) - e(Math.max(0, k0))) * r.dist;
      this.slide(r.push.x * step, r.push.z * step, 0.6, true);
      this.settle(dt);
      // flat on his back: Space springs him up in one move (the kip-up), else he gets up
      if (r.kind === 'down' && r.stage === 0 && r.t > 0.75 && p.jumpBuffer > 0 && this.anim.clipActions.mxKipUp) {
        p.jumpBuffer = 0;
        r.stage = 2;
        r.dur = r.t + 1.25;
        this.anim.play('mxKipUp', { at: 0.3, timeScale: 1.35, fadeIn: 0.12, fadeOut: 0.25, cancelOnMove: false, noLook: true, noFootIK: true });
        this.audio.play('whoosh', { volume: 0.5, rate: 1.15 });
        this.onEvent('kipUp', {});
      }
      if (r.kind === 'down' && r.stage === 0 && r.t > 1.2) {
        r.stage = 1;
        if (this.anim.clipActions.getUp) this.anim.play('getUp', { fadeIn: 0.25, fadeOut: 0.3, cancelOnMove: false, noLook: true, noFootIK: true, timeScale: 1.8 });
      }
      if (r.t >= r.dur) {
        this.react = null;
        if (r.kind === 'down' || this.anim.isPlaying('hitLight') || this.anim.isPlaying('hitHeavy') || (r.kind === 'heavy' && this.anim.isPlaying('dodgeBack')) || (r.clip?.startsWith('mx') && this.anim.isPlaying(r.clip))) this.anim.stop(0.25);
        if (this.armed) this.stance(4);
      }
      return this.hold(true);
    }
    if (this.blocking) {
      if (!this.canFight() && p.state !== 'ground') this.setBlock(false, true);
      else {
        // the guard turns to meet the nearest threat (a guard only stops what it faces)
        const t = this.lockTarget?.alive ? this.lockTarget : this.targets?.nearest(p.position, 5, p.yaw, Math.PI, (x) => x.enemy, p.feetY);
        if (t) p.yaw = dampAngle(p.yaw, Math.atan2(t.pos.x - p.position.x, t.pos.z - p.position.z), 10, dt);
        return this.hold();
      }
    }
    if (this.dash) {
      const D = this.dash;
      const t = D.tgt;
      D.t += dt;
      const dx = t.pos.x - p.position.x;
      const dz = t.pos.z - p.position.z;
      const dl = Math.hypot(dx, dz) || 1;
      const d = dl - (t.radius ?? 0.3) * 0.6;
      if (!t.alive || (!D.forced && !this.canFight()) || this.blocking) {
        this.dash = null;
        return false;
      }
      if (d <= D.need || D.t > D.max) {
        this.dash = null;
        if (D.forced) {
          this.forceMove(D.name, D.tgt, { ...D.forced, noDash: true });
          return this.hold();
        }
        this.start(D.name, true);
        if (D.queued && this.move) this.move.queued = true;
        return this.hold();
      }
      // quick strides straight at it (down the steps if it is below)
      const v = Math.min(7.2, 3 + D.t * 22);
      const step = Math.min(v * dt, d - D.need + 0.05);
      p.prevPosition.copy(p.position);
      p.prevYaw = p.yaw;
      p.yaw = dampAngle(p.yaw, Math.atan2(dx, dz), 16, dt);
      this.slide((dx / dl) * step, (dz / dl) * step, this.dropAllow(t), true);
      this.settle(dt);
      p.body.setNextKinematicTranslation(p.position);
      p.velocity.set((dx / dl) * v, 0, (dz / dl) * v);
      p.speed = v;
      return true;
    }
    const mv = this.move;
    if (!mv) {
      // the stance drops when we've been idle a while
      if (this.stanceUntil && this.time > this.stanceUntil && !this.armed && (this.anim.isPlaying('guard') || this.anim.isPlaying('swordStance'))) {
        this.stanceUntil = 0;
        this.anim.stop(0.4);
      }
      return false;
    }
    const m = MOVES[mv.name];
    let step = stopped ? dt * 0.06 : dt;
    // the blow's tempo (the clip's time is bent, its hits stay on their frames): the wind-up held a
    // touch, the strike snapping through to the contact, the follow-through held (anticipation,
    // speed, weight: the mocap's even pace reads soft)
    let tempo = 1;
    if (!mv.force && m.hits.length) {
      const c0 = mv.t * mv.ts;
      const h0 = m.hits[0].t;
      const h1 = m.hits[m.hits.length - 1].t;
      if (c0 < h0 - 0.17) tempo = 0.86;
      else if (c0 < h1 + 0.02) tempo = 1.45;
      else if (c0 < h1 + 0.24) tempo = 0.8;
    }
    step *= tempo;
    // Gathered Storm: the wind-up holds (the blade glows, the blow gathers) while the button is
    // down, up to a second; a charge of a third of a second or more makes it a charged blow
    if (mv.charging) {
      const ctNow = mv.t * mv.ts;
      if (this.heavyHeld && ctNow > 0.18 && ctNow < m.hits[0].t - 0.22 && mv.charge < 1.0) {
        mv.charge += dt;
        step *= 0.06;
        if (!mv.chargedFx && mv.charge > 0.35) {
          mv.chargedFx = true;
          this.audio.play('blade-draw', { volume: 0.8, rate: 1.35 });
          this.onEvent('charged', {});
        }
      } else if (ctNow > 0.18 || !this.heavyHeld) mv.charging = false;
      if (this.anim.cur) this.anim.cur.a.timeScale = mv.charging && ctNow > 0.18 ? mv.ts * 0.06 : mv.ts;
    } else if (this.anim.cur && this.anim.isPlaying(this.clipOf(mv.name))) this.anim.cur.a.timeScale = mv.ts * tempo;
    mv.t += step;
    const ct = mv.t * mv.ts; // clip time
    p.yaw = dampAngle(p.yaw, mv.yaw, 11, dt);
    p.speed = 0;
    // root motion: follow the clip's hip path, turned to our facing, through the controller
    const rm = this.rootMotion[this.clipOf(mv.name)];
    p.prevPosition.copy(p.position);
    p.prevYaw = p.yaw;
    if (rm) {
      const f = Math.min(rm.path.length / 2 - 1, ct * rm.fps);
      const i = Math.floor(f);
      const a = f - i;
      const j = Math.min(rm.path.length / 2 - 1, i + 1);
      const x = (rm.path[i * 2] * (1 - a) + rm.path[j * 2] * a - rm.path[0]) * LEG;
      const z = (rm.path[i * 2 + 1] * (1 - a) + rm.path[j * 2 + 1] * a - rm.path[1]) * LEG;
      // (the clip's path keeps the facing it started with; tracking turns the body, not the path)
      const c = Math.cos(mv.pathYaw ?? mv.yaw);
      const s = Math.sin(mv.pathYaw ?? mv.yaw);
      // the approach: eased in over the wind-up, along the line to the target
      const k = Math.min(1, ct / Math.max(0.2, m.hits[0].t));
      const ap = mv.approach * k * k * (3 - 2 * k);
      // tracking: an enemy that moves during the wind-up is followed (the facing turns with it
      // and the lunge carries its displacement), until the blow is on its way
      if (mv.tgt?.alive && ct < m.hits[0].t - 0.04) {
        mv.track.x = (mv.tgt.pos.x - mv.tgt0.x) * Math.min(1, k * 1.4);
        mv.track.z = (mv.tgt.pos.z - mv.tgt0.z) * Math.min(1, k * 1.4);
        const l = Math.hypot(mv.track.x, mv.track.z);
        const tmax = m.track ?? 2.2; // (a committed heavy cut follows less)
        if (l > tmax) (mv.track.x *= tmax / l), (mv.track.z *= tmax / l);
        mv.yaw = Math.atan2(mv.tgt.pos.x - p.position.x, mv.tgt.pos.z - p.position.z) - mv.la;
      }
      const wx = mv.start.x + x * c + z * s + Math.sin(mv.approachYaw) * ap + mv.track.x;
      const wz = mv.start.z - x * s + z * c + Math.cos(mv.approachYaw) * ap + mv.track.z;
      const dx = wx - p.position.x;
      const dz = wz - p.position.z;
      // never lunge off a step edge (unless the target stands below it)
      const aheadY = groundHeight(p.position.x + dx * 4, p.position.z + dz * 4);
      const drop = p.feetY - aheadY;
      const wet = aheadY < -0.45 && aheadY < p.feetY - 0.05; // (not into the river)
      if (drop < this.dropAllow(mv.tgt) && !wet && (dx || dz)) {
        _v.set(dx, 0, dz);
        p.kcc.computeColliderMovement(p.collider, _v, undefined, GROUPS.mover);
        const d = p.kcc.computedMovement();
        p.position.x += d.x;
        p.position.y += d.y;
        p.position.z += d.z;
      }
    }
    this.settle(dt);
    p.body.setNextKinematicTranslation(p.position);
    p.velocity.set(0, 0, 0);
    // the swing's whoosh, just before the strike
    const peak = m.hits[0].t;
    if (!mv.whoosh && ct > peak - 0.16) {
      mv.whoosh = true;
      this.audio.play(m.sword ? (m.heavy ? 'heavy-whoosh' : 'blade-whoosh') : 'whoosh', { volume: m.heavy ? 0.9 : 0.55, rate: (m.sword ? 1 : m.heavy ? 0.8 : 1) * (0.92 + Math.random() * 0.16) });
    }
    // chain: the next strike of the combo (or the heavy) at the cancel point
    const dur = this.anim.clipActions[this.clipOf(mv.name)]?.getClip().duration ?? 1.2;
    if (mv.force) {
      // a finisher's next beat, or its end
      const c = mv.opts?.chain;
      if (c && ct >= (c.at ?? m.cancel)) {
        this.forceMove(c.name, mv.force, c.opts || {});
        return true;
      }
      if (ct >= (mv.opts?.end ?? dur - 0.12)) {
        this.move = null;
        this.lastEnd = this.time;
        mv.opts?.onEnd?.();
      }
      return true;
    }
    if (ct >= m.cancel && (mv.queued || mv.queuedHeavy)) {
      if (!mv.queuedHeavy && (mv.i + 1) % this.comboList().length === 0) this.rounds++; // (round again)
      const list = this.comboList();
      const next = mv.queuedHeavy ? HEAVY[this.armed ? 'armed' : 'unarmed'] : list[(mv.i + 1) % list.length];
      this.combo = mv.queuedHeavy ? 0 : mv.i + 1;
      this.move = null;
      this.start(next);
      return true;
    }
    if (ct >= dur - 0.12) {
      this.move = null;
      this.lastEnd = this.time;
      this.combo = (mv.i + 1) % this.comboList().length;
      if (m.heavy || mv.name === HEAVY.unarmed) this.combo = 0;
      this.stance(this.armed ? 8 : 3);
    }
    return true;
  }

  /** The talwar in his fist: the wrist cocked, the fingers closed round the grip; the sword's
   *  transform (its guard: the origin of sword space) written to pos / quat. */
  gripPose(B, dt, pos, quat) {
    // the wrist cocks the fist forward over the knuckles (a relaxed hold leans the blade; a
    // thrust lays it along the arm): the wrist turns as far as a wrist does, and only past
    // that does the blade turn in the hand, so the hilt stays in the fist
    const want = this.move && MOVES[this.move.name].wrist ? MOVES[this.move.name].wrist : this.move ? 0.45 : 0.6;
    this.wristTilt += (want - this.wristTilt) * Math.min(1, dt * 10);
    const wrist = Math.min(this.wristTilt, 0.55);
    const h0 = B.hand.getWorldPosition(_v);
    const f0 = _f.subVectors(h0, B.fore.getWorldPosition(_t)).normalize();
    const across = _x3.subVectors(B.index1.getWorldPosition(_e3), B.pinky1.getWorldPosition(_t)).normalize();
    rotateWorld(B.hand, _e3.crossVectors(across, f0).normalize(), wrist);
    this.fist(B);
    // the grip: through the middle of the closed fingers, slanting across the palm from the
    // heel under the little finger to the index knuckle (as a hilt lies in a hand)
    const h = B.hand.getWorldPosition(_v);
    const f = _f.subVectors(h, B.fore.getWorldPosition(_t)).normalize();
    const k = _g1.set(0, 0, 0);
    const j = _g2.set(0, 0, 0);
    for (const ch of B.fingers) {
      k.add(ch[0].getWorldPosition(_t));
      j.add(ch[1].getWorldPosition(_t)).add(ch[2].getWorldPosition(_t));
    }
    k.multiplyScalar(1 / B.fingers.length);
    j.multiplyScalar(1 / (B.fingers.length * 2));
    const palm = _t.copy(h).lerp(k, 0.55);
    const grip = k.multiplyScalar(0.3).addScaledVector(j, 0.45).addScaledVector(palm, 0.25);
    const heel = _e3.copy(B.pinky1.getWorldPosition(_t)).lerp(h, 0.25);
    const up = _x3.subVectors(B.index1.getWorldPosition(_t), heel).normalize(); // sword +Y: out above the index finger
    const edge = _w.copy(f).addScaledVector(up, -f.dot(up)).normalize();
    const side = _t.crossVectors(up, edge).normalize();
    edge.crossVectors(side, up).normalize();
    _m4.makeBasis(side, up, edge);
    quat.setFromRotationMatrix(_m4);
    if (this.wristTilt > wrist) quat.multiply(_hangQ.setFromAxisAngle(_e3.set(1, 0, 0), this.wristTilt - wrist));
    // the guard sits on the fist: the grip's middle (5.5 cm under the guard) in the fist's middle
    pos.copy(grip).addScaledVector(_e3.set(0, 1, 0).applyQuaternion(quat), 0.055);
  }

  /**
   * Drawing or sheathing by hand (this.drawing: { t, dur, draw }): the right arm reaches across
   * to the hilt at his left hip (two-bone IK), the blade slides along the scabbard's line, then
   * eases into (or out of) his fist's own hold.
   */
  drawStep(B, dt) {
    const D = this.drawing;
    const p = this.p;
    if (this.roll || this.react || this.dead || p.state !== 'ground') return this.endDrawing();
    D.t += dt;
    const k = Math.min(1, D.t / D.dur);
    const ss = (a, b, x) => {
      const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const sheathQ = this.scabbard.quaternion;
    const along = _dA.set(0, 1, 0).applyQuaternion(sheathQ); // into the scabbard, toward its tip
    const slidePose = (out, pos, quat) => {
      quat.copy(sheathQ);
      pos.copy(this.scabbard.position).addScaledVector(along, -out);
    };
    const OUT = 0.86; // the blade's length and a little: clear of the mouth
    let ik = 0;
    let out = 0;
    let toHand = 0; // 0: the blade in the scabbard's line, 1: in the fist's own hold
    if (D.draw) {
      ik = k < 0.38 ? ss(0, 0.38, k) : 1 - ss(0.72, 1, k);
      out = ss(0.38, 0.72, k) * OUT;
      toHand = ss(0.72, 1, k);
      if (!D.flipped && k >= 0.38) {
        D.flipped = true;
        this.armed = true;
        this.audio.play('blade-draw', { volume: 0.75 });
        this.stance(6);
      }
    } else {
      ik = k < 0.32 ? ss(0, 0.32, k) : 1 - ss(0.68, 1, k);
      out = (1 - ss(0.32, 0.68, k)) * OUT;
      toHand = 1 - ss(0, 0.32, k);
      if (!D.flipped && k >= 0.66) {
        D.flipped = true;
        this.armed = false;
        this.audio.play('blade-sheathe', { volume: 0.8 });
      }
    }
    // where the blade is: along the scabbard's line, blended into the fist's hold
    slidePose(out, _dP, _dQ);
    let fisted = false; // (the fingers close once a frame: a second fist() would curl them twice)
    if (this.armed && toHand > 0) {
      this.gripPose(B, dt, _dP2, _dQ2);
      fisted = true;
      _dP.lerp(_dP2, toHand);
      _dQ.slerp(_dQ2, toHand);
    }
    if (ik > 0.001) {
      // the hand to the grip of that blade (the wrist sits ~7 cm short of the grip's middle)
      const grip = _dG.set(0, -0.055, 0).applyQuaternion(_dQ).add(_dP);
      const fore = _dF.subVectors(B.hand.getWorldPosition(_dH), B.fore.getWorldPosition(_dF2)).normalize();
      const wrist = _dW.copy(grip).addScaledVector(fore, -0.07);
      const yaw = p.yaw;
      const pole = _dPole.set(-Math.cos(yaw) * 0.5 - Math.sin(yaw) * 0.3, -0.7, Math.sin(yaw) * 0.5 - Math.cos(yaw) * 0.3);
      solveTwoBone(B.upper, B.fore, B.hand, wrist, pole, ik);
      // the hand turned to hold it: knuckles along the grip
      const heel = _dH.copy(B.pinky1.getWorldPosition(_dH)).lerp(B.hand.getWorldPosition(_dF2), 0.25);
      const across = _dF.subVectors(B.index1.getWorldPosition(_dF2), heel).normalize();
      const want = _dF2.set(0, 1, 0).applyQuaternion(_dQ);
      const ang = Math.acos(Math.max(-1, Math.min(1, across.dot(want))));
      if (ang > 1e-3) rotateWorld(B.hand, across.cross(want).normalize(), Math.min(ang, 1.4) * ik);
      if (!fisted) this.fist(B);
    } else if (this.armed && !fisted) this.fist(B);
    this.sword.position.copy(this.armed || out > 0 ? _dP : this.scabbard.position);
    this.sword.quaternion.copy(this.armed || out > 0 ? _dQ : sheathQ);
    if (k >= 1) this.drawing = null;
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
      upper: find('RightArm'),
      mid: find('RightHandMiddle1'),
      thumb: find('RightHandThumb1'),
      thumb2: find('RightHandThumb2'),
      thumb3: find('RightHandThumb3'),
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
        // a sword grip: the knuckles bent hard, the middle joints most, the tips less
        rotateWorld(bone, axis, this.curlSign * GRIP_CURL[chain.indexOf(bone)]);
        bone.updateWorldMatrix(false, true);
      }
    }
    // the thumb round the front of the grip, over the index finger's middle bone
    if (B.thumb2 && B.thumb3 && B.fingers[0][1]) {
      const over = B.fingers[0][1].getWorldPosition(_g1);
      aimBone(B.thumb, B.thumb2, _g2.lerpVectors(B.fingers[0][0].getWorldPosition(_g2), over, 0.6), 0.9);
      aimBone(B.thumb2, B.thumb3, over, 0.9);
    }
  }

  hold(moved = false) {
    const p = this.p;
    if (!moved) {
      p.prevPosition.copy(p.position);
      p.prevYaw = p.yaw;
    }
    p.body.setNextKinematicTranslation(p.position);
    p.velocity.set(0, 0, 0);
    p.speed = 0;
    return true;
  }

  // ------------------------------------------------------------ per rendered frame (after the pose)
  late(dt) {
    const p = this.p;
    // the flinch: a damped spring on the chest and head, over whatever the clip does
    const F = this.flinch;
    F.vel += (-90 * F.amt - 13 * F.vel) * dt;
    F.amt += F.vel * dt;
    if (!this.spine) {
      const root = this.anim.loco?.root || this.anim.root;
      const find = (n) => {
        let b = null;
        root?.traverse?.((o) => !b && o.isBone && o.name.endsWith(n) && (b = o));
        return b;
      };
      this.spine = ['Spine', 'Spine1', 'Spine2', 'Neck', 'Head'].map(find);
    }
    // the head follows the chest on a looser spring: it lags, then whips past
    F.headVel += (60 * (F.amt * 1.5 - F.head) - 7 * F.headVel) * dt;
    F.head += F.headVel * dt;
    if (Math.abs(F.amt) > 0.002 || Math.abs(F.vel) > 0.02 || Math.abs(F.head) > 0.004) {
      const w = [0.3, 0.42, 0.48, 0.18, 0];
      this.spine.forEach((b, i) => b && w[i] && rotateWorld(b, F.axis, F.amt * w[i]));
      if (this.spine[4]) rotateWorld(this.spine[4], F.axis, F.head * 0.42);
      // the arms are flung out and back with the blow
      if (!this.arms) {
        const root = this.anim.loco?.root || this.anim.root;
        const find = (n) => {
          let b = null;
          root?.traverse?.((o) => !b && o.isBone && o.name.endsWith(n) && (b = o));
          return b;
        };
        this.arms = [find('LeftArm'), find('RightArm')];
      }
      const fl = Math.min(0.5, Math.abs(F.amt));
      _ax.set(Math.sin(p.yaw), 0, Math.cos(p.yaw)); // his forward
      if (this.arms[0]) rotateWorld(this.arms[0], _ax, -fl * 0.9);
      if (this.arms[1]) rotateWorld(this.arms[1], _ax, fl * 0.9);
      if (this.arms[0]) rotateWorld(this.arms[0], F.axis, F.amt * 0.5);
      if (this.arms[1]) rotateWorld(this.arms[1], F.axis, F.amt * 0.5);
    } else F.amt = F.vel = F.head = F.headVel = 0;
    // a strike up or down the steps: the chest bends toward the target, so the blade crosses a
    // shade standing two steps below at its body, not over its head
    const am = this.move;
    let pitch = 0;
    if (am?.tgt?.alive) {
      const t = am.tgt;
      const d = Math.max(0.7, Math.hypot(t.pos.x - p.position.x, t.pos.z - p.position.z));
      const dy = t.pos.y + (t.height ?? 1.8) * 0.5 - (p.feetY + 1.2);
      pitch = Math.max(-0.8, Math.min(0.35, Math.atan2(dy, d)));
      const m = MOVES[am.name];
      const ct = am.t * am.ts;
      // in over the wind-up, out over the follow-through
      pitch *= Math.min(1, ct / 0.25) * (1 - Math.max(0, Math.min(1, (ct - m.hits[m.hits.length - 1].t - 0.12) / 0.3)));
    }
    this.aimPitch += (pitch - this.aimPitch) * Math.min(1, dt * 12);
    if (Math.abs(this.aimPitch) > 0.004 && this.spine[0]) {
      // about his right-hand axis: a negative pitch bows him forward
      _ax.set(-Math.cos(p.yaw), 0, Math.sin(p.yaw));
      [0.4, 0.35, 0.25].forEach((w, i) => this.spine[i] && rotateWorld(this.spine[i], _ax, -this.aimPitch * w));
    }
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
      if (this.drawing && B.hand && B.fore && B.upper && B.index1 && B.pinky1) {
        this.drawStep(B, dt);
      } else if (this.armed && !this.handBusy && B.hand && B.fore && B.thumb && B.index1 && B.pinky1) {
        this.gripPose(B, dt, this.sword.position, this.sword.quaternion);
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
    this.trail.update(dt, _base, _tip, live && mv.t * mv.ts > m.hits[0].t - 0.22 && mv.t * mv.ts < m.hits[m.hits.length - 1].t + 0.18);
    if (!m || !this.targets) {
      this.prevBlade = null;
      return;
    }
    const ct = mv.t * mv.ts;
    // the clip time covered since the last frame: a slow frame can't step over the strike
    const ct0 = mv.ctPrev ?? ct;
    mv.ctPrev = ct;
    const pb = this.prevBlade;
    if (owned && this.armed) this.prevBlade = { base: _base.clone(), tip: _tip.clone(), mv };
    // the blow's light (VFX.js): the blade's trail through a cut, an arc of air behind a kick
    if (this.vfx && m.hits.length) {
      const t0 = m.hits[0].t - (m.kick ? 0.24 : 0.2);
      const t1 = m.hits[m.hits.length - 1].t + 0.1;
      if (ct >= t0 && ct <= t1) {
        if (owned && this.armed && m.sword) {
          const fire = m.heavy || mv.chargedFx;
          this.vfx.trail('blade', _base, _tip, fire ? { color: [2.6, 0.7, 0.12], core: [3.0, 1.7, 0.5] } : { color: [2.0, 1.05, 0.3], core: [2.7, 1.9, 0.8] });
        } else if (m.kick) {
          const h = m.hits.find((x) => ct <= x.t + 0.1) || m.hits[0];
          const side = (h.limb || 'RightFoot').startsWith('Left') ? 'Left' : 'Right';
          const knee = this.anim.boneWorld(`${side}Leg`, _kn);
          const foot = this.anim.boneWorld(`${side}ToeBase`, _ft) || this.anim.boneWorld(`${side}Foot`, _ft);
          if (knee && foot) this.vfx.trail(`kick${side}`, knee, foot, { color: [1.6, 0.95, 0.4], core: [2.3, 1.6, 0.8] });
        }
      }
    }
    // a finisher's blow lands on its target at the clip's moment, wherever the blade is
    if (mv.force) {
      m.hits.forEach((h, hi) => {
        if (mv.struck.has(hi) || ct < h.t) return;
        mv.struck.add(hi);
        const t = mv.force;
        const at = h.blade && this.armed ? _w.lerpVectors(_base, _tip, 0.6).clone() : this.anim.boneWorld(h.limb || 'RightHand', new THREE.Vector3()) || new THREE.Vector3(t.pos.x, t.pos.y + 1.2, t.pos.z);
        mv.opts?.onHit?.(hi, at, h);
        this.hitStop = h.k > 1.2 ? 0.1 : 0.06;
      });
      return;
    }
    m.hits.forEach((h, hi) => {
      if (mv.struck.has(hi) || ct < h.t - WINDOW || ct0 > h.t + WINDOW) return;
      const pts = [];
      if (h.blade && this.armed) {
        // the blade swept between last frame and this one (a fast cut crosses a body in a frame)
        const sub = pb && pb.mv === mv ? 4 : 1;
        for (let si = 1; si <= sub; si++) {
          const a = si / sub;
          const b0 = sub > 1 ? _sw0.lerpVectors(pb.base, _base, a) : _base;
          const t0 = sub > 1 ? _sw1.lerpVectors(pb.tip, _tip, a) : _tip;
          for (const k of [0.1, 0.4, 0.7, 1.0]) pts.push(_w.lerpVectors(b0, t0, k).clone());
        }
      } else {
        const b = this.anim.boneWorld(h.limb, new THREE.Vector3());
        if (b) pts.push(b);
      }
      for (const pt of pts) {
        const t = this.targets.touching(pt, h.blade ? 0.08 : 0.14);
        if (!t) {
          // a pot, a lota, a basket in the way of the blow: it goes flying (a matka breaks)
          const pr = this.props?.touching(pt, h.blade ? 0.08 : 0.14);
          if (pr) {
            mv.struck.add(hi);
            this.props.strike(pr, { x: pr.x - p.position.x, z: pr.z - p.position.z }, h.k, { sword: !!h.blade, heavy: !!m.heavy, kick: !!m.kick });
            this.hitStop = 0.03;
            break;
          }
          continue;
        }
        mv.struck.add(hi);
        const dir = { x: t.pos.x - p.position.x, z: t.pos.z - p.position.z };
        const heavy = !!m.heavy || mv.name === HEAVY.unarmed;
        const charged = !!mv.chargedFx;
        // the way the edge was travelling (a cut from his right turns the body the other way)
        const sweep = h.blade && this.armed && pb && pb.mv === mv ? { x: _tip.x - pb.tip.x, z: _tip.z - pb.tip.z } : null;
        // the last blow of a full combo (its final hit, for a move with more than one)
        const list = this.comboList();
        const final = !heavy && mv.i !== undefined && list.length > 1 && mv.i % list.length === list.length - 1 && hi === m.hits.length - 1;
        const res = t.hit({ k: h.k * (charged ? 1.25 : 1), dir, at: pt, sweep, sword: !!h.blade, heavy, kick: !!m.kick, move: mv.name, combo: mv.i, final, riposte: !!mv.riposte, charged });
        // where it bit: steel throws sparks, a heavy blow a flash
        if (this.vfx && t.enemy) {
          const l = Math.hypot(dir.x, dir.z) || 1;
          if (h.blade) this.vfx.sparks(pt, { x: dir.x / l, y: 0.25, z: dir.z / l }, heavy ? 22 : 11, { speed: heavy ? 9 : 6.5, color: [3, 1.5, 0.45] });
          if (heavy || final || charged) this.vfx.flash(pt, heavy ? 0.8 : 0.55, { color: [2.2, 1.2, 0.45], life: 0.12 });
          // the big blows: an anime slash mark across the cut, a star flare where it bit (Fab)
          if (h.blade && (heavy || final)) this.vfx.slashMark(pt, heavy ? 1.5 : 1.2, { rot: (Math.random() - 0.5) * 1.4 + (mv.i % 2 ? 0.5 : -0.5) });
          if (heavy || charged) this.vfx.flare(pt, 1.1, { kind: 'flareImpact', life: 0.14, color: [2.4, 1.5, 0.7] });
        }
        if (res === 'blocked') {
          // the Kavacha's shield: the blow rings off it and throws his arm back
          const l = Math.hypot(dir.x, dir.z) || 1;
          const away = { x: -dir.x / l, z: -dir.z / l };
          this.move = null;
          this.lastEnd = this.time;
          this.anim.stop(0.12);
          this.react = { kind: 'block', t: 0, dur: 0.36, push: away, dist: 0.3 };
          this.flinchHit(away, 0.55);
          this.hitStop = 0.08;
          this.onEvent('shielded', {});
          break;
        }
        // the hit-stop, by weight: a light cut a blink, a heavy one a held beat
        this.hitStop = (heavy || m.kick ? 0.115 : h.k > 1.2 ? 0.09 : 0.065) + (mv.riposte || charged ? 0.06 : 0);
        // the last cut of a combo and a killing blow are held a beat longer
        if (final) this.hitStop += 0.05;
        if (res === 'killed') this.hitStop += 0.06;
        t.freeze?.(this.hitStop * 1.1);
        if (!t.enemy) this.audio.play(h.blade ? 'blade-hit' : 'thump', { volume: 0.5 + h.k * 0.3, rate: 0.9 + Math.random() * 0.2, at: pt });
        this.onEvent('hit', { move: mv.name, heavy, sword: !!h.blade, kick: !!m.kick, target: t.kind, enemy: !!t.enemy, k: h.k, riposte: !!mv.riposte, charged, killed: res === 'killed', final, at: pt, dir });
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

/** A blow caught on the guard: a heavy knock with a short metallic ring (steel on steel / bronze). */
export function synthBlock(ctx) {
  return noiseBuf(ctx, 0.6, (d, sr, n) => {
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const w = Math.random() * 2 - 1;
      lp += (w - lp) * 0.5;
      const knock = Math.sin(2 * Math.PI * (180 - 90 * t) * t) * Math.exp(-t * 30) * 0.8 + lp * Math.exp(-t * 60) * 0.6;
      const ring = [1180, 1795, 2630, 3410].reduce((a, f, k) => a + Math.sin(2 * Math.PI * f * t + k) * (0.5 / (k + 1)), 0) * Math.exp(-t * 9) * 0.22;
      d[i] = knock + ring;
    }
  });
}

/** A perfect guard: a bright ringing glance, longer than a block, with a shimmer on top. */
export function synthParry(ctx) {
  return noiseBuf(ctx, 1.4, (d, sr, n) => {
    let hp = 0;
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const w = Math.random() * 2 - 1;
      hp = 0.82 * (hp + w - prev);
      prev = w;
      const scrape = hp * Math.exp(-t * 25) * 0.5;
      const ring = [2210, 3315, 4870, 6620, 8130].reduce((a, f, k) => a + Math.sin(2 * Math.PI * f * t * (1 + 0.002 * Math.sin(t * 30))) / (k + 1.2), 0) * Math.exp(-t * 3.2) * 0.2;
      d[i] = scrape + ring;
    }
  });
}

/** The parry cue: a thin bright glint of light off a claw (a tiny high shimmer, swelling in). */
export function synthGlint(ctx) {
  return noiseBuf(ctx, 0.42, (d, sr, n) => {
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const env = Math.min(1, t * 90) * Math.exp(-t * 9);
      const sh = [5280, 7040, 9390].reduce((a, f, k) => a + Math.sin(2 * Math.PI * f * t * (1 + 0.004 * Math.sin(t * 44 + k))) / (k + 1), 0);
      d[i] = sh * env * 0.16;
    }
  });
}

/** A blow landing on a body: a dull, low thud with a slap of skin. */
export function synthBodyHit(ctx) {
  return noiseBuf(ctx, 0.3, (d, sr, n) => {
    let lp = 0;
    let lp2 = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const w = Math.random() * 2 - 1;
      lp += (w - lp) * 0.22;
      lp2 += (lp - lp2) * 0.22;
      const thud = Math.sin(2 * Math.PI * (70 - 25 * t) * t) * Math.exp(-t * 18);
      d[i] = thud * 0.95 + lp2 * Math.exp(-t * 40) * 1.6 + w * Math.exp(-t * 160) * 0.25;
    }
  });
}
