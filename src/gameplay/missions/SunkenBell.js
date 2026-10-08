import * as THREE from 'three';
import { makeWaterAware } from '../../world/materials.js';
import { groundHeight } from '../../world/WorldLayout.js';
import { ghatById, waterEdge } from './places.js';

// The Sunken Bell. In last year's flood the brass bell of the leaning Ratneshwar temple was
// torn from its chain and lies somewhere on the riverbed beyond it. Dive for it (watch your
// breath), lift it with E, and bring it back to the priest, who rings it again.

function bellGeometry() {
  const prof = [
    [0.0, 0.36], [0.05, 0.36], [0.06, 0.32], [0.1, 0.3], [0.13, 0.22], [0.15, 0.1], [0.19, 0.0], [0.205, -0.02], [0.18, -0.02],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(prof, 18);
  const loop = new THREE.TorusGeometry(0.045, 0.014, 6, 12).translate(0, 0.4, 0);
  const clapper = new THREE.SphereGeometry(0.035, 8, 6).translate(0, 0.03, 0);
  const parts = [g, loop, clapper].map((x) => x.toNonIndexed());
  const pos = [];
  for (const p of parts) pos.push(...p.attributes.position.array);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

const _h = new THREE.Vector3();

export default function sunkenBell(game) {
  const scindia = ghatById('scindia');
  const temple = () => game.quest.flames.find((f) => f.id === 'ratneshwar')?.pos;
  return {
    id: 'bell',
    title: 'The Sunken Bell',
    giver: {
      name: 'Pujari Shastri-ji',
      avatarId: 'Male_Adult_15',
      tint: 'saffron',
      clip: 'idle',
      hours: [5, 20],
      at: () => {
        const t = temple();
        // the bottom step nearest the leaning temple
        const u = t ? (t.x - scindia.S.x) * scindia.T.x + (t.z - scindia.S.z) * scindia.T.z : scindia.width * 0.5;
        return waterEdge(scindia, Math.max(4, Math.min(scindia.width - 4, u - 7)));
      },
    },
    offer: [
      ['Pujari Shastri-ji', 'For a hundred years the bell of Ratneshwar called the river to prayer. The flood tore it from its chain.'],
      ['Pujari Shastri-ji', 'It lies out there on the bed of the Ganga, beyond the temple. My lungs are old. Yours are not.'],
    ],
    start(m) {
      const t = temple() || new THREE.Vector3(scindia.S.x, 0, scindia.S.z);
      // out past the temple and a little downstream, in deep water
      let x = t.x + scindia.N.x * 11 + scindia.T.x * 6;
      let z = t.z + scindia.N.z * 11 + scindia.T.z * 6;
      for (let k = 0; k < 8 && 0 - groundHeight(x, z) < 3; k++) {
        x += scindia.N.x * 3;
        z += scindia.N.z * 3;
      }
      const y = groundHeight(x, z) + 0.12;
      const mat = makeWaterAware(new THREE.MeshStandardMaterial({ color: 0xd9a548, metalness: 1, roughness: 0.3, emissive: 0x3a2508 }), { wetness: false, puddles: false });
      const mesh = new THREE.Mesh(bellGeometry(), mat);
      mesh.position.set(x, y, z);
      mesh.rotation.set(0.2, 0.7, 1.1); // tipped over in the silt, mouth toward the light
      mesh.scale.setScalar(1.35);
      mesh.castShadow = true;
      game.scene.add(mesh);
      m.state = { phase: 'find', mesh, spot: { x, y, z } };
    },
    update(m) {
      const s = m.state;
      if (s.phase === 'find') {
        const p = game.player.position;
        const d = Math.hypot(p.x - s.spot.x, p.z - s.spot.z);
        m.objective(d > 14 ? 'Swim out past the leaning temple and dive (C) for the bell.' : 'Somewhere on the riverbed below… look for the glint.', null);
        if (d > 14) m.mark('objective', s.spot);
        else m.mark('item', { x: s.spot.x, y: s.spot.y + 0.45, z: s.spot.z }, false);
      } else if (s.phase === 'carry') {
        // in his right hand
        game.animator.boneWorld?.('RightHand', _h);
        s.mesh.position.copy(_h).add(new THREE.Vector3(0, -0.12, 0));
        s.mesh.rotation.set(0, game.player.yaw, 0);
        m.objective('Bring the bell back to Shastri-ji on the steps of Scindia Ghat.');
        if (m.giver) m.mark('objective', m.giver);
      }
    },
    interact(m) {
      const s = m.state;
      const p = game.player;
      if (s.phase === 'find') {
        const d = Math.hypot(p.position.x - s.spot.x, p.feetY + 0.9 - s.spot.y, p.position.z - s.spot.z);
        if (d < 3.0) {
          return {
            prompt: 'Lift the bell',
            action: () => {
              s.phase = 'carry';
              game.audio.play('bell', { volume: 0.25, rate: 0.6 }); // a dull underwater clonk
              game.ui.toast('The bell of Ratneshwar', 'Heavy, cold, and green with river moss. Back to the surface!', 3);
            },
          };
        }
      } else if (s.phase === 'carry' && m.giver && m.near(m.giver, 2.8) && p.state === 'ground') {
        return {
          prompt: 'Give Shastri-ji the bell',
          action: () => {
            s.phase = 'given';
            s.mesh.visible = false;
            game.crowd.gesture(m.giver, 'pranam', 2.4, p.position);
            for (let i = 0; i < 3; i++) game.audio.play('bell', { volume: 0.9, delay: 0.8 + i * 1.6, at: m.giver });
            m.done();
          },
        };
      }
      return null;
    },
    stop(m) {
      if (m.state.mesh) {
        m.state.mesh.removeFromParent();
        m.state.mesh.geometry.dispose();
      }
    },
    outro: [
      ['Pujari Shastri-ji', 'Listen… do you hear how the river answers it? Ganga Maiya remembers this voice.'],
      ['Pujari Shastri-ji', 'Every evening when it rings, I will say your name with the prayers.'],
    ],
    reward: { punya: 30, note: 'The bell of Ratneshwar rings again' },
  };
}
