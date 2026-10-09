import * as THREE from 'three';
import { NAMED_SHOPS } from '../../world/Galis.js';
import { ledge } from '../missions/places.js';
import { lines } from './lines.js';
import { faceTo, fromRiver, ghatById, place, spot, twoShot } from './kit.js';
import { bankCoords } from '../../world/WorldLayout.js';

// Chapter II · Annapurna's Kitchen (Kedar Ghat). Kashi is Annapurna's city, and the bhandara
// at Kedar has gone cold since the flame went dark. Amma sends Prady up into the galis for rice,
// dal, ghee and spices; he stirs the khichdi with her; he serves the old pilgrims on the steps,
// and the last of them is no ordinary sadhu. (Kedareshwar, the legend says, rose out of a
// devotee's pot of khichdi.)

const ITEMS = { rice: 'Rice', dal: 'Toor dal', ghee: 'Ghee', spice: 'Salt and haldi' };
const VOICES = ['ch2/legend', 'ch2/meet-01', 'ch2/meet-02', 'ch2/meet-03', 'ch2/rice', 'ch2/dal', 'ch2/spice', 'ch2/ghee', 'ch2/ghee-back', 'ch2/cook-01', 'ch2/cook-02', 'ch2/serve-last', 'ch2/sadhu-01', 'ch2/sadhu-02', 'ch2/lit-01', 'ch2/lit-02'];

