import * as THREE from 'three';
import { RNG } from '../utils/math.js';
import { LANDING_2, ghatById, ghatToWorld } from './WorldLayout.js';
import { OCCLUDE, WORLD_UNIFORMS } from './materials.js';

// The cloth and colour of a living city, all in one merged mesh that moves in the wind:
//   * marigold torans swagged under the first sunshade of the river-front havelis
//   * strings of paper bunting across the lanes and the passages down to the ghats
//   * saris and dhotis drying on lines and laid flat on the lower landings (dhobi ghats),
//     and a little washing on the rooftops
//   * paper kites (patang) high over the roofs, tugging on their strings
// Every vertex carries aSway = (kind, amount, phase): 0 cloth in the breeze, 1 kite bob,
// 2 pennant flutter. One draw call; the bamboo poles on the ghats get real colliders.

const FLOOR_H = 3.2;
const WIND = new THREE.Vector3(0.5, 0, 0.86).normalize(); // off the city, over the river

const SARI = [
  [[0.82, 0.08, 0.2], [0.98, 0.72, 0.12]], // magenta / gold border
  [[0.1, 0.42, 0.7], [0.95, 0.85, 0.3]],
  [[0.95, 0.45, 0.05], [0.65, 0.05, 0.08]],
  [[0.12, 0.55, 0.32], [0.95, 0.4, 0.1]],
  [[0.95, 0.85, 0.2], [0.75, 0.1, 0.12]],
  [[0.55, 0.15, 0.55], [0.95, 0.75, 0.2]],
  [[0.92, 0.9, 0.84], [0.75, 0.15, 0.1]], // white dhoti, red border
  [[0.92, 0.9, 0.84], [0.2, 0.35, 0.65]],
];
const BUNTING = [[0.98, 0.45, 0.05], [0.9, 0.12, 0.15], [0.98, 0.82, 0.15], [0.15, 0.6, 0.3], [0.95, 0.94, 0.9], [0.2, 0.45, 0.85], [0.85, 0.2, 0.6]];
const KITES = [
  [[0.95, 0.15, 0.4], [0.98, 0.85, 0.2]],
  [[0.15, 0.6, 0.35], [0.95, 0.95, 0.9]],
  [[0.98, 0.5, 0.05], [0.2, 0.3, 0.75]],
  [[0.85, 0.1, 0.12], [0.98, 0.95, 0.9]],
  [[0.6, 0.2, 0.7], [0.98, 0.8, 0.15]],
  [[0.1, 0.55, 0.85], [0.98, 0.45, 0.1]],
];

const _c = new THREE.Color();

class ClothBuilder {
  constructor() {
    this.pos = [];
    this.col = [];
    this.sway = [];
    this.home = [];
    this.idx = [];
  }

  // home: where this vertex goes when it is put away (a kite reeled in to the flyer's hand)
  vert(p, c, kind, amount, phase, home = null) {
    this.pos.push(p.x, p.y, p.z);
    if (home) this.home.push(home.x - p.x, home.y - p.y, home.z - p.z);
    else this.home.push(0, 0, 0);
    _c.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
    this.col.push(_c.r, _c.g, _c.b);
    this.sway.push(kind, amount, phase);
    return this.pos.length / 3 - 1;
  }

  /** A grid of (nu+1)*(nv+1) vertices from fn(i/nu, j/nv) -> { p, c, kind, amount, phase }. */
  grid(nu, nv, fn) {
    const base = this.pos.length / 3;
    for (let j = 0; j <= nv; j++)
      for (let i = 0; i <= nu; i++) {
        const v = fn(i / nu, j / nv);
        this.vert(v.p, v.c, v.kind, v.amount, v.phase, v.home);
      }
    const row = nu + 1;
    for (let j = 0; j < nv; j++)
      for (let i = 0; i < nu; i++) {
        const a = base + j * row + i;
        this.idx.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
      }
  }

