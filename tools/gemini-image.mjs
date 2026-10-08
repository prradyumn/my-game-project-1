// Generate an image (e.g. a tileable texture) with the Gemini API.
//   GEMINI_API_KEY=... node tools/gemini-image.mjs --out public/assets/textures/wood.png \
//     --prompt "Seamless tileable texture of ..." [--model gemini-3-pro-image] [--aspect 1:1] [--size 2K]
// The key is read from GEMINI_API_KEY (or --key-file). Never put the key in game code.
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), [])
);
const key = process.env.GEMINI_API_KEY || (args['key-file'] && fs.readFileSync(args['key-file'], 'utf8').trim());
if (!key) throw new Error('Set GEMINI_API_KEY (or pass --key-file)');
if (!args.prompt || !args.out) throw new Error('Need --prompt and --out');
const model = args.model || 'gemini-3-pro-image';

const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
  body: JSON.stringify({
    contents: [{ parts: [{ text: args.prompt }] }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: args.aspect || '1:1', imageSize: args.size || '2K' } },
  }),
});
const json = await res.json();
if (!res.ok) {
  console.error(JSON.stringify(json.error || json, null, 1));
  process.exit(1);
}
const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
if (!part) {
  console.error('No image in response:', JSON.stringify(json).slice(0, 600));
  process.exit(1);
}
const ext = part.inlineData.mimeType.includes('jpeg') ? '.jpg' : '.png';
const out = args.out.replace(/\.(png|jpe?g)$/i, '') + ext;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.from(part.inlineData.data, 'base64'));
console.log(`saved ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB, ${model})`);
