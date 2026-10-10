// The game's own synthesized sounds (Web Audio, made in code) as WAV files for the trailer mix:
// rain, thunder x4, the Damaru, Om, the talwar's draw, sword hits / whooshes / parries (3 takes each).
// Needs the dev server (npm run dev). -> $TRAILER_WORK/sfx/*.wav
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { WORK } from './rig.mjs';
const out = path.join(WORK, 'sfx');
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const p = await b.newPage();
await p.goto('http://localhost:5173/favicon.svg').catch(() => {});
const res = await p.evaluate(async () => {
  const W = await import('/src/world/Weather.js');
  const Pw = await import('/src/gameplay/Powers.js');
  const C = await import('/src/gameplay/Combat.js');
  const ctx = new OfflineAudioContext(2, 44100, 44100);
  const wav = (buf) => {
    const ch = buf.numberOfChannels, n = buf.length, sr = buf.sampleRate;
    const dv = new DataView(new ArrayBuffer(44 + n * ch * 2));
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); dv.setUint32(4, 36 + n * ch * 2, true); ws(8, 'WAVE'); ws(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
    dv.setUint32(24, sr, true); dv.setUint32(28, sr * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true); ws(36, 'data'); dv.setUint32(40, n * ch * 2, true);
    const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
    let o = 44; for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { dv.setInt16(o, Math.max(-1, Math.min(1, data[c][i])) * 32767, true); o += 2; }
    let s = ''; const u8 = new Uint8Array(dv.buffer); for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode(...u8.subarray(i, i + 32768)); return btoa(s);
  };
  const r = { rain: wav(W.synthRain(ctx)), damaru: wav(Pw.synthDamaru(ctx)), om: wav(Pw.synthOm(ctx)), draw: wav(C.synthDraw(ctx)) };
  for (let i = 0; i < 4; i++) r[`thunder${i}`] = wav(W.synthThunder(ctx));
  for (const [n, f] of [['bhit', C.synthBladeHit], ['bwhoosh', C.synthBladeWhoosh], ['whoosh', C.synthWhoosh], ['parry', C.synthParry], ['bodyhit', C.synthBodyHit], ['thump', C.synthThump]]) for (let i = 0; i < 3; i++) r[n + i] = wav(f(ctx));
  return r;
});
for (const [k, v] of Object.entries(res)) fs.writeFileSync(path.join(out, `${k}.wav`), Buffer.from(v, 'base64'));
console.log(Object.keys(res).length, 'sounds ->', out);
await b.close();
