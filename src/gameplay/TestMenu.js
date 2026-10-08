import { ghatById, ghatToWorld, LANDING_1, LANDING_2 } from '../world/WorldLayout.js';

// "Chapter Select · Test": jump straight into any chapter beat, activity or side mission, with
// no prerequisites (the jump grants whatever it needs: the talwar, the time of day, a lit flame).
// Every system registers its own jumps with add(); the title screen and the pause menu open the
// list. A test session never writes to the player's journeys.

export class TestMenu {
  constructor(game) {
    this.g = game;
    this.entries = [];
    this.addBasics();
  }

  /** group: section heading; run(g) may be async. */
  add(group, label, sub, run, tag = '') {
    this.entries.push({ group, label, sub, run, tag });
  }

  open(from) {
    const groups = [];
    for (const e of this.entries) {
      let sec = groups.find((s) => s.heading === e.group);
      if (!sec) groups.push((sec = { heading: e.group, items: [] }));
      sec.items.push({ label: e.label, sub: e.sub, tag: e.tag, onClick: () => this.jump(e, from) });
    }
    this.g.ui.openMenu({
      title: 'Chapter Select · Test',
      note: 'Jump to any chapter, fight or activity. Nothing is required first, and nothing here is saved to your journeys.',
      sections: groups,
    });
  }

  async jump(e, from) {
    const g = this.g;
    g.ui.closeMenu();
    g.testSession = true;
    if (from === 'title' || g.state === 'title') await g.begin(null, { skipIntro: true });
    else if (g.state === 'paused') g.resume();
    g.stopActivities?.();
    await e.run(g);
    g.ui.toast(e.label, 'Test session: progress here is not saved.', 3);
  }

  // ------------------------------------------------------------- helpers for jumps
  /** Put Prady at ghat id, (u, v) in its bank frame (v on a landing: 1, 2 or 0 = top), facing the river. */
  placeOnGhat(id, u, which = 1, vOff = 0) {
    const g = this.g;
    const gh = ghatById(id);
    const L = which === 1 ? LANDING_1 : which === 2 ? LANDING_2 : { v0: 0.6, v1: 3.6, h0: 10.5 };
    const p = ghatToWorld(gh, u, (L.v0 + L.v1) / 2 + vOff);
    this.place(p.x, L.h0, p.z, Math.atan2(gh.N.x, gh.N.z));
  }

  place(x, y, z, yaw) {
    const g = this.g;
    if (g.player.state === 'boat') g.player.exitBoat(x, y, z);
    g.player.teleport(x, y + 0.1, z);
    if (yaw !== undefined) {
      g.player.yaw = g.player.prevYaw = yaw;
      g.camRig.yaw = yaw;
    }
    g.camRig.first = true;
  }

  hours(h) {
    this.g.sky.setHours(h);
  }

  addBasics() {
    const T = 'World & test tools';
    this.add(T, 'Dawn at Dashashwamedh', 'Free roam from the start, 6:30', (g) => {
      this.placeOnGhat('dashashwamedh', 49, 1, 1.5);
      this.hours(6.5);
    });
    this.add(T, 'Night on the ghats', 'Free roam, 20:30, diyas lit', (g) => {
      this.placeOnGhat('dashashwamedh', 49, 1, 1.5);
      this.hours(20.5);
    });
    this.add(T, 'Monsoon thunderstorm', 'Rain, lightning, wet stone', (g) => {
      this.placeOnGhat('darbhanga', 40, 1, 1);
      this.hours(16);
      g.setSetting('weather', 'storm');
    });
    this.add(T, 'Clear skies', 'Weather back to automatic', (g) => g.setSetting('weather', 'auto'));
    this.add(T, 'Give the talwar', 'Draw it with R', (g) => {
      g.combat.setHasSword(true);
      g.combat.armed = true;
      g.combat.stance(4);
    });
    this.add(T, 'Invincible on / off', 'Prana never drops below one', (g) => {
      g.health.invincible = !g.health.invincible;
      g.ui.toast(g.health.invincible ? 'Invincible' : 'Mortal again', '', 2);
    });
    this.add(T, 'Light all five flames', 'Ganga’s Blessing: run on water', (g) => {
      for (const f of g.quest.flames) g.quest.lightFlame(f.id, true);
      g.player.blessing = true;
    });
  }
}
