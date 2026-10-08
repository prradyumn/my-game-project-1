import * as THREE from 'three';
import { GHAT_TOP } from '../config.js';
import { MeshBuilder } from '../utils/MeshBuilder.js';
import { GROUPS } from '../core/Physics.js';
import { PROFILE, PROFILE_BOTTOM, PROFILE_LEN } from './WorldLayout.js';
import { surfaceMaterial } from './materials.js';
import { RNG } from '../utils/math.js';

// The ghats: every tread and riser of all ten ghats in one mesh, plus a collider per tread.

const TILE = 2.4;
const BASE_Y = -9;
const INLAND = 6; // the top terrace reaches this far back into the city (see Terrain.js)
const SEAM_LIFT = 0.008; // seam fillers sit a hair above the treads (no flicker, no bump)
const KEDAR_RED = new THREE.Color(0.58, 0.13, 0.1);
const KEDAR_WHITE = new THREE.Color(0.96, 0.94, 0.9);

export function buildGhats(layout, textures, physics) {
  const b = new MeshBuilder();
  const rng = new RNG(33);
  const m = new THREE.Matrix4();
  const tmp = new THREE.Vector3();
  const col = new THREE.Color();

  const worldBox = (g, lx, ly, lz, w, h, d, groups) => {
    tmp.set(lx, ly, lz).applyMatrix4(m);
    const c = physics.addBox(tmp.x, tmp.y, tmp.z, w, h, d, g.yaw);
    if (groups !== undefined) c.setCollisionGroups(groups);
  };
  // Smooth ramp over a flight: its top runs through every step nosing, from the upper landing
  // edge (v0, h0) to the lower landing (v1, h1). Wider than the ghat so neighbours overlap.
  const _q0 = new THREE.Quaternion();
  const _q1 = new THREE.Quaternion();
  const rampBox = (g, seg) => {
    const dv = seg.v1 - seg.v0;
    const dh = seg.h1 - seg.h0;
    const len = Math.hypot(dv, dh);
    const alpha = Math.asin(-dh / len); // pitch about the ghat's local X
    const t = 0.6;
    const nY = Math.cos(alpha);
    const nV = Math.sin(alpha);
    const cv = (seg.v0 + seg.v1) / 2 - nV * (t / 2);
    const cy = (seg.h0 + seg.h1) / 2 - nY * (t / 2);
    tmp.set(g.width / 2, cy, cv).applyMatrix4(m);
    _q0.setFromAxisAngle(new THREE.Vector3(0, 1, 0), g.yaw);
    _q1.setFromAxisAngle(new THREE.Vector3(1, 0, 0), alpha);
    _q0.multiply(_q1);
    const c = physics.addBoxQ(tmp.x, tmp.y, tmp.z, g.width + 2.6, t, len, { x: _q0.x, y: _q0.y, z: _q0.z, w: _q0.w });
    c.setCollisionGroups(GROUPS.ramp);
  };

  const tread = (W, v0, v1, h, c, x0 = 0) => {
    b.quad([x0, h, v1], [W, h, v1], [W, h, v0], [x0, h, v0], [0, 1, 0], [[x0 / TILE, v1 / TILE], [W / TILE, v1 / TILE], [W / TILE, v0 / TILE], [x0 / TILE, v0 / TILE]], c);
  };
  const riser = (W, v, hLow, hHigh, c, x0 = 0) => {
    b.quad([x0, hLow, v], [W, hLow, v], [W, hHigh, v], [x0, hHigh, v], [0, 0, 1], [[x0 / TILE, hLow / TILE], [W / TILE, hLow / TILE], [W / TILE, hHigh / TILE], [x0 / TILE, hHigh / TILE]], c);
  };
  const sideCap = (x, v0, v1, h, normalSign) => {
    const c = col.setRGB(0.85, 0.8, 0.72);
    if (normalSign < 0)
      b.quad([x, BASE_Y, v0], [x, BASE_Y, v1], [x, h, v1], [x, h, v0], [-1, 0, 0], [[v0 / TILE, BASE_Y / TILE], [v1 / TILE, BASE_Y / TILE], [v1 / TILE, h / TILE], [v0 / TILE, h / TILE]], c);
    else
      b.quad([x, BASE_Y, v1], [x, BASE_Y, v0], [x, h, v0], [x, h, v1], [1, 0, 0], [[v1 / TILE, BASE_Y / TILE], [v0 / TILE, BASE_Y / TILE], [v0 / TILE, h / TILE], [v1 / TILE, h / TILE]], c);
  };

  layout.ghats.forEach((g, gi) => {
    m.makeRotationY(g.yaw).setPosition(g.S.x, 0, g.S.z);
    b.setTransform(m);
    const W = g.width;
    const tint = new THREE.Color(...g.tint);
    const isFirst = gi === 0;
    const isLast = gi === layout.ghats.length - 1;

    for (const seg of PROFILE) {
      if (seg.kind === 'flat') {
        const c = tint.clone().multiplyScalar(rng.range(0.94, 1.03));
        const v0 = seg.v0 === 0 ? -INLAND : seg.v0; // the top terrace runs back to the houses
        tread(W, v0, seg.v1, seg.h0, c);
        worldBox(g, W / 2, seg.h0 - 0.5, (v0 + seg.v1) / 2, W, 1.0, seg.v1 - v0);
        if (isFirst) sideCap(0, v0, seg.v1, seg.h0, -1);
        if (isLast) sideCap(W, v0, seg.v1, seg.h0, 1);
        continue;
      }
      for (let i = 0; i < seg.steps; i++) {
        const v0 = seg.v0 + i * seg.run;
        const v1 = v0 + seg.run;
        const hPrev = seg.h0 - i * seg.rise;
        const h = hPrev - seg.rise;
        let cTread = tint.clone().multiplyScalar(rng.range(0.9, 1.04));
        let cRiser = cTread.clone().multiplyScalar(0.86);
        if (h < 0.6) {
          // moss / algae where the river reaches
          cTread.multiply(col.setRGB(0.8, 0.86, 0.7));
          cRiser.multiply(col.setRGB(0.74, 0.82, 0.64));
        }
        if (g.stripes && h > 0.4) {
          cRiser = (i % 2 ? KEDAR_RED : KEDAR_WHITE).clone();
          if (i % 4 === 0) cTread = KEDAR_WHITE.clone().multiplyScalar(0.95);
        }
        riser(W, v0, h, hPrev, cRiser);
        tread(W, v0, v1, h, cTread);
        worldBox(g, W / 2, h - 0.4, (v0 + v1) / 2, W, 0.8, seg.run, GROUPS.tread);
        if (isFirst) sideCap(0, v0, v1, h, -1);
        if (isLast) sideCap(W, v0, v1, h, 1);
      }
    }
    for (const seg of PROFILE) if (seg.kind === 'stairs') rampBox(g, seg);
    // Front face where the steps end under the water.
    riser(W, PROFILE_LEN, BASE_Y, PROFILE_BOTTOM, tint.clone().multiplyScalar(0.6));
  });

  // Seams between ghats (each ghat is a straight chord, so neighbours meet at a small angle):
  // a filler on every landing and on every single step, a hair above the treads, so the joint
  // is covered without a curb to trip on.
  const seams = layout.ghats.slice(1).map((g, i) => ({ g, prev: layout.ghats[i] }));
  for (const { g, prev } of seams) {
    const yaw = (g.yaw + prev.yaw) / 2;
    m.makeRotationY(yaw).setPosition(g.S.x, 0, g.S.z);
    b.setTransform(null);
    for (const seg of PROFILE) {
      if (seg.kind === 'flat') {
        const v0 = seg.v0 === 0 ? -INLAND : seg.v0 - 0.3;
        addBoxLocal(b, physics, m, yaw, 0, seg.h0 - 0.5 + SEAM_LIFT, (v0 + seg.v1 + 0.3) / 2, 2.2, 1.0, seg.v1 + 0.3 - v0, col.setRGB(0.86, 0.8, 0.72));
        continue;
      }
      for (let i = 0; i < seg.steps; i++) {
        const v0 = seg.v0 + i * seg.run;
        const top = seg.h0 - (i + 1) * seg.rise + SEAM_LIFT;
        const c = col.setRGB(0.84, 0.78, 0.69).multiplyScalar(top < 0.8 ? 0.75 : 1);
        addBoxLocal(b, physics, m, yaw, 0, top - 0.5, v0 + seg.run / 2, 2.2, 1.0, seg.run, c).setCollisionGroups(GROUPS.tread);
      }
    }
  }

  // Retaining walls at both ends of the ghats.
  for (const [g, atEnd] of [[layout.ghats[0], false], [layout.ghats[layout.ghats.length - 1], true]]) {
    const p = atEnd ? g.E : g.S;
    m.makeRotationY(g.yaw).setPosition(p.x, 0, p.z);
    const h = GHAT_TOP + 1.4 - BASE_Y;
    addBoxLocal(b, physics, m, g.yaw, atEnd ? 2 : -2, BASE_Y + h / 2, PROFILE_LEN / 2 - 1, 4, h, PROFILE_LEN + 4, col.setRGB(0.78, 0.7, 0.6));
  }

  const geo = b.build();
  const mat = surfaceMaterial(textures.stone, { normalScale: 1.1 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.name = 'ghats';
  return { mesh, material: mat };
}

const _p = new THREE.Vector3();
function addBoxLocal(b, physics, m, yaw, lx, ly, lz, w, h, d, color) {
  _p.set(lx, ly, lz).applyMatrix4(m);
  b.box(_p.x, _p.y, _p.z, w, h, d, yaw, color, { tile: TILE, faces: ['px', 'nx', 'py', 'pz', 'nz'] });
  return physics.addBox(_p.x, _p.y, _p.z, w, h, d, yaw);
}
