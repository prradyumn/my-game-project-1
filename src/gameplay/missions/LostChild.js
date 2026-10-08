import { damp } from '../../utils/math.js';
import { groundHeight } from '../../world/WorldLayout.js';
import { clearSpot, ghatById, ghatSpot } from './places.js';

// Lost in the Mela. Sunita lost her little boy Golu in the crowd while she was buying flowers.
// Ask along the ghats (two people saw him), find him, and walk him back: he follows in your
// footsteps, but he is small, so don't run off without him, and he can't swim.

const TRAIL_STEP = 0.35;

export default function lostChild(game) {
  const dash = ghatById('dashashwamedh');
  const manm = ghatById('manmandir');
  const mani = ghatById('manikarnika');
  const scindia = ghatById('scindia');
  return {
    id: 'lost',
    title: 'Lost in the Mela',
    giver: { name: 'Sunita', avatarId: 'Female_Adult_06', clip: 'wait', hours: [9, 18], at: () => ghatSpot(dash, dash.width * 0.68, 0, 0.4) },
    offer: [
      ['Sunita', 'Golu! Have you seen my Golu? Five years old, blue shirt. I turned my back to buy flowers and he was gone!'],
      ['Sunita', 'Please, bhaiya. Ask along the ghats; someone must have seen him. I will wait right here in case he comes back.'],
    ],
    start(m) {
      const w1 = clearSpot(game.physics, manm, manm.width * 0.35, 1, 0.5);
      const w2 = clearSpot(game.physics, mani, mani.width * 0.15, 0, 0.6);
      const kid = clearSpot(game.physics, scindia, scindia.width * 0.24, 1, -0.6);
      m.state = {
        phase: 'ask1',
        w1: m.actor({ avatarId: 'Male_Adult_08', ...w1, clip: 'wait', name: 'a boatman' }),
        w2: m.actor({ avatarId: 'Male_Adult_20', ...w2, clip: 'idle', name: 'a chai-wala' }),
        kid: m.actor({ avatarId: 'Male_Child_01', ...kid, clip: 'floorSit', name: 'Golu' }),
        trail: [],
        waitT: 0,
      };
      m.state.kid.tint = 'sky';
    },
    update(m, dt) {
      const s = m.state;
      const p = game.player;
      switch (s.phase) {
        case 'ask1':
          m.objective('Ask along the ghats. A boatman at Man Mandir Ghat might have seen him.');
          m.mark('objective', s.w1);
          break;
        case 'ask2':
          m.objective('Find the chai-wala at Manikarnika Ghat.');
          m.mark('objective', s.w2);
          break;
        case 'find':
          m.objective('Look for Golu near the leaning temple at Scindia Ghat.');
          m.mark('objective', s.kid);
          break;
        case 'follow':
          this.follow(m, dt);
          break;
        default:
          break;
      }
    },
    follow(m, dt) {
      const s = m.state;
      const p = game.player;
      const kid = s.kid;
      // breadcrumbs: where Prady has walked (on dry ground only)
      if (p.state === 'ground') {
        const last = s.trail[s.trail.length - 1];
        if (!last || Math.hypot(p.position.x - last.x, p.position.z - last.z) > TRAIL_STEP) s.trail.push({ x: p.position.x, z: p.position.z });
        if (s.trail.length > 400) s.trail.shift();
      }
      // walk along the trail, staying ~1.6 m behind
      let speed = 0;
      while (s.trail.length && Math.hypot(s.trail[0].x - kid.x, s.trail[0].z - kid.z) < 0.25) s.trail.shift();
      const gap = s.trail.length * TRAIL_STEP;
      if (s.trail.length && gap > 1.6) {
        const t = s.trail[0];
        const dx = t.x - kid.x;
        const dz = t.z - kid.z;
        const d = Math.hypot(dx, dz) || 1;
        speed = Math.min(2.3, 0.9 + gap * 0.4);
        const step = Math.min(d, speed * dt);
        kid.x += (dx / d) * step;
        kid.z += (dz / d) * step;
        kid.yaw = Math.atan2(dx, dz);
      }
      kid.actor.speed = damp(kid.actor.speed, speed, 6, dt);
      kid.y = damp(kid.y, groundHeight(kid.x, kid.z), 12, dt);
      kid.clip = 'idle';
      const far = Math.hypot(p.position.x - kid.x, p.position.z - kid.z);
      s.waitT -= dt;
      if (far > 13 && s.waitT <= 0) {
        s.waitT = 8;
        game.ui.subtitle(p.state === 'ground' ? 'Golu: “Bhaiya, wait for me!”' : 'Golu: “I can’t swim, bhaiya!”', 3);
      }
      // home
      const mom = m.giver;
      m.objective('Walk Golu back to his mother at Dashashwamedh. Not too fast.');
      if (mom) {
        m.mark('objective', mom);
        if (Math.hypot(mom.x - kid.x, mom.z - kid.z) < 4.5) {
          s.phase = 'home';
          game.crowd.gesture(mom, 'pranam', 2.4, kid);
          game.crowd.gesture(kid, 'wave', 2.4, mom);
          kid.actor.speed = 0;
          kid.faceGoal = Math.atan2(mom.x - kid.x, mom.z - kid.z);
          m.done();
        }
      }
    },
    interact(m) {
      const s = m.state;
      if (s.phase === 'ask1' && m.near(s.w1, 2.6))
        return {
          prompt: 'Ask the boatman',
          action: () =>
            m.say([
              ['A boatman', 'A little fellow in blue? He ran past here chasing a kite string, laughing like a king.'],
              ['A boatman', 'Went downstream, toward Manikarnika. Ask Bablu at the chai stall up there; he sees everything.'],
            ], { then: () => (s.phase = 'ask2') }),
        };
      if (s.phase === 'ask2' && m.near(s.w2, 2.6))
        return {
          prompt: 'Ask the chai-wala',
          action: () =>
            m.say([
              ['Bablu, the chai-wala', 'Golu? Blue shirt, no slippers? He came by crying for his Amma. I gave him a biscuit.'],
              ['Bablu, the chai-wala', 'Then he wandered down toward Scindia, by the leaning temple. Hurry, the steps there are slippery.'],
            ], { then: () => (s.phase = 'find') }),
        };
      if (s.phase === 'find' && m.near(s.kid, 2.4))
        return {
          prompt: 'Talk to Golu',
          action: () =>
            m.say([
              ['Golu', '(sniff) …I followed the kite and then everybody was too big and I couldn’t see Amma.'],
              ['Prady', 'Your Amma is waiting at Dashashwamedh. Hold on to my shadow, okay? We’ll walk back together.'],
            ], {
              then: () => {
                s.phase = 'follow';
                s.kid.clip = 'idle';
                s.trail = [];
              },
            }),
        };
      return null;
    },
    outro: [
      ['Sunita', 'Golu! Golu, my heart! Never, never let go of my hand again.'],
      ['Sunita', 'Bhaiya, I have nothing to give you but this: may Mahadev keep you as safe as you kept him.'],
    ],
    reward: { punya: 35, note: 'Golu is home' },
  };
}

