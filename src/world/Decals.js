import * as THREE from 'three';
import { GHAT_SEGMENTS, LANDING_1, LANDING_2, PROFILE_LEN, ghatHeight, ghatToWorld } from './WorldLayout.js';
import { RNG } from '../utils/math.js';
import { makeWaterAware } from './materials.js';

// What people leave on the stone, from one small sheet painted in code at load (no download):
// cracks, the red of spat paan, oil from the lamps, soot by the pyres, a kumkum handprint, an Om
// painted in vermilion, and rangoli (rings of coloured powder) on the landings by the temples and
// the aarti. Flat on the treads and landings, one instanced draw, lit like the stone.

const CELLS = 4; // 4 x 4 cells
const KINDS = { crack: [0, 1], paan: [2, 3], oil: [4, 5], soot: [6], hand: [7], om: [8], rangoli: [9, 10, 11], scuff: [12, 13] };

function paintAtlas() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S * CELLS;
  const x = c.getContext('2d');
  const rng = new RNG(99);
  const cell = (i, fn) => {
    x.save();
    x.translate((i % CELLS) * S, Math.floor(i / CELLS) * S);
    x.beginPath();
    x.rect(0, 0, S, S);
    x.clip();
    fn(S);
    x.restore();
  };
  // cracks: a wandering line that forks
  const crack = (s) => {
    x.strokeStyle = 'rgba(30,22,16,0.85)';
    x.lineCap = 'round';
    const branch = (px, py, a, len, w) => {
      x.lineWidth = w;
      x.beginPath();
      x.moveTo(px, py);
      for (let i = 0; i < len; i++) {
        a += (rng.next() - 0.5) * 0.7;
        px += Math.cos(a) * 6;
        py += Math.sin(a) * 6;
        x.lineTo(px, py);
        if (rng.next() < 0.08 && w > 0.8) branch(px, py, a + (rng.next() < 0.5 ? 0.9 : -0.9), len * 0.4, w * 0.6);
      }
      x.stroke();
    };
    branch(s * 0.1, s * (0.3 + rng.next() * 0.4), 0, 38, 2.4);
  };
  const splat = (s, col, n, r0) => {
    x.fillStyle = col;
    for (let i = 0; i < n; i++) {
      const a = rng.next() * Math.PI * 2;
      const d = i === 0 ? 0 : rng.next() * s * 0.32;
      x.globalAlpha = i === 0 ? 0.85 : 0.4 + rng.next() * 0.5;
      x.beginPath();
      x.ellipse(s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, (i === 0 ? r0 : r0 * 0.25) * (0.6 + rng.next() * 0.6), (i === 0 ? r0 * 0.75 : r0 * 0.2) * (0.6 + rng.next() * 0.6), a, 0, Math.PI * 2);
      x.fill();
    }
    x.globalAlpha = 1;
  };
  const blot = (s, col, alpha) => {
    const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s * 0.45);
    g.addColorStop(0, col.replace('A', String(alpha)));
    g.addColorStop(0.6, col.replace('A', String(alpha * 0.6)));
    g.addColorStop(1, col.replace('A', '0'));
    x.fillStyle = g;
    for (let i = 0; i < 5; i++) {
      x.beginPath();
      x.ellipse(s / 2 + (rng.next() - 0.5) * 40, s / 2 + (rng.next() - 0.5) * 40, s * (0.25 + rng.next() * 0.2), s * (0.18 + rng.next() * 0.15), rng.next() * 3, 0, Math.PI * 2);
      x.fill();
    }
  };
  cell(0, crack);
  cell(1, crack);
  cell(2, (s) => splat(s, '#8e1410', 14, 34));
  cell(3, (s) => splat(s, '#a3221a', 10, 26));
  cell(4, (s) => blot(s, 'rgba(25,18,10,A)', 0.55));
  cell(5, (s) => blot(s, 'rgba(40,30,15,A)', 0.4));
  cell(6, (s) => blot(s, 'rgba(10,8,6,A)', 0.75));
  cell(7, (s) => {
    // a kumkum handprint: palm and five fingers in vermilion
    x.fillStyle = 'rgba(205,40,30,0.85)';
    x.beginPath();
    x.ellipse(s / 2, s * 0.62, 34, 42, 0, 0, Math.PI * 2);
    x.fill();
    const fingers = [[-30, -20, 9, 30, -0.4], [-12, -45, 9, 36, -0.1], [6, -50, 9, 38, 0], [24, -44, 9, 34, 0.12], [40, -2, 9, 26, 0.7]];
    for (const [dx, dy, w, h, a] of fingers) {
      x.beginPath();
      x.ellipse(s / 2 + dx, s * 0.62 + dy - h * 0.6, w, h, a, 0, Math.PI * 2);
      x.fill();
    }
  });
  cell(8, (s) => {
    // an Om in vermilion, a little worn
    x.fillStyle = 'rgba(200,50,25,0.9)';
    x.font = `bold ${s * 0.7}px "Kohinoor Devanagari", "Devanagari Sangam MN", "Noto Sans Devanagari", serif`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText('ॐ', s / 2, s / 2 + 8);
  });
  // rangoli: rings of petals and dots in coloured powder
  const rangoli = (s, cols) => {
    const cx = s / 2;
    for (let ring = 0; ring < 4; ring++) {
      const r = 18 + ring * 26;
      const n = 6 + ring * 4;
      x.fillStyle = cols[ring % cols.length];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        x.beginPath();
        x.ellipse(cx + Math.cos(a) * r, cx + Math.sin(a) * r, 12 - ring, 5 + ring * 0.6, a, 0, Math.PI * 2);
        x.fill();
      }
    }
    x.fillStyle = cols[cols.length - 1];
    x.beginPath();
    x.arc(cx, cx, 12, 0, Math.PI * 2);
    x.fill();
    x.strokeStyle = 'rgba(255,255,255,0.8)';
    x.lineWidth = 3;
    x.beginPath();
    x.arc(cx, cx, s * 0.44, 0, Math.PI * 2);
    x.stroke();
  };
  cell(9, (s) => rangoli(s, ['#e8341c', '#f2b630', '#2f8f4a', '#f7f0e0']));
  cell(10, (s) => rangoli(s, ['#d6266e', '#f6a21c', '#3a5fc8', '#f4e9cf']));
  cell(11, (s) => rangoli(s, ['#f28d1c', '#e8341c', '#7a2fb0', '#fff4d8']));
  // scuffs: the pale rub of feet, a darker sweep of grime
  cell(12, (s) => blot(s, 'rgba(235,225,200,A)', 0.25));
  cell(13, (s) => blot(s, 'rgba(60,45,30,A)', 0.3));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class Decals {
  constructor(scene) {
    const rng = new RNG(3131);
    const items = [];
    const add = (kind, x, y, z, size, yaw) => items.push({ cell: KINDS[kind][Math.floor(rng.next() * KINDS[kind].length)], x, y, z, size, yaw });
    for (const g of GHAT_SEGMENTS) {
      // cracks, scuffs, oil and paan all down the flights
      for (let i = 0; i < 26; i++) {
        const u = rng.range(1, g.width - 1);
        const v = rng.range(0.4, PROFILE_LEN - 2);
        const y = ghatHeight(v);
        if (!(y > 0.3)) continue;
        const w = ghatToWorld(g, u, v);
        const r = rng.next();
        add(r < 0.3 ? 'crack' : r < 0.55 ? 'scuff' : r < 0.75 ? 'oil' : 'paan', w.x, y, w.z, rng.range(0.4, 1.1), rng.next() * 6.28);
      }
      // the landings: a handprint, an Om; rangoli where the aarti and the temples are
      const sacred = g.aarti || g.id === 'dashashwamedh' || g.id === 'kedar' || g.id === 'assi' || g.id === 'panchganga';
      for (const L of [LANDING_1, LANDING_2]) {
        const v = (L.v0 + L.v1) / 2;
        const y = ghatHeight(v);
        for (let i = 0; i < (sacred ? 4 : 1); i++) {
          const w = ghatToWorld(g, rng.range(3, g.width - 3), v + rng.range(-0.4, 0.4));
          add(sacred && rng.next() < 0.7 ? 'rangoli' : rng.next() < 0.5 ? 'om' : 'hand', w.x, y, w.z, sacred ? rng.range(1.2, 1.9) : 0.7, rng.next() * 6.28);
        }
      }
      if (g.pyres || g.id === 'manikarnika') {
        for (let i = 0; i < 20; i++) {
          const w = ghatToWorld(g, rng.range(2, g.width - 2), rng.range(LANDING_1.v0, PROFILE_LEN - 2));
          add('soot', w.x, ghatHeight(rng.range(LANDING_1.v0, PROFILE_LEN - 2)), w.z, rng.range(1, 2.4), rng.next() * 6.28);
        }
      }
    }
    // one quad per decal, its cell of the sheet chosen per instance
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(items.map((d) => d.cell)), 1));
    const mat = makeWaterAware(new THREE.MeshStandardMaterial({ map: paintAtlas(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, roughness: 0.85 }), { puddles: false, caustics: false });
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader, r) => {
      prev?.call(mat, shader, r);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aCell;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>
        #ifdef USE_MAP
          vMapUv = (vec2(mod(aCell, ${CELLS}.0), ${CELLS - 1}.0 - floor(aCell / ${CELLS}.0)) + uv) / ${CELLS}.0;
        #endif`);
    };
    mat.customProgramCacheKey = () => 'decals';
    this.mesh = new THREE.InstancedMesh(geo, mat, items.length);
    this.mesh.name = 'decals';
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const UP = new THREE.Vector3(0, 1, 0);
    items.forEach((d, i) => {
      q.setFromAxisAngle(UP, d.yaw);
      m.compose(new THREE.Vector3(d.x, d.y + 0.006, d.z), q, new THREE.Vector3(d.size, 1, d.size));
      this.mesh.setMatrixAt(i, m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.computeBoundingSphere();
    scene.add(this.mesh);
  }
}
