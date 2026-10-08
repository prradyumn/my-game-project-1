import * as THREE from 'three';
import { GHAT_TOP } from '../config.js';
import { MeshBuilder } from '../utils/MeshBuilder.js';
import { RNG } from '../utils/math.js';
import { frameAtX, frameToWorld, ghatById, LANES_V } from './WorldLayout.js';
import { makeWaterAware } from './materials.js';

// The galis: the narrow lanes behind the ghats, where Kashi actually lives. Little shops set
// into the house fronts (a raised wooden takht under a cloth awning, goods heaped on it, a
// painted Devanagari board above), lamps that come on at dusk, and hidden shrines in the walls
// (a black lingam in a niche, marigolds, a diya) that reward a pranam.
//
// Everything is merged: wood, cloth + goods, brass, the signboards: four draw calls in all.

const SHOP_KINDS = {
  kirana: { sign: 'किराना', sub: 'KIRANA STORE', board: '#1e5f8c', awning: ['#d23c2c', '#f4e4c4'] },
  dal: { sign: 'दाल भंडार', sub: 'DAL & GRAIN', board: '#7a3b12', awning: ['#e3a020', '#f6ecd2'] },
  ghee: { sign: 'शुद्ध घी', sub: 'PURE GHEE · MILK', board: '#2e6b3a', awning: ['#ffffff', '#3b8f5a'] },
  masala: { sign: 'मसाला', sub: 'SPICES', board: '#8c1a1a', awning: ['#f0c419', '#c0392b'] },
  mithai: { sign: 'मिठाई', sub: 'SWEETS', board: '#b5481d', awning: ['#ff8c1a', '#fff1d6'] },
  brass: { sign: 'पीतल भंडार', sub: 'BRASS · PUJA', board: '#5b3a8c', awning: ['#8e44ad', '#f3e6ff'] },
  silk: { sign: 'बनारसी साड़ी', sub: 'BANARASI SILK', board: '#8c1a4e', awning: ['#c2185b', '#fdd835'] },
  paan: { sign: 'पान', sub: 'PAAN', board: '#1d6b52', awning: ['#2e7d32', '#e8f5e9'] },
  phool: { sign: 'फूल माला', sub: 'FLOWERS', board: '#a33d1a', awning: ['#ff9800', '#fff3e0'] },
};

// the four shops of Chapter II (Amma's errand), near Kedar Ghat, by name
export const NAMED_SHOPS = [
  { id: 'gopal', kind: 'kirana', owner: 'Gopal', item: 'rice', sign: 'गोपाल किराना' },
  { id: 'agarwal', kind: 'dal', owner: 'Agarwal', item: 'dal', sign: 'अग्रवाल दाल भंडार' },
  { id: 'mohan', kind: 'ghee', owner: 'Mohan', item: 'ghee', sign: 'मोहन डेयरी' },
  { id: 'sushila', kind: 'masala', owner: 'Sushila', item: 'spice', sign: 'सुशीला मसाले' },
];

const C = (hex) => new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);

