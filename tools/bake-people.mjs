// Builds public/assets/people/*.glb from tools/people.html (needs `npm run dev` and Chrome):
//   node tools/bake-people.mjs [AvatarId]
// Raw exports land in source-assets/people-raw/, then gltf-transform welds/quantises the meshes
// (meshopt) and converts textures to WebP, so each person ships at under 1 MB.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const { chromium } = await import('playwright-core');
// node tools/bake-people.mjs [AvatarId | pack | pack:m]
const arg = process.argv[2] || '';
const only = arg.startsWith('pack') ? `?pack=${arg.split(':')[1] || 'all'}` : arg ? `?only=${arg}` : '';
const exe = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const b = await chromium.launch({ executablePath: exe, headless: true });
const p = await b.newPage();
p.on('pageerror', (e) => console.error('page error:', e.message));
await p.goto(`http://localhost:5173/tools/people.html${only}`);
await p.waitForFunction(() => window.__done, null, { timeout: 600000 });
const res = await p.evaluate(() => window.__people || {});
console.log(await p.evaluate(() => document.getElementById('o').textContent));
await b.close();

fs.mkdirSync('source-assets/people-raw', { recursive: true });
fs.mkdirSync('public/assets/people', { recursive: true });
const gt = (...args) => execFileSync('npx', ['--yes', '@gltf-transform/cli@4', ...args], { stdio: 'pipe' });
for (const [id, b64] of Object.entries(res)) {
  const raw = `source-assets/people-raw/${id}.glb`;
  const tmp = `source-assets/people-raw/${id}.meshopt.glb`;
  const out = `public/assets/people/${id}.glb`;
  fs.writeFileSync(raw, Buffer.from(b64, 'base64'));
  gt('meshopt', raw, tmp);
  gt('webp', tmp, out, '--quality', '88');
  fs.rmSync(tmp);
  console.log(`${id}: ${(fs.statSync(raw).size / 1e6).toFixed(2)} MB raw -> ${(fs.statSync(out).size / 1e6).toFixed(2)} MB`);
}