export default function annapurna(game) {
  const G = ghatById('kedar');
  const K = () => game.kitchen;
  const ammaAt = () => {
    const c = K().cookAt;
    return { x: c.x, y: c.y, z: c.z, yaw: K().yaw };
  };
  const amma = (s) => {
    const p = ammaAt();
    const a = s.actor({ avatarId: 'Female_Adult_06', x: p.x, y: p.y, z: p.z, yaw: p.yaw, clip: 'stir', name: 'Amma' });
    if (a) a.tint = 'saffron';
    s.state.amma = a;
    return a;
  };
  const talkAmma = (s, keys, then) => {
    const a = s.state.amma;
    faceTo(a, game.player.position);
    const P = game.player.position;
    s.scene({ keys: twoShot(a, { x: P.x, y: game.player.feetY, z: P.z }, 14), lines: lines(...keys), then });
  };
  const nearKitchen = () => {
    const p = K().stirAt;
    return { x: p.x, y: p.y + 0.02, z: p.z, yaw: K().yaw + Math.PI };
  };
  // the pilgrims waiting on the steps, the last one the sadhu
  const pilgrims = [
    { u: 18, avatar: 'Male_Adult_14' },
    { u: 22, avatar: 'Female_Adult_11' },
    { u: 26.5, avatar: 'Male_Adult_08' },
    { u: 31, avatar: 'Female_Adult_15' },
    { u: 36, avatar: 'Male_Adult_20', sadhu: true },
  ];
  const plate = (() => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.CircleGeometry(0.16, 18).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3f7a2c, roughness: 0.6, side: THREE.DoubleSide })));
    const heap = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.45, 1), new THREE.MeshStandardMaterial({ color: 0xe0b44a, roughness: 0.55 }));
    heap.position.y = 0.005;
    g.add(heap);
    g.visible = false;
    game.scene.add(g);
    return g;
  })();
  const _h = new THREE.Vector3();
  const carry = (on) => (plate.visible = on);

  return {
    id: 'annapurna',
    num: 2,
    title: 'Annapurna’s Kitchen',
    flame: 'kedar',
    ghat: 'kedar',
    voices: VOICES,
    legend: 'Kashi is the city of Annapurna, the Mother who feeds the world. At Kedar Ghat, they say, Shiva himself once rose out of a devotee’s pot of khichdi.',
    steps: [
      {
        id: 'meet',
        title: 'Amma’s kitchen',
        text: 'Find Amma at the temple kitchen on Kedar Ghat.',
        prep(g) {
          g.sky.setHours(10);
          place(g, nearKitchen(), ammaAt());
        },
        start(s) {
          amma(s);
          game.preloadVoices(VOICES);
        },
        update(s) {
          const a = s.state.amma;
          if (a) s.mark('giver', a);
          if (!s.state.legend && a && s.near(a, 40)) {
            s.state.legend = true;
            game.voice('ch2/legend');
          }
        },
        interact(s) {
          const a = s.state.amma;
          if (!a || !s.near(a, 3.2)) return null;
          return { prompt: 'Talk to Amma', action: () => talkAmma(s, ['ch2/meet-01', 'ch2/meet-02', 'ch2/meet-03'], () => s.next()) };
        },
      },
      {
        id: 'gather',
        title: 'Into the galis',
        text: 'Fetch rice, dal, ghee and spices from the shops in the lanes behind Kedar Ghat.',
        prep(g) {
          g.sky.setHours(10.5);
          const sh = g.world.galis.shop('gopal');
          place(g, { ...sh.counter, yaw: sh.yaw + Math.PI }, sh);
        },
        skip(g) {
          g.story.flags.ch2Items = ['rice', 'dal', 'ghee', 'spice'];
        },
        start(s) {
          amma(s);
          s.state.got = new Set(game.story.flags.ch2Items || []);
          // the shopkeepers, sitting on their takhts
          s.state.keepers = {};
          for (const ns of NAMED_SHOPS) {
            const sh = game.world.galis.shop(ns.id);
            if (!sh) continue;
            const a = s.actor({ avatarId: ns.owner === 'Sushila' ? 'Female_Adult_15' : ns.owner === 'Mohan' ? 'Male_Adult_06' : ns.owner === 'Agarwal' ? 'Male_Adult_20' : 'Male_Adult_14', x: sh.seat.x, y: sh.seat.y, z: sh.seat.z, yaw: sh.seat.yaw, clip: 'meditate', seatY: sh.seat.y, feetY: sh.seat.y, name: ns.owner });
            s.state.keepers[ns.id] = a;
          }
        },
        update(s) {
          const left = NAMED_SHOPS.filter((n) => !s.state.got.has(n.item));
          s.state.text = left.length ? `Fetch from the galis: ${left.map((n) => `${ITEMS[n.item]} (${n.owner})`).join(', ')}.` : 'Take it all back to Amma at Kedar Ghat.';
          for (const n of left) {
            const sh = game.world.galis.shop(n.id);
            if (sh) s.mark('objective', { x: sh.counter.x, y: sh.counter.y + 2.6, z: sh.counter.z });
          }
          if (!left.length) {
            game.story.flags.ch2Items = [...s.state.got];
            s.mark('objective', ammaAt());
          }
        },
        interact(s) {
          for (const n of NAMED_SHOPS) {
            if (s.state.got.has(n.item)) continue;
            const sh = game.world.galis.shop(n.id);
            if (!sh || !s.near(sh.counter, 2.6)) continue;
            return {
              prompt: `Ask ${n.owner} for ${ITEMS[n.item].toLowerCase()}`,
              action: () => {
                const k = s.state.keepers[n.id];
                if (k) game.crowd.gesture(k, 'talk', 2.5, game.player.position);
                s.say(lines(`ch2/${n.item}`), () => {
                  s.state.got.add(n.item);
                  game.story.flags.ch2Items = [...s.state.got];
                  game.audio.play('chime', { volume: 0.4 });
                  game.ui.toast(ITEMS[n.item], `${s.state.got.size} of 4 for Amma’s pot`, 2.5);
                });
              },
            };
          }
          if (s.state.got.size >= 4 && s.state.amma && s.near(s.state.amma, 3.2)) return { prompt: 'Give Amma the ingredients', action: () => s.next() };
          return null;
        },
      },
      {
        id: 'cook',
        title: 'Stir the khichdi',
        text: 'Stir the khichdi with Amma: press E as the marker crosses the golden mark.',
        prep(g) {
          g.sky.setHours(11.5);
          place(g, nearKitchen(), K().pos);
        },
        skip(g) {
          g.kitchen.setCooking(true);
        },
        start(s) {
          amma(s);
          s.state.stirring = false;
          talkAmma(s, ['ch2/cook-01'], () => (s.state.ready = true));
        },
        update(s, dt) {
          s.mark('objective', { x: K().pos.x, y: K().pos.y + 1.8, z: K().pos.z }, false);
          if (!s.state.stirring) return;
          const inp = game.input;
          const r = game.ui.rhythmUpdate(dt, inp.hit('KeyE') || inp.hit('Space') || inp.hit('Pad2') || inp.hit('Pad0'));
          if (r === 'hit') game.audio.play('splash', { at: K().pos, volume: 0.15, rate: 1.8 });
          if (r === 'miss') game.camRig.shake(0.05);
          if (r === 'done') {
            s.state.stirring = false;
            game.player.inputLocked = false;
            game.actions.stopHold?.();
            K().setCooking(true);
            game.audio.play('chime', { volume: 0.5 });
            talkAmma(s, ['ch2/cook-02'], () => s.next());
          }
        },
        interact(s) {
          if (!s.state.ready || s.state.stirring || !s.near(K().stirAt, 2.4)) return null;
          return {
            prompt: 'Stir the pot',
            action: () => {
              s.state.stirring = true;
              game.player.yaw = Math.atan2(K().pos.x - game.player.position.x, K().pos.z - game.player.position.z);
              game.ui.rhythmStart({ title: 'Stir the khichdi', hint: 'E when the marker crosses the gold', need: 5, speed: 0.75, zone: 0.17 });
            },
          };
        },
        stop() {
          game.ui.rhythmStop();
        },
      },
      {
        id: 'serve',
        title: 'Feed the pilgrims',
        text: 'Take plates of khichdi from the kitchen and serve the pilgrims sitting on the steps.',
        prep(g) {
          g.kitchen.setCooking(true);
          g.sky.setHours(12.5);
          place(g, nearKitchen(), K().pos);
        },
        start(s) {
          amma(s);
          K().setCooking(true);
          s.state.served = 0;
          s.state.carrying = false;
          s.state.people = pilgrims.map((pg) => {
            const L = ledge(G, pg.u);
            const a = s.actor({ avatarId: pg.avatar, x: L.x, y: L.y, z: L.z, yaw: L.yaw + Math.PI, clip: 'floorSit', seatY: L.seatY, feetY: L.feetY, name: pg.sadhu ? 'The Sadhu' : 'Pilgrim' });
            if (a && pg.sadhu) a.tint = 'saffron';
            return { ...pg, a, fed: false };
          });
        },
        update(s) {
          const left = s.state.people.filter((p) => !p.fed);
          const next = left[0];
          s.state.text = s.state.carrying ? `Serve ${next?.sadhu ? 'the old sadhu at the end of the row' : 'the next pilgrim on the steps'}.` : `Take a plate from the kitchen (${s.state.served} of ${s.state.people.length} served).`;
          if (s.state.carrying && next?.a) s.mark('objective', { x: next.a.x, y: next.a.y + 1.8, z: next.a.z });
          else s.mark('objective', { x: K().pos.x, y: K().pos.y + 1.8, z: K().pos.z }, true);
          if (plate.visible && game.animator.boneWorld) {
            game.animator.boneWorld('RightHand', _h);
            plate.position.set(_h.x, _h.y + 0.04, _h.z);
          }
        },
        interact(s) {
          if (!s.state.carrying && s.near(K().stirAt, 2.6)) return { prompt: 'Take a plate of khichdi', action: () => ((s.state.carrying = true), carry(true), game.audio.play('chime', { volume: 0.2, rate: 1.4 })) };
          if (!s.state.carrying) return null;
          const p = s.state.people.find((x) => !x.fed);
          if (!p?.a || !s.near(p.a, 2.4)) return null;
          return {
            prompt: p.sadhu ? 'Serve the old sadhu' : 'Serve the pilgrim',
            action: () => {
              s.state.carrying = false;
              carry(false);
              p.fed = true;
              s.state.served++;
              game.crowd.gesture(p.a, 'agree', 2.5, game.player.position);
              game.missions.punya += 2;
              game.ui.setPunya(game.missions.punya);
              if (!p.sadhu) return game.audio.play('chime', { volume: 0.3 });
              // the last of them
              const P = game.player.position;
              s.scene({
                keys: twoShot(p.a, { x: P.x, y: game.player.feetY, z: P.z }, 16, -1),
                lines: lines('ch2/serve-last', 'ch2/sadhu-01', 'ch2/sadhu-02'),
                then: () => {
                  // he is gone, the way such guests go in Kashi
                  game.ui.flash();
                  game.audio.play('bell', { at: p.a, volume: 0.8 });
                  game.crowd.removeActor(p.a);
                  s.next();
                },
              });
            },
          };
        },
        stop() {
          carry(false);
        },
      },
      {
        // the hunger that is never fed: a shielded champion of the dark rises to the smell of the
        // khichdi (Asuras.js mini-boss: break its guard with a heavy cut or a kick, or go round it)
        id: 'hunger',
        title: 'The hunger that is never fed',
        text: 'Something rises out of the river to the smell of the khichdi. Defend Amma’s kitchen!',
        prep(g) {
          g.kitchen.setCooking(true);
          g.sky.setHours(13);
          g.combat.setHasSword(true);
          g.missions.perks.sword = true;
          place(g, nearKitchen(), K().pos);
        },
        start(s) {
          amma(s);
          K().setCooking(true);
          game.checkpoint = { ...nearKitchen() };
          const u = bankCoords(K().pos.x, K().pos.z).u;
          game.ui.subtitle('Amma: “Beta… the river. Something is coming up the steps.”', 4);
          game.after(2.5, () =>
            game.encounters.start({
              ghat: 'kedar',
              u,
              title: 'Kedar Ghat',
              waves: [{ n: 2, kind: 'shade' }, { kind: 'kavacha', mini: true, name: 'Mahodara', title: 'the Bottomless Belly' }],
              onWin: () => {
                game.ui.subtitle('Amma: “Go, beta. Light Kedareshwar’s flame. No hunger crosses a lit ghat.”', 4.5);
                s.next();
              },
            })
          );
        },
        stop() {
          if (game.encounters.cur?.def.ghat === 'kedar') game.encounters.clear();
        },
      },
      {
        id: 'flame',
        title: 'Light the Flame of Kedareshwar',
        text: 'Light the Flame of Kedareshwar on the terrace above.',
        lightFlame: true,
        prep(g) {
          g.kitchen.setCooking(true);
          g.sky.setHours(13);
          const f = g.quest.flames.find((x) => x.id === 'kedar');
          place(g, { x: f.pos.x + 2.5, y: f.pos.y, z: f.pos.z }, f.pos);
        },
        start(s) {
          amma(s);
          K().setCooking(true);
        },
        update(s) {
          const f = game.quest.flames.find((x) => x.id === 'kedar');
          if (f && !f.lit) s.mark('objective', f.pos);
        },
        on(s, ev, d) {
          if (ev !== 'flame' || d.id !== 'kedar') return;
          game.after(2, () => s.scene({ keys: fromRiver('kedar', G.width * 0.5 - 12, 9, 34, 6), lines: lines('ch2/lit-01', 'ch2/lit-02'), then: () => s.next() }));
        },
      },
    ],
    reward: {
      note: 'Annapurna’s prasad: your prana heals faster',
      apply(g) {
        g.health.regenMul = 1.6;
      },
    },
  };
}
