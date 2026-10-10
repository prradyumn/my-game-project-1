import RAPIER from '@dimforge/rapier3d-compat';

// Thin wrapper around Rapier: static world colliders + ray casts + the player's controller.
// Everything static is a fixed collider on one fixed body (cheap, never simulated).

// Collision groups (Rapier packs memberships << 16 | filter).
//  - people block Prady, but the camera's sphere cast looks straight through them;
//  - every flight of ghat stairs exists twice: the exact treads (feet IK, ground rays) and one
//    smooth ramp over the step nosings that the movement capsule walks on. A capsule on boxy
//    steps perches on tread edges (stuck treading in place going up, jolting going down).
const PEOPLE = 0x0002;
const TREAD = 0x0004;
const RAMP = 0x0008;
const CAMONLY = 0x0010; // things only the camera bumps into (umbrella canopies: walk under, never look through)
const PROP = 0x0020; // loose things that tumble (pots, lotas, baskets)
const RAGDOLL = 0x0040; // the limbs of a fallen Asura
const LEDGE = 0x0080; // thin climbable ledges (chhajja sunshades): stood on and hung from, but the camera looks past them
const DECOR = 0x0100; // facade clutter (wooden balconies): stops his body, never climbed, the camera looks past it
const g = (member, filter) => ((member << 16) | filter) >>> 0;
export const GROUPS = {
  people: g(PEOPLE, 0xffff),
  tread: g(TREAD, 0xffff),
  ramp: g(RAMP, 0xffff),
  mover: g(0xffff, 0xffff & ~TREAD & ~CAMONLY & ~RAGDOLL), // the character controller: ramps, not treads (and he walks through a falling body)
  feet: g(0xffff, 0xffff & ~RAMP & ~CAMONLY & ~PROP & ~RAGDOLL), // rays that look for the real ground
  ignorePeople: g(0xffff, 0xffff & ~PEOPLE & ~RAMP & ~PROP & ~RAGDOLL & ~LEDGE & ~DECOR), // the camera
  climb: g(0xffff, 0xffff & ~PEOPLE & ~RAMP & ~TREAD & ~CAMONLY & ~PROP & ~RAGDOLL & ~DECOR), // ledges Prady can climb onto
  cameraOnly: g(CAMONLY, 0xffff),
  ledge: g(LEDGE, 0xffff),
  decor: g(DECOR, 0xffff),
  // loose props and ragdolls: on the real treads (they tumble down steps), never the smooth ramps
  prop: g(PROP, 0xffff & ~RAMP & ~CAMONLY),
  ragdoll: g(RAGDOLL, 0xffff & ~RAMP & ~CAMONLY & ~PEOPLE & ~RAGDOLL),
  // the Asuras: walk on the ramps like Prady, but pass each other and the townsfolk (they
  // steer apart instead: a controller stepping onto another capsule stacks them up)
  enemyMover: g(0xffff, 0xffff & ~TREAD & ~PEOPLE & ~CAMONLY & ~RAGDOLL),
  enemyFeet: g(0xffff, 0xffff & ~RAMP & ~PEOPLE & ~CAMONLY & ~PROP & ~RAGDOLL),
  // thrown things (the trishul, a Pishacha's fire): stone, wood and walls, never the people
  // (those are tested against their own shapes) or the camera's umbrella discs
  missile: g(0xffff, 0xffff & ~PEOPLE & ~RAMP & ~CAMONLY & ~PROP & ~RAGDOLL),
};

export class Physics {
  static async create() {
    await RAPIER.init();
    return new Physics();
  }

  constructor() {
    this.RAPIER = RAPIER;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 60;
    this.fixedBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.colliderCount = 0;
  }

  _rot(yaw) {
    return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
  }

  // Box centred at (cx,cy,cz) with full sizes (w,h,d), rotated by yaw about +Y.
  addBox(cx, cy, cz, w, h, d, yaw = 0, groups) {
    const desc = this.RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(cx, cy, cz).setRotation(this._rot(yaw));
    if (groups !== undefined) desc.setCollisionGroups(groups);
    this.colliderCount++;
    return this.world.createCollider(desc, this.fixedBody);
  }

