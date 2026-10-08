import { GHAT_TOP } from '../../config.js';
import { GROUPS } from '../../core/Physics.js';
import { ghatById, ghatToWorld, groundHeight, LANDING_1, LANDING_2, PROFILE_LEN } from '../../world/WorldLayout.js';

// Where mission people stand and things lie, in bank-frame terms.

/** The lowest dry step of ghat g at u (where people stand by the water). */
export function waterEdge(g, u, out = {}) {
  let v = PROFILE_LEN - 0.2;
  let p = ghatToWorld(g, u, v);
  while (v > LANDING_2.v1 && groundHeight(p.x, p.z) < 0.25) {
    v -= 0.25;
    p = ghatToWorld(g, u, v);
  }
  const water = ghatToWorld(g, u, v + 3.5);
  return Object.assign(out, { x: p.x, y: groundHeight(p.x, p.z), z: p.z, yaw: Math.atan2(g.N.x, g.N.z), water: { x: water.x, z: water.z }, v });
}

/** A spot on a landing (L1 = 1, L2 = 2) or the top terrace (0) of ghat g. */
export function ghatSpot(g, u, which, vOff = 0) {
  const L = which === 1 ? LANDING_1 : which === 2 ? LANDING_2 : { v0: 0.6, v1: 3.6, h0: GHAT_TOP };
  const p = ghatToWorld(g, u, (L.v0 + L.v1) / 2 + vOff);
  return { x: p.x, y: L.h0, z: p.z, yaw: Math.atan2(g.N.x, g.N.z) };
}

export { ghatById };

/** World point at ghat g, (u, v), y from the ground. */
export function at(g, u, v, lift = 0) {
  const p = ghatToWorld(g, u, v);
  return { x: p.x, y: groundHeight(p.x, p.z) + lift, z: p.z };
}


/**
 * Like ghatSpot, but nudged along the ghat until nothing stands there (takhts, stalls,
 * umbrella poles, platforms): a ray down from above must land on the bare stone.
 */
export function clearSpot(physics, g, u, which, vOff = 0) {
  for (let k = 0; k < 14; k++) {
    const du = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 1.3;
    const s = ghatSpot(g, Math.max(1.5, Math.min(g.width - 1.5, u + du)), which, vOff);
    let free = true;
    for (const [ox, oz] of [[0, 0], [0.45, 0], [-0.45, 0], [0, 0.45], [0, -0.45]]) {
      const hit = physics.castRay({ x: s.x + ox, y: s.y + 3, z: s.z + oz }, { x: 0, y: -1, z: 0 }, 3.4, undefined, GROUPS.feet);
      if (hit !== null && 3 - hit > 0.15) free = false;
    }
    if (free) return s;
  }
  return ghatSpot(g, u, which, vOff);
}

/** Sitting on the river edge of landing 1 of ghat g at u, feet on the step below. */
export function ledge(g, u) {
  const p = ghatToWorld(g, u, LANDING_1.v1 - 0.12);
  return { x: p.x, y: LANDING_1.h0, z: p.z, yaw: Math.atan2(g.N.x, g.N.z), seatY: LANDING_1.h0, feetY: LANDING_1.h0 - 0.3 };
}
