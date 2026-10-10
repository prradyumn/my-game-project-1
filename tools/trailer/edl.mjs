import { fileURLToPath } from 'node:url';
// The cut, laid on the music (source-assets/music/trailer-lyria.mp3, measured with music/hits.mjs and
// music/tempo2.mjs): acts I-II at ~120 bpm with a hit every 4.0 s from 0.05, the pause 52.0-55.8, the
// boom at 55.9, then the battle (~159 bpm) cut on its strongest drum hits until 88.37.
//   { at, src, in, g (grade), y (letterbox window top, 0..276), fi / fo (fades), white (flash in) }
export const END = 100.0;
const C = (at, src, o = {}) => ({ at, src, ...o });
export const CUTS = [
  // ---- I · the city of light, and the city as it plays
  C(0, 'black'),
  C(1.77, 'sunrise', { in: 0, g: 'day', fi: 1.5 }),
  C(8.07, 'g_dawnrun', { in: 0.6, g: 'day' }),
  C(10.08, 'g_lanes', { in: 1.0, g: 'day' }),
  C(11.08, 'g_dive', { in: 2.6, g: 'day', y: 150 }),
  C(12.08, 'aarti', { in: 0.1, g: 'dusk', y: 110 }),
  C(14.08, 'g_race', { in: 2.2, g: 'day', y: 150 }),
  C(16.09, 'g_swim', { in: 1.5, g: 'dusk', y: 150 }),
  C(18.10, 'g_row', { in: 1.0, g: 'dusk', y: 150 }),
  // ---- II · the dark
  C(20.10, 'pyres', { in: 0.3, y: 100 }),
  C(24.11, 'darkriver', { in: 0.1 }),
  C(28.12, 'rise', { in: 0.5, y: 120 }),
  C(32.13, 'g_rainrun', { in: 0.3, y: 150 }),
  C(34.13, 'storm', { in: 0 }),
  C(36.25, 'talwar', { in: 0, y: 90 }),
  C(40.15, 'climb', { in: 0.5, g: 'day' }),
  C(42.15, 'g_waterrun', { in: 0.3, y: 140 }),
  C(44.16, 'bossfight', { in: 0.2, y: 150 }),
  C(46.16, 'bossrise', { in: 1.2, y: 100 }),
  C(48.17, 'hero', { in: 0.6, y: 90 }),
  C(52.00, 'slowmo', { in: 0.15, y: 130 }),
  C(55.80, 'black'),
  // ---- III · the fight as it plays (cut on the battle cue's drum hits); slow motion for the last of it
  C(55.90, 'g_fightrain', { in: 4.0, fi: 0.3, white: true, y: 150 }),
  C(57.225, 'g_fightday', { in: 7.6, g: 'dusk', y: 150 }),
  C(59.985, 'g_fightrain', { in: 10.0, y: 150 }),
  C(61.11, 'g_fightpowers', { in: 5.2, y: 150 }),
  C(62.235, 'finisher', { in: 0.2, y: 150 }),
  C(64.065, 'damaru', { in: 0.25, y: 140 }),
  C(66.20, 'g_fightrain', { in: 1.3, y: 150 }),
  C(67.61, 'g_fightday', { in: 3.0, g: 'dusk', y: 150 }),
  C(68.795, 'bossfight', { in: 2.2, y: 130 }),
  C(70.995, 'g_fightpowers', { in: 13.0, y: 150 }),
  C(72.005, 'bossrise', { in: 4.3, y: 100 }),
  C(73.975, 'g_fightday', { in: 12.5, g: 'dusk', y: 150 }),
  C(74.68, 'finisher', { in: 8.0, y: 150 }),
  C(75.82, 'title:slam1'),
  C(76.865, 'g_fightrain', { in: 12.0, y: 150 }),
  C(77.64, 'title:slam2'),
  C(78.685, 'g_fightpowers', { in: 10.3, y: 150 }),
  C(79.80, 'title:slam3'),
  C(80.90, 'g_fightday', { in: 13.5, g: 'dusk', y: 150 }),
  C(82.135, 'slowkill', { in: 0, y: 120 }),
  C(84.145, 'finisher', { in: 12.0, y: 150 }),
  C(85.44, 'g_fightrain', { in: 5.4, y: 150 }),
  C(87.215, 'hero', { in: 4.6, y: 90 }),
  C(88.365, 'black'),
  C(92.30, 'title:title'),
];

