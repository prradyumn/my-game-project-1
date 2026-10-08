import * as THREE from 'three';
import { MissionMarkers } from '../world/MissionMarkers.js';
import ferry from './missions/Ferry.js';
import lens from './missions/Lens.js';
import bell from './missions/SunkenBell.js';
import diyas from './missions/TwentyOneDiyas.js';
import marigolds from './missions/Marigolds.js';
import cleanGanga from './missions/CleanGanga.js';
import lostChild from './missions/LostChild.js';
import yaksha from './missions/Yaksha.js';
import akhara from './missions/Akhara.js';

// Side missions: people of Kashi who ask Prady for help. Each mission lives in its own file
// (src/gameplay/missions/) and is a plain object:
//   { id, title, giver: { name, avatarId, clip, at() -> {x,y,z,yaw}, hours }, offer: [lines],
//     start(m), update(m, dt), interact?(m) -> { prompt, action } | null, on?(m, event, data),
//     stop?(m), outro: [lines], reward: { punya, note, perk? } }
// `m` is the mission's runtime (below): objective text, markers, talk, done / fail.
// One mission at a time; givers wait at their spots (with a small golden flame over them)
// during their hours. Progress and perks are saved with the game.

const TALK_R = 2.8;
const _v = new THREE.Vector3();

// ---------------------------------------------------------------- the runtime
class MissionRun {
  constructor(sys, def) {
    this.sys = sys;
    this.g = sys.g;
    this.def = def;
    this.state = {};
    this.text = '';
    this.meter = null;
    this.marks = [];
    this.actors = [];
    this.finished = false;
  }

  objective(text, meter = null) {
    this.text = text;
    this.meter = meter;
  }

  /** A sign this frame: kind 'objective' | 'item' | 'giver'; compass: also show on the compass. */
  mark(kind, pos, compass = kind === 'objective') {
    this.marks.push({ kind, pos, compass });
  }

  actor(o) {
    const a = this.g.crowd?.addActor(o);
    if (a) this.actors.push(a);
    return a;
  }

  dropActor(a) {
    this.g.crowd?.removeActor(a);
    this.actors = this.actors.filter((x) => x !== a);
  }

  say(lines, opts) {
    this.sys.talk(lines, opts);
  }

  toast(title, body, secs) {
    this.g.ui.toast(title, body, secs);
  }

  done() {
    if (this.finished) return;
    this.finished = true;
    this.sys.complete(this);
  }

  fail(reason) {
    if (this.finished) return;
    this.finished = true;
    this.sys.abandon(this, reason);
  }

  get player() {
    return this.g.player;
  }

  get hours() {
    return this.g.sky.hours;
  }

  near(p, r) {
    const q = this.g.player.position;
    return Math.hypot(q.x - p.x, q.z - p.z) < r && Math.abs((p.y ?? this.g.player.feetY) - this.g.player.feetY) < 3.5;
  }
}

export class Missions {
  constructor(game, saved = null) {
    this.g = game;
    this.defs = [ferry, lens, bell, diyas, marigolds, cleanGanga, lostChild, yaksha, akhara].map((f) => f(game));
    this.done = new Set(saved?.done || []);
    this.punya = saved?.punya || 0;
    this.perks = saved?.perks || {};
    this.active = null;
    this.givers = new Map(); // id -> crowd actor
    this.dialogue = null;
    this.markers = new MissionMarkers();
    game.scene.add(this.markers.mesh);
    this.applyPerks();
    game.ui.setPunya(this.punya);
    this._compassKey = '';
  }

  serialize() {
    return { done: [...this.done], punya: this.punya, perks: this.perks };
  }

  applyPerks() {
    const g = this.g;
    if (this.perks.oar) g.boat.power = 1.25;
    if (this.perks.breath) g.player.breathMax = 35 * 1.8;
    if (this.perks.purity) g.quest.purityBonus = 0.06;
    g.combat?.setHasSword(!!this.perks.sword);
  }

  available(def) {
    if (this.done.has(def.id)) return false;
    const h = def.giver.hours;
    if (!h) return true;
    const t = this.g.sky.hours;
    return h[0] <= h[1] ? t >= h[0] && t <= h[1] : t >= h[0] || t <= h[1];
  }

  // ------------------------------------------------------------ talk
  /** lines: [[who, text], ...]; opts.choices: [{ key, label, then() }] on the last line. */
  talk(lines, opts = {}) {
    this.dialogue = { lines, i: 0, opts };
    this.g.player.inputLocked = true;
    this.showLine();
  }

  showLine() {
    const d = this.dialogue;
    const [who, text] = d.lines[d.i];
    const last = d.i === d.lines.length - 1;
    this.g.ui.showDialogue(who, text, last && d.opts.choices ? d.opts.choices : null);
    if (this.g.audio && d.i === 0) this.g.audio.play('bell', { volume: 0.06, rate: 1.6 });
  }

  /** Keys while talking. Returns true if the key was taken. */
  key(code) {
    const d = this.dialogue;
    if (!d) return false;
    const last = d.i === d.lines.length - 1;
    if (last && d.opts.choices) {
      const c = d.opts.choices.find((x) => code === `Key${x.key}` || code === `Digit${x.key}`);
      if (!c) return true;
      this.endTalk();
      c.then?.();
      return true;
    }
    if (code !== 'KeyE' && code !== 'Space' && code !== 'Enter') return true;
    if (last) {
      this.endTalk();
      d.opts.then?.();
    } else {
      d.i++;
      this.showLine();
    }
    return true;
  }

  endTalk() {
    this.dialogue = null;
    this.g.ui.hideDialogue();
    this.g.player.inputLocked = false;
  }

