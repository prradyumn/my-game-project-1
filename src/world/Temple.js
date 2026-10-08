import * as THREE from 'three';

// Procedural Nagara temples (curvilinear shikhara spire, amalaka, kalash, flag) and
// Rajput-style chhatri domes. Everything writes into MeshBuilders so a whole city of temples
// stays a few draw calls.

const STYLE = {
  sandstone: { base: [0.98, 0.86, 0.68], spire: [1.0, 0.88, 0.7], builder: 'carved', spireBuilder: 'carved' },
  white: { base: [0.96, 0.95, 0.91], spire: [0.97, 0.95, 0.9], builder: 'plaster', spireBuilder: 'plaster' },
  ochre: { base: [0.93, 0.66, 0.3], spire: [0.95, 0.6, 0.22], builder: 'plaster', spireBuilder: 'plaster' },
  kedar: { base: [0.96, 0.95, 0.91], spire: [0.97, 0.95, 0.9], builder: 'plaster', spireBuilder: 'plaster', stripes: true },
  gold: { base: [0.98, 0.86, 0.68], spire: [1, 1, 1], builder: 'carved', spireBuilder: 'gold' },
};

const RED = new THREE.Color(0.62, 0.14, 0.1);

function shikharaRadius(th, t) {
  const c = Math.abs(Math.cos(th));
  const s = Math.abs(Math.sin(th));
  const sq = 1 / Math.pow(Math.pow(c, 6) + Math.pow(s, 6), 1 / 6);
  const rathas = 1 + 0.045 * Math.cos(th * 12) + 0.025 * Math.cos(th * 28);
  const bands = 1 + 0.035 * Math.max(0, Math.sin(t * Math.PI * 22));
  return sq * 0.86 * rathas * bands;
}

export function shikhara(b, x, y, z, R, H, color, opts = {}) {
  const rings = 26;
  const profile = [];
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    profile.push([R * (0.3 + 0.7 * Math.pow(1 - t, 0.62)), t * H]);
  }
  const base = new THREE.Color(...color);
  b.lathe(x, y, z, profile, 40, base, {
    tile: 1.5,
    radiusFn: shikharaRadius,
    colorFn: opts.stripes
      ? (th, t) => (Math.floor(t * 11) % 2 ? RED : base)
      : (th, t) => base.clone().multiplyScalar(0.86 + 0.14 * Math.max(0, Math.sin(t * Math.PI * 22))),
  });
  const topR = R * 0.3;
  b.disc(x, y + H, z, topR * 0.95, 24, base);
  amalaka(b, x, y + H, z, R, base);
  return y + H + R * 0.22; // top of the amalaka
}

export function amalaka(b, x, y, z, R, color) {
  b.lathe(x, y, z, [[0.26 * R, 0], [0.42 * R, 0.05 * R], [0.46 * R, 0.11 * R], [0.42 * R, 0.17 * R], [0.24 * R, 0.22 * R]], 32, color, {
    tile: 1,
    radiusFn: (th) => 1 + 0.07 * Math.abs(Math.cos(th * 12)),
  });
  b.disc(x, y + 0.22 * R, z, 0.24 * R, 16, color);
}

export function kalash(b, x, y, z, R) {
  const gold = new THREE.Color(1, 1, 1);
  b.lathe(x, y, z, [[0.04 * R, 0], [0.12 * R, 0.05 * R], [0.15 * R, 0.13 * R], [0.09 * R, 0.22 * R], [0.05 * R, 0.3 * R], [0.07 * R, 0.34 * R], [0.012 * R, 0.52 * R]], 16, gold, { tile: 1 });
  return y + 0.52 * R;
}

// Slightly onion-shaped Rajput dome on an octagonal drum.
export function dome(b, x, y, z, R, color) {
  const prof = [];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2);
    prof.push([R * Math.cos(a) * (1 + 0.16 * Math.sin(2 * a)), R * Math.sin(a) * 1.15]);
  }
  b.lathe(x, y, z, prof, 16, color, { tile: 1.5 });
  b.lathe(x, y + R * 1.15, z, [[0.12 * R, 0], [0.06 * R, 0.25 * R], [0.0, 0.5 * R]], 8, color, { tile: 1 });
}

// Small kiosk: four pillars, a slab and a dome. Origin at the base centre.
export function chhatri(b, x, y, z, size, yaw, color) {
  const h = size * 0.9;
  const s = size * 0.42;
  const c = Math.cos(yaw);
  const sn = Math.sin(yaw);
  for (const [px, pz] of [[-s, -s], [s, -s], [-s, s], [s, s]]) {
    b.box(x + px * c + pz * sn, y + h / 2, z - px * sn + pz * c, size * 0.1, h, size * 0.1, yaw, color, { tile: 1.5 });
  }
  b.box(x, y + h + size * 0.06, z, size * 1.12, size * 0.12, size * 1.12, yaw, color, { tile: 1.5, faces: ['px', 'nx', 'py', 'pz', 'nz', 'ny'] });
  dome(b, x, y + h + size * 0.12, z, size * 0.48, color);
}

