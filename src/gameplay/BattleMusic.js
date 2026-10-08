import { ASSET_MANIFEST } from '../core/Assets.js';

// Battle music. When the Asuras rise, tabla, dholak and sitar take over from the calm river
// music; when Andhaka himself is up, his own darker loop crossfades in. Both loops are fetched a
// few seconds after the game begins (not needed at the title), start from their first bar each
// fight, and are stopped once they have faded out so the next fight starts on the downbeat.
//
//   Encounters.music (0..1) says how much fight there is; this mixes it.

const FIGHT_VOL = 0.95;
const BOSS_VOL = 1.0;

export class BattleMusic {
  constructor(game) {
    this.g = game;
    this.boss = 0; // 0..1: how much of the mix is the boss loop
    this.quiet = 0; // seconds both loops have been silent
    this.h = { fight: null, boss: null };
  }

  /** Fetch and decode both loops (cached; safe to call again). */
  prefetch() {
    for (const [k, m] of Object.entries(ASSET_MANIFEST.battleMusic)) this.g.audio.fetchBuffer(`battle-${k}`, m.url);
  }

  _start(k) {
    const m = ASSET_MANIFEST.battleMusic[k];
    const h = this.g.audio.loop(`battle-${k}`, { channel: 'music', volume: 0, loop: m.loop });
    this.h[k] = h;
    return h;
  }

  stopAll(fade = 0.6) {
    for (const k of Object.keys(this.h)) {
      this.h[k]?.stop(fade);
      this.h[k] = null;
    }
  }

  update(dt) {
    const g = this.g;
    if (!g.audio.ctx) return;
    // a fight, or the boat race (the dhol and sitar suit a race down the river too)
    const level = Math.max(g.encounters.music, g.race?.music ?? 0);
    const bossUp = g.asuras.list.some((a) => a.alive && a.kind === 'boss');
    this.boss += ((bossUp ? 1 : 0) - this.boss) * Math.min(1, dt * (bossUp ? 0.8 : 0.4));
    const want = { fight: level * (1 - this.boss) * FIGHT_VOL, boss: level * this.boss * BOSS_VOL };
    for (const k of ['fight', 'boss']) {
      let h = this.h[k];
      if (!h && want[k] > 0.02 && g.audio.buffers[`battle-${k}`]) h = this._start(k);
      else if (!g.audio.buffers[`battle-${k}`] && want[k] > 0) this.prefetch();
      h?.setVolume(want[k], 0.25);
    }
    // the calm river music steps back while there is fighting
    g.loops?.music?.setVolume(1 - 0.92 * level, 0.3);
    // once both have been silent a while, stop them (the next fight starts from the top)
    this.quiet = want.fight + want.boss < 0.01 ? this.quiet + dt : 0;
    if (this.quiet > 2.5 && (this.h.fight || this.h.boss)) this.stopAll(0.2);
  }
}
