import * as THREE from 'three';
import { clamp, damp, lerp, smoothstep } from '../utils/math.js';
import { solveTwoBone } from '../utils/bones.js';

// A diya carried in the dark: the clay lamp cupped in Prady's left hand in front of his chest,
// its flame the only light he has (it takes over the hero light: warm, low, flickering, ~9 m).
//
//   the light   the shades (light-shy kinds, `shy`) will not come into it: they hold at its edge,
//               pacing him, and strike only when it gutters low or goes out (fearAt, Asuras.js)
//   the wind    gusts come through the lanes; walking he shields it with his body, running and
//               rolling fan it out; climbing or swimming puts it out. The flame shrinks with every
//               gust and steadies again in the calm.
//   relighting  at any flame burning nearby (a shrine's diya, a ghat diya, a lane lamp, a sacred
//               flame): E. In the dark with it out, the Dread climbs.
//
// Missions hand it to him (carry(true)) and take it back; it is not an item he keeps.

const _t = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const RADIUS = 3.6; // metres of light the shades won't enter, at a full flame

function cupGeometry() {
  const prof = [
    [0.0, 0.0],
    [0.035, 0.0],
    [0.058, 0.012],
    [0.068, 0.03],
    [0.072, 0.042],
    [0.064, 0.044],
    [0.052, 0.026],
    [0.0, 0.02],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(prof, 14);
  // the pinched spout where the wick lies
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const a = Math.atan2(z, x);
    const lip = Math.max(0, Math.cos(a)) ** 6 * 0.022 * smoothstep(0.02, 0.044, pos.getY(i));
    const l = Math.hypot(x, z) || 1;
    pos.setXYZ(i, x + (x / l) * lip, pos.getY(i), z + (z / l) * lip);
  }
  g.computeVertexNormals();
  return g;
}

