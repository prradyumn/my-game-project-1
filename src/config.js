// Central tunables for PRADY: Legend of Kashi.
// Units are metres and seconds. +Y is up, the river flows toward +X (downstream / north),
// the city sits on the -Z side and the river + far sand bank on the +Z side (east, sunrise).

export const WATER_LEVEL = 0;
export const GHAT_TOP = 10.5; // height of the city plateau above the river

// Playable bounds (invisible walls sit just inside these).
export const WORLD = { xMin: -470, xMax: 470, zMin: -175, zMax: 390 };

// The river bank is a gentle crescent, like the real ghats of Varanasi.
// bankZ(x) = z0 + curve * (x / halfLen)^2  is the top edge of the ghat steps.
export const BANK = { z0: -30, curve: 45, halfLen: 450 };

// Distance (along the bank normal) from the ghat top edge to where the far sand bank begins.
export const FAR_BANK_V = 275;

export const RIVER = {
  flowSpeed: 0.45, // m/s pushed onto swimmers, boats and floating lamps
  flowDir: [1, 0],
};

// Cross-section of every ghat, from the top terrace down into the river.
export const GHAT_PROFILE = [
  { kind: 'flat', len: 4 }, // top terrace, level with the city
  { kind: 'stairs', steps: 14, rise: 0.3, run: 0.45 },
  { kind: 'flat', len: 6 }, // landing 1: straw umbrellas and wooden takhts
  { kind: 'stairs', steps: 12, rise: 0.3, run: 0.45 },
  { kind: 'flat', len: 4.5 }, // landing 2: aarti platforms
  { kind: 'stairs', steps: 18, rise: 0.3, run: 0.45 }, // runs down under the water
];

// The ten ghats, south (-X) to north (+X). Each is a straight chord of the crescent.
export const GHATS = [
  { id: 'assi', name: 'Assi Ghat', x0: -420, x1: -336, tint: [0.98, 0.93, 0.86] },
  { id: 'tulsi', name: 'Tulsi Ghat', x0: -336, x1: -252, tint: [0.95, 0.9, 0.84] },
  { id: 'kedar', name: 'Kedar Ghat', x0: -252, x1: -168, tint: [1, 0.96, 0.9], stripes: true },
  { id: 'chetsingh', name: 'Chet Singh Ghat', x0: -168, x1: -84, tint: [0.9, 0.84, 0.76], palace: 'fort' },
  { id: 'darbhanga', name: 'Darbhanga Ghat', x0: -84, x1: 0, tint: [0.96, 0.88, 0.78], palace: 'palace' },
  { id: 'dashashwamedh', name: 'Dashashwamedh Ghat', x0: 0, x1: 84, tint: [1, 0.94, 0.86], aarti: true },
  { id: 'manmandir', name: 'Man Mandir Ghat', x0: 84, x1: 168, tint: [0.94, 0.88, 0.8], palace: 'palace' },
  { id: 'manikarnika', name: 'Manikarnika Ghat', x0: 168, x1: 252, tint: [0.82, 0.78, 0.72], pyres: true },
  { id: 'scindia', name: 'Scindia Ghat', x0: 252, x1: 336, tint: [0.93, 0.87, 0.8], sunkenTemple: true },
  { id: 'panchganga', name: 'Panchganga Ghat', x0: 336, x1: 420, tint: [0.95, 0.9, 0.83], deepstambh: true },
];

// The five sacred flames — the main quest.
export const SACRED_FLAMES = [
  {
    id: 'assi',
    name: 'Flame of Assi',
    ghat: 'assi',
    lore: 'Where the Assi meets the Ganga, Durga cast down her sword after slaying Shumbha and Nishumbha.',
  },
  {
    id: 'kedar',
    name: 'Flame of Kedareshwar',
    ghat: 'kedar',
    lore: 'Kedareshwar — Shiva of the high Himalaya, who chose to dwell in Kashi.',
  },
  {
    id: 'dashashwamedh',
    name: 'Flame of the Ten Sacrifices',
    ghat: 'dashashwamedh',
    lore: 'Here Brahma performed ten horse sacrifices to welcome Shiva home to Kashi.',
  },
  {
    id: 'ratneshwar',
    name: 'Flame of Ratneshwar',
    ghat: 'scindia',
    lore: 'The leaning temple, half-swallowed by Mother Ganga, still bows in devotion.',
  },
  {
    id: 'panchganga',
    name: 'Flame of the Thousand Lamps',
    ghat: 'panchganga',
    lore: 'Five rivers meet here in secret. A thousand lamps once burned on this stone pillar.',
  },
];

export const RUDRAKSHA_COUNT = 108;

