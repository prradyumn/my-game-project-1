# Architecture

Plain JavaScript (ES modules) + three.js r186 + Rapier 0.21, bundled by Vite. No framework,
no build-time code generation: every system is one readable file.

## Coordinate conventions (read this first)

- Metres, seconds. **+Y up.** Water level is `y = 0` (`WATER_LEVEL`).
- The river flows toward **+X** (downstream = north). The city is on **−Z**, the river and the
  far sand bank on **+Z** (east — the sun rises over the river).
- The bank is a crescent: `bankZ(x) = z0 + curve·(x/halfLen)²` (`src/world/WorldLayout.js`).
- **Bank frame:** `u` runs along the bank, `v` runs from the ghat top edge toward the river.
  `v > 0` = down the steps / into the water, `v < 0` = inland (city). Most placement code uses
  `ghatToWorld(ghat, u, v)` or `frameToWorld(frameAtX(x), u, v)`.
- Characters, temples and buildings face **+Z in local space**; a world yaw rotates them.
  A ghat's `yaw` makes local +Z point at the river.

## Boot sequence (`src/core/Game.js → init`)

1. Start every download in parallel (`Assets.js` manifest): character + clips, boat, textures,
   audio (fetched as ArrayBuffers, decoded after the first click).
2. Rapier init, renderer, scene, camera.
3. Textures → `makeSurfaceSet()` turns each photo into a seamless colour + normal + roughness set.
4. `SkySystem`, `buildWorld()` (terrain, ghats, city, props, boundaries), `Water`.
5. Particles, birds, floating diyas, Prady (`buildCharacter`), boats, `Player`, `Quest`, HUD.
6. Post-processing composer, shader warm-up, title screen. `begin()` runs on the first click
   (unlocks audio) → cinematic intro → `state = 'play'`.

## Frame loop (`Game.update`)

```
handleKeys → sky.update (+ height-fog params) → WORLD_UNIFORMS → water.update
→ player.readInput / boat.readInput                         (once per rendered frame)
→ while (accumulator ≥ 1/60): player.fixedUpdate → boat.fixedUpdate → physics.step
→ boat.lateUpdate(alpha) → player.lateUpdate(alpha)         (interpolated visuals + animation)
→ moored boats, quest (beads, lamps, purity) → camera rig (spring + sphere cast)
→ particles, ripples, birds, diyas → light pool → underwater check → bloom/grade → audio → HUD
then: water.renderReflection(camera) → renderSystem.render(exposure)
```

Physics is a fixed 60 Hz simulation; rendering interpolates between the last two steps, so
movement is identical at 30, 60 or 120 fps.

## Physics & maths at a glance

- **Player:** acceleration-limited ground movement (accel / decel / turn-brake in m/s²), slower
  climbing on steps, jump buffer + coyote time + variable jump height + heavier fall, landing
  impact (camera shake, brief slowdown), wall-velocity removal. Tunables: `PLAYER.move` in config.
- **Ground contact (read before touching Player/Ghats):** each flight of ghat stairs is two
  colliders: exact treads (`GROUPS.tread`, seen by feet IK and ground rays) and one smooth ramp
  through the step nosings (`GROUPS.ramp`, the only thing the movement capsule touches; see
  `core/Physics.js`). On the ground the move is projected onto the ground plane and NEVER pushes
  into the floor in the same controller call: Rapier's controller drops whole steps of movement
  at random when it does (the old "walks in place / uneven" bug). Velocity is only removed for
  real walls (contact normal |y| < 0.4) after 50 ms. Autostep is 0.35 m (curbs only). The body
  glides along the ramp at speed and bobs with the treads when walking (`Player.updateVisual`).
  `tools`-style probe: drive Prady along many paths and compare actual vs commanded speed.
- **Water:** Gerstner (trochoidal) waves with deep-water dispersion `c = √(g/k)`; the CPU height
  query inverts the horizontal displacement by fixed-point iteration so swimmers and boats ride
  exactly the surface you see. `Water.currentAt()` is the river current field: fastest
  mid-river, slack at the banks, following the bank tangent, plus an eddy behind the sunken temple.
