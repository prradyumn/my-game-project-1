// Compose a music track with Google Lyria (through the Gemini API).
//   node tools/gemini-music.mjs --key-file <file> --out public/assets/audio/music-combat.mp3 \
//     --prompt "Indian classical battle music: fast tabla and dhol, …" [--model lyria-3.5]
// The key is read from GEMINI_API_KEY (or --key-file). Never put the key in game code.
// Needs ffmpeg: the result is loudness-normalised to -18 LUFS and saved as mp3.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), [])
);
const key = process.env.GEMINI_API_KEY || (args['key-file'] && fs.readFileSync(args['key-file'], 'utf8').trim());
if (!key) throw new Error('Set GEMINI_API_KEY (or pass --key-file)');
if (!args.prompt || !args.out) throw new Error('Need --prompt and --out');
const model = args.model || 'lyria-3.5';

const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
  body: JSON.stringify({ contents: [{ parts: [{ text: args.prompt }] }], generationConfig: { responseModalities: ['AUDIO'] } }),
});
const json = await res.json();
if (!res.ok) {
  console.error(JSON.stringify(json.error || json, null, 1).slice(0, 1500));
  process.exit(1);
}
const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
if (!part) {
  console.error('No audio in response:', JSON.stringify(json).slice(0, 800));
  process.exit(1);
}
const mime = part.inlineData.mimeType;
const tmp = path.join(os.tmpdir(), `lyria-${process.pid}`);
let inArgs;
if (/L16|pcm/i.test(mime)) {
  const rate = +(mime.match(/rate=(\d+)/)?.[1] || 48000);
  const ch = +(mime.match(/channels=(\d+)/)?.[1] || 2);
  fs.writeFileSync(tmp, Buffer.from(part.inlineData.data, 'base64'));
  inArgs = ['-f', 's16le', '-ar', String(rate), '-ac', String(ch), '-i', tmp];
} else {
  fs.writeFileSync(tmp, Buffer.from(part.inlineData.data, 'base64'));
  inArgs = ['-i', tmp];
}
fs.mkdirSync(path.dirname(args.out), { recursive: true });
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...inArgs, '-af', 'loudnorm=I=-18:TP=-1.5:LRA=11', '-ar', '44100', '-b:a', '160k', args.out]);
fs.unlinkSync(tmp);
const secs = +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', args.out]).toString().trim();
const text = json.candidates?.[0]?.content?.parts?.filter((p) => p.text).map((p) => p.text).join(' ');
console.log(`saved ${args.out} (${secs.toFixed(1)} s, ${mime}, ${model})${text ? `\n${text.slice(0, 400)}` : ''}`);
