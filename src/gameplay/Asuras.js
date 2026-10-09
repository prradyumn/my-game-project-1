import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { GROUPS } from '../core/Physics.js';
import { clamp, damp, dampAngle, wrapAngle } from '../utils/math.js';
import { solveTwoBone } from '../utils/bones.js';
import { AsuraEyes, AsuraParticles, asuraMaterial, hornMaterial, hornsGeometry } from '../world/AsuraLook.js';
import { bankCoords, frameAtX, ghatToWorld, groundHeight, PROFILE_LEN, segmentForX } from '../world/WorldLayout.js';

// The Asuras: darkness that rises out of the river at night and walks up the ghats. Each is a
// skinned body in an ember-veined obsidian skin (AsuraLook.js) with a small mind:
//
//   rise     walks up the drowned steps out of the Ganga, burning into being
//   stalk    closes in;  circle  paces round Prady at a few metres, waiting its turn
//   approach closes to striking range once the pack lets it attack (two at a time at most)
//   attack   a telegraphed blow (the eyes flare), a hit window, then a moment off-balance
//   stagger  poise broken by blows, or a strike parried: reels, open to punishment
//   dead     falls and burns away into embers
//
// Their blows go through Combat.receive(): dodged, parried, blocked or taken. Prady's blows on
// them arrive through the Targets registry (hit()).

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const DOWN = { x: 0, y: -1, z: 0 };
const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();

// the kinds of Asura: body, size, toughness, how they fight
export const ASURA_KINDS = {
  shade: { label: 'Asura', scale: 1.1, hp: 60, poise: 50, speed: 1.6, run: 3.6, ring: [3.4, 4.6], dmg: 0.72, attacks: ['swipe', 'lunge', 'swipe', 'smash'], smoke: 1 },
  brute: { label: 'Rakshasa', scale: 1.32, hp: 140, poise: 110, speed: 1.3, run: 2.9, ring: [3.8, 5.2], dmg: 1.2, attacks: ['smash', 'swipe', 'smash'], smoke: 1.4 },
  boss: { label: 'Andhaka', scale: 3.0, hp: 760, poise: 360, speed: 1.15, run: 2.4, ring: [5.5, 7.5], dmg: 0.65, attacks: ['sweep', 'smash', 'lunge'], smoke: 3, boss: true },
};

// attacks: clip role, when the blow lands (fraction of the clip), reach (m, x scale), arc (rad
// either side of facing), damage, a lunge (m) carried through the wind-up, telegraph glow time
const ATTACKS = {
  swipe: { clip: 'attackA', hit: 0.48, reach: 1.75, arc: 1.15, dmg: 9, lunge: 0.7, speed: 1.0 },
  lunge: { clip: 'attackB', hit: 0.49, reach: 2.2, arc: 0.7, dmg: 12, lunge: 1.9, speed: 0.95 },
  smash: { clip: 'heavy', hit: 0.52, reach: 2.0, arc: 0.9, dmg: 20, lunge: 0.6, heavy: true, speed: 0.9 },
  sweep: { clip: 'attackA', hit: 0.5, reach: 2.4, arc: 1.6, dmg: 20, lunge: 0.4, heavy: true, speed: 0.8 },
  stomp: { clip: 'heavy', hit: 0.52, reach: 3.2, arc: Math.PI, dmg: 26, lunge: 0, heavy: true, unblockable: true, speed: 0.75, shock: true },
};

