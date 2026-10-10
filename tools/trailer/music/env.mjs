// loudness (dB RMS) per window of an audio file: node env.mjs file.mp3 [win=0.5]
import { execFileSync } from 'node:child_process';
const [file, win = '0.5'] = process.argv.slice(2);
const sr = 8000, W = Math.round(sr * +win);
const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(sr), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
const a = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
const out = [];
for (let i = 0; i < a.length; i += W) { let s = 0, pk = 0; const n = Math.min(W, a.length - i); for (let j = 0; j < n; j++) { s += a[i + j] ** 2; pk = Math.max(pk, Math.abs(a[i + j])); } out.push([(i / sr), 10 * Math.log10(s / n + 1e-12)]); }
let line = '';
for (const [t, db] of out) { line += `${t.toFixed(1)}:${db.toFixed(0)} `; }
console.log(line);
