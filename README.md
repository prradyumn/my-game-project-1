# The Legend of Varanasi

An open-world, mythological action-adventure set on the ghats of Varanasi (Kashi), built for
the browser with Three.js. You play **Prady**, a young hero of Kashi, rekindling the five
sacred flames of the ghats to restore Mother Ganga, across five story chapters, against the
Asuras that rise out of the river after dark.

Runs at 60 fps on an Apple-silicon MacBook Air (Medium preset, adaptive resolution on).

---

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

- `npm run build` → static site in `dist/` (deploy anywhere: Vercel, Netlify, GitHub Pages, itch.io).
- `npm run preview` → serve the production build locally.
- `npm run check:world` → Node sanity checks of the world layout (no browser needed).

Requires Node ≥ 20 and a WebGL2 browser (Chrome, Edge, Safari 17+, Firefox).

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows | Move (camera-relative) |
| Mouse | Look (click the game once to capture the mouse) |
| Shift | Sprint · swim faster · **run on water** (after Ganga's Blessing) |
| Space | Jump · swim up |
| C / Ctrl | Dive (under water you swim where the camera looks) |
| E | Interact: talk · take · light a sacred flame · board / leave the boat · climb a ladder · **finish** a reeling Asura |
| Mouse left / right | Strike (click again for a 3-hit combo, 4 with the siddhi) / heavy strike (hold to charge, with the siddhi) |
| Q (hold) or middle mouse | Guard; raise it just before a blow lands to **parry** (or toggle: Settings) |
| C / Ctrl | Dodge roll (with a direction) on land · dive in the water · slide down a ladder |
| Tab | Lock on to an Asura (flick the mouse to switch) |
| R | Draw / sheathe the talwar |
| 1 / 2 / 3 | Powers (Shakti): Shiva's Damaru · Trishul (press again to call it back) · Third Eye |
| Space at a ledge | Climb it (running into a low wall or a parapet vaults it) |
| Space (boat race) | Power stroke: press it as each oar stroke begins |
| J | Journal: map (track, fast travel), tasks, siddhis, achievements |
| M | Meditate |
| F | Float a diya on the river (Deep Daan) |
| G | Greet: Prady waves and the people nearby answer |
| X | Toggle walk |
| N | Time-lapse to night (or back to dawn) |
| P | Photo mode (hides HUD, `[` `]` change time of day) |
| F9 | Screenshot of the game view (no HUD) saved to Downloads |
| ⌘ / ⌥ (Cmd / Option) | Free the mouse without pausing (for ⌘⇧4 screenshots or another window); click the game to look again |
| Esc | Pause / settings |
| Mouse wheel | Camera distance |

Gamepad works too (with rumble): left stick move, right stick look, A jump, B dodge / dive, X
interact, Y draw / sheathe, RB strike, RT heavy, LB guard, R3 lock on, LT + X / Y / B powers, Back
journal (LB / RB change page), Start pause. Menus take the d-pad.

Every key can be rebound (Pause → Controls). Settings also hold the difficulty (Story / Balanced /
Hard) and accessibility options: guard toggle, camera shake, caption size, a colour-blind-safe
warning flare, reduced flashes, gamepad vibration.

**Chapter Select · Test** (title screen and pause menu): jump straight into any chapter step, fight,
side mission or river activity with nothing required first. Test sessions never touch your saves.

**Debug mode:** open `http://localhost:5173/?debug` — `F1` lights all flames (finale),
`F2` skips an hour, `F3` teleports to the next flame, `F4` toggles Ganga's Blessing. FPS/draw-call
counter is always shown in debug.

## What's in the game

- **Kashi, 1 km of it:** ten ghats in a crescent (Assi → Panchganga), ~440 walkable stone steps,
  194 procedural havelis/palaces/a fort, 7,000+ windows (lit at night), balconies, rooftop
  chhatris and water tanks, six Nagara temples (incl. the red-and-white Kedareshwar and a
  golden-spired temple), the half-sunken leaning Ratneshwar temple, the Hazara Deepstambh
  (thousand-lamp pillar), straw umbrellas and takhts, peepal trees, saffron flags, pigeons and kites,
  sacred cows on the terraces and street dogs (solid: lean on a cow and it moves off lowing; a dog
  may follow you for a while, and barks at the Asuras), and the murmur of the crowd around you.
- **Cinematic:** a fight opens on a low shot of the dark rising from the river; the last Asura
  falls in a slow-motion orbit; parries and heavy blows jolt the frame; slow motion muffles the
  world; the low sun flares in the lens; real flame (a CC0 flipbook) on the pyres and sacred fires;
  the talwar is gripped in a closed fist and drawn from the scabbard by hand.
- **The Ganga:** wave simulation shared by GPU and gameplay, planar reflections of the ghats,
  shoreline foam, depth-based clarity, sun glitter, caustics on the river bed, wet stone at the
  waterline, underwater fog and muffled audio, a river current that pushes swimmers and boats.
- **Water mechanics:** wade, swim, dive with a breath meter, climb out onto submerged steps,
  board and row a boat (buoyancy pitch/roll), float diyas, and — after the finale — run on water.
- **Story:** five voiced chapters, one for each flame, told in in-engine cutscenes with captions
  (Gemini-voiced cast: Pandit Shankar, Amma, Acharya Mishra, Kallu, Bhairav Baba, the Raja's
  steward and Andhaka): *The Goddess's Sword* (Assi), *Annapurna's Kitchen* (gather from the gali
  shops, cook to the rhythm, feed the pilgrims), *The Ten Horses* (Ganga jal from mid-river, the
  aarti from the water, defend it), *The Lost Earring* (dive at the leaning temple of Ratneshwar)
  and *Kaal Bhairav's Watch* (follow the spectral hound to the Kotwal of Kashi, cross to Ramnagar
  Fort, and face **Andhaka**, the Blind Darkness, at Panchganga). Each chapter's flame gives a
  lasting blessing.
