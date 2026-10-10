import * as THREE from 'three';
import { ASSET_MANIFEST } from '../core/Assets.js';

// The voices of the ghats. Now and then someone really standing there calls out: a chai-wallah,
// a flower seller, a pilgrim's "Har Har Mahadev", a boatman touting a ride, a priest's mantra, a
// dhobi shouting to his friend; a man's line from a man, a woman's from a woman, in 3D from where
// they stand. And the crowd answers Prady: "Arre, dhyan se!" when he barges past at a run, a gasp
// when he runs up a haveli, "Talwar! Hato!" when he draws near them, screams when the Asuras rise,
// cheers when the last one falls. Lines: ASSET_MANIFEST.barks (Gemini TTS, tools/gemini-tts.mjs);
// a line's id ends -m or -f for who says it.

const AMBIENT = [7, 15]; // seconds between calls while there are people about
const HEAR = 22; // metres: the speaker of an ambient call
const _p = new THREE.Vector3();

export class Barks {
  constructor(game) {
    this.g = game;
    this.next = 5;
    this.cool = {}; // group -> time it may be used again
    this.recent = []; // ids heard lately (no repeats back to back)
    this.time = 0;
    this.prev = { act: null, up: false, armed: false };
  }

  load() {
    const a = this.g.audio;
    for (const ids of Object.values(ASSET_MANIFEST.barks.groups)) for (const id of ids) a.fetchBuffer(`bark-${id}`, ASSET_MANIFEST.barks.url(id));
  }

  sexOf(s) {
    return this.g.crowd?.avatars.get(s.avatarId)?.def.sex ?? null;
  }

  /** People in a body within [minD, maxD] of p (nearest first), who can say a line. */
  people(p, maxD, minD = 0, test = null) {
    const out = [];
    for (const s of this.g.crowd?.live ?? []) {
      if (!s.inst || !s.wanted) continue;
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d < minD || d > maxD || Math.abs((s.y ?? p.y) - p.y) > 6) continue;
      if (test && !test(s)) continue;
      out.push({ s, d });
    }
    return out.sort((a, b) => a.d - b.d);
  }

  /**
   * Someone among `who` says a line of `group` (cooling down for `cool` s). The speaker is the
   * first whose voice the group has (a man or a woman); returns true if it was said.
   */
  say(group, who, cool = 0, opts = {}) {
    if ((this.cool[group] ?? 0) > this.time) return false;
    const ids = ASSET_MANIFEST.barks.groups[group] || [];
    const a = this.g.audio;
    for (const { s } of who) {
      const sex = this.sexOf(s);
      const fits = ids.filter((id) => {
        const v = id.match(/-([mf])\d?$/)?.[1];
        return a.buffers[`bark-${id}`] && (!v || !sex || v === sex) && !this.recent.includes(id);
      });
      if (!fits.length) continue;
      const id = fits[Math.floor(Math.random() * fits.length)];
      _p.set(s.x, (s.y ?? this.g.player.feetY) + (s.seatY !== undefined ? 1.1 : 1.6), s.z);
      a.play(`bark-${id}`, { at: _p, ref: opts.ref ?? 5, volume: opts.volume ?? 1, channel: 'ambience', delay: opts.delay ?? 0, rate: 0.97 + Math.random() * 0.06 });
      this.recent.push(id);
      if (this.recent.length > 6) this.recent.shift();
      this.cool[group] = this.time + cool;
      // (a cheer comes with a wave)
      if (opts.gesture && s.inst) s.pending = { at: this.g.crowd.time + 0.2, name: opts.gesture, dur: 2 };
      return true;
    }
    return false;
  }

  update(dt) {
    const g = this.g;
    if (!g.crowd || g.state !== 'play' || !g.audio.ctx) return;
    this.time += dt;
    const P = g.player.position;
    const feet = { x: P.x, y: g.player.feetY, z: P.z };
    // ---- answering Prady
    const act = g.traversal?.act?.type ?? null;
    if ((act === 'wallrun' || act === 'hang') && this.prev.act !== act && this.prev.act !== 'wallrun') this.say('climb', this.people(feet, 18, 3), 25, { ref: 8 });
    this.prev.act = act;
    const armed = !!g.combat?.armed;
    const up = !!g.asuras?.active;
    if (armed && !this.prev.armed && !up) this.say('sword', this.people(feet, 7), 30);
    this.prev.armed = armed;
    if (up && !this.prev.up) {
      // the Asuras rise: two voices, one after the other
      const who = this.people(feet, 30);
      if (this.say('fear', who, 0, { ref: 9 })) this.say('fear', who.slice(1), 12, { ref: 9, delay: 0.9 + Math.random() * 0.6 });
    }
    if (!up && this.prev.up && !g.combat?.dead && !g.health?.dead) {
      // the last one falls: the ones who stayed (or come back) cheer
      g.after?.(1.4, () => {
        const who = this.people(g.player.position, 26);
        if (this.say('cheer', who, 0, { ref: 9, gesture: 'wave' })) this.say('cheer', who.slice(1), 20, { ref: 9, delay: 1.1, gesture: 'wave' });
      });
    }
    this.prev.up = up;
    if (up) return;
    if (g.player.speed > 4.2 && g.player.state === 'ground') {
      const near = this.people(feet, 1.5);
      if (near.length) this.say('bumped', near, 6, { ref: 4 });
    }
    // ---- the ghats calling out, now and then
    this.next -= dt;
    if (this.next > 0) return;
    this.next = AMBIENT[0] + Math.random() * (AMBIENT[1] - AMBIENT[0]);
    const h = g.sky.hours;
    if (h < 5 || h > 22) return; // (the night is quiet)
    const who = this.people(feet, HEAR, 4);
    if (!who.length) return;
    // a boatman or a priest near says his own; else whoever is there, by the hour
    const kindNear = (k) => who.filter((w) => w.s.kind === k);
    const boat = kindNear('boatman');
    if (boat.length && Math.random() < 0.6 && this.say('boatman', boat, 20)) return;
    const priest = who.filter((w) => w.s.aarti && w.s.kind === 'priest');
    if (priest.length && h > 17 && this.say('priest', priest, 25)) return;
    const groups = h > 17 && h < 19.5 ? ['dusk', 'pilgrim', 'vendor'] : ['vendor', 'pilgrim', 'vendor', 'pilgrim', 'work'];
    const order = groups.sort(() => Math.random() - 0.5);
    for (const grp of order) if (this.say(grp, who.slice(0, 6).sort(() => Math.random() - 0.5), 10)) return;
  }
}
