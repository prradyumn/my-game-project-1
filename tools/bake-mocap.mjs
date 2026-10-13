// Saves the clips baked by tools/retarget.html (needs `npm run dev` running and Chrome):
//   node tools/bake-mocap.mjs          -> public/assets/characters/prady-mocap.json
//   node tools/bake-mocap.mjs moves    -> public/assets/characters/prady-moves.json (traversal)
//   node tools/bake-mocap.mjs moves2   -> public/assets/characters/prady-moves2.json (ledge hang)
//   node tools/bake-mocap.mjs moves3   -> public/assets/characters/prady-moves3.json (turns, stop, idle)
//   ... ue  (e.g. `node tools/bake-mocap.mjs moves ue`, or `node tools/bake-mocap.mjs - ue`): the same
//   clips from Unreal's retarget of each take (UE_EXPORT, default ~/Desktop/PradyAnim/Export), to a
//   new file in source-assets/ue/ (prady-mocap-ue.json, prady-moves-ue.json ...), not shipped
import fs from 'node:fs';
const { chromium } = await import('playwright-core');
const exe = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const b = await chromium.launch({ executablePath: exe, headless: true });
const p = await b.newPage();
p.on('pageerror', (e) => console.error('page error:', e.message));
const set = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : '';
const ue = process.argv[3] === 'ue';
if (ue) {
  const dir = process.env.UE_EXPORT || `${process.env.HOME}/Desktop/PradyAnim/Export`;
  await p.route('**/ue-export/**', (r) => r.fulfill({ path: `${dir}/${decodeURIComponent(new URL(r.request().url()).pathname.split('/').pop())}`, contentType: 'model/gltf-binary' }));
}
const q = [set && `set=${set}`, ue && 'src=ue'].filter(Boolean).join('&');
await p.goto(`http://localhost:5173/tools/retarget.html${q ? `?${q}` : ''}`);
await p.waitForFunction(() => window.__bake, null, { timeout: 120000 });
const json = await p.evaluate(() => window.__bake);
// 5 decimals is far below what the eye can see on a bone and halves the file
const slim = JSON.stringify(JSON.parse(json), (k, v) => (typeof v === 'number' ? Math.round(v * 1e5) / 1e5 : v));
let outFile = ({ moves: 'public/assets/characters/prady-moves.json', moves2: 'public/assets/characters/prady-moves2.json', moves3: 'public/assets/characters/prady-moves3.json' }[set] || 'public/assets/characters/prady-mocap.json');
// (Unreal's versions are material to pick from, not shipped: source-assets/ue/, then tools/merge-clips.mjs)
if (set === 'video') outFile = 'source-assets/m2mr/prady-video.json';
else if (set === 'videoPreview') outFile = 'source-assets/m2mr/prady-video-preview.json';
else if (ue) outFile = outFile.replace('public/assets/characters/', 'source-assets/ue/').replace('.json', '-ue.json');
fs.writeFileSync(outFile, slim);
console.log(await p.evaluate(() => document.getElementById('info').textContent));
await b.close();
