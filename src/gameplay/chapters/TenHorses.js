import * as THREE from 'three';
import { ghatToWorld, PROFILE_LEN } from '../../world/WorldLayout.js';
import { lines } from './lines.js';
import { faceTo, fromRiver, ghatById, orbit, place, spot, twoShot } from './kit.js';

// Chapter III · The Ten Horses (Dashashwamedh). Brahma performed ten horse sacrifices here to
// welcome Shiva home. Acharya Mishra needs Ganga jal from mid-river for the evening aarti; Prady
// rows out for it, watches the aarti from the water as the lamps rise and turn, and then the dark
// comes for the aarti itself and he must hold the steps. The Flame of the Ten Sacrifices burns.

const VOICES = ['ch3/legend', 'ch3/meet-01', 'ch3/meet-02', 'ch3/water', 'ch3/back-01', 'ch3/aarti-01', 'ch3/attack-01', 'ch3/won-01', 'ch3/lit-01'];

export default function tenHorses(game) {
  const G = ghatById('dashashwamedh');
  const W = G.width;
  const acharyaAt = () => spot('dashashwamedh', W * 0.5 + 4.5, 2, -1.4);
  const midRiver = () => {
    const p = ghatToWorld(G, W * 0.5, PROFILE_LEN + 115);
    return { x: p.x, y: 0.4, z: p.z };
  };
  const viewSpot = () => {
    const p = ghatToWorld(G, W * 0.5 - 2, PROFILE_LEN + 20);
    return { x: p.x, y: 0.4, z: p.z };
  };
  // out on the water before the ghat (the mark is only a guide: anywhere with a view will do)
  const onView = () => {
    const c = ghatToWorld(G, W * 0.5, PROFILE_LEN);
    const dx = game.boat.x - c.x;
    const dz = game.boat.z - c.z;
    const out = dx * G.N.x + dz * G.N.z;
    const side = Math.abs(dx * G.N.z - dz * G.N.x);
    const v = viewSpot();
    return Math.hypot(game.boat.x - v.x, game.boat.z - v.z) < 12 || (out > 14 && out < 70 && side < W * 0.5 + 10);
  };
  const acharya = (s) => {
    const p = acharyaAt();
    const a = s.actor({ avatarId: 'Male_Adult_08', x: p.x, y: p.y, z: p.z, yaw: p.yaw + Math.PI, clip: 'idle', name: 'Acharya Mishra' });
    if (a) a.tint = 'saffron';
    s.state.ach = a;
    return a;
  };
  const talk = (s, keys, then) => {
    const a = s.state.ach;
    faceTo(a, game.player.position);
    const P = game.player.position;
    s.scene({ keys: twoShot(a, { x: P.x, y: game.player.feetY, z: P.z }, 14), lines: lines(...keys), then });
  };
  // put Prady in his boat at the foot of the ghat (test jumps), the bow to the river
  const inBoat = (g, at = null) => {
    const b = g.boat;
    const p = at || ghatToWorld(G, W * 0.55, PROFILE_LEN + 6);
    b.x = b.prev.x = p.x;
    b.z = b.prev.z = p.z;
    b.vx = b.vz = 0;
    b.yaw = b.prev.yaw = Math.atan2(G.N.x, G.N.z);
    if (g.player.state !== 'boat') g.player.enterBoat(b);
    g.camRig.yaw = b.yaw;
    g.camRig.first = true;
  };
  const kalash = (() => {
    const m = new THREE.Mesh(
      new THREE.LatheGeometry([[0, 0], [0.09, 0.01], [0.13, 0.08], [0.12, 0.16], [0.06, 0.22], [0.07, 0.27], [0.075, 0.28]].map(([x, y]) => new THREE.Vector2(x, y)), 16),
      new THREE.MeshStandardMaterial({ color: 0xc8962f, metalness: 0.9, roughness: 0.3 })
    );
    m.visible = false;
    game.scene.add(m);
    return m;
  })();
  const _h = new THREE.Vector3();
  const carryKalash = (on) => (kalash.visible = on);
  const followHand = () => {
    if (!kalash.visible) return;
    if (game.player.state === 'boat') {
      game.boat.seatWorld(_h);
      kalash.position.set(_h.x + 0.35, _h.y + 0.05, _h.z + 0.2);
    } else if (game.animator.boneWorld?.('LeftHand', _h)) kalash.position.set(_h.x, _h.y - 0.08, _h.z);
  };

  return {
    id: 'tenHorses',
    num: 3,
    title: 'The Ten Horses',
    flame: 'dashashwamedh',
    ghat: 'dashashwamedh',
    voices: VOICES,
    legend: 'To welcome Shiva home to Kashi, Brahma the creator performed ten great horse sacrifices on these steps. The ghat still carries their name: Dashashwamedh.',
    steps: [
      {
        id: 'meet',
        title: 'Acharya Mishra',
        text: 'Find Acharya Mishra by the aarti platforms on Dashashwamedh Ghat.',
        prep(g) {
          g.sky.setHours(15);
          place(g, spot('dashashwamedh', W * 0.5 + 2, 2, 0.6), acharyaAt());
        },
        start(s) {
          acharya(s);
          game.preloadVoices(VOICES);
        },
        update(s) {
          const a = s.state.ach;
          if (a) s.mark('giver', a);
          if (!s.state.legend && a && s.near(a, 45)) {
            s.state.legend = true;
            game.voice('ch3/legend');
          }
        },
        interact(s) {
          const a = s.state.ach;
          if (!a || !s.near(a, 3)) return null;
          return { prompt: 'Talk to Acharya Mishra', action: () => talk(s, ['ch3/meet-01', 'ch3/meet-02'], () => s.next()) };
        },
      },
      {
        id: 'water',
        title: 'Ganga jal',
        text: 'Take your boat out to the middle of the river and fill the kalash where the water runs clean.',
        prep(g) {
          g.sky.setHours(15.3);
          inBoat(g);
        },
        start(s) {
          acharya(s);
          carryKalash(true);
        },
        update(s) {
          followHand();
          const inBoatNow = game.player.state === 'boat';
          s.state.text = inBoatNow ? 'Row out to the glowing mark in the middle of the river (W row · A/D steer).' : 'Board your boat at the foot of the steps (E) and row out to the middle of the river.';
          if (!inBoatNow) s.mark('objective', { x: game.boat.x, y: 1.5, z: game.boat.z });
          s.mark('objective', midRiver());
        },
        interact(s) {
          const m = midRiver();
          if (game.player.state !== 'boat' || Math.hypot(game.boat.x - m.x, game.boat.z - m.z) > 13) return null;
          return {
            prompt: 'Fill the kalash with Ganga jal',
            action: () => {
              game.audio.play('splash', { at: new THREE.Vector3(game.boat.x, 0, game.boat.z), volume: 0.4, rate: 1.4 });
              game.audio.play('chime', { volume: 0.5 });
              s.say(lines('ch3/water'), () => s.next());
            },
          };
        },
      },
      {
        id: 'back',
        title: 'Back to the ghat',
        text: 'Bring the Ganga jal back to Acharya Mishra.',
        prep(g) {
          g.sky.setHours(16.2);
          place(g, spot('dashashwamedh', W * 0.5 + 2.5, 2, 0.6), acharyaAt());
        },
        start(s) {
          acharya(s);
          carryKalash(true);
        },
        update(s) {
          followHand();
          if (s.state.ach) s.mark('giver', s.state.ach);
        },
        interact(s) {
          const a = s.state.ach;
          if (!a || game.player.state === 'boat' || !s.near(a, 3)) return null;
          return {
            prompt: 'Give Acharya Mishra the Ganga jal',
            action: () =>
              talk(s, ['ch3/back-01'], () => {
                carryKalash(false);
                game.setTimeOfDay(18.55, 4);
                s.scene({ keys: fromRiver('dashashwamedh', W * 0.5, 7, 60, 9), lines: [['', '…', null, 5.5]], then: () => s.next() });
              }),
          };
        },
      },
      {
        id: 'aarti',
        title: 'The aarti from the water',
        text: 'Take your boat out to the glowing mark before the ghat and watch the Ganga aarti.',
        prep(g) {
          g.sky.setHours(18.6);
          inBoat(g);
        },
        start(s) {
          acharya(s);
          game.quest.forceAarti = true;
          if (game.sky.hours < 18.4 || game.sky.hours > 22) game.sky.setHours(18.6);
        },
        update(s) {
          s.mark('objective', viewSpot());
          if (!s.state.watching && game.player.state === 'boat' && onView()) {
            s.state.watching = true;
            const c = ghatToWorld(G, W * 0.5, PROFILE_LEN - 8);
            const C = { x: c.x, y: 2.7, z: c.z };
            game.audio.play('conch', { volume: 0.8 });
            // the aarti, seen from the boats: slow arcs across the platforms (angles about the
            // ghat's riverward normal, so the camera stays out over the water)
            const a = Math.atan2(G.N.x, G.N.z);
            s.scene({
              keys: [...orbit(C, 26, 6, a - 0.45, a + 0.4, 9, 1.6), ...orbit(C, 14, 3.2, a + 0.4, a - 0.3, 9, 1.8).map((k) => ({ ...k, t: k.t + 9.2 }))],
              lines: [...lines('ch3/aarti-01'), ['', '…', null, 9], ...lines('ch3/attack-01')],
              then: () => s.next(),
            });
          }
        },
      },
      {
        id: 'defend',
        title: 'Defend the aarti',
        text: 'Asuras are rising to put out the aarti! Get back to the steps and drive them into the river.',
        resumeFrom: 3,
        prep(g) {
          g.sky.setHours(19);
          g.combat.setHasSword(true);
          g.missions.perks.sword = true;
          place(g, spot('dashashwamedh', W * 0.5, 2, 0.6), ghatToWorld(G, W * 0.5, 30));
        },
        start(s) {
          acharya(s);
          game.quest.forceAarti = true;
          game.checkpoint = spot('dashashwamedh', W * 0.5 + 6, 1, 0);
          game.encounters.start({ ghat: 'dashashwamedh', u: W * 0.5, title: 'Dashashwamedh Ghat', waves: [{ n: 3, kind: 'shade' }, { n: 2, kind: 'shade' }, { n: 1, kind: 'brute' }], onWin: () => s.next() });
        },
        update(s) {
          if (game.player.state === 'boat') s.state.text = 'Row back to the steps and fight! (E to step off the boat)';
          else s.state.text = null;
        },
        stop() {
          if (game.encounters.cur?.def.ghat === 'dashashwamedh') game.encounters.clear();
        },
      },
      {
        id: 'flame',
        title: 'Light the Flame of the Ten Sacrifices',
        text: 'Light the Flame of the Ten Sacrifices on the central aarti platform.',
        lightFlame: true,
        prep(g) {
          g.sky.setHours(19.6);
          g.quest.forceAarti = true;
          const f = g.quest.flames.find((x) => x.id === 'dashashwamedh');
          place(g, { x: f.pos.x + 2, y: f.pos.y, z: f.pos.z }, f.pos);
        },
        start(s) {
          acharya(s);
          game.after(1, () => s.over || s.say(lines('ch3/won-01')));
        },
        update(s) {
          const f = game.quest.flames.find((x) => x.id === 'dashashwamedh');
          if (f && !f.lit) s.mark('objective', f.pos);
        },
        on(s, ev, d) {
          if (ev !== 'flame' || d.id !== 'dashashwamedh') return;
          game.after(2, () => talk(s, ['ch3/lit-01'], () => s.next()));
        },
        stop() {
          game.quest.forceAarti = false;
          game.checkpoint = null;
        },
      },
    ],
    reward: {
      note: 'Brahma’s blessing: your oar pulls harder',
      apply(g) {
        g.boat.power = Math.max(g.boat.power, 1.45);
      },
    },
  };
}
