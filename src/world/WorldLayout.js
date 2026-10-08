// The whole map of Kashi as pure data + pure functions (no three.js, runs in Node too).
// Meshes (Ghats.js, City.js, Terrain.js), physics colliders and gameplay placement all read
// from here, so what you see, what you collide with and where quests live always agree.
//
// Local "bank frame": u runs along the river bank (+X-ish), v runs from the ghat top edge
// toward the river (v > 0 is down the steps / into the water, v < 0 is inland into the city).

import { BANK, FAR_BANK_V, GHAT_PROFILE, GHAT_TOP, GHATS, RUDRAKSHA_COUNT, WATER_LEVEL } from '../config.js';
import { RNG, fbm, lerp, smoothstep } from '../utils/math.js';

// ---------------------------------------------------------------------------------------------
// Bank curve and frames

export function bankZ(x) {
  const t = x / BANK.halfLen;
  return BANK.z0 + BANK.curve * t * t;
}

export function bankSlope(x) {
  return (2 * BANK.curve * x) / (BANK.halfLen * BANK.halfLen);
}

// Frame at a bank x: origin on the ghat top edge, T along the bank, N toward the river.
export function frameAtX(x) {
  const s = bankSlope(x);
  const l = Math.hypot(1, s);
  const T = { x: 1 / l, z: s / l };
  const N = { x: -T.z, z: T.x };
  return { P: { x, z: bankZ(x) }, T, N, yaw: Math.atan2(-T.z, T.x) };
}

export function frameToWorld(frame, u, v) {
  return {
    x: frame.P.x + frame.T.x * u + frame.N.x * v,
    z: frame.P.z + frame.T.z * u + frame.N.z * v,
  };
}

// ---------------------------------------------------------------------------------------------
// Ghat cross-section

const PROFILE_SEGS = [];
{
  let v = 0;
  let h = GHAT_TOP;
  for (const s of GHAT_PROFILE) {
    if (s.kind === 'flat') {
      PROFILE_SEGS.push({ kind: 'flat', v0: v, v1: v + s.len, h0: h, h1: h });
      v += s.len;
    } else {
      const len = s.steps * s.run;
      PROFILE_SEGS.push({ kind: 'stairs', v0: v, v1: v + len, h0: h, h1: h - s.steps * s.rise, run: s.run, rise: s.rise, steps: s.steps });
      v += len;
      h -= s.steps * s.rise;
    }
  }
}
export const PROFILE = PROFILE_SEGS;
export const PROFILE_LEN = PROFILE_SEGS[PROFILE_SEGS.length - 1].v1;
export const PROFILE_BOTTOM = PROFILE_SEGS[PROFILE_SEGS.length - 1].h1;
// Handy named landings.
export const LANDING_1 = PROFILE_SEGS[2];
export const LANDING_2 = PROFILE_SEGS[4];

// Exact walkable height of the ghat steps at distance v from the top edge.
export function ghatHeight(v) {
  if (v <= 0) return GHAT_TOP;
  for (const s of PROFILE_SEGS) {
    if (v < s.v1) {
      if (s.kind === 'flat') return s.h0;
      const i = Math.min(s.steps - 1, Math.floor((v - s.v0) / s.run));
      return s.h0 - (i + 1) * s.rise;
    }
  }
  return PROFILE_BOTTOM;
}

// ---------------------------------------------------------------------------------------------
// Ghat segments (straight chords of the crescent)

export const GHAT_X_MIN = GHATS[0].x0;
export const GHAT_X_MAX = GHATS[GHATS.length - 1].x1;

export const GHAT_SEGMENTS = GHATS.map((g, index) => {
  const S = { x: g.x0, z: bankZ(g.x0) };
  const E = { x: g.x1, z: bankZ(g.x1) };
  const dx = E.x - S.x;
  const dz = E.z - S.z;
  const width = Math.hypot(dx, dz);
  const T = { x: dx / width, z: dz / width };
  const N = { x: -T.z, z: T.x };
  return { ...g, index, S, E, T, N, width, yaw: Math.atan2(-T.z, T.x) };
});

