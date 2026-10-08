import { lines } from './lines.js';
import { faceTo, fromRiver, ghatById, place, spot, twoShot } from './kit.js';

// Chapter I · The Goddess's Sword (Assi Ghat). Pandit Shankar tells Prady the Asuras are
// rising; Guru Ramdas at Tulsi Akhara gives him a blade; at dusk the first of them walk up out
// of the river at Assi. Then the Flame of Assi burns again. (Durga cast her sword down here
// after slaying Shumbha and Nishumbha: the Assi river sprang up where it struck.)

export default function goddessSword(game) {
  const G = ghatById('assi');
  const W = G.width;
  const FU = W * 0.62; // the flame pillar
  const priestAt = () => spot('assi', FU - 5, 1, -1.2);
  const nearFlame = () => spot('assi', FU - 1.5, 1, 1.2);
  const priest = (s) => {
    const p = priestAt();
    // an older man in a saffron kurta (the capped kurta body reads as a different faith's dress)
    const a = s.actor({ avatarId: 'Male_Adult_14', x: p.x, y: p.y, z: p.z, yaw: p.yaw, clip: 'idle', name: 'Pandit Shankar' });
    if (a) a.tint = 'saffron';
    s.state.priest = a;
    return a;
  };
  const sword = (g) => {
    g.missions.perks.sword = true;
    g.missions.done.add('akhara');
    g.missions.applyPerks();
  };
  const VOICES = ['ch1/legend', 'ch1/meet-01', 'ch1/meet-02', 'ch1/meet-03', 'ch1/meet-04', 'ch1/meet-05', 'ch1/dusk-01', 'ch1/dusk-02', 'ch1/rise-01', 'ch1/won-01', 'ch1/won-02', 'ch1/lit-01', 'ch1/lit-02'];
  const talkTo = (s, keys, then, side = 1) => {
    const a = s.state.priest;
    faceTo(a, game.player.position);
    const P = game.player.position;
    s.scene({ keys: twoShot(a, { x: P.x, y: game.player.feetY, z: P.z }, 16, side), lines: lines(...keys), then });
  };

  return {
    id: 'goddessSword',
    num: 1,
    title: 'The Goddess’s Sword',
    flame: 'assi',
    ghat: 'assi',
    legend: 'When Durga slew the demons Shumbha and Nishumbha, she cast her sword down at the edge of Kashi. Where it struck, a river sprang up: the Assi.',
    voices: VOICES,
    steps: [
      {
        id: 'meet',
        title: 'Pandit Shankar',
        text: 'Find Pandit Shankar at Assi Ghat, the southernmost ghat.',
        prep(g) {
          g.sky.setHours(7.5);
          place(g, spot('assi', FU - 2, 1, 0.8), priestAt());
        },
        start(s) {
          priest(s);
          game.preloadVoices(VOICES);
          s.state.legend = false;
        },
        update(s) {
          const a = s.state.priest;
          if (a) s.mark('giver', a);
          // the legend, told as he comes in sight of the ghat
          if (!s.state.legend && a && s.near(a, 40)) {
            s.state.legend = true;
            game.voice('ch1/legend');
          }
        },
        interact(s) {
          const a = s.state.priest;
          if (!a || !s.near(a, 2.8)) return null;
          return { prompt: 'Talk to Pandit Shankar', action: () => talkTo(s, ['ch1/meet-01', 'ch1/meet-02', 'ch1/meet-03', 'ch1/meet-04', 'ch1/meet-05'], () => s.next()) };
        },
      },
      {
        id: 'akhara',
        title: 'Tulsi Akhara',
        text: 'Learn to fight from Guru Ramdas at Tulsi Akhara (Tulsi Ghat, just north of Assi).',
        prep(g) {
          g.sky.setHours(9);
          const gr = spot('tulsi', 4.8, 1, 1.8);
          place(g, { ...gr, x: gr.x + 2 }, gr);
        },
        skip: sword,
        start(s) {
          if (game.missions.done.has('akhara')) game.after(0.2, () => s.next());
        },
        update(s) {
          const run = game.missions.active;
          s.state.text = run?.def.id === 'akhara' ? `Guru Ramdas: ${run.text}` : null;
          const guru = game.missions.givers.get('akhara');
          if (guru && run?.def.id !== 'akhara') s.mark('objective', guru);
          if (game.missions.done.has('akhara')) s.next();
        },
        on(s, ev, d) {
          if (ev === 'mission:done' && d.id === 'akhara') s.next();
        },
      },
      {
        id: 'dusk',
        title: 'Wait for dusk',
        text: 'Return to Pandit Shankar at Assi Ghat with the talwar.',
        prep(g) {
          sword(g);
          g.sky.setHours(16.5);
          place(g, spot('assi', FU - 2, 1, 0.8), priestAt());
        },
        skip(g) {
          sword(g);
          g.sky.setHours(18.7);
        },
        start(s) {
          priest(s);
        },
        update(s) {
          if (s.state.priest && !s.state.waiting) s.mark('giver', s.state.priest);
        },
        interact(s) {
          const a = s.state.priest;
          if (!a || s.state.waiting || !s.near(a, 2.8)) return null;
          return {
            prompt: 'Talk to Pandit Shankar',
            action: () =>
              talkTo(
                s,
                ['ch1/dusk-01', 'ch1/dusk-02'],
                () => {
                  // the sun goes down over the river
                  s.state.waiting = true;
                  game.setTimeOfDay(18.75, 5);
                  s.scene({ keys: fromRiver('assi', FU, 7, 46, 7), lines: [['', '…', null, 6]], then: () => s.next() });
                },
                -1
              ),
          };
        },
      },
      {
        id: 'fight',
        title: 'Darkness rises',
        text: 'Asuras are rising from the river! Defend Assi Ghat.',
        resumeFrom: 3,
        prep(g) {
          sword(g);
          g.sky.setHours(18.8);
          place(g, nearFlame(), spot('assi', FU, 2));
        },
        start(s) {
          priest(s);
          game.checkpoint = nearFlame();
          game.combat.setHasSword(true);
          game.voice('ch1/rise-01');
          game.ui.subtitle('Pandit Shankar: “There! Out of the river! Prady, they are coming up the steps!”', 4);
          game.encounters.start({ ghat: 'assi', u: FU, title: 'Assi Ghat', waves: [{ n: 2, kind: 'shade' }, { n: 3, kind: 'shade' }], onWin: () => s.next() });
        },
        stop() {
          if (game.encounters.cur?.def.ghat === 'assi') game.encounters.clear();
        },
      },
      {
        id: 'flame',
        title: 'Light the Flame of Assi',
        text: 'Light the Flame of Assi.',
        lightFlame: true,
        prep(g) {
          sword(g);
          g.sky.setHours(19.2);
          place(g, nearFlame(), spot('assi', FU, 2));
        },
        start(s) {
          priest(s);
          game.checkpoint = nearFlame();
          game.after(1.2, () => s.over || s.say(lines('ch1/won-01', 'ch1/won-02')));
        },
        update(s) {
          const f = game.quest.flames.find((x) => x.id === 'assi');
          if (f && !f.lit) s.mark('objective', f.pos);
        },
        on(s, ev, d) {
          if (ev !== 'flame' || d.id !== 'assi') return;
          game.after(2.2, () => talkTo(s, ['ch1/lit-01', 'ch1/lit-02'], () => s.next()));
        },
        stop() {
          game.checkpoint = null;
        },
      },
    ],
    reward: {
      note: 'Durga’s blessing: your prana grows stronger (120)',
      apply(g) {
        if (g.health.max < 120) g.health.setMax(120);
        g.health.hp = g.health.max;
      },
    },
  };
}