- **Swimming:** spring-damper buoyancy (`buoyancyK`, `buoyancyZeta`), drag toward stroke +
  current (the river carries you), 3D dive with neutral-ish buoyancy and a breath meter.
- **Boat:** planar rigid body. Oar strokes are force pulses (one oar to turn), quadratic drag on
  the velocity *relative to the water* (low along the keel, high sideways, so it tracks and
  drifts with the current), yaw damping, heave/pitch/roll as damped springs toward the wave
  surface (load from boarding dips it), bed-gradient collision response with restitution.
- **Camera:** critically damped springs (`smoothDamp`), sphere-cast collision, never sits on the
  waterline, trauma-based shake.
- **Atmosphere:** height fog with sun in-scattering (`world/Atmosphere.js` replaces three.js's fog
  chunks for every material). **Grade:** `core/Grading.js`, split-toning / lift-gamma-gain /
  S-curve / vibrance / grain keyed by sun elevation, vibrance rising with Ganga purity.

## Character animation

1. Clips: motion-capture idle / walk / run baked onto Prady (`prady-mocap.json`, made by
   `tools/retarget.html` with `gameplay/Retarget.js`). Fallback: the Genex walk/run.
2. `CharacterAnimator` blends idle→walk→run by speed, scales playback so the planted foot never
   slides (natural speeds are *measured* from the clips), keeps walk/run on the same foot.
   It restores the mixer's clean pose before every update (three.js skips unchanged bones, and
   procedural edits would otherwise accumulate).
3. `Locomotion` (procedural layer): two-bone foot IK onto the real ground under each foot
   (pelvis drops so the lower foot reaches the lower step), lean into acceleration, bank into
   turns, head looks where the camera looks, front-crawl / sculling / rowing arm strokes.
   Tools: `tools/anim-lab.html` measures any clip (speed, cadence, foot slide, hand placement).

## Modules