export function ghatById(id) {
  return GHAT_SEGMENTS.find((g) => g.id === id);
}

export function segmentForX(x) {
  if (x < GHAT_X_MIN || x >= GHAT_X_MAX) return null;
  for (const g of GHAT_SEGMENTS) if (x >= g.x0 && x < g.x1) return g;
  return null;
}

// World position on a ghat from local (u along the ghat, v down the steps).
export function ghatToWorld(g, u, v) {
  return { x: g.S.x + g.T.x * u + g.N.x * v, z: g.S.z + g.T.z * u + g.N.z * v };
}

// (x,z) -> bank coordinates. v is what matters for heights.
export function bankCoords(x, z) {
  const g = segmentForX(x);
  if (g) {
    const rx = x - g.S.x;
    const rz = z - g.S.z;
    return { v: rx * g.N.x + rz * g.N.z, u: rx * g.T.x + rz * g.T.z, seg: g };
  }
  const s = bankSlope(x);
  return { v: (z - bankZ(x)) / Math.hypot(1, s), u: x, seg: null };
}

// ---------------------------------------------------------------------------------------------
// Heights

function cityHeight(_x, _v) {
  return GHAT_TOP;
}

export function riverbedHeight(x, v) {
  const d = v - PROFILE_LEN;
  let y = PROFILE_BOTTOM - Math.min(Math.max(d, 0) * 0.3, 4.6);
  // Gentle undulation on the bed.
  y += (fbm(x * 0.02, v * 0.02, 3) - 0.5) * 1.2 * smoothstep(0, 30, d);
  // Far sand bank rising out of the river.
  const fb = FAR_BANK_V + Math.sin(x * 0.006) * 22 + Math.sin(x * 0.017 + 1.3) * 7;
  const t = smoothstep(fb - 60, fb + 8, v);
  const dunes = 0.9 + (fbm(x * 0.012 + 7, v * 0.012, 4) - 0.45) * 2.6 + smoothstep(fb + 20, fb + 110, v) * 1.6;
  return lerp(y, dunes, t);
}

// Terrain mesh height. Under the ghats it hides 0.6 m below the steps.
export function terrainHeight(x, z) {
  const { v, seg } = bankCoords(x, z);
  if (v <= 0) return cityHeight(x, v);
  if (v < PROFILE_LEN) {
    // hidden under the steps: as low as the steps one terrain cell (4 m, 5.7 m on the
    // diagonal) further down, so no cell of the terrain mesh can poke up through a tread
    if (seg) return ghatHeight(Math.min(v + 5.8, PROFILE_LEN - 0.01)) - 0.6;
    // Natural muddy bank past either end of the ghats.
    return lerp(GHAT_TOP, PROFILE_BOTTOM, smoothstep(-2, PROFILE_LEN + 4, v)) - 0.15;
  }
  return riverbedHeight(x, v);
}

// Height you actually stand on (includes the stair treads).
export function groundHeight(x, z) {
  const { v, seg } = bankCoords(x, z);
  if (seg && v > 0 && v < PROFILE_LEN) return ghatHeight(v);
  return terrainHeight(x, z);
}

export function waterDepthAt(x, z) {
  return WATER_LEVEL - groundHeight(x, z);
}

// ---------------------------------------------------------------------------------------------
// City layout

const HAVELI_COLORS = [
  '#ece3cf', '#ece3cf', '#f1e9d8', '#e0b25c', '#d9a647', '#e3b866', '#d88c6c', '#c9714f',
  '#9fbccc', '#a9c9b0', '#e7c3a0', '#d4c4a8', '#e9d6b0', '#c8b8d8', '#e5a37f', '#f0d9a8',
];

const ROWS = [
  { v0: -4, dMin: 12, dMax: 19, hMin: 13, hMax: 24 },
  { v0: -29, dMin: 12, dMax: 17, hMin: 10, hMax: 18 },
  { v0: -51, dMin: 12, dMax: 17, hMin: 9, hMax: 16 },
  { v0: -73, dMin: 12, dMax: 18, hMin: 8, hMax: 14 },
];
export const CITY_BACK_V = -95; // invisible wall behind the last row
export const LANES_V = [-26.5, -48.5, -70.5]; // centre lines of the lanes parallel to the river
export const MAIN_ROAD_X = 42; // Dashashwamedh road, cuts through every row
const CITY_X0 = -452;
const CITY_X1 = 452;

