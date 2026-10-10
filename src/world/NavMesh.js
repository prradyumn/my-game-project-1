import { ASSET_MANIFEST } from '../core/Assets.js';
import { GROUPS } from '../core/Physics.js';

// Where things can walk: a Recast navmesh of the static world, baked offline by
// tools/bake-navmesh.mjs from the very colliders Prady walks on (the ghat ramps, the takhts,
// the temples, the havelis), so a dog at his heel, a cow going home and an Asura hunting him
// all go round what stands in the way instead of through it or into it.
//
// recast-navigation (WASM) loads in its own chunk after the world is up. Until it is ready, or
// when the world has changed since the bake (the collider signature differs: re-run
// `npm run bake:nav`), every walker falls back to steering straight at its goal.

// One agent size for everyone: 1.7 m tall, 0.5 m kept off walls, 0.4 m steps (the movement ramps
// over the ghat stairs are in the input, the exact treads are not). Heights in 5 cm cells: at 10 cm
// a 46 cm platform rounded down to a step an Asura's body can't take.
export const NAV_CONFIG = {
  cs: 0.25,
  ch: 0.05,
  tileSize: 64,
  walkableSlopeAngle: 50,
  walkableHeight: 34,
  walkableClimb: 8,
  walkableRadius: 2,
  maxEdgeLen: 48,
  maxSimplificationError: 1.3,
  minRegionArea: 16,
  mergeRegionArea: 40,
  maxVertsPerPoly: 6,
  // (heights come from the ground itself, so the detail meshes stay coarse; below 0.9 Recast's
  // WASM build crashes)
  detailSampleDist: 6,
  detailSampleMaxError: 1,
};
// the ghats and the city behind them, up to the street level (the roofs are left out)
export const NAV_BOUNDS = [
  [-465, -0.5, -175],
  [465, 16, 60],
];
// walkable surfaces under the river's surface are left out (nothing paths into the Ganga)
export const NAV_DRY = 0.25;

const HALF = { x: 2, y: 4, z: 2 };
const RAMP = GROUPS.ramp >>> 16;

/** The static colliders the navmesh is made of: the world's own and the stair ramps. */
export function* navColliders(physics) {
  const fixed = physics.fixedBody.handle;
  const out = [];
  physics.world.forEachCollider((c) => {
    if (c.parent()?.handle !== fixed) return;
    const m = c.collisionGroups() >>> 16;
    if (m === 0xffff || m === RAMP) out.push(c);
  });
  yield* out;
}

/** A fingerprint of those colliders: the navmesh only fits the world it was baked from. */
export function navSignature(physics) {
  let n = 0;
  let sum = 0;
  for (const c of navColliders(physics)) {
    const t = c.translation();
    n++;
    sum += Math.round(t.x * 10) * 3 + Math.round(t.y * 10) * 7 + Math.round(t.z * 10) * 11 + c.shapeType() * 13;
  }
  return `${n}:${sum}`;
}

export class Navigation {
  constructor() {
    this.ready = false;
    this.query = null;
    this._v = { x: 0, y: 0, z: 0 };
    this._w = { x: 0, y: 0, z: 0 };
  }

  async load(physics) {
    const src = ASSET_MANIFEST.nav;
    if (!src) return;
    try {
      const [rn, bin, meta] = await Promise.all([
        import('recast-navigation'),
        fetch(src.mesh).then((r) => (r.ok ? r.arrayBuffer() : null)),
        fetch(src.meta).then((r) => (r.ok ? r.json() : null)),
      ]);
      if (!bin || !meta) return;
      const sig = navSignature(physics);
      if (meta.signature !== sig) {
        console.warn(`[nav] the world changed since the navmesh was baked (${meta.signature} vs ${sig}): run npm run bake:nav. Walking without it.`);
        return;
      }
      await rn.init();
      const { navMesh } = rn.importNavMesh(new Uint8Array(bin));
      if (!navMesh) return;
      this.navMesh = navMesh;
      this.query = new rn.NavMeshQuery(navMesh);
      this.ready = true;
    } catch (e) {
      console.warn('[nav] not loaded', e);
    }
  }

