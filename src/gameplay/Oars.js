import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeWaterAware } from '../world/materials.js';

// The oars. Every rowing boat on the river carries a pair on thole pins at the gunwales beside
// the rower; Varanasi boatmen sit facing the bow and push: the handles go forward through the
// drive while the blades sweep aft through the water, then the blades lift, turn flat and swing
// forward for the next catch. The sweep follows the stroke the hull is actually pulling
// (PlayerBoat rowPhase / strokeSide / strokeDir); a boat that has stopped rowing rests its oars
// with the blades trailing just clear of the water. The rower's hands are IK'd to the handles
// (boat.oarHands: [left, right] in world space). One InstancedMesh for every oar on the river.

// boat frame: bow +Z, the rower's left +X, the waterline at y = 0 (Boats.js BOAT)
export const OAR = {
  thole: { x: 1.15, y: 1.06, z: -1.25 }, // the pin on the gunwale, a little ahead of the rower
  inboard: 1.1, // pin -> grip: the grips meet in front of his chest
  bladeAt: 2.85, // pin -> the blade's middle
  catch: 0.34, // sweep (rad, + = blade toward the bow) at the start of the drive
  finish: -0.32,
  dipIn: 0.39, // the oar's downward slope with the blade buried
  dipOut: 0.31, // ...and lifted clear for the recovery
};

const MAX = 8;
const _m = new THREE.Matrix4();
const _l = new THREE.Matrix4();
const _u = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

function oarGeometry() {
  // shaft along +X from the pin (x = 0): grip at -inboard, blade out past bladeAt
  const parts = [];
  const shaftLen = OAR.inboard + OAR.bladeAt - 0.2;
  const shaft = new THREE.CylinderGeometry(0.024, 0.03, shaftLen, 8, 1);
  shaft.rotateZ(-Math.PI / 2);
  shaft.translate(-OAR.inboard + shaftLen / 2, 0, 0);
  parts.push(shaft);
  const grip = new THREE.CylinderGeometry(0.032, 0.032, 0.26, 8, 1);
  grip.rotateZ(-Math.PI / 2);
  grip.translate(-OAR.inboard + 0.1, 0, 0);
  parts.push(grip);
  // the blade: a flat board, its width across the shaft (vertical when squared in the water)
  const blade = new THREE.BoxGeometry(0.72, 0.17, 0.022, 4, 1, 1);
  const pos = blade.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    // tapered into the shaft at its root
    const k = (pos.getX(i) + 0.36) / 0.72;
    pos.setY(i, pos.getY(i) * (0.45 + 0.55 * Math.min(1, k * 2.2)));
  }
  blade.computeVertexNormals();
  blade.translate(OAR.bladeAt, 0, 0);
  parts.push(blade);
  return mergeGeometries(parts.map((g) => g.toNonIndexed()));
}

export class Oars {
  constructor(scene) {
    const mat = makeWaterAware(new THREE.MeshStandardMaterial({ color: 0x6e4b2c, roughness: 0.72, metalness: 0 }), { puddles: false });
    this.mesh = new THREE.InstancedMesh(oarGeometry(), mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // (no shadows of their own: thin poles in the shadow map stair-step across the water)
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.name = 'oars';
    scene.add(this.mesh);
    this.boats = []; // { boat, rest: [l, r] }
  }

  add(boat) {
    if (this.boats.some((e) => e.boat === boat)) return;
    boat.oarHands = [new THREE.Vector3(), new THREE.Vector3()];
    this.boats.push({ boat, rest: [1, 1] });
  }

  remove(boat) {
    this.boats = this.boats.filter((e) => e.boat !== boat);
  }

  /** The sweep, slope and feather of one oar at stroke phase ph (0..1: drive then recovery). */
  static pose(ph, dir) {
    const [a, b] = dir < 0 ? [OAR.finish, OAR.catch] : [OAR.catch, OAR.finish];
    const ease = (t) => (1 - Math.cos(Math.PI * t)) / 2;
    let sweep;
    if (ph < 0.5) sweep = a + (b - a) * ease(ph / 0.5);
    else sweep = b + (a - b) * ease((ph - 0.5) / 0.5);
    // in the water through the drive (in just after the catch, out just before the finish)
    const sm = (e0, e1, x) => {
      const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
      return t * t * (3 - 2 * t);
    };
    const wet = sm(0.0, 0.06, ph) * (1 - sm(0.44, 0.52, ph)) + sm(0.94, 1.0, ph) * 0.35;
    const dip = OAR.dipOut + (OAR.dipIn - OAR.dipOut) * wet;
    // the blade turns flat for the recovery, square again before the catch
    const feather = sm(0.5, 0.62, ph) * (1 - sm(0.84, 0.97, ph));
    return { sweep, dip, feather };
  }

  update(dt) {
    let n = 0;
    for (const e of this.boats) {
      const b = e.boat;
      const rowing = b.strokeTimer > 0;
      const ph = rowing ? Math.min(0.999, b.rowPhase ?? 0) : 1;
      b.object.updateMatrixWorld();
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? 1 : -1; // left (+X), right
        // one-oar strokes (turning): the other oar holds, blade clear
        const active = rowing && (!b.strokeSide || b.strokeSide === -s);
        e.rest[i] += ((active ? 0 : 1) - e.rest[i]) * Math.min(1, dt * (active ? 9 : 2.5));
        const P = Oars.pose(ph, b.strokeDir || 1);
        const r = e.rest[i];
        const sweep = P.sweep * (1 - r) + -0.1 * r;
        const dip = P.dip * (1 - r) + 0.3 * r;
        // how far into the drive (0 at the catch, 1 at the finish): the rower leans with it
        if (i === 0) b.oarLean = (1 - r) * Math.min(1, Math.max(0, (OAR.catch - sweep) / (OAR.catch - OAR.finish)));
        const feather = P.feather * (1 - r) + 1 * r;
        // the oar's line: outboard on its side, swept fore/aft, sloping down to the water
        _u.set(s * Math.cos(dip) * Math.cos(sweep), -Math.sin(dip), Math.cos(dip) * Math.sin(sweep)).normalize();
        _z.crossVectors(_u, UP).normalize();
        _y.crossVectors(_z, _u).normalize();
        _q.setFromAxisAngle(_u, feather * (Math.PI / 2) * s);
        _y.applyQuaternion(_q);
        _z.applyQuaternion(_q);
        // the geometry runs along +X: map +X to the oar's line
        _l.makeBasis(_u, _y, _z);
        _p.set(s * OAR.thole.x, OAR.thole.y, OAR.thole.z);
        _l.setPosition(_p);
        _m.multiplyMatrices(b.object.matrixWorld, _l);
        if (n < MAX) this.mesh.setMatrixAt(n++, _m);
        // the grip, for the rower's hand
        b.oarHands[i].set(_p.x - _u.x * (OAR.inboard - 0.08), _p.y - _u.y * (OAR.inboard - 0.08), _p.z - _u.z * (OAR.inboard - 0.08)).applyMatrix4(b.object.matrixWorld);
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