function buildingAt(rng, xc, row, w, d, h, opts = {}) {
  const f = frameAtX(xc);
  const vMid = row.v0 - d / 2;
  const p = frameToWorld(f, 0, vMid);
  return {
    kind: opts.kind || 'haveli',
    x: p.x,
    z: p.z,
    yaw: f.yaw,
    w,
    d,
    h,
    baseY: GHAT_TOP,
    color: opts.color || rng.pick(HAVELI_COLORS),
    row: row.index,
    floors: Math.max(2, Math.floor(h / 3.2)),
    leftOpen: !!opts.leftOpen,
    rightOpen: !!opts.rightOpen,
    roof: {
      chhatri: rng.chance(row.index === 0 ? 0.32 : 0.12),
      shrine: rng.chance(0.06),
      tank: rng.chance(0.15),
      setback: rng.chance(0.35),
    },
    balconyChance: row.index === 0 ? 0.35 : 0.18,
    seed: Math.floor(rng.next() * 1e9),
  };
}

function generateCity() {
  const rng = new RNG(1729);
  const buildings = [];
  const temples = [];

  // Special lots on the waterfront row: [xStart, xEnd, kind, extra]
  const specials = [];
  for (const g of GHAT_SEGMENTS) {
    const cx = (g.x0 + g.x1) / 2;
    if (g.palace) specials.push({ x0: cx - 30, x1: cx + 30, kind: g.palace });
  }
  specials.push({ x0: -224, x1: -196, kind: 'temple', style: 'kedar', size: 9 });
  specials.push({ x0: -392, x1: -372, kind: 'temple', style: 'ochre', size: 6.5 });
  specials.push({ x0: 14, x1: 32, kind: 'temple', style: 'sandstone', size: 6 });
  specials.push({ x0: 196, x1: 214, kind: 'temple', style: 'sandstone', size: 6 });
  specials.push({ x0: 300, x1: 318, kind: 'temple', style: 'white', size: 6.5 });
  // Gaps that connect the ghats to the city lanes (one at every ghat seam + the main road).
  const frontGaps = GHAT_SEGMENTS.slice(1).map((g) => ({ x0: g.x0 - 2.2, x1: g.x0 + 2.2 }));
  frontGaps.push({ x0: MAIN_ROAD_X - 5, x1: MAIN_ROAD_X + 5 });
  const mainRoad = { x0: MAIN_ROAD_X - 5, x1: MAIN_ROAD_X + 5 };
  // Inland special: a golden-spired temple behind Man Mandir.
  const goldenLot = { row: 2, x0: 98, x1: 126 };

  ROWS.forEach((row, ri) => {
    row.index = ri;
    let x = CITY_X0;
    let prevGap = true;
    while (x < CITY_X1) {
      // Forced gaps.
      const gaps = ri === 0 ? frontGaps : [mainRoad];
      const gap = gaps.find((gp) => x >= gp.x0 - 0.01 && x < gp.x1);
      if (gap) {
        x = gap.x1;
        prevGap = true;
        if (buildings.length && buildings[buildings.length - 1].row === ri) buildings[buildings.length - 1].rightOpen = true;
        continue;
      }
      if (ri === 0) {
        const sp = specials.find((s) => x >= s.x0 - 0.01 && x < s.x1);
        if (sp) {
          const w = sp.x1 - sp.x0;
          const xc = (sp.x0 + sp.x1) / 2;
          if (sp.kind === 'temple') {
            const f = frameAtX(xc);
            const p = frameToWorld(f, 0, -4 - sp.size * 0.95);
            temples.push({ x: p.x, z: p.z, yaw: f.yaw, size: sp.size, style: sp.style, baseY: GHAT_TOP, ghatFacing: true });
          } else {
            const b = buildingAt(rng, xc, row, w, sp.kind === 'fort' ? 20 : 19, sp.kind === 'fort' ? 19 : rng.range(23, 27), {
              kind: sp.kind,
              color: sp.kind === 'fort' ? '#c9a77a' : '#d8b98c',
              leftOpen: prevGap,
            });
            b.roof = { chhatri: false, shrine: false, tank: false, setback: false };
            buildings.push(b);
          }
          x = sp.x1;
          prevGap = sp.kind === 'temple';
          continue;
        }
      }
      if (ri === goldenLot.row && x >= goldenLot.x0 - 0.01 && x < goldenLot.x1) {
        const xc = (goldenLot.x0 + goldenLot.x1) / 2;
        const f = frameAtX(xc);
        const p = frameToWorld(f, 0, row.v0 - 9);
        temples.push({ x: p.x, z: p.z, yaw: f.yaw, size: 9, style: 'gold', baseY: GHAT_TOP, ghatFacing: true });
        x = goldenLot.x1;
        prevGap = true;
        continue;
      }
      // Ordinary lot.
      let w = ri === 0 ? rng.range(13, 28) : rng.range(10, 22);
      // Don't run into the next forced gap / special.
      const nextStops = [...(ri === 0 ? frontGaps : [mainRoad]), ...(ri === 0 ? specials : [])]
        .map((s) => s.x0)
        .filter((s) => s > x + 0.01);
      if (ri === goldenLot.row && goldenLot.x0 > x + 0.01) nextStops.push(goldenLot.x0);
      const nextStop = Math.min(CITY_X1, ...nextStops);
      if (x + w > nextStop - 6) w = nextStop - x;
      if (w < 4) {
        x = nextStop;
        continue;
      }
      const d = rng.range(row.dMin, row.dMax);
      const h = rng.range(row.hMin, row.hMax);
      const b = buildingAt(rng, x + w / 2, row, w, d, h, { leftOpen: prevGap });
      buildings.push(b);
      x += w;
      prevGap = false;
      // Random alleys between inland buildings.
      if (ri > 0 && rng.chance(0.3)) {
        b.rightOpen = true;
        x += 3.6;
        prevGap = true;
      }
    }
  });

  return { buildings, temples };
}