export const PLAYER = {
  radius: 0.3,
  halfHeight: 0.55, // capsule total height = 2 * (halfHeight + radius) = 1.7 m
  walkSpeed: 1.45, // the mocap walk's natural speed (~1.42 m/s)
  runSpeed: 3.6, // jog: run clip at ~1.15x
  sprintSpeed: 5.4, // sprint: run clip at ~1.7x
  swimSpeed: 1.9,
  swimSprintSpeed: 3.2,
  waterRunSpeed: 10,
  jumpSpeed: 5.4,
  gravity: -19,
  swimDepth: 1.3, // water depth over the feet that switches to swimming
  breathSeconds: 35,
  // Movement physics (SI units). Accelerations in m/s^2.
  move: {
    accel: 20, // speeding up on the ground
    decel: 24, // slowing down
    turnDecel: 38, // braking when reversing direction
    airAccel: 6, // air control
    jumpBuffer: 0.13, // a jump pressed this early before landing still happens
    coyote: 0.12, // a jump this late after leaving a ledge still happens
    jumpCutFactor: 0.5, // releasing Space early cuts the rise (short hop)
    fallGravityScale: 1.5, // heavier fall than rise: snappier, less floaty arcs
    climbSlowdown: 0.32, // fraction of speed lost climbing the ghat steps
    buoyancyK: 24, // swimmer spring stiffness (1/s^2)
    buoyancyZeta: 0.45, // swimmer damping ratio (<1 bobs a little)
    waterDrag: 2.2, // 1/s, how fast a swimmer matches stroke + current
    diveDrag: 1.8,
    diveBuoyancy: 0.25, // m/s upward drift when diving
  },
};

// Day length: one in-game hour per `minutesPerHour` real minutes.
export const TIME = { startHour: 6.35, minutesPerHour: 1.0 };

// pixelRatio x min(device pixel ratio, dprCap) = render resolution per CSS pixel. On a Retina
// MacBook (dpr 2): Medium 56% of native, High 62%, Very High 70%, Ultra 100% (native).
// aoMode: N8AO quality; sharpen: contrast-adaptive sharpening for the upscaled presets.
// minScale: the lowest render scale adaptive resolution may pick (1 = never below the preset).
export const QUALITY_PRESETS = {
  low: { label: 'Low', pixelRatio: 0.7, dprCap: 1.25, shadows: 0, reflection: 0, ao: false, bloom: true, smaa: false, waterSegments: 120, sharpen: 0.5 },
  medium: { label: 'Medium', pixelRatio: 0.9, dprCap: 1.25, shadows: 1024, reflection: 0.33, ao: false, bloom: true, smaa: true, waterSegments: 180, sharpen: 0.45 },
  high: { label: 'High', pixelRatio: 1.0, dprCap: 1.25, shadows: 2048, reflection: 0.5, ao: true, aoMode: 'Low', bloom: true, smaa: true, waterSegments: 220, sharpen: 0.42 },
  // between High and Ultra: sharper than High (more pixels + sharpening) and kept smooth by a
  // lighter ambient-occlusion mode (AO is the most expensive effect at these resolutions)
  // (Very High: 1.6x on a Retina screen and the AO at full resolution: at 1.4x with half-res AO the
  // browser's stretch blurred Prady and the AO's blotches, sharpened, read as grain on his skin;
  // the river's mirror keeps the pixel count it had at 1.4x: 0.45 * 1.4 / 1.6. Under load the
  // adaptive resolution may ease it back to 1.4x (minScale 0.875), never below: the old picture)
  veryhigh: { label: 'Very High', pixelRatio: 1.0, dprCap: 1.6, shadows: 2048, reflection: 0.39, ao: true, aoMode: 'Performance', aoHalfRes: false, bloom: true, smaa: true, waterSegments: 240, sharpen: 0.22, minScale: 0.875 },
  ultra: { label: 'Ultra', pixelRatio: 1.0, dprCap: 2, shadows: 4096, reflection: 0.75, ao: true, aoMode: 'Low', aoHalfRes: false, bloom: true, smaa: true, waterSegments: 260, sharpen: 0.12 },
};

export const DEFAULT_SETTINGS = {
  quality: 'medium',
  adaptiveResolution: true,
  musicVolume: 0.45,
  sfxVolume: 0.8,
  ambienceVolume: 0.7,
  mouseSensitivity: 1.0,
  invertY: false,
  showFps: false,
  timeSpeed: 1,
  weather: 'auto', // auto (the odd monsoon shower) | clear | rain | storm
  difficulty: 'balanced', // story | balanced | hard (DIFFICULTY)
  // accessibility
  guardToggle: false, // Q raises the guard until pressed again (instead of holding it)
  shake: 1, // camera shake 0..1
  subtitleSize: 1, // captions, dialogue and subtitles: 0.85 .. 1.5
  telegraph: 'ember', // the colour of an Asura's warning flare: ember | blue (colour-blind safe)
  reduceFlashes: false, // softer parry / hurt / finisher flashes
  rumble: true, // gamepad vibration
  bindings: {}, // { action: KeyCode } (src/core/Input.js ACTIONS)
};

