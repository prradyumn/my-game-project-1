import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { frameAtX, frameToWorld, ghatToWorld, PROFILE_LEN } from '../../world/WorldLayout.js';
import { waterEdge } from '../missions/places.js';
import { lines } from './lines.js';
import { faceTo, fromRiver, ghatById, orbit, place, spot, twoShot } from './kit.js';

// Chapter V · Kaal Bhairav's Watch (Panchganga). Kaal Bhairav is the Kotwal of Kashi, the city's
// guardian, and his mount is a black dog. One howls on Panchganga Ghat and leads Prady through
// the lanes to Bhairav's temple. The priest sends him across the river to Ramnagar Fort for the
// Raja's mustard oil, pressed for the Ram Lila, to light the Thousand Lamps all at once. Then
// Andhaka, the blind darkness once cut from Shiva himself, rises out of the river, and the last
// flame is lit.

const VOICES = ['ch5/legend', 'ch5/dog-01', 'ch5/temple-01', 'ch5/temple-02', 'ch5/temple-03', 'ch5/fort-01', 'ch5/fort-02', 'ch5/rise-01', 'ch5/rise-02', 'ch5/phase-1', 'ch5/phase-2', 'ch5/fall', 'ch5/lit-01', 'ch5/end-01'];

// Bhairav's hound as it appears to Prady: a lean black dog of shadow, smoke trailing off it,
// two soft gold eyes. It trots ahead and waits.
function houndGeometry() {
  const P = [];
  const add = (g, x, y, z, rx = 0, ry = 0, rz = 0) => P.push(g.rotateX(rx).rotateY(ry).rotateZ(rz).translate(x, y, z).toNonIndexed());
  add(new THREE.CapsuleGeometry(0.16, 0.5, 6, 12), 0, 0.58, 0, Math.PI / 2); // body
  add(new THREE.CylinderGeometry(0.08, 0.11, 0.3, 10), 0, 0.78, 0.36, -0.7); // neck
  add(new THREE.SphereGeometry(0.11, 12, 10).scale(0.9, 0.85, 1.2), 0, 0.9, 0.5); // head
  add(new THREE.CylinderGeometry(0.035, 0.06, 0.2, 10), 0, 0.86, 0.66, Math.PI / 2 - 0.2); // muzzle
  for (const s of [-1, 1]) {
    add(new THREE.ConeGeometry(0.035, 0.11, 6), s * 0.06, 1.0, 0.46, -0.2, 0, -s * 0.2); // ears
    add(new THREE.CylinderGeometry(0.03, 0.025, 0.46, 8), s * 0.09, 0.23, 0.26, 0.05); // forelegs
    add(new THREE.CylinderGeometry(0.035, 0.025, 0.46, 8), s * 0.09, 0.24, -0.27, -0.12); // hind legs
  }
  add(new THREE.CylinderGeometry(0.02, 0.035, 0.34, 8), 0, 0.68, -0.43, 0.9); // tail
  return mergeGeometries(P);
}