export class HandDiya {
  constructor(game) {
    this.g = game;
    this.carried = false;
    this.lit = false;
    this.flame = 0; // 0..1: how much flame (the light, the shades' fear)
    this.w = 0; // the carry pose's weight
    this.gust = 0; // the gust blowing now (0..1)
    this.gustT = 4;
    this.shy = new Set(['shade']);
    this.windK = 1; // a mission's place: how windy (the lanes 1, the open ghat 1.6)
    this.flamePos = new THREE.Vector3(0, -50, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8c4320, roughness: 0.8, emissive: 0x3a1004, emissiveIntensity: 0 });
    this.cup = new THREE.Mesh(cupGeometry(), mat);
    this.cup.visible = false;
    this.cup.castShadow = false;
    game.scene.add(this.cup);
    this.fireId = game.fire.add(new THREE.Vector3(0, -50, 0), 0.62, false);
    game.audio.synth('wind-gust', synthGust);
    game.audio.synth('diya-out', synthPuff);
    this.sources = [];
    this.sourcesT = 0;
  }

  /** A mission puts the diya in his hand (lit), or takes it back. */
  carry(on, lit = true) {
    this.carried = on;
    this.placed = false;
    this.cup.visible = on;
    this.setLit(on && lit);
    if (on) this.flame = lit ? 1 : 0;
  }

  setLit(on) {
    if (this.lit === on) return;
    this.lit = on;
    this.g.fire.setLit(this.fireId, on ? 1 : 0);
    if (!on) this.flame = 0;
  }

  blowOut(reason = '') {
    if (!this.lit) return;
    this.setLit(false);
    this.g.audio.play('diya-out', { volume: 0.6, at: this.flamePos });
    if (reason) this.g.ui.toast('The diya is out', reason, 2.6);
    this.onOut?.();
  }

  /** How much a shade at `pos` fears the light (0 outside it, 1 at his feet). */
  fearAt(pos, a) {
    if (!this.carried || !this.lit || (a && !this.shy.has(a.kindName))) return 0;
    const R = RADIUS * (0.35 + 0.65 * this.flame);
    const d = Math.hypot(pos.x - this.flamePos.x, pos.z - this.flamePos.z);
    return clamp((R - d) / 1.4, 0, 1);
  }

  get radius() {
    return this.lit && this.carried ? RADIUS * (0.35 + 0.65 * this.flame) : 0;
  }

  /** Flames burning near enough to light the diya from: refreshed every second. */
  nearFlame(p) {
    const g = this.g;
    this.sourcesT -= 1 / 60;
    if (this.sourcesT <= 0) {
      this.sourcesT = 1;
      const list = [];
      for (const f of g.world.galis?.shrineFlames ?? []) list.push(f);
      for (const f of g.quest?.flames ?? []) if (f.lit) list.push(f.lamps[f.lamps.length - 1]);
      for (const d of g.night?.diyas ?? []) if (d.lit && d.pos.distanceToSquared(p) < 400) list.push(d.pos);
      for (const l of g.night?.laneLamps ?? []) if (l.lit && !l.dead && !l.dying && l.pos.distanceToSquared(p) < 400) list.push(l.pos);
      for (const s of this.extraSources || []) list.push(s);
      this.sources = list;
    }
    let best = null;
    let bd = 2.4;
    for (const s of this.sources) {
      const d = Math.hypot(s.x - p.x, (s.y ?? p.y) - (p.y + 0.9), s.z - p.z);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  /** Game.interaction: relight it at a flame. */
  interact() {
    if (!this.carried || this.lit) return null;
    const p = this.g.player;
    if (p.state !== 'ground') return null;
    const at = this.nearFlame(p.position.clone().setY(p.feetY));
    if (!at) return null;
    return {
      prompt: 'Light the diya from the flame',
      action: () => {
        this.setLit(true);
        this.flame = 0.4;
        this.g.audio.play('ignite', { volume: 0.6, at });
        this.onLit?.();
      },
    };
  }

  // ---------------------------------------------------------------- per frame, after the animator
  late(dt) {
    const g = this.g;
    const p = g.player;
    if (!this.carried) {
      this.w = 0;
      return;
    }
    const busy = !!(g.combat?.move || g.combat?.roll || g.combat?.react || g.traversal?.act || g.actions?.act || p.state !== 'ground');
    // ---- what puts it out: water, a climb, a roll
    const wet = p.state === 'swim' || p.state === 'dive' || (this.placed && g.water.heightAt(this.flamePos.x, this.flamePos.z) > this.flamePos.y);
    // (the akhand jyoti sealed in glass burns under water: DrownedSanctum)
    if (this.lit && ((wet && !this.sealed) || g.traversal?.act)) this.blowOut(wet ? 'The river has it.' : 'No hand to spare for it, climbing.');
    if (this.lit && g.combat?.roll) this.blowOut('Rolling fanned it out.');

    // ---- the wind through the lanes
    this.gustT -= dt;
    if (this.gustT <= 0) {
      this.gustT = 5 + Math.random() * 9;
      this.gustAmp = (0.25 + Math.random() * 0.55) * this.windK;
      this.gustAge = 0;
      g.audio.play('wind-gust', { volume: 0.35 + this.gustAmp * 0.4, rate: 0.85 + Math.random() * 0.3 });
    }
    if (this.gustAge !== undefined) {
      this.gustAge += dt;
      this.gust = this.gustAmp * Math.sin(Math.PI * Math.min(1, this.gustAge / 1.6));
      if (this.gustAge > 1.6) this.gust = 0;
    }
    const run = p.speed > 3.2 ? 2.4 : p.speed > 1.8 ? 1.4 : p.speed > 0.3 ? 0.65 : 0.45;
    if (this.lit && this.sealed) this.flame = Math.min(1, this.flame + dt * 0.3);
    else if (this.lit) {
      // (walking he turns his body to it; running the air tears at it)
      this.flame -= this.gust * run * dt * 0.55;
      this.flame = Math.min(1, this.flame + dt * (this.gust > 0.05 ? 0.02 : 0.14));
      if (this.flame <= 0) this.blowOut(p.speed > 3.2 ? 'Running fanned it out.' : 'The wind took it.');
    }

    // ---- the carry pose: cupped in the left hand in front of the chest (off while he fights)
    this.w = damp(this.w, busy ? 0 : 1, busy ? 12 : 5, dt);
    const loco = g.animator.loco;
    const B = loco?.b?.Left;
    const chest = loco?.b?.spine2 || loco?.b?.spine1;
    if (B?.arm && chest && this.w > 0.01) {
      const yaw = p.yaw;
      _f.set(Math.sin(yaw), 0, Math.cos(yaw));
      _r.set(-Math.cos(yaw), 0, Math.sin(yaw));
      chest.getWorldPosition(_t);
      // a hand's breadth below the chest, forward of it, a little to his left; the walk's bob in it
      _t.addScaledVector(_f, 0.25).addScaledVector(_r, -0.06);
      _t.y -= 0.27;
      _pole.copy(_f).multiplyScalar(-0.3).addScaledVector(_r, -1).add(new THREE.Vector3(0, -0.9, 0)).normalize();
      solveTwoBone(B.arm, B.fore, B.hand, _t, _pole, this.w);
      // palm up under it, the fingers forward
      B.fore.getWorldQuaternion(_q);
      _m.lookAt(new THREE.Vector3(), _f, _up);
      _q2.setFromRotationMatrix(_m);
      B.hand.getWorldQuaternion(_q);
      const want = _q2.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(this.handPitch ?? -1.45, this.handYaw ?? 0, this.handRoll ?? 1.57)));
      _q.slerp(want, this.w);
      setWorldQuaternion(B.hand, _q);
    }
    // ---- the lamp on the palm, the flame on its wick
    const hand = B?.hand;
    if (hand) {
      hand.getWorldPosition(_t);
      hand.getWorldQuaternion(_q);
      // (on the palm: out from the hand's centre along its palm normal)
      const n = new THREE.Vector3(this.palmX ?? 0, this.palmY ?? 0.07, this.palmZ ?? 0.03).applyQuaternion(_q);
      this.cup.position.copy(_t).add(n);
      this.cup.quaternion.setFromAxisAngle(_up, p.yaw);
      this.cup.updateMatrixWorld();
      _f.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
      this.flamePos.copy(this.cup.position).addScaledVector(_f, 0.06);
      this.placed = true;
      // the flame leans away from the wind and from his running
      this.flamePos.y += 0.055;
      g.fire.setPosition(this.fireId, this.flamePos.x - _f.x * Math.min(0.03, p.speed * 0.008), this.flamePos.y, this.flamePos.z - _f.z * Math.min(0.03, p.speed * 0.008));
      if (this.lit) g.fire.setLit(this.fireId, 0.35 + 0.65 * this.flame * (1 - this.gust * 0.5));
      this.cup.material.emissiveIntensity = this.lit ? 0.6 * this.flame : 0;
    }
  }

  /** The hero light while the diya is lit: where, how strong (Game.update). */
  light(t) {
    if (!this.carried || !this.lit) return 0;
    const flick = 0.82 + 0.1 * Math.sin(t * 9.3) + 0.05 * Math.sin(t * 17.1 + 1.3) + 0.03 * Math.sin(t * 31.7);
    return lerp(0.6, 3.4, this.flame) * flick * (1 - this.gust * 0.35);
  }
}

