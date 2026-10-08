import * as THREE from 'three';
import { ghatById, waterEdge } from './places.js';

// The Boatman's Ferry. Ramu's back is bad today: take his place for the morning and row three
// pilgrims along the river. Each waits on the bottom step of a ghat; bring the boat in slowly,
// they step aboard and sit facing you, and step off at their ghat with a pranam.

const TRIPS = [
  { from: ['darbhanga', 0.5], to: ['dashashwamedh', 0.28], who: 'Shanti-ji', avatarId: 'Female_Adult_06', thanks: 'Jeete raho, beta. My knees thank you more than I can.' },
  { from: ['dashashwamedh', 0.3], to: ['scindia', 0.62], who: 'Mr. Iyer', avatarId: 'Male_Adult_15', thanks: 'Forty years I taught geography. Today I finally saw the river properly.' },
  { from: ['scindia', 0.5], to: ['panchganga', 0.45], who: 'a young sadhu', avatarId: 'Male_Adult_09', thanks: 'Har Har Mahadev! May your oar never tire.' },
];

const SEAT = new THREE.Vector3(0, 0.0, 1.55);
const _p = new THREE.Vector3();

export default function ferry(game) {
  const dash = ghatById('dashashwamedh');
  return {
    id: 'ferry',
    title: "The Boatman's Ferry",
    giver: { name: 'Ramu the boatman', avatarId: 'Male_Adult_14', clip: 'wait', hours: [5.5, 19.5], at: () => waterEdge(dash, dash.width * 0.8) },
    offer: [
      ['Ramu the boatman', 'Arre, Prady! My back has locked up like a temple door, and three pilgrims are waiting on the ghats.'],
      ['Ramu the boatman', 'Take your boat and ferry them for me? Come in slow to the steps: they are old, and the Ganga is not.'],
    ],
    start(m) {
      m.state = { trip: 0, phase: 'pickup', t: 0, pax: null, leaving: [] };
      this.spawn(m);
    },
    spawn(m) {
      const T = TRIPS[m.state.trip];
      const g = ghatById(T.from[0]);
      const e = waterEdge(g, g.width * T.from[1]);
      m.state.pickup = e;
      m.state.drop = (() => {
        const d = ghatById(T.to[0]);
        return waterEdge(d, d.width * T.to[1]);
      })();
      m.state.pax = m.actor({ avatarId: T.avatarId, x: e.x, y: e.y, z: e.z, yaw: e.yaw, clip: 'wait', noCollider: true, name: T.who });
      m.state.phase = 'pickup';
    },
    update(m, dt) {
      const s = m.state;
      const boat = game.boat;
      const inBoat = game.player.state === 'boat';
      // passengers who got off: give a pranam, then go on their way
      for (const l of s.leaving) {
        l.t += dt;
        if (l.t > 9 && !l.gone) {
          l.gone = true;
          m.dropActor(l.a);
        }
      }
      if (s.phase === 'return') {
        m.objective('Tell Ramu at Dashashwamedh that his pilgrims are home.');
        if (m.giver) m.mark('objective', m.giver);
        return;
      }
      const T = TRIPS[s.trip];
      const nearBoat = (p, r) => Math.hypot(boat.x - p.x, boat.z - p.z) < r && Math.abs(boat.speed) < 1.5;
      if (s.phase === 'pickup') {
        m.objective(inBoat ? `Row to ${ghatById(T.from[0]).name} and pick up ${T.who}. Come in slow.` : `Take your boat (E beside it), then pick up ${T.who} at ${ghatById(T.from[0]).name}.`, s.trip / TRIPS.length);
        m.mark('objective', s.pickup);
        if (inBoat && nearBoat(s.pickup, 7.5)) {
          s.phase = 'board';
          s.t = 0;
          s.from = { x: s.pax.x, y: s.pax.y, z: s.pax.z };
          game.crowd.gesture(s.pax, 'pranam', 1.4);
        }
      } else if (s.phase === 'board' || s.phase === 'alight') {
        s.t += dt;
        const k = Math.min(1, Math.max(0, (s.t - (s.phase === 'board' ? 1.3 : 0.2)) / 1.4));
        const e = k * k * (3 - 2 * k);
        boat.object.updateMatrixWorld();
        _p.copy(SEAT).applyMatrix4(boat.object.matrixWorld);
        const to = s.phase === 'board' ? _p : s.drop;
        const from = s.phase === 'board' ? s.from : _p;
        s.pax.x = from.x + (to.x - from.x) * e;
        s.pax.z = from.z + (to.z - from.z) * e;
        s.pax.y = from.y + (to.y - from.y) * e + Math.sin(Math.PI * e) * 0.35;
        s.pax.clip = k > 0.85 && s.phase === 'board' ? 'floorSit' : 'idle';
        s.pax.yaw = s.pax.faceGoal = s.phase === 'board' ? boat.yaw + Math.PI : s.drop.yaw + Math.PI;
        if (k >= 1) {
          if (s.phase === 'board') s.phase = 'carry';
          else {
            game.crowd.gesture(s.pax, 'pranam', 2.2, game.player.position);
            game.ui.subtitle(`${T.who}: “${T.thanks}”`, 5);
            s.leaving.push({ a: s.pax, t: 0 });
            s.trip++;
            if (s.trip >= TRIPS.length) s.phase = 'return';
            else this.spawn(m);
          }
        }
      } else if (s.phase === 'carry') {
        boat.object.updateMatrixWorld();
        _p.copy(SEAT).applyMatrix4(boat.object.matrixWorld);
        s.pax.x = _p.x;
        s.pax.y = _p.y;
        s.pax.z = _p.z;
        s.pax.yaw = s.pax.yawNow = boat.yaw + Math.PI;
        s.pax.clip = 'floorSit';
        const dest = ghatById(T.to[0]).name;
        const left = Math.hypot(boat.x - s.drop.x, boat.z - s.drop.z);
        m.objective(`Row ${T.who} to ${dest}. ${Math.round(left)} m`, (s.trip + 0.5) / TRIPS.length);
        m.mark('objective', s.drop);
        if (nearBoat(s.drop, 7.5)) {
          s.phase = 'alight';
          s.t = 0;
        }
      }
    },
    interact(m) {
      if (m.state.phase !== 'return' || !m.giver || !m.near(m.giver, 2.8)) return null;
      return { prompt: 'Tell Ramu', action: () => m.done() };
    },
    stop(m) {
      for (const l of m.state.leaving || []) if (!l.gone) m.dropActor(l.a);
    },
    outro: [
      ['Ramu the boatman', 'All three! And not one of them fell in. You row like my father did.'],
      ['Ramu the boatman', 'Take my spare oar, it is balanced for a strong stroke. Your boat will fly.'],
    ],
    reward: { punya: 30, perk: 'oar', note: "Ramu's oar: your boat rows faster" },
  };
}
