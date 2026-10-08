// What the crowd is made of. Edit and re-run `npm run bake:people`.
// Motion sources: Mixamo clips from the three.js example Xbot (clip:), or CMU motion capture
// takes (cmu: file in source-assets/cmu; start/end = seconds of the clean segment that loops;
// loopBlend = seconds eased back into the first frame so the loop is seamless).
export const MOTIONS = [
  { name: 'idle', clip: 'idle' },
  { name: 'walk', clip: 'walk' },
  { name: 'agree', clip: 'agree' },
  { name: 'headShake', clip: 'headShake' },
  { name: 'talk', cmu: '18_08', start: 3.0, end: 14.5, loopBlend: 0.8 }, // conversation, hand gestures
  { name: 'sit', cmu: '13_04', start: 33.2, end: 38.0, loopBlend: 0.8 }, // sitting, relaxed (takht height)
  { name: 'sitChin', cmu: '13_04', start: 13.2, end: 17.6, loopBlend: 0.8 }, // sitting, chin in hand
  { name: 'wash', cmu: '02_10', start: 1.0, end: 9.6, loopBlend: 0.6 }, // scoop water, pour (bathing)
  { name: 'wait', cmu: '40_10', start: 0.6, end: 6.0, loopBlend: 0.8 }, // standing, weight shifts
  { name: 'stretch', cmu: '42_01', start: 1.0, end: 8.6, loopBlend: 1.0 }, // morning stretch
  { name: 'wave', cmu: '13_26', start: 20.4, end: 23.2, loopBlend: 0.6 }, // right-hand wave, left hand relaxed
];

// Microsoft Rocketbox avatars (MIT) in source-assets/rocketbox/<id>.
// role: what they tend to do in town (Crowd.js); label: description.
export const AVATARS = [
  { id: 'Male_Adult_15', role: 'pilgrim', label: 'man in kurta-pajama and cap' },
  { id: 'Female_Adult_06', role: 'pilgrim', label: 'woman in salwar-kameez and dupatta' },
  { id: 'Male_Adult_14', role: 'local', label: 'older man, grey shirt, khakis' },
  { id: 'Male_Adult_08', role: 'local', label: 'man in a light-blue shirt' },
  { id: 'Male_Adult_11', role: 'local', label: 'man in a dark shirt' },
  { id: 'Male_Adult_06', role: 'local', label: 'man in a red long-sleeve' },
  { id: 'Male_Adult_20', role: 'local', label: 'man in a brown sweater' },
  { id: 'Male_Adult_09', role: 'local', label: 'young man in a black tee' },
  { id: 'Female_Adult_15', role: 'local', label: 'woman in a blue shirt' },
  { id: 'Female_Adult_11', role: 'local', label: 'woman in a brown dress' },
  { id: 'Male_Adult_01', role: 'tourist', label: 'tourist in striped tee and shorts' },
  { id: 'Female_Adult_08', role: 'tourist', label: 'tourist in grey tee and jeans' },
  { id: 'Male_Child_01', role: 'child', label: 'boy' },
  { id: 'Male_Child_02', role: 'child', label: 'boy' },
  { id: 'Female_Child_01', role: 'child', label: 'girl' },
  { id: 'Female_Child_02', role: 'child', label: 'girl' },
];

// Shared motion packs: skeleton + clips only, baked once per body type and played on every
// person of that type (the Bip01 bone names match), so each person's own GLB stays small.
//   npm run bake:people pack      -> public/assets/people/motions-{m,f,c}.glb
const PACK_ADULT = [
  { name: 'pranam', cmu: '144_30', start: 3.85, end: 4.3, loopBlend: 0.2 }, // hands folded at the chest
  { name: 'surya', cmu: '144_30', start: 0.6, end: 40.5, loopBlend: 1.2, fps: 20 }, // Surya Namaskar, a full round
  { name: 'meditate', cmu: '111_06', start: 3.0, end: 3.7, loopBlend: 0.3, restHipY: 15.7 }, // cross-legged on the ground
  { name: 'floorSit', cmu: '114_16', start: 9.4, end: 14.2, loopBlend: 0.8 }, // sitting on the stone, legs out
  { name: 'danceA', cmu: '94_03', start: 2.8, end: 14.0, loopBlend: 0.8, fps: 20 }, // Indian dance (festival nights)
  { name: 'danceB', cmu: '94_01', start: 2.7, end: 16.0, loopBlend: 0.8, fps: 20 },
  { name: 'drum', cmu: '79_18', start: 0.6, end: 6.1, loopBlend: 0.6 }, // dhol at the aarti
  { name: 'stir', cmu: '79_13', start: 1.0, end: 4.5, loopBlend: 0.6 }, // the chai-wala's pot
  { name: 'buy', cmu: '79_16', start: 1.6, end: 4.9, loopBlend: 0.6 }, // buying at a stall
  { name: 'sweep', cmu: '13_23', start: 3.0, end: 12.0, loopBlend: 1.0 }, // sweeping the ghat at dawn
  { name: 'toss', cmu: '124_12', start: 5.4, end: 8.0, loopBlend: 0.6 }, // scattering grain for the pigeons
];
const PACK_CHILD = [
  { name: 'pranam', cmu: '144_30', start: 3.85, end: 4.3, loopBlend: 0.2 },
  { name: 'hopscotch', cmu: '143_31', start: 0.3, end: 3.3, loopBlend: 0.5 },
  { name: 'play', cmu: '142_01', start: 4.0, end: 11.9, loopBlend: 0.8 }, // skipping about
  { name: 'floorSit', cmu: '114_16', start: 9.4, end: 14.2, loopBlend: 0.8 },
];
export const PACKS = {
  m: { avatar: 'Male_Adult_15', motions: PACK_ADULT },
  f: { avatar: 'Female_Adult_06', motions: PACK_ADULT },
  c: { avatar: 'Male_Child_01', motions: PACK_CHILD },
};
