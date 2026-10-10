// Runs inside the game (tools/bake-navmesh.mjs loads it into the dev server's page): the static
// colliders of the world become triangles, Recast turns those into a tiled navmesh, and the
// result comes back as bytes plus the signature of the world it fits.
import { exportNavMesh, floodFillPruneNavMesh, init, NavMeshQuery } from 'recast-navigation';
import { generateTiledNavMesh } from 'recast-navigation/generators';
import { NAV_BOUNDS, NAV_CONFIG, NAV_DRY, navColliders, navSignature } from '../src/world/NavMesh.js';
import { GHAT_SEGMENTS, ghatToWorld, LANDING_1 } from '../src/world/WorldLayout.js';
import { GHAT_TOP } from '../src/config.js';

export async function bake(g, over = {}) {
  await init();
  const R = g.physics.RAPIER;
  const pos = [];
  const idx = [];
  const q = { x: 0, y: 0, z: 0, w: 1 };
  const v = [0, 0, 0];
  // a local point into the world (the collider's rotation, then its position)
  const world = (t, r, x, y, z) => {
    const tx = 2 * (r.y * z - r.z * y);
    const ty = 2 * (r.z * x - r.x * z);
    const tz = 2 * (r.x * y - r.y * x);
    v[0] = x + r.w * tx + r.y * tz - r.z * ty + t.x;
    v[1] = y + r.w * ty + r.z * tx - r.x * tz + t.y;
    v[2] = z + r.w * tz + r.x * ty - r.y * tx + t.z;
    return v;
  };
  const vert = (p) => {
    pos.push(p[0], p[1], p[2]);
    return pos.length / 3 - 1;
  };
  // (counter-clockwise seen from outside: Recast reads a top face as walkable from its winding)
  const BOX = [
    [0, 1, 2], [0, 2, 3], // bottom (-y)
    [4, 6, 5], [4, 7, 6], // top (+y)
    [0, 4, 5], [0, 5, 1], // -z
    [3, 2, 6], [3, 6, 7], // +z
    [1, 5, 6], [1, 6, 2], // +x
    [0, 3, 7], [0, 7, 4], // -x
  ];
  let boxes = 0;
  let cyls = 0;
  let meshTris = 0;
  let dropped = 0;
  for (const c of navColliders(g.physics)) {
    const t = c.translation();
    const r = c.rotation() || q;
    const type = c.shapeType();
    if (type === R.ShapeType.Cuboid) {
      const h = c.halfExtents();
      const base = pos.length / 3;
      for (const [sx, sy, sz] of [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1], [-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]]) vert(world(t, r, sx * h.x, sy * h.y, sz * h.z));
      for (const [a, b, d] of BOX) idx.push(base + a, base + b, base + d);
      boxes++;
    } else if (type === R.ShapeType.Cylinder) {
      const hh = c.halfHeight();
      const rad = c.radius();
      const n = 14;
      const top = vert(world(t, r, 0, hh, 0));
      const bot = vert(world(t, r, 0, -hh, 0));
      const ring = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        ring.push([vert(world(t, r, Math.sin(a) * rad, hh, Math.cos(a) * rad)), vert(world(t, r, Math.sin(a) * rad, -hh, Math.cos(a) * rad))]);
      }
      for (let i = 0; i < n; i++) {
        const [u0, l0] = ring[i];
        const [u1, l1] = ring[(i + 1) % n];
        idx.push(top, u0, u1, bot, l1, l0, u0, l0, l1, u0, l1, u1);
      }
      cyls++;
    } else if (type === R.ShapeType.TriMesh) {
      const V = c.vertices();
      const I = c.indices();
      const base = pos.length / 3;
      for (let i = 0; i < V.length; i += 3) vert(world(t, r, V[i], V[i + 1], V[i + 2]));
      for (let i = 0; i < I.length; i += 3) {
        const a = base + I[i];
        const b = base + I[i + 1];
        const d = base + I[i + 2];
        // the river bed: nothing paths under the water
        if (Math.max(pos[a * 3 + 1], pos[b * 3 + 1], pos[d * 3 + 1]) < NAV_DRY) {
          dropped++;
          continue;
        }
        idx.push(a, b, d);
        meshTris++;
      }
    }
  }
  const t0 = performance.now();
  const res = generateTiledNavMesh(new Float32Array(pos), new Uint32Array(idx), { ...NAV_CONFIG, bounds: NAV_BOUNDS, ...over });
  const ms = performance.now() - t0;
  if (!res.success) throw new Error(`navmesh: ${res.error}`);
  // only what joins the ghats: the islands go (the plinth tops inside every haveli, takht tops,
  // the ground outside the city wall), so nothing ever snaps onto one
  const query = new NavMeshQuery(res.navMesh);
  const seeds = [];
  for (const gh of GHAT_SEGMENTS) {
    for (const u of [0.25, 0.5, 0.75]) {
      for (const [v, y] of [[2.1, GHAT_TOP], [(LANDING_1.v0 + LANDING_1.v1) / 2, LANDING_1.h0]]) {
        const p = ghatToWorld(gh, gh.width * u, v);
        const r = query.findNearestPoly({ x: p.x, y, z: p.z }, { halfExtents: { x: 1.5, y: 1, z: 1.5 } });
        if (r.success && r.nearestRef) seeds.push(r.nearestRef);
      }
    }
  }
  floodFillPruneNavMesh(res.navMesh, seeds);
  query.destroy();
  const bytes = exportNavMesh(res.navMesh);
  let b64 = '';
  for (let i = 0; i < bytes.length; i += 0x8000) b64 += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return {
    b64: btoa(b64),
    meta: { signature: navSignature(g.physics), config: NAV_CONFIG, bounds: NAV_BOUNDS, dry: NAV_DRY, baked: new Date().toISOString() },
    stats: { seeds: seeds.length, boxes, cylinders: cyls, meshTris, droppedUnderwater: dropped, tris: idx.length / 3, ms: Math.round(ms), bytes: bytes.length },
  };
}
