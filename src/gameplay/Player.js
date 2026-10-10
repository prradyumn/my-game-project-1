import * as THREE from 'three';
import { PLAYER } from '../config.js';
import { clamp, damp, dampAngle, lerp, smoothDamp, smoothstep, wrapAngle } from '../utils/math.js';
import { bankCoords, groundHeight, PROFILE_LEN } from '../world/WorldLayout.js';
import { GROUPS } from '../core/Physics.js';

// Prady's controller. Physics runs at a fixed 60 Hz (fixedUpdate) and the visuals are
// interpolated between the last two physics states (lateUpdate), so movement is identical at
// 30, 60 or 120 fps.
//
// States:
//   ground   walking / running / sprinting; Rapier's character controller auto-steps the ghats
//   air      jumping or falling (buffered + coyote jumps, variable height, heavier fall)
//   swim     floating on the Ganga: spring-damper buoyancy, drag relative to the current
//   dive     under water: 3D swimming toward where the camera looks, breath meter
//   waterrun Ganga's Blessing: sprint across the river surface
//   boat     seated in the boat (the boat simulates itself)

const FEET = PLAYER.halfHeight + PLAYER.radius;
const M = PLAYER.move;
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _cur = { x: 0, z: 0 };
const NO_CURRENT = { x: 0, z: 0 };
const DOWN = { x: 0, y: -1, z: 0 };
const _ahead = new THREE.Vector3();

export class Player {
  constructor({ physics, water, model, animator, start, fx }) {
    this.physics = physics;
    this.water = water;
    this.model = model;
    this.animator = animator;
    this.fx = fx;
    const R = physics.RAPIER;
    this.body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(start.x, start.y + FEET + 0.05, start.z));
    this.collider = physics.world.createCollider(R.ColliderDesc.capsule(PLAYER.halfHeight, PLAYER.radius), this.body);
    const kcc = physics.world.createCharacterController(0.02);
    // stairs are ramps for the capsule (Ghats.js), so stepping is only for curbs: low enough that a
    // 0.5 m takht is a clean obstacle (jump onto it) rather than a half-climb that stalls
    kcc.enableAutostep(0.35, 0.15, false);
    // he shoves what's loose (a pot, a lota) out of his way instead of stopping dead at it
    kcc.setApplyImpulsesToDynamicBodies(true);
    kcc.setCharacterMass(72);
    kcc.enableSnapToGround(0.45);
    kcc.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
    kcc.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    kcc.setSlideEnabled(true);
    kcc.setApplyImpulsesToDynamicBodies(false);
    this.kcc = kcc;

