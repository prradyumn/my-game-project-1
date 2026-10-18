import * as THREE from 'three';
import { RNG } from '../utils/math.js';

// Pre-fractured pieces of a hollow thing (a clay pot), cut once at load: seeds scattered over its
// surface split the shell into Voronoi patches (each triangle goes to its nearest seed), and each
// patch is given the shell's thickness: the outer skin, the inside face set back along the
// normals, and walls of raw broken clay along every edge it shares with another piece. The pieces
// fit back together into the whole pot, so a pot that breaks flies apart into its own shards.
//
// fractureShell(geometry, { pieces, thickness, seed, inner, edge }) -> [{ geometry, center, hull }]
//   geometry: centred on the piece's own centre (center: where that is in the pot)
//   hull: its corners (Float32Array) for a Rapier convex-hull collider

export function fractureShell(source, { pieces = 9, thickness = 0.014, seed = 7, inner = '#6e3218', edge = '#c4825a' } = {}) {
  const g = source.index ? source.toNonIndexed() : source.clone();
  if (!g.attributes.normal) g.computeVertexNormals();
  const P = g.attributes.position;
  const N = g.attributes.normal;
  const Ccol = g.attributes.color;
  const nTri = P.count / 3;
  const rng = new RNG(seed);
  // seeds: random triangles' centres, spread out (no two closer than the pot allows)
  const cen = [];
  for (let t = 0; t < nTri; t++) {
    const c = new THREE.Vector3();
    for (let k = 0; k < 3; k++) c.add(new THREE.Vector3().fromBufferAttribute(P, t * 3 + k));
    cen.push(c.divideScalar(3));
  }
  const seeds = [];
  for (let tries = 0; seeds.length < pieces && tries < pieces * 60; tries++) {
    const c = cen[Math.floor(rng.next() * nTri)];
    if (seeds.every((s) => s.distanceTo(c) > 0.12)) seeds.push(c);
  }
  const owner = cen.map((c) => {
    let best = 0;
    let bd = Infinity;
    seeds.forEach((s, i) => {
      // (a little noise on the distance: the cracks wander instead of running straight)
      const d = s.distanceTo(c) * (0.85 + 0.3 * frac(Math.sin(c.x * 91.7 + c.y * 37.3 + c.z * 53.1 + i * 7.1) * 4375.5));
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  });
  // the edges each triangle shares (by position), to find where the pieces meet
  const key = (i) => `${P.getX(i).toFixed(4)},${P.getY(i).toFixed(4)},${P.getZ(i).toFixed(4)}`;
  const edgeTris = new Map();
  for (let t = 0; t < nTri; t++) {
    for (let e = 0; e < 3; e++) {
      const a = key(t * 3 + e);
      const b = key(t * 3 + ((e + 1) % 3));
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      (edgeTris.get(k) || edgeTris.set(k, []).get(k)).push(t);
    }
  }
  const cIn = new THREE.Color(inner);
  const cEdge = new THREE.Color(edge);
  const out = [];
  for (let s = 0; s < seeds.length; s++) {
    const pos = [];
    const col = [];
    const v = (i, off) => [P.getX(i) - N.getX(i) * off, P.getY(i) - N.getY(i) * off, P.getZ(i) - N.getZ(i) * off];
    const colOf = (i) => (Ccol ? [Ccol.getX(i), Ccol.getY(i), Ccol.getZ(i)] : [0.66, 0.35, 0.2]);
    for (let t = 0; t < nTri; t++) {
      if (owner[t] !== s) continue;
      const i0 = t * 3;
      // the outer skin, as it was
      for (let k = 0; k < 3; k++) pos.push(...v(i0 + k, 0)), col.push(...colOf(i0 + k));
      // the inside, set back, facing in (wound the other way)
      for (const k of [0, 2, 1]) pos.push(...v(i0 + k, thickness)), col.push(cIn.r, cIn.g, cIn.b);
      // broken walls where it met another piece (or the pot's own open edge)
      for (let e = 0; e < 3; e++) {
        const ia = i0 + e;
        const ib = i0 + ((e + 1) % 3);
        const a = key(ia);
        const b = key(ib);
        const tris = edgeTris.get(a < b ? `${a}|${b}` : `${b}|${a}`) || [];
        if (tris.some((u) => u !== t && owner[u] === s)) continue;
        const A = v(ia, 0);
        const B = v(ib, 0);
        const Ai = v(ia, thickness);
        const Bi = v(ib, thickness);
        pos.push(...B, ...A, ...Ai, ...B, ...Ai, ...Bi);
        for (let k = 0; k < 6; k++) col.push(cEdge.r, cEdge.g, cEdge.b);
      }
    }
    if (!pos.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeBoundingBox();
    const center = geo.boundingBox.getCenter(new THREE.Vector3());
    geo.translate(-center.x, -center.y, -center.z);
    geo.computeVertexNormals();
    out.push({ geometry: geo, center, hull: Float32Array.from(geo.attributes.position.array) });
  }
  return out;
}

function frac(x) {
  return x - Math.floor(x);
}