  /** A bumpy tube along a polyline: a string of marigold heads. */
  garland(points, radius, colorAt, sway) {
    const radial = 4;
    const n = points.length;
    const base = this.pos.length / 3;
    const t = new THREE.Vector3();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const p = new THREE.Vector3();
    let along = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) along += points[i].distanceTo(points[i - 1]);
      t.subVectors(points[Math.min(n - 1, i + 1)], points[Math.max(0, i - 1)]).normalize();
      a.set(0, 1, 0);
      if (Math.abs(t.y) > 0.9) a.set(1, 0, 0);
      b.crossVectors(t, a).normalize();
      a.crossVectors(b, t).normalize();
      const bump = i % 2 ? 0.55 : 1.15;
      const c = colorAt(along, i);
      for (let k = 0; k < radial; k++) {
        const ang = (k / radial) * Math.PI * 2;
        p.copy(points[i]).addScaledVector(a, Math.cos(ang) * radius * bump).addScaledVector(b, Math.sin(ang) * radius * bump);
        this.vert(p, c, 0, sway(i / (n - 1)), along * 0.3);
      }
    }
    for (let i = 0; i < n - 1; i++)
      for (let k = 0; k < radial; k++) {
        const a0 = base + i * radial + k;
        const a1 = base + i * radial + ((k + 1) % radial);
        this.idx.push(a0, a1, a0 + radial, a1, a1 + radial, a0 + radial);
      }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.sway, 3));
    g.setAttribute('aHome', new THREE.Float32BufferAttribute(this.home, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

// a hanging string from a to b, sagging by `sag` at the middle
function catenary(a, b, sag, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push(new THREE.Vector3().lerpVectors(a, b, t).add(new THREE.Vector3(0, -sag * 4 * t * (1 - t), 0)));
  }
  return out;
}

// building local frame: x along the bank, z toward the river (the front)
function local(b, lx, lz, y) {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  return new THREE.Vector3(b.x + c * lx + s * lz, y, b.z - s * lx + c * lz);
}

export function buildStreetLife(layout, physics) {
  const rng = new RNG(9090);
  const cb = new ClothBuilder();
  const clutter = []; // things on the ground the crowd should not stand in: { x, z, r }
  const stats = { torans: 0, bunting: 0, lines: 0, roofLines: 0, kites: 0 };
  const kitesAt = []; // where each kite flies (for the photo hunt)

  // ---------------------------------------------------------------- marigold torans
  const marigold = (along, i) => {
    const k = Math.floor(i / 2); // one flower = a fat ring and a pinch
    if (k % 11 === 5) return [0.72, 0.05, 0.1]; // a rose now and then
    const shade = 0.88 + 0.12 * Math.sin(k * 2.3);
    return k % 5 < 3 ? [1.0 * shade, 0.5 * shade, 0.03] : [1.0 * shade, 0.72 * shade, 0.08];
  };
  // points every ~5.5 cm along a curve so each flower gets its own ring
  const dense = (pts) => {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const n = Math.max(1, Math.round(pts[i].distanceTo(pts[i - 1]) / 0.055));
      for (let k = 1; k <= n; k++) out.push(new THREE.Vector3().lerpVectors(pts[i - 1], pts[i], k / n));
    }
    return out;
  };
  for (const b of layout.buildings) {
    if (b.row !== 0 || b.kind !== 'haveli' || b.floors < 2 || !rng.chance(0.5)) continue;
    stats.torans++;
    const y = b.baseY + FLOOR_H - 0.44; // just under the first chhajja
    const z = b.d / 2 + 0.56;
    const n = Math.max(2, Math.round((b.w - 1.2) / 2.3));
    const x0 = -b.w / 2 + 0.6;
    const step = (b.w - 1.2) / n;
    for (let i = 0; i <= n; i++) {
      const a = local(b, x0 + i * step, z, y);
      if (i < n) {
        const e = local(b, x0 + (i + 1) * step, z, y);
        cb.garland(dense(catenary(a, e, 0.32 + rng.range(-0.05, 0.08), 12)), 0.042, marigold, (t) => 0.25 * Math.sin(Math.PI * t));
      }
      // a strand hanging at every knot
      const len = rng.range(0.45, 0.85);
      const pts = [];
      for (let k = 0; k <= 1; k++) pts.push(a.clone().add(new THREE.Vector3(0, -len * k, 0)));
      cb.garland(dense(pts), 0.038, marigold, (t) => 0.35 * t);
    }
  }

  // ---------------------------------------------------------------- bunting
  const pennants = (a, b, sag) => {
    stats.bunting++;
    const pts = catenary(a, b, sag, 24);
    // the string itself
    cb.grid(24, 1, (u, v) => {
      const i = Math.round(u * 24);
      return { p: pts[i].clone().add(new THREE.Vector3(0, v * 0.015, 0)), c: [0.85, 0.82, 0.75], kind: 0, amount: 0.15 * Math.sin(Math.PI * u), phase: a.x * 0.1 };
    });
    const len = pts[0].distanceTo(pts[24]);
    const count = Math.floor(len / 0.34);
    const dir = new THREE.Vector3().subVectors(b, a).setY(0).normalize();
    const ci = rng.int(0, BUNTING.length - 1);
    for (let k = 1; k < count; k++) {
      const t = k / count;
      const at = new THREE.Vector3().lerpVectors(a, b, t).add(new THREE.Vector3(0, -sag * 4 * t * (1 - t), 0));
      const c = BUNTING[(ci + k) % BUNTING.length];
      const sw = 0.15 * Math.sin(Math.PI * t);
      const l = at.clone().addScaledVector(dir, -0.11);
      const r = at.clone().addScaledVector(dir, 0.11);
      const tip = at.clone().add(new THREE.Vector3(0, -0.26, 0));
      const i0 = cb.vert(l, c, 2, sw, k * 0.7);
      const i1 = cb.vert(r, c, 2, sw, k * 0.7);
      const i2 = cb.vert(tip, c, 2, sw + 1, k * 0.7);
      cb.idx.push(i0, i1, i2);
    }
  };
  const byRow = [0, 1, 2, 3].map((r) => layout.buildings.filter((b) => b.row === r));
  const T = (b) => new THREE.Vector3(Math.cos(b.yaw), 0, -Math.sin(b.yaw));
  // across the lanes: from the back of one row to the front of the next
  for (let r = 0; r < 3; r++) {
    for (const A of byRow[r]) {
      if (A.h < 9 || !rng.chance(0.55)) continue;
      const ua = rng.range(-A.w / 2 + 1.5, A.w / 2 - 1.5);
      const y = A.baseY + rng.range(5.6, 7.2);
      const pa = local(A, ua, -A.d / 2 - 0.05, y);
      const B = byRow[r + 1].find((b) => {
        const d = pa.clone().sub(new THREE.Vector3(b.x, pa.y, b.z));
        return Math.abs(d.dot(T(b))) < b.w / 2 - 1 && b.h > 8;
      });
      if (!B) continue;
      const ub = pa.clone().sub(new THREE.Vector3(B.x, pa.y, B.z)).dot(T(B)) + rng.range(-2, 2);
      const pb = local(B, Math.max(-B.w / 2 + 1, Math.min(B.w / 2 - 1, ub)), B.d / 2 + 0.05, B.baseY + rng.range(5.6, 7.2));
      const span = pa.distanceTo(pb);
      if (span < 4 || span > 18) continue;
      pennants(pa, pb, span * 0.06);
    }
  }
  // across the passages down to the ghats (between neighbouring river-front buildings)
  const front = [...byRow[0]].sort((a, b) => a.x - b.x);
  for (let i = 0; i < front.length - 1; i++) {
    const A = front[i];
    const B = front[i + 1];
    if (!A.rightOpen && !B.leftOpen) continue;
    for (let k = 0; k < 3; k++) {
      const lz = A.d / 2 - 1.5 - k * rng.range(2.5, 4);
      const pa = local(A, A.w / 2 + 0.05, lz, A.baseY + rng.range(4.6, 6.4));
      const pb = local(B, -B.w / 2 - 0.05, lz - (A.d - B.d) / 2 + rng.range(-1, 1), B.baseY + rng.range(4.6, 6.4));
      const span = pa.distanceTo(pb);
      if (span < 2.5 || span > 14) continue;
      pennants(pa, pb, span * 0.07);
    }
  }

  // ---------------------------------------------------------------- laundry
  const sari = (top, along, width, drop, colors, phase) => {
    // hangs from the line: top edge fixed, the hem swings
    const [body, border] = colors;
    cb.grid(3, 6, (u, v) => {
      const edge = u < 0.08 || u > 0.92 || v > 0.86;
      return {
        p: top.clone().addScaledVector(along, (u - 0.5) * width).add(new THREE.Vector3(0, -v * drop, 0)),
        c: edge ? border : body,
        kind: 0,
        amount: Math.pow(v, 1.2),
        phase: phase + u * 0.8,
      };
    });
  };
  const pole = (p, h) => {
    // bamboo: a thin 4-sided post (static)
    const c = [0.72, 0.6, 0.38];
    for (const [dx, dz] of [[1, 0], [0, 1]]) {
      cb.grid(1, 1, (u, v) => ({ p: new THREE.Vector3(p.x + (u - 0.5) * 0.08 * dx, p.y + v * h, p.z + (u - 0.5) * 0.08 * dz), c, kind: 0, amount: 0, phase: 0 }));
    }
  };
  const lineOf = (a, b, phase) => {
    const pts = catenary(a, b, 0.12, 8);
    cb.grid(8, 1, (u, v) => ({ p: pts[Math.round(u * 8)].clone().add(new THREE.Vector3(0, v * 0.012, 0)), c: [0.9, 0.88, 0.8], kind: 0, amount: 0, phase }));
    return pts;
  };
  const far = (p, list, r) => list.every((q) => Math.hypot(q.x - p.x, q.z - p.z) > r);
  // only what stands on the same landing
  const avoid = [...layout.umbrellas, ...layout.aartiPlatforms, ...(layout.pigeonSpots || [])].filter((q) => q.y === undefined || Math.abs(q.y - LANDING_2.h0) < 1);
  for (const id of ['tulsi', 'chetsingh', 'panchganga']) {
    const g = ghatById(id);
    if (!g) continue;
    const vLine = (LANDING_2.v0 + LANDING_2.v1) / 2 - 0.9;
    const y = LANDING_2.h0;
    let placed = 0;
    for (let u = 6; u < g.width - 12 && placed < 3; u += 4) {
      const len = rng.range(6, 8);
      const a = ghatToWorld(g, u, vLine);
      const b = ghatToWorld(g, u + len, vLine);
      const mid = ghatToWorld(g, u + len / 2, vLine);
      if (!far(a, avoid, 3.2) || !far(b, avoid, 3.2) || !far(mid, avoid, 3.5)) continue;
      const pa = new THREE.Vector3(a.x, y, a.z);
      const pb = new THREE.Vector3(b.x, y, b.z);
      pole(pa, 2.25);
      pole(pb, 2.25);
      physics.addCylinder(pa.x, y, pa.z, 0.05, 2.25);
      physics.addCylinder(pb.x, y, pb.z, 0.05, 2.25);
      clutter.push({ x: pa.x, z: pa.z, r: 0.7 }, { x: pb.x, z: pb.z, r: 0.7 });
      const pts = lineOf(pa.clone().setY(y + 2.15), pb.clone().setY(y + 2.15), u);
      const along = new THREE.Vector3(g.T.x, 0, g.T.z);
      const n = Math.floor((len - 0.6) / 1.15);
      for (let k = 0; k < n; k++) {
        const t = (k + 0.75) / (n + 0.5);
        const top = pts[Math.round(t * 8)].clone();
        top.y = y + 2.15 - 0.12 * 4 * t * (1 - t);
        sari(top, along, rng.range(0.85, 1.05), rng.range(1.25, 1.6), rng.pick(SARI), k * 1.3 + u);
      }
      for (let k = 0; k < n; k++) {
        const c = ghatToWorld(g, u + ((k + 0.75) / (n + 0.5)) * len, vLine);
        clutter.push({ x: c.x, z: c.z, r: 0.75 });
      }
      // saris laid out to dry on the stone, nearer the water
      for (let k = 0; k < 2; k++) {
        const v0 = LANDING_2.v1 - 1.5 + k * 0.05;
        const u0 = u + k * 3.4;
        const p0 = ghatToWorld(g, u0, v0);
        if (!far(p0, avoid, 3) || !far(ghatToWorld(g, u0 + 3, v0), avoid, 3)) continue;
        const [body, border] = rng.pick(SARI);
        cb.grid(4, 1, (uu, vv) => {
          const q = ghatToWorld(g, u0 + uu * 3, v0 + vv * 1.05);
          const edge = vv === 0 || vv === 1 || uu === 0 || uu === 1;
          return { p: new THREE.Vector3(q.x, y + 0.014, q.z), c: edge ? border : body, kind: 0, amount: 0, phase: 0 };
        });
        // the border as a second, thin strip on top so it reads as a hem
        cb.grid(4, 1, (uu, vv) => {
          const q = ghatToWorld(g, u0 + uu * 3, v0 + vv * 0.14);
          return { p: new THREE.Vector3(q.x, y + 0.017, q.z), c: border, kind: 0, amount: 0, phase: 0 };
        });
      }
      placed++;
      stats.lines++;
      u += len + 4;
    }
  }
  // washing on the rooftops
  for (const b of layout.buildings) {
    if (b.row > 1 || b.kind !== 'haveli' || b.roof.setback || b.roof.shrine || b.w < 9 || !rng.chance(0.22)) continue;
    stats.roofLines++;
    const top = b.baseY + b.h;
    const len = Math.min(6, b.w - 4);
    const x0 = -b.w / 2 + 1.8;
    const pa = local(b, x0, 0.4, top);
    const pb = local(b, x0 + len, 0.4, top);
    pole(pa, 1.75);
    pole(pb, 1.75);
    const pts = lineOf(pa.clone().setY(top + 1.7), pb.clone().setY(top + 1.7), b.x);
    const along = T(b);
    const n = Math.floor(len / 0.95);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.6) / (n + 0.2);
      const at = pts[Math.round(t * 8)].clone();
      at.y = top + 1.7 - 0.12 * 4 * t * (1 - t);
      sari(at, along, rng.range(0.55, 0.8), rng.range(0.7, 1.1), rng.pick(SARI), k + b.x);
    }
  }

  // ---------------------------------------------------------------- kites
  const roofs = layout.buildings.filter((b) => b.kind === 'haveli' && b.row < 2 && !b.roof.chhatri && Math.abs(b.x) < 400);
  const kites = Math.min(22, roofs.length);
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < kites; i++) {
    const b = roofs[Math.floor(rng.next() * roofs.length)];
    const hand = local(b, rng.range(-b.w / 4, b.w / 4), rng.range(-b.d / 4, b.d / 4), b.baseY + b.h + 1.3);
    // fly downwind of the flyer: out over the ghats and the river
    const wind = WIND.clone().add(T(b).multiplyScalar(rng.range(-0.5, 0.5))).setY(0).normalize();
    const L = rng.range(22, 36);
    const elev = rng.range(0.7, 1.0);
    const kite = hand.clone().addScaledVector(wind, L * Math.cos(elev)).addScaledVector(up, L * Math.sin(elev));
    const phase = rng.range(0, 6.28);
    stats.kites++;
    kitesAt.push({ x: kite.x, y: kite.y, z: kite.z });
    // string: from the hand (still) to the kite (bobbing with it)
    const pts = catenary(hand, kite, L * 0.05, 20);
    cb.grid(20, 1, (u, v) => ({ p: pts[Math.round(u * 20)].clone().add(new THREE.Vector3(0, v * 0.025, 0)), c: [0.92, 0.9, 0.86], kind: 1, amount: u * u, phase, home: hand }));
    // the kite: a diamond facing back toward the flyer, tilted into the wind
    const side = new THREE.Vector3().crossVectors(up, wind).normalize();
    const kup = up.clone().applyAxisAngle(side, -0.45);
    const [c1, c2] = rng.pick(KITES);
    const s = rng.range(1.5, 1.9);
    const at = (x, y) => kite.clone().addScaledVector(side, x * s).addScaledVector(kup, y * s);
    const top = cb.vert(at(0, 0.48), c1, 1, 1, phase, hand);
    const left = cb.vert(at(-0.34, 0.08), c1, 1, 1, phase, hand);
    const right = cb.vert(at(0.34, 0.08), c2, 1, 1, phase, hand);
    const bot = cb.vert(at(0, -0.42), c2, 1, 1, phase, hand);
    const mid = cb.vert(at(0, 0.08), c1, 1, 1, phase, hand);
    cb.idx.push(top, left, mid, top, mid, right, left, bot, mid, mid, bot, right);
    // a tail that flutters
    cb.grid(1, 6, (u, v) => {
      const p = at((u - 0.5) * 0.08, -0.42 - v * 1.1);
      return { p, c: c2, kind: 1, amount: 1 + v * 0.6, phase: phase + v * 2.0, home: hand };
    });
  }

  const kitesUp = { value: 1 };
  const geometry = cb.build();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = WORLD_UNIFORMS.uTime;
    shader.uniforms.uWind = { value: WIND };
    shader.uniforms.uKites = kitesUp;
    // cloth between the camera and Prady (or the enemy he's locked on to) dithers out, and cloth
    // right at the lens: a sari on the line beside a fight never blinds the view (the umbrellas'
    // occluder fade, per pixel, since the cloth is one merged mesh)
    shader.uniforms.uFocusA = OCCLUDE.uFocusA;
    shader.uniforms.uFocusB = OCCLUDE.uFocusB;
    shader.uniforms.uOccOn = OCCLUDE.uOccOn;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uFocusA;\nuniform vec3 uFocusB;\nuniform float uOccOn;\nvarying vec3 vClothW;')
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        {
          float fade = 1.0 - smoothstep(0.8, 1.4, distance(vClothW, cameraPosition));
          // (sight lines to the chest and to the hips: the whole body, not just the head)
          for (int i = 0; i < 4; i++) {
            vec3 f = i < 2 ? uFocusA : uFocusB;
            if (f.y < -900.0) continue;
            f.y -= float(i - (i / 2) * 2) * 0.8;
            vec3 d = f - cameraPosition;
            float t = clamp(dot(vClothW - cameraPosition, d) / max(dot(d, d), 1e-4), 0.0, 1.0);
            float off = distance(vClothW, cameraPosition + d * t);
            fade = max(fade, (1.0 - smoothstep(0.45, 0.85, off)) * (1.0 - smoothstep(0.82, 0.95, t)));
          }
          float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          if (ign < fade * uOccOn) discard;
        }`
      );
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec3 uWind;\nuniform float uKites;\nattribute vec3 aSway;\nattribute vec3 aHome;\nvarying vec3 vClothW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vClothW = (modelMatrix * vec4(transformed, 1.0)).xyz;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          float kind = aSway.x;
          float amt = aSway.y;
          float ph = aSway.z;
          if (kind < 0.5) {
            // cloth in the breeze: gusts push the hem downwind and let it fall back
            float gust = 0.6 + 0.4 * sin(uTime * 0.31 + ph * 0.2);
            float w = sin(uTime * 1.7 + ph + position.x * 0.35) * 0.11 + sin(uTime * 3.9 + ph * 1.7) * 0.035;
            transformed += uWind * amt * (w + 0.08) * gust;
            transformed.y += amt * abs(w) * 0.25 * gust;
          } else if (kind < 1.5) {
            // a kite on the wind: slow figure-eights, a dive, a climb
            vec3 o = vec3(sin(uTime * 0.53 + ph) * 2.4, sin(uTime * 1.06 + ph * 1.3) * 1.3, cos(uTime * 0.41 + ph) * 1.8);
            transformed += o * min(amt, 1.0);
            float tail = max(0.0, amt - 1.0);
            transformed += uWind * tail * sin(uTime * 7.0 + ph) * 0.25;
            transformed = mix(position + aHome, transformed, uKites); // reeled in after dark
          } else {
            // a pennant: the string sways, the tip flutters
            float f = sin(uTime * 6.5 + ph + position.x * 0.8);
            transformed += uWind * (min(amt, 1.0) * 0.1 * sin(uTime * 1.5 + ph * 0.1) + max(0.0, amt - min(amt, 1.0)) * f * 0.07);
          }
        }`
      );
  };
  material.customProgramCacheKey = () => 'street-cloth';
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'street-life';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  stats.triangles = geometry.index.count / 3;
  return {
    mesh,
    clutter,
    stats,
    kites: kitesAt,
    // daylight 0..1: kites fly from mid-morning until dusk
    update(day) {
      kitesUp.value = day > 0.35 ? 1 : 0;
    },
  };
}