// ---------------------------------------------------------------- one Asura
export class Asura {
  constructor(sys, kindName, at, opts = {}) {
    this.sys = sys;
    this.kindName = kindName;
    this.K = ASURA_KINDS[kindName];
    const K = this.K;
    this.kind = K.boss ? 'boss' : 'asura';
    this.enemy = true;
    this.alive = true;
    this.awake = true;
    this.name = opts.name || K.label;
    this.scale = K.scale * (opts.scale || 1);
    this.reachK = this.scale > 2 ? 1.5 : Math.sqrt(this.scale); // (a giant's arms: not three times a man's reach)
    this.wadeDepth = 0.45 * this.scale; // how deep it will walk into the river (knee-deep: Andhaka's knees are high)
    this.maxHp = K.hp * (opts.hpMul || 1);
    this.hp = this.maxHp;
    this.poise = K.poise;
    this.radius = 0.38 * this.scale;
    this.height = 1.75 * this.scale;
    this.pos = new THREE.Vector3(at.x, at.y, at.z);
    this.yaw = at.yaw ?? 0;
    this.vel = new THREE.Vector3();
    this.state = opts.rise === false ? 'stalk' : 'rise';
    this.t = 0;
    this.stateT = 0;
    this.token = false;
    this.cool = 1 + Math.random() * 1.5;
    this.circleDir = Math.random() < 0.5 ? 1 : -1;
    this.ring = K.ring[0] + Math.random() * (K.ring[1] - K.ring[0]);
    this.attack = null;
    this.hurt = 0;
    this.lastHitT = -9;
    this.shownHp = 1;
    this.barT = 0;
    this.smokeT = 0;
    this.growlT = 3 + Math.random() * 5;
    this.rage = 0;
    this.onDeath = opts.onDeath || null;
    this.goal = opts.goal || null; // a point to walk to while rising (the ghat edge)

    // body
    const B = sys.makeBody(this.scale, K.boss);
    this.body = B;
    this.uniforms = B.uniforms;
    this.uniforms.uDissolve.value = this.state === 'rise' ? 1 : 0;
    sys.scene.add(B.holder);
    B.holder.position.copy(this.pos);
    // physics: a kinematic capsule (Prady can't walk through it) moved by a character controller
    const R = sys.physics.RAPIER;
    const hh = Math.max(0.1, this.height / 2 - this.radius);
    this.rb = sys.physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(this.pos.x, this.pos.y + hh + this.radius, this.pos.z));
    this.col = sys.physics.world.createCollider(R.ColliderDesc.capsule(hh, this.radius).setCollisionGroups(GROUPS.people), this.rb);
    this.kcc = sys.physics.world.createCharacterController(0.02);
    this.kcc.enableAutostep(0.4 * Math.min(1.6, this.scale), 0.1, false);
    this.kcc.enableSnapToGround(0.6);
    this.kcc.setMaxSlopeClimbAngle((55 * Math.PI) / 180);
    this.kcc.setSlideEnabled(true);
    this.halfH = hh + this.radius;
    this.play('idle', 0);
  }

  // ---------------------------------------------------------------- the Targets interface
  touch(p, reach) {
    if (!this.alive || this.uniforms.uDissolve.value > 0.45) return false;
    const h = p.y - this.pos.y;
    if (h < -0.05 || h > this.height + 0.22) return false;
    return Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < this.radius * (h > this.height * 0.8 ? 0.9 : 1.3) + reach;
  }

  lockPoint(out) {
    return out.set(this.pos.x, this.pos.y + this.height * 0.66, this.pos.z);
  }

  /** Prady's blow: { k, dir, at, sword, heavy, kick } */
  hit(h) {
    if (!this.alive) return;
    const sys = this.sys;
    const dmg = (h.sword ? 15 : 7) * h.k * (h.heavy ? 1.35 : 1) * (this.state === 'stagger' ? 1.5 : 1);
    this.hp -= dmg;
    this.hurt = 1;
    this.lastHitT = this.t;
    this.barT = 4;
    this.poise -= (h.heavy ? 55 : 22) * h.k * (h.sword ? 1.2 : 1);
    const l = Math.hypot(h.dir.x, h.dir.z) || 1;
    const dir = { x: h.dir.x / l, z: h.dir.z / l };
    sys.particles.emitEmbers(h.at.x, h.at.y, h.at.z, h.sword ? 26 : 14, dir, h.heavy ? 1.4 : 1);
    sys.audio.play(h.sword ? 'blade-hit' : 'hurt', { at: h.at, volume: 0.7 + h.k * 0.2, rate: (h.sword ? 0.85 : 0.75) + Math.random() * 0.15 });
    sys.audio.play('ember-hiss', { at: h.at, volume: 0.5, rate: 0.9 + Math.random() * 0.2 });
    this.knock = { x: dir.x, z: dir.z, d: (h.heavy ? 0.9 : 0.35) / Math.sqrt(this.scale), t: 0 };
    this.flinch = { axis: new THREE.Vector3(dir.z, 0, -dir.x), amt: 0, vel: (h.heavy ? 8 : 5.6) / Math.sqrt(this.scale), head: this.flinch?.head || 0, headVel: this.flinch?.headVel || 0 };
    if (this.hp <= 0) return this.die(dir);
    // the rest of the pack gives him a beat: a landed blow is his moment
    sys.holdAttacks(0.45);
    // a broken poise staggers it; a shade caught winding up is knocked out of its blow
    const windingUp = this.state === 'attack' && !this.struck;
    if (this.poise <= 0) {
      this.poise = this.K.poise;
      this.stagger(this.K.boss ? 1.3 : 1.1);
    } else if (windingUp && (this.kindName === 'shade' || h.heavy) && !this.K.boss) {
      this.stagger(0.6);
    } else if (this.state === 'rise' && this.uniforms.uDissolve.value < 0.3) this.setState('stalk');
    // any blow stuns for a moment: no new attack begins inside it
    this.stunUntil = this.t + (this.K.boss ? 0.2 : h.heavy ? 0.7 : 0.42);
  }

  /** Prady's perfect guard turned this blow aside. */
  parried() {
    if (!this.alive) return;
    this.poise -= this.K.poise * 0.6;
    this.stagger(this.K.boss ? 1.1 : 1.6);
    this.sys.particles.emitEmbers(this.pos.x, this.pos.y + this.height * 0.6, this.pos.z, 30, null, 1.2);
  }

  stagger(secs) {
    this.attack = null;
    this.releaseToken();
    this.setState('stagger');
    this.staggerFor = secs;
    this.play(this.has('stagger') ? 'stagger' : this.has('hit') ? 'hit' : 'idle', 0.08, { once: true });
  }

  die(dir) {
    this.alive = false;
    this.releaseToken();
    this.setState('dead');
    this.deathDir = dir || { x: 0, z: 0 };
    this.play(this.has('death') ? 'death' : this.has('stagger') ? 'stagger' : 'idle', 0.1, { once: true, clamp: true });
    this.sys.audio.play('asura-death', { at: this.pos, volume: this.K.boss ? 1 : 0.8, rate: this.K.boss ? 0.6 : 0.9 + Math.random() * 0.2, ref: 12 });
    this.sys.onKilled(this);
    this.onDeath?.(this);
  }

  // ---------------------------------------------------------------- animation
  has(role) {
    return !!this.body.actions[role];
  }

  /** Cross-fade to a role (S-curve), optionally once (clamped at the end). */
  play(role, fade = 0.25, { once = false, clamp = false, speed = 1 } = {}) {
    const B = this.body;
    const a = B.actions[role] || B.actions.idle;
    if (!a) return;
    const dir = B.reversed[role] ? -1 : 1;
    if (B.cur === a && !once) {
      a.timeScale = speed * dir;
      return;
    }
    a.reset();
    a.enabled = true;
    a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    a.clampWhenFinished = once || clamp;
    a.timeScale = speed * dir;
    a.play();
    if (dir < 0) a.time = a.getClip().duration;
    if (B.cur && B.cur !== a) B.cur.crossFadeTo(a, fade, false);
    else a.setEffectiveWeight(1);
    B.cur = a;
    B.curRole = role;
  }

  clipTime() {
    const a = this.body.cur;
    return a ? a.time / a.getClip().duration : 0;
  }

  // ---------------------------------------------------------------- mind
  setState(s) {
    this.state = s;
    this.stateT = 0;
  }

  releaseToken() {
    if (this.token) this.sys.tokens--;
    this.token = false;
  }

  update(dt) {
    const sys = this.sys;
    this.t += dt;
    this.stateT += dt;
    const P = sys.player.position;
    const dx = P.x - this.pos.x;
    const dz = P.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const toP = Math.atan2(dx, dz);
    const K = this.K;
    let want = { x: 0, z: 0 };
    let speed = 0;
    let face = null;
    const playerDown = sys.combat.dead || sys.health.dead;
    this.cool -= dt;
    this.hurt = Math.max(0, this.hurt - dt * 4);
    this.poise = Math.min(K.poise, this.poise + dt * K.poise * (K.boss ? 0.05 : 0.12));

    switch (this.state) {
      case 'rise': {
        // walk up out of the river toward the goal (or Prady), burning into being
        const g = this.goal || P;
        const gx = g.x - this.pos.x;
        const gz = g.z - this.pos.z;
        const gl = Math.hypot(gx, gz) || 1;
        want = { x: gx / gl, z: gz / gl };
        speed = K.speed * 0.8;
        face = Math.atan2(gx, gz);
        this.uniforms.uDissolve.value = Math.max(0, 1 - this.stateT / (K.boss ? 3.2 : 2.2));
        const wet = sys.water.heightAt(this.pos.x, this.pos.z) - this.pos.y;
        if (wet > 0.2 && Math.random() < dt * 8) sys.fx.spray(this.pos.x + (Math.random() - 0.5) * this.radius * 2, sys.water.heightAt(this.pos.x, this.pos.z), this.pos.z + (Math.random() - 0.5) * this.radius * 2);
        if (this.uniforms.uDissolve.value <= 0 && (wet < 0.15 || this.stateT > 8) && (gl < 2.5 || dist < 9 || this.stateT > 6)) this.setState('stalk');
        this.locomote(speed);
        break;
      }
      case 'stalk':
      case 'circle': {
        if (playerDown) {
          // stand over him and roar (once); when he's gone, wait
          speed = 0;
          face = toP;
          if (!this.gloated && this.has('roar') && dist < 12) {
            this.gloated = true;
            this.play('roar', 0.3, { once: true, clamp: true });
          }
          this.locomote(0);
          break;
        }
        this.gloated = false;
        if (this.state === 'stalk' && dist < this.ring + 0.6) this.setState('circle');
        if (this.state === 'circle' && dist > this.ring + 2.5) this.setState('stalk');
        if (this.state === 'stalk') {
          want = { x: dx / dist, z: dz / dist };
          speed = dist > 9 ? K.run : K.speed;
          face = toP;
        } else {
          // pace round him: tangent + a pull in when he backs off. It never backs away from him
          // (a ring held both ways kites: he could never reach it); only when right on top of
          // him does it give a little ground
          const tx = -dz / dist;
          const tz = dx / dist;
          const close = dist < 2.4 * Math.sqrt(this.scale);
          const radial = dist > this.ring ? (dist - this.ring) * 0.8 : dist < 1.2 * this.scale ? -0.6 : 0;
          const pace = close ? 0.25 : 1;
          want = { x: tx * this.circleDir * pace + (dx / dist) * radial, z: tz * this.circleDir * pace + (dz / dist) * radial };
          const wl = Math.hypot(want.x, want.z);
          if (wl > 1e-3) {
            want.x /= wl;
            want.z /= wl;
          }
          speed = K.speed * (close ? 0.35 : 0.65) * Math.min(1, wl * 1.5);
          // face him when he's in its face
          if (close) face = toP;
          if (!close) face = sys.hasStrafe(this) ? toP : Math.atan2(want.x, want.z);
          if (Math.random() < dt * 0.25) this.circleDir *= -1;
          // up close and its turn is near: strike sooner
          if (close && this.cool > 0.4) this.cool -= dt;
          if (this.stateT > 1.2 && this.cool <= 0 && this.t > (this.stunUntil ?? 0) && sys.requestToken(this)) this.setState('approach');
        }
        // a growl now and then
        this.growlT -= dt;
        if (this.growlT < 0) {
          this.growlT = 4 + Math.random() * 7;
          sys.audio.play('asura-growl', { at: this.pos, volume: K.boss ? 1 : 0.55, rate: (K.boss ? 0.55 : 0.85) + Math.random() * 0.25, ref: K.boss ? 30 : 10 });
        }
        this.locomote(speed);
        break;
      }
      case 'approach': {
        const atk = ATTACKS[this.pickAttack(dist)];
        const reach = atk.reach * this.reachK + 0.3;
        if (playerDown || this.t < (this.stunUntil ?? 0)) {
          this.releaseToken();
          this.setState('circle');
          break;
        }
        // he stands up the steps: climb closer before swinging (a claw only reaches his legs)
        const climb = Math.max(0, sys.player.feetY - this.pos.y - 0.45 * this.scale);
        if (dist <= Math.max(this.radius + 0.6, reach + atk.lunge * 0.6 - climb * 1.4)) {
          this.beginAttack(atk);
          break;
        }
        want = { x: dx / dist, z: dz / dist };
        speed = dist > 4 ? K.run : K.speed * 1.2;
        face = toP;
        if (this.stateT > 4) {
          this.releaseToken();
          this.setState('circle');
        }
        this.locomote(speed);
        break;
      }
      case 'attack': {
        const atk = this.attack;
        const k = this.clipTime();
        // track the target through the wind-up, commit once the blow is on its way
        if (k < atk.hit - 0.12) face = toP;
        // the lunge, eased over the wind-up
        const lk = clamp(k / atk.hit, 0, 1);
        const lunge = atk.lunge * Math.sqrt(this.scale) * (lk * lk * (3 - 2 * lk) - (this.lastLunge || 0));
        this.lastLunge = lk * lk * (3 - 2 * lk);
        // (it stops short of him: its arms reach, its body doesn't walk into his)
        if (dist > this.radius + 1.05) this.move(Math.sin(this.yaw) * lunge, Math.cos(this.yaw) * lunge);
        // the telegraph: the eyes flare over the last half second before the blow lands, the
        // same for every beast and every blow (roll on the flare and the moment of grace covers it)
        const clipT = this.body.cur ? this.body.cur.getClip().duration / Math.max(0.05, Math.abs(this.body.cur.timeScale)) : 1;
        const toHit = (atk.hit - k) * clipT;
        this.toHit = toHit;
        this.glare = k < atk.hit + 0.05 ? clamp(1 - (toHit - 0.05) / 0.45, 0, 1) : 0;
        if (!this.whooshed && k > atk.hit - 0.12) {
          this.whooshed = true;
          sys.audio.play('whoosh', { at: this.pos, volume: 0.6, rate: (K.boss ? 0.45 : 0.7) + Math.random() * 0.1 });
        }
        if (!this.struck && k >= atk.hit) {
          this.struck = true;
          this.resolveHit(atk, dist, toP);
        }
        if (k >= 0.98 || this.stateT > 3.5) {
          this.attack = null;
          this.releaseToken();
          this.cool = (K.boss ? 3.0 : 2.0) + Math.random() * (K.boss ? 1.5 : 2.5);
          // one blow at a time from the pack, with a breath between them to answer it
          sys.holdAttacks(K.boss ? 1.4 : 1.2 + Math.random() * 0.8);
          this.setState('recover');
        }
        this.locomote(0, true);
        break;
      }
      case 'recover': {
        face = toP;
        if (this.stateT > (K.boss ? 0.5 : 0.75)) this.setState('circle');
        this.locomote(0);
        break;
      }
      case 'stagger': {
        if (this.stateT > this.staggerFor) {
          this.setState('circle');
          this.play('idle', 0.3);
        }
        break;
      }
      case 'dead': {
        const d = this.deathDir;
        if (this.stateT < 0.6) this.move(d.x * dt * 1.4, d.z * dt * 1.4);
        const burn = clamp((this.stateT - 1.1) / 1.8, 0, 1);
        this.uniforms.uDissolve.value = burn;
        if (burn > 0 && burn < 1 && Math.random() < dt * 30) sys.particles.emitEmbers(this.pos.x + (Math.random() - 0.5) * this.radius * 2, this.pos.y + Math.random() * this.height * (1 - burn), this.pos.z + (Math.random() - 0.5) * this.radius * 2, 3, null, 0.6);
        if (burn >= 1) this.remove();
        break;
      }
    }

    // knock-back from blows
    if (this.knock) {
      const kb = this.knock;
      kb.t += dt;
      const e = (x) => 1 - (1 - x) * (1 - x);
      const s = (e(Math.min(1, kb.t / 0.25)) - e(Math.min(1, (kb.t - dt) / 0.25))) * kb.d;
      this.move(kb.x * s, kb.z * s);
      if (kb.t > 0.25) this.knock = null;
    }
    // caught in the shallows (a knock, a bad step): wade back up onto the stone first
    if ((this.state === 'stalk' || this.state === 'circle' || this.state === 'approach') && sys.water.heightAt(this.pos.x, this.pos.z) - this.pos.y > this.wadeDepth * 0.78) {
      const N = frameAtX(this.pos.x).N;
      want = { x: -N.x, z: -N.z };
      speed = K.speed;
    }
    if (face !== null) this.yaw = dampAngle(this.yaw, face, this.state === 'attack' ? 9 : 6, dt);
    this.wantDir = want;
    this.wantSpeed = speed;
    if (speed > 0 && this.moveSpeed === 0 && this.state !== 'attack') this.moveSpeed = speed;
    this.smoke(dt);
  }

  pickAttack(dist) {
    if (!this.nextAttack) {
      const list = this.K.attacks;
      let name = list[Math.floor(Math.random() * list.length)];
      if (this.K.boss && this.rage > 0.5 && Math.random() < 0.35) name = 'stomp';
      if (dist > 3.2 * Math.sqrt(this.scale) && list.includes('lunge')) name = 'lunge';
      this.nextAttack = name;
    }
    return this.nextAttack;
  }

  beginAttack(atk) {
    this.attack = atk;
    this.nextAttack = null;
    this.struck = false;
    this.toHit = 9; // (computed through the wind-up: never the last blow's)
    this.glare = 0;
    this.whooshed = false;
    this.lastLunge = 0;
    this.setState('attack');
    this.play(atk.clip, 0.12, { once: true, speed: atk.speed * (this.K.boss ? 0.72 : 1) });
    // a stomp is announced on the ground: a burning ring where it will land
    if (atk.shock) this.sys.warnRing(this.pos, atk.reach * this.reachK * 1.6, (atk.hit / (atk.speed * 0.72)) * (this.body.cur?.getClip().duration ?? 1.3));
    this.sys.audio.play(this.K.boss ? 'andhaka-roar' : 'asura-attack', { at: this.pos, volume: this.K.boss ? 0.55 : 0.7, rate: this.K.boss ? 1.1 : 0.9 + Math.random() * 0.25, ref: this.K.boss ? 30 : 10 });
  }

  resolveHit(atk, dist, toP) {
    const sys = this.sys;
    const reach = atk.reach * this.reachK;
    if (atk.shock) sys.shockwave(this.pos, reach * 1.6);
    const off = Math.abs(wrapAngle(toP - this.yaw));
    const pf = sys.player.feetY;
    // a claw reaches his legs a step above it, and swings over him a long way below
    const up = pf - this.pos.y;
    if (dist > reach + this.radius || off > atk.arc || up > 0.95 * this.scale || up < -1.3 * this.scale) return;
    // only the big ones can floor him (a Rakshasa's smash, Andhaka's smash and stomp); a shade's
    // heavy blow, or Andhaka's sweep, staggers him
    const knock = !!atk.heavy && atk !== ATTACKS.sweep && (this.kindName !== 'shade' || atk.shock);
    const r = sys.combat.receive({ from: { x: this.pos.x, z: this.pos.z }, dmg: atk.dmg * this.K.dmg * sys.difficulty, heavy: !!atk.heavy, knock, unblockable: !!atk.unblockable, attacker: this });
    if (r === 'hit' || r === 'blocked') sys.audio.play('hurt', { volume: atk.heavy ? 0.9 : 0.6, rate: 0.7 });
  }

  // ---------------------------------------------------------------- body
  /** Move by (dx, dz) through the controller (walls, steps, Prady, each other). */
  move(dx, dz) {
    if (!dx && !dz) return;
    // along the ground's plane (the stair ramps): pressing into the floor in the same controller
    // call makes Rapier drop whole steps of movement (see Player.js)
    const c = { x: this.pos.x, y: this.pos.y + this.halfH, z: this.pos.z };
    const hit = this.sys.physics.castRayNormal(c, DOWN, this.halfH + 0.4, this.col, GROUPS.enemyMover);
    const dy = hit && hit.ny > 0.55 ? -(hit.nx * dx + hit.nz * dz) / hit.ny : 0;
    _v.set(dx, dy, dz);
    this.kcc.computeColliderMovement(this.col, _v, undefined, GROUPS.enemyMover);
    const m = this.kcc.computedMovement();
    // once risen it stays ashore: a lunge, a blow or a step that would take it deeper than its
    // knees into the river doesn't happen
    if (this.state !== 'rise' && this.state !== 'dead') {
      const W = this.sys.water;
      const nx = this.pos.x + m.x;
      const nz = this.pos.z + m.z;
      const deepNow = W.heightAt(this.pos.x, this.pos.z) - groundHeight(this.pos.x, this.pos.z);
      const deepNext = W.heightAt(nx, nz) - groundHeight(nx, nz);
      if (deepNext > this.wadeDepth && deepNext > deepNow) {
        this.pos.y += m.y;
        return;
      }
    }
    this.pos.x += m.x;
    this.pos.z += m.z;
    this.pos.y += m.y;
  }

  locomote(speed, still = false) {
    this.moveSpeed = still ? 0 : speed;
  }

  /** Per frame after the mind: physics step, ground, animation blend, bones, eyes. */
  late(dt) {
    const sys = this.sys;
    // steering: the wish plus separation from the others
    if (this.moveSpeed > 0 && this.wantDir) {
      let sx = 0;
      let sz = 0;
      for (const o of sys.list) {
        if (o === this || !o.alive) continue;
        const ox = this.pos.x - o.pos.x;
        const oz = this.pos.z - o.pos.z;
        const d = Math.hypot(ox, oz);
        const minD = this.radius + o.radius + 0.9;
        if (d < minD && d > 1e-3) {
          sx += (ox / d) * (minD - d) / minD;
          sz += (oz / d) * (minD - d) / minD;
        }
      }
      const vx = (this.wantDir.x + sx * 1.4) * this.moveSpeed;
      const vz = (this.wantDir.z + sz * 1.4) * this.moveSpeed;
      this.vel.x = damp(this.vel.x, vx, 8, dt);
      this.vel.z = damp(this.vel.z, vz, 8, dt);
    } else {
      this.vel.x = damp(this.vel.x, 0, 10, dt);
      this.vel.z = damp(this.vel.z, 0, 10, dt);
    }
    const before = this.pos.clone();
    // once risen, an Asura keeps out of the river: no step that would take it in deeper than
    // its knees (it would fight half-drowned, and Prady after it)
    if (this.state !== 'rise' && this.state !== 'dead') {
      const nx = this.pos.x + this.vel.x * 0.4;
      const nz = this.pos.z + this.vel.z * 0.4;
      const deep = this.sys.water.heightAt(nx, nz) - groundHeight(nx, nz);
      if (deep > this.wadeDepth) {
        const N = frameAtX(this.pos.x).N; // toward the river
        const vn = this.vel.x * N.x + this.vel.z * N.z;
        if (vn > 0) {
          this.vel.x -= N.x * vn * 1.6;
          this.vel.z -= N.z * vn * 1.6;
        }
      }
    }
    this.move(this.vel.x * dt, this.vel.z * dt);
    // stay on the real ground (steps under water too): the controller snaps, this settles it
    // gravity: settle onto what is below (the controller only snaps within reach); a small rise
    // underfoot (a step, the ramp) lifts it, anything taller is a wall the controller handles
    const below = this.sys.physics.castRay({ x: this.pos.x, y: this.pos.y + this.halfH, z: this.pos.z }, DOWN, this.halfH + 60, this.col, GROUPS.enemyMover);
    const floor = below !== null ? this.pos.y + this.halfH - below : groundHeight(this.pos.x, this.pos.z);
    if (floor < this.pos.y - 0.02) {
      this.fallV = (this.fallV || 0) + 19 * dt;
      this.pos.y = Math.max(floor, this.pos.y - this.fallV * dt);
    } else {
      this.fallV = 0;
      if (floor > this.pos.y && floor - this.pos.y < 0.6) this.pos.y = floor;
    }
    this.pos.y = Math.max(this.pos.y, groundHeight(this.pos.x, this.pos.z) - 0.05);
    this.rb.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + this.halfH, z: this.pos.z });
    const realSpeed = dt > 0 ? Math.hypot(this.pos.x - before.x, this.pos.z - before.z) / dt : 0;

    // animation: locomotion by real speed (unless an action owns the body)
    const B = this.body;
    const gloating = this.gloated && B.curRole === 'roar' && B.cur && B.cur.time < B.cur.getClip().duration - 0.05;
    const acting = this.state === 'attack' || this.state === 'stagger' || this.state === 'dead' || gloating;
    if (!acting) {
      const relYaw = Math.atan2(this.vel.x, this.vel.z) - this.yaw;
      const side = Math.sin(relYaw);
      let role = 'idle';
      let sp = 1;
      if (realSpeed > 0.25) {
        if (Math.abs(side) > 0.6 && this.has('strafeL') && this.has('strafeR')) role = side > 0 ? 'strafeL' : 'strafeR';
        else role = realSpeed > this.K.speed * 1.4 && this.has('run') ? 'run' : 'walk';
        sp = clamp(realSpeed / (role === 'run' ? (B.runSpeed || 3.4) : B.walkSpeed || 1.4) / Math.max(0.6, this.scale * 0.85), 0.55, 1.8);
      }
      this.play(role, 0.3, { speed: sp });
    }
    B.mixer.update(dt);
    // place the body: feet on the real treads (the controller rides the smooth stair ramp)
    const tread = this.sys.physics.castRay({ x: this.pos.x, y: this.pos.y + 0.6, z: this.pos.z }, DOWN, 1.4, this.col, GROUPS.enemyFeet);
    const footY = tread !== null ? this.pos.y + 0.6 - tread : this.pos.y;
    this.visY = this.visY === undefined ? footY : damp(this.visY, Math.min(footY, this.pos.y + 0.05), 14, dt);
    B.holder.position.set(this.pos.x, this.visY, this.pos.z);
    B.holder.rotation.set(0, this.yaw, 0);
    B.holder.updateMatrixWorld(true);
    // a body between the camera and Prady, or right at the lens, thins out so Prady is never lost
    // behind it (Andhaka and the Rakshasas fill the frame; a shade only when the lens is in it)
    {
      const cam = this.sys.g.camera.position;
      const P = this.sys.player.position;
      const dP = Math.hypot(P.x - cam.x, P.z - cam.z);
      const dB = Math.hypot(this.pos.x - cam.x, this.pos.z - cam.z);
      const big = this.K.boss || this.kindName === 'brute';
      let block = dB < this.radius + (this.K.boss ? 2.6 : big ? 1.4 : 0.8) && cam.y < this.pos.y + this.height + 0.5;
      if (!block && big && dB < dP) {
        for (let k = 0.05; k < 1 && !block; k += 0.08) {
          const qx = cam.x + (P.x - cam.x) * k;
          const qy = cam.y + (P.y + 1.1 - cam.y) * k;
          const qz = cam.z + (P.z - cam.z) * k;
          block = qy > this.pos.y && qy < this.pos.y + this.height && Math.hypot(qx - this.pos.x, qz - this.pos.z) < this.radius * 1.5;
        }
      }
      this.ghost = (this.ghost || 0) + ((block && this.alive ? 0.62 : 0) - (this.ghost || 0)) * Math.min(1, dt * 7);
      // smooth see-through (no screen-door dither): his materials are blended
      for (const m of this.body.materials) m.opacity = 1 - this.ghost;
    }
    // flinch on top of the clip
    const F = this.flinch;
    if (F) {
      F.vel += (-110 * F.amt - 14 * F.vel) * dt;
      F.amt += F.vel * dt;
      // the head lags the chest and whips past it
      F.headVel += (70 * (F.amt * 1.4 - F.head) - 8 * F.headVel) * dt;
      F.head += F.headVel * dt;
      for (const [b, w] of B.spine) if (b) rotateWorld(b, F.axis, F.amt * w);
      if (B.head) rotateWorld(B.head, F.axis, F.head * 0.4);
      if (Math.abs(F.amt) < 0.001 && Math.abs(F.vel) < 0.01 && Math.abs(F.head) < 0.002) this.flinch = null;
    }
    // a predator's hunch: the back curls forward, the head stays up and level
    const fwd = _z.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const side = _x.set(fwd.z, 0, -fwd.x);
    const hunch = this.state === 'dead' ? 0 : B.curRole === 'walk' || B.curRole === 'idle' || B.curRole === 'strafeL' || B.curRole === 'strafeR' ? 0.06 : 0.16;
    if (hunch) {
      if (B.spine[0][0]) rotateWorld(B.spine[0][0], side, -hunch * 0.5);
      if (B.spine[1][0]) rotateWorld(B.spine[1][0], side, -hunch * 0.6);
      if (B.neck) rotateWorld(B.neck, side, hunch * 0.6);
      if (B.head) rotateWorld(B.head, side, hunch * 0.45);
    }
    // feet on the steps: drop the body to the lower foot's tread, bend the other knee up to its own
    this.plantFeet(B);
    // the eyes (in the head's frame)
    if (B.head && B.eyes.length) {
      B.head.updateWorldMatrix(true, false);
      const glow = (this.alive ? 0.8 + (this.glare || 0) * 1.6 + this.hurt * 0.6 : Math.max(0, 1 - this.stateT * 1.5)) * (1 - this.uniforms.uDissolve.value);
      for (const e of B.eyes) sys.eyes.add(_w.copy(e).applyMatrix4(B.head.matrixWorld), glow * (this.K.boss ? 1.6 : 1));
    }
    this.uniforms.uHurt.value = this.hurt;
    this.uniforms.uRage.value = this.rage;
    this.uniforms.uTime.value = this.t;
    B.horns.visible = this.uniforms.uDissolve.value < 0.6;
  }

  plantFeet(B) {
    if (this.state === 'dead' || this.state === 'rise') return;
    const fwd = _z.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const base = B.holder.position.y;
    const ankle = 0.12 * this.scale;
    const feet = [];
    for (const [th, ca, ft] of B.legs) {
      if (!th || !ca || !ft) return;
      ft.getWorldPosition(_v);
      const hit = this.sys.physics.castRay({ x: _v.x, y: base + 0.9 * this.scale, z: _v.z }, DOWN, 2.2 * this.scale, this.col, GROUPS.enemyFeet);
      const ground = hit !== null ? base + 0.9 * this.scale - hit : base;
      feet.push({ th, ca, ft, y: _v.y, ground, lift: Math.max(0, _v.y - base - ankle) });
    }
    // the body sinks so the lower foot reaches its tread
    const drop = Math.min(0, ...feet.map((f) => f.ground - base));
    this.footDrop = damp(this.footDrop || 0, Math.max(-0.45 * this.scale, drop), 12, 1 / 60);
    if (Math.abs(this.footDrop) > 0.002) {
      B.holder.position.y = base + this.footDrop;
      B.holder.updateMatrixWorld(true);
    }
    for (const f of feet) {
      f.ft.getWorldPosition(_v);
      const want = f.ground + ankle + f.lift;
      if (Math.abs(_v.y - want) < 0.01) continue;
      _w.set(_v.x, want, _v.z);
      solveTwoBone(f.th, f.ca, f.ft, _w, fwd, 1);
    }
  }

  smoke(dt) {
    this.smokeT -= dt * this.K.smoke * (this.alive ? 1 : 0.5);
    if (this.smokeT > 0) return;
    this.smokeT = 0.09 + Math.random() * 0.08;
    const h = this.height * (0.25 + Math.random() * 0.6);
    this.sys.particles.emitSmoke(this.pos.x, this.pos.y + h, this.pos.z, this.scale * 0.8);
    if (Math.random() < 0.25) this.sys.particles.emitEmbers(this.pos.x + (Math.random() - 0.5) * this.radius, this.pos.y + h, this.pos.z + (Math.random() - 0.5) * this.radius, 1, null, 0.25);
  }

  remove() {
    const sys = this.sys;
    sys.scene.remove(this.body.holder);
    for (const m of this.body.materials) m.dispose();
    sys.physics.world.removeCharacterController(this.kcc);
    sys.physics.world.removeRigidBody(this.rb);
    this.removed = true;
  }
}

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