  // Box with an arbitrary quaternion {x,y,z,w}
  addBoxQ(cx, cy, cz, w, h, d, q) {
    const desc = this.RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(cx, cy, cz).setRotation(q);
    this.colliderCount++;
    return this.world.createCollider(desc, this.fixedBody);
  }

  addCylinder(cx, cy, cz, radius, height) {
    const desc = this.RAPIER.ColliderDesc.cylinder(height / 2, radius).setTranslation(cx, cy + height / 2, cz);
    this.colliderCount++;
    return this.world.createCollider(desc, this.fixedBody);
  }

  /** A flat disc only the camera collides with (an umbrella's canopy). */
  addCameraDisc(cx, cy, cz, radius, height) {
    const desc = this.RAPIER.ColliderDesc.cylinder(height / 2, radius).setTranslation(cx, cy, cz).setCollisionGroups(GROUPS.cameraOnly);
    this.colliderCount++;
    return this.world.createCollider(desc, this.fixedBody);
  }

  /**
   * A box the game moves itself (an animal on the ghats): a kinematic body, full sizes (w,h,d)
   * centred at (cx,cy,cz). Move it every frame with setMover(); Prady walks into it like a wall.
   */
  addMover(cx, cy, cz, w, h, d, groups = GROUPS.people) {
    const R = this.RAPIER;
    const body = this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(cx, cy, cz));
    const collider = this.world.createCollider(R.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setCollisionGroups(groups), body);
    this.colliderCount++;
    return { body, collider };
  }

  setMover(m, x, y, z, yaw) {
    m.body.setNextKinematicTranslation({ x, y, z });
    m.body.setNextKinematicRotation(this._rot(yaw));
  }

  addTrimesh(vertices, indices) {
    const desc = this.RAPIER.ColliderDesc.trimesh(vertices, indices);
    this.colliderCount++;
    return this.world.createCollider(desc, this.fixedBody);
  }

  // Returns distance along dir to the first hit, or null.
  castRay(origin, dir, maxDist, excludeCollider, groups) {
    const ray = new this.RAPIER.Ray(origin, dir);
    const hit = this.world.castRay(ray, maxDist, true, undefined, groups, excludeCollider);
    return hit ? hit.timeOfImpact : null;
  }

  // Ray that also reports the surface normal: { toi, nx, ny, nz } or null.
  castRayNormal(origin, dir, maxDist, excludeCollider, groups) {
    const ray = new this.RAPIER.Ray(origin, dir);
    const hit = this.world.castRayAndGetNormal(ray, maxDist, true, undefined, groups, excludeCollider);
    return hit ? { toi: hit.timeOfImpact, nx: hit.normal.x, ny: hit.normal.y, nz: hit.normal.z } : null;
  }

  // Sweep a sphere; returns the distance travelled before touching something, or null.
  sphereCast(origin, dir, radius, maxDist, excludeCollider, groups) {
    const R = this.RAPIER;
    this._ball = this._ball && this._ballR === radius ? this._ball : new R.Ball(radius);
    this._ballR = radius;
    const hit = this.world.castShape(origin, { x: 0, y: 0, z: 0, w: 1 }, dir, this._ball, 0, maxDist, true, undefined, groups, excludeCollider);
    return hit ? hit.time_of_impact : null;
  }

  // Sweep a sphere against one kind of collider only (a GROUPS entry: its membership, e.g. the
  // balconies); every default collider is a member of every group, so a filter cannot do this.
  sphereCastOnly(origin, dir, radius, maxDist, groups, excludeCollider) {
    const R = this.RAPIER;
    this._ball = this._ball && this._ballR === radius ? this._ball : new R.Ball(radius);
    this._ballR = radius;
    const member = groups >>> 16;
    const hit = this.world.castShape(origin, { x: 0, y: 0, z: 0, w: 1 }, dir, this._ball, 0, maxDist, true, undefined, undefined, excludeCollider, undefined, (c) => c.collisionGroups() >>> 16 === member);
    return hit ? hit.time_of_impact : null;
  }

  step(dt) {
    this.world.timestep = Math.min(dt, 1 / 30);
    this.world.step();
  }
}