export default function kaalBhairav(game) {
  const PG = ghatById('panchganga');
  const PW = PG.width;
  const T = () => game.bhairav;
  const F = () => game.ramnagar;
  const B = (x, v) => {
    const p = frameToWorld(frameAtX(x), 0, v);
    return new THREE.Vector3(p.x, 10.5, p.z);
  };
  // the hound's way: along Panchganga's terrace, up the passage at the ghat seam, east along the
  // first lane to the temple gate
  const path = () => {
    const g = T().gate;
    return [B(372, -1.6), B(352, -1.8), B(337, -2.2), B(336, -14), B(336.5, -26.5), B(352, -26.8), new THREE.Vector3(g.x, 10.5, g.z), new THREE.Vector3(T().center.x, 10.5, T().center.z).lerp(new THREE.Vector3(g.x, 10.5, g.z), 0.5)];
  };
  const boatmanAt = () => {
    const e = waterEdge(PG, PW * 0.62);
    return { x: e.x, y: e.y, z: e.z, yaw: e.yaw };
  };
  const hound = (() => {
    const m = new THREE.Mesh(houndGeometry(), new THREE.MeshStandardMaterial({ color: 0x0b0a0c, roughness: 0.35, metalness: 0.2, emissive: 0x120a04, transparent: true, opacity: 0.92 }));
    m.castShadow = true;
    m.visible = false;
    const eyes = new THREE.Group();
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe08a }));
      e.position.set(s * 0.045, 0.93, 0.6);
      eyes.add(e);
    }
    m.add(eyes);
    game.scene.add(m);
    return m;
  })();
  const steward = (s) => {
    const p = F().stewardAt;
    const a = s.actor({ avatarId: 'Male_Adult_15', x: p.x, y: p.y, z: p.z, yaw: p.yaw, clip: 'idle', name: 'Raja’s Steward' });
    if (a) a.tint = 'cream';
    s.state.steward = a;
  };
  const baba = (s) => {
    const p = T().priestAt;
    const a = s.actor({ avatarId: 'Male_Adult_14', x: p.x, y: p.y, z: p.z, yaw: p.yaw, clip: 'idle', name: 'Bhairav Baba' });
    if (a) a.tint = 'saffron';
    s.state.baba = a;
  };
  const talkTo = (s, a, keys, then, side = 1) => {
    faceTo(a, game.player.position);
    const P = game.player.position;
    s.scene({ keys: twoShot(a, { x: P.x, y: game.player.feetY, z: P.z }, 16, side), lines: lines(...keys), then });
  };
  // a boatman's crossing: fade, time passes, Prady stands on the other shore
  const cross = (to, hours, then) => {
    game.ui.fadeBlack(true);
    game.audio.play('oar', { volume: 0.6 });
    game.after(1.3, () => {
      place(game, to, to.look);
      game.sky.setHours(hours);
      game.after(0.4, () => {
        game.ui.fadeBlack(false);
        then?.();
      });
    });
  };
  const arrivePanchganga = () => {
    const e = waterEdge(PG, PW * 0.62);
    return { x: e.x, y: e.y, z: e.z, look: ghatToWorld(PG, PW * 0.62, 0) };
  };
  const arriveRamnagar = () => ({ x: F().landing.x, y: 0.7, z: F().landing.z, look: F().stewardAt });

  return {
    id: 'kaalBhairav',
    num: 5,
    title: 'Kaal Bhairav’s Watch',
    flame: 'panchganga',
    ghat: 'panchganga',
    voices: VOICES,
    legend: 'Kaal Bhairav is the guardian of Kashi, the Kotwal of the city, and his mount is a black dog. Here the blind demon Andhaka, Shiva’s own darkness, was once cut down. Darkness forgets, but it does not die.',
    steps: [
      {
        id: 'dog',
        title: 'The howling',
        text: 'A black dog is howling on Panchganga Ghat. Follow it.',
        prep(g) {
          g.sky.setHours(19.8);
          place(g, spot('panchganga', 66, 0, 0.4), spot('panchganga', 60, 0, 0));
        },
        start(s) {
          game.preloadVoices(VOICES);
          if (game.sky.hours > 5 && game.sky.hours < 19) game.setTimeOfDay(19.8, 4);
          s.state.i = 0;
          s.state.pos = path()[0].clone();
          s.state.howl = 2;
          hound.visible = true;
          game.voice('ch5/legend');
        },
        update(s, dt) {
          const P = game.player.position;
          const pts = path();
          const h = s.state.pos;
          const goal = pts[Math.min(s.state.i + 1, pts.length - 1)];
          const d = h.distanceTo(goal);
          const near = Math.hypot(P.x - h.x, P.z - h.z);
          // trot on while he follows; wait (and howl) when he falls behind
          if (near < 9 && s.state.i < pts.length - 1) {
            const step = Math.min(d, 3.1 * dt);
            if (d > 1e-3) h.add(goal.clone().sub(h).multiplyScalar(step / d));
            if (d < 0.3) s.state.i++;
          }
          if (!s.state.met && near < 6) {
            s.state.met = true;
            s.say(lines('ch5/dog-01'));
          }
          s.state.howl -= dt;
          if (s.state.howl < 0 && near > 7) {
            s.state.howl = 7 + Math.random() * 4;
            game.audio.play('howl', { at: h, volume: 0.9, ref: 18 });
          }
          hound.position.copy(h);
          const ahead = pts[Math.min(s.state.i + 1, pts.length - 1)];
          const yaw = near < 9 && d > 0.3 ? Math.atan2(ahead.x - h.x, ahead.z - h.z) : Math.atan2(P.x - h.x, P.z - h.z);
          hound.rotation.y += Math.atan2(Math.sin(yaw - hound.rotation.y), Math.cos(yaw - hound.rotation.y)) * Math.min(1, dt * 6);
          if (Math.random() < dt * 22) game.asuras.particles.emitSmoke(h.x + (Math.random() - 0.5) * 0.5, h.y + 0.4 + Math.random() * 0.4, h.z + (Math.random() - 0.5) * 0.5, 0.55);
          s.mark('objective', { x: h.x, y: h.y + 1.6, z: h.z });
          if (s.state.i >= pts.length - 1 && near < 5) s.next();
        },
        stop() {},
      },
      {
        id: 'temple',
        title: 'The Kotwal of Kashi',
        text: 'Enter Kaal Bhairav’s temple and speak to Bhairav Baba in the mandapa.',
        prep(g) {
          g.sky.setHours(20);
          const t = g.bhairav;
          place(g, t.gate, t.center);
        },
        start(s) {
          baba(s);
          hound.visible = true;
          hound.position.copy(T().gate).add(new THREE.Vector3(0, 10.5 - T().gate.y, 0));
        },
        update(s) {
          if (s.state.baba) s.mark('giver', s.state.baba);
        },
        interact(s) {
          const a = s.state.baba;
          if (!a || !s.near(a, 3.2)) return null;
          return {
            prompt: 'Speak to Bhairav Baba',
            action: () => {
              const C = T().bowAt;
              s.scene({
                keys: [...orbit({ x: C.x, y: C.y, z: C.z }, 4.2, 1.8, Math.PI + T().yaw - 0.6, Math.PI + T().yaw + 0.4, 16, 1.4)],
                lines: lines('ch5/temple-01', 'ch5/temple-02', 'ch5/temple-03'),
                onLine: (i) => i === 0 && game.animator.emote?.('pranam'),
                then: () => s.next(),
              });
            },
          };
        },
        stop() {
          hound.visible = false;
        },
      },
      {
        id: 'ramnagar',
        title: 'The Raja’s oil',
        text: 'Cross the river to Ramnagar Fort for the Raja’s mustard oil. The boatman at Panchganga will row you over (or take your own boat).',
        prep(g) {
          g.sky.setHours(20.3);
          const b = boatmanAt();
          place(g, { x: b.x - PG.N.x * 1.8, y: b.y + 0.4, z: b.z - PG.N.z * 1.8 }, b);
        },
        start(s) {
          steward(s);
          const b = boatmanAt();
          s.state.boatman = s.actor({ avatarId: 'Male_Adult_06', x: b.x, y: b.y, z: b.z, yaw: b.yaw + Math.PI, clip: 'idle', name: 'Boatman' });
        },
        update(s) {
          const onFarSide = Math.hypot(game.player.position.x - F().landing.x, game.player.position.z - F().landing.z) < 70;
          if (!onFarSide && s.state.boatman) s.mark('giver', s.state.boatman);
          s.mark('objective', F().stewardAt);
        },
        interact(s) {
          const P = game.player.position;
          const bm = s.state.boatman;
          if (bm && Math.hypot(bm.x - P.x, bm.z - P.z) < 3) return { prompt: 'Ask the boatman to row you to Ramnagar', action: () => cross(arriveRamnagar(), Math.min(21.5, game.sky.hours + 0.6)) };
          const st = s.state.steward;
          if (st && s.near(st, 3.2)) return { prompt: 'Speak to the Raja’s steward', action: () => talkTo(s, st, ['ch5/fort-01', 'ch5/fort-02'], () => (game.audio.play('chime', { volume: 0.5 }), s.next())) };
          return null;
        },
      },
      {
        id: 'return',
        title: 'Back before midnight',
        text: 'Return to Panchganga Ghat with the oil. The steward’s boatman will row you back.',
        prep(g) {
          g.sky.setHours(21.2);
          place(g, arriveRamnagar(), F().stewardAt);
        },
        start(s) {
          steward(s);
          const L = F().landing;
          s.state.boatman = s.actor({ avatarId: 'Male_Adult_06', x: L.x + 2, y: 0.7, z: L.z, yaw: 0, clip: 'idle', name: 'Boatman' });
        },
        update(s) {
          if (s.state.boatman) s.mark('giver', s.state.boatman);
          const a = arrivePanchganga();
          if (Math.hypot(game.player.position.x - a.x, game.player.position.z - a.z) < 18 && game.player.state !== 'boat') {
            if (game.sky.hours < 23 && game.sky.hours > 5) game.setTimeOfDay(23.3, 3);
            s.next();
          }
        },
        interact(s) {
          const bm = s.state.boatman;
          if (!bm || !s.near(bm, 3)) return null;
          return { prompt: 'Ask to be rowed back to Panchganga', action: () => cross(arrivePanchganga(), 23.3) };
        },
      },
      {
        id: 'andhaka',
        title: 'Andhaka',
        text: 'Andhaka rises from the river! Destroy the Blind Darkness.',
        resumeFrom: 4,
        prep(g) {
          g.sky.setHours(23.4);
          g.combat.setHasSword(true);
          g.missions.perks.sword = true;
          place(g, spot('panchganga', 62, 1, 0.6), ghatToWorld(PG, 62, 40));
        },
        start(s) {
          game.combat.setHasSword(true);
          game.checkpoint = spot('panchganga', 70, 1, -1);
          // the rising, framed from the steps, then the fight
          const c = ghatToWorld(PG, 62, PROFILE_LEN + 8);
          s.scene({
            keys: fromRiver('panchganga', 62, 10, 30, 5).map((k) => ({ ...k, look: new THREE.Vector3(c.x, 4, c.z) })),
            lines: lines('ch5/rise-01', 'ch5/rise-02'),
            then: () => {},
          });
          game.encounters.start({
            ghat: 'panchganga',
            u: 62,
            title: 'Panchganga Ghat',
            waves: [{ kind: 'boss', name: 'Andhaka', title: 'the Blind Darkness' }],
            onPhase: (i) => {
              const k = i === 1 ? 'ch5/phase-1' : 'ch5/phase-2';
              game.voice(k);
              game.ui.subtitle(`Andhaka: “${lines(k)[0][1]}”`, 4);
            },
            onWin: () => {
              game.voice('ch5/fall');
              game.ui.subtitle(`Andhaka: “${lines('ch5/fall')[0][1]}”`, 4);
              game.after(3, () => s.next());
            },
          });
        },
        stop() {
          if (game.encounters.cur?.def.ghat === 'panchganga') game.encounters.clear();
        },
      },
      {
        id: 'flame',
        title: 'Light the Thousand Lamps',
        text: 'Light the Flame of the Thousand Lamps on the Hazara Deepstambh.',
        lightFlame: true,
        prep(g) {
          g.sky.setHours(23.8);
          const f = g.quest.flames.find((x) => x.id === 'panchganga');
          place(g, { x: f.pos.x + 2.4, y: f.pos.y, z: f.pos.z }, f.pos);
        },
        start(s) {
          baba(s);
        },
        update(s) {
          const f = game.quest.flames.find((x) => x.id === 'panchganga');
          if (f && !f.lit) s.mark('objective', f.pos);
        },
        on(s, ev, d) {
          if (ev !== 'flame' || d.id !== 'panchganga') return;
          // the finale (Quest.finish) has begun when the fifth flame took
          game.after(4, () =>
            s.scene({
              keys: fromRiver('dashashwamedh', PG.width * 0.5, 22, 120, 26),
              lines: [...lines('ch5/lit-01'), ['', '…', null, 4], ...lines('ch5/end-01')],
              then: () => s.next(),
            })
          );
        },
        stop() {
          game.checkpoint = null;
        },
      },
    ],
    reward: {
      note: 'The Legend of Varanasi is told. Kashi is yours.',
      apply(g) {
        g.player.blessing = true;
      },
    },
  };
}
