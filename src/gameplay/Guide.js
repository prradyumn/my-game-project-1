import { ACTIONS, keyName } from '../core/Input.js';
import { groundHeight } from '../world/WorldLayout.js';

// The game's flow: what a new player needs told once, and a way back after a fall.
//
//   hints      the first time Prady hangs from a ledge, takes a ladder, stands on the rooftops,
//              swings from a pole, sees an Asura's glint... one short card with the keys for it
//              (as the player has bound them). Once each, ever (kept on this machine); one at a
//              time, a few seconds apart; never in a cutscene or a conversation. Settings:
//              "First-time hints" turns them off.
//   way back   a long fall from the rooftops (into a lane, onto the ghat, into the river): for a
//              few seconds, E climbs him back up to where he was on the roof. A fade, no walk.

const KEY = 'prady-hints-v1';
const GAP = 7; // seconds between two cards

export class Guide {
  constructor(game) {
    this.g = game;
    this.seen = new Set();
    try {
      for (const id of JSON.parse(localStorage.getItem(KEY) || '[]')) this.seen.add(id);
    } catch {
      // (no storage: hints this session only)
    }
    this.queue = [];
    this.wait = 4; // (not straight over the opening)
    this.t = 0;
    // the way back up
    this.roofSpots = []; // [{ x, y, z, yaw, t }] on a roof, the last few seconds
    this.highest = null; // where a fall began
    this.back = null; // { spot, until }
    this.HINTS = this.defineHints();
  }

  /** A key as the player has bound it. */
  k(id) {
    const a = ACTIONS.find((x) => x.id === id);
    return keyName(this.g.settings.bindings?.[id] || a?.key);
  }

  defineHints() {
    const g = this.g;
    const act = () => g.traversal?.act?.type;
    const k = (id) => this.k(id);
    return [
      { id: 'hang', when: () => act() === 'hang', title: 'Hanging from a ledge', text: () => `${k('left')} / ${k('right')} shimmy along it · ${k('forward')} or ${k('jump')} up to the next · ${k('back')} down · ${k('dodge')} lets go` },
      { id: 'ladder', when: () => act() === 'ladder', title: 'On a ladder', text: () => `${k('forward')} / ${k('back')} climb · ${k('sprint')} faster · ${k('dodge')} slides down · ${k('jump')} lets go` },
      {
        id: 'roofs',
        when: () => {
          const p = g.player;
          return p.state === 'ground' && p.grounded && p.feetY - groundHeight(p.position.x, p.position.z) > 12;
        },
        title: 'The rooftops of Kashi',
        text: () => 'Planks and beams join the roofs. Run at a parapet to vault it, even down onto a lower roof across a lane. Ladders climb higher; ropes slide you down to the next row.',
      },
      { id: 'beam', when: () => g.traversal?.onBeam, title: 'A balance beam', text: () => 'Slow and steady: he walks it with his arms out.' },
      { id: 'swing', when: () => act() === 'swing', title: 'Swinging from a pole', text: () => `${k('forward')} pumps the swing · ${k('jump')} lets go at the top of the arc, out to the far ledge` },
      { id: 'zip', when: () => act() === 'zip', title: 'Down the rope', text: () => `${k('jump')} lets go early` },
      { id: 'walljump', when: () => act() === 'wallrun', title: 'Up the wall', text: () => `In the air beside a wall, ${k('jump')} kicks off it. Between two walls, kick from one to the other to climb.` },
      { id: 'swim', when: () => g.player.state === 'swim', title: 'Ganga', text: () => `${k('jump')} at the edge climbs out · ${k('dodge')} dives · the current carries you downstream` },
      { id: 'glint', when: () => g.asuras?.list?.some((a) => a.alive && a.glintT > 0), title: 'The glint', text: () => `A flash of light just before a blow lands: ${k('guard')} as it flashes parries it, and staggers them.` },
      { id: 'finisher', when: () => !!g.finishers?.target, title: 'Finisher', text: () => `A staggered Asura can be ended: ${k('interact')}.` },
      { id: 'lockon', when: () => g.inCombat && g.player.state === 'ground', title: 'The dark is near', text: () => `${k('lock')} locks on to one of them · ${k('dodge')} rolls clear · ${k('guard')} guards` },
      { id: 'diya', when: () => g.handDiya?.carried && g.handDiya?.lit, title: 'A diya in your hand', text: () => 'Its light holds the shades back. Wind and water put it out: shelter it in a gust, relight it at any flame.' },
    ];
  }

