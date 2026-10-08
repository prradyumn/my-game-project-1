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
const g = (member, filter) => ((member << 16) | filter) >>> 0;
export const GROUPS = {
  people: g(PEOPLE, 0xffff),
  tread: g(TREAD, 0xffff),
  ramp: g(RAMP, 0xffff),
  mover: g(0xffff, 0xffff & ~TREAD & ~CAMONLY), // the character controller: ramps, not treads
  feet: g(0xffff, 0xffff & ~RAMP & ~CAMONLY), // rays that look for the real ground
  ignorePeople: g(0xffff, 0xffff & ~PEOPLE & ~RAMP), // the camera
  climb: g(0xffff, 0xffff & ~PEOPLE & ~RAMP & ~TREAD & ~CAMONLY), // ledges Prady can climb onto
  cameraOnly: g(CAMONLY, 0xffff),
  // the Asuras: walk on the ramps like Prady, but pass each other and the townsfolk (they
  // steer apart instead: a controller stepping onto another capsule stacks them up)
  enemyMover: g(0xffff, 0xffff & ~TREAD & ~PEOPLE & ~CAMONLY),
  enemyFeet: g(0xffff, 0xffff & ~RAMP & ~PEOPLE & ~CAMONLY),
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
  addBox(cx, cy, cz, w, h, d, yaw = 0) {
    const desc = this.RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2).setTranslation(cx, cy, cz).setRotation(this._rot(yaw));
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

  step(dt) {
    this.world.timestep = Math.min(dt, 1 / 30);
    this.world.step();
  }
}
