// Ask Gemini to watch a video (with its sound) and answer: node watch.mjs <key-file> <video> "<question>" [model]
import fs from 'node:fs';
const [keyFile, file, q, model = 'gemini-2.5-pro'] = process.argv.slice(2);
const key = fs.readFileSync(keyFile, 'utf8').trim();
const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
  body: JSON.stringify({ contents: [{ parts: [{ inlineData: { mimeType: 'video/mp4', data: fs.readFileSync(file).toString('base64') } }, { text: q }] }] }),
});
const j = await res.json();
console.log(j.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || JSON.stringify(j).slice(0, 800));