// ---------------------------------------------------------------------------------------------
// Gameplay placement

function landingPoint(g, u, landing, vOffset = 0) {
  const v = (landing.v0 + landing.v1) / 2 + vOffset;
  const p = ghatToWorld(g, u, v);
  return { x: p.x, y: landing.h0, z: p.z };
}

function generateFlames() {
  const out = [];
  const assi = ghatById('assi');
  out.push({ id: 'assi', type: 'pillar', ...landingPoint(assi, assi.width * 0.62, LANDING_1, 0.5), yaw: assi.yaw });
  const kedar = ghatById('kedar');
  {
    const p = ghatToWorld(kedar, kedar.width * 0.5 - 15, 1.8);
    out.push({ id: 'kedar', type: 'pillar', x: p.x, y: GHAT_TOP, z: p.z, yaw: kedar.yaw });
  }
  const dash = ghatById('dashashwamedh');
  out.push({ id: 'dashashwamedh', type: 'aarti', ...landingPoint(dash, dash.width * 0.5, LANDING_2), yaw: dash.yaw });
  const sc = ghatById('scindia');
  {
    const p = ghatToWorld(sc, 14, PROFILE_LEN + 7);
    out.push({ id: 'ratneshwar', type: 'sunken', x: p.x, y: 0.35, z: p.z, yaw: sc.yaw });
  }
  const pg = ghatById('panchganga');
  out.push({ id: 'panchganga', type: 'deepstambh', ...landingPoint(pg, pg.width * 0.45, LANDING_1, 0.4), yaw: pg.yaw });
  return out;
}

// Tulsi Akhara (the wrestlers' pit, Akhara.js) takes this stretch of Tulsi Ghat's first landing
export const AKHARA = { ghat: 'tulsi', u0: 7, u1: 18, v0: 0, v1: 0 };