  /** Show `id` once (other systems can call this too). */
  hint(id, title, text) {
    if (this.seen.has(id) || this.queue.some((q) => q.id === id)) return;
    this.queue.push({ id, title, text });
  }

  markSeen(id) {
    this.seen.add(id);
    try {
      localStorage.setItem(KEY, JSON.stringify([...this.seen]));
    } catch {
      // (no storage)
    }
  }

  update(dt) {
    const g = this.g;
    this.t += dt;
    this.wayBack(dt);
    if (g.settings.hints === false || g.state !== 'play' || g.photo) return;
    this.wait -= dt;
    // (checked a few times a second: cheap tests)
    this.scan = (this.scan || 0) - dt;
    if (this.scan <= 0) {
      this.scan = 0.25;
      for (const H of this.HINTS) if (!this.seen.has(H.id) && !this.queue.some((q) => q.id === H.id) && H.when()) this.queue.push({ id: H.id, title: H.title, text: H.text() });
    }
    if (this.wait > 0 || !this.queue.length || g.missions?.dialogue || g.story?.cut || g.travelling) return;
    const q = this.queue.shift();
    this.markSeen(q.id);
    g.ui.toast(q.title, q.text, 6);
    this.wait = GAP;
  }

  // ---------------------------------------------------------------- the way back up
  wayBack(dt) {
    const g = this.g;
    const p = g.player;
    if (this.back && this.t > this.back.until) this.back = null;
    if (g.roofRun?.active || g.race?.active || g.story?.cut) {
      this.highest = null;
      return;
    }
    const P = p.position;
    const onRoof = p.state === 'ground' && p.grounded && p.speed < 6 && p.feetY - groundHeight(P.x, P.z) > 8;
    this.sample = (this.sample || 0) - dt;
    if (onRoof && this.sample <= 0) {
      this.sample = 0.5;
      this.roofSpots.push({ x: P.x, y: p.feetY, z: P.z, yaw: p.yaw, t: this.t });
      if (this.roofSpots.length > 8) this.roofSpots.shift();
    }
    // a fall: off the roof, down past 6 m below it, and landed (or in the river)
    if (onRoof || p.state === 'climb') {
      this.highest = null;
      return;
    }
    if (p.state === 'air' && !this.highest && this.roofSpots.length && this.t - this.roofSpots.at(-1).t < 1.2) this.highest = { y: this.roofSpots.at(-1).y };
    const down = (p.state === 'ground' && p.grounded) || p.state === 'swim';
    if (this.highest && down) {
      const fell = this.highest.y - p.feetY;
      this.highest = null;
      // (a spot a moment before the fall: away from the edge he went over)
      const spot = this.roofSpots.length > 2 ? this.roofSpots.at(-3) : this.roofSpots[0];
      if (fell > 6 && spot && !g.inCombat) {
        this.back = { spot, until: this.t + 8 };
        this.hint('wayback', 'A long way down', `${this.k('interact')}, for a few moments after a fall: back up to where you were on the roof.`);
      }
    }
  }

  interaction() {
    if (!this.back || this.g.inCombat || this.g.missions?.dialogue) return null;
    const S = this.back.spot;
    return {
      prompt: 'Climb back up to the rooftop',
      action: () => {
        this.back = null;
        this.g.warp(S.x, S.y, S.z, S.yaw);
      },
    };
  }
}