  // ------------------------------------------------------------ flow
  offer(def) {
    const giver = this.givers.get(def.id);
    if (giver) this.g.crowd.gesture(giver, 'talk', 3, this.g.player.position);
    this.talk(def.offer, {
      choices: [
        { key: 'E', label: 'Help', then: () => this.start(def) },
        { key: 'Q', label: 'Not now', then: () => {} },
      ],
    });
  }

  start(def) {
    const run = new MissionRun(this, def);
    run.giver = this.givers.get(def.id) || null;
    this.active = run;
    def.start(run);
    this.g.ui.toast(def.title, 'A new task', 2.6);
    this.g.audio.play('bell', { volume: 0.35 });
  }

  complete(run) {
    const def = run.def;
    this.done.add(def.id);
    this.punya += def.reward.punya;
    if (def.reward.perk) this.perks[def.reward.perk] = true;
    this.applyPerks();
    this.g.ui.setPunya(this.punya);
    const finish = () => {
      this.cleanup(run);
      this.g.ui.toast(`${def.title} · complete`, `+${def.reward.punya} punya${def.reward.note ? ` · ${def.reward.note}` : ''}`, 5);
      this.g.audio.play('ignite', { volume: 0.5 });
      this.g.save();
    };
    if (def.outro?.length) this.talk(def.outro, { then: finish });
    else finish();
  }

  abandon(run, reason) {
    this.cleanup(run);
    if (reason) this.g.ui.toast(run.def.title, reason, 4);
  }

  cleanup(run) {
    run.def.stop?.(run);
    for (const a of run.actors) this.g.crowd?.removeActor(a);
    run.actors = [];
    if (this.active === run) this.active = null;
    this.g.ui.setMission(null);
  }

  /** J: ask whether to set the current task aside (it can be taken up again later). */
  journal() {
    const run = this.active;
    if (!run || this.dialogue) return;
    this.talk([['Prady', `${run.def.title}: ${run.text}`]], {
      choices: [
        { key: 'E', label: 'Keep going', then: () => {} },
        { key: 'Q', label: 'Set it aside for now', then: () => run.fail('Set aside. Its giver will be waiting at the same place.') },
      ],
    });
  }

  emit(name, data) {
    this.active?.def.on?.(this.active, name, data);
  }

  onEvent(name, data) {
    this.emit(name, data);
  }

  // ------------------------------------------------------------ per frame
  interaction() {
    if (this.dialogue) return null;
    const run = this.active;
    if (run) {
      const x = run.def.interact?.(run);
      if (x) return x;
    }
    if (run) return null;
    const p = this.g.player.position;
    for (const def of this.defs) {
      const a = this.givers.get(def.id);
      if (!a || !this.available(def)) continue;
      if (Math.hypot(a.x - p.x, a.z - p.z) < TALK_R && Math.abs(a.y - this.g.player.feetY) < 2) return { prompt: `Talk to ${def.giver.name}`, action: () => this.offer(def) };
    }
    return null;
  }

  update(dt) {
    const g = this.g;
    if (!g.crowd) return;
    // givers: at their spots during their hours (while no other task is in hand)
    for (const def of this.defs) {
      let a = this.givers.get(def.id);
      const want = this.available(def) && (!this.active || this.active.def === def);
      if (want && !a) {
        const at = def.giver.at();
        a = g.crowd.addActor({ avatarId: def.giver.avatarId, x: at.x, y: at.y, z: at.z, yaw: at.yaw, seatY: at.seatY, feetY: at.feetY, clip: def.giver.clip || 'idle', name: def.giver.name });
        if (def.giver.tint) a.tint = def.giver.tint;
        if (def.giver.low) a.low = true;
        this.givers.set(def.id, a);
      } else if (!want && a && !(this.active?.def === def)) {
        g.crowd.removeActor(a);
        this.givers.delete(def.id);
      }
    }
    const run = this.active;
    this.markers.begin();
    if (run) {
      run.marks.length = 0;
      run.def.update(run, dt);
      if (this.active === run) {
        g.ui.setMission({ title: run.def.title, text: run.text, meter: run.meter });
        for (const mk of run.marks) this.markers.add(mk.kind, mk.pos, 1, 0.3);
      }
    } else {
      for (const def of this.defs) {
        const a = this.givers.get(def.id);
        if (!a || !this.available(def)) continue;
        const d = Math.hypot(a.x - g.camera.position.x, a.z - g.camera.position.z);
        if (d < 90) this.markers.add('giver', _v.set(a.x, a.y + 2.35, a.z), 1 - Math.max(0, (d - 70) / 20), a.id * 0.37);
      }
    }
    this.markers.end(dt);
    this.updateCompass();
  }

  updateCompass() {
    const ui = this.g.ui;
    const list = [];
    const run = this.active;
    if (run) {
      for (const mk of run.marks) if (mk.compass) list.push({ id: `m${list.length}`, name: run.def.title, kind: 'mission', pos: mk.pos });
    } else {
      for (const def of this.defs) {
        const a = this.givers.get(def.id);
        if (a && this.available(def)) list.push({ id: def.id, name: def.giver.name, kind: 'giver', pos: a });
      }
    }
    // rebuild the compass marks only when the set changes; positions are live objects
    const key = list.map((m) => m.id + m.kind).join('|') + (run ? run.def.id : '');
    const base = ui.compassMarks.filter((m) => m.kind !== 'mission' && m.kind !== 'giver');
    if (key !== this._compassKey) {
      this._compassKey = key;
      ui.setCompassMarkers([...base.map(({ el, ...m }) => m), ...list]);
    } else {
      const live = ui.compassMarks.filter((m) => m.kind === 'mission');
      live.forEach((m, i) => (m.pos = list[i]?.pos || m.pos));
    }
  }
}
