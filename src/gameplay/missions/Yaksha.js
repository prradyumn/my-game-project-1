import { damp } from '../../utils/math.js';
import { frameAtX, frameToWorld, groundHeight } from '../../world/WorldLayout.js';
import { ghatById, ghatSpot, ledge, waterEdge } from './places.js';

// The Yaksha's Lantern. Only at night: an old sadhu at Panchganga tells of the Yaksha who once
// questioned Yudhishthira at a lake, and who still wanders Kashi with a cold blue lantern.
// Follow the lantern up through the lanes and back down to the leaning temple; three times
// the Yaksha asks one of his questions (keys 1-3). Answer as Yudhishthira did and he grants a
// boon: Prady can stay under the Ganga far longer.

const RIDDLES = [
  {
    q: 'What is swifter than the wind?',
    a: ['A galloping horse', 'The mind', 'Lightning over the Ganga'],
    right: 1,
  },
  {
    q: 'What is more numerous than the blades of grass?',
    a: ['Thoughts', 'The stars in the sky', 'The grains of sand on the far bank'],
    right: 0,
  },
  {
    q: 'What is the greatest wonder of the world?',
    a: ['That the Ganga flows from the hair of Shiva', 'That the sun rises every single morning', 'That every day people die, and the living still act as if they never will'],
    right: 2,
  },
];

const lane = (x, v) => {
  const p = frameToWorld(frameAtX(x), 0, v);
  return { x: p.x, z: p.z };
};

export default function yaksha(game) {
  const pg = ghatById('panchganga');
  const sc = ghatById('scindia');
  const route = () => {
    const temple = game.quest.flames.find((f) => f.id === 'ratneshwar')?.pos;
    const uT = temple ? (temple.x - sc.S.x) * sc.T.x + (temple.z - sc.S.z) * sc.T.z : sc.width * 0.5;
    return [
      { ...ghatSpot(pg, pg.width * 0.45, 1) },
      { ...lane(346, 2.2) },
      { ...lane(336, -9) },
      { ...lane(336, -26.5), riddle: 0 },
      { ...lane(296, -26.5) },
      { ...lane(254, -26.5), riddle: 1 },
      { ...lane(252, -9) },
      { ...lane(262, 2.2) },
      { ...waterEdge(sc, Math.max(4, uT - 4)), riddle: 2, last: true },
    ].map((p) => ({ ...p, y: groundHeight(p.x, p.z) }));
  };

  return {
    id: 'yaksha',
    title: "The Yaksha's Lantern",
    giver: { name: 'Baba Bholenath', avatarId: 'Male_Adult_15', tint: 'saffron', clip: 'sit', hours: [20.5, 4.5], at: () => ledge(pg, pg.width * 0.6) },
    offer: [
      ['Baba Bholenath', 'You walk late, child. Good. Some things in Kashi only show themselves after the last aarti.'],
      ['Baba Bholenath', 'The Yaksha who questioned Yudhishthira at the lake still wanders here, with a lantern of cold blue fire. Follow it, and answer as the wise king did.'],
    ],
    start(m) {
      const pts = route();
      m.state = { pts, i: 0, wx: pts[0].x, wy: pts[0].y + 1.6, wz: pts[0].z, waiting: false, asked: -1, t: 0, rise: 0 };
      game.ui.toast('A blue light flickers on the steps', 'Follow the lantern', 3);
    },
    update(m, dt) {
      const s = m.state;
      const h = game.sky.hours;
      if (h > 5 && h < 20 && !s.finale) {
        m.fail('With the dawn the blue lantern fades. Baba Bholenath will be there again tonight.');
        return;
      }
      s.t += dt;
      const p = game.player.position;
      const target = s.pts[Math.min(s.i, s.pts.length - 1)];
      const dx = target.x - s.wx;
      const dz = target.z - s.wz;
      const d = Math.hypot(dx, dz);
      const pd = Math.hypot(p.x - s.wx, p.z - s.wz);
      if (s.finale) {
        // the lantern climbs into the night and is gone
        s.rise += dt;
        s.wy += dt * (0.6 + s.rise);
        m.mark('wisp', { x: s.wx, y: s.wy, z: s.wz }, false);
        m.objective('…');
        if (s.rise > 4) m.done();
        return;
      }
      s.cool = Math.max(0, (s.cool || 0) - dt);
      if (game.missions.dialogue) {
        // everything holds still while the Yaksha speaks
      } else if (d > 0.3) {
        // drifts on ahead, but never too far from Prady
        const go = pd < 9 ? 2.4 : 0;
        const step = Math.min(d, go * dt);
        s.wx += (dx / d) * step;
        s.wz += (dz / d) * step;
      } else if (target.riddle !== undefined && s.asked < target.riddle) {
        if (pd < 5 && s.cool <= 0) this.ask(m, target.riddle);
      } else if (!target.last) s.i++;
      s.wy = damp(s.wy, groundHeight(s.wx, s.wz) + 1.6 + Math.sin(s.t * 1.7) * 0.12, 3, dt);
      m.mark('wisp', { x: s.wx, y: s.wy, z: s.wz }, false);
      m.objective(pd > 20 ? 'The blue lantern is waiting for you.' : target.riddle !== undefined && d <= 0.3 ? 'The Yaksha speaks.' : "Follow the Yaksha's lantern.");
      if (pd > 20) m.mark('objective', { x: s.wx, y: s.wy - 1.6, z: s.wz });
    },
    ask(m, k) {
      const R = RIDDLES[k];
      const s = m.state;
      m.say([['The Yaksha', R.q]], {
        choices: R.a.map((label, i) => ({
          key: String(i + 1),
          label,
          then: () => {
            if (i === R.right) {
              s.asked = k;
              game.audio.play('bell', { volume: 0.4, rate: 1.25 });
              const last = s.pts[s.i].last;
              m.say([['The Yaksha', last ? 'So answered Yudhishthira, and so answer you. Ask, child of Kashi, and I will grant it.' : ['True. Walk on.', 'True. The lantern goes on.'][k] || 'True.']], {
                then: () => {
                  if (last) this.boon(m);
                },
              });
            } else {
              game.ui.subtitle('The lantern gutters. “Think again, child of Kashi.”', 3);
              s.cool = 2.5;
            }
          },
        })),
      });
    },
    boon(m) {
      m.say(
        [
          ['Prady', 'Only that I may go deeper into Ganga Maiya, and stay longer with her.'],
          ['The Yaksha', 'Then the river will hold its breath with you. Go well.'],
        ],
        {
          then: () => {
            m.state.finale = true;
            game.audio.play('bell', { volume: 0.6, rate: 0.8 });
          },
        }
      );
    },
    outro: [['Baba Bholenath', '(far away, a conch sounds across the water) You met him, then. Few do. Fewer answer well.']],
    reward: { punya: 40, perk: 'breath', note: "The Yaksha's boon: you can stay under the Ganga far longer" },
  };
}
