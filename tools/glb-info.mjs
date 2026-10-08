// Print the node tree, skin joints and animations of a .glb (no dependencies).
//   node tools/glb-info.mjs path/to/file.glb
import fs from 'node:fs';
const buf = fs.readFileSync(process.argv[2]);
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
const nodes = gltf.nodes || [];
const print = (i, depth) => {
  const n = nodes[i];
  const extra = [n.mesh !== undefined ? 'mesh' : '', n.skin !== undefined ? 'skin' : '', n.scale ? `scale=${n.scale.map((v) => +v.toFixed(4))}` : '', n.rotation ? `rot=${n.rotation.map((v) => +v.toFixed(3))}` : '', n.translation ? `t=${n.translation.map((v) => +v.toFixed(3))}` : ''].filter(Boolean).join(' ');
  console.log(`${'  '.repeat(depth)}${n.name} ${extra}`);
  for (const c of n.children || []) print(c, depth + 1);
};
for (const s of gltf.scenes || []) for (const r of s.nodes) print(r, 0);
for (const a of gltf.animations || []) console.log('anim', a.name, a.channels.length, 'channels');
