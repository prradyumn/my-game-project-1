import * as THREE from 'three';
import { frameAtX, ghatById, ghatToWorld, LANDING_1 } from '../world/WorldLayout.js';

// Dev Deepawali, the festival of the gods' lights: on the full moon of Kartik the gods come down
// to Kashi to bathe in the Ganga, and the city lights every step of every ghat for them.
//
// It is tonight once the Maha Aarti has been restored (the story's end), or when the test menu or
// ?deepawali asks for it. At dusk the night opens: a conch from Dashashwamedh, and if he is free
// a sweep of the camera down the river front as the light runs along it, a diya on every step
// (DiyaField), the festival's own music (Score.festival), diyas set floating from every ghat
// (FloatingDiyas), sky lanterns (SkyLanterns), and once the last ghat is lit, the fireworks'
// finale over the river (Fireworks.show). Each system reads `festival` from here.

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export class Festival {
  constructor(game) {
    this.g = game;
    this.forced = new URLSearchParams(location.search).has('deepawali');
    this.begun = false; // tonight's opening has played
    this.finaleAt = -1;
  }

  /** Dev Deepawali tonight. */
  get tonight() {
    return this.forced || !!this.g.quest?.complete;
  }

  update(dt) {
    const g = this.g;
    const night = g.sky.nightFactor;
    // (a new day: the next night opens again)
    if (night < 0.15) this.begun = false;
    if (!this.tonight || g.state !== 'play') return;
    if (!this.begun && night > 0.45) this.begin();
    if (this.finaleAt >= 0 && g.health.time >= this.finaleAt) {
      this.finaleAt = -1;
      g.fireworks?.show(30);
    }
  }

  begin() {
    const g = this.g;
    this.begun = true;
    const dash = ghatById('dashashwamedh');
    const at = ghatToWorld(dash, dash.width / 2, LANDING_1.v1);
    g.audio.play('conch', { volume: 0.85 });
    g.audio.play('bell', { volume: 0.6, delay: 2.2 });
    g.score?.festival();
    // the fireworks once the light has run the length of the river front
    this.finaleAt = g.health.time + (g.night?.field?.lastDelay ?? 12) + 2;
    if (!this.shot(at)) g.ui.toast('Dev Deepawali', 'The gods come down to Kashi tonight: every step of every ghat is lit for them.', 6);
  }

  /** The camera low over the river off Dashashwamedh, drifting along the front as it lights. */
  shot(at) {
    const g = this.g;
    const E = g.establishing;
    if (!E?.free?.()) return false;
    const N = frameAtX(at.x).N;
    const T = { x: -N.z, z: N.x };
    const p = (along, out, y) => V(at.x + T.x * along + N.x * out, y, at.z + T.z * along + N.z * out);
    const look = (along, out, y) => V(at.x + T.x * along + N.x * out, y, at.z + T.z * along + N.z * out);
    const keys = [
      { t: 0, pos: p(-6, 46, 2.2), look: look(0, 6, 4) },
      { t: 5, pos: p(12, 40, 3.2), look: look(28, 4, 4.5) },
      { t: 10.5, pos: p(30, 34, 5.5), look: look(70, 2, 5) },
    ];
    E.run(keys, V(at.x, at.y + 2, at.z), { small: 'Kartik Purnima', title: 'Dev Deepawali', line: 'Tonight the gods come down to bathe in the Ganga, and Kashi lights every step for them.', swell: false });
    return true;
  }

  /** Test menu: tonight is Dev Deepawali, at dusk on the top of Dashashwamedh, the river below. */
  jump() {
    const g = this.g;
    this.forced = true;
    this.begun = false;
    g.sky.setHours(18.1);
    const dash = ghatById('dashashwamedh');
    g.testMenu.placeOnGhat('dashashwamedh', dash.width / 2 + 3, 1, 0);
  }
}