// the music: the whole cue, its tail let go under Prady's line
export const MUSIC = { file: fileURLToPath(new URL('../../source-assets/music/trailer-lyria.mp3', import.meta.url)), vol: 1.0, dur: 88.95, fo: 0.55 };

// voices: [file, at, volume]
export const VO = [
  ['vo/v1.wav', 2.4], // Kashi, older than history, the city of light where Shiva dwells.
  ['vo/v2.wav', 12.6], // The five sacred flames of the gods have gone dark, and Mother Ganga grows dim.
  ['vo/v3.wav', 20.6], // Every night the river grows darker.
  ['vo/v4.wav', 24.5], // Last night something walked up these steps out of the water.
  ['vo/v5.wav', 32.3], // It had a body of smoke, and eyes like coals.
  ['vo/v6.wav', 37.2], // Little flame-lighter. You have kindled four lamps against a night that is older than the gods.
  ['vo/v7.wav', 51.85], // Darkness forgets, but it does not die.
  ['vo/v8fx.wav', 89.25, 1.15], // Then I will light the fifth, and you can go back to sleep.
];

// beds under the picture: looped
export const BEDS = [
  { f: 'gentle-wide-river-water-lapping-against-cmuyh90m.mp3', t: 1.6, dur: 18.7, vol: 0.4, fi: 1.6, fo: 1.5 },
  { f: 'sfx/crowd-murmur.mp3', t: 8.0, dur: 8.3, vol: 0.22, fi: 0.8, fo: 1.5 },
  { f: 'evening-ganga-aarti-ambience-distant-cro-cmuyh9dh.mp3', t: 12.0, dur: 6.5, vol: 0.5, fi: 0.3, fo: 1.5 },
  { f: 'small-oil-lamp-flames-crackling-softly-s-cmuyhuze.mp3', t: 20.1, dur: 4.2, vol: 0.7, fi: 0.2, fo: 0.6 },
  { f: 'gentle-wide-river-water-lapping-against-cmuyh90m.mp3', t: 24.1, dur: 8.2, vol: 0.32, fi: 0.4, fo: 1.0 },
  { f: 'steady-swimming-strokes-in-calm-river-wa-cmuyh986.mp3', t: 16.09, dur: 2.05, vol: 0.55, fi: 0.1, fo: 0.3 },
  { f: 'sfx/rain.wav', t: 32.0, dur: 60.8, vol: 0.5, fi: 1.0, fo: 2.5 },
];

