import { ASSET_MANIFEST } from '../core/Assets.js';

// The score: what music plays when. Exploring, it comes in cues, never as a wall of sound: the
// raga of the hour (Bhairav on bansuri at dawn, Desh on sitar by day, Yaman at the evening aarti,
// Malkauns in the night) plays through once, then the ghats have the stage (the river, the bells,
// the crowd) for a minute or two before the next. A cue also comes in at a moment: the first
// time Prady reaches a ghat, the sun coming up or going down.
//
// Danger is layered over it: Asuras rising out of the river or keeping their distance bring the
// tension cue (low dhol pulses, a dark drone, sarangi); once one is on him, BattleMusic takes
// over (Score.fight drives it) and the tension falls away. reveal() plays the establishing-shot
// swell over everything (Cinematics). All of it fetched after the game has begun.

const PERIODS = [
  [4.5, 'dawn'],
  [8.5, 'day'],
  [16.5, 'evening'],
  [20, 'night'],
];
// the cues of each part of the day ('river': the old meditative loop, played through once)
const CUES = { dawn: ['dawn', 'river'], day: ['day', 'river'], evening: ['evening'], night: ['night'] };
const REST = [55, 130]; // seconds of the ghats alone between cues
const LEVEL = 0.8; // exploration cues sit under the world, not on top of it
const TENSION = 0.9;
const ENGAGED = 16; // metres: an Asura this close (and up out of the river) means a fight

const periodOf = (h) => {
  let p = 'night';
  for (const [from, name] of PERIODS) if (h >= from) p = name;
  return p;
};

export class Score {
  constructor(game) {
    this.g = game;
    this.cur = null; // the exploration cue playing
    this.period = null;
    this.rest = 6; // seconds until the next cue (the first comes soon after the game begins)
    this.turn = {}; // which cue of each period played last
    this.fight = 0; // 0..1: an Asura on him (BattleMusic plays this)
    this.tension = 0; // 0..1: Asuras about, none on him yet
    this.th = null;
    this.rev = null; // the establishing-shot swell
    this.seen = new Set();
    this.duck = 1;
    this.hitAt = -9; // (Game.onCombatEvent: a blow given or taken)
    this.soon = false;
  }

  prefetch() {
    const a = this.g.audio;
    for (const [k, url] of Object.entries(ASSET_MANIFEST.score)) a.fetchBuffer(`score-${k}`, url);
  }

  /** The next exploration cue now, if none is playing (a first visit, the sun coming up). */
  moment() {
    if (!this.cur || this.cur.ended) this.rest = Math.min(this.rest, 1.5);
    else this.soon = true; // (straight after the one playing)
  }

  /** Prady is in region `name` (Game.updateRegion): the first visit to each is a moment. */
  region(name) {
    if (!name || this.seen.has(name)) return;
    const first = this.seen.size === 0;
    this.seen.add(name);
    if (!first) this.moment();
  }

  /** The establishing-shot swell, from `offset` s (its peak is 31–39 s in), over everything. */
  reveal(offset = 0) {
    this.rev?.stop(1.5);
    this.rev = this.g.audio.cue('score-reveal', { volume: 0, offset });
    this.rev?.setVolume(1, 0.6);
    return !!this.rev;
  }

  endReveal(fade = 3) {
    this.rev?.stop(fade);
    this.rev = null;
  }

  _next() {
    const list = CUES[this.period];
    const i = ((this.turn[this.period] ?? -1) + 1) % list.length;
    const name = list[i];
    const key = name === 'river' ? 'music' : `score-${name}`;
    const h = this.g.audio.cue(key, { volume: 0 });
    if (!h) return null; // (still on its way: the same cue, a moment later)
    this.turn[this.period] = i;
    h.setVolume(LEVEL * this.duck, 1.2);
    return h;
  }

  update(dt) {
    const g = this.g;
    if (!g.audio.ctx || !g.loops) return;
    // danger: Asuras up (tension), one of them on him (the fight)
    const P = g.player.position;
    let up = false;
    let on = false;
    for (const a of g.asuras.list) {
      if (!a.alive) continue;
      up = true;
      if (a.state !== 'rise' && Math.hypot(a.pos.x - P.x, a.pos.z - P.z) < ENGAGED) on = true;
    }
    // (a hit taken or given is a fight whatever the distance)
    if (up && g.health.time - this.hitAt < 3) on = true;
    this.fight += ((on ? 1 : 0) - this.fight) * Math.min(1, dt * (on ? 1.5 : 0.35));
    const wantT = up && !on ? 1 : 0;
    this.tension += (wantT - this.tension) * Math.min(1, dt * (wantT ? 0.8 : 0.5));
    if (!this.th && this.tension > 0.02 && g.audio.buffers['score-tension']) this.th = g.audio.cue('score-tension', { volume: 0 });
    if (this.th) {
      this.th.setVolume(this.tension * TENSION * (1 - this.fight), 0.3);
      if (this.th.ended || (this.tension < 0.01 && this.fight < 0.01) || (!up && this.tension < 0.05)) {
        this.th.stop(0.5);
        this.th = null;
      }
    }
    // exploration steps aside for danger, a race, a reveal
    const race = g.race?.music ?? 0;
    this.duck = (1 - Math.max(this.fight, this.tension, race)) * (this.rev && !this.rev.ended ? 0.1 : 1);
    if (this.rev?.ended) this.rev = null;
    const period = periodOf(g.sky.hours);
    if (period !== this.period) {
      // the sun coming up or going down: the new hour's music, as soon as the last cue is done
      if (this.period) this.moment();
      this.period = period;
    }
    const c = this.cur;
    if (c && !c.ended) {
      // (out on a breath: a loop cut to one pass has no ending of its own)
      c.setVolume(c.left() < 4 ? 0 : LEVEL * this.duck, c.left() < 4 ? 1.2 : 0.8);
      // (a long fight: the cue that was playing is let go rather than resumed half-way)
      if (this.duck < 0.05 && this.fight > 0.9) {
        c.stop(2);
        this.cur = null;
        this.rest = REST[0] * 0.5;
      }
      return;
    }
    if (c?.ended) {
      this.cur = null;
      this.rest = this.soon ? 8 : REST[0] + Math.random() * (REST[1] - REST[0]);
      this.soon = false;
    }
    if (this.duck < 0.5 || g.state !== 'play') return;
    this.rest -= dt;
    if (this.rest <= 0) {
      this.cur = this._next();
      if (!this.cur) this.rest = 3; // (not fetched yet)
    }
  }
}
