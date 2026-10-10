// Percussive onsets of a track (low-band energy flux, 10 ms hops): strong hits with their strength.
// node onsets.mjs file.mp3 [from] [to]
import { execFileSync } from 'node:child_process';
const [file, from = '0', to = '999'] = process.argv.slice(2);
const sr = 11025, hop = Math.round(sr * 0.01);
const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(sr), '-af', 'lowpass=f=180', '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
const a = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
const e = [];
for (let i = 0; i + hop <= a.length; i += hop) { let s = 0; for (let j = 0; j < hop; j++) s += a[i + j] ** 2; e.push(Math.log10(s / hop + 1e-9)); }
const flux = e.map((v, i) => (i ? Math.max(0, v - e[i - 1]) : 0));
// smooth and pick local maxima above an adaptive threshold
const win = 50;
const out = [];
for (let i = 1; i < flux.length - 1; i++) {
  const t = i * 0.01;
  if (t < +from || t > +to) continue;
  let m = 0; for (let k = Math.max(0, i - win); k < Math.min(flux.length, i + win); k++) m += flux[k];
  m /= 2 * win;
  if (flux[i] > flux[i - 1] && flux[i] >= flux[i + 1] && flux[i] > m * 3 && flux[i] > 0.25) out.push([+t.toFixed(2), +flux[i].toFixed(2), +e[i + 3].toFixed(2)]);
}
console.log(out.map(([t, f, l]) => `${t}${f > 0.8 ? '!' : ''}(${f})`).join(' '));