// one-shots: [at, file, volume, rate] (sfxn/: every effect peak-normalised to -1 dBFS; bhit / bwhoosh /
// whoosh / parry / bodyhit / thump: the engine's own synthesized combat sounds)
const F = (n) => `sfxn/${n}.wav`;
const th = (i) => F(`thunder${i % 4}`);
let k = 0;
const hit = (t, v = 0.5) => [t, F(`bhit${k++ % 3}`), v];
const swish = (t, v = 0.45) => [t, F(`bwhoosh${k++ % 3}`), v];
const FOLEY = /(bhit|bwhoosh|whoosh|parry|bodyhit|body-hit|thump|asura-death|damaru|heavy-hit|block-impact)/;
const SFX0 = [
  // I
  [8.07, F('single-brass-temple-bell-strike-with-lon-cmuyh92b'), 0.3],
  [12.25, F('sacred-conch-shell-shankh-blown-one-long-cmuyh94b'), 0.2],
  [16.15, F('magical-sacred-chime-shimmer-small-bead-cmuyh9bt'), 0.22],
  [11.62, F('person-jumps-and-splashes-into-a-river-b-cmuyh969'), 0.7],
  [14.3, F('wooden-oar-stroke-pulling-through-calm-r-cmuyhut0'), 0.5], [15.25, F('wooden-oar-stroke-pulling-through-calm-r-cmuyhut0'), 0.45],
  [18.3, F('wooden-oar-stroke-pulling-through-calm-r-cmuyhut0'), 0.45], [19.3, F('wooden-oar-stroke-pulling-through-calm-r-cmuyhut0'), 0.4],
  [42.3, F('person-jumps-and-splashes-into-a-river-b-cmuyh969'), 0.25, 1.4],
  // II
  [20.10, F('slowmo-boom'), 0.22, 0.8],
  [28.55, F('asura-growl'), 0.42, 0.88],
  [32.35, F('asura-attack'), 0.22, 0.8],
  [34.66, th(0), 0.4],
  [36.95, F('draw'), 0.75, 0.9],
  [37.0, F('bwhoosh0'), 0.3, 0.8],
  [40.55, F('whoosh0'), 0.35],

  [44.3, F('asura-growl'), 0.35, 0.6],
  [46.6, th(1), 0.38],
  [49.0, th(2), 0.38],
  [51.8, th(3), 0.24],
  [52.0, F('slowmo-swell'), 0.55],
  [52.6, F('heartbeat'), 0.36, 0.85],
  [53.08, th(0), 0.28, 0.72],
  [54.3, F('heartbeat'), 0.42, 0.85],
  [53.6, F('riser'), 0.45],
  // III: the boom
  [55.90, F('braam'), 0.9],
  [55.90, F('slowmo-boom'), 0.6],
  [55.90, F('heavy-hit'), 0.7],
  [55.90, F('sub'), 0.7],
  swish(56.25), hit(56.45, 0.55),
  hit(57.5), swish(58.4), hit(58.6, 0.55),
  [60.05, F('parry0'), 0.45],
  hit(61.2), [61.35, F('asura-death'), 0.4],
  swish(62.3), [62.55, F('body-hit'), 0.5],
  [64.365, F('damaru'), 0.7], [64.545, F('damaru'), 0.7], [64.785, F('damaru'), 0.95, 0.9],
  [64.785, F('slowmo-boom'), 0.55], [64.785, F('thump0'), 0.6, 0.8], [65.3, F('asura-death'), 0.45, 0.6],
  hit(66.3), swish(67.65), hit(67.85),
  [68.85, F('andhaka-roar'), 0.75], [69.1, th(2), 0.36],
  [71.05, F('body-hit'), 0.45], [72.05, F('asura-growl'), 0.45, 0.7], [73.0, F('heavy-hit'), 0.55],
  hit(74.0), swish(74.72), hit(74.9),
  [75.82, F('block-impact'), 0.7, 0.6], [75.82, F('heavy-hit'), 0.45, 0.8],
  hit(76.95),
  [77.64, F('block-impact'), 0.7, 0.6], [77.64, F('heavy-hit'), 0.45, 0.8],
  [78.75, F('body-hit'), 0.45],
  [79.80, F('block-impact'), 0.8, 0.55], [79.80, F('heavy-hit'), 0.55, 0.75], [79.80, F('sub'), 0.4],
  hit(80.95), [81.2, F('asura-death'), 0.35],
  [82.535, F('heavy-hit'), 0.75, 0.7], [82.58, F('slowmo-boom'), 0.55], [82.58, F('thump1'), 0.5, 0.7],
  [82.8, F('asura-death'), 0.5, 0.6], [83.26, th(1), 0.34, 0.8],
  [84.145, F('heavy-hit'), 0.8], [84.145, F('braam'), 0.55, 0.9], [84.3, F('andhaka-roar'), 0.5, 0.85],
  swish(85.5), [85.7, F('parry1'), 0.45],
  swish(87.3), hit(87.5, 0.6),
  // the last hit rings into silence; rain, his line, then the title
  [88.365, F('slowmo-boom'), 0.6, 0.85], [88.365, F('sub'), 0.45],
  [89.0, th(1), 0.14, 0.8],
  [91.3, F('revswell'), 0.55],
  [92.30, F('braam'), 1.0, 0.85],
  [92.30, F('slowmo-boom'), 0.85],
  [92.30, F('heavy-hit'), 0.7, 0.8],
  [92.30, F('sub'), 0.95],
  [92.6, F('title-shimmer'), 0.45],
  [93.4, F('single-brass-temple-bell-strike-with-lon-cmuyh92b'), 0.4],
];

export const SFX = SFX0.map(([t, f, v, r, o]) => [t, f, t > 55.8 && t < 88.3 && FOLEY.test(f) ? Math.min(2.2, v * 2.4) : v, r, o]);