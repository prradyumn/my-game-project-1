// Sanity checks for the world layout (runs in Node, no browser needed):
//   npm run check:world
import { generateLayout, groundHeight, terrainHeight, PROFILE_LEN, PROFILE_BOTTOM, GHAT_SEGMENTS } from '../src/world/WorldLayout.js';

const L = generateLayout();
console.log('profile length', PROFILE_LEN.toFixed(2), 'bottom', PROFILE_BOTTOM.toFixed(2));
console.log('ghats', GHAT_SEGMENTS.map((g) => `${g.id}:${g.width.toFixed(1)}m`).join(' '));
const kinds = {};
for (const b of L.buildings) kinds[b.kind] = (kinds[b.kind] || 0) + 1;
console.log('buildings', L.buildings.length, kinds, 'temples', L.temples.length);
console.log('umbrellas', L.umbrellas.length, 'boats', L.boats.moored.length, 'trees', L.trees.length);
const where = {};
for (const r of L.rudraksha) where[r.where] = (where[r.where] || 0) + 1;
console.log('rudraksha', L.rudraksha.length, where);
console.log('flames', L.flames.map((f) => `${f.id}@(${f.x.toFixed(0)},${f.y.toFixed(1)},${f.z.toFixed(0)})`).join(' '));
console.log('start', L.playerStart);

// Buildings must not overlap each other (same row), nor sit on the ghats.
let overlaps = 0;
const rows = {};
for (const b of L.buildings) (rows[b.row] ||= []).push(b);
for (const list of Object.values(rows)) {
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1];
    const b = list[i];
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    if (dist < (a.w + b.w) / 2 - 0.6) overlaps++;
  }
}
console.log('row overlaps', overlaps);

// Underwater beads must actually be under water, land beads above.
let bad = 0;
for (const r of L.rudraksha) {
  const g = groundHeight(r.x, r.z);
  if (r.y < g) bad++;
  if (r.where === 'underwater' && r.y > -0.5) bad++;
}
console.log('bad rudraksha', bad);
for (const [x, z] of [[0, 0], [42, -20], [42, 60], [42, 200], [42, 330], [-460, 0]]) {
  console.log(`h(${x},${z}) terrain=${terrainHeight(x, z).toFixed(2)} ground=${groundHeight(x, z).toFixed(2)}`);
}