// ---------------------------------------------------------------- the pack
export class AsuraSystem {
  constructor(game) {
    const g = game;
    this.g = g;
    this.scene = g.scene;
    this.physics = g.physics;
    this.player = g.player;
    this.combat = g.combat;
    this.health = g.health;
    this.audio = g.audio;
    this.water = g.water;
    this.fx = g.fx;
    this.targets = g.targets;
    this.list = [];
    this.tokens = 0;
    this.difficulty = 1;
    this.clock = 0;
    this.quietUntil = 0; // no new attack begins before this (a beat between blows)
    this.particles = new AsuraParticles();
    this.eyes = new AsuraEyes(40);
    this.scene.add(this.particles.smoke, this.eyes.points);
    this.ready = false;
    this.hornGeo = hornsGeometry(1);
    this.hornMat = hornMaterial();
    this.shocks = [];
    this.killed = 0;
  }

  /** Load the bodies and motion (lazily, the first time darkness rises). */
  load() {
    if (this._load) return this._load;
    const M = this.g.manifestEnemies;
    const L = this.g.assets.gltf;
    this._load = Promise.all([L.loadAsync(M.body), L.loadAsync(M.packBase).catch(() => null), M.pack ? L.loadAsync(M.pack).catch(() => null) : null, M.bossBody ? L.loadAsync(M.bossBody).catch(() => null) : null]).then(([body, base, pack, boss]) => {
      this.src = { body, clips: new Map(), boss };
      for (const c of [...(base?.animations || []), ...(body.animations || [])]) this.src.clips.set(c.name, c);
      for (const c of pack?.animations || []) this.src.clips.set(c.name, c);
      const ud = body.scene.children[0]?.userData || body.scene.userData || {};
      this.src.walkSpeed = ud.walkSpeed || 1.4;
      this.ready = true;
    });
    return this._load;
  }

