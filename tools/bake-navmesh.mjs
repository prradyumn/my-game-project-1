// Bakes the walkable navmesh of Kashi (needs `npm run dev` running and Chrome):
//   node tools/bake-navmesh.mjs   -> public/assets/nav/kashi.navmesh.bin + kashi.navmesh.json
// Re-run it whenever the world's layout or colliders change: the game checks the signature in the
// .json against its own colliders and walks without the navmesh when they differ.
import fs from 'node:fs';
const { chromium } = await import('playwright-core');
const exe = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const b = await chromium.launch({ executablePath: exe, headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 640, height: 400 } });
p.on('pageerror', (e) => console.error('page error:', e.message));
await p.goto('http://localhost:5173/', { timeout: 180000 });
await p.waitForFunction(() => window.__game && window.__game.state === 'title', null, { timeout: 180000 });
const r = await p.evaluate(async () => (await import('/tools/navmesh-bake.js')).bake(window.__game));
fs.mkdirSync('public/assets/nav', { recursive: true });
fs.writeFileSync('public/assets/nav/kashi.navmesh.bin', Buffer.from(r.b64, 'base64'));
fs.writeFileSync('public/assets/nav/kashi.navmesh.json', JSON.stringify(r.meta, null, 1));
console.log('navmesh', JSON.stringify(r.stats));
await b.close();
