// The trailer: cut list (edl.mjs) + sound list -> ffmpeg -> $TRAILER_WORK/out/trailer.mp4
//   node build.mjs [--preview] [--audio | --video]   (STEM=music|vo|fx: one stem only)
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CUTS, END, VO, SFX, BEDS, MUSIC } from './edl.mjs';
import { WORK } from './rig.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
void here;
process.chdir(WORK);
const A = '/Users/pradyumnawasthi/my game project 1/public/assets/audio';
const args = process.argv.slice(2);
const preview = args.includes('--preview');
const out = args[args.indexOf('-o') + 1] && args.includes('-o') ? args[args.indexOf('-o') + 1] : preview ? 'out/preview.mp4' : 'out/trailer.mp4';
fs.mkdirSync('out', { recursive: true });

// grades: 'night' lifts the shadows a touch, 'day' only polishes
const GRADE = {
  day: 'eq=contrast=1.03:saturation=1.04',
  dusk: 'eq=contrast=1.04:saturation=1.06:gamma=1.04',
  night: 'eq=contrast=1.05:saturation=1.08:gamma=1.13',
  flash: 'eq=contrast=1.05:saturation=1.08:gamma=1.13',
};
const GLOBAL = [
  "curves=master='0/0 0.07/0.05 0.5/0.5 0.86/0.89 1/0.985'",
  'colorbalance=rs=-0.03:gs=-0.005:bs=0.04:rh=0.035:gh=0.01:bh=-0.035',
  'vignette=angle=0.42',
  'noise=c0s=6:c0f=t',
  'drawbox=x=0:y=0:w=iw:h=138:color=black:t=fill',
  'drawbox=x=0:y=ih-138:w=iw:h=138:color=black:t=fill',
].join(',');

const inputs = [];
const vf = [];
const addIn = (...a) => (inputs.push(...a), inputs.filter((x) => x === '-i').length - 1);

// ------------------------------------------------------------- picture
CUTS.forEach((c, i) => {
  const to = i + 1 < CUTS.length ? CUTS[i + 1].at : END;
  const dur = +(to - c.at).toFixed(3);
  let chain;
  if (c.src === 'black') {
    const k = addIn('-f', 'lavfi', '-t', String(dur), '-i', 'color=c=black:s=1920x1080:r=30');
    chain = `[${k}:v]format=yuv420p`;
  } else if (c.src.startsWith('title:')) {
    const name = c.src.slice(6);
    const b = addIn('-f', 'lavfi', '-t', String(dur), '-i', 'color=c=0x050403:s=1920x1080:r=30');
    const t = addIn('-framerate', '30', '-i', `titles/${name}/%04d.png`);
    vf.push(`[${t}:v]format=rgba,setpts=PTS-STARTPTS+${c.delay ?? 0}/TB[t${i}]`);
    chain = `[${b}:v][t${i}]overlay=eof_action=pass:format=auto,format=yuv420p`;
  } else {
    const k = addIn('-ss', String(c.in ?? 0), '-t', String(dur + 0.2), '-i', `clips/${c.src}.mp4`);
    const y = c.y ?? 138;
    chain = `[${k}:v]setpts=PTS-STARTPTS,fps=30,format=yuv420p,${GRADE[c.g || 'night']}${c.zoom ? `,scale=${Math.round(1920 * c.zoom)}:-2,crop=1920:1080` : ''},crop=1920:804:0:${y},pad=1920:1080:0:138:black`;
  }
  chain += `,trim=duration=${dur},setpts=PTS-STARTPTS`;
  if (c.fi) chain += `,fade=t=in:st=0:d=${c.fi}${c.white ? ':color=white' : ''}`;
  if (c.fo) chain += `,fade=t=out:st=${(dur - c.fo).toFixed(3)}:d=${c.fo}`;
  vf.push(`${chain}[v${i}]`);
});
vf.push(`${CUTS.map((_, i) => `[v${i}]`).join('')}concat=n=${CUTS.length}:v=1:a=0[cat]`);
// the in-engine note over the first black
const ig = addIn('-framerate', '30', '-i', 'titles/ingame/%04d.png');
vf.push(`[${ig}:v]format=rgba,setpts=PTS-STARTPTS+0.2/TB[ig]`);
vf.push(`[cat]${GLOBAL}[g]`, `[g][ig]overlay=eof_action=pass:format=auto,format=yuv420p${preview ? ',scale=960:-2' : ''}[vout]`);