function setWorldQuaternion(bone, q) {
  const parent = bone.parent;
  parent.getWorldQuaternion(_q2);
  bone.quaternion.copy(_q2.invert().multiply(q));
  bone.updateMatrixWorld(true);
}

// ---------------------------------------------------------------- sounds (made in code)

/** A gust through the lanes: a rising and falling rush of air. */
export function synthGust(ctx) {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * 2.2);
  const b = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let lp = 0;
    let bp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const w = Math.random() * 2 - 1;
      const k = 0.02 + 0.06 * Math.sin(Math.PI * Math.min(1, t / 2.2));
      lp += (w - lp) * k;
      bp += (lp - bp) * 0.3;
      const env = Math.sin(Math.PI * Math.min(1, t / 2.2)) ** 1.5;
      d[i] = (lp - bp * 0.6) * env * 2.4;
    }
  }
  return b;
}

/** A diya going out: a soft puff and the tiny hiss of the wick. */
export function synthPuff(ctx) {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * 0.5);
  const b = ctx.createBuffer(1, n, sr);
  const d = b.getChannelData(0);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const w = Math.random() * 2 - 1;
    lp += (w - lp) * 0.15;
    d[i] = lp * Math.exp(-t * 18) * 1.6 + w * Math.exp(-t * 9) * 0.04 * (t > 0.05 ? 1 : 0);
  }
  return b;
}
