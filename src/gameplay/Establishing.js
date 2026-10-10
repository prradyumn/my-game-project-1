import * as THREE from 'three';
import { GHAT_TOP, GHATS } from '../config.js';
import { GROUPS } from '../core/Physics.js';
import { frameAtX, frameToWorld, ghatById, ghatToWorld } from '../world/WorldLayout.js';

// Establishing shots. The first time Prady reaches a ghat (once per journey, kept in the save),
// the game takes a breath: the camera rises off the river and cranes up the steps to the city
// above, bars top and bottom, focus on the ghat, its name and a line of its story in the lower
// left, the score swelling under it. Out on the river for the first time, a wide pan along the
// crescent; in the lanes, a crane straight up out of the gali over the rooftops. A new chapter
// opens the same way on the place it is set. Any key cuts back (Story.scene plays it).
//
// Only when nothing else is going on: no Asuras, no scene, no dialogue, no race, his feet on the
// ground (or in the water, or in a boat). Otherwise it waits a little, then lets the moment go.

const LINES = {
  assi: 'Where the Assi meets the Ganga, and Kashi wakes to the morning raga',
  tulsi: 'Where Tulsidas sang the Ramcharitmanas',
  kedar: 'Kedareshwar’s ghat, striped saffron and white',
  chetsingh: 'The river fort of Raja Chet Singh',
  darbhanga: 'The sandstone palace of the Darbhanga kings',
  dashashwamedh: 'Where Brahma offered the sacrifice of ten horses',
  manmandir: 'Raja Man Singh’s palace, and his stars carved in stone',
  manikarnika: 'The great burning ground, where the fires never go out',
  scindia: 'Where Ratneshwar’s temple leans into the river',
  panchganga: 'Where five rivers meet beneath a thousand lamps',
  'Mother Ganga': 'Ganga Maiya, who carries every soul across',
  'The Lanes of Kashi': 'A thousand lanes, a shrine at every turn',
};
const BY_NAME = Object.fromEntries(GHATS.map((g) => [g.name, g.id]));
const DUR = 8;
const REVEAL_EVERY = 300; // seconds between two full swells (the others take the hour's cue)
const V = (x, y, z) => new THREE.Vector3(x, y, z);

export class Establishing {
  constructor(game) {
    this.g = game;
    this.seen = new Set();
    this.pending = null; // { name, t }
    this.lastReveal = -Infinity;
    this.since = 0; // seconds of play since the journey began or was loaded
    this.playing = null;
  }

  serialize() {
    return [...this.seen];
  }

  restore(list) {
    this.seen = new Set(list || []);
    this.since = 0;
  }

  /** Prady is in region `name` (Game.updateRegion). */
  arrive(name) {
    if (!name || this.seen.has(name) || this.pending?.name === name) return;
    if (!LINES[BY_NAME[name] ?? name]) return this.seen.add(name);
    // (where a journey begins or is loaded is already seen: the opening flyover showed it)
    if (this.since < 6) return this.seen.add(name);
    this.pending = { name, t: 0 };
  }

  free() {
    const g = this.g;
    const p = g.player;
    return g.state === 'play' && !g.story?.cut && !g.asuras?.active && !g.race?.active && !g.missions?.dialogue && !g.photo && !g.finishers?.active && !g.cinematics?.shot && !g.traversal?.act && ['ground', 'swim', 'boat'].includes(p.state) && !g.combat?.busy;
  }

  update(dt) {
    if (this.g.state === 'play') this.since += dt;
    const P = this.pending;
    if (!P) return;
    P.t += dt;
    if (this.g.ui.lastRegion !== P.name || P.t > 20) {
      // gone, or the moment passed: next time
      this.pending = null;
      return;
    }
    if (P.t > 0.8 && this.free()) {
      this.pending = null;
      this.seen.add(P.name);
      this.play(P.name);
    }
  }

  /** The shot for region `name`. */
  play(name) {
    const g = this.g;
    const id = BY_NAME[name];
    let keys;
    let focus;
    if (id) ({ keys, focus } = this.ghatShot(ghatById(id)));
    else if (name === 'Mother Ganga') ({ keys, focus } = this.riverShot());
    else ({ keys, focus } = this.craneShot());
    this.run(keys, focus, { small: id ? 'Kashi' : '', title: name, line: LINES[id ?? name] });
  }

  /** A new chapter opens on its place: `at` (world), its title and legend over it. */
  chapter(at, small, title, line) {
    if (!this.free() && this.g.state !== 'cutscene') return false;
    const { keys, focus } = this.placeShot(at);
    this.run(keys, focus, { small, title, line, swell: true });
    return true;
  }

