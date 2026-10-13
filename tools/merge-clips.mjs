// Take chosen clips from one baked clip file into another, writing a new file:
//   node tools/merge-clips.mjs <base.json> <from.json> <out.json> name1 name2 ...
// (base and out under public/assets/characters; from under source-assets/ue). Used to keep, clip by clip, whichever retarget is
// better: the base (tools/retarget.js from the CMU BVH) or Unreal's (the same takes through
// UE 5.8's IK Retargeter, `node tools/bake-mocap.mjs <set> ue`), or video capture
// (source-assets/m2mr/prady-video.json). A name the base lacks is added as a new clip. The
// clip's root motion entry comes with it. Neither input is changed.
import fs from 'node:fs';

const dir = 'public/assets/characters';
const [baseName, fromName, outName, ...names] = process.argv.slice(2);
if (!baseName || !fromName || !outName) {
  console.log('usage: node tools/merge-clips.mjs <base.json> <from.json> <out.json> name ...');
  process.exit(2);
}
if (outName === baseName || outName === fromName) throw new Error('write to a new file');
const base = JSON.parse(fs.readFileSync(`${dir}/${baseName}`, 'utf8'));
// (a bare name: source-assets/ue/; a path with a slash: from the repo root, e.g. source-assets/m2mr/prady-video.json)
const from = JSON.parse(fs.readFileSync(fromName.includes('/') ? fromName : `source-assets/ue/${fromName}`, 'utf8'));
const taken = [];
for (const n of names) {
  const c = from.clips.find((x) => x.name === n);
  const i = base.clips.findIndex((x) => x.name === n);
  if (!c) throw new Error(`no clip ${n} in ${fromName}`);
  // (a clip the base lacks is added: a new move)
  if (i < 0) base.clips.push(c);
  else base.clips[i] = c;
  base.rootMotion ||= {};
  if (from.rootMotion?.[n]) base.rootMotion[n] = from.rootMotion[n];
  else delete base.rootMotion[n];
  taken.push(n);
}
base.source = `${base.source}; from ${fromName.includes('m2mr') ? 'video capture (Motion2MixamoRig / GVHMR, Mixkit clips)' : "Unreal Engine 5.8's IK Retargeter"}: ${taken.join(', ') || 'none'}`;
fs.writeFileSync(`${dir}/${outName}`, JSON.stringify(base));
console.log(`${outName}: ${base.clips.length} clips, ${taken.length} from ${fromName}`);
