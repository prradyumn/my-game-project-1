import * as THREE from 'three';

// Lock-on (Tab / gamepad R3): the camera keeps the chosen enemy framed beside Prady, strikes aim
// at it first, and a small diamond marks it. A quick flick of the mouse (or the right stick)
// moves the lock to the next enemy on that side; it lets go when the enemy falls (passing to
// the nearest one still standing) or gets too far away.

const _p = new THREE.Vector3();
const RANGE = 18;
const KEEP = 24;

export class LockOn {
  constructor({ targets, camRig, player, combat, camera, ui }) {
    this.targets = targets;
    this.cam = camRig;
    this.player = player;
    this.combat = combat;
    this.camera = camera;
    this.ui = ui;
    this.target = null;
    this.flick = 0;
    this.flickCool = 0;
  }

  get active() {
    return !!this.target;
  }

  toggle() {
    if (this.target) return this.release();
    // the one in view first; else the nearest one anywhere around (the camera turns to it)
    if (!this.acquire() && !this.acquire(null, 0, true)) this.ui.toast('No enemy to lock on to', '', 1.2);
  }

  release() {
    this.target = null;
    this.combat.lockTarget = null;
    this.cam.lockAt = null;
    this.ui.setLock(null);
  }

  // the enemy nearest the middle of the view (angle matters more than distance)
  acquire(exclude = null, side = 0, anyAngle = false) {
    const p = this.player.position;
    const camYaw = this.cam.yaw;
    let best = null;
    let bs = Infinity;
    for (const t of this.targets.enemies()) {
      if (t === exclude) continue;
      const dx = t.pos.x - p.x;
      const dz = t.pos.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > (t.kind === 'boss' ? RANGE + 10 : RANGE) || Math.abs(t.pos.y - this.player.feetY) > (t.kind === 'boss' ? 8 : 4)) continue;
      let a = Math.atan2(dx, dz) - camYaw;
      a = Math.atan2(Math.sin(a), Math.cos(a)); // + = to the left of the view
      if (side && Math.sign(a) !== side) continue;
      if (!side && !anyAngle && Math.abs(a) > 1.3) continue;
      const score = Math.abs(a) * 8 + d * 0.25;
      if (score < bs) {
        bs = score;
        best = t;
      }
    }
    if (!best) return false;
    this.target = best;
    this.combat.lockTarget = best;
    return true;
  }

  /** Move the lock to the next enemy to the left (+1) or right (-1) of the current one. */
  switchSide(side) {
    if (!this.target) return;
    const cur = this.target;
    const p = this.player.position;
    const base = Math.atan2(cur.pos.x - p.x, cur.pos.z - p.z);
    let best = null;
    let ba = Infinity;
    for (const t of this.targets.enemies()) {
      if (t === cur) continue;
      const d = Math.hypot(t.pos.x - p.x, t.pos.z - p.z);
      if (d > RANGE) continue;
      let a = Math.atan2(t.pos.x - p.x, t.pos.z - p.z) - base;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      if (Math.sign(a) !== side) continue;
      if (Math.abs(a) < ba) {
        ba = Math.abs(a);
        best = t;
      }
    }
    if (best) {
      this.target = best;
      this.combat.lockTarget = best;
    }
  }

  update(dt, input) {
    const t = this.target;
    if (!t) return;
    const p = this.player.position;
    if (!t.alive || Math.hypot(t.pos.x - p.x, t.pos.z - p.z) > KEEP) {
      const prev = t;
      this.target = null;
      if (!this.acquire(prev)) return this.release();
    }
    // flick to switch
    const look = input.look();
    this.flickCool = Math.max(0, this.flickCool - dt);
    this.flick = this.flick * Math.exp(-dt * 8) + look.dx;
    if (this.flickCool <= 0 && Math.abs(this.flick) > 110) {
      this.switchSide(this.flick > 0 ? -1 : 1);
      this.flick = 0;
      this.flickCool = 0.35;
    }
    // camera assist + marker
    const lp = this.lp || (this.lp = new THREE.Vector3());
    if (this.target.lockPoint) this.target.lockPoint(lp);
    else lp.set(this.target.pos.x, this.target.pos.y + (this.target.height ?? 1.7) * 0.62, this.target.pos.z);
    this.cam.lockAt = lp;
    this.cam.lockH = this.target.height ?? 1.75;
    _p.copy(lp).project(this.camera);
    if (_p.z > 1) this.ui.setLock(null);
    else this.ui.setLock({ x: (_p.x * 0.5 + 0.5) * innerWidth, y: (-_p.y * 0.5 + 0.5) * innerHeight });
  }
}