  /**
   * The corners of the way from `from` to `to` (the first is where it stands). `partial`: `to`
   * can't be reached (on a roof, across the river) and the way ends as near to it as it gets.
   * null when either end is off the navmesh.
   */
  path(from, to) {
    if (!this.ready) return null;
    const r = this.query.computePath(from, to, { halfExtents: HALF, maxPathPolys: 512, maxStraightPathPoints: 64 });
    if (!r.success || !r.path.length) return null;
    const end = r.path[r.path.length - 1];
    return { path: r.path, partial: Math.hypot(end.x - to.x, end.z - to.z) > 0.8 };
  }

  /** The nearest walkable point to p within `r` metres (x, z), or null. */
  snap(p, r = 1.5) {
    if (!this.ready) return null;
    const res = this.query.findClosestPoint(p, { halfExtents: { x: r, y: 4, z: r } });
    if (!res.success || !res.polyRef) return null;
    const q = res.point;
    return Math.hypot(q.x - p.x, q.z - p.z) <= r ? { x: q.x, y: q.y, z: q.z } : null;
  }

  /**
   * A step from (x, y, z) toward (nx, nz) kept on the walkable ground: it slides along whatever
   * it meets. `s` holds the walker's polygon between calls. Returns { x, z } or null (off it).
   */
  constrain(s, x, y, z, nx, nz) {
    if (!this.ready) return null;
    const q = this.query;
    const from = this._v;
    from.x = x;
    from.y = y;
    from.z = z;
    if (!s.navRef || !this.navMesh.isValidPolyRef(s.navRef)) {
      const near = q.findNearestPoly(from, { halfExtents: HALF });
      if (!near.success || !near.nearestRef) return null;
      s.navRef = near.nearestRef;
      from.x = near.nearestPoint.x;
      from.z = near.nearestPoint.z;
    }
    const to = this._w;
    to.x = nx;
    to.y = y;
    to.z = nz;
    const r = q.moveAlongSurface(s.navRef, from, to, { maxVisitedSize: 16 });
    if (!r.success) {
      s.navRef = 0;
      return null;
    }
    if (r.visited.length) s.navRef = r.visited[r.visited.length - 1];
    return r.resultPosition;
  }
}

/**
 * One walker's way to its goal: re-planned every `repath` seconds or when the goal moves; gives
 * the direction to its next corner. steer() returns null when the navmesh can't say (not loaded,
 * the walker or its goal off it): the caller then steers straight, as it always did.
 */
export class PathFollower {
  constructor(nav, { repath = 0.6, reach = 0.55 } = {}) {
    this.nav = nav;
    this.repath = repath;
    this.reach = reach;
    this.corners = null;
    this.partial = false;
    this.i = 0;
    this.t = Infinity;
    this.goal = { x: Infinity, y: 0, z: Infinity };
  }

  reset() {
    this.corners = null;
    this.t = Infinity;
  }

  /** The final point of the way (the goal, or the nearest it gets to it), or null. */
  end() {
    const C = this.corners;
    return C && C.length ? C[C.length - 1] : null;
  }

  steer(pos, goal, dt, out) {
    const nav = this.nav;
    if (!nav?.ready) return null;
    this.t += dt;
    if (this.t > this.repath || Math.hypot(goal.x - this.goal.x, goal.z - this.goal.z) > 1.2) {
      this.t = 0;
      this.goal.x = goal.x;
      this.goal.y = goal.y;
      this.goal.z = goal.z;
      const r = nav.path(pos, goal);
      this.corners = r ? r.path : null;
      this.partial = !!r?.partial;
      this.i = 0;
    }
    const C = this.corners;
    if (!C || !C.length) return null;
    while (this.i < C.length - 1 && Math.hypot(C[this.i].x - pos.x, C[this.i].z - pos.z) < this.reach) this.i++;
    const c = C[this.i];
    // (at the end of a way that stops short of the goal, up a temple's steps say: straight on,
    // the body climbs what the navmesh won't)
    if (this.partial && this.i === C.length - 1 && Math.hypot(c.x - pos.x, c.z - pos.z) < 1.5) return null;
    const dx = c.x - pos.x;
    const dz = c.z - pos.z;
    const l = Math.hypot(dx, dz);
    if (l < 1e-3) return null;
    out.x = dx / l;
    out.z = dz / l;
    return out;
  }
}
