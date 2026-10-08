import * as THREE from 'three';
import { PROFILE_LEN, ghatById, ghatToWorld } from '../world/WorldLayout.js';
import { lines } from './chapters/lines.js';
import { orbit } from './chapters/kit.js';

// The Ganga aarti from the water. At dusk the boats crowd in before Dashashwamedh to watch the
// priests raise the great lamps; Prady can row out and join them any evening. He sets his own
// diya on the river, the boatmen around him do the same, the bells and the conch carry across
// the water, and the camera drifts round the platforms while the hymn is sung. Once an evening
// it earns a little punya; it's there to be watched again whenever he likes.

const G = () => ghatById('dashashwamedh');

export class RiverAarti {
  constructor(game) {
    this.g = game;
    this.on = false;
    this.watched = false; // this evening (punya once an evening; morning clears it)
  }

  /** Out on the water before the ghat, with a view of the platforms. */
  onView() {
    const g = this.g;
    const gh = G();
    const c = ghatToWorld(gh, gh.width * 0.5, PROFILE_LEN);
    const dx = g.boat.x - c.x;
    const dz = g.boat.z - c.z;
    const out = dx * gh.N.x + dz * gh.N.z;
    const side = Math.abs(dx * gh.N.z - dz * gh.N.x);
    return out > 10 && out < 75 && side < gh.width * 0.5 + 12;
  }

  get evening() {
    const h = this.g.sky.hours;
    return h > 18.25 && h < 20.75;
  }

  interaction() {
    const g = this.g;
    if (this.on || g.player.state !== 'boat' || !this.evening || g.race?.active || g.encounters.active || g.story?.cut) return null;
    // Chapter III stages its own aarti from the water
    if (g.story?.run?.def.id === 'aarti') return null;
    if (!this.onView()) return null;
    return { prompt: 'Watch the Ganga aarti from the water', action: () => this.start() };
  }

  start() {
    const g = this.g;
    this.on = true;
    this.hadAarti = g.quest.forceAarti;
    g.quest.forceAarti = true;
    const gh = G();
    // his own diya first, set on the water beside the boat
    const f = g.boat.forward;
    const r = { x: f.z, z: -f.x };
    g.diyas.launch(g.boat.x + r.x * 1.6, g.boat.z + r.z * 1.6);
    g.missions?.emit?.('diya', { x: g.boat.x, z: g.boat.z });
    g.audio.play('chime', { volume: 0.45 });
    g.audio.play('conch', { volume: 0.85, delay: 0.8 });
    // the boatmen and pilgrims around him float theirs as the hymn rises
    this.lampT = 0;
    this.lamps = 26;
    this.bellT = 1.5;
    const c0 = ghatToWorld(gh, gh.width * 0.5, PROFILE_LEN - 8);
    const C = { x: c0.x, y: 2.7, z: c0.z };
    this.C = C;
    const B = { x: g.boat.x, y: 0.6, z: g.boat.z };
    // slow arcs across the platforms, then back to the river full of lamps
    // (angles about the ghat's riverward normal: the camera stays out over the water)
    const a = Math.atan2(gh.N.x, gh.N.z);
    const keys = [...orbit(C, 24, 6, a - 0.5, a + 0.35, 10, 1.6), ...orbit(C, 13, 3.4, a + 0.35, a - 0.3, 10, 1.9).map((k) => ({ ...k, t: k.t + 10.2 }))];
    const back = new THREE.Vector3(B.x + f.x * 7 - r.x * 3, 1.6, B.z + f.z * 7 - r.z * 3);
    keys.push({ t: 21.5, pos: back, look: new THREE.Vector3(C.x, 3, C.z) }, { t: 27, pos: new THREE.Vector3(back.x - f.x * 3, 2.4, back.z - f.z * 3), look: new THREE.Vector3(C.x, 3.5, C.z) });
    g.story.scene({
      keys,
      lines: [...lines('ch3/aarti-01'), ['', '…', null, 12], ['Prady', 'Har Har Gange.', null, 5]],
      then: () => this.end(),
    });
  }

  update(dt) {
    const g = this.g;
    if (g.sky.hours > 5 && g.sky.hours < 12) this.watched = false;
    if (!this.on) return;
    // lamps set adrift around the boat and along the ghat's edge
    this.lampT -= dt;
    if (this.lampT <= 0 && this.lamps > 0) {
      this.lampT = 0.45 + Math.random() * 0.5;
      this.lamps--;
      const gh = G();
      const near = Math.random() < 0.5;
      if (near) {
        const a = Math.random() * Math.PI * 2;
        const d = 4 + Math.random() * 14;
        g.diyas.launch(g.boat.x + Math.sin(a) * d, g.boat.z + Math.cos(a) * d);
      } else {
        const p = ghatToWorld(gh, gh.width * (0.15 + Math.random() * 0.7), PROFILE_LEN + 2 + Math.random() * 10);
        g.diyas.launch(p.x, p.z);
      }
    }
    this.bellT -= dt;
    if (this.bellT <= 0) {
      this.bellT = 2.2 + Math.random() * 1.2;
      g.audio.play('bell', { at: new THREE.Vector3(this.C.x + (Math.random() - 0.5) * 20, 4, this.C.z), volume: 0.7, rate: 0.9 + Math.random() * 0.2, ref: 30 });
    }
  }

  end() {
    const g = this.g;
    if (!this.on) return;
    this.on = false;
    g.quest.forceAarti = this.hadAarti;
    const first = !this.watched;
    this.watched = true;
    if (first && g.missions) {
      g.missions.punya += 5;
      g.ui.setPunya(g.missions.punya);
    }
    g.ui.toast('Ganga Aarti', first ? 'You watched the aarti from the river, as everyone should once · +5 punya' : 'The lamps drift away downstream.', 4.5);
  }

  /** A test jump or a fight: let it go. */
  stop() {
    if (!this.on) return;
    if (this.g.story?.cut) this.g.story.endScene();
    else this.end();
  }
}