// ------------------------------------------------------------- sound
const af = [];
const mk = (file, { t = 0, vol = 1, rate = 1, dur = null, loop = false, fi = 0, fo = 0, ss = 0, pan = 0 } = {}) => {
  const k = loop ? addIn('-stream_loop', '-1', '-i', file) : addIn('-i', file);
  const lab = `a${af.length}`;
  let ch = `[${k}:a]aformat=sample_rates=48000:channel_layouts=stereo`;
  if (ss) ch += `,atrim=start=${ss},asetpts=PTS-STARTPTS`;
  if (rate !== 1) ch += `,asetrate=${Math.round(48000 * rate)},aresample=48000`;
  if (dur) ch += `,atrim=duration=${dur}`;
  if (fi) ch += `,afade=t=in:d=${fi}`;
  if (fo && dur) ch += `,afade=t=out:st=${dur - fo}:d=${fo}`;
  if (pan) ch += `,stereotools=balance_out=${pan}`;
  ch += `,volume=${vol},adelay=${Math.round(t * 1000)}:all=1`;
  af.push(`${ch}[${lab}]`);
  return `[${lab}]`;
};
// a file of the trailer's own (vo/, sfx/*.wav, music/) or one of the game's sounds
const file = (f) => (f.startsWith('/') || fs.existsSync(f) ? f : `${A}/${f}`);
// the music, its ending let go after the battle
const mus0 = mk(file(MUSIC.file), { vol: MUSIC.vol, dur: MUSIC.dur, fi: 0.6, fo: MUSIC.fo });
// the battle a touch louder than the rest (the cue was mastered for a game, not a trailer)
af.push(`${mus0}volume='if(between(t,55.9,88.4),1.32,1)':eval=frame[mus]`);
const mus = '[mus]';
// the voices (and a copy that ducks the music under them)
const voices = VO.map(([f, t, vol = 1]) => mk(file(f), { t, vol }));
af.push(`${voices.join('')}amix=inputs=${voices.length}:normalize=0:dropout_transition=0,asplit=2[vo][vosc]`);
af.push(`${mus}[vosc]sidechaincompress=threshold=0.025:ratio=4:attack=40:release=650:makeup=1[mduck]`);
const fx = [...BEDS.map((b) => mk(file(b.f), { ...b, loop: true })), ...SFX.map(([t, f, vol = 1, rate = 1, o = {}]) => mk(file(f), { t, vol, rate, ...o }))];
// stems (STEM=music|vo|fx): the others muted
const st = process.env.STEM;
const gm = !st || st === 'music' ? 1 : 0, gv = !st || st === 'vo' ? 1 : 0, gx = !st || st === 'fx' ? 1 : 0;
af.push(`[mduck]volume=${gm}[mg]`, `[vo]volume=${gv}[vg]`);
af.push(`${fx.join('')}amix=inputs=${fx.length}:normalize=0:dropout_transition=0,volume=${gx * (+process.env.FXGAIN || 1)},asplit=2[fxg][fxsc]`);
// the music gives way for an instant under each impact (and a little under the rain)
af.push(`[mg][fxsc]sidechaincompress=threshold=0.12:ratio=2.5:attack=3:release=140:makeup=1[mg2]`);
af.push(`[mg2][vg][fxg]amix=inputs=3:normalize=0:dropout_transition=0,apad=whole_dur=${END},atrim=duration=${END},afade=t=out:st=${END - 1.2}:d=1.2,aresample=48000[aout]`);

// two passes (the sound graph alone is quick to redo), then muxed
const nVideoIn = (() => { let n = 0; for (let i = 0; i < inputs.length; i++) if (inputs[i] === '-i') n++; return n; })();
void nVideoIn;
const t0 = Date.now();
const only = args.includes('--audio') ? 'audio' : args.includes('--video') ? 'video' : 'both';
// inputs are shared in one list; each pass maps what it needs (ffmpeg ignores unused inputs only if
// not decoded, so split the input list by kind)
const inputsByIndex = (() => { const res = []; let cur = []; for (const x of inputs) { cur.push(x); if (x !== '-i' && cur[cur.length - 2] === '-i') { res.push(cur); cur = []; } } return res; })();
const vIn = inputsByIndex.filter((it) => /(\.mp4|\.png|color=)/.test(it[it.length - 1]));
const aIn = inputsByIndex.filter((it) => !vIn.includes(it));
const renum = (graph, list) => graph.replace(/\[(\d+):([av])\]/g, (m, k, t) => `[${list.indexOf(inputsByIndex[+k])}:${t}]`);
if (only !== 'video') {
  fs.writeFileSync('out/agraph.txt', renum(af.join(';\n'), aIn));
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...aIn.flat(), '-/filter_complex', 'out/agraph.txt', '-map', '[aout]', '-t', String(END), '-c:a', 'pcm_f32le', 'out/mix-raw.wav'], { stdio: 'inherit' });
  if (process.env.STEM) { fs.renameSync('out/mix-raw.wav', `out/stem-${process.env.STEM}.wav`); console.log('stem', process.env.STEM); process.exit(0); }
  // one static gain to -14 LUFS (the dynamics stay as mixed), a true-peak limiter on top
  const r = execFileSync('ffmpeg', ['-hide_banner', '-i', 'out/mix-raw.wav', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  const meas = execFileSync('sh', ['-c', 'ffmpeg -hide_banner -i out/mix-raw.wav -af ebur128 -f null - 2>&1 | grep -E "^ +I:" | tail -1']).toString();
  void r;
  const I = +meas.match(/(-?[\d.]+) LUFS/)[1];
  const gain = -14 - I;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', 'out/mix-raw.wav', '-af', `volume=${gain.toFixed(2)}dB,alimiter=limit=0.85:attack=2:release=60:level=false`, '-c:a', 'pcm_s24le', 'out/mix.wav'], { stdio: 'inherit' });
  console.log(`mix ${I} LUFS -> gain ${gain.toFixed(1)} dB`);
  console.log(`sound in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
if (only !== 'audio') {
  fs.writeFileSync('out/vgraph.txt', renum(vf.join(';\n'), vIn));
  const enc = preview ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23'] : ['-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-profile:v', 'high', '-tune', 'film', '-x264-params', 'aq-mode=3'];
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...vIn.flat(), '-/filter_complex', 'out/vgraph.txt', '-map', '[vout]', ...enc, '-pix_fmt', 'yuv420p', '-r', '30', '-t', String(END), preview ? 'out/picture-preview.mp4' : 'out/picture.mp4'], { stdio: 'inherit' });
  console.log(`picture in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', preview ? 'out/picture-preview.mp4' : 'out/picture.mp4', '-i', 'out/mix.wav', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', '-shortest', out], { stdio: 'inherit' });
console.log(`built ${out} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