- **Combat:** a talwar and the fists, motion-captured: 3-hit combos, heavy cuts and kicks that
  run in at a distant enemy and bend down the steps at one below, dodge rolls with a moment of
  grace, guard and parry with slow motion, hit reactions, knockdowns and get-ups, lock-on. The
  **Asuras** (ember-cracked shades, hulking Rakshasas, and Andhaka, three times a man's height with
  three phases and a ground-shaking stomp) rise out of the river, circle, telegraph their blows
  with flaring eyes, take turns, flinch, stagger and burn away. Killing them restores prana.
  Battle music (tabla, dholak, sitar) swells with every fight.
- **The galis and beyond:** shops with Devanagari signs in the lanes behind the ghats, roadside
  shrines to light, Amma's kitchen, the Kaal Bhairav temple (mandapa, bells, the murti in its
  soot-black sanctum) and Ramnagar Fort across the river.
- **River life:** *Nauka Daud*, a boat race against three boatmen through seven marigold gates
  from Dashashwamedh to Panchganga (power strokes on the beat), and the evening **Ganga aarti from
  the water** with lamps set adrift all around. Boats have real oars, the rower's hands on them.
- **Siddhis:** twelve powers on three paths (the Talwar, the Body, the Spirit), offered for with the
  rudraksha you find and the embers slain Asuras leave: a fourth combo blow, ripostes after a parry,
  charged heavy blows, finishers that heal, a longer dodge, more prana, faster swimming, and the
  divine powers.
- **Shakti and the powers:** fight well (blows, parries, dodges through a blow, kills) to fill
  Shakti and spend it on **Shiva's Damaru** (a drumbeat that throws every Asura near you flat), the
  **Trishul** (thrown, it pins an Asura and flies back to your hand) and the **Third Eye** (the
  world slows for everyone but Prady; hidden rudraksha shine through walls).
- **Finishers:** an Asura reeling and nearly spent can be ended with E: a cinematic camera, a
  motion-captured choreography that cannot miss, the last blow in slow motion. Andhaka gets a final
  blow of his own.
- **Readable fights:** a blow or a ball of fire coming from off-screen shows as a chevron at the
  screen's edge, pointing at it (ember, or blue with the colour-blind option); an Asura brought low
  reels a moment, and the finisher's E rises over it.
- **The dark has more faces:** Pishachas hurl ghost fire from afar (parry it back at them),
  Kavachas fight behind bronze shields (heavy cuts and kicks break the guard), Vetalas bound off
  walls and pounce. Chapters II–IV each end with a named champion: Mahodara, Agnimukha, the
  Corpse-Rider of Manikarnika.
- **Rooftops:** vault parapets and low walls at a run, scramble up ledges, climb bamboo ladders
  from the lanes onto the havelis, cross plank bridges between the roofs; a long drop is a roll if
  you land running, and it hurts if you don't.
- **Calls for help:** between missions Kashi asks: chase down a pickpocket, pull someone out of the
  current, defend a boatman from the dark at night, cut a rival's kite string on the rooftops.
- **The journal (J):** a painted map with fast travel to lit flames and honoured shrines and a
  marker for whatever you track, your tasks, the siddhis, and 28 achievements.
- **Journeys:** three save slots with autosave and Continue.
- **Quest:** *The Five Flames of Kashi* (each flame +20% Ganga purity — the river visibly turns
  from murky to clear turquoise), 108 rudraksha beads hidden on ghats, lanes, sand bank and the
  river bed, and the **Maha Aarti** finale with a pillar of light and Ganga's Blessing.
- **Day/night:** sunrise over the river, golden hour, and a night worth staying up for: shader
  fire with embers on every lamp, ~2,300 diyas lighting up along the ghat steps in a wave,
  festival bulb strings on the terraces, temples and palaces, boat lanterns, floodlit carved
  temples, a moon with a silver path on the river, the Milky Way, warm light baked onto the
  stone. After the Maha Aarti every ghat is lit (Dev Deepawali). Pause menu: Dawn / Noon /
  Sunset / Night.
