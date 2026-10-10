// tempo + beat phase of a section: onset-strength autocorrelation, then the phase that best fits
import { execFileSync } from 'node:child_process';
const [file, from, to] = process.argv.slice(2).map((x, i) => (i ? +x : x));
const sr = 11025, hop = Math.round(sr * 0.005);
const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(from), '-t', String(to - from), '-i', file, '-ac', '1', '-ar', String(sr), '-af', 'lowpass=f=250', '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
const a = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
const e = []; for (let i = 0; i + hop <= a.length; i += hop) { let s = 0; for (let j = 0; j < hop; j++) s += a[i + j] ** 2; e.push(Math.log10(s / hop + 1e-9)); }
const o = e.map((v, i) => (i ? Math.max(0, v - e[i - 1]) : 0));
let best = [];
for (let bpm = 70; bpm <= 180; bpm += 0.25) {
  const lag = 60 / bpm / 0.005; let s = 0, n = 0;
  for (let i = 0; i + lag * 4 < o.length; i++) { const l = Math.round(lag); s += o[i] * (o[i + l] + 0.5 * o[i + 2 * l]); n++; }
  best.push([bpm, s / n]);
}
best.sort((x, y) => y[1] - x[1]);
console.log('tempo candidates', best.slice(0, 6).map(([b, s]) => `${b}(${s.toFixed(3)})`).join(' '));
const bpm = +process.argv[5] || best[0][0];
const P = 60 / bpm;
let bp = [0, -1];
for (let ph = 0; ph < P; ph += 0.005) { let s = 0; for (let t = ph; t < to - from; t += P) { const i = Math.round(t / 0.005); s += Math.max(o[i] || 0, o[i + 1] || 0, o[i - 1] || 0); } if (s > bp[1]) bp = [ph, s]; }
console.log(`bpm ${bpm} beat ${P.toFixed(4)} s, first beat at ${(from + bp[0]).toFixed(3)}`);
// downbeat: which of 4 beat phases carries the most energy
const acc = [0, 0, 0, 0];
for (let k = 0, t = bp[0]; t < to - from; t += P, k++) { const i = Math.round(t / 0.005); acc[k % 4] += Math.max(o[i] || 0, o[i + 1] || 0, o[i - 1] || 0); }
console.log('beat-in-bar strength', acc.map((x) => x.toFixed(2)).join(' '));