| File | Responsibility |
| --- | --- |
| `config.js` | Every tunable. Ghat list, flame lore, player speeds, day length, quality presets. |
| `world/WorldLayout.js` | **Pure data, Node-safe.** Bank curve, ghat profile, `groundHeight()`, `terrainHeight()`, city lot generation, positions of flames, umbrellas, boats, trees, the 108 beads. Deterministic (seeded RNG). |
| `world/Terrain.js` | Height-field mesh (sand/silt + city paving material groups) + Rapier trimesh. |
| `world/Ghats.js` | All treads/risers as one mesh (UVs in metres), one cuboid collider per tread, seam strips, end walls. |
| `world/City.js` | Havelis/palaces/fort/temples from the layout. Windows, balconies and tanks are `InstancedMesh`es. One collider per building. |
| `world/Temple.js` | Procedural Nagara shikhara (lathe + rathas + bands), amalaka, kalash, chhatri domes, full temple builder (takes a Matrix4 so it can lean). |
| `world/Props.js` | Umbrellas+takhts (instanced), lamp posts, aarti platforms, flame pillars, Hazara Deepstambh, sunken Ratneshwar temple, woodpiles, trees, waving flags. Returns flame/lamp/smoke sites. |
| `world/materials.js` | `makeWaterAware()` shader patch: wet darkening at the waterline, caustics and depth tint below water. Shared `WORLD_UNIFORMS`. |
| `world/Water.js` | The Ganga. Near (camera-following, displaced) + far (flat) meshes, analytic waves mirrored on the CPU (`heightAt`, `normalAt`), baked river-bed height texture, planar reflection with an oblique clip plane, purity colours. |
| `world/SkySystem.js` | Preetham sky, sun/moon light, fog keys, stars, moon sprite, PMREM environment refresh, exposure curve. |
| `world/Fire.js` | Shader fire: upright billboard flames (fbm turbulence, blackbody ramp, blue root), halos, rising embers, multi-tongue bowl fires, fade in/out. Thousands of flames in 2 draw calls. |
| `world/Night.js` | Night scene: diya rows (lit in a wave from Dashashwamedh; all ghats after the finale), festival bulb strings, boat lanterns, Milky Way + night-sky dome, baked night light maps (warm lamplight painted onto stone, read by `makeWaterAware`). |
| `world/Particles.js` | GPU smoke, CPU splash droplets, instanced ripples. |
| `world/Life.js` | Bird flocks (vertex-shader wing flaps), floating diyas. |
| `gameplay/Player.js` | Fixed-step kinematic controller (Rapier KCC, autostep for ghat steps). States: ground, air, swim, dive, waterrun, boat. Breath, current, footsteps from foot contacts, lean/bank. |
| `gameplay/CharacterAnimator.js` | Mixer, clip blending by speed, cadence matching, clean-pose restore, derived swim/air clips. |
| `gameplay/Locomotion.js` | Clip calibration + foot IK, lean, bank, head look, swim/row arm strokes. |
| `gameplay/Retarget.js` | Retargets any Mixamo-named clip onto Prady (rest-relative deltas + exact limb directions). |
| `world/Crowd.js` | The people: slots planned from the layout (who, where, doing what, at which hours), a pool of skinned bodies per avatar for the nearest N, behaviours (sit/talk/bathe/boatman/yoga/aarti/stroll), feet IK, head look, aarti arm IK, cloth tint, dithered fade. |
| `ui/IntroVideo.js` | Plays `assets/video/prady-intro.mp4` over the loading screen (muted autoplay + sound button, any key skips). |
| `utils/bones.js` | Rig-agnostic bone maths: world rotations, aim, twist, analytic two-bone IK. |
| `world/Atmosphere.js` | Height fog with sun in-scattering (shader chunk replacement). |
| `core/Grading.js` | Colour-grade post effect + time-of-day / purity presets. |
| `gameplay/CameraRig.js` | Orbit camera with collision ray, zoom, cinematic Catmull-Rom shots. |
| `gameplay/Boats.js` | Boat geometry prep (normalises any GLB), buoyancy (4 hull samples), rowing, grounding, moored instanced boats. |
| `gameplay/Quest.js` | Five flames, purity, Maha Aarti finale, beads (instanced + glow), lamp schedule, save/restore. |
| `core/Renderer.js` | WebGLRenderer + postprocessing (N8AO, bloom, ACES, vignette, SMAA), quality presets, adaptive resolution. |
| `core/AudioManager.js` | Web Audio buses (music/ambience/sfx/voice), HRTF positional sounds, ducking, underwater low-pass. |
| `core/Assets.js` | `ASSET_MANIFEST` — the only place file paths live. Missing files fall back gracefully. |
| `ui/UI.js`, `ui/style.css` | DOM HUD: loading, title, objectives, compass, purity, breath, prompts, toasts, region titles, pause/settings, photo mode, health, lock-on marker, enemy and boss bars, menus (journeys, Chapter Select), story panel, chapter cards, captions, rhythm bar, race panel, stroke ring, countdown. |
| `gameplay/Combat.js` | Prady's fighting: strikes (root motion, approach, run-in dash, tracking, aim pitch toward a target up or down the steps, blade swept between frames), defence (dodge roll with grace frames, guard, parry, hit reactions, knockdown, death / revive), the talwar in hand or scabbard, flinch springs. |
| `gameplay/Health.js` · `Targets.js` · `LockOn.js` | Prady's prana (grace, regen); the registry of everything strikable; lock-on (acquire, switch, camera framing). |
| `gameplay/Asuras.js` · `world/AsuraLook.js` | The Asuras: kinds (shade, brute, boss), the AI (rise → stalk / circle → approach with a token → telegraphed attack → recover; stagger, poise, hit-stun, a pack-wide beat between blows), bodies (Rocketbox + CMU pack, horns, ember-crack shader, eyes, foot IK on the steps), particles, the stomp's warning ring, prana from kills. |
| `gameplay/Encounters.js` · `BattleMusic.js` | Waves at a ghat, the boss's phases, restart after a fall; the fight / boss music loops mixed by intensity. |
| `gameplay/Story.js` · `gameplay/chapters/*` | Chapters as step lists (`prep` for test jumps, `start`, `update`, `interact`, `on`, `stop`, `lightFlame`), cutscenes (camera keys + voiced captions), flame gating, save/restore. `lines.js` holds every voiced line; `kit.js` the placement / camera helpers. |
| `gameplay/Missions.js` · `missions/*` | Side missions, dialogue box, punya, perks, the marker pass (story, missions and race markers in one instanced mesh). |
| `gameplay/BoatRace.js` · `Oars.js` · `RiverAarti.js` | Nauka Daud (course, gates, rival boats steered by a helmsman, stroke timing, standings); oars for every rowing boat with the rower's hands IK'd to the grips; the evening aarti from the water. |
| `gameplay/TestMenu.js` | Chapter Select · Test: every system registers jumps (`add(group, label, sub, run)`); jumps grant what they need and never save. |
| `world/Galis.js` · `Kitchen.js` · `BhairavTemple.js` · `Ramnagar.js` | The lanes and their shops / shrines, Amma's kitchen, the Kaal Bhairav temple, Ramnagar Fort. |