/**
 * A complete temple. `builders` = { stone, plaster, gold } MeshBuilders.
 * Placement via a Matrix4 (lets the sunken Ratneshwar temple lean).
 * Local frame: front faces +Z, base at y = 0.
 * Returns flag positions (world) and the local footprint for colliders.
 */
export function buildTemple(builders, matrix, S, styleName = 'sandstone') {
  const st = STYLE[styleName] || STYLE.sandstone;
  // 'carved' falls back to plain stone if no carved-sandstone texture is available
  const bb = builders[st.builder] || builders.stone;
  const sb = builders[st.spireBuilder] || builders.stone;
  for (const k of Object.keys(builders)) builders[k].setTransform(matrix);
  const baseCol = new THREE.Color(...st.base);
  const darker = baseCol.clone().multiplyScalar(0.8);
  const spireCol = st.spire;

  // Jagati (plinth) and front steps
  bb.box(0, 0.5, 0.2 * S, 1.7 * S, 1.0, 2.4 * S, 0, darker, { tile: 2, grime: 0.25 });
  for (let i = 0; i < 3; i++) {
    const h = 0.34 * (i + 1);
    bb.box(0, h / 2, 1.4 * S + 0.36 * (2 - i) + 0.18, 0.6 * S, h, 0.36, 0, darker, { tile: 2 });
  }
  // Sanctum
  const sanctumZ = -0.35 * S;
  const top = 1.0 + 0.9 * S;
  bb.box(0, 1.0 + 0.45 * S, sanctumZ, S, 0.9 * S, S, 0, baseCol, { tile: 2, grime: 0.2 });
  // cornice
  bb.box(0, top - 0.08 * S, sanctumZ, S * 1.08, 0.1 * S, S * 1.08, 0, darker, { tile: 2 });
  // doorway
  bb.box(0, 1.0 + 0.3 * S, sanctumZ + 0.5 * S + 0.02, 0.32 * S, 0.6 * S, 0.06, 0, new THREE.Color(0.08, 0.06, 0.05), { tile: 2 });

  // Shikhara with four miniature spires
  const R = 0.6 * S;
  const H = 1.9 * S;
  const amTop = shikhara(sb, 0, top, sanctumZ, R, H, spireCol, { stripes: st.stripes });
  for (const [dx, dz] of [[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]]) {
    shikhara(sb, dx * S, top, sanctumZ + dz * S, R * 0.34, H * 0.4, spireCol, { stripes: st.stripes });
  }
  const kTop = kalash(builders.gold, 0, amTop, sanctumZ, R);

  // Mandapa: pillars, roof, stepped pyramid
  const mz = 0.62 * S;
  const ph = 0.6 * S;
  for (const [dx, dz] of [[-0.42, -0.36], [0.42, -0.36], [-0.42, 0.36], [0.42, 0.36]]) {
    bb.cylinder(dx * S, 1.0, mz + dz * S, 0.07 * S, 0.06 * S, ph, 8, baseCol, { tile: 1 });
  }
  bb.box(0, 1.0 + ph + 0.06 * S, mz, 1.05 * S, 0.12 * S, 0.95 * S, 0, darker, { tile: 2, faces: ['px', 'nx', 'py', 'pz', 'nz', 'ny'] });
  for (let i = 0; i < 4; i++) {
    const k = 1 - i * 0.2;
    bb.box(0, 1.0 + ph + 0.12 * S + (i + 0.5) * 0.1 * S, mz, 0.95 * S * k, 0.1 * S, 0.85 * S * k, 0, i % 2 ? darker : baseCol, { tile: 2 });
  }
  amalaka(bb, 0, 1.0 + ph + 0.52 * S, mz, 0.5 * S, baseCol);

  for (const k of Object.keys(builders)) builders[k].setTransform(null);

  const flag = new THREE.Vector3(0, kTop, sanctumZ).applyMatrix4(matrix);
  return {
    flags: [flag],
    footprint: [
      { x: 0, y: 0.5, z: 0.2 * S, w: 1.7 * S, h: 1.0, d: 2.4 * S },
      { x: 0, y: 1.0 + 0.45 * S, z: sanctumZ, w: S, h: 0.9 * S, d: S },
    ],
    height: kTop,
  };
}
