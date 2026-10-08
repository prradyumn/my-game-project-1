import * as THREE from 'three';
import { GROUPS } from '../../core/Physics.js';
import { ghatById, ghatSpot } from './places.js';

// Kashi Through the Lens. Meera is making a book of the ghats and has run out of light and
// time: take five of the photographs on her list. Photo mode (P), frame it, Enter to save;
// a subject counts when it is in the frame, near enough, and nothing stands in front of it.
// Time of day can be wound with [ ] in photo mode (sunrise!).

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();

export default function lens(game) {
  const dash = ghatById('dashashwamedh');

  // is world point p well inside this shot, within maxD, and not hidden behind stone?
  const inShot = (p, maxD, margin = 0.78) => {
    const cam = game.camera;
    const d = cam.position.distanceTo(_v.set(p.x, p.y, p.z));
    if (d > maxD) return false;
    _v.project(cam);
    if (_v.z > 1 || Math.abs(_v.x) > margin || Math.abs(_v.y) > margin) return false;
    _d.set(p.x, p.y, p.z).sub(cam.position).normalize();
    const hit = game.physics.castRay(cam.position, _d, d, game.player.collider, GROUPS.ignorePeople);
    return hit === null || hit > d - 2.5;
  };

  const SUBJECTS = [
    { id: 'ratneshwar', name: 'The leaning temple of Ratneshwar', note: 'It has leaned into the river for a hundred and fifty years and still stands.', test: () => {
      const f = game.quest.flames.find((x) => x.id === 'ratneshwar');
      return f && inShot({ x: f.pos.x, y: f.pos.y + 3, z: f.pos.z }, 90);
    } },
    { id: 'boat', name: 'A wooden boat on the Ganga', note: 'Those colours! The boatmen repaint them every Diwali.', test: () => game.world.layout.boats.moored.some((b) => inShot({ x: b.x, y: 0.4, z: b.z }, 30, 0.6)) },
    { id: 'sadhu', name: 'A sadhu sitting in stillness', note: 'He did not even blink. I could never sit that still.', test: () => (game.crowd?.live || []).some((s) => s.sadhu && inShot({ x: s.x, y: s.y + 0.6, z: s.z }, 16, 0.6)) },
    { id: 'kite', name: 'A kite above the rooftops', note: 'Patang season! Somebody up there is winning a kite fight.', test: () => game.world.street.kites.some((k) => inShot(k, 70, 0.85)) },
    { id: 'sunrise', name: 'Sunrise over the river', note: 'Pure gold. This one goes on the cover.', test: () => {
      const e = game.sky.sunDir.y;
      game.camera.getWorldDirection(_d);
      return e > -0.03 && e < 0.24 && _d.dot(game.sky.sunDir) > 0.82;
    } },
    { id: 'aarti', name: 'The evening Ganga aarti', note: 'The lamps, the bells, the conch... I have goosebumps.', test: () => (game.quest.aartiLit || game.quest.eveningAarti) && game.sky.nightFactor > 0.3 && (game.crowd?.priests || []).some((s) => s.inst && inShot({ x: s.x, y: s.y + 1.4, z: s.z }, 45)) },
  ];
  const NEED = 5;

  return {
    id: 'lens',
    title: 'Kashi Through the Lens',
    giver: { name: 'Meera, a photographer', avatarId: 'Female_Adult_08', clip: 'idle', hours: [6, 19.5], at: () => ghatSpot(dash, dash.width * 0.42, 1, -1.5) },
    offer: [
      ['Meera, a photographer', "Namaste! I'm making a book about the ghats, and my flight leaves tomorrow with half the pictures missing."],
      ['Meera, a photographer', 'You know this city. Will you take five for me? Press P for photo mode, frame the shot, and Enter to keep it.'],
    ],
    start(m) {
      m.state = { got: new Set() };
      game.ui.toast('Photo mode', 'P to frame · [ ] change the hour · Enter to take the photo', 5);
    },
    update(m) {
      const n = m.state.got.size;
      if (n >= NEED) {
        m.objective('Bring the photos to Meera at Dashashwamedh.', 1);
        if (m.giver) m.mark('objective', m.giver);
        return;
      }
      const left = SUBJECTS.filter((s) => !m.state.got.has(s.id)).map((s) => s.name);
      m.objective(`Photograph ${NEED - n} more: ${left.slice(0, 3).join(' · ')}${left.length > 3 ? ' · …' : ''}`, n / NEED);
    },
    on(m, event) {
      if (event !== 'photo' || m.state.got.size >= NEED) return;
      for (const s of SUBJECTS) {
        if (m.state.got.has(s.id) || !s.test()) continue;
        m.state.got.add(s.id);
        game.ui.toast(`${s.name} ✓`, `Meera: “${s.note}”`, 4);
        game.audio.play('bell', { volume: 0.2, rate: 1.3 });
        return;
      }
    },
    interact(m) {
      if (m.state.got.size < NEED || !m.giver || !m.near(m.giver, 2.8)) return null;
      return { prompt: 'Show Meera the photos', action: () => m.done() };
    },
    outro: [
      ['Meera, a photographer', 'Oh... oh, these are better than mine. Can I put your name in the book? “Photographs by Prady of Kashi.”'],
    ],
    reward: { punya: 25, note: 'Your photos will be in Meera’s book' },
  };
}
