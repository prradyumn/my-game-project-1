import * as THREE from 'three';
import { GHAT_SEGMENTS, PROFILE_LEN, ghatHeight, ghatToWorld } from './WorldLayout.js';
import { RNG } from '../utils/math.js';
import { makeWaterAware } from './materials.js';

// What the day leaves on the ghat steps: marigold and rose petals, a broken garland's flowers,
// a few dry peepal leaves and the odd scrap of leaf-plate. Thickest where people gather and
// offer (Dashashwamedh's aarti, Manikarnika, Assi, the landings), thinning toward the edges, and
// gathered along the back of each tread (things roll to the riser and stop). One InstancedMesh
// of small flat shapes, tinted per piece, laid on the real tread heights.

const COUNTS = { low: 5000, medium: 9000, high: 14000, veryhigh: 18000, ultra: 24000 };
const BUSY = { dashashwamedh: 1, manikarnika: 0.7, assi: 0.8, kedar: 0.55, scindia: 0.45, panchganga: 0.5 };

const KINDS = [
  // weight, colour(s), size (m), squash (0 round .. 1 long)
  [0.42, ['#ff8a1c', '#ffa424', '#ffb836', '#f07812'], 0.028, 0.15], // marigold petals
  [0.16, ['#c8102e', '#a00c24', '#e0344a'], 0.03, 0.25], // rose petals
  [0.12, ['#ff9e1b', '#ffc233'], 0.05, 0.0], // whole marigold heads
  [0.14, ['#8a6a2c', '#a07a38', '#6e5426'], 0.07, 0.6], // dry leaves
  [0.08, ['#4f7a2a', '#5f8a34'], 0.06, 0.55], // a fresh leaf
  [0.08, ['#b49a6a', '#9c855a'], 0.09, 0.1], // scraps of leaf-plate (dona)
];

export class GroundDetail {
  constructor(scene, quality = 'high') {
    const n = COUNTS[quality] ?? COUNTS.high;
    // a small flat blob, a little cupped (petals curl), lying on the stone
    const geo = new THREE.CircleGeometry(0.5, 7);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getZ(i));
      pos.setY(i, r * r * 0.25);
    }
    geo.computeVertexNormals();
    const mat = makeWaterAware(new THREE.MeshStandardMaterial({ roughness: 0.75, side: THREE.DoubleSide }), { puddles: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.name = 'ground-detail';
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    const rng = new RNG(4242);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3();
    const c = new THREE.Color();
    const pickKind = () => {
      let r = rng.next();
      for (const k of KINDS) if ((r -= k[0]) <= 0) return k;
      return KINDS[0];
    };
    let i = 0;
    let guard = 0;
    // in clusters: where a garland broke, where a family offered, where the aarti crowd stood;
    // a few strays between them
    while (i < n && guard++ < n * 4) {
      const g = GHAT_SEGMENTS[Math.floor(rng.next() * GHAT_SEGMENTS.length)];
      const busy = BUSY[g.id] ?? 0.3;
      if (rng.next() > busy) continue;
      const uc = g.width * (0.5 + (rng.next() + rng.next() + rng.next() - 1.5) * 0.4);
      const vc = rng.range(0.5, PROFILE_LEN - 1.2);
      const stray = rng.next() < 0.25;
      const k = stray ? 1 : 4 + Math.floor(rng.next() * 18);
      const spread = stray ? 0 : rng.range(0.15, 0.6);
      const K0 = pickKind();
      for (let j = 0; j < k && i < n; j++) {
        const u = uc + (rng.next() + rng.next() - 1) * spread * 1.6;
        let v = vc + (rng.next() + rng.next() - 1) * spread;
        // gathered toward the back of a tread: nudged toward where the step above rises
        const h0 = ghatHeight(v);
        for (let t = 0; t < 3; t++) {
          const vb = v - 0.1;
          if (ghatHeight(vb) > h0 + 0.05) break;
          v = vb;
        }
        const w = ghatToWorld(g, u, v);
        const y = ghatHeight(v);
        if (!(y > 0.15)) continue; // (the river's edge: nothing that would float)
        const K = rng.next() < 0.7 ? K0 : pickKind();
        const size = K[2] * rng.range(0.75, 1.4);
        e.set(rng.range(-0.15, 0.15), rng.range(0, Math.PI * 2), rng.range(-0.15, 0.15));
        q.setFromEuler(e);
        s.set(size * (1 + K[3]), size * rng.range(0.6, 1), size * (1 - K[3] * 0.6));
        m.compose(new THREE.Vector3(w.x, y + 0.004, w.z), q, s);
        this.mesh.setMatrixAt(i, m);
        c.set(K[1][Math.floor(rng.next() * K[1].length)]).multiplyScalar(rng.range(0.82, 1.08));
        this.mesh.setColorAt(i, c);
        i++;
      }
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    scene.add(this.mesh);
  }
}