  hasStrafe(a) {
    return a.has('strafeL') && a.has('strafeR');
  }

  /** A fresh body: cloned skeleton + Asura skin + horns; clips by role. */
  makeBody(scale, boss) {
    const src = this.src;
    const holder = new THREE.Group();
    const root = SkeletonUtils.clone(src.body.scene);
    root.scale.multiplyScalar(scale);
    holder.add(root);
    const uniforms = { uDissolve: { value: 0 }, uHurt: { value: 0 }, uRage: { value: 0 }, uTime: { value: 0 }, uFeetY: { value: 0 }, uHeadY: { value: 1.75 }, uGhost: { value: 0 } };
    const materials = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
      o.layers.enable(2);
      o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox;
      uniforms.uFeetY.value = bb.min.y;
      uniforms.uHeadY.value = bb.max.y;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const nm = mats.map((m) => {
        const am = asuraMaterial(m, uniforms, { scale: Math.max(0.01, bb.max.y - bb.min.y) / 1.75 });
        // drawn as a blended surface so the body can thin smoothly when it stands between the
        // camera and Prady, or right at the lens (opacity 1 otherwise: a switch at runtime would
        // recompile mid-fight)
        am.transparent = true;
        if (m.alphaTest) am.alphaTest = m.alphaTest;
        if (m.map && m.alphaTest) am.side = THREE.DoubleSide;
        materials.push(am);
        return am;
      });
      o.material = Array.isArray(o.material) ? nm : nm[0];
    });
    const horns = new THREE.Mesh(this.hornGeo, this.hornMat);
    horns.castShadow = true;
    const mixer = new THREE.AnimationMixer(root);
    const actions = {};
    const C = src.clips;
    const roles = this.g.manifestEnemies.roles;
    const reversed = {};
    for (const [role, names] of Object.entries(roles)) {
      const name = names.find((n) => C.get(n.replace(/^-/, '')));
      if (!name) continue;
      const clip = C.get(name.replace(/^-/, ''));
      // a reversed role needs its own action (the same clip may also play forwards)
      actions[role] = name.startsWith('-') ? mixer.clipAction(clip.clone()) : mixer.clipAction(clip);
      if (name.startsWith('-')) reversed[role] = true;
    }
    const bone = (n) => root.getObjectByName(`Bip01_${n}`) || root.getObjectByName(`mixamorig${n}`) || root.getObjectByName(`mixamorig:${n}`);
    // the skull in the bind pose (facing +Z): horns ride the head bone, eyes are points in its frame
    root.updateMatrixWorld(true);
    const headB = bone('Head');
    const eyes = [];
    if (headB) {
      const hp = headB.getWorldPosition(new THREE.Vector3());
      const hq = headB.getWorldQuaternion(new THREE.Quaternion());
      const hs = headB.getWorldScale(new THREE.Vector3()).x || 1;
      headB.add(horns);
      horns.position.copy(headB.worldToLocal(hp.clone().add(new THREE.Vector3(0, 0.1, 0.01).multiplyScalar(scale))));
      horns.quaternion.copy(hq.invert());
      horns.scale.setScalar(scale / hs);
      for (const sx of [-1, 1]) eyes.push(headB.worldToLocal(hp.clone().add(new THREE.Vector3(0.031 * sx, 0.093, 0.118).multiplyScalar(scale))));
    } else holder.add(horns);
    const B = {
      holder,
      root,
      eyes,
      legs: [
        [bone('L_Thigh') || bone('LeftUpLeg'), bone('L_Calf') || bone('LeftLeg'), bone('L_Foot') || bone('LeftFoot')],
        [bone('R_Thigh') || bone('RightUpLeg'), bone('R_Calf') || bone('RightLeg'), bone('R_Foot') || bone('RightFoot')],
      ],
      mixer,
      actions,
      reversed,
      materials,
      uniforms,
      horns,
      cur: null,
      walkSpeed: src.walkSpeed,
      head: bone('Head'),
      neck: bone('Neck'),
      spine: [
        [bone('Spine'), 0.35],
        [bone('Spine1'), 0.45],
        [bone('Neck'), 0.25],
        [bone('Head'), 0.3],
      ],
    };
    return B;
  }

  /**
   * Bring up Asuras out of the river in front of ghat point (x, z): n of kind, each walking up
   * the drowned steps toward goal. Returns the list.
   */
  async riseFromRiver({ x, z, n = 3, kind = 'shade', spread = 6, goal = null, opts = {} }) {
    await this.load();
    const out = [];
    const { u, seg } = bankCoords(x, z);
    const g = seg || segmentForX(x);
    for (let i = 0; i < n; i++) {
      const du = (i - (n - 1) / 2) * spread * 0.7 + (Math.random() - 0.5) * 2;
      let p;
      let y;
      if (g) {
        p = ghatToWorld(g, Math.max(2, Math.min(g.width - 2, u + du)), PROFILE_LEN - 2.2 - Math.random() * 1.5);
        y = groundHeight(p.x, p.z);
      } else {
        p = { x: x + du, z: z + 8 };
        y = groundHeight(p.x, p.z);
      }
      const yaw = g ? Math.atan2(-g.N.x, -g.N.z) : 0;
      const a = this.spawn(kind, { x: p.x, y, z: p.z, yaw }, { ...opts, goal: goal || { x: p.x - (g ? g.N.x : 0) * 12, z: p.z - (g ? g.N.z : 0) * 12 } });
      a.stateT = -i * 0.6; // staggered emergence
      out.push(a);
    }
    this.audio.play('asura-growl', { at: new THREE.Vector3(x, 0, z), volume: 1, rate: 0.6, ref: 30 });
    return out;
  }

  spawn(kind, at, opts = {}) {
    const a = new Asura(this, kind, at, opts);
    this.list.push(a);
    this.targets.add(a);
    return a;
  }

  /** Nobody starts a new attack for `secs` (a beat after a blow, given or taken). */
  holdAttacks(secs) {
    this.quietUntil = Math.max(this.quietUntil, this.clock + secs);
  }

  requestToken(a) {
    if (this.g.state === 'cutscene') return false; // nobody strikes while the camera tells the story
    if (!a.token && this.clock < this.quietUntil && !a.K.boss) return false;
    // one attacker at a time (the rest pace and wait their turn); a big pack sends two
    const n = this.list.filter((o) => o.alive).length;
    const max = this.list.some((o) => o.alive && o.K.boss) ? 1 : n >= 4 ? 2 : 1;
    if (a.token) return true;
    if (this.tokens >= max) return false;
    // the boss always gets priority; otherwise the nearest waits less
    a.token = true;
    this.tokens++;
    return true;
  }

  onKilled(a) {
    this.killed++;
    // the prana it stole goes back to him: a shade restores a little, a Rakshasa more
    // (in the long fights, the adds Andhaka calls are how Prady stays standing)
    const heal = a.K.boss ? 0 : a.kindName === 'brute' ? 24 : 11;
    if (heal && !this.health.dead) {
      this.g.after(0.5, () => {
        if (this.health.dead) return;
        this.health.heal(heal);
        const P = this.player.position;
        this.particles.emitEmbers(P.x, P.y + 1.1, P.z, 18, null, 0.5);
        this.audio.play('chime', { volume: 0.35, rate: 1.25 });
      });
    }
    this.g.onEnemyKilled?.(a);
  }

  /** The stomp's warning: a ring of embers on the ground filling in until the blow lands. */
  warnRing(p, r, secs) {
    if (!this.ringMesh) {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.92, 1, 64).rotateX(-Math.PI / 2),
        new THREE.ShaderMaterial({
          uniforms: { uK: { value: 0 } },
          vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
          fragmentShader: 'uniform float uK; void main(){ gl_FragColor = vec4(vec3(2.4, 0.6, 0.15) * (0.4 + 0.6 * uK), 0.35 + 0.55 * uK); }',
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      m.frustumCulled = false;
      this.scene.add(m);
      this.ringMesh = m;
      const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff4a10, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending }));
      fill.frustumCulled = false;
      this.scene.add(fill);
      this.ringFill = fill;
    }
    this.ring = { x: p.x, y: this.groundFor(p, r) + 0.06, z: p.z, r, t: 0, secs: Math.max(0.4, secs) };
  }

  /** The height to draw a ground warning at: Prady's ground when he stands within it above the
   *  beast (a ring at its feet down the steps would hide under the stone he stands on). */
  groundFor(p, r) {
    const P = this.player.position;
    const fy = this.player.feetY;
    return Math.hypot(P.x - p.x, P.z - p.z) < r * 1.25 && fy > p.y + 0.4 ? fy : p.y;
  }

  /** A ring of force across the ground (the boss's stomp): visual + camera shake. */
  shockwave(p, r) {
    this.shocks.push({ x: p.x, y: this.groundFor(p, r) + 0.05, z: p.z, r, t: 0 });
    this.g.camRig.shake(0.6);
    this.particles.emitEmbers(p.x, p.y + 0.2, p.z, 60, null, 1.8);
    this.audio.play('thump', { at: p, volume: 1, rate: 0.35 });
  }

  /** Remove everyone (end of an encounter, a test jump). */
  clear() {
    for (const a of this.list) {
      if (!a.removed) a.remove();
      this.targets.remove(a);
    }
    this.list = [];
    this.tokens = 0;
  }

  get active() {
    return this.list.some((a) => a.alive);
  }

  /** HUD bars for hurt enemies (and the boss's bar). */
  hud(camera, ui) {
    const bars = [];
    let boss = null;
    for (const a of this.list) {
      if (a.K.boss) {
        if (a.alive || a.stateT < 2) boss = { name: a.name.toUpperCase(), title: a.title || 'the Blind Darkness', frac: Math.max(0, a.hp / a.maxHp) };
        continue;
      }
      if (!a.alive || a.barT <= 0) continue;
      _v.set(a.pos.x, a.pos.y + a.height + 0.35, a.pos.z).project(camera);
      if (_v.z > 1 || Math.abs(_v.x) > 1.1 || Math.abs(_v.y) > 1.1) continue;
      bars.push({ x: (_v.x * 0.5 + 0.5) * innerWidth, y: (-_v.y * 0.5 + 0.5) * innerHeight, frac: Math.max(0, a.hp / a.maxHp), alpha: Math.min(1, a.barT) });
    }
    ui.setEnemyBars(bars);
    ui.setBoss(boss);
  }

  update(dt, ctx) {
    if (!this.list.length && !this.particles.alive && !this.shocks.length) {
      this.eyes.begin();
      this.eyes.end(ctx.pixelRatio);
      return;
    }
    this.eyes.begin();
    this.clock += dt;
    for (const a of this.list) if (!a.removed) a.update(dt);
    for (const a of this.list) if (!a.removed) a.late(dt);
    for (const a of this.list) a.barT = Math.max(0, a.barT - dt);
    const gone = this.list.filter((a) => a.removed);
    for (const a of gone) {
      this.targets.remove(a);
    }
    if (gone.length) this.list = this.list.filter((a) => !a.removed);
    this.eyes.end(ctx.pixelRatio);
    this.particles.update(dt, ctx.pixelRatio, ctx.light);
    // shockwaves: embers along an expanding ring
    for (const s of this.shocks) {
      s.t += dt;
      const r = s.r * Math.min(1, s.t / 0.45);
      for (let k = 0; k < 10; k++) {
        const ang = Math.random() * Math.PI * 2;
        this.particles.emitEmbers(s.x + Math.cos(ang) * r, s.y + 0.1, s.z + Math.sin(ang) * r, 1, { x: Math.cos(ang) * 0.4, z: Math.sin(ang) * 0.4 }, 0.5);
      }
    }
    this.shocks = this.shocks.filter((s) => s.t < 0.5);
    // the stomp warning
    const R = this.ring;
    if (this.ringMesh) {
      const on = !!R && R.t < R.secs;
      this.ringMesh.visible = this.ringFill.visible = on;
      if (on) {
        R.t += dt;
        const k = Math.min(1, R.t / R.secs);
        this.ringMesh.position.set(R.x, R.y, R.z);
        this.ringMesh.scale.setScalar(R.r);
        this.ringMesh.material.uniforms.uK.value = k;
        this.ringFill.position.set(R.x, R.y - 0.01, R.z);
        this.ringFill.scale.setScalar(R.r * k);
      }
    }
  }
}
