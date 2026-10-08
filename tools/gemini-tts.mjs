// Speak lines with Gemini TTS (voiced dialogue and narration for the chapters).
//   node tools/gemini-tts.mjs --key-file <file> --out public/assets/audio/voice/ch1-guru-01.mp3 \
//     --voice Charon --style "an old Banarasi priest, warm and slow" --text "…"
//   node tools/gemini-tts.mjs --key-file <file> --batch tools/voice-lines.json   (many lines; skips existing files)
// Batch file: [{ "out": "…mp3", "voice": "Charon", "style": "…", "text": "…" }, …]
// The key is read from GEMINI_API_KEY (or --key-file). Never put the key in game code.
// Needs ffmpeg (PCM -> mp3, loudness-normalised to -16 LUFS so every line sits at one level).
// Every line is checked by transcribing it back (Gemini Flash): a take that adds or drops words is
// generated again (up to 4 takes).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), [])
);
const key = process.env.GEMINI_API_KEY || (args['key-file'] && fs.readFileSync(args['key-file'], 'utf8').trim());
if (!key) throw new Error('Set GEMINI_API_KEY (or pass --key-file)');
// 2.5 Pro TTS takes the style as direction; the 3.x flash TTS models read the direction aloud
const model = args.model || 'gemini-2.5-pro-preview-tts';

const words = (t) => t.toLowerCase().replace(/[^a-z0-9\u0900-\u097f' ]+/g, ' ').split(/\s+/).filter(Boolean);
async function transcribe(file) {
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ parts: [{ inlineData: { mimeType: 'audio/mp3', data: fs.readFileSync(file).toString('base64') } }, { text: 'Transcribe this audio exactly, word for word. Output only the words spoken, spelling numbers as words.' }] }] }),
  });
  const j = await res.json();
  return j.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
}
// share of the script's words heard, and how many extra words were spoken
function match(script, heard) {
  const a = words(script);
  const b = words(heard);
  const bag = new Map();
  for (const w of b) bag.set(w, (bag.get(w) || 0) + 1);
  let hit = 0;
  for (const w of a) if (bag.get(w)) (hit++, bag.set(w, bag.get(w) - 1));
  return { recall: hit / Math.max(1, a.length), extra: b.length - hit };
}

async function speak({ out, voice = 'Charon', style = '', text }) {
  if (!out || !text) throw new Error('each line needs out + text');
  if (fs.existsSync(out) && !args.force) return console.log(`skip ${out}`);
  const prompt = style ? `Say in the voice of ${style}: ${text}` : text;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
        continue;
      }
      throw new Error(JSON.stringify(json.error || json).slice(0, 500));
    }
    const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!part) {
      // (an empty answer, finishReason OTHER, happens now and then: just ask again)
      console.log(`  no audio for ${path.basename(out)} (${json.candidates?.[0]?.finishReason}), retrying`);
      await new Promise((r) => setTimeout(r, 2500));
      continue;
    }
    // raw 16-bit little-endian PCM (rate in the mime type, e.g. audio/L16;codec=pcm;rate=24000)
    const rate = +(part.inlineData.mimeType.match(/rate=(\d+)/)?.[1] || 24000);
    const raw = path.join(os.tmpdir(), `tts-${process.pid}-${Date.now()}.pcm`);
    fs.writeFileSync(raw, Buffer.from(part.inlineData.data, 'base64'));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', raw, '-af', 'silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse,loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '44100', '-b:a', '96k', out]);
    fs.unlinkSync(raw);
    const secs = +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString().trim();
    if (!args['no-verify']) {
      const m = match(text.replace(/\d+/g, ''), (await transcribe(out)).replace(/\d+/g, ''));
      // (short lines with Hindi words: the transcriber spells them its own way, so be lenient)
      const n = words(text).length;
      if (m.recall < (n <= 12 ? 0.68 : 0.85) || m.extra > Math.max(3, n * 0.15)) {
        console.log(`  retake ${path.basename(out)}: heard ${Math.round(m.recall * 100)}% of the words, ${m.extra} extra`);
        fs.unlinkSync(out);
        continue;
      }
    }
    console.log(`saved ${out} (${secs.toFixed(1)} s, ${voice})`);
    return secs;
  }
  throw new Error('gave up after retries: ' + out);
}

if (args.batch) {
  const lines = JSON.parse(fs.readFileSync(args.batch, 'utf8'));
  const failed = [];
  for (const l of lines) {
    try {
      await speak(l);
    } catch (e) {
      console.log(`FAILED ${l.out}: ${e.message.slice(0, 200)}`);
      failed.push(l.out);
    }
  }
  if (failed.length) console.log(`${failed.length} lines failed (run again to retry them): ${failed.join(', ')}`);
} else await speak({ out: args.out, voice: args.voice, style: args.style, text: args.text });