- **The people of Kashi:** ~270 people planned across the ghats and lanes (12 realistic Microsoft
  Rocketbox avatars, 11 motion-capture actions each): pilgrims on the takhts, friends talking,
  bathers taking their dip at dawn, boatmen who wave Prady over, sunrise yoga, strollers who step
  aside for him, priests circling brass lamps at the evening aarti and a crowd watching it. Only
  the nearest 12–42 (by quality preset) get a body, so it costs ~1 ms a frame.
- **Animation:** motion-capture idle/walk/run retargeted onto Prady, speed-matched so feet never
  skate, foot IK on every ghat step, lean and banking, head-look, front-crawl swimming, rowing.
- **Movement:** stairs are smooth ramps for the movement capsule while the feet still plant on the
  real treads, movement follows the ground plane, so walking and running hold their exact speed
  on flats, stairs (up or down) and slopes, with no stalls or stutter.
- **Physics:** fixed 60 Hz simulation with interpolation, acceleration-based movement, buffered
  and variable-height jumps, Gerstner waves, a river current field, spring-damper buoyancy, a
  rigid-body boat with keel drag (it bumps and rocks the moored boats), spring camera with
  sphere-cast collision. Slain Asuras fall as **ragdolls** and tumble down the real steps; clay
  matkas, brass lotas and marigold baskets on the ghats can be shoved, struck, shattered (a sword
  through a matka: shards and spilt water) and thrown by Andhaka's stomp, and whatever reaches
  the Ganga floats, fills, sinks or drifts away; townsfolk stagger when Prady runs into them.
- **Look:** height fog with sun scattering, time-of-day colour grading, Kashi gains colour as the
  Ganga is purified; Gemini-generated carved sandstone, wood and straw.
- **Presentation:** a 40-second in-engine gameplay montage plays while the world loads (skippable,
  "Watch Gameplay" replays it), cinematic intro with narration, compass with flame markers, region titles,
  toasts with mythological lore, photo mode, pause/settings (quality, volumes, sensitivity,
  day speed), autosave + Continue.

## Project layout

```
index.html               page shell (canvas + UI root)
src/main.js              entry point
src/config.js            ALL tunables: world size, ghats, quest, player physics, quality presets
src/core/                Game loop, renderer/post-processing, physics, input, audio, asset manifest
src/world/               WorldLayout (pure data), terrain, ghats, city, temples, props, water, sky, particles, life
src/gameplay/            Player controller, character animation, camera, boats, oars, quest, combat,
                         Asuras, encounters, lock-on, the story (Story.js + chapters/), missions,
                         the boat race, the river aarti, battle music, Chapter Select (TestMenu.js)
src/ui/                  HUD + menus (DOM) and CSS
public/assets/           Every model, texture, sound and image the game loads (files you own)
source-assets/           Full-resolution originals (not shipped in the web build)
tools/                   check-world.mjs, glb-info.mjs, anim-lab.html (measure clips),
                         retarget.html + bake-mocap.mjs (mocap onto Prady), gemini-image.mjs (textures),
                         people.html + bake-people.mjs (the crowd), intro-video.mjs (gameplay montage)
docs/                    ARCHITECTURE.md, AI_HANDOFF.md, ASSETS.md
```

Start with `docs/ARCHITECTURE.md` to understand the code, and `docs/AI_HANDOFF.md` to keep
building it with Claude Opus or Gemini.

## Performance knobs

Pause menu → Graphics quality (Low / Medium / High / Ultra) and Adaptive resolution.
Medium is the default and targets a 16 GB MacBook Air. Presets live in `src/config.js`
(`QUALITY_PRESETS`): pixel ratio, shadow map size, reflection resolution, ambient occlusion,
bloom, SMAA.

## Credits

- Engine: [three.js](https://threejs.org), [Rapier](https://rapier.rs) physics,
  [postprocessing](https://github.com/pmndrs/postprocessing), [N8AO](https://github.com/N8python/n8ao), [Vite](https://vitejs.dev).
- People: [Microsoft Rocketbox avatars](https://github.com/microsoft/Microsoft-Rocketbox) (MIT licence).
- Motion capture: [CMU Graphics Lab Motion Capture Database](http://mocap.cs.cmu.edu) (free for
  any use; BVH conversion by cgspeed) and the three.js example Mixamo clips.
- Generated assets (character, boat, textures, music, sound, narration, key art) were made with
  Genex; the chapter voices, battle music, Bhairav murti and some textures with Google Gemini
  (TTS, Lyria, Imagen). All are files in this repo — see `docs/ASSETS.md`. The game has **no
  runtime dependency** on Genex, Gemini or any online service, and no API keys in the client.
