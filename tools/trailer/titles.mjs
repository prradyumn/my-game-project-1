// Title cards as transparent PNG sequences (30 fps): node titles.mjs
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { WORK } from './rig.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const CARDS = [
  { name: 'ingame', card: 'ingame', dur: 2.6, o: { fadeOut: 0.7 } },
  { name: 'slam1', card: 'slam', dur: 1.0, o: { text: 'One blade', fadeOut: 0.12 } },
  { name: 'slam2', card: 'slam', dur: 1.0, o: { text: 'Five flames', fadeOut: 0.12 } },
  { name: 'slam3', card: 'slam', dur: 1.0, o: { text: 'One city of light', fadeOut: 0.12 } },
  { name: 'title', card: 'title', dur: 7.6, o: { fadeOut: 1.2, tagAt: 3.0 } },
];
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.goto('file://' + path.join(here, 'titles.html'));
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(800);
for (const c of CARDS) {
  const dir = path.join(WORK, 'titles', c.name);
  fs.mkdirSync(dir, { recursive: true });
  const n = Math.round(c.dur * 30);
  for (let i = 0; i < n; i++) {
    await p.evaluate(([card, t, dur, o]) => window.render(card, t, dur, o), [c.card, i / 30, c.dur, c.o]);
    await p.screenshot({ path: path.join(dir, `${String(i).padStart(4, '0')}.png`), omitBackground: true });
  }
  console.log(c.name, n);
}
const fonts = await p.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family));
console.log('fonts', [...new Set(fonts)].join(', '));
await b.close();
