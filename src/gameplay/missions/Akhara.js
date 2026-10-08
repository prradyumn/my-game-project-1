import { AKHARA } from '../../world/WorldLayout.js';
import { ghatById, ghatSpot } from './places.js';

// The Akhara's Lesson. Guru Ramdas has trained wrestlers at Tulsi Akhara for fifty years.
// He teaches Prady to strike (fists, a kick), to guard, and then puts his grandfather's
// talwar in his hand: a three-cut combination and the heavy overhead cut on the dummies.
// Reward: the talwar is Prady's (R to draw it, LMB / RMB to fight with it).

const STEPS = [
  { id: 'fists', text: 'Strike a dummy with your fists: left mouse button (a one-two).', need: (e) => e.type === 'hit' && !e.sword && !e.kick },
  { id: 'kick', text: 'Now a kick: right mouse button.', need: (e) => e.type === 'hit' && e.kick },
  { id: 'block', text: 'Raise your guard: hold Q (or the middle mouse button) for two seconds.', need: (e) => e.type === 'guarded' },
  { id: 'sword', text: 'Take the talwar from Guru Ramdas.', talk: true },
  { id: 'combo', text: 'Draw the talwar (R) and cut a dummy three times in a row (left mouse button, keep pressing).', need: (e, s) => e.type === 'hit' && e.sword && s.chain >= 3 },
  { id: 'heavy', text: 'Finish with the heavy overhead cut: right mouse button.', need: (e) => e.type === 'hit' && e.sword && e.heavy },
];

export default function akhara(game) {
  const g = ghatById(AKHARA.ghat);
  return {
    id: 'akhara',
    title: "The Akhara's Lesson",
    giver: { name: 'Guru Ramdas', avatarId: 'Male_Adult_09', clip: 'idle', hours: [5.5, 19], at: () => ({ ...ghatSpot(g, AKHARA.u0 - 2.2, 1, 1.8), yaw: Math.atan2(g.T.x, g.T.z) }) },
    offer: [
      ['Guru Ramdas', 'Fifty years I have turned soft boys into pehlwans in this pit. You walk like someone who has never been hit.'],
      ['Guru Ramdas', 'Come. Learn to strike, to kick, to guard. If you are any good, my grandfather’s talwar has waited long enough for a hand.'],
    ],
    start(m) {
      m.state = { i: 0, chain: 0, lastHit: -10, guard: 0 };
    },
    update(m, dt) {
      const s = m.state;
      const step = STEPS[s.i];
      if (!step) return;
      m.objective(step.text, s.i / STEPS.length);
      if (step.talk) {
        if (m.giver) m.mark('objective', m.giver);
        return;
      }
      // the dummies as the target
      const A = game.world.akhara;
      m.mark('objective', { x: A.center.x, y: A.y, z: A.center.z }, false);
      if (step.id === 'block') {
        s.guard = game.combat.blocking ? s.guard + dt : 0;
        if (s.guard > 2) this.advance(m, 'A good guard. Hands up, chin down, eyes open.');
      }
    },
    advance(m, line) {
      const s = m.state;
      s.i++;
      game.audio.play('bell', { volume: 0.25, rate: 1.4 });
      if (line) game.ui.subtitle(`Guru Ramdas: “${line}”`, 4);
      if (s.i >= STEPS.length) m.done();
    },
    on(m, event, data) {
      const s = m.state;
      const step = STEPS[s.i];
      if (!step || step.talk || !event.startsWith('combat:')) return;
      const e = { type: event.slice(7), ...data };
      if (e.type === 'hit' && e.sword) {
        const t = game.combat.time;
        s.chain = t - s.lastHit < 1.6 ? s.chain + 1 : 1;
        s.lastHit = t;
      }
      if (step.need?.(e, s)) {
        const lines = { fists: 'Again! From the hips, not the shoulder.', kick: 'Good. The leg is longer than the arm; use it.', combo: 'Three cuts, one breath. Your grandfather would have liked you.', heavy: '' };
        this.advance(m, lines[step.id]);
      }
    },
    interact(m) {
      const s = m.state;
      if (STEPS[s.i]?.talk && m.giver && m.near(m.giver, 2.8))
        return {
          prompt: 'Take the talwar',
          action: () =>
            m.say(
              [
                ['Guru Ramdas', 'This was my grandfather’s. He carried it at the Ramnagar mela and never once drew it in anger.'],
                ['Guru Ramdas', 'A talwar cuts with the curve, not the strength. Draw it with R. Cut, cut, thrust. Then the big one, from over the head.'],
              ],
              {
                then: () => {
                  game.combat.setHasSword(true);
                  game.audio.play('blade-draw', { volume: 0.6 });
                  this.advance(m);
                },
              }
            ),
        };
      return null;
    },
    stop() {
      // the sword stays only if the lesson was finished (perk), otherwise it goes back to the guru
      game.missions.applyPerks();
    },
    outro: [['Guru Ramdas', 'Enough for today. Keep it. Come back at dawn and I will teach you to fall without breaking.']],
    reward: { punya: 30, perk: 'sword', note: 'The talwar is yours: R to draw it' },
  };
}