## How to extend (recipes)

- **Add a ghat or move one:** edit `GHATS` in `config.js` (x ranges must tile). Everything —
  steps, colliders, height texture, region names — follows.
- **New quest objective:** add an entry to `SACRED_FLAMES`, give it a site in
  `Props.js → out.flameSites[id]` (position + lamp positions) and a placement in
  `WorldLayout.generateFlames()`. The HUD list and compass pick it up automatically.
- **New interactable:** return `{ prompt, action }` from `Game.currentInteraction()`.
- **New animation:** drop a GLB with a Mixamo-named skeleton into `public/assets/characters/`
  and add it to `ASSET_MANIFEST.character.clips` (`idle`, `swim`, `jump` replace the procedural
  versions automatically). For other verbs, add an action in `CharacterAnimator` and drive its
  weight from `Player` state.
- **New prop model:** put the GLB in `public/assets/models/`, add a manifest entry, load it in
  `Game.init`, place it from layout data (copy the moored-boat pattern for many instances).
- **New sound:** add to `ASSET_MANIFEST.audio`, then `audio.play('name', { at: Vector3 })` or
  `audio.loop('name', { volume })`.
- **Tune the look:** sky/fog/exposure in `SkySystem.js`, water colours in `Water.update`,
  bloom/tone mapping in `Renderer.buildComposer`.

- **New chapter step:** add an object to a chapter's `steps` (`prep(g)` must put the world in
  the state the step needs, so its Chapter Select jump works with nothing done before). Voiced
  lines go in `chapters/lines.js`; render them with `node tools/voice-lines.mjs --key-file …`.
- **New fight:** `game.encounters.start({ ghat, u, waves: [{ n, kind }], onWin })`; register a test
  jump in `Game.registerFightJumps`.
- **New activity:** a class with `interaction()`, `update(dt)` and `stop()`; wire it into
  `Game.currentInteraction`, the update loop and `stopActivities`, and give it a test jump.

## Performance notes

- ~60 draw calls and ~1.4 M triangles at Medium (includes the shadow pass) on the ghats; the boat
  race adds ~10 (rival hulls are one instanced mesh, oars another, three boatmen).
- Everything static is merged per material; repeated things are `InstancedMesh`.
- Reflection pass renders at 33 % (Medium) / 50 % (High) of the screen and reuses the last shadow map.
- Adaptive resolution trims the pixel ratio only when the GPU is the bottleneck and two trimmed
  windows are slow (never below a preset's `minScale`; Very High holds 1.0).
- Props that block the view (straw umbrellas) dither away per instance (`occluderFade`).
- The boat you ride is 23.7 k triangles; moored boats use a 3.5 k LOD (`boat-lod.glb`).
- People: one draw call per body (body + head share an atlas; hair cards add one), shared
  materials per avatar (a private dithered copy only while fading), bodies up on the ghats stay
  out of the water mirror (layer 2), animation at 1/2 or 1/3 rate when far, none off screen,
  shadows only for the nearest few. Budgets: `BUDGETS` in `world/Crowd.js`. `?nocrowd` disables.
