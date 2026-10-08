// Saves the clips baked by tools/retarget.html (needs `npm run dev` running and Chrome):
//   node tools/bake-mocap.mjs
import fs from 'node:fs';
const { chromium } = await import('playwright-core');
const exe = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const b = await chromium.launch({ executablePath: exe, headless: true });
const p = await b.newPage();
p.on('pageerror', (e) => console.error('page error:', e.message));
await p.goto('http://localhost:5173/tools/retarget.html');
await p.waitForFunction(() => window.__bake, null, { timeout: 120000 });
const json = await p.evaluate(() => window.__bake);
// 5 decimals is far below what the eye can see on a bone and halves the file
const slim = JSON.stringify(JSON.parse(json), (k, v) => (typeof v === 'number' ? Math.round(v * 1e5) / 1e5 : v));
fs.writeFileSync('public/assets/characters/prady-mocap.json', slim);
console.log(await p.evaluate(() => document.getElementById('info').textContent));
await b.close();
