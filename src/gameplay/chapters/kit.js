import * as THREE from 'three';
import { GHAT_TOP } from '../../config.js';
import { ghatById, ghatToWorld, groundHeight, LANDING_1, LANDING_2 } from '../../world/WorldLayout.js';

// Small helpers the chapters share: where people stand, how a cutscene frames them.

export { ghatById };

/** A spot on ghat id at u (m along it): landing 1 / 2, or 0 = the top terrace; facing the river. */
export function spot(id, u, which = 1, vOff = 0) {
  const g = ghatById(id);
  const L = which === 1 ? LANDING_1 : which === 2 ? LANDING_2 : { v0: 0.6, v1: 3.6, h0: GHAT_TOP };
  const p = ghatToWorld(g, u, (L.v0 + L.v1) / 2 + vOff);
  return { x: p.x, y: L.h0, z: p.z, yaw: Math.atan2(g.N.x, g.N.z) };
}

/** A point at ghat id, (u, v) in its bank frame, on the ground. */
export function at(id, u, v) {
  const g = ghatById(id);
  const p = ghatToWorld(g, u, v);
  return { x: p.x, y: groundHeight(p.x, p.z), z: p.z };
}

/** Put Prady at p (facing yaw, or toward look {x,z}). */
export function place(g, p, look) {
  const yaw = look ? Math.atan2(look.x - p.x, look.z - p.z) : p.yaw;
  if (g.player.state === 'boat') g.player.exitBoat(p.x, p.y, p.z);
  g.player.teleport(p.x, p.y + 0.1, p.z);
  if (yaw !== undefined) {
    g.player.yaw = g.player.prevYaw = yaw;
    g.camRig.yaw = yaw;
  }
  g.camRig.first = true;
}

/** Turn an actor to face a point. */
export function faceTo(actor, p) {
  if (!actor) return;
  actor.yaw = actor.yawNow = Math.atan2(p.x - actor.x, p.z - actor.z);
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * A two-shot of a and b (people: {x, y, z}): the camera beside the line between them, a little
 * behind b's shoulder, easing slowly in over `dur` seconds. side: +1 / -1 which side.
 */
export function twoShot(a, b, dur = 12, side = 1) {
  const mx = (a.x + b.x) / 2;
  const mz = (a.z + b.z) / 2;
  const my = Math.max(a.y, b.y) + 1.45;
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  const l = Math.hypot(dx, dz) || 1;
  const px = (-dz / l) * side;
  const pz = (dx / l) * side;
  const d0 = Math.max(3.2, l * 1.6);
  return [
    { t: 0, pos: V(mx + px * d0 - (dx / l) * 1.2, my + 0.25, mz + pz * d0 - (dz / l) * 1.2), look: V(mx, my - 0.15, mz) },
    { t: dur, pos: V(mx + px * d0 * 0.78 - (dx / l) * 0.8, my + 0.1, mz + pz * d0 * 0.78 - (dz / l) * 0.8), look: V(mx, my - 0.1, mz) },
  ];
}

/** A slow orbit round c at radius r and height h, from angle a0 to a1 (radians), over dur. */
export function orbit(c, r, h, a0, a1, dur, lookH = 1.2) {
  const keys = [];
  const n = 4;
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const a = a0 + (a1 - a0) * k;
    keys.push({ t: dur * k, pos: V(c.x + Math.sin(a) * r, c.y + h, c.z + Math.cos(a) * r), look: V(c.x, c.y + lookH, c.z) });
  }
  return keys;
}

/** From the river looking back at the ghat point p (wide establishing shot), drifting in. */
export function fromRiver(id, u, dur = 10, dist = 38, h = 9) {
  const g = ghatById(id);
  const c = ghatToWorld(g, u, 8);
  const far = ghatToWorld(g, u - 6, 8 + dist);
  const near = ghatToWorld(g, u + 2, 8 + dist * 0.62);
  return [
    { t: 0, pos: V(far.x, h, far.z), look: V(c.x, GHAT_TOP - 2, c.z) },
    { t: dur, pos: V(near.x, h * 0.7, near.z), look: V(c.x, GHAT_TOP - 3, c.z) },
  ];
}
