// Saves the clips baked by tools/retarget.html (needs `npm run dev` running and Chrome):
//   node tools/bake-mocap.mjs          -> public/assets/characters/prady-mocap.json
//   node tools/bake-mocap.mjs moves    -> public/assets/characters/prady-moves.json (traversal)
//   node tools/bake-mocap.mjs moves2   -> public/assets/characters/prady-moves2.json (ledge hang)
import fs from 'node:fs';
const { chromium } = await import('playwright-core');
const exe = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const b = await chromium.launch({ executablePath: exe, headless: true });
const p = await b.newPage();
p.on('pageerror', (e) => console.error('page error:', e.message));
const set = process.argv[2] || '';
await p.goto(`http://localhost:5173/tools/retarget.html${set ? `?set=${set}` : ''}`);
await p.waitForFunction(() => window.__bake, null, { timeout: 120000 });
const json = await p.evaluate(() => window.__bake);
// 5 decimals is far below what the eye can see on a bone and halves the file
const slim = JSON.stringify(JSON.parse(json), (k, v) => (typeof v === 'number' ? Math.round(v * 1e5) / 1e5 : v));
const outFile = { moves: 'public/assets/characters/prady-moves.json', moves2: 'public/assets/characters/prady-moves2.json' }[set] || 'public/assets/characters/prady-mocap.json';
fs.writeFileSync(outFile, slim);
console.log(await p.evaluate(() => document.getElementById('info').textContent));
await b.close();
