import * as THREE from 'three';
import { ghatToWorld, PROFILE_LEN } from '../../world/WorldLayout.js';
import { lines } from './lines.js';
import { faceTo, ghatById, place, spot, twoShot } from './kit.js';

// Chapter IV · The Lost Earring (Manikarnika and the leaning temple of Ratneshwar). Parvati's
// jewelled earring, the manikarnika, fell into the water here; Shiva searches for it still.
// Kallu, who keeps the funeral fires, has seen a green-gold light under the river by the leaning
// temple. Prady dives for it among drifting shadows that drink his breath, finds a lota, a coin,
// and in the drowned doorway of the temple, the earring. The dark follows him up the steps.

const VOICES = ['ch4/legend', 'ch4/meet-01', 'ch4/meet-02', 'ch4/meet-03', 'ch4/glint', 'ch4/found', 'ch4/ambush', 'ch4/won-01', 'ch4/lit-01'];

export default function lostEarring(game) {
  const M = ghatById('manikarnika');
  const S = ghatById('scindia');
  const kalluAt = () => spot('manikarnika', M.width * 0.36, 1, -1.2);
  // the leaning temple's frame (as Props.js builds it): behind the flame platform, tilted riverward
  const templeM = () => {
    const f = game.world.layout.flames.find((x) => x.type === 'sunken');
    const back = { x: f.x - S.N.x * 6.2, z: f.z - S.N.z * 6.2 };
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.17, S.yaw, 0, 'YXZ'));
    return new THREE.Matrix4().compose(new THREE.Vector3(back.x, -3.4, back.z), q, new THREE.Vector3(1, 1, 1));
  };
  const T = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(templeM());
  // in the doorway (low down), and two false lights among the stones at its foot
  const finds = () => [
    { id: 'lota', at: T(-3.2, 0.7, 4.6), real: false },
    { id: 'coin', at: T(3.6, 0.6, 3.4), real: false },
    { id: 'earring', at: T(0, 1.15, 0.72), real: true },
  ];
  // shadows drifting in the water round the temple
  const wisps = () => [T(-5, 1.6, 6), T(4.5, 1.2, 7.5), T(0.5, 2.2, 9), T(-2.5, 1.0, 2.6)];
  const kallu = (s) => {
    const p = kalluAt();
    const a = s.actor({ avatarId: 'Male_Adult_20', x: p.x, y: p.y, z: p.z, yaw: p.yaw + Math.PI, clip: 'idle', name: 'Kallu' });
    s.state.kallu = a;
    return a;
  };
  const talk = (s, keys, then) => {
    const a = s.state.kallu;
    faceTo(a, game.player.position);
    const P = game.player.position;
    s.scene({ keys: twoShot(a, { x: P.x, y: game.player.feetY, z: P.z }, 16, -1), lines: lines(...keys), then });
  };
  // the earring itself: a gold drop with a green stone, glowing faintly in the dark water
  const ring = (() => {
    const g = new THREE.Group();
    const gold = new THREE.MeshStandardMaterial({ color: 0xe1b24a, metalness: 1, roughness: 0.25, emissive: 0x3a2400, emissiveIntensity: 0.6 });
    g.add(new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 8, 20), gold));
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.028), new THREE.MeshStandardMaterial({ color: 0x2bd17a, emissive: 0x1aa060, emissiveIntensity: 1.4, metalness: 0.2, roughness: 0.1 }));
    gem.position.y = -0.06;
    g.add(gem);
    g.visible = false;
    game.scene.add(g);
    return g;
  })();
  const glowFor = (f) => ({ x: f.at.x, y: f.at.y + 0.25, z: f.at.z });
  const scindiaSteps = () => spot('scindia', 14, 2, 0.4);

  return {
    id: 'lostEarring',
    num: 4,
    title: 'The Lost Earring',
    flame: 'ratneshwar',
    ghat: 'manikarnika',
    voices: VOICES,
    legend: 'While Shiva and Parvati bathed here, her jewelled earring, the manikarnika, fell into the water. Shiva searches for it still, they say, among the fires of the burning ghat.',
    steps: [
      {
        id: 'meet',
        title: 'The keeper of the fires',
        text: 'Find Kallu by the funeral fires of Manikarnika Ghat.',
        prep(g) {
          g.sky.setHours(21.4);
          place(g, spot('manikarnika', M.width * 0.36 + 2, 1, 0.6), kalluAt());
        },
        start(s) {
          kallu(s);
          game.preloadVoices(VOICES);
          if (game.sky.hours > 5 && game.sky.hours < 19.5) game.setTimeOfDay(21.2, 4);
        },
        update(s) {
          const a = s.state.kallu;
          if (a) s.mark('giver', a);
          if (!s.state.legend && a && s.near(a, 40)) {
            s.state.legend = true;
            game.voice('ch4/legend');
          }
        },
        interact(s) {
          const a = s.state.kallu;
          if (!a || !s.near(a, 3)) return null;
          return { prompt: 'Talk to Kallu', action: () => talk(s, ['ch4/meet-01', 'ch4/meet-02', 'ch4/meet-03'], () => s.next()) };
        },
      },
      {
        id: 'dive',
        title: 'The light under the water',
        text: 'Swim out to the leaning temple off Scindia Ghat and dive (C) for the light under the water.',
        prep(g) {
          g.sky.setHours(21.8);
          const p = ghatToWorld(S, 14, PROFILE_LEN + 2);
          place(g, { x: p.x, y: 0, z: p.z, yaw: S.yaw }, T(0, 0, 4));
        },
        start(s) {
          s.state.found = new Set(game.story.flags.ch4Found || []);
          ring.visible = true;
          ring.position.copy(finds()[2].at);
        },
        update(s, dt) {
          const F = finds().filter((f) => !s.state.found.has(f.id));
          for (const f of F) s.mark('item', glowFor(f), f.real);
          if (!F.length) return;
          ring.rotation.y += dt * 0.8;
          // the shadows: smoke under the water; brushing one drinks the breath out of him
          const P = game.player.position;
          for (const w of wisps()) {
            if (Math.random() < dt * 14) game.asuras.particles.emitSmoke(w.x + (Math.random() - 0.5) * 1.5, w.y + (Math.random() - 0.5), w.z + (Math.random() - 0.5) * 1.5, 1.4);
            if ((game.player.state === 'dive' || game.player.state === 'swim') && P.distanceTo(w) < 2.2) {
              game.player.breath = Math.max(0, game.player.breath - dt * 4);
              if (!s.state.warned) {
                s.state.warned = true;
                game.ui.toast('A shadow brushes past', 'It drinks your breath: keep clear of them.', 3);
              }
            }
          }
        },
        interact(s) {
          const P = game.player.position;
          for (const f of finds()) {
            if (s.state.found.has(f.id) || P.distanceTo(f.at) > 1.9) continue;
            return {
              prompt: f.real ? 'Reach into the drowned doorway' : 'Take the glinting thing',
              action: () => {
                s.state.found.add(f.id);
                game.story.flags.ch4Found = [...s.state.found];
                game.audio.play('chime', { volume: 0.5, rate: f.real ? 0.8 : 1.3 });
                if (!f.real) return s.say(lines('ch4/glint'));
                ring.visible = false;
                game.ui.flash();
                s.say(lines('ch4/found'), () => s.next());
              },
            };
          }
          return null;
        },
        stop() {
          ring.visible = false;
        },
      },
      {
        id: 'ambush',
        title: 'They followed you',
        text: 'Swim back to Scindia Ghat. Something followed you up out of the water.',
        prep(g) {
          g.sky.setHours(22);
          g.combat.setHasSword(true);
          g.missions.perks.sword = true;
          place(g, scindiaSteps(), T(0, 0, 8));
        },
        start(s) {
          game.combat.setHasSword(true);
          game.checkpoint = spot('scindia', 18, 1, 0);
        },
        update(s) {
          if (s.state.begun) return;
          const st = scindiaSteps();
          s.mark('objective', st);
          if (game.player.state === 'ground' && s.near(st, 14)) {
            s.state.begun = true;
            game.voice('ch4/ambush');
            game.ui.subtitle('Kallu: “They followed you up out of the water! Fight, boy! The fires are with you!”', 4.5);
            game.encounters.start({ ghat: 'scindia', u: 16, title: 'Scindia Ghat', waves: [{ n: 3, kind: 'shade' }, { n: 1, kind: 'brute' }, { n: 2, kind: 'shade' }], onWin: () => s.next() });
          }
        },
        stop() {
          if (game.encounters.cur?.def.ghat === 'scindia') game.encounters.clear();
        },
      },
      {
        id: 'flame',
        title: 'Light the Flame of Ratneshwar',
        text: 'Give the earring back: light the Flame of Ratneshwar on the broken platform before the leaning temple.',
        lightFlame: true,
        prep(g) {
          g.sky.setHours(22.4);
          const f = g.quest.flames.find((x) => x.id === 'ratneshwar');
          place(g, { x: f.pos.x - S.N.x * 1.6, y: f.pos.y, z: f.pos.z - S.N.z * 1.6 }, f.pos);
        },
        start(s) {
          kallu(s);
          game.after(1, () => s.over || s.say(lines('ch4/won-01')));
        },
        update(s) {
          const f = game.quest.flames.find((x) => x.id === 'ratneshwar');
          if (f && !f.lit) s.mark('objective', f.pos);
        },
        on(s, ev, d) {
          if (ev !== 'flame' || d.id !== 'ratneshwar') return;
          game.after(2, () => s.say(lines('ch4/lit-01'), () => s.next()));
        },
        stop() {
          game.checkpoint = null;
        },
      },
    ],
    reward: {
      note: 'Parvati’s grace: you hold your breath far longer',
      apply(g) {
        g.player.breathMax = Math.max(g.player.breathMax, 35 * 1.6);
      },
    },
  };
}