// ---------------------------------------------------------------- signboards (one canvas atlas)
function signAtlas(signs) {
  const cols = 4;
  const rows = Math.ceil(signs.length / cols);
  const W = 512;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = cols * W;
  c.height = rows * H;
  const ctx = c.getContext('2d');
  signs.forEach((s, i) => {
    const x = (i % cols) * W;
    const y = Math.floor(i / cols) * H;
    // painted tin: a flat colour, a border, slightly faded and scuffed
    ctx.fillStyle = s.board;
    ctx.fillRect(x, y, W, H);
    ctx.strokeStyle = 'rgba(255,240,200,0.85)';
    ctx.lineWidth = 6;
    ctx.strokeRect(x + 7, y + 7, W - 14, H - 14);
    ctx.fillStyle = '#fff6dc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold 58px "Noto Sans Devanagari", "Kohinoor Devanagari", "Devanagari Sangam MN", sans-serif`;
    ctx.fillText(s.text, x + W / 2, y + H * 0.42, W - 40);
    ctx.font = `600 20px Georgia, serif`;
    ctx.fillStyle = 'rgba(255,240,200,0.9)';
    ctx.fillText(s.sub, x + W / 2, y + H * 0.8, W - 60);
    // weathering
    for (let k = 0; k < 140; k++) {
      ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '40,25,10' : '255,240,210'},${Math.random() * 0.12})`;
      ctx.fillRect(x + Math.random() * W, y + Math.random() * H, 2 + Math.random() * 14, 1 + Math.random() * 4);
    }
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, cols, rows };
}

// ---------------------------------------------------------------- one shop
function addShop(B, s, rng) {
  const K = SHOP_KINDS[s.kind];
  const m = new THREE.Matrix4().makeRotationY(s.yaw).setPosition(s.x, s.y, s.z);
  // local frame: x along the house front, z out into the lane, y up; origin at the wall's foot
  const W = s.w;
  const wood = C('#6b4426');
  const woodDark = C('#4a2c16');
  B.wood.setTransform(m);
  B.cloth.setTransform(m);
  B.brass.setTransform(m);
  B.sign.setTransform(m);
  // the takht: a raised plank platform on short legs, a step in front
  B.wood.box(0, 0.42, 0.85, W, 0.08, 1.7, 0, wood, { tile: 1.2 });
  for (const lx of [-W / 2 + 0.12, W / 2 - 0.12]) for (const lz of [0.15, 1.55]) B.wood.box(lx, 0.19, lz, 0.1, 0.38, 0.1, 0, woodDark);
  B.wood.box(0, 0.12, 1.85, W * 0.5, 0.06, 0.32, 0, wood);
  // posts and the awning frame
  for (const lx of [-W / 2 + 0.08, W / 2 - 0.08]) B.wood.box(lx, 1.35, 1.95, 0.08, 2.7, 0.08, 0, woodDark);
  // awning: striped cloth sloping from the wall out over the takht, a scalloped edge
  const stripes = 9;
  for (let i = 0; i < stripes; i++) {
    const x0 = -W / 2 - 0.15 + ((W + 0.3) * i) / stripes;
    const x1 = -W / 2 - 0.15 + ((W + 0.3) * (i + 1)) / stripes;
    const col = C(K.awning[i % 2]);
    const sag = 0.06;
    B.cloth.quad([x0, 2.95, 0], [x1, 2.95, 0], [x1, 2.62 - sag, 2.15], [x0, 2.62 - sag, 2.15], [0, 0.99, 0.16], [[0, 0], [1, 0], [1, 1], [0, 1]], col.clone().multiplyScalar(0.9), col);
    B.cloth.quad([x0, 2.62 - sag, 2.15], [x1, 2.62 - sag, 2.15], [x1, 2.62 - sag, 2.15], [x0, 2.62 - sag, 2.15], [0, -0.99, -0.16], [[0, 0], [1, 0], [1, 1], [0, 1]], col, col); // (degenerate: keeps winding simple)
    // valance flap
    B.cloth.quad([x0, 2.62 - sag, 2.16], [x1, 2.62 - sag, 2.16], [x1, 2.36, 2.2], [x0, 2.36, 2.2], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]], col.clone().multiplyScalar(0.8), col);
  }
  // the signboard, on the wall above the awning
  const S = B.signs[s.signIndex];
  const u0 = (s.signIndex % B.atlas.cols) / B.atlas.cols;
  const v0 = 1 - Math.floor(s.signIndex / B.atlas.cols + 1) / B.atlas.rows;
  const du = 1 / B.atlas.cols;
  const dv = 1 / B.atlas.rows;
  const sw = Math.min(W - 0.2, 2.8);
  B.sign.quad([-sw / 2, 3.05, 0.06], [sw / 2, 3.05, 0.06], [sw / 2, 3.75, 0.06], [-sw / 2, 3.75, 0.06], [0, 0, 1], [[u0, v0], [u0 + du, v0], [u0 + du, v0 + dv], [u0, v0 + dv]], C('#ffffff'));
  void S;
  // goods on the takht
  const top = 0.46;
  const goods = s.kind;
  const sackRow = (colors, n) => {
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + 0.45 + (i * (W - 0.9)) / Math.max(1, n - 1);
      const z = 0.85 + (i % 2) * 0.45;
      const r = 0.24 + rng.range(-0.03, 0.03);
      const h = 0.5 + rng.range(-0.06, 0.06);
      // a jute sack: slumped wide at the base, waisted, its mouth rolled down in a thick lip, the
      // grain heaped inside; each a little different, leaning a little
      const jute = C(rng.pick(['#8d6b43', '#9a7a4f', '#7f5f3a', '#a3845a']));
      const lean = new THREE.Matrix4().makeRotationZ(rng.range(-0.06, 0.06)).premultiply(new THREE.Matrix4().makeRotationY(rng.range(0, 6.28)));
      const g = new THREE.LatheGeometry(
        [[0, 0], [r * 1.12, 0.01], [r * 1.18, h * 0.12], [r * 1.05, h * 0.42], [r * 0.9, h * 0.72], [r * 0.95, h * 0.86], [r * 1.12, h * 0.9], [r * 1.14, h * 0.98], [r * 0.98, h]].map(([a, b]) => new THREE.Vector2(a, b)),
        14
      );
      B.cloth.geometry(g, lean.clone().setPosition(x, top, z), jute);
      B.cloth.lathe(x, top + h * 0.97, z, [[r * 0.98, 0], [r * 0.7, 0.07], [r * 0.3, 0.11], [0, 0.12]], 14, C(colors[i % colors.length]));
    }
  };
  if (goods === 'kirana') {
    sackRow(['#f3efe6', '#e8d9a8', '#d9b77a', '#f1ece0'], 5);
    for (let i = 0; i < 6; i++) B.cloth.box(-W / 2 + 0.4 + i * 0.32, 1.7, 0.08, 0.26, 0.34, 0.16, 0, C(['#d32f2f', '#1976d2', '#fbc02d', '#388e3c'][i % 4])); // packets on the wall
  } else if (goods === 'dal') {
    sackRow(['#f2c12e', '#e0a43a', '#8a5a2b', '#c9762c', '#f4d35e'], 6);
  } else if (goods === 'masala') {
    sackRow(['#f2b705', '#c0392b', '#7b3f00', '#e67e22', '#f8f1e0'], 6);
  } else if (goods === 'ghee') {
    for (let i = 0; i < 7; i++) B.brass.cylinder(-W / 2 + 0.35 + i * 0.36, top + 0.18, 0.5 + (i % 2) * 0.5, 0.15, 0.13, 0.36, 12, C('#d8b24a'));
    for (let i = 0; i < 3; i++) B.brass.lathe(-0.6 + i * 0.6, top, 1.25, [[0, 0], [0.2, 0], [0.26, 0.2], [0.18, 0.42], [0.12, 0.5], [0.16, 0.55]], 14, C('#c9a227'));
  } else if (goods === 'mithai') {
    for (let i = 0; i < 4; i++) {
      B.brass.cylinder(-W / 2 + 0.5 + i * ((W - 1) / 3), top + 0.02, 0.8, 0.38, 0.38, 0.04, 18, C('#b0b0b0'));
      for (let k = 0; k < 7; k++) B.cloth.cylinder(-W / 2 + 0.5 + i * ((W - 1) / 3) + Math.cos(k) * 0.18, top + 0.07, 0.8 + Math.sin(k) * 0.18, 0.07, 0.07, 0.05, 8, C(['#ff9f1a', '#f6e7c1', '#ffcc4d', '#e67e22'][i]));
    }
  } else if (goods === 'brass') {
    for (let i = 0; i < 9; i++) B.brass.lathe(-W / 2 + 0.3 + (i % 5) * ((W - 0.6) / 4), top + Math.floor(i / 5) * 0.3, 0.5 + Math.floor(i / 5) * 0.55, [[0, 0], [0.12, 0], [0.16, 0.1], [0.1, 0.22], [0.06, 0.26], [0.08, 0.3]], 12, C('#d9a441'));
    for (let i = 0; i < 5; i++) B.brass.lathe(-W / 2 + 0.4 + i * ((W - 0.8) / 4), 1.6, 0.1, [[0, 0.3], [0.09, 0.2], [0.11, 0.05], [0.04, 0]], 10, C('#c8962f')); // hanging lamps
  } else if (goods === 'silk') {
    for (let i = 0; i < 8; i++) B.cloth.box(-W / 2 + 0.35 + (i % 4) * ((W - 0.7) / 3), top + 0.06 + Math.floor(i / 4) * 0.12, 0.7, 0.5, 0.1, 0.9, 0, C(['#b71c1c', '#ad1457', '#6a1b9a', '#1b5e20', '#f9a825', '#0d47a1', '#e65100', '#880e4f'][i]));
    for (let i = 0; i < 4; i++) B.cloth.quad([-W / 2 + 0.3 + i * 0.7, 2.5, 0.04], [-W / 2 + 0.85 + i * 0.7, 2.5, 0.04], [-W / 2 + 0.85 + i * 0.7, 0.9, 0.04], [-W / 2 + 0.3 + i * 0.7, 0.9, 0.04], [0, 0, 1], [[0, 0], [1, 0], [1, 1], [0, 1]], C(['#c2185b', '#fdd835', '#1565c0', '#2e7d32'][i]), C(['#880e4f', '#f9a825', '#0d47a1', '#1b5e20'][i]));
  } else if (goods === 'paan') {
    for (let i = 0; i < 3; i++) B.brass.cylinder(-0.5 + i * 0.5, top + 0.02, 0.7, 0.32, 0.32, 0.04, 16, C('#c0c0c0'));
    for (let i = 0; i < 18; i++) B.cloth.box(-0.6 + (i % 6) * 0.24, top + 0.06, 0.55 + Math.floor(i / 6) * 0.2, 0.12, 0.02, 0.16, rng.range(0, 3), C('#3f8f3a'));
  } else if (goods === 'phool') {
    for (let i = 0; i < 14; i++) {
      const x = -W / 2 + 0.3 + (i % 7) * ((W - 0.6) / 6);
      B.cloth.cylinder(x, 1.2 + Math.floor(i / 7) * 0.8, 0.12, 0.05, 0.05, 1.0, 6, C(i % 3 ? '#ff9800' : '#ffd23f')); // marigold strings hanging
    }
    sackRow(['#ff9800', '#ffd23f', '#e53935'], 4);
  }
  // shelves and goods against the wall behind
  B.wood.box(0, 1.35, 0.14, W - 0.3, 0.05, 0.28, 0, woodDark);
  B.wood.box(0, 1.95, 0.14, W - 0.3, 0.05, 0.28, 0, woodDark);
  for (let i = 0; i < Math.floor(W / 0.35); i++) B.cloth.box(-W / 2 + 0.3 + i * 0.35, 1.5, 0.14, 0.24, 0.24, 0.2, 0, C(['#e74c3c', '#f1c40f', '#ecf0f1', '#3498db', '#e67e22', '#2ecc71'][(i + s.signIndex) % 6]).multiplyScalar(0.85));
  // the shop lamp (a bare bulb on a flex), world position for the night light pool
  const lamp = new THREE.Vector3(0, 2.55, 1.2).applyMatrix4(m);
  B.brass.cylinder(0, 2.62, 1.2, 0.012, 0.012, 0.33, 4, C('#222222'));
  B.lamps.push(lamp);
}

// ---------------------------------------------------------------- hidden shrines
function addShrine(B, s) {
  const m = new THREE.Matrix4().makeRotationY(s.yaw).setPosition(s.x, s.y, s.z);
  B.stone.setTransform(m);
  B.cloth.setTransform(m);
  B.brass.setTransform(m);
  // a niche framed in red-painted stone, the wall around it smeared with sindoor
  B.stone.box(0, 0.45, 0.12, 0.9, 0.9, 0.24, 0, C('#8f7d68')); // plinth
  B.stone.box(-0.38, 1.25, 0.12, 0.14, 0.75, 0.24, 0, C('#a8342a'));
  B.stone.box(0.38, 1.25, 0.12, 0.14, 0.75, 0.24, 0, C('#a8342a'));
  B.stone.box(0, 1.68, 0.12, 0.9, 0.14, 0.26, 0, C('#a8342a'));
  B.stone.box(0, 1.25, -0.02, 0.62, 0.75, 0.04, 0, C('#2a1e18')); // the dark back of the niche
  // the lingam on its yoni, black and oiled, a garland of marigolds, a bel leaf
  B.stone.cylinder(0, 0.9, 0.12, 0.2, 0.18, 0.06, 18, C('#1c1a1a'));
  B.stone.box(0, 0.9, 0.3, 0.06, 0.04, 0.18, 0, C('#1c1a1a'));
  B.stone.lathe(0, 0.93, 0.12, [[0, 0], [0.085, 0], [0.09, 0.14], [0.07, 0.2], [0, 0.23]], 16, C('#151313'));
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    B.cloth.box(Math.cos(a) * 0.12, 0.98, 0.12 + Math.sin(a) * 0.12, 0.05, 0.05, 0.05, a, C(k % 2 ? '#ff9800' : '#ffc107'));
  }
  B.cloth.box(0, 1.14, 0.17, 0.08, 0.01, 0.05, 0.3, C('#3d7a2a'));
  // a little brass diya on the plinth
  B.brass.lathe(0.24, 0.9, 0.2, [[0, 0], [0.05, 0], [0.06, 0.025], [0.045, 0.03]], 10, C('#d9a441'));
  B.flames.push(new THREE.Vector3(0.24, 0.96, 0.2).applyMatrix4(m));
  s.center = new THREE.Vector3(0, 1, 0.6).applyMatrix4(m);
  B.shrineAt.push(s);
}

// ---------------------------------------------------------------- placement
export function buildGalis(layout, textures, physics, scene) {
  const rng = new RNG(4242);
  const B = {
    wood: new MeshBuilder(),
    cloth: new MeshBuilder(),
    brass: new MeshBuilder(),
    sign: new MeshBuilder(),
    stone: new MeshBuilder(),
    lamps: [],
    flames: [],
    shrineAt: [],
  };
  const shops = [];
  // house fronts on the first lane (behind row 0, facing the river side of row 1) and the second
  const fronts = layout.buildings.filter((b) => (b.row === 1 || b.row === 2) && b.kind === 'haveli' && b.w >= 7);
  // the four named shops: on lane 1 nearest Kedar Ghat
  const kedar = ghatById('kedar');
  const kx = (kedar.x0 + kedar.x1) / 2;
  const nearKedar = fronts.filter((b) => b.row === 1).sort((a, b) => Math.abs(a.x - kx) - Math.abs(b.x - kx)).slice(0, 4);
  nearKedar.sort((a, b) => a.x - b.x);
  const used = new Set();
  const front = (b, w) => {
    // the house's river-facing front: centre of its face, facing the lane (toward the river)
    const f = frameAtX(b.x);
    const v = b.row === 1 ? -29 : -51;
    const p = frameToWorld(f, 0, v);
    const off = (rng.next() - 0.5) * Math.max(0, b.w - w - 1);
    return { x: p.x + f.T.x * off, z: p.z + f.T.z * off, y: GHAT_TOP, yaw: Math.atan2(f.N.x, f.N.z) };
  };
  NAMED_SHOPS.forEach((ns, i) => {
    const b = nearKedar[i];
    if (!b) return;
    used.add(b);
    shops.push({ ...ns, ...front(b, 3.4), w: 3.4, named: true });
  });
  // the rest of the lanes: a shop every few houses
  const kinds = ['kirana', 'mithai', 'brass', 'silk', 'paan', 'phool', 'masala', 'dal', 'ghee', 'mithai', 'silk', 'phool'];
  for (const b of fronts) {
    if (used.has(b) || !rng.chance(b.row === 1 ? 0.42 : 0.22)) continue;
    const w = Math.min(4, b.w - 2);
    shops.push({ id: `shop${shops.length}`, kind: rng.pick(kinds), ...front(b, w), w });
  }
  // signboards: one atlas
  const signs = shops.map((s) => ({ text: s.sign || SHOP_KINDS[s.kind].sign, sub: SHOP_KINDS[s.kind].sub, board: SHOP_KINDS[s.kind].board }));
  B.atlas = signAtlas(signs);
  B.signs = signs;
  shops.forEach((s, i) => {
    s.signIndex = i;
    addShop(B, s, rng);
    // solid: the takht (you climb onto it, as onto any takht) and the posts
    physics.addBox(s.x + Math.sin(s.yaw) * 0.85, GHAT_TOP + 0.23, s.z + Math.cos(s.yaw) * 0.85, s.w, 0.46, 1.7, s.yaw);
    s.counter = { x: s.x + Math.sin(s.yaw) * 2.6, y: GHAT_TOP, z: s.z + Math.cos(s.yaw) * 2.6 }; // where a customer stands
    s.seat = { x: s.x + Math.sin(s.yaw) * 0.42, y: GHAT_TOP + 0.46, z: s.z + Math.cos(s.yaw) * 0.42, yaw: s.yaw }; // the shopkeeper, on his gaddi by the wall
  });
  // hidden shrines: in the house walls along the lanes and the passages down to the ghats
  const shrines = [];
  const walls = layout.buildings.filter((b) => b.kind === 'haveli' && !used.has(b));
  const picks = new Set();
  let guard = 0;
  while (shrines.length < 12 && guard++ < 500) {
    const b = walls[Math.floor(rng.next() * walls.length)];
    if (picks.has(b) || shops.some((s) => Math.hypot(s.x - b.x, s.z - b.z) < 10)) continue;
    picks.add(b);
    const f = frameAtX(b.x);
    // row 0: the back wall (on lane 1); others: the front
    const v = b.row === 0 ? -4 - b.d - 0.02 : [-29, -51, -73][b.row - 1] + 0.02;
    const yaw = b.row === 0 ? Math.atan2(-f.N.x, -f.N.z) : Math.atan2(f.N.x, f.N.z);
    const off = (rng.next() - 0.5) * (b.w - 2);
    const p = frameToWorld(f, off, v);
    const s = { id: `shrine${shrines.length}`, x: p.x, y: GHAT_TOP, z: p.z, yaw };
    shrines.push(s);
    addShrine(B, s);
  }
  // materials
  const woodMat = makeWaterAware(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, map: textures.wood?.map || null, normalMap: textures.wood?.normalMap || null }));
  const clothMat = makeWaterAware(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, side: THREE.DoubleSide }));
  const brassMat = makeWaterAware(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.85 }));
  const signMat = makeWaterAware(new THREE.MeshStandardMaterial({ map: B.atlas.tex, roughness: 0.6, metalness: 0.15 }));
  const stoneMat = makeWaterAware(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, map: textures.stone?.map || null, normalMap: textures.stone?.normalMap || null }));
  const group = new THREE.Group();
  group.name = 'galis';
  for (const [b, mat] of [[B.wood, woodMat], [B.cloth, clothMat], [B.brass, brassMat], [B.sign, signMat], [B.stone, stoneMat]]) {
    if (!b.vertexCount) continue;
    const mesh = new THREE.Mesh(b.build(), mat);
    mesh.castShadow = mat !== signMat;
    mesh.receiveShadow = true;
    // the lanes are behind the ghats: the river's mirror never sees them (layer 2: main view +
    // shadows only, ~5 draw calls saved on the water)
    mesh.layers.set(2);
    group.add(mesh);
  }
  scene.add(group);
  return {
    group,
    shops,
    shrines,
    lamps: B.lamps,
    shrineFlames: B.flames,
    clutter: shops.map((s) => ({ x: s.x + Math.sin(s.yaw) * 1.2, z: s.z + Math.cos(s.yaw) * 1.2, r: s.w / 2 + 0.6 })),
    shop: (id) => shops.find((s) => s.id === id),
  };
}