function generateUmbrellas(rng) {
  const list = [];
  for (const g of GHAT_SEGMENTS) {
    for (let u = 5; u < g.width - 5; u += rng.range(6, 9)) {
      if (rng.chance(0.28)) continue;
      if (g.id === AKHARA.ghat && u > AKHARA.u0 - 4 && u < AKHARA.u1 + 3) continue;
      const p = landingPoint(g, u, LANDING_1, rng.range(-1.2, 1.2));
      list.push({ ...p, yaw: g.yaw + rng.range(-0.4, 0.4), tilt: rng.range(-0.08, 0.08) });
    }
    if (g.aarti || g.pyres) continue;
    for (let u = 8; u < g.width - 8; u += rng.range(9, 14)) {
      if (rng.chance(0.45)) continue;
      const p = landingPoint(g, u, LANDING_2, rng.range(-0.6, 0.6));
      list.push({ ...p, yaw: g.yaw + rng.range(-0.4, 0.4), tilt: rng.range(-0.08, 0.08) });
    }
  }
  return list;
}

function generateAartiPlatforms() {
  const g = ghatById('dashashwamedh');
  const list = [];
  for (let i = 0; i < 7; i++) {
    const p = landingPoint(g, g.width * 0.5 + (i - 3) * 5.6, LANDING_2);
    list.push({ ...p, yaw: g.yaw, central: i === 3 });
  }
  return list;
}

function generateBoats(rng) {
  const moored = [];
  for (const g of GHAT_SEGMENTS) {
    const n = g.aarti ? 4 : 2;
    for (let i = 0; i < n; i++) {
      const u = g.width * ((i + 0.5) / n) + rng.range(-6, 6);
      const p = ghatToWorld(g, u, PROFILE_LEN + rng.range(1.5, 5));
      moored.push({ x: p.x, z: p.z, yaw: g.yaw + rng.range(-0.25, 0.25) + (rng.chance(0.5) ? Math.PI : 0) });
    }
  }
  const dash = ghatById('dashashwamedh');
  const pb = ghatToWorld(dash, dash.width * 0.72, PROFILE_LEN - 0.6); // moored right at the steps
  return { moored, player: { x: pb.x, z: pb.z, yaw: dash.yaw } };
}

function generatePyres() {
  const g = ghatById('manikarnika');
  return [0.3, 0.45, 0.62, 0.78].map((t, i) => ({ ...landingPoint(g, g.width * t, i % 2 ? LANDING_1 : LANDING_2), yaw: g.yaw }));
}

function generateRudraksha(rng) {
  const beads = [];
  const add = (x, y, z, where) => beads.push({ x, y, z, where });
  // Ghat landings and terraces.
  for (const g of GHAT_SEGMENTS) {
    for (let i = 0; i < 3; i++) {
      const which = [PROFILE_SEGS[0], LANDING_1, LANDING_2][i];
      const u = rng.range(6, g.width - 6);
      const p = landingPoint(g, u, which, rng.range(-1, 1));
      add(p.x, p.y + 0.9, p.z, 'ghat');
    }
  }
  // City lanes (always clear by construction).
  for (let i = 0; i < 22; i++) {
    const v = rng.pick(LANES_V);
    const x = rng.range(CITY_X0 + 20, CITY_X1 - 20);
    const p = frameToWorld(frameAtX(x), 0, v);
    add(p.x, GHAT_TOP + 0.9, p.z, 'lane');
  }
  // Alleys that lead up from the ghats.
  for (const g of GHAT_SEGMENTS.slice(1, 9)) {
    const p = frameToWorld(frameAtX(g.x0), 0, -13);
    add(p.x, GHAT_TOP + 0.9, p.z, 'alley');
  }
  // Under water, near the ghat feet (dive for them).
  for (let i = 0; i < 22; i++) {
    const g = GHAT_SEGMENTS[i % GHAT_SEGMENTS.length];
    const p = ghatToWorld(g, rng.range(6, g.width - 6), PROFILE_LEN + rng.range(3, 22));
    add(p.x, terrainHeight(p.x, p.z) + 0.6, p.z, 'underwater');
  }
  // Far sand bank.
  for (let i = 0; i < 10; i++) {
    const x = rng.range(-360, 360);
    const f = frameAtX(x);
    const p = frameToWorld(f, 0, FAR_BANK_V + rng.range(25, 70));
    add(p.x, terrainHeight(p.x, p.z) + 0.9, p.z, 'sandbank');
  }
  // Around the sunken temple.
  const sc = ghatById('scindia');
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const c = ghatToWorld(sc, 14, PROFILE_LEN + 7);
    const x = c.x + Math.cos(a) * 7.5;
    const z = c.z + Math.sin(a) * 7.5;
    add(x, Math.max(terrainHeight(x, z) + 0.6, -3.5), z, 'sunken');
  }
  // Floating mid-river.
  for (let i = 0; i < 8; i++) {
    const x = -300 + i * 85 + rng.range(-20, 20);
    const p = frameToWorld(frameAtX(x), 0, rng.range(70, 200));
    add(p.x, 0.45, p.z, 'river');
  }
  return beads.slice(0, RUDRAKSHA_COUNT);
}

