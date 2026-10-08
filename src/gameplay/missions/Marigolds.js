import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clearSpot, ghatById, ghatSpot } from './places.js';

// Marigolds for the Aarti. The flower boat from the village never came, and tonight's aarti
// has no marigolds. Phoolwati knows who has a basket to spare along the ghats: gather twelve
// and bring them to the aarti platforms at Dashashwamedh before the aarti begins (18:30).

const NEED = 12;
const DEADLINE = 18.5;

// where the spare baskets are: [ghat, u (0..1), level (0 terrace, 1, 2), v offset]
const SPOTS = [
  ['kedar', 0.2, 1, 1], ['kedar', 0.82, 2, 0], ['kedar', 0.5, 0, 1],
  ['chetsingh', 0.25, 1, -1], ['chetsingh', 0.7, 2, 1], ['chetsingh', 0.45, 0, 0],
  ['darbhanga', 0.15, 2, 0], ['darbhanga', 0.6, 1, 1.5], ['darbhanga', 0.85, 0, 1],
  ['dashashwamedh', 0.1, 1, 2], ['manmandir', 0.3, 1, -1], ['manmandir', 0.65, 2, 1],
  ['tulsi', 0.8, 1, 0], ['kedar', 0.62, 1, -1.5],
];

function basketGeometry() {
  const part = (g, c) => {
    const n = g.toNonIndexed();
    const col = new Float32Array(n.attributes.position.count * 3);
    const lin = new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace); // authored in sRGB
    for (let i = 0; i < col.length; i += 3) col.set([lin.r, lin.g, lin.b], i);
    n.setAttribute('color', new THREE.BufferAttribute(col, 3));
    n.deleteAttribute('uv');
    return n;
  };
  const P = [part(new THREE.CylinderGeometry(0.26, 0.2, 0.2, 14, 1, true).translate(0, 0.1, 0), [0.55, 0.38, 0.2]), part(new THREE.CircleGeometry(0.2, 14).rotateX(-Math.PI / 2).translate(0, 0.01, 0), [0.45, 0.3, 0.16])];
  for (let i = 0; i < 26; i++) {
    const a = i * 2.39996;
    const r = 0.2 * Math.sqrt((i + 0.5) / 26);
    P.push(part(new THREE.SphereGeometry(0.055, 6, 4).translate(Math.cos(a) * r, 0.21 + (0.2 - r) * 0.4, Math.sin(a) * r), i % 4 ? [1.0, 0.5, 0.04] : [1.0, 0.72, 0.1]));
  }
  return mergeGeometries(P);
}

export default function marigolds(game) {
  const kedar = ghatById('kedar');
  return {
    id: 'marigolds',
    title: 'Marigolds for the Aarti',
    giver: { name: 'Phoolwati, the flower seller', avatarId: 'Female_Adult_11', clip: 'wait', hours: [8, 17], at: () => ghatSpot(kedar, kedar.width * 0.4, 0, 0.6) },
    offer: [
      ['Phoolwati, the flower seller', 'Hai Ram, the flower boat never came! Tonight the aarti will have no marigolds. No marigolds!'],
      ['Phoolwati, the flower seller', 'People along the ghats keep a spare basket for me. Bring twelve to the aarti platforms at Dashashwamedh before the aarti, half past six.'],
    ],
    start(m) {
      const mesh = new THREE.InstancedMesh(basketGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), SPOTS.length);
      mesh.castShadow = true;
      const items = SPOTS.map(([id, u, lvl, dv]) => {
        const g = ghatById(id);
        return { ...clearSpot(game.physics, g, g.width * u, lvl, dv), got: false };
      });
      const m4 = new THREE.Matrix4();
      items.forEach((it, i) => mesh.setMatrixAt(i, m4.makeTranslation(it.x, it.y, it.z)));
      game.scene.add(mesh);
      const plat = game.world.layout.aartiPlatforms.find((p) => p.central) || game.world.layout.aartiPlatforms[0];
      m.state = { mesh, items, n: 0, plat: { x: plat.x, y: plat.y + 1, z: plat.z } };
      if (game.sky.hours > DEADLINE - 1.5) game.ui.toast('The aarti is close', 'Hurry: it begins at 18:30', 3);
    },
    update(m) {
      const s = m.state;
      const p = game.player.position;
      // walk over a basket to take it
      s.items.forEach((it, i) => {
        if (it.got || s.n >= NEED) return;
        if (Math.hypot(it.x - p.x, it.z - p.z) < 1.2 && Math.abs(it.y - game.player.feetY) < 1.3) {
          it.got = true;
          s.n++;
          s.mesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
          s.mesh.instanceMatrix.needsUpdate = true;
          game.audio.play('bell', { volume: 0.15, rate: 1.8 });
          game.ui.subtitle(`Marigolds ${s.n}/${NEED}`, 1.5);
        }
      });
      if (game.sky.hours > DEADLINE + 0.15 && game.sky.hours < 23) {
        m.fail('The aarti began without fresh marigolds. Phoolwati will need help another day.');
        return;
      }
      const clock = `${Math.floor(DEADLINE)}:${String(Math.round((DEADLINE % 1) * 60)).padStart(2, '0')}`;
      if (s.n < NEED) {
        m.objective(`Gather marigold baskets along the ghats: ${s.n}/${NEED} (aarti at ${clock})`, s.n / NEED);
        // glints over the nearest few, the compass to the nearest
        const left = s.items.filter((it) => !it.got).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
        left.slice(0, 4).forEach((it, k) => m.mark(k === 0 ? 'objective' : 'item', k === 0 ? it : { x: it.x, y: it.y + 0.6, z: it.z }, k === 0));
      } else {
        m.objective(`Bring the marigolds to the aarti platforms at Dashashwamedh (before ${clock}).`, 1);
        m.mark('objective', s.plat);
        if (Math.hypot(s.plat.x - p.x, s.plat.z - p.z) < 5) {
          // marigolds scattered on the water in front of the platforms
          const dash = ghatById('dashashwamedh');
          game.flowers.burst(s.plat.x + dash.N.x * 9, s.plat.z + dash.N.z * 9, 50, 9);
          m.done();
        }
      }
    },
    stop(m) {
      m.state.mesh?.removeFromParent();
      m.state.mesh?.geometry.dispose();
    },
    outro: [
      ['Pujari-ji', 'Marigolds! Twelve baskets, and still dew on them. Who sent you, beta? Phoolwati? Of course she did.'],
      ['Pujari-ji', 'Tonight Ganga Maiya will be crowned in gold. Stay for the aarti.'],
    ],
    reward: { punya: 25, note: "Tonight's aarti is crowned with your marigolds" },
  };
}
