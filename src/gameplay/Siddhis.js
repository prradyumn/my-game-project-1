import { EMBERS, PLAYER, SIDDHIS } from '../config.js';

// Siddhis: what Prady earns. Every rudraksha found in the world and every ember a slain Asura
// leaves behind can be offered for a siddhi on one of three paths (the Talwar, the Body, the
// Spirit; config.js SIDDHIS). Each siddhi needs the one before it on its path. The journal's
// Siddhi page shows the mandala; this file keeps the ledger and applies what is unlocked to the
// systems it changes (combat, health, swimming, the powers).

export class Siddhis {
  constructor(game) {
    this.g = game;
    this.unlocked = new Set();
    this.spentBeads = 0;
    this.embers = 0;
    this.embersTotal = 0;
    this.onChange = null;
  }

  serialize() {
    return { unlocked: [...this.unlocked], spentBeads: this.spentBeads, embers: this.embers, embersTotal: this.embersTotal };
  }

  restore(d) {
    this.unlocked = new Set(d?.unlocked || []);
    this.spentBeads = d?.spentBeads || 0;
    this.embers = d?.embers || 0;
    this.embersTotal = d?.embersTotal || this.embers;
    this.apply();
  }

  has(id) {
    return this.unlocked.has(id);
  }

  /** Rudraksha in hand: found, less what has been offered. */
  get beads() {
    return Math.max(0, (this.g.quest?.collected ?? 0) - this.spentBeads);
  }

  /** The siddhi before this one on its path (null for the first). */
  before(def) {
    const path = SIDDHIS.filter((s) => s.path === def.path);
    const i = path.indexOf(def);
    return i > 0 ? path[i - 1] : null;
  }

  /** 'owned' | 'ready' (can be bought now) | 'poor' (open, not enough) | 'locked' (needs the one before) */
  status(id) {
    const def = SIDDHIS.find((s) => s.id === id);
    if (!def) return 'locked';
    if (this.unlocked.has(id)) return 'owned';
    const prev = this.before(def);
    if (prev && !this.unlocked.has(prev.id)) return 'locked';
    return this.beads >= def.beads && this.embers >= def.embers ? 'ready' : 'poor';
  }

  buy(id) {
    if (this.status(id) !== 'ready') return false;
    const def = SIDDHIS.find((s) => s.id === id);
    this.spentBeads += def.beads;
    this.embers -= def.embers;
    this.unlocked.add(id);
    this.apply();
    const g = this.g;
    g.audio?.play('chime', { volume: 0.7, rate: 0.8 });
    g.audio?.play('bell', { volume: 0.4, rate: 1.1 });
    g.ui?.toast(def.name, def.text, 5);
    g.achievements?.event('siddhi', { id, count: this.unlocked.size });
    g.save?.();
    this.onChange?.();
    return true;
  }

  /** Test menu: every siddhi, no cost. */
  grantAll() {
    for (const s of SIDDHIS) this.unlocked.add(s.id);
    this.apply();
    this.onChange?.();
  }

  /** An Asura fell: its embers are Prady's. */
  addEmbers(kind, mini = false) {
    const n = mini ? EMBERS.mini : EMBERS[kind] ?? 2;
    this.embers += n;
    this.embersTotal += n;
    this.onChange?.();
    return n;
  }

  /** Push what is unlocked into the systems it changes. */
  apply() {
    const g = this.g;
    const has = (id) => this.unlocked.has(id);
    const c = g.combat;
    if (c) {
      c.perks = { combo4: has('combo4'), riposte: has('riposte'), charged: has('charged'), mercy: has('mercy'), windStep: has('windStep'), vajra: has('prana2') };
    }
    const p = g.player;
    if (p) {
      p.swimMul = has('river') ? 1.25 : 1;
      p.breathMax = PLAYER.breathSeconds * (g.missions?.perks?.breath ? 1.8 : 1) * (has('river') ? 2 : 1);
      p.breath = Math.min(p.breath, p.breathMax);
    }
    if (g.health) {
      const shrines = g.world?.galis?.shrines?.length;
      const allShrines = shrines && g.worldState?.shrines?.size >= shrines;
      g.health.setMax(100 + (allShrines ? 10 : 0) + (has('prana1') ? 25 : 0) + (has('prana2') ? 35 : 0));
    }
    if (g.powers) g.powers.fillMul = has('kundalini') ? 1.4 : 1;
  }
}
