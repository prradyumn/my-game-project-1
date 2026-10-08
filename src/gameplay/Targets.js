// Everything Prady can strike, in one registry: the akhara's training dummies, the Asuras, the
// boss. Combat asks it for the nearest target to aim at, for what a fist / foot / blade point is
// touching, and the lock-on picks from it.
//
// A target is a plain object:
//   { kind, pos: {x,y,z} (feet), radius, height, alive: bool, enemy: bool,
//     touch?(point, reach) -> bool    (exact shape; default: a vertical capsule)
//     hit(info) -> void               info: { k, dir:{x,z}, at, sword, heavy, kick, move }
//     lockPoint?(out) -> Vector3      (where the lock-on marker sits; default: chest height) }

export class Targets {
  constructor() {
    this.list = [];
  }

  add(t) {
    if (!this.list.includes(t)) this.list.push(t);
    return t;
  }

  remove(t) {
    const i = this.list.indexOf(t);
    if (i >= 0) this.list.splice(i, 1);
  }

  /** The target whose body a strike point touches (point: world, reach: the limb's / blade's radius). */
  touching(p, reach) {
    for (const t of this.list) {
      if (!t.alive) continue;
      if (t.touch) {
        if (t.touch(p, reach)) return t;
        continue;
      }
      const h = p.y - t.pos.y;
      if (h < 0.1 || h > t.height) continue;
      if (Math.hypot(p.x - t.pos.x, p.z - t.pos.z) < t.radius + reach) return t;
    }
    return null;
  }

  /**
   * The nearest living target within `range` metres of `from` and within `cone` radians of
   * `yaw` (0 = +Z), at a similar height. filter(t) narrows the choice.
   */
  nearest(from, range, yaw, cone = Math.PI, filter = null, feetY = from.y) {
    let best = null;
    let bd = range;
    for (const t of this.list) {
      if (!t.alive || (filter && !filter(t))) continue;
      const dx = t.pos.x - from.x;
      const dz = t.pos.z - from.z;
      const d = Math.hypot(dx, dz) - (t.radius ?? 0.3) * 0.5;
      // (a giant on the steps below is still within reach of a blade: his knees are)
      if (d > bd || Math.abs(t.pos.y - feetY) > (t.enemy ? Math.max(2.6, (t.height ?? 2) * 0.7) : 1.2)) continue;
      const da = Math.abs(((Math.atan2(dx, dz) - yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (da > cone) continue;
      best = t;
      bd = d;
    }
    return best;
  }

  enemies() {
    return this.list.filter((t) => t.enemy && t.alive);
  }
}
