// Optimise the game's models.
//
//   node tools/optimise-models.mjs                                every model in MODELS below
//   node tools/optimise-models.mjs people/Male_Adult_01.glb ...   just these (under public/assets)
//   --ktx                                                         also try KTX2 textures (below)
//
// Writes optimised COPIES to public/assets/opt/<same path> (the originals are never touched);
// ASSET_MANIFEST points at the copies. Geometry: quantised (positions 14 bits, normals 12, UVs
// 14) + meshopt compression (EXT_meshopt_compression, decoded by three's MeshoptDecoder).
// 2026-10-11: 27 models, 24.8 MB -> 19.2 MB, A/B screenshots identical (Prady's face and dhoti,
// the boats, the cow, an Asura). Code that bakes a model's node transform into its vertices
// must turn the quantised integers back into floats first (Boats.js floatAttributes).
//
// --ktx: each texture is encoded to KTX2 UASTC (+zstd, mipmaps; normal maps in normal-map mode,
// data maps linear), decoded back and compared with the original (PSNR / SSIM on mip 0); one
// that fails keeps its original. The quality passes easily (Prady: 44-53 dB, SSIM >= 0.997) but
// the files grow ~3x (Prady 3.4 -> 11.2 MB, each townsperson ~+4 MB), so it is not shipped for
// now. The loader (Assets.js) already reads KTX2: a model can switch whenever that trade is
// worth it (a quarter of the video memory).
//
// Needs (not in package.json; install when you run it):
//   npm i --no-save @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer ktx2-encoder sharp
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { meshopt, prune, dedup } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { encodeToKTX2 } from 'ktx2-encoder';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets'); // (decoded: the project's path has spaces)
const MODELS = [
  ...fs.readdirSync(path.join(ROOT, 'people')).filter((f) => f.endsWith('.glb')).map((f) => `people/${f}`),
  'characters/prady-game-2k.glb',
  'models/boat-game-1k.glb',
  'models/boat-lod.glb',
  'animals/cow.glb',
  'animals/dog.glb',
];
const args = process.argv.slice(2);
const KTX = args.includes('--ktx');
const files = args.filter((a) => !a.startsWith('--'));
const GATE = { color: { psnr: 38, ssim: 0.97 }, normal: { psnr: 36, ssim: 0.95 }, data: { psnr: 38, ssim: 0.96 } };

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
let basis = null;
if (KTX) {
  // (the encoder's own build of Basis Universal also transcodes: the gate decodes with it)
  const dir = path.dirname(createRequire(import.meta.url).resolve('ktx2-encoder/package.json'));
  basis = await (await import(pathToFileURL(path.join(dir, 'dist/basis/basis_encoder.js')).href)).default();
  basis.initializeBasis();
}

const decode = async (buf) => {
  const { data, info } = await sharp(Buffer.from(buf)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
};

function transcode(ktx) {
  const f = new basis.KTX2File(new Uint8Array(ktx));
  if (!f.isValid()) throw new Error('bad ktx2');
  f.startTranscoding();
  const fmt = basis.transcoder_texture_format.cTFRGBA32.value;
  const out = { width: f.getWidth(), height: f.getHeight(), data: new Uint8Array(f.getImageTranscodedSizeInBytes(0, 0, 0, fmt)) };
  const ok = f.transcodeImage(out.data, 0, 0, 0, fmt, 0, -1, -1);
  f.close();
  f.delete();
  if (!ok) throw new Error('transcode failed');
  return out;
}

function psnr(a, b) {
  let se = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) for (let c = 0; c < 3; c++) {
    const d = a[i + c] - b[i + c];
    se += d * d;
    n++;
  }
  return se === 0 ? 99 : 10 * Math.log10((255 * 255) / (se / n));
}

/** Mean SSIM on luma, 8x8 windows at a stride of 4. */
function ssim(A, B, w, h) {
  const L = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;
  let sum = 0;
  let n = 0;
  for (let y = 0; y + 8 <= h; y += 4) for (let x = 0; x + 8 <= w; x += 4) {
    let ma = 0, mb = 0, va = 0, vb = 0, cv = 0;
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
      const k = ((y + j) * w + x + i) * 4;
      const a = L(A, k);
      const b = L(B, k);
      ma += a; mb += b; va += a * a; vb += b * b; cv += a * b;
    }
    ma /= 64; mb /= 64;
    va = va / 64 - ma * ma; vb = vb / 64 - mb * mb; cv = cv / 64 - ma * mb;
    sum += ((2 * ma * mb + C1) * (2 * cv + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
    n++;
  }
  return sum / n;
}

async function textures(doc, log) {
  const root = doc.getRoot();
  let any = false;
  for (const tex of root.listTextures()) {
    const use = new Set();
    for (const m of root.listMaterials()) {
      if (m.getBaseColorTexture() === tex || m.getEmissiveTexture() === tex) use.add('color');
      if (m.getNormalTexture() === tex) use.add('normal');
      if (m.getMetallicRoughnessTexture() === tex || m.getOcclusionTexture() === tex) use.add('data');
    }
    const kind = use.has('normal') ? 'normal' : use.has('color') ? 'color' : 'data';
    const img = tex.getImage();
    if (!img || tex.getMimeType() === 'image/ktx2') continue;
    const src = await decode(img);
    const linear = kind !== 'color';
    const ktx = await encodeToKTX2(img, { isUASTC: true, isInputSRGB: !linear, isSetKTX2SRGBTransferFunc: !linear, isNormalMap: kind === 'normal', generateMipmap: true, needSupercompression: true, uastcLDRQualityLevel: 2, isPerceptual: !linear, imageDecoder: decode });
    const back = transcode(ktx);
    const p = psnr(src.data, back.data);
    const s = ssim(src.data, back.data, src.width, src.height);
    const ok = p >= GATE[kind].psnr && s >= GATE[kind].ssim && back.width === src.width;
    log.push(`  ${kind} ${src.width}x${src.height} ${(img.byteLength / 1024).toFixed(0)} -> ${(ktx.byteLength / 1024).toFixed(0)} KB, psnr ${p.toFixed(1)} ssim ${s.toFixed(4)}: ${ok ? 'KTX2' : 'kept (failed the gate)'}`);
    if (!ok) continue;
    tex.setImage(new Uint8Array(ktx));
    tex.setMimeType('image/ktx2');
    any = true;
  }
  if (any) doc.createExtension(KHRTextureBasisu).setRequired(true);
}

for (const rel of files.length ? files : MODELS) {
  const inp = path.join(ROOT, rel);
  const out = path.join(ROOT, 'opt', rel);
  const log = [];
  const doc = await io.read(inp);
  if (KTX) await textures(doc, log);
  await doc.transform(dedup(), prune({ keepAttributes: true, keepLeaves: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition: 14, quantizeNormal: 12, quantizeTexcoord: 14 }));
  const root = doc.getRoot();
  if (!root.listTextures().some((t) => t.getMimeType() === 'image/webp')) for (const e of root.listExtensionsUsed()) if (e.extensionName === 'EXT_texture_webp') e.dispose();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await io.write(out, doc);
  console.log(`${rel}: ${(fs.statSync(inp).size / 1e6).toFixed(2)} -> ${(fs.statSync(out).size / 1e6).toFixed(2)} MB${log.length ? `\n${log.join('\n')}` : ''}`);
}