function generateTrees(rng) {
  const trees = [];
  // A few big peepal trees on ghat-top terraces and in lanes.
  // (v -1.7: the chabutra, up to 2.25 m in radius, sits between the house fronts at v -4
  // and the strollers' walkway on the open terrace)
  const spots = [
    ['assi', 0.2, -2.1],
    ['tulsi', 0.55, -2.1],
    ['scindia', 0.8, -2.1],
    ['panchganga', 0.85, -2.1],
  ];
  for (const [id, t, v] of spots) {
    const g = ghatById(id);
    const p = ghatToWorld(g, g.width * t, v);
    trees.push({ x: p.x, y: GHAT_TOP, z: p.z, scale: rng.range(0.9, 1.05) });
  }
  // lane trees: Props.js moves each to the side of its lane that has room (clear centre)
  for (let i = 0; i < 10; i++) {
    const x = rng.range(-420, 420);
    const lane = rng.pick(LANES_V);
    const p = frameToWorld(frameAtX(x), 0, lane);
    trees.push({ x: p.x, y: GHAT_TOP, z: p.z, scale: rng.range(0.7, 0.9), lane: { x, v: lane } });
  }
  return trees;
}

// Where pigeons gather on the ground (top terraces, where people scatter grain for them).
function generatePigeonSpots() {
  const spots = [
    ['dashashwamedh', 0.33, -1.6, 26],
    ['dashashwamedh', 0.78, 0.4, 18],
    ['panchganga', 0.6, -1.2, 18],
    ['scindia', 0.55, -1.8, 14],
    ['kedar', 0.7, -1.4, 14],
    ['assi', 0.35, -1.0, 16],
  ];
  return spots.map(([id, t, v, n]) => {
    const g = ghatById(id);
    const p = ghatToWorld(g, g.width * t, v);
    return { x: p.x, y: GHAT_TOP, z: p.z, n, ghat: id, yaw: g.yaw };
  });
}

export function generateLayout() {
  const rng = new RNG(108);
  const city = generateCity();
  const dash = ghatById('dashashwamedh');
  const start = landingPoint(dash, dash.width * 0.58, LANDING_1, 1.5);
  return {
    ghats: GHAT_SEGMENTS,
    buildings: city.buildings,
    temples: city.temples,
    flames: generateFlames(),
    umbrellas: generateUmbrellas(rng),
    aartiPlatforms: generateAartiPlatforms(),
    boats: generateBoats(rng),
    pyres: generatePyres(),
    trees: generateTrees(rng),
    rudraksha: generateRudraksha(rng),
    pigeonSpots: generatePigeonSpots(),
    playerStart: { x: start.x, y: start.y + 0.1, z: start.z, yaw: dash.yaw }, // facing the river
  };
}


AKHARA.v0 = LANDING_1.v0 + 0.6;
AKHARA.v1 = LANDING_1.v1 - 0.6;