    this.position = new THREE.Vector3(start.x, start.y + FEET + 0.05, start.z);
    this.prevPosition = this.position.clone();
    this.renderPosition = this.position.clone();
    this.velocity = new THREE.Vector3();
    this.yaw = start.yaw ?? 0;
    this.prevYaw = this.yaw;
    this.state = 'ground';
    this.grounded = true;
    this.airTime = 0;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.jumpCut = false;
    this.landTimer = 0;
    this.climbFactor = 1;
    this.breathMax = PLAYER.breathSeconds; // the Yaksha's boon lengthens it
    this.breath = this.breathMax;
    this.blessing = false;
    this.boat = null;
    this.walkMode = false;
    this.rippleTimer = 0;
    this.visualY = this.position.y - FEET;
    this.visualVel = {};
    this.wallTime = 0;
    this.actions = null; // PradyActions (set by Game): pranam, diya, holy dip, dive, climb, meditate
    this.visualDip = 0; // holy dip: the body goes under for a moment
    this.diving = false;
    this.pitch = 0;
    this.climbLean = 0;
    this.bank = 0;
    this.lean = 0;
    this.speed = 0;
    this.prevSpeed = 0;
    this.accel = 0;
    this.yawRate = 0;
    this.inputLocked = false;
    this.headUnderwater = false;
    this.cmd = { mag: 0, mv: { x: 0, y: 0 }, wish: new THREE.Vector3(), sprint: false, jumpHeld: false, up: false, down: false };
    this.camYaw = 0;
    this.camPitch = 0;
    this.swimMul = 1; // Ganga's Child siddhi
    this.traversal = null; // Traversal.js (vaults, ledges, ladders)
    this.powers = null; // Powers.js (casting the damaru, the trishul)
    if (animator.loco?.ok) animator.loco.onFootstep = (side) => this.onFootstep(side);
  }

  get feetY() {
    return this.position.y - FEET;
  }

  teleport(x, y, z) {
    this.position.set(x, y + FEET + 0.05, z);
    this.prevPosition.copy(this.position);
    this.renderPosition.copy(this.position);
    this.body.setTranslation(this.position, true);
    this.velocity.set(0, 0, 0);
    this.state = 'ground';
    this.visualY = y;
  }

  enterBoat(boat) {
    this.boat = boat;
    this.state = 'boat';
    this.velocity.set(0, 0, 0);
    boat.addLoad?.(1);
  }

  exitBoat(x, y, z) {
    this.boat?.addLoad?.(-1);
    this.boat = null;
    this.teleport(x, y, z);
  }

  // ---------------------------------------------------------------- once per rendered frame
  readInput(input, cam) {
    const c = this.cmd;
    this.camYaw = cam.yaw;
    this.camPitch = cam.pitch;
    if (this.inputLocked) {
      c.mag = 0;
      c.mv = { x: 0, y: 0 };
      c.wish.set(0, 0, 0);
      c.sprint = c.jumpHeld = c.up = c.down = false;
      return;
    }
    const mv = input.move();
    c.mv = mv;
    c.mag = Math.min(1, Math.hypot(mv.x, mv.y));
    c.wish.set(0, 0, 0).addScaledVector(cam.forward, mv.y).addScaledVector(cam.right, mv.x);
    if (c.wish.lengthSq() > 1e-4) c.wish.normalize();
    c.sprint = input.down('ShiftLeft') || input.down('ShiftRight') || input.gpButton(10);
    c.jumpHeld = input.down('Space') || input.gpButton(0);
    c.up = c.jumpHeld;
    c.down = input.down('KeyC') || input.down('ControlLeft') || input.gpButton(1);
    if (input.hit('Space') || input.hit('Pad0')) this.jumpBuffer = M.jumpBuffer;
    if (input.hit('KeyX')) this.walkMode = !this.walkMode;
  }

  // ---------------------------------------------------------------- fixed 60 Hz physics
  fixedUpdate(dt) {
    if (this.state === 'boat') return;
    this.prevPosition.copy(this.position);
    this.prevYaw = this.yaw;
    // whatever owns the body this step: a vault or a ladder, a power being cast, an action, a fight
    if (this.traversal?.fixed(dt)) return;
    if (this.state === 'climb') this.state = 'ground'; // (a move that ended without saying where)
    if (this.powers?.fixed(dt)) return;
    if (this.actions?.fixed(dt)) return;
    if (this.combat?.fixed(dt)) return;
    const c = this.cmd;
    const vel = this.velocity;

    const surface = this.water.heightAt(this.position.x, this.position.z);
    const depth = surface - this.feetY;
    const ground = groundHeight(this.position.x, this.position.z);
    const deepWater = surface - ground > 1.1;
    const { v: bankV } = bankCoords(this.position.x, this.position.z);
    const current = bankV > PROFILE_LEN - 3 ? this.water.currentAt(this.position.x, this.position.z, _cur) : NO_CURRENT;

    // ------------------------------------------------ state transitions
    if (this.state === 'ground' || this.state === 'air') {
      if (depth > PLAYER.swimDepth && deepWater) {
        const impact = -vel.y;
        this.state = 'swim';
        this.fx.splash(this.position.x, surface, this.position.z, impact > 4 ? 1 : 0.4);
        vel.y *= 0.25;
      }
    }
    if ((this.state === 'swim' || this.state === 'ground') && this.blessing && c.sprint && c.mag > 0.2 && deepWater && depth > -0.3) this.state = 'waterrun';
    if (this.state === 'waterrun' && (!c.sprint || c.mag < 0.2 || !deepWater || !this.blessing)) this.state = deepWater ? 'air' : 'ground';
    if ((this.state === 'swim' || this.state === 'dive') && (!deepWater || depth < PLAYER.swimDepth - 0.35)) this.state = 'ground';

    // ------------------------------------------------ forces per state
    if (this.state === 'ground' || this.state === 'air') {
      const wading = clamp((depth - 0.3) / 1.0, 0, 1);
      const base = this.walkMode ? PLAYER.walkSpeed : c.sprint ? PLAYER.sprintSpeed : PLAYER.runSpeed;
      const landSlow = this.landTimer > 0 ? 0.55 : 1;
      const targetSpeed = base * c.mag * (1 - wading * 0.45) * this.climbFactor * landSlow;
      const tx = c.wish.x * targetSpeed;
      const tz = c.wish.z * targetSpeed;
      // Acceleration-limited approach (m/s^2): snappy but physical, harder braking when reversing.
      let rate;
      if (this.state === 'air') rate = M.airAccel;
      else if (tx * vel.x + tz * vel.z < 0 && Math.hypot(vel.x, vel.z) > 1) rate = M.turnDecel;
      else rate = tx * tx + tz * tz > vel.x * vel.x + vel.z * vel.z ? M.accel : M.decel;
      approach2(vel, tx, tz, rate * dt);

      if (this.state === 'ground') {
        if (this.grounded) this.coyote = M.coyote;
        // Space facing a ledge climbs it
        if (this.jumpBuffer > 0 && this.grounded && this.traversal?.tryJump()) {
          this.jumpBuffer = 0;
          return;
        }
        // Space at the water's edge dives instead of jumping (when the arc lands in deep water)
        if (this.jumpBuffer > 0 && this.grounded && this.actions?.tryDive()) {
          this.jumpBuffer = 0;
          return;
        }
        if (this.jumpBuffer > 0 && (this.grounded || this.coyote > 0) && depth < 0.9) {
          vel.y = PLAYER.jumpSpeed;
          this.state = 'air';
          this.grounded = false;
          this.jumpBuffer = 0;
          this.coyote = 0;
          this.jumpCut = true;
        } else vel.y = this.grounded ? -2 : vel.y + PLAYER.gravity * dt;
      } else {
        vel.y += PLAYER.gravity * (vel.y < 0 ? M.fallGravityScale : 1) * dt;
        if (this.jumpCut && !c.jumpHeld && vel.y > 0) {
          vel.y *= M.jumpCutFactor; // a tap gives a short hop, holding gives the full jump
          this.jumpCut = false;
        }
      }
    } else if (this.state === 'swim') {
      const sp = (c.sprint ? PLAYER.swimSprintSpeed : PLAYER.swimSpeed) * c.mag * this.swimMul;
      // Drag pulls the swimmer's velocity toward (stroke + current): the river carries you.
      const k = 1 - Math.exp(-M.waterDrag * dt);
      vel.x += (c.wish.x * sp + current.x - vel.x) * k;
      vel.z += (c.wish.z * sp + current.z - vel.z) * k;
      // Spring-damper buoyancy around a float height; rise onto steps that come up under you.
      const ahead = groundHeight(this.position.x + c.wish.x * 0.7, this.position.z + c.wish.z * 0.7);
      const floatFeet = Math.max(surface - 1.35, Math.min(ahead + 0.05, surface - 0.2));
      const w0 = Math.sqrt(M.buoyancyK);
      vel.y += (M.buoyancyK * (floatFeet - this.feetY) - 2 * M.buoyancyZeta * w0 * vel.y) * dt;
      vel.y = clamp(vel.y, -3, 4);
      if (c.down) this.state = 'dive';
    } else if (this.state === 'dive') {
      const sp = (c.sprint ? PLAYER.swimSprintSpeed : PLAYER.swimSpeed) * c.mag * this.swimMul;
      const cp = Math.cos(this.camPitch);
      const lx = Math.sin(this.camYaw) * cp;
      const ly = -Math.sin(this.camPitch);
      const lz = Math.cos(this.camYaw) * cp;
      let dx = lx * c.mv.y - Math.cos(this.camYaw) * c.mv.x;
      let dy = ly * c.mv.y;
      let dz = lz * c.mv.y + Math.sin(this.camYaw) * c.mv.x;
      const len = Math.hypot(dx, dy, dz) || 1;
      dx /= len;
      dy /= len;
      dz /= len;
      const k = 1 - Math.exp(-M.diveDrag * dt);
      let ty = dy * sp + M.diveBuoyancy;
      if (c.up) ty = 2.2;
      if (c.down) ty = -2.0;
      if (this.breath <= 0) ty = 3.0;
      vel.x += (dx * sp + current.x * 0.6 - vel.x) * k;
      vel.z += (dz * sp + current.z * 0.6 - vel.z) * k;
      vel.y += (ty - vel.y) * k;
      if (this.feetY > surface - 1.3 && vel.y > 0 && !c.down) this.state = 'swim';
    } else if (this.state === 'waterrun') {
      approach2(vel, c.wish.x * PLAYER.waterRunSpeed * c.mag, c.wish.z * PLAYER.waterRunSpeed * c.mag, M.accel * 0.6 * dt);
      vel.y = clamp((surface - this.feetY) * 12, -4, 4);
      if (Math.random() < dt * 30) this.fx.spray(this.position.x, surface, this.position.z);
    }

    // ------------------------------------------------ integrate through the character controller
    const desired = _v.set(vel.x * dt, vel.y * dt, vel.z * dt);
    const hx = desired.x;
    const hz = desired.z;
    // On the ground, move ALONG the ground plane (ramp over the stairs, slope, flat paving) at
    // the full horizontal speed. Never press into the floor in the same controller call: a
    // downward push made Rapier's controller drop whole steps of movement at random (~1 in 5
    // on flat stone - the uneven, stuttering walk), and climbing crawled. Snap-to-ground keeps
    // the feet down.
    if (this.state === 'ground' && this.grounded && vel.y <= 0 && (hx !== 0 || hz !== 0)) {
      const hit = this.physics.castRayNormal(this.position, DOWN, FEET + 0.35, this.collider, GROUPS.mover);
      if (hit && hit.ny > 0.6) desired.y = -(hit.nx * hx + hit.nz * hz) / hit.ny;
      this.groundNy = hit ? hit.ny : 1;
    } else if (!this.grounded) this.groundNy = 1;
    this.kcc.computeColliderMovement(this.collider, desired, undefined, GROUPS.mover);
    let mvd = this.kcc.computedMovement();
    // Stepping from a landing onto the stair ramp: the ground under the centre is still flat
    // while the front of the capsule meets the slope, and sliding into it cost ~30% of the
    // speed for 7 frames. If a walkable slope ate the move, redo it along that slope's plane.
    if (this.state === 'ground' && this.grounded && vel.y <= 0) {
      const want = Math.hypot(hx, hz);
      if (want > 1e-4 && Math.hypot(mvd.x, mvd.z) < want * 0.9) {
        for (let i = 0, n = this.kcc.numComputedCollisions(); i < n; i++) {
          const nn = this.kcc.computedCollision(i)?.normal1;
          if (!nn || nn.y < 0.6 || nn.y > 0.97 || nn.x * hx + nn.z * hz >= 0) continue;
          _ahead.set(hx, -(nn.x * hx + nn.z * hz) / nn.y, hz);
          this.kcc.computeColliderMovement(this.collider, _ahead, undefined, GROUPS.mover);
          mvd = this.kcc.computedMovement();
          break;
        }
      }
    }
    this.position.x += mvd.x;
    this.position.y += mvd.y;
    this.position.z += mvd.z;
    this.body.setNextKinematicTranslation(this.position);
    const wasGrounded = this.grounded;
    this.grounded = this.kcc.computedGrounded();
    if (this.state === 'ground' && !this.traversal?.check(dt)) this.actions?.checkClimb(dt);
    // in the air beside a wall: a ledge in reach is caught (Traversal: hang, shimmy, pull up)
    if (this.state === 'air' && this.traversal?.airGrab()) return;
    if (this.state === 'climb') return;

    if (this.state === 'ground' || this.state === 'air') {
      // Walls eat the part of the velocity that pushes into them (no invisible build-up while
      // sliding along one), judged from the real contact normals: slopes, ramps and steps the
      // controller climbs never count as walls.
      let wall = false;
      for (let i = 0, n = this.kcc.numComputedCollisions(); i < n; i++) {
        const c = this.kcc.computedCollision(i);
        const nn = c?.normal1;
        if (!nn || Math.abs(nn.y) > 0.4) continue;
        let nx = nn.x;
        let nz = nn.z;
        const l = Math.hypot(nx, nz) || 1;
        nx /= l;
        nz /= l;
        if (nx * hx + nz * hz > 0) {
          nx = -nx; // face back toward the character
          nz = -nz;
        }
        const vn = vel.x * nx + vel.z * nz;
        if (vn < 0) {
          wall = true;
          this.wallNormal = { x: nx, z: nz };
        }
      }
      this.wallTime = wall ? this.wallTime + dt : 0;
      if (this.wallTime > 0.05 && this.wallNormal) {
        const { x: nx, z: nz } = this.wallNormal;
        const vn = vel.x * nx + vel.z * nz;
        if (vn < 0) {
          vel.x -= nx * vn;
          vel.z -= nz * vn;
        }
      }
      // Climbing the ghats is slower than running on the flat.
      const horiz = Math.hypot(mvd.x, mvd.z);
      const climb = horiz > 1e-4 && this.grounded ? Math.max(0, mvd.y) / horiz : 0;
      this.climbFactor = damp(this.climbFactor, 1 - M.climbSlowdown * clamp(climb * 1.2, 0, 1), 6, dt);
    }

    if (this.state === 'ground' && !this.grounded) {
      this.airTime += dt;
      if (this.airTime > 0.12) this.state = 'air';
    } else this.airTime = 0;
    if (this.state === 'air' && this.grounded && vel.y <= 0) {
      const impact = -vel.y;
      this.state = 'ground';
      if (!wasGrounded) {
        this.fx.land?.(impact);
        if (impact > 7) this.landTimer = 0.22;
        // a long drop (off a roof): a roll if he lands running, else it hurts (Game)
        if (impact > 13.5) this.onHardLanding?.(impact, Math.hypot(vel.x, vel.z));
      }
    }
    if (this.grounded && vel.y < 0 && this.state === 'ground') vel.y = -2;
    if (mvd.y < desired.y - 0.01 && vel.y > 0 && this.state === 'air') vel.y = 0; // bumped a ceiling
    this.coyote = Math.max(0, this.coyote - dt);
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    this.landTimer = Math.max(0, this.landTimer - dt);

    // ------------------------------------------------ breath
    const headY = this.feetY + 1.6;
    this.headUnderwater = headY < surface - 0.05;
    if (this.headUnderwater) this.breath = Math.max(0, this.breath - dt * (this.blessing ? 0.15 : 1));
    else this.breath = Math.min(this.breathMax, this.breath + dt * 8);

    // ------------------------------------------------ facing, turn rate, acceleration
    this.prevSpeed = this.speed;
    // speed relative to the water when swimming: strokes, not the current, drive the animation
    this.speed = this.state === 'swim' || this.state === 'dive' ? Math.hypot(vel.x - current.x, vel.z - current.z) : Math.hypot(vel.x, vel.z);
    this.accel = damp(this.accel, (this.speed - this.prevSpeed) / dt, 10, dt);
    const before = this.yaw;
    if (this.speed > 0.15 && c.mag > 0.05) this.yaw = dampAngle(this.yaw, Math.atan2(c.wish.x, c.wish.z), this.state === 'ground' ? 11 : 5, dt);
    this.yawRate = damp(this.yawRate, wrapAngle(this.yaw - before) / dt, 12, dt);
  }

  // ---------------------------------------------------------------- per rendered frame
  lateUpdate(dt, alpha) {
    if (this.state === 'boat') return this.updateBoat(dt);
    this.renderPosition.lerpVectors(this.prevPosition, this.position, alpha);
    const yaw = this.prevYaw + wrapAngle(this.yaw - this.prevYaw) * alpha;
    const surface = this.water.heightAt(this.renderPosition.x, this.renderPosition.z);
    this.updateVisual(dt, surface, yaw);

    const depth = surface - (this.renderPosition.y - FEET);
    this.rippleTimer -= dt;
    if (this.rippleTimer <= 0 && (this.state === 'swim' || (this.state === 'ground' && depth > 0.2 && this.speed > 0.3))) {
      this.rippleTimer = this.state === 'swim' ? 0.5 : 0.35;
      this.fx.ripple(this.renderPosition.x, surface, this.renderPosition.z, this.state === 'swim' ? 1.6 : 1.1);
    }
    this.fx.swimming(this.state === 'swim' && this.speed > 0.4);

    // Body language: lean into acceleration and speed, bank into turns.
    const run = this.state === 'ground' || this.state === 'waterrun';
    const leanT = run ? clamp(this.speed * 0.022 + this.accel * 0.012, -0.1, 0.26) : 0;
    this.lean = damp(this.lean, leanT, 6, dt);
    const bankT = run ? clamp(-this.yawRate * this.speed * 0.028, -0.2, 0.2) : 0;
    this.bank = damp(this.bank, bankT, 7, dt);

    const climbing = this.state === 'climb';
    const animState = this.state === 'waterrun' || climbing ? 'ground' : this.state;
    const animSpeed = this.state === 'waterrun' ? PLAYER.runSpeed * 1.25 : climbing ? 0 : this.speed;
    this.animator.update(dt, animState, animSpeed, {
      lean: climbing ? 0 : this.lean,
      lookYaw: climbing ? 0 : wrapAngle(this.camYaw - yaw),
      groundY: this.model.position.y,
      rayDown: this.state === 'ground' ? (x, y, z) => this.rayDown(x, y, z) : null,
    });
    // (before the hands are placed on a ledge, so they still reach it)
    this.clearWall(dt, yaw);
    this.actions?.late(dt);
    this.traversal?.late(dt);
  }

  /**
   * Nothing of him inside the wall in front. The capsule keeps the body off a wall, but a pose can
   * carry the head and chest past it: the pull up onto a chhajja a hand's width deep, a run's lean
   * into the plaster, the sword stance's arm. The model eases back by as much as it would go in
   * (the body in physics stays where it is). A hang is left alone: its hands are on the edge.
   */
  clearWall(dt, yaw) {
    const m = this.model;
    const act = this.traversal?.act?.type;
    let want = 0;
    if ((this.state === 'ground' || this.state === 'climb') && act !== 'hang' && act !== 'ladder') {
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      const P = this.renderPosition;
      let dw = Infinity;
      for (const h of [1.05, 1.6]) {
        const d = this.physics.castRay({ x: P.x, y: P.y - FEET + h, z: P.z }, { x: fx, y: 0, z: fz }, 1.0, this.collider, GROUPS.climb);
        if (d !== null) dw = Math.min(dw, d);
      }
      if (dw < Infinity) {
        if (!this.clearBones) {
          const find = (n) => {
            let b = null;
            m.traverse((o) => !b && o.isBone && o.name.endsWith(n) && (b = o));
            return b;
          };
          this.clearBones = { body: ['Head', 'Neck', 'Spine2'].map(find).filter(Boolean), hands: ['LeftHand', 'RightHand'].map(find).filter(Boolean) };
        }
        // (on a climb the hands belong on the edge: only the head and the chest count)
        const bones = this.state === 'climb' ? this.clearBones.body : [...this.clearBones.body, ...this.clearBones.hands];
        let ext = 0;
        for (const b of bones) {
          b.getWorldPosition(_v);
          ext = Math.max(ext, (_v.x - m.position.x) * fx + (_v.z - m.position.z) * fz);
        }
        want = Math.max(0, ext + 0.1 - dw);
      }
    }
    this.wallPush = damp(this.wallPush || 0, want, want > (this.wallPush || 0) ? 20 : 5, dt);
    if (this.wallPush > 1e-3) {
      m.position.x -= Math.sin(yaw) * this.wallPush;
      m.position.z -= Math.cos(yaw) * this.wallPush;
      m.updateMatrixWorld(true);
    }
  }

  rayDown(x, y, z) {
    const hit = this.physics.castRay({ x, y, z }, DOWN, 1.5, this.collider, GROUPS.feet);
    return hit === null ? null : y - hit;
  }

  onFootstep() {
    if (this.state !== 'ground' || !this.grounded || this.speed < 0.3) return;
    const p = this.renderPosition;
    const surface = this.water.heightAt(p.x, p.z);
    if (surface - (p.y - FEET) > 0.05) this.fx.wade(p.x, surface, p.z);
    else {
      this.fx.footstep(this.speed);
      this.fx.footprint?.(arguments[0]);
    }
  }

  updateVisual(dt, surface, yaw) {
    const m = this.model;
    const p = this.renderPosition;
    const feetY = p.y - FEET;
    let pitchTarget = 0;
    let feetTarget = feetY;
    if (this.diving) {
      // swan dive: the body follows its flight path, head-first into the river
      const vh = Math.hypot(this.velocity.x, this.velocity.z);
      pitchTarget = clamp(Math.PI / 2 + Math.atan2(-this.velocity.y, Math.max(vh, 0.5)) * 1.05, 0.35, 2.9);
    } else if (this.state === 'swim') pitchTarget = this.speed > 0.3 ? 1.25 : 0.25;
    else if (this.state === 'dive') pitchTarget = 1.45 - clamp(this.velocity.y / 2.5, -1, 1) * 0.6;
    else if (this.state === 'waterrun') {
      pitchTarget = 0.12;
      feetTarget = surface;
    } else if (this.state === 'climb') {
      // a vault, a ledge, a ladder: the move places the body exactly (a wall run leans it back)
      this.pitch = this.climbLean;
      this.bank = 0;
      _e.set(this.pitch, yaw, 0);
      m.quaternion.setFromEuler(_e);
      this.visualY = feetY;
      this.visualVel.y = 0;
      m.position.set(p.x, feetY, p.z);
      return;
    }
    this.pitch = damp(this.pitch, pitchTarget, this.diving ? 9 : 6, dt);
    _e.set(this.pitch, yaw, this.state === 'swim' || this.state === 'dive' ? 0 : this.bank);
    _q.setFromEuler(_e);
    m.quaternion.copy(_q);
    if (this.diving) {
      // pivot about the hips (the capsule centre) while flipping head-first
      const off = _v.set(0, FEET, 0).applyQuaternion(_q);
      this.visualY = p.y - off.y;
      m.position.set(p.x - off.x, this.visualY, p.z - off.z);
    } else if (this.state === 'swim' || this.state === 'dive') {
      // Swimming: a horizontal swimmer floats with back and head breaking the surface; a
      // treading swimmer floats upright, chest under, head out. Diving: the capsule centre.
      const flat = clamp(this.pitch / 1.25, 0, 1);
      const chest = this.state === 'swim' ? surface - 0.32 + flat * 0.36 : p.y + 0.3;
      const off = _v.set(0, 1.25, 0).applyQuaternion(_q);
      this.visualY = damp(this.visualY, chest - off.y, 10, dt);
      m.position.set(p.x - off.x, this.visualY, p.z - off.z);
    } else {
      // Rest the body on what is really under its centre (a capsule hovers at step edges).
      // (a frame of lost contact at the crest of a flight is still "on the ground" here)
      const onGround = this.state === 'ground';
      if (onGround) {
        const hit = this.physics.castRay(p, DOWN, FEET + 0.5, this.collider, GROUPS.feet);
        if (hit !== null) {
          let t = p.y - hit;
          // on a flight of stairs at speed the body glides along the slope (feet IK still lands
          // each foot on a real tread); walking, it rises and dips with every step
          if ((this.groundNy ?? 1) < 0.97) t = lerp(t, feetY - 0.15, smoothstep(1.4, 4, this.speed));
          feetTarget = Math.max(feetY - 0.32, Math.min(feetY + 0.05, t));
        }
      }
      // The capsule pops up / drops 0.3 m at every stair; the body glides (critically damped)
      // and the foot IK plants the feet on the real treads.
      if (onGround) {
        this.visualY = smoothDamp(this.visualY, feetTarget, this.visualVel, 'y', 0.075, dt);
        this.visualY = clamp(this.visualY, feetTarget - 0.3, feetTarget + 0.3);
      } else {
        this.visualY = feetTarget;
        this.visualVel.y = 0;
      }
      m.position.set(p.x, this.visualY + this.visualDip, p.z);
    }
  }

  updateBoat(dt) {
    const b = this.boat;
    const seat = b.seatWorld(new THREE.Vector3());
    this.position.set(seat.x, seat.y + FEET, seat.z);
    this.prevPosition.copy(this.position);
    this.renderPosition.copy(this.position);
    this.body.setTranslation(this.position, true);
    this.model.position.copy(seat);
    this.model.quaternion.copy(b.object.quaternion);
    this.speed = 0;
    this.headUnderwater = false;
    this.breath = this.breathMax;
    this.fx.swimming(false);
    this.animator.update(dt, 'boat', 0, { rowPhase: b.rowPhase ?? 0, lookYaw: 0, oarHands: b.oarHands, oarLean: b.oarLean });
  }
}

// Move (v.x, v.z) toward (tx, tz) by at most `maxStep` (m/s).
function approach2(v, tx, tz, maxStep) {
  const dx = tx - v.x;
  const dz = tz - v.z;
  const d = Math.hypot(dx, dz);
  if (d <= maxStep || d < 1e-6) {
    v.x = tx;
    v.z = tz;
  } else {
    v.x += (dx / d) * maxStep;
    v.z += (dz / d) * maxStep;
  }
}
