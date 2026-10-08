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
| E | Interact: talk · take · light a sacred flame · board / leave the boat · advance dialogue |
| Mouse left / right | Strike (click again for a 3-hit combo) / heavy strike |
| Q (hold) or middle mouse | Guard; raise it just before a blow lands to **parry** |
| C / Ctrl | Dodge roll (with a direction) on land · dive in the water |
| Tab | Lock on to an Asura (flick the mouse to switch) |
| R | Draw / sheathe the talwar |
| Space (boat race) | Power stroke: press it as each oar stroke begins |
| J / M | Journal · meditate |
| F | Float a diya on the river (Deep Daan) |
| G | Greet: Prady waves and the people nearby answer |
| X | Toggle walk |
| N | Time-lapse to night (or back to dawn) |
| P | Photo mode (hides HUD, `[` `]` change time of day) |
| F9 | Screenshot of the game view (no HUD) saved to Downloads |
| ⌘ / ⌥ (Cmd / Option) | Free the mouse without pausing (for ⌘⇧4 screenshots or another window); click the game to look again |
| Esc | Pause / settings |
| Mouse wheel | Camera distance |

Gamepad works too: left stick move, right stick look, A jump, B dodge / dive, X interact, Y draw
/ sheathe, RB strike, RT heavy, LB guard, R3 or LT lock on, Start pause. Menus take the d-pad.

**Chapter Select · Test** (title screen and pause menu): jump straight into any chapter step, fight,
side mission or river activity with nothing required first. Test sessions never touch your saves.

**Debug mode:** open `http://localhost:5173/?debug` — `1` lights all flames (finale),
`2` skips an hour, `3` teleports to the next flame, `4` toggles Ganga's Blessing. FPS/draw-call
counter is always shown in debug.

## What's in the game

- **Kashi, 1 km of it:** ten ghats in a crescent (Assi → Panchganga), ~440 walkable stone steps,
  194 procedural havelis/palaces/a fort, 7,000+ windows (lit at night), balconies, rooftop
  chhatris and water tanks, six Nagara temples (incl. the red-and-white Kedareshwar and a
  golden-spired temple), the half-sunken leaning Ratneshwar temple, the Hazara Deepstambh
  (thousand-lamp pillar), straw umbrellas and takhts, peepal trees, saffron flags, pigeons and kites.
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
  rigid-body boat with keel drag, spring camera with sphere-cast collision.
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
