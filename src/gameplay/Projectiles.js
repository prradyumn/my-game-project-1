import * as THREE from 'three';
import { GROUPS } from '../core/Physics.js';

// Thrown fire: the Pishachas hurl balls of sea-green ghost fire. Each one flies on a shallow arc
// aimed where Prady will be, burns out against stone and hisses out in the river. A blow that
// meets it is answered like any other: dodged (it flies past), blocked (it bursts on the guard),
// or PARRIED: the guard bats it straight back at whoever threw it. One Points draw for all of
// them, the fire in hand while a Pishacha winds up, and the bursts.

const MAX = 24;
const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _a = new THREE.Vector3();
const COLOR = new THREE.Color(0.45, 1.7, 1.25);
const HOT = new THREE.Color(2.4, 1.3, 0.45); // turned back by a parry, it burns gold

export class Projectiles {
  constructor(game) {
    this.g = game;
    this.list = [];
    this.flashes = []; // { pos, t, life, size }
    this.charges = []; // { pos, k } this frame: fire in a hand
    this.timeScale = 1;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    this.col = new Float32Array(MAX * 3);
    this.alpha = new Float32Array(MAX);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: { uPixelRatio: { value: 1 }, uTime: { value: 0 } },
        vertexShader: /* glsl */ `attribute float aSize; attribute vec3 aColor; attribute float aAlpha; uniform float uPixelRatio; varying vec3 vC; varying float vA;
          void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; vC = aColor; vA = aAlpha;
            gl_PointSize = aAlpha > 0.0 ? clamp(aSize * 600.0 * uPixelRatio / max(-mv.z, 0.4), 2.0, 260.0 * uPixelRatio) : 0.0; }`,
        fragmentShader: /* glsl */ `uniform float uTime; varying vec3 vC; varying float vA;
          void main(){ vec2 q = gl_PointCoord - 0.5; float d = length(q) * 2.0;
            // a flickering ball: a hot core, a ragged rim
            float rag = 0.85 + 0.15 * sin(atan(q.y, q.x) * 7.0 + uTime * 23.0);
            float a = exp(-d * d * 3.2 / rag) * vA; if (a < 0.02) discard;
            gl_FragColor = vec4(vC * a + vec3(1.0) * pow(a, 3.0) * 0.8, a); }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.points.frustumCulled = false;
    this.points.layers.set(2);
    game.scene.add(this.points);
    this.light = new THREE.PointLight(0x5effc8, 0, 9, 2);
    game.scene.add(this.light);
  }

  get particles() {
    return this.g.asuras.particles;
  }

  /** Fire gathering in a hand this frame (k 0..1 as the wind-up builds). */
  charge(pos, k) {
    this.charges.push({ x: pos.x, y: pos.y, z: pos.z, k });
  }

  /** Throw at Prady from `from` (Vector3) by `owner` (an Asura). */
  fire(from, owner, dmg, speed = 17) {
    const g = this.g;
    const P = g.player.position;
    // lead him: where he will be when it gets there (a little short of perfect: it can be outrun)
    const tgt = _v.set(P.x, g.player.feetY + 1.15, P.z);
    const dist = tgt.distanceTo(from);
    const tof = dist / speed;
    tgt.x += g.player.velocity.x * tof * 0.7;
    tgt.z += g.player.velocity.z * tof * 0.7;
    const grav = 6;
    const dir = _d.subVectors(tgt, from);
    const h = Math.hypot(dir.x, dir.z) || 1;
    const vel = new THREE.Vector3((dir.x / h) * speed, dir.y / tof + 0.5 * grav * tof, (dir.z / h) * speed);
    this.list.push({ pos: from.clone(), prev: from.clone(), vel, grav, dmg, owner, t: 0, reflected: false, passed: false });
    g.audio.play('fireball', { at: from, volume: 0.85, rate: 0.9 + Math.random() * 0.2, ref: 10 });
  }

  /** Damaru: every fire within r of p goes out. */
  douse(p, r) {
    for (const f of this.list) if (Math.hypot(f.pos.x - p.x, f.pos.z - p.z) < r) f.dead = 'douse';
  }

  clear() {
    this.list = [];
    this.flashes = [];
  }

  burst(p, size, hot) {
    this.flashes.push({ x: p.x, y: p.y, z: p.z, t: 0, life: 0.35, size, hot });
    this.particles.emitEmbers(p.x, p.y, p.z, 22, null, 0.9);
    this.particles.emitSmoke(p.x, p.y, p.z, 0.8);
    this.g.audio.play('ember-hiss', { at: p, volume: 0.8, rate: 0.7 });
    this.g.audio.play('thump', { at: p, volume: 0.5, rate: 0.9 });
  }

  update(dt, pixelRatio) {
    const g = this.g;
    const sdt = dt * this.timeScale;
    const P = g.player;
    for (const f of this.list) {
      if (f.dead) continue;
      f.t += sdt;
      f.prev.copy(f.pos);
      f.vel.y -= f.grav * sdt;
      const step = f.vel.length() * sdt;
      const dir = _d.copy(f.vel).normalize();
      // stone and walls
      const wall = step > 0 ? g.physics.castRay(f.pos, dir, step, g.player.collider, GROUPS.missile) : null;
      f.pos.addScaledVector(dir, wall !== null ? wall : step);
      if (wall !== null) {
        f.dead = 'wall';
        // a burst beside him still scorches
        const d = Math.hypot(f.pos.x - P.position.x, f.pos.z - P.position.z);
        if (!f.reflected && d < 1.3 && Math.abs(f.pos.y - (P.feetY + 0.8)) < 1.4 && !g.combat.untouchable) g.combat.receive({ from: f.pos, dmg: f.dmg * 0.4, heavy: false, knock: false });
        continue;
      }
      // the river puts it out
      if (f.pos.y < g.water.heightAt(f.pos.x, f.pos.z)) {
        f.dead = 'water';
        g.fx.spray(f.pos.x, g.water.heightAt(f.pos.x, f.pos.z), f.pos.z);
        g.audio.play('ember-hiss', { at: f.pos, volume: 0.9, rate: 0.6 });
        continue;
      }
      if (!f.reflected && !f.passed) {
        // Prady: his body is a capsule from the feet to the head
        const by = Math.max(P.feetY + 0.3, Math.min(P.feetY + 1.5, f.pos.y));
        if (Math.hypot(f.pos.x - P.position.x, f.pos.z - P.position.z) < 0.5 && Math.abs(f.pos.y - by) < 0.5) {
          const fp = this;
          const r = g.combat.receive({ from: f.prev, dmg: f.dmg, heavy: false, knock: false, attacker: { parried: () => fp.reflect(f) } });
          if (r === 'dodged' || r === 'none') f.passed = true;
          else if (r !== 'parried') f.dead = 'hit';
        }
      } else if (f.reflected) {
        // turned back: it seeks its thrower and burns whatever it meets
        const o = f.owner;
        if (o?.alive) {
          _a.set(o.pos.x, o.pos.y + o.height * 0.6, o.pos.z).sub(f.pos).normalize().multiplyScalar(f.vel.length());
          f.vel.lerp(_a, Math.min(1, sdt * 6));
        }
        const t = g.targets.touching(f.pos, 0.25);
        if (t?.enemy) {
          t.hit({ k: 1.3, dir: { x: dir.x, z: dir.z }, at: f.pos.clone(), sword: false, heavy: true, power: true, dmgOverride: 34 });
          f.dead = 'hit';
          g.achievements?.event('reflect', {});
        }
      }
      if (f.t > 4.5) f.dead = 'fizzle';
    }
    for (const f of this.list) if (f.dead && f.dead !== 'douse' && f.dead !== 'water' && f.dead !== 'gone') this.burst(f.pos, f.reflected ? 1.4 : 1, f.reflected);
    for (const f of this.list) if (f.dead === 'douse') this.particles.emitSmoke(f.pos.x, f.pos.y, f.pos.z, 0.6);
    this.list = this.list.filter((f) => !f.dead);
    // trails
    for (const f of this.list) {
      this.particles.emitEmbers(f.pos.x, f.pos.y, f.pos.z, 2, null, 0.2);
      if (Math.random() < 0.35) this.particles.emitSmoke(f.pos.x, f.pos.y, f.pos.z, 0.35);
    }
    // draw: the balls, the fire in hands, the bursts
    let n = 0;
    const put = (x, y, z, size, c, a) => {
      if (n >= MAX) return;
      this.pos.set([x, y, z], n * 3);
      this.size[n] = size;
      this.col.set([c.r, c.g, c.b], n * 3);
      this.alpha[n] = a;
      n++;
    };
    for (const f of this.list) put(f.pos.x, f.pos.y, f.pos.z, 0.6, f.reflected ? HOT : COLOR, 1);
    for (const c of this.charges) put(c.x, c.y, c.z, 0.2 + c.k * 0.4, COLOR, 0.5 + c.k * 0.5);
    for (const b of this.flashes) {
      b.t += dt;
      const k = b.t / b.life;
      put(b.x, b.y, b.z, (0.6 + k * 1.6) * b.size, b.hot ? HOT : COLOR, (1 - k) * (1 - k));
    }
    this.flashes = this.flashes.filter((b) => b.t < b.life);
    for (let i = n; i < MAX; i++) this.alpha[i] = 0;
    const A = this.points.geometry.attributes;
    A.position.needsUpdate = A.aSize.needsUpdate = A.aColor.needsUpdate = A.aAlpha.needsUpdate = true;
    this.points.visible = n > 0;
    this.points.material.uniforms.uPixelRatio.value = pixelRatio;
    this.points.material.uniforms.uTime.value += dt;
    // one light rides the nearest fire (its glow on the stone and on him)
    const lead = this.list[0] || this.charges[0] || this.flashes[0];
    this.light.intensity = lead ? 6 : 0;
    if (lead) this.light.position.set(lead.pos ? lead.pos.x : lead.x, (lead.pos ? lead.pos.y : lead.y) + 0.2, lead.pos ? lead.pos.z : lead.z);
    this.charges.length = 0;
  }

  /** A parry turned it: back at its thrower, faster and hotter. */
  reflect(f) {
    f.reflected = true;
    f.passed = true;
    f.grav = 0;
    const o = f.owner;
    const sp = f.vel.length() * 1.5;
    if (o?.alive) f.vel.set(o.pos.x - f.pos.x, o.pos.y + o.height * 0.6 - f.pos.y, o.pos.z - f.pos.z).normalize().multiplyScalar(sp);
    else f.vel.multiplyScalar(-1.5);
    this.g.audio.play('parry', { volume: 0.9, rate: 1.2 });
  }
}

/** A ball of fire leaving the hand: a roaring whoosh with a crackle. */
export function synthFireball(ctx) {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * 0.8);
  const b = ctx.createBuffer(1, n, sr);
  const d = b.getChannelData(0);
  let lp = 0;
  let lp2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const w = Math.random() * 2 - 1;
    lp += (w - lp) * 0.08;
    lp2 += (lp - lp2) * 0.2;
    const env = Math.min(1, t / 0.05) * Math.exp(-t * 3.2);
    const crack = Math.random() < 0.002 ? (Math.random() * 2 - 1) * 0.6 : 0;
    d[i] = (lp2 * 3.2 + (w - lp) * 0.12) * env + crack * Math.exp(-t * 2);
  }
  return b;
}
