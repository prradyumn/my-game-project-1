// the strongest low drum hits of a section (local maxima of low-band onset strength, >= gap apart)
import { execFileSync } from 'node:child_process';
const [file, from, to, gap = '0.7'] = process.argv.slice(2);
const sr = 11025, hop = Math.round(sr * 0.005);
const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', from, '-t', String(+to - +from), '-i', file, '-ac', '1', '-ar', String(sr), '-af', 'lowpass=f=140,lowpass=f=140', '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
const a = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
const e = []; for (let i = 0; i + hop <= a.length; i += hop) { let s = 0; for (let j = 0; j < hop; j++) s += a[i + j] ** 2; e.push(10 * Math.log10(s / hop + 1e-12)); }
const sm = e.map((_, i) => (e[i] + (e[i - 1] ?? e[i]) + (e[i + 1] ?? e[i])) / 3);
const o = sm.map((v, i) => (i > 2 ? Math.max(0, v - sm[i - 3]) : 0));
const W = Math.round(+gap / 0.005);
const peaks = [];
for (let i = 1; i < o.length - 1; i++) { let m = true; for (let k = Math.max(0, i - W); k < Math.min(o.length, i + W); k++) if (o[k] > o[i]) { m = false; break; } if (m && o[i] > 3) peaks.push([+(+from + i * 0.005).toFixed(3), +o[i].toFixed(1), +sm[i + 6]?.toFixed(1)]); }
console.log(peaks.map(([t, s, l]) => `${t}(${s},${l})`).join(' '));
