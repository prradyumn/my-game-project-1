// Voices every line of the chapters (src/gameplay/chapters/lines.js) with Gemini TTS, each in
// its speaker's voice and manner (CAST), into public/assets/audio/voice/<key>.mp3. Existing files
// are kept (delete one to redo it). The darker voices (Andhaka) are pitched down afterwards.
//   node tools/voice-lines.mjs --key-file <file> [--only ch3]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CAST, LINES } from '../src/gameplay/chapters/lines.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []));
const OUT = 'public/assets/audio/voice';
const batch = [];
for (const [key, [who, text]] of Object.entries(LINES)) {
  if (args.only && !key.startsWith(args.only)) continue;
  const c = CAST[who];
  if (!c) throw new Error(`no cast for ${who}`);
  batch.push({ out: `${OUT}/${key}.mp3`, voice: c.voice, style: c.style, text, pitch: c.pitch });
}
const tmp = path.join(process.env.TMPDIR || '/tmp', `voice-batch-${process.pid}.json`);
fs.writeFileSync(tmp, JSON.stringify(batch.filter((b) => !fs.existsSync(b.out))));
execFileSync('node', ['tools/gemini-tts.mjs', '--batch', tmp, ...(args['key-file'] ? ['--key-file', args['key-file']] : [])], { stdio: 'inherit' });
// pitch the demon down (and give it a little room), once
for (const b of batch) {
  if (!b.pitch || !fs.existsSync(b.out)) continue;
  const mark = `${b.out}.pitched`;
  if (fs.existsSync(mark)) continue;
  const t = `${b.out}.tmp.mp3`;
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', b.out, '-af', `asetrate=44100*${b.pitch},aresample=44100,atempo=${(1 / b.pitch).toFixed(3)},aecho=0.8:0.6:60:0.25,loudnorm=I=-16:TP=-1.5`, '-b:a', '96k', t]);
  fs.renameSync(t, b.out);
  fs.writeFileSync(mark, '');
}
console.log(`${batch.length} lines voiced in ${OUT}`);
