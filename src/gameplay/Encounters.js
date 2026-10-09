import * as THREE from 'three';
import { ghatById, ghatToWorld, PROFILE_LEN } from '../world/WorldLayout.js';

// Fights with a shape: waves of Asuras rising out of the river at one ghat, the boss's three
// phases, and what happens around them (battle music swells, the people flee, the camera
// knows to frame the enemies). The story stages encounters; the test menu jumps into them.
//
//   start({ ghat, u, waves: [{ n, kind }...], boss?, onWin, onLose, title })
//
// A wave comes when the last one is down (or a few seconds into it, for the bigger ones). The
// encounter ends when every wave is beaten (onWin) or is abandoned (clear()).

const _v = new THREE.Vector3();

export class Encounters {
  constructor(game) {
    this.g = game;
    this.cur = null;
    this.music = 0; // 0..1 battle-music level (Game mixes it)
  }

  get active() {
    return !!this.cur;
  }

  /** Begin an encounter at ghat `ghat`, around u (m along the ghat). */
  async start(def) {
    this.clear();
    const g = this.g;
    await g.asuras.load();
    const gh = ghatById(def.ghat);
    this.cur = { def, gh, wave: -1, t: 0, waveT: 0, done: false, boss: null, phase: 0 };
    if (def.title) g.ui.showRegion(def.title);
    this.nextWave();
  }

  nextWave() {
    const c = this.cur;
    const g = this.g;
    c.wave++;
    c.waveT = 0;
    const w = c.def.waves[c.wave];
    if (!w) return this.win();
    const P = g.player.position;
    const u = c.def.u ?? 40;
    // rise in front of the hero, along the waterline
    const at = ghatToWorld(c.gh, u + (Math.random() - 0.5) * 8, PROFILE_LEN - 2);
    const goal = { x: P.x, z: P.z };
    if (w.kind === 'boss') {
      g.asuras.riseFromRiver({ x: at.x, z: at.z, n: 1, kind: 'boss', goal, opts: { name: w.name || 'Andhaka', scale: 1 } }).then(([b]) => {
        c.boss = b;
        b.title = w.title || 'the Blind Darkness';
        b.phaseAt = [0.66, 0.33];
        g.audio.play('andhaka-roar', { volume: 1, rate: 0.8 });
        g.camRig.shake(0.5);
      });
    } else {
      g.asuras.riseFromRiver({ x: at.x, z: at.z, n: w.n, kind: w.kind || 'shade', goal });
    }
    if (c.wave > 0) g.ui.toast(c.def.waveText?.[c.wave] || 'More rise from the river', '', 2.5);
  }

  win() {
    const c = this.cur;
    if (!c || c.done) return;
    c.done = true;
    const g = this.g;
    g.slowMo(0.35, 0.9);
    g.after(1.4, () => {
      const def = c.def;
      this.cur = null;
      g.ui.setBoss(null);
      def.onWin?.(c.boss);
    });
  }

  /** Abandon (test jump, story reset): everyone goes. */
  clear() {
    this.cur = null;
    this.g.asuras.clear();
    this.g.ui.setBoss(null);
  }

  onPlayerRevived() {
    // a fall: the Asuras sink back into the river and the fight begins again from its wave
    const c = this.cur;
    if (!c) return;
    const def = c.def;
    this.g.asuras.clear();
    if (def.onLose) return def.onLose();
    this.g.after(2.5, () => this.start(def));
  }

  onEvent() {}

  update(dt) {
    const c = this.cur;
    const g = this.g;
    const fighting = g.asuras.active;
    this.music += ((fighting ? 1 : 0) - this.music) * Math.min(1, dt * (fighting ? 1.5 : 0.35));
    if (!c || c.done) return;
    c.t += dt;
    c.waveT += dt;
    // the boss's phases: at two thirds and one third it roars, calls shades, burns brighter
    const b = c.boss;
    if (b?.alive) {
      const f = b.hp / b.maxHp;
      if (b.phaseAt.length && f < b.phaseAt[0]) {
        b.phaseAt.shift();
        c.phase++;
        b.rage = c.phase * 0.5;
        b.K = { ...b.K, speed: b.K.speed * 1.15, run: b.K.run * 1.15 };
        b.stagger(1.4);
        c.def.onPhase?.(c.phase, b);
        g.audio.play('andhaka-roar', { at: b.pos, volume: 1, rate: 0.7 + c.phase * 0.08 });
        g.camRig.shake(0.7);
        g.ui.toast(c.phase === 1 ? 'Andhaka calls the dark' : 'Andhaka burns with rage', c.phase === 1 ? 'Shades rise to defend him.' : 'Beware the stomp: dodge, it cannot be blocked.', 3.5);
        const P = g.player.position;
        const at = ghatToWorld(c.gh, (c.def.u ?? 40) + (c.phase === 1 ? -10 : 10), PROFILE_LEN - 2);
        // (never more than three shades beside him: the fight is with Andhaka, not a crowd)
        const alive = g.asuras.list.filter((a) => a.alive && !a.K.boss).length;
        const n = Math.max(0, Math.min(2, 3 - alive));
        if (n) g.asuras.riseFromRiver({ x: at.x, z: at.z, n, kind: 'shade', goal: { x: P.x, z: P.z } });
      }
    }
    const alive = g.asuras.list.filter((a) => a.alive).length;
    const loading = c.waveT < 1.5;
    if (!loading && alive === 0 && (!b || !b.alive)) this.nextWave();
  }

  /** Where the camera / lock-on should look first: the nearest Asura. */
  nearest(p) {
    let best = null;
    let bd = Infinity;
    for (const a of this.g.asuras.list) {
      if (!a.alive) continue;
      const d = _v.set(a.pos.x - p.x, 0, a.pos.z - p.z).length();
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  }
}
