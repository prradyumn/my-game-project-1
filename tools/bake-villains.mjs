// Saves the motions carried onto a villain body by tools/villains.html (needs `npm run dev`):
//   node tools/bake-villains.mjs rakshasa [glb]   -> source-assets/villains/rakshasa-motions.json
import fs from 'node:fs';
const { chromium } = await import('playwright-core');
const v = process.argv[2] || 'rakshasa';
const glb = process.argv[3];
const b = await chromium.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage();
p.on('pageerror', (e) => console.error('page error:', e.message));
await p.goto(`http://localhost:5173/tools/villains.html?v=${v}${glb ? `&src=${encodeURIComponent(glb)}` : ''}`);
await p.waitForFunction(() => window.__bake, null, { timeout: 180000 });
const json = await p.evaluate(() => window.__bake);
const slim = JSON.stringify(JSON.parse(json), (k, val) => (typeof val === 'number' ? Math.round(val * 1e5) / 1e5 : val));
const out = `source-assets/villains/${v}-motions.json`;
fs.writeFileSync(out, slim);
console.log(await p.evaluate(() => document.getElementById('info').textContent), `-> ${out} (${(slim.length / 1024).toFixed(0)} KB)`);
await b.close();
