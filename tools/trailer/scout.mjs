// node scout.mjs <outdir> shot1 shot2 ...  -> stills at 0 / 50 / 100 % (N=5: five) and one sheet per shot
import { open } from './rig.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const [out, ...names] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const s = await open({ w: 1280, h: 720 });
await s.begin();
await s.lib();
await s.manual();
for (const n of names) {
  try {
    const N = +(process.env.N || 3); const files = await s.scout(n, out, Array.from({ length: N }, (_, i) => i / (N - 1)));
    execFileSync('ffmpeg', ['-v', 'error', '-y', ...files.flatMap((f) => ['-i', f]), '-filter_complex', `${files.map((_, i) => `[${i}]`).join('')}hstack=inputs=${files.length},scale=1920:-1`, `${out}/${n}.sheet.jpg`]);
    console.log('ok', n);
  } catch (e) { console.log('FAIL', n, e.message.split('\n')[0]); }
}
console.log(s.errs.slice(0, 8).join('\n'));
await s.close();