  run(keys, focus, { small, title, line, swell }) {
    const g = this.g;
    const now = g.health?.time ?? 0;
    // the full swell now and then; otherwise the hour's own cue comes in
    if ((swell || now - this.lastReveal > REVEAL_EVERY) && g.score?.reveal(24)) this.lastReveal = now;
    else g.score?.moment();
    const dur = keys[keys.length - 1].t;
    g.ui.establishTitle(small, title, line, dur - 0.4);
    // (the place's own banner would print its name twice)
    g.ui.els.region.classList.remove('show');
    // a long lens's shallow focus, not a macro's: a ghat 60 m off stays sharp, the near water softens
    g.rs.setDof(1, focus, { range: 45, bokeh: 1.8 });
    this.playing = true;
    g.story.scene({
      keys,
      lines: [],
      then: () => {
        this.playing = null;
        g.rs.setDof(g.photo ? g.rs.dofLevel : 0, g.rs.dofTarget);
        g.score?.endReveal(4);
        g.ui.els.establish.classList.remove('show');
        g.camRig.blendFrom(0.8);
      },
    });
  }

  // ---------------------------------------------------------------- the shots
  /** Off the river, low over the water, craning up the steps to the city above. */
  ghatShot(gh) {
    const u = gh.width * 0.5;
    const at = (du, v, y) => {
      const p = ghatToWorld(gh, u + du, v);
      return V(p.x, y, p.z);
    };
    const focus = at(0, 8, GHAT_TOP - 3);
    return {
      focus,
      keys: [
        { t: 0, pos: at(-24, 64, 2.6), look: at(-4, 8, GHAT_TOP - 4) },
        { t: DUR * 0.55, pos: at(-8, 50, 6.5), look: at(0, 6, GHAT_TOP - 1) },
        { t: DUR, pos: at(9, 36, 13), look: at(4, -10, GHAT_TOP + 5) },
      ],
    };
  }

  /** Out on the water: a wide, slow pan along the crescent of the ghats. */
  riverShot() {
    const P = this.g.player.position;
    const f = frameAtX(P.x);
    const w = (u, v, y) => {
      const p = frameToWorld(f, u, v);
      return V(p.x, y, p.z);
    };
    return {
      focus: w(0, 0, GHAT_TOP),
      keys: [
        { t: 0, pos: w(-30, 120, 4), look: w(-140, 0, GHAT_TOP + 2) },
        { t: DUR * 0.5, pos: w(-6, 128, 6), look: w(0, 0, GHAT_TOP + 3) },
        { t: DUR + 1, pos: w(20, 120, 8), look: w(150, 0, GHAT_TOP + 2) },
      ],
    };
  }

  /** In the lanes: straight up out of the gali over the rooftops, toward the river. */
  craneShot() {
    const g = this.g;
    const P = g.player.position;
    const y0 = g.player.feetY;
    const N = frameAtX(P.x).N; // toward the river
    // as high as the gali is open overhead (a balcony, a chhajja)
    const open = g.physics.sphereCast({ x: P.x, y: y0 + 2, z: P.z }, { x: 0, y: 1, z: 0 }, 0.4, 30, g.player.collider, GROUPS.feet) ?? 30;
    const top = y0 + 2 + Math.max(4, open - 1);
    return {
      focus: V(P.x, y0 + 1.2, P.z),
      keys: [
        { t: 0, pos: V(P.x - N.x * 1.2, y0 + 2.2, P.z - N.z * 1.2), look: V(P.x + N.x * 4, y0 + 1.6, P.z + N.z * 4) },
        { t: DUR * 0.6, pos: V(P.x - N.x * 1.4, (y0 + 2.2 + top) / 2, P.z - N.z * 1.4), look: V(P.x + N.x * 24, y0 + 5, P.z + N.z * 24) },
        { t: DUR, pos: V(P.x - N.x * 1.6, top, P.z - N.z * 1.6), look: V(P.x + N.x * 60, y0 - 2, P.z + N.z * 60) },
      ],
    };
  }

  /** A chapter's place `at` on the ghats, from the river (like a ghat's own shot, aimed at it). */
  placeShot(at) {
    const f = frameAtX(at.x);
    const N = f.N;
    const T = { x: -N.z, z: N.x };
    const p = (along, out, y) => V(at.x + T.x * along + N.x * out, y, at.z + T.z * along + N.z * out);
    return {
      focus: V(at.x, at.y + 1.5, at.z),
      keys: [
        { t: 0, pos: p(-22, 58, 3), look: V(at.x, at.y + 1, at.z) },
        { t: DUR * 0.55, pos: p(-8, 42, 7), look: V(at.x, at.y + 2, at.z) },
        { t: DUR + 1, pos: p(8, 28, 12), look: V(at.x - N.x * 12, at.y + 4, at.z - N.z * 12) },
      ],
    };
  }
}