// Difficulty: how hard the Asuras hit and how much they take, how often the pack strikes, how
// forgiving the guard is and how fast prana returns.
export const DIFFICULTY = {
  story: { label: 'Story', note: 'For the tale: blows sting, the guard forgives', dmgTaken: 0.5, enemyHp: 0.75, aggression: 0.7, parryWindow: 0.55, regen: 1.6 },
  balanced: { label: 'Balanced', note: 'The fight as it was meant', dmgTaken: 1, enemyHp: 1, aggression: 1, parryWindow: 0.42, regen: 1 },
  hard: { label: 'Hard', note: 'Andhaka’s own: they hit harder, wait less, and the parry is tight', dmgTaken: 1.45, enemyHp: 1.3, aggression: 1.35, parryWindow: 0.3, regen: 0.7 },
};

// Siddhis: the powers a yogi earns. Paid for with rudraksha (found in the world) and embers (what
// is left of a slain Asura). Three paths of four; each needs the one before it on its path.
export const SIDDHIS = [
  { id: 'combo4', path: 'talwar', name: 'Fourth Strike', text: 'The combo gains a fourth blow: a two-handed overhead cut (fists: a roundhouse kick) that staggers.', beads: 3, embers: 5 },
  { id: 'riposte', path: 'talwar', name: 'Pratyuttara', text: 'Strike within a moment of a parry: a riposte for triple damage.', beads: 6, embers: 12 },
  { id: 'charged', path: 'talwar', name: 'Gathered Storm', text: 'Hold the heavy strike to charge it. A charged blow breaks any guard and floors a Rakshasa.', beads: 9, embers: 20 },
  { id: 'mercy', path: 'talwar', name: 'Final Mercy', text: 'Finishers open sooner (half health) and each one restores prana.', beads: 12, embers: 30 },
  { id: 'prana1', path: 'body', name: 'Deep Breath', text: '+25 prana.', beads: 3, embers: 5 },
  { id: 'windStep', path: 'body', name: 'Wind Step', text: 'A longer dodge with a longer moment of grace. A dodge on the flare fills Shakti.', beads: 6, embers: 12 },
  { id: 'river', path: 'body', name: 'Ganga’s Child', text: 'Swim a quarter faster and hold your breath twice as long.', beads: 9, embers: 20 },
  { id: 'prana2', path: 'body', name: 'Vajra Body', text: '+35 prana, and a heavy blow no longer floors you while guarding.', beads: 12, embers: 30 },
  { id: 'damaru', path: 'spirit', name: 'Shiva’s Damaru', text: 'Spend Shakti (1): a drumbeat that throws every Asura near you to the ground.', beads: 3, embers: 5 },
  { id: 'trishul', path: 'spirit', name: 'Trishul', text: 'Spend Shakti (2): hurl a trishul that pins an Asura, then flies back to your hand.', beads: 6, embers: 12 },
  { id: 'thirdEye', path: 'spirit', name: 'Third Eye', text: 'Spend Shakti (3): the world slows for you alone; hidden rudraksha glow.', beads: 9, embers: 20 },
  { id: 'kundalini', path: 'spirit', name: 'Kundalini', text: 'Shakti fills 40% faster, and a full meter heals as it rises.', beads: 12, embers: 30 },
];
export const SIDDHI_PATHS = {
  talwar: { name: 'Path of the Talwar', color: '#ffb35a' },
  body: { name: 'Path of the Body', color: '#7fd4c2' },
  spirit: { name: 'Path of the Spirit', color: '#c9a7ff' },
};
// embers a slain Asura leaves (spent on Siddhis)
export const EMBERS = { shade: 2, brute: 5, pishacha: 3, kavacha: 4, vetala: 4, mini: 20, boss: 40 };

// Shakti: filled by fighting well, spent on the divine powers.
// The ghats' animals (src/world/Animals.js): where each lives (a ghat, u along it, and which flat:
// 0 the top terrace, 1 the umbrella landing, 2 the aarti landing) and how they move.
export const ANIMALS = {
  cows: [
    { ghat: 'assi', u: 30, flat: 0 },
    { ghat: 'kedar', u: 42, flat: 2 },
    { ghat: 'darbhanga', u: 22, flat: 1 },
    { ghat: 'dashashwamedh', u: 64, flat: 0 },
    { ghat: 'scindia', u: 30, flat: 2 },
  ],
  dogs: [
    { ghat: 'dashashwamedh', u: 38, flat: 0 },
    { ghat: 'tulsi', u: 50, flat: 0 },
    { ghat: 'chetsingh', u: 30, flat: 2 },
    { ghat: 'manmandir', u: 20, flat: 0 },
    { ghat: 'panchganga', u: 40, flat: 1 },
  ],
  cow: { walk: 0.85, flee: 1.4, turn: 1.3, box: [0.72, 1.3, 1.75] }, // m/s, rad/s, collider w h d
  dog: { walk: 1.1, run: 2.1, turn: 3.6, box: [0.3, 0.55, 0.8], followSecs: [45, 90], adopt: 0.4 },
  viewDist: 75, // beyond it they are hidden and still
};

export const SHAKTI = {
  max: 100,
  hit: 3, // a blow landed (x the blow's weight)
  parry: 14,
  dodge: 6, // a dodge through a blow (with Wind Step)
  kill: 8,
  cost: { damaru: 50, trishul: 30, thirdEye: 60 },
  thirdEyeSecs: 6,
};
