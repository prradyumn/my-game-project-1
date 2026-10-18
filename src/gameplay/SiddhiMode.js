import { SHAKTI } from '../config.js';
import { MOVES } from './Combat.js';

// Siddhi Mode: the sandbox where everything Prady can do is his at once. Every siddhi, Shakti
// that never runs out, the talwar, no death, and a pack of shades that keeps rising to be cut down
// again. A panel lists every move; [ and ] pick any one of them (a blow, any animation clip, any
// of the Fab effects) and \ performs it; = runs the whole showcase, one after another.
//
// Entered from the test menu (title screen: Test, "Siddhi Mode"); it lasts until the next journey
// or test jump (restore()).

const PACK = 4; // shades kept alive round him

export class SiddhiMode {
  constructor(game) {
    this.g = game;
    this.on = false;
    this.items = [];
    this.i = 0;
    this.auto = 0; // seconds to the showcase's next item (0: not running)
    this.pack = [];
    this.respawn = 0;
    this.el = null;
    window.addEventListener('keydown', (e) => {
      if (!this.on || e.repeat || this.g.state !== 'play') return;
      if (e.code === 'BracketRight') this.pick(1);
      else if (e.code === 'BracketLeft') this.pick(-1);
      else if (e.code === 'Backslash') this.perform();
      else if (e.code === 'Equal') this.auto = this.auto ? 0 : 0.01;
      else if (e.code === 'Semicolon') this.el?.classList.toggle('mini');
      else return;
      e.preventDefault();
      this.draw();
    });
  }

  /** Everything he can do, in the order the showcase plays it. */
  build() {
    const g = this.g;
    const L = [];
    const P = (k, label) => L.push({ kind: 'Power', label, run: () => (g.powers.act = null, g.powers.press(k)), secs: k === 'thirdEye' ? 4 : 2.6 });
    P('damaru', 'Shiva’s Damaru (1)');
    P('trishul', 'Trishul (2)');
    P('thirdEye', 'Third Eye (3)');
    P('agniChakra', 'Agni Chakra (4)');
    for (const name of Object.keys(MOVES)) {
      if (!g.combat.clipOf(name) || !g.animator.clipActions[g.combat.clipOf(name)]) continue;
      L.push({ kind: 'Blow', label: name, run: () => this.blow(name), secs: 1.8 });
    }
    const V = g.vfx;
    const at = (d = 3.2) => {
      const p = g.player.position;
      const y = g.player.yaw;
      return { x: p.x + Math.sin(y) * d, y: g.player.feetY, z: p.z + Math.cos(y) * d };
    };
    const E = (label, run) => L.push({ kind: 'Effect', label, run, secs: 1.8 });
    E('Fireball (Fab: Realistic Starter)', () => V.explosion(at(4), 3.4));
    E('Fire burst', () => V.fireburst(at(), 1.8, { n: 4, spread: 1 }));
    E('Smoke', () => V.smoke(at(), 4, { size: 2 }));
    E('Smoke column', () => V.smokeColumn(at(4), 4, { life: 4 }));
    E('Dirt spray', () => V.dirt(at(), 0.8, 7, { size: 1.4 }));
    E('Crystal sigil (Fab: MagicCircle)', () => V.sigil(at(), 2.6, { color: [0.3, 0.6, 2.2], dur: 1.6 }));
    E('Shockwave with cracks', () => V.shockwave(at(), 4, { cracks: 1, linger: 2.4 }));
    E('Yantra', () => V.yantra(at(), 2.6, { dur: 1.6 }));
    E('Pillar of light', () => V.pillar(at(), 0.8, 6));
    E('Lightning', () => {
      const p = at();
      V.lightning(new g.player.position.constructor(p.x + 0.5, p.y + 9, p.z), new g.player.position.constructor(p.x, p.y, p.z), { width: 0.16, life: 0.5 });
    });
    E('Star glints (Fab: Anime Stars)', () => V.stars({ ...at(1.5), y: g.player.feetY + 1.3 }, 10, { size: 1.1 }));
    E('Sparks', () => V.sparks({ ...at(1.5), y: g.player.feetY + 1 }, { x: 0, y: 0.6, z: 0 }, 30, { speed: 7 }));
    E('Electric ring (Fab: Simple Lightning)', () => V.decal('electricRing', at(), 0.6, 3.6, { color: [0.7, 1.1, 3], dur: 0.45, hold: 0.5, flicker: 0.6, spin: 2 }));
    E('Zaps (Fab: Zap VFX)', () => V.zaps({ ...at(2), y: g.player.feetY + 1 }, 6, { size: 1.4, spread: 0.8, life: 0.4 }));
    E('Star flare (Fab: Stylized Fire)', () => V.flare({ ...at(2), y: g.player.feetY + 1.2 }, 3, { life: 0.5 }));
    E('Impact flare (Fab: Impact Frames)', () => V.flare({ ...at(2), y: g.player.feetY + 1.2 }, 3, { kind: 'flareImpact', life: 0.5 }));
    E('Anime slash (Fab: Sword Trails)', () => V.slashMark({ ...at(2), y: g.player.feetY + 1.2 }, 3, { rot: 0.4, life: 0.45 }));
    E('Dust ring (Fab: FX Variety)', () => V.decal('dustRing', at(), 1, 4, { color: [0.85, 0.78, 0.68], dur: 1.1, hold: 0.4 }));
    E('Spell circle (Fab: Free Spells)', () => V.decal('spellCircle', at(), 2, 4.5, { color: [1.6, 0.18, 0.1], dur: 0.7, hold: 1.5, spin: -0.4 }));
    E('Embers (Sparks & Embers look)', () => V.embers(at(), 60, { spread: 2 }));
    E('Fire slash (Fab: Flame Attack fire)', () => V.slash(g.player.position.clone().setY(g.player.feetY + 1), g.vfx.constructor.flatFrame(g.player.yaw), { r: 2.2, w: 0.9, arc: Math.PI * 2, fire: true, dur: 0.4, tail: 0.9 }));
    E('Impact frame', () => g.cinematics?.impactFrame?.(null, { dur: 0.12 }));
    // every animation clip he has (the blows above among them, played bare here)
    for (const name of Object.keys(g.animator.clipActions).sort()) {
      L.push({ kind: 'Clip', label: name, run: () => g.animator.play(name, { fadeIn: 0.12, fadeOut: 0.25, cancelOnMove: true }), secs: Math.min(3.5, g.animator.clipActions[name].getClip().duration + 0.3) });
    }
    this.items = L;
  }

  blow(name) {
    const c = this.g.combat;
    const t = this.pack.find((a) => a.alive);
    if (MOVES[name].sword && !c.armed) (c.setHasSword(true), (c.armed = true));
    if (t) c.forceMove(name, t, { noDash: true });
    else c.start(name, true);
  }

  enter({ ghat = 'dashashwamedh', u = 30, hours = 20 } = {}) {
    const g = this.g;
    this.on = true;
    g.siddhis.grantAll();
    g.powers.shakti = SHAKTI.max;
    g.powers.endless = true;
    g.combat.setHasSword(true);
    g.combat.armed = true;
    g.health.invincible = true;
    g.testMenu.placeOnGhat(ghat, u, 1, 0.6);
    if (hours != null) g.sky.setHours(hours);
    this.pack = [];
    this.respawn = 0.5;
    this.build();
    this.i = 0;
    this.auto = 0;
    this.panel();
    g.after?.(3.2, () => this.on && g.ui.toast('Siddhi Mode', 'Every power is yours.  [ ] choose · \\ perform · = showcase · ; hide', 6));
  }

  restore() {
    if (!this.on) return;
    this.on = false;
    this.auto = 0;
    this.g.health.invincible = false;
    this.el?.remove();
    this.el = null;
  }

  pick(d) {
    const n = this.items.length;
    this.i = (((this.i + d) % n) + n) % n;
  }

  perform() {
    const it = this.items[this.i];
    if (!it) return;
    try {
      it.run();
    } catch (e) {
      console.warn('Siddhi Mode:', it.label, e);
    }
  }

  update(dt) {
    if (!this.on) return;
    const g = this.g;
    if (g.state !== 'play') return;
    g.powers.shakti = SHAKTI.max;
    g.powers.endless = true;
    // (every siddhi stays given while the mode lasts, whatever restored a save under it)
    if (!g.powers.unlocked('agniChakra') || !g.powers.unlocked('damaru')) g.siddhis.grantAll();
    // the pack: the fallen are replaced, rising out of the ground round him
    this.pack = this.pack.filter((a) => a.alive);
    this.respawn -= dt;
    if (this.pack.length < PACK && this.respawn <= 0 && g.asuras.ready !== false) {
      this.respawn = 2.5;
      const p = g.player.position;
      const an = Math.random() * Math.PI * 2;
      const d = 6 + Math.random() * 3;
      const x = p.x + Math.sin(an) * d;
      const z = p.z + Math.cos(an) * d;
      try {
        const a = g.asuras.spawn('shade', { x, y: g.player.feetY, z, yaw: an + Math.PI }, { rise: true });
        if (a) this.pack.push(a);
      } catch (e) {
        this.respawn = 5;
      }
    }
    // the showcase: each item in turn, given its time
    if (this.auto > 0) {
      this.auto -= dt;
      if (this.auto <= 0) {
        this.perform();
        this.auto = this.items[this.i]?.secs ?? 2;
        this.pick(1);
        this.draw();
      }
    }
  }

  panel() {
    this.el?.remove();
    const el = document.createElement('div');
    el.className = 'siddhi-mode';
    el.innerHTML = `<style>
.siddhi-mode{position:fixed;right:16px;top:16px;width:300px;max-width:calc(100vw - 32px);z-index:40;color:#f3e6c8;font:13px/1.35 system-ui,sans-serif;background:rgba(20,10,4,.72);border:1px solid rgba(240,180,90,.45);border-radius:10px;padding:10px 12px;pointer-events:none;backdrop-filter:blur(4px)}
.siddhi-mode h3{margin:0 0 4px;font-size:15px;letter-spacing:.08em;color:#ffcf7a}
.siddhi-mode .keys{color:#cdb68f;font-size:12px;margin-bottom:8px}
.siddhi-mode ol{list-style:none;margin:0;padding:0}
.siddhi-mode li{padding:2px 6px;border-radius:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.6}
.siddhi-mode li.on{background:rgba(255,170,60,.28);opacity:1;color:#fff}
.siddhi-mode li b{display:inline-block;width:52px;font-weight:600;color:#ffb35c;font-size:11px}
.siddhi-mode.mini ol,.siddhi-mode.mini .keys{display:none}
</style><h3>SIDDHI MODE</h3><div class="keys">1 Damaru · 2 Trishul · 3 Third Eye · 4 Agni Chakra<br>Click light · hold heavy · sprint + attack · C roll · Q parry · E finisher<br><b>[ ]</b> choose · <b>\\</b> perform · <b>=</b> showcase · <b>;</b> hide</div><div class="pos"></div><ol></ol>`;
    document.body.appendChild(el);
    this.el = el;
    this.draw();
  }

  draw() {
    if (!this.el) return;
    const n = this.items.length;
    const rows = [];
    for (let k = -4; k <= 5; k++) {
      const j = (((this.i + k) % n) + n) % n;
      const it = this.items[j];
      rows.push(`<li class="${k === 0 ? 'on' : ''}"><b>${it.kind}</b>${it.label.replace(/</g, '&lt;')}</li>`);
    }
    this.el.querySelector('ol').innerHTML = rows.join('');
    this.el.querySelector('.pos').textContent = `${this.i + 1} / ${n}${this.auto ? '   ▶ showcase running' : ''}`;
  }
}
