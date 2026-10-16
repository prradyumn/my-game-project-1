// Fetches Mixamo motion capture (Adobe; royalty-free for use inside a game, not for resale as
// animation files) with the user's own Mixamo sign-in, into source-assets/mixamo/clips/<name>.fbx
// (Y Bot, no skin, 30 fps). Then tools/retarget.js ?set=mixamo bakes them onto Prady, and
// tools/villains.js uses some for the brutes.
//
//   1  open a normal Chrome window with its own profile and a debugging port (sign-in pages refuse
//      a browser started under automation):
//        open -na "Google Chrome" --args --user-data-dir=/tmp/mixamo-profile --remote-debugging-port=9333 https://www.mixamo.com/#/
//   2  sign in there by hand, then:
//        node tools/mixamo-fetch.mjs search "braced hang" "kip up"     (lists motions and their ids)
//        node tools/mixamo-fetch.mjs get kipUp=<id> mutantWalk=<id>=inplace
// The session's token never leaves the page: every API call is made from inside it.
import fs from 'node:fs';
const { chromium } = await import('playwright-core');
const [phase, ...args] = process.argv.slice(2);
const OUT = new URL('../source-assets/mixamo/clips', import.meta.url).pathname.replace(/%20/g, ' ');
// (a normal Chrome window, its own profile, opened with a debugging port: sign-in pages refuse a
// browser started under automation, so the user signs in by hand and this attaches afterwards)
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const ctx = browser.contexts()[0];
let p = ctx.pages().find((x) => x.url().includes('mixamo.com')) || ctx.pages()[0];
if (!p.url().includes('mixamo.com')) await p.goto('https://www.mixamo.com/#/', { timeout: 120000 });
const authed = async () => {
  for (const pg of ctx.pages()) {
    if (!pg.url().includes('mixamo.com')) continue;
    const ok = await pg.evaluate(() => !!localStorage.getItem('access_token')).catch(() => false);
    if (ok) return true;
  }
  return false;
};
if (phase === 'login') {
  console.log('waiting for sign-in in the opened window…');
  for (let i = 0; i < 900 && !(await authed()); i++) await p.waitForTimeout(1000);
  console.log((await authed()) ? 'signed in' : 'not signed in (timed out)');
  process.exit(0);
}
if (!(await authed())) { console.log('NOT SIGNED IN — run the login phase'); process.exit(1); }
p = ctx.pages().find((x) => x.url().includes('mixamo.com'));
const api = (path, opts = {}) => p.evaluate(async ([path, opts]) => {
  const r = await fetch('https://www.mixamo.com/api/v1/' + path, { ...opts, headers: { Authorization: 'Bearer ' + localStorage.getItem('access_token'), 'X-Api-Key': 'mixamo2', 'Content-Type': 'application/json', Accept: 'application/json' } });
  const t = await r.text();
  try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, text: t.slice(0, 300) }; }
}, [path, opts]);
if (phase === 'search') {
  for (const q of args) {
    const r = await api(`products?page=1&limit=24&order=&type=Motion%2CMotionPack&query=${encodeURIComponent(q)}`);
    const rows = (r.json?.results || []).map((x) => `  ${x.id}  ${x.name}${x.description ? ' — ' + x.description : ''}${x.type === 'MotionPack' ? ' [PACK]' : ''}`);
    console.log(`== ${q} (${r.status})\n${rows.join('\n')}`);
  }
}
if (phase === 'get') {
  fs.mkdirSync(OUT, { recursive: true });
  const ch = await api('products?page=1&limit=12&order=&type=Character&query=y%20bot');
  const ybot = (ch.json?.results || []).find((x) => /^y bot$/i.test(x.name)) || ch.json?.results?.[0];
  console.log('character', ybot?.name, ybot?.id);
  for (const a of args) {
    const [name, id, inplace] = a.split('=');
    const file = `${OUT}/${name}.fbx`;
    if (fs.existsSync(file)) { console.log('have', name); continue; }
    const d = await api(`products/${id}?similar=0&character_id=${ybot.id}`);
    const g = d.json?.details?.gms_hash;
    if (!g) { console.log('no details', name, d.status, d.text || ''); continue; }
    const gms = { ...g, params: (g.params || []).map((x) => x[1]).join(','), inplace: inplace === 'inplace' ? true : g.inplace };
    const ex = await api('animations/export', { method: 'POST', body: JSON.stringify({ character_id: ybot.id, gms_hash: [gms], preferences: { format: 'fbx7_2019', skin: 'false', fps: '30', reducekf: '0' }, product_name: d.json.description || d.json.name, type: 'Motion' }) });
    if (ex.status >= 300) { console.log('export failed', name, ex.status, JSON.stringify(ex.json || ex.text).slice(0, 200)); continue; }
    let url = null;
    for (let i = 0; i < 90 && !url; i++) {
      await p.waitForTimeout(2000);
      const m = await api(`characters/${ybot.id}/monitor`);
      if (m.json?.status === 'completed') url = m.json.job_result;
      else if (m.json?.status === 'failed') { console.log('failed', name, JSON.stringify(m.json).slice(0, 200)); break; }
    }
    if (!url) { console.log('no result', name); continue; }
    // (a pre-signed storage link: fetched from here, the page's origin may not read it)
    const res = await fetch(url);
    if (!res.ok) { console.log('download failed', name, res.status); continue; }
    const buf = new Uint8Array(await res.arrayBuffer());
    fs.writeFileSync(file, buf);
    console.log('saved', name, (buf.length / 1024).toFixed(0) + ' KB');
  }
}
process.exit(0);
