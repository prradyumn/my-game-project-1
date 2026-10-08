import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PROFILE_LEN } from '../../world/WorldLayout.js';
import { ghatById, waterEdge } from './places.js';

// Clean Mother Ganga. Arjun and the Ganga Seva volunteers pull rubbish from the river every
// morning, and today they are short-handed. Swim (or row) out and gather fifteen pieces of
// floating litter off Assi and Tulsi; touch one to take it. The river runs a little clearer.

const NEED = 15;

function litterGeometry() {
  // a plastic bottle: body, shoulder, neck, cap; lies on its side
  const body = new THREE.CylinderGeometry(0.045, 0.045, 0.2, 10).translate(0, 0, 0);
  const shoulder = new THREE.CylinderGeometry(0.018, 0.045, 0.06, 10).translate(0, 0.13, 0);
  const cap = new THREE.CylinderGeometry(0.02, 0.02, 0.03, 8).translate(0, 0.175, 0);
  const g = mergeGeometries([body, shoulder, cap].map((x) => x.toNonIndexed()));
  g.deleteAttribute('uv');
  return g.rotateZ(Math.PI / 2);
}

const COLORS = [new THREE.Color(0.75, 0.86, 0.92), new THREE.Color(0.35, 0.62, 0.42), new THREE.Color(0.9, 0.9, 0.86), new THREE.Color(0.55, 0.75, 0.9)];

export default function cleanGanga(game) {
  const assi = ghatById('assi');
  const tulsi = ghatById('tulsi');
  return {
    id: 'clean',
    title: 'Clean Mother Ganga',
    giver: { name: 'Arjun of Ganga Seva', avatarId: 'Male_Adult_06', clip: 'idle', hours: [6, 18], at: () => waterEdge(assi, assi.width * 0.45) },
    offer: [
      ['Arjun of Ganga Seva', 'Every morning we pull plastic out of the river: bottles, bags, the leftovers of a hundred picnics. Half my team has fever today.'],
      ['Arjun of Ganga Seva', 'Fifteen pieces are floating off Assi and Tulsi. Swim out, or take a boat, and bring them in. Ganga Maiya will thank you. I already do.'],
    ],
    start(m) {
      const rng = () => Math.random();
      const items = [];
      for (let i = 0; i < NEED + 3; i++) {
        const g = i % 2 ? assi : tulsi;
        const u = g.width * (0.1 + rng() * 0.8);
        const v = PROFILE_LEN + 4 + rng() * 22;
        const x = g.S.x + g.T.x * u + g.N.x * v;
        const z = g.S.z + g.T.z * u + g.N.z * v;
        items.push({ hx: x, hz: z, x, z, yaw: rng() * 6.28, got: false, bob: rng() * 6.28 });
      }
      const mesh = new THREE.InstancedMesh(litterGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.05, transparent: true, opacity: 0.85 }), items.length);
      items.forEach((_, i) => mesh.setColorAt(i, COLORS[i % COLORS.length]));
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      game.scene.add(mesh);
      m.state = { items, mesh, n: 0 };
    },
    update(m, dt) {
      const s = m.state;
      const p = game.player;
      const boat = game.boat;
      const cur = { x: 0, z: 0 };
      const mtx = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const e = new THREE.Euler();
      const t = game.water.time;
      let nearest = null;
      let nd = Infinity;
      s.items.forEach((it, i) => {
        if (it.got) return;
        // drift a little with the current, but stay near where it is (an eddy holds it)
        game.water.currentAt(it.x, it.z, cur);
        it.x += (cur.x * 0.2 + (it.hx - it.x) * 0.05) * dt;
        it.z += (cur.z * 0.2 + (it.hz - it.z) * 0.05) * dt;
        const y = game.water.heightAt(it.x, it.z) + 0.01;
        const swimmer = (p.state === 'swim' || p.state === 'dive') && Math.hypot(p.position.x - it.x, p.position.z - it.z) < 1.5;
        const byBoat = p.state === 'boat' && Math.hypot(boat.x - it.x, boat.z - it.z) < 3;
        if (s.n < NEED && (swimmer || byBoat)) {
          it.got = true;
          s.n++;
          game.audio.play('splash', { volume: 0.25, rate: 1.4 });
          game.ui.subtitle(`Litter ${s.n}/${NEED}`, 1.4);
          hideInstance(s.mesh, i, mtx);
          return;
        }
        e.set(Math.sin(t * 1.3 + it.bob) * 0.15, it.yaw, Math.cos(t * 1.1 + it.bob) * 0.1);
        mtx.compose(new THREE.Vector3(it.x, y, it.z), q.setFromEuler(e), new THREE.Vector3(1, 1, 1));
        s.mesh.setMatrixAt(i, mtx);
        const d = Math.hypot(p.position.x - it.x, p.position.z - it.z);
        if (d < nd) {
          nd = d;
          nearest = { x: it.x, y: y + 0.6, z: it.z };
        }
        if (d < 28) m.mark('item', { x: it.x, y: y + 0.55, z: it.z }, false);
      });
      s.mesh.instanceMatrix.needsUpdate = true;
      if (s.n >= NEED) {
        m.objective('Bring the litter back to Arjun at Assi Ghat.', 1);
        if (m.giver) m.mark('objective', m.giver);
      } else {
        m.objective(`Gather floating litter off Assi and Tulsi: ${s.n}/${NEED}`, s.n / NEED);
        if (nearest && nd > 28) m.mark('objective', nearest);
      }
    },
    interact(m) {
      if (m.state.n < NEED || !m.giver || !m.near(m.giver, 3) || game.player.state !== 'ground') return null;
      return { prompt: 'Hand the litter to Arjun', action: () => m.done() };
    },
    stop(m) {
      m.state.mesh?.removeFromParent();
      m.state.mesh?.geometry.dispose();
    },
    outro: [
      ['Arjun of Ganga Seva', 'Fifteen! You know, every bottle you pull out is one a turtle never swallows.'],
      ['Arjun of Ganga Seva', 'Look at the water by the steps, already clearer. Come any morning; there is always a place for you in Ganga Seva.'],
    ],
    reward: { punya: 30, perk: 'purity', note: 'Mother Ganga runs a little clearer' },
  };
}

function hideInstance(mesh, i, mtx) {
  mesh.setMatrixAt(i, mtx.makeScale(0, 0, 0));
}
