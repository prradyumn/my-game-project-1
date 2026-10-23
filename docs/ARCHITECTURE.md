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
- **Collision groups (`core/Physics.js → GROUPS`):** besides people / tread / ramp / prop /
  ragdoll / camera-only, `ledge` (chhajjas: stood on and hung from, the camera looks past them)
  and `decor` (balconies: stop his body and refuse a climb, the camera looks past them). Every
  default collider is a member of every group, so "only the balconies" cannot be a filter:
  `Physics.sphereCastOnly(…, GROUPS.decor)` tests the membership with a predicate instead.
- **Atmosphere:** height fog with sun in-scattering (`world/Atmosphere.js` replaces three.js's fog
  chunks for every material). **Grade:** `core/Grading.js`, split-toning / lift-gamma-gain /
  S-curve / vibrance / grain keyed by sun elevation, vibrance rising with Ganga purity.

## Character animation

1. Clips: motion-capture idle / walk / run baked onto Prady (`prady-mocap.json`, made by
   `tools/retarget.html` with `gameplay/Retarget.js`). Fallback: the Genex walk/run. The game
   loads `prady-mocap-v2.json` / `prady-moves3-v2.json`: the same, with five clips whose takes went
   through Unreal Engine's IK Retargeter instead (less foot slip; docs/ASSETS.md, "Retargeting
   through Unreal Engine").
2. `CharacterAnimator` blends idle→walk→run by speed, scales playback so the planted foot never
   slides (natural speeds are *measured* from the clips), keeps walk/run on the same foot.
   It restores the mixer's clean pose before every update (three.js skips unchanged bones, and
   procedural edits would otherwise accumulate).
3. `Locomotion` (procedural layer): two-bone foot IK onto the real ground under each foot
   (pelvis drops so the lower foot reaches the lower step), lean into acceleration, bank into
   turns, head looks where the camera looks, front-crawl / sculling / rowing arm strokes.
   **Foot locks** (`footLock`): while a planting action plays (`play(name, { plant: true })`: the
   turns, the brake, the idle breaks) and while standing in the idle, a foot that is down and still
   is pinned to the stone where it stands and IK'd there; the pin lets go when the clip lifts the
   foot (higher than the other by 3 cm), when the body is carried 32 cm off it, or (once no pose is
   blending) when the animated foot travels. So the idle's wide stance never slides the feet apart.
   The idle → walk blend is eased over a few frames (the brakes stop a walk in 0.06 s).
4. `Footwork` (prady-moves3.json): **turns on the spot** — standing, the stick pushed > 57° off his
   facing: a CMU quarter turn (two for a half) whose turning was baked *out* of the take
   (`Retarget rootYaw`: the hips' facing per frame, smoothed over 0.3 s, removed and kept in
   `rootMotion.yaw`) and is put back by turning `Player.yaw` along the same curve, the clip's time
   set from the same interpolation as his facing, so the planted foot stays put (slip ≈ 5 cm over a
   whole turn, from ~45 cm when he spun). **The brake** — let go at a run: the CMU 16_08 plant,
   entered on the foot that comes down next, its speed curve driving `Player.velocity` (quickened
   up to 1.85× for a sprint, the path stretched for the rest), never over a step edge or the river.
   It never owns the body: Player moves as ever; Footwork only scales his target speed, sets his
   velocity while braking and turns him.
   Tools: `tools/anim-lab.html` measures any clip (speed, cadence, foot slide, hand placement).

## Modules

| File | Responsibility |
| --- | --- |
| `config.js` | Every tunable. Ghat list, flame lore, player speeds, day length, quality presets. |
| `world/WorldLayout.js` | **Pure data, Node-safe.** Bank curve, ghat profile, `groundHeight()`, `terrainHeight()`, city lot generation, positions of flames, umbrellas, boats, trees, the 108 beads. Deterministic (seeded RNG). |
| `world/Terrain.js` | Height-field mesh (sand/silt + city paving material groups) + Rapier trimesh. |
| `world/Ghats.js` | All treads/risers as one mesh (UVs in metres), one cuboid collider per tread, seam strips, end walls. |
| `world/City.js` | Havelis/palaces/fort/temples from the layout. Windows, balconies and tanks are `InstancedMesh`es. One collider per building, plus one `GROUPS.ledge` box per chhajja (the climbable ledges up every haveli front) and one `GROUPS.decor` box per wooden balcony (blocks his body and the climbs, never the camera). |
| `world/Temple.js` | Procedural Nagara shikhara (lathe + rathas + bands), amalaka, kalash, chhatri domes, full temple builder (takes a Matrix4 so it can lean). |
| `world/Props.js` | Umbrellas+takhts (instanced), lamp posts, aarti platforms, flame pillars, Hazara Deepstambh, sunken Ratneshwar temple, woodpiles, trees, waving flags. Returns flame/lamp/smoke sites. |
| `world/materials.js` | `makeWaterAware()` shader patch: wet darkening at the waterline, caustics and depth tint below water. Shared `WORLD_UNIFORMS`. `surfaceMaterial()` takes real PBR sets (colour, normal, AO/rough/metal packed in R/G/B, `utils/textures.js → pbrSet`). Every surface gets geometric specular anti-aliasing (roughness widened by the screen-space variance of the normal: no sparkle on far ghats at any resolution). `shiny()` registers a metal in `METALS` so `SkySystem` keeps its own environment map and intensity (brass and gold that actually reflect). |
| `world/Water.js` | The Ganga. Near (camera-following, displaced) + far (flat) meshes, analytic waves mirrored on the CPU (`heightAt`, `normalAt`), baked river-bed height texture, planar reflection with an oblique clip plane, purity colours. From Medium up (`REFRACT`): `grab()` blits the colour and depth already drawn into its own target as the water starts to draw (no second render; through three's state cache), and the surface bends what is under it and absorbs it per channel along the ray (`uAbsorb`, `uScatter`: silt olive, turquoise when pure); it writes alpha 1. The detail normals ride a flow map baked from `currentAt` (two phases crossfaded; `setEddy` rebakes it), scum streaks drift with it; GGX sun road widening with distance plus facet glints; light through the crests (`uSSS`); foam where the water meets things (from the grabbed depth); lapping at the steps (`LAP_GLSL`, matched by the wet line in materials.js). Diagnostics: `?norefract`, `?noblur`. |
| `world/Grass.js` | The wild banks. `GrassField`: a carpet of grass tufts round the camera (one instanced draw on a grid that moves a cell at a time; placed, sized, tinted and thinned in the vertex shader from the river-bed height map and a baked `grassAt` map; wind, gusts, parts round Prady, a few in flower). `WildBank`: kans grass with feathered plumes and leafy scrub on the far bank and past the ghats. `addGrassGround`: the sand under the grass turns to earth. |
| `world/ShivaStatue.js` | Shiva in meditation on a stepped plinth in the river past Assi (Genex model from a generated reference image), a causeway to the bank, Nandi facing him, floodlit at night (`floodlit`) with a ring of lamps; `setDetail` swaps the stand-in and the streamed full model. |
| `world/Trees.js` | Sacred peepal trees (Genex) at Assi, on the wild banks and the far bank; canopies sway; each tree wears the full model within 190 m once it is streamed in, else the stand-in. |
| `world/Weathering.js` | The monsoon on the city's walls in the shader: rain streaks under the sills and from the roofs, grime and a damp line at street level, patchy repaint, rubbed edges (`?noweather` to compare). |
| `core/ContactShadows.js` | Screen-space contact shadows (the small sharp ones the shadow map misses: feet, pots, the gap under a takht): from each pixel a short ray toward the sun through the depth buffer, before the tone map; strength follows the sun (`?nocontact`). |
| `world/Clouds.js` | Volumetric cumulus 1.3-2.9 km up: a 64³ Perlin-Worley noise made on the GPU at load, raymarched at a third of the render size with a fresh jitter each frame and blended with the last frames (reprojected by direction), lit by the sun through the cloud (Beer, powder, two-lobe phase) and by the sky; composited on a dome after the opaque world; the river's mirror keeps the sky's flat clouds (`Water.onReflect`; `?noclouds`). |
| `core/Streaming.js` | Level streaming: heavy models load as light stand-ins with the game; `Streamer.add({ near, far, url, apply, drop })` fetches the full model in the background as Prady comes within `near` and frees it beyond `far` (twice a second). |
| `world/WaterRipples.js` | The river's ripples round Prady: a 256² height field over 32 m (the wave equation on the GPU, 24 Hz), disturbed through `Water.disturb(x, z, r, strength)` (Game's fx: splash, wade, ripple, bump; Prady wading or swimming, the boat's bow), turned back off the steps by the river-bed height map; idle (cleared, unstepped) 8 s after the last stir. |
| `world/SkySystem.js` | Preetham sky, sun/moon light, fog keys, stars, moon sprite, PMREM environment refresh, exposure curve. |
| `world/Fire.js` | Fire: the little lamps are shaded teardrops (fbm turbulence, blackbody ramp, blue root); torches, aarti lamps, the sacred bowls and the pyres (`kind 'pyre'`) burn real flame from a CC0 flipbook (64 frames cross-faded, each tongue its own frame and pace, crossed for a body). Halos, rising embers, fade in/out. Thousands of flames in 2 draw calls. |
| `world/Night.js` | Night scene: diya rows (lit in a wave from Dashashwamedh; all ghats after the finale), festival bulb strings, boat lanterns, Milky Way + night-sky dome, baked night light maps (warm lamplight painted onto stone, read by `makeWaterAware`; on festival nights each lit tread is painted at its own height). |
| `world/DiyaField.js` | Dev Deepawali: a diya on every step of every ghat (~60k at High and up, 65% at Medium, 35% at Low), clear paths down each flight, mandalas of rings on the landings. One `Points` draw: each sprite is a flame over its clay cup, premultiplied (ONE, ONE_MINUS_SRC_ALPHA) so the flame adds light and the cup occludes in the same pass; far ones are points of light with their energy kept constant as they shrink. Sized per render target in `onBeforeRender`, flipped in the river's mirror (layer 0, so the mirror draws them). Lit in a wave from Dashashwamedh at 48 m/s. ~1 ms a frame at Very High seen from the river. |
| `gameplay/Festival.js` | Dev Deepawali tonight (`quest.complete`, the test menu, or `?deepawali`): at dusk a conch, the establishing shot down the river front as it lights, `Score.festival()`, floating diyas from every ghat near him, and `Fireworks.show()` once the last ghat is lit (36 rocket slots: ~16 up during the show, an 18-shell finale). |
| `gameplay/Footwork.js` | Turning on the spot and braking out of a run (see Character animation, 4). |
| `world/Particles.js` | GPU smoke, CPU splash droplets, instanced ripples. |
| `world/Life.js` | Bird flocks (vertex-shader wing flaps), floating diyas. |
| `gameplay/Player.js` | Fixed-step kinematic controller (Rapier KCC, autostep for ghat steps). States: ground, air, swim, dive, waterrun, boat. Breath, current, footsteps from foot contacts, lean/bank. |
| `gameplay/CharacterAnimator.js` | Mixer, clip blending by speed, cadence matching, clean-pose restore, derived swim/air clips. |
| `gameplay/Locomotion.js` | Clip calibration + foot IK, lean, bank, head look, swim/row arm strokes. |
| `gameplay/Retarget.js` | Retargets any Mixamo-named clip onto Prady (rest-relative deltas + exact limb directions). |
| `world/NavMesh.js` · `tools/navmesh-bake.js` | Where things can walk: a Recast navmesh (recast-navigation, WASM, its own lazy chunk) baked offline from the static colliders the player walks on (world boxes, cylinders, the terrain and the stair ramps; never treads, people, props, chhajjas or balconies; nothing under the river's surface; only what joins the ghats, the islands pruned). `Navigation`: `path()`, `snap()` (a point onto walkable ground), `constrain()` (a step slid along obstacles, `moveAlongSurface`). `PathFollower`: one walker's way to a goal, re-planned on a timer or when the goal moves; returns null (steer straight, as before) while the navmesh isn't loaded, off it, or at the end of a way that stops short. The game checks the bake's collider signature at load and walks without it if the world changed. |
| `world/Barks.js` | The crowd's voices: now and then someone really there calls out (vendors, pilgrims, boatmen, a priest at the aarti, a dhobi), a man's line from a man and a woman's from a woman, positional; and the crowd answers Prady: barging past at a run, running up a wall nearby, drawing the talwar near people, Asuras rising (two frightened voices), the last one falling (cheers, with a wave). Groups and lines in `ASSET_MANIFEST.barks`. |
| `world/Animals.js` | The ghats' cows and street dogs (`ANIMALS` in config): one skinned clone each with the walk clip and a rest-pose clip blended by speed (the walk's rate keeps the hooves planted), a tail, head and neck moved by hand over it, body pitched on the steps. Solid (a kinematic box, `Physics.addMover`): a cow leaned on lows and steps aside, a dog sprinted into yelps and runs, a dog may follow Prady a while; dogs bark at Asuras and bolt from them, cows amble off; `startle()` (the Damaru). Every walk, flee, way home and follow goes round the takhts and walls on the navmesh, and each step is kept on it (`Navigation.constrain`). Hidden and still beyond `viewDist`, half-rate past 40 m, skipped by the river's mirror. |
| `world/Crowd.js` | The people: slots planned from the layout (who, where, doing what, at which hours), a pool of skinned bodies per avatar for the nearest N, behaviours (sit/talk/bathe/boatman/yoga/aarti/stroll), feet IK, head look, aarti arm IK, cloth tint, dithered fade. |
| `ui/IntroVideo.js` | Plays `assets/video/prady-intro-5m.mp4` over the loading screen (muted autoplay + sound button, any key skips). |
| `utils/bones.js` | Rig-agnostic bone maths: world rotations, aim, twist, analytic two-bone IK. |
| `world/Atmosphere.js` | Height fog with sun in-scattering (shader chunk replacement). |
| `core/Grading.js` | Colour-grade post effect + time-of-day / purity presets; the dread (desaturate, cold green shadows, vignette closing with the heartbeat) and Grahan's blood moon; photo filters. **Cinematic look** (`settings.look`, default): `filmPrint()` after the grade — dye crosstalk, hue secondaries (greens to olive, blues to azure-teal, magentas fade, warm hues and skin richer), a luminance S-curve about a low mid grey with print density, saturation falling away in the deepest shadows and the top fifth (not on sky blues), split casts (teal shade, amber highlights kept off the sky and the cool cast mostly off skin), tinted lifted black and warm paper white, a luma-masked vignette. `FILM` holds a print per sun elevation; `Game.placeMood()` multiplies in the place's mood (lanes, burning ghats, open river), eased over seconds. |
| `core/Impact.js` | The jolt of a blow: chromatic split + a radial streak toward the impact, in its own pass that is off unless a pulse is running (`Renderer.setImpact`). |
| `gameplay/CameraRig.js` | Orbit camera with collision ray, zoom, cinematic Catmull-Rom shots. Climbing view (lower, closer, squared to the wall, looking up it; the mouse takes it back for 1.6 s); a blow's `kick(dir, amount)` (a stiff positional spring + roll, out and back in ~0.1 s); lock-on framing in tight on the two fighters. |
| `gameplay/Boats.js` | Boat geometry prep (normalises any GLB; a quantised meshopt model's integer positions are turned back into floats before its transform is baked in: `floatAttributes`), buoyancy (4 hull samples), rowing, grounding, moored instanced boats. |
| `gameplay/Quest.js` | Five flames, purity, Maha Aarti finale, beads (instanced + glow), lamp schedule, save/restore. |
| `core/Renderer.js` | WebGLRenderer + postprocessing (N8AO, bloom, ACES, vignette, SMAA), quality presets, adaptive resolution. The canvas is the screen's native resolution; the composer's buffers are sized to the render resolution (`renderSize()`, `pixelRatio`) and `core/Upscale.js` (clamped Catmull-Rom) is the last pass. Shaders: `compile()` builds them with a render target bound (the variant actually drawn), `prewarm()` compiles new scene content in the background, `keepPrograms()` never frees a compiled program. |
| `core/Upscale.js` | The final pass: render resolution up to the screen's, instead of the browser's bilinear stretch. |
| `core/AudioManager.js` | Web Audio buses (music/ambience/sfx/voice), HRTF positional sounds, ducking, underwater low-pass. `cue()`: a piece played once (a music cue) with a handle to fade it and know when it ended. |
| `core/Assets.js` | `ASSET_MANIFEST` — the only place file paths live. Missing files fall back gracefully. The GLTFLoader decodes meshopt geometry and KTX2 (Basis UASTC) textures (`useRenderer()` tells the KTX2 transcoder what this GPU samples; models fetch at once and parse once the renderer exists). The models load from `assets/opt/` (meshopt copies made by `tools/optimise-models.mjs`; the originals beside them are untouched). |
| `ui/UI.js`, `ui/style.css` | DOM HUD: loading, title, objectives, compass, purity, breath, prompts, toasts, region titles, pause/settings, photo mode, health, lock-on marker, enemy and boss bars, menus (journeys, Chapter Select), story panel, chapter cards, captions, rhythm bar, race panel, stroke ring, countdown. |
| `gameplay/Combat.js` | Prady's fighting: strikes (target choice scored by `Targets.best`: distance, angle off the aim, an Asura winding up a blow first, the last foe struck kept over a slightly nearer one; the next strike of a combo buffered from 0.15 s into the current one; root motion, approach, run-in dash, tracking, aim pitch toward a target up or down the steps, blade swept between frames), defence (dodge roll with grace frames, guard, parry, hit reactions, knockdown, death / revive), the talwar in hand or scabbard (a real grip: the wrist cocked, the fingers closed and the thumb wrapped, the hilt seated in the fist; drawn and sheathed by hand with arm IK along the scabbard's line), flinch springs. Combo strings: `tree()` maps the presses so far (L light, R heavy) to the next blow and its art (`ARTS`: the HUD's names); presses during a blow or a run-in are queued in order (`queue`, `feed`). The arts: `aoe` hits strike everyone within a radius (`sweepHit`), `teleport` blinks onto (or through) the target first, `echo` sends shadows to cut it again (`echoStep`), the air combo hangs him at the top of the leap after a launch (`airStart` / `airStep`, `Player.gravScale`); `critRoll` makes criticals (×1.5, CRITICAL over the number). |
| `gameplay/Health.js` · `Targets.js` · `LockOn.js` | Prady's prana (grace, regen); the registry of everything strikable; lock-on (acquire, switch, camera framing). |
| `gameplay/Asuras.js` · `world/AsuraLook.js` | The Asuras: kinds (shade, brute (ground `slam`: unblockable, warned by a ring, cleared by a roll or by being in the air), Pishacha (ranged fire; a `volley` of three, a beat apart), Kavacha (bronze shield: light blows glance off, heavy blows break it), Vetala (hops, clings to walls with a hiss, pounces), boss; any as a named champion with `mini`), the difficulty (`DIFFICULTY`), floored / pinned / held states, the AI (rise → stalk / circle → approach with a token → telegraphed attack → recover; stalking and approaching from afar follow the navmesh round walls, takhts and whole blocks of havelis; stagger, poise, hit-stun, a pack-wide beat between blows), bodies (each kind's sculpted villain from `ASSET_MANIFEST.enemies.villains`, or the Rocketbox body; the CMU pack carried onto each; horns / armour / cloth materials, ember-crack shader, eyes, Andhaka's second pair of arms following the first, foot IK on the steps; `prewarm()` readies them all a few seconds into play), particles, the stomp's warning ring, prana from kills. |
| `tools/blender/villain.py` · `tools/villains.js` · `tools/bake-villains.mjs` | The villains: sculpted in Blender from code (metaball anatomy on the Rocketbox skeleton, horns / tusks / claws / spines / armour / cloth, normal + cavity baked, skinned by bone heat), then the Asura motions retargeted onto each. See docs/ASSETS.md. |
| `gameplay/Encounters.js` · `BattleMusic.js` | Waves at a ghat, the boss's phases, restart after a fall; the fight / boss music loops mixed by `Score.fight`. |
| `gameplay/Score.js` | The score. `festival()`: Dev Deepawali's own cue (conch, shehnai, dhol), then on festival nights it alternates with the night's raga. Exploring: the hour's raga (dawn Bhairav, day Desh, evening Yaman, night Malkauns; the old meditative loop in the dawn/day rotation) played as a cue, then 55–130 s of the ghats alone; a cue also comes in at a moment (a first visit, the sun coming up or going down). Danger layered over it: Asuras up but none on him → the tension cue; one within 16 m (or a blow given or taken) → `fight`, which BattleMusic plays, the tension falling away. `reveal()` / `endReveal()`: the establishing-shot swell. |
| `gameplay/Establishing.js` | First-visit establishing shots (once per journey, kept in the save's `world.places`): a ghat from the river, craning up its steps to the city; the river, a wide pan along the crescent; the lanes, a crane straight up out of the gali. A new chapter (II–V) opens the same way on its flame's place, instead of the bare card. Bars, a long lens's focus, the name and a line of its story lower left (`ui.establishTitle`), the swell (at most every 5 minutes; else the hour's cue). Played through `Story.scene` (any key skips); only when nothing else is going on; never in test sessions (Chapter Select has an Establishing shots section to preview them). |
| `gameplay/Story.js` · `gameplay/chapters/*` | Chapters as step lists (`prep` for test jumps, `start`, `update`, `interact`, `on`, `stop`, `lightFlame`), cutscenes (camera keys + voiced captions), flame gating, save/restore. `lines.js` holds every voiced line; `kit.js` the placement / camera helpers. |
| `gameplay/Missions.js` · `missions/*` | Side missions, dialogue box, punya, perks, the marker pass (story, missions, race and rooftop-run markers in one instanced mesh). A task that fails (`run.fail(reason)`; `{ retry: false }` for one set aside or out of time) offers "Try again" for 14 s: `again()` warps him to its giver and starts it. The dark ones: `AndheriGali.js` (lamps that die, the diya in the hand, shades, a Vetala, echo footsteps, whispers), `Masan.js` (the Aghori's dhuni, pyres to light, prets that move only unseen: `asura.unseen`), `DrownedSanctum.js` (a ruin under the river, breath vents, a lamp to place, the Naga). |
| `gameplay/BoatRace.js` · `Oars.js` · `RiverAarti.js` | Nauka Daud (course, gates, rival boats steered by a helmsman, stroke timing, standings); oars for every rowing boat with the rower's hands IK'd to the grips; the evening aarti from the water. |
| `gameplay/Ragdoll.js` | A fallen body given to physics: eleven Rapier bodies (hips, chest, head, arms, legs) joined at the neck, shoulders, elbows, hips and knees, launched by the killing blow, tumbling down the real treads; the bones are written back from the bodies each frame. Used for every Asura's death. |
| `world/PhysicsProps.js` | Loose pots, lotas and flower baskets: Rapier bodies only near Prady (created asleep, retired at rest), shoved by anyone walking into them, struck by blows (a sword breaks a matka into shards and spilt water), thrown by Andhaka's stomp, floating / filling / sinking and drifting in the river; impact sounds made in code. |
| `gameplay/TestMenu.js` | Chapter Select · Test: every system registers jumps (`add(group, label, sub, run)`); jumps grant what they need and never save. |
| `gameplay/Siddhis.js` | The skill tree: twelve siddhis on three paths (`config.js SIDDHIS`), paid for with rudraksha in hand (found − offered) and embers (`EMBERS` per kill). `apply()` pushes what is owned into Combat (`perks`), Health (max prana), Player (swim, breath) and Powers (fill rate). Saved per journey. |
| `gameplay/Powers.js` | The Shakti meter (filled by hits, parries, dodges through blows, kills) and the three powers: Shiva's Damaru (a drumbeat shockwave: Asuras `floor()`), the Trishul (thrown on a clear line, `pin()`s, flies back to the hand, recall early), the Third Eye (`AsuraSystem.timeScale` slows them, beads shine through walls). Owns the body while casting (`fixed()` before Combat). |
| `gameplay/Cinematics.js` | The film around the game: impact pulses (parries, heavy blows, the finisher's last cut, the Damaru), slow motion's hush (`AudioManager.setMuffle`), the breathing lens (sprint / slow motion), a fight's intro shot (low over his shoulder, rack focus to the river), the last kill's orbit cam, the low sun's lens flare (occlusion-tested), dust motes catching the light. Shots use `CameraRig.override`, the letterbox bars and depth of field, and ease back with `blendFrom`. |
| `gameplay/Finishers.js` | E on a reeling, nearly spent Asura: a cinematic camera (`CameraRig.override`) and a choreography of Prady's own strikes played through `Combat.forceMove()` (they cannot miss; a dash closes the gap first), the pack held back (they step off to watch, away from the camera; the held one never moves), the last blow in slow motion into a ragdoll, then the shot eases back into the follow camera (`CameraRig.blendFrom`) and the lock-on moves to the next. Andhaka and the champions get a final blow. |
| (combat feel) | A landed blow: Prady's hit-stop is shared with the victim (`Asura.freeze`: its animation and knock-back held), held longer on a combo's last cut and a kill; the lens kicks along the cut (`CameraRig.kick`) and shakes on every hit; heavy / final / killing blows punch the FOV in (`Cinematics.impact` → `punch`); a kill with more Asuras standing gets a 0.16 s slow-motion beat; a cut's sweep turns the body about its spine (`Asura.twist`, a spring); a combo's last cut floors a shade or a pishacha (the rest reel); the parry glint (`Asura.glintCheck`): a four-point star off the striking hand and a thin shimmer at the instant the difficulty's parry window opens (none on a stomp). |
| `gameplay/Projectiles.js` | The Pishachas' ghost fire: led shots on a shallow arc, burst on stone, hiss out in the river, dodged / blocked / parried (a parry sends it back at its thrower). One Points draw. |
| `gameplay/Traversal.js` | Vault (low walls, parapets, takhts at a run; over a parapet with a lower roof across the slot beyond, `roofBeyond()`, the vault carries him out over the gap and he drops onto it), scramble (ledges 1.05–2.9 m, hands IK'd to the edge), bamboo ladders and plank bridges between rooftops, built from the layout (a plank that would be steeper than ~25° parapet to parapet becomes a ramp, its low end back on the lower roof's floor; every third is a balance beam; planks bow under him: `plankSag`). Prince-of-Persia moves: **wall run** (Space at a wall too tall to scramble, at a run or pressed against it: the run cycle up the face, leaning back, then both arms up), **ledge hang** (`ledgeAhead()` finds a wall top or a lip standing out from the face, like a chhajja; caught from a wall run or at the top of any jump, `airGrab()`), **shimmy** (A / D along the ledge, hands stepping, stopped by its end, a pillar or a balcony), **swing** (the catch swings the body in on a pendulum about the hands, kept clear of the wall by the room measured under the edge), **leap up** (W / Space with a ledge 1.5–2.6 m above on the same face: ~0.6 s hand over hand, the old hands letting go and the new ones IK'd onto the edge), **drop down** (S with a ledge below), **kick off** (S + Space: away from the wall, turned round), **mantle** (W / Space with nothing above: pull, hips over the lip, stand, palms IK'd onto the top; also the ground scramble's move) and **let go** (C, or S with nothing below). The climb camera rises with him and looks up the face. Stand points are kept 0.36 m off the wall and `Player.clearWall` eases the model back if a pose carries the head or chest into it. Chhajja by chhajja, any haveli front climbs to its roof. `Player.state = 'climb'` while a move places the body (`Player.climbLean` tilts it during a wall run).
  - **Grip:** hands on the top, palms down, wrists over the lip (`edgeHand` / `edgeGrip`, `Grip.js` 'top').
  - **Hanging from the hands:** `hangFromHands()` moves the body toward the edge when a clip's shoulders drop past arm's reach.
  - **Braced or free:** braced where the face under the edge is within `BRACE` of the lip (feet IK'd onto the stone, stepping with the shimmy), free otherwise.
  - **Clips:** each move plays its Mixamo clip (`hangAnim()`, `playTimed()`: braced/free hang and shimmy loops, the catch, hop up, drop, climb up) and keeps the CMU stand-ins when that clip is missing. |
| `world/Blood.js` | Blood (red) and Asura ichor (maroon-black with cooling embers): droplets thrown along the blow under gravity (some splash back), splats where they land on the real tread (shrunk at a step's edge), pools under fallen bodies; wet then drying over a minute, washed by rain (`wash`, per splat). Droplets reaching Prady stain him. Settings: Blood (full / stylised / off). Two instanced draws. |
| `gameplay/Bloodied.js` | Prady's stains: up to 24, fixed in his skin's rest pose (world point → rest through the nearest bone, as one composed matrix: the bones' ~1e-4 scale breaks step-by-step inverses), ragged, wet to dry, ichor embers that cool; the blade's own stain from the tip down. Whatever is under the Ganga rinses off (a red cloud drifts away), rain rinses slowly. |
| `ui/ComboHUD.js` | The string being played, right side under the style rank: a mouse glyph per press and the art's name when the presses make one. |
| `world/Afterimages.js` | Ghosts of Prady (the shadow-step, the shadows' cuts, the run-in): his skinned mesh redrawn with a frozen copy of one frame's bone and bind matrices, a Fresnel tint, pooled. |
| `ui/StyleMeter.js` | The hit count and style rank (Veer → Mahakaal): variety, powers, parries and counters raise it, repetition and time drain it, a hit taken drops it; its level lifts the battle music. Settings: Combo and style rank. |
| `ui/OffscreenWarn.js` | A pulsing mark at the screen edge toward an Asura winding up a blow out of view (red if unblockable), with a quiet cue. |
| Combat (modern techniques) | Freeflow: the stick picks the next target up to 8.5 m off (`pickTarget(camYaw, stickYaw)`); multi-counter: a parry turns aside every wind-up within 3.2 m; hit-confirm: a blow that bit cancels 0.08 s sooner, a whiff 0.06 s later; instant movement cancel; launcher (heavy with jump held) → `Asura.launch` → a strike leaps after it (`chase`) into the plunge; pyre kills (`Fire.pyres`, `Asura.pyreKill`); aim assist and auto-combo settings. Victim hit-shake in the hit-stop (Asuras.late), the lens wider in a run-in and with a pack round him and a zoom-blur through dashes and heavy swings (Cinematics), a music dip on heavy blows (`AudioManager.hitDuck`). |
| `world/StoneDetail.js` | The ghat stone without a visible repeat (two offset reads blended, Quilez), broad colour variation, worn pale step edges and crease grime (from the surface's bend, faded with distance), moss and silt above the water line. `?nostone` to compare. |
| `core/Haze.js` | The haze lit by the lamps: a 12-step march per pixel to the first surface (≤30 m) through haze thick on the water, up to 12 lamps (Game's nearest), each glowing out to ~8 m. HDR, before the bloom. ~0.3 ms. |
| `world/Vegetation.js` | Grass in clumps at the foot of the buildings behind each ghat (placed by rays once the colliders answer: `plantGrass`), reeds along the far bank and the unpaved banks; swaying with the world's wind (uGust). Two instanced draws. |
| `world/Decals.js` | Cracks, paan, oil, soot (Manikarnika), kumkum handprints, an Om, rangoli on the sacred landings: one 1024² sheet painted in code at load, one instanced draw. |
| `world/CharacterShading.js` | Prady's skin (told by its colour) warm in its shadows; the white dhoti's sheen at grazing angles. `?noskin` to compare. |
| `world/AmbientLife.js` | Moths round the nearest lamps at night, ash drifting off the nearest pyre on the wind, incense threads from a shrine near him. Two Points draws, animated in their shaders. |
| Size | `vite.config.js` leaves out of dist the 38 source models the game never loads (44 MB); the intro has an AV1 copy (17 MB vs 25, `IntroVideo.js` picks it when the browser plays AV1); the score has Opus copies (28% smaller; `AudioManager.fetchBuffer` falls back to the MP3). Smoke and embers drift with the wind (`VFX.wind`). |
| `core/Painterly.js` | The Painterly look (Settings: Look): a Kuwahara oil-paint pass (5×5 neighbourhood, four quadrants, weighted to the calmest), a soft ink line on strong edges, canvas tooth. Its own pass before the upscale, off unless chosen. |
| `world/RimLight.js` | `addRim(material, k)`: a view-angle rim of light on Prady and the Asuras; `RIM` colour and strength set each frame by Game from the sky (cool by day, warm lamplight at night). |
| `world/GroundDetail.js` | Petals, marigold heads, leaves and leaf-plate scraps on the ghat steps, in clusters, thickest where people gather, at the back of each tread. One InstancedMesh. |
| `ui/DamageNumbers.js` | The damage of a blow as a numeral that pops and drifts up from where it landed (saffron; gold for heavy blows; larger for a kill). Settings: Damage numbers. |
| `gameplay/HitReact.js` | Physical hit reactions: torque from the blow on each joint between the hit point and the hips, springs back to the clip; heavy blows leave the arms limp under gravity a moment. |
| `world/Fracture.js` | A hollow shape cut once into surface-Voronoi pieces with thickness and broken walls (the matkas break into their own shards: PhysicsProps). |
| `gameplay/LipSync.js` | A voice line's audio read into a 60 fps jaw track; the speaking crowd actor's jaw follows it (`g.voice(key, who)`). |
| `gameplay/SiddhiMode.js` | The sandbox (test menu): every power, endless Shakti, no death, a respawning pack, a panel of every move, clip and effect. |
| `gameplay/CameraRig.js` (combat) | `fightAt`: closer, lower, over whichever shoulder has room; `punch()` on heavy hits; a slow handheld breath when standing still. |
| `core/AudioManager.js` (echo) | A convolution reverb send on sfx and voice, set by `setRoom(k)` from how closed-in the listener is (Game casts rays four times a second). |
| `world/VFX.js` | The big moves' light: pooled, additive, drawn only while alive.
  - **Pieces:** `shockwave` (a ring racing over the ground with glowing cracks), `yantra` (a mandala drawn on the ground in light), `slash` (a crescent or a ring of flame), `lightning` (a forked bolt, re-struck), `sparks` (one instanced mesh of streaks), `flash`, and `trail` (a ribbon behind the talwar or a kicking shin, fed each frame by `Combat`), `stars`, `pillar`, `debris`, `sigil` (the Fab crystal star drawn on the ground).
  - **Flipbooks** (`flipbook`, and on top of it `explosion`, `fireburst`, `smoke`, `smokeColumn`, `dirt`): camera-facing sprite sheets from `ASSET_MANIFEST.fx.sheets`, frames cross-faded. Glow sheets are additive; smoke and dust are blended and lit by `vfx.light` (the sky's light, set by `Game` each frame) so they sit right by day and by night, while their fire glows by itself. Sheets standing on the ground fade out along their bottom edge.
  - **Decals** (`decal(name, p, r0, r1, o)`, from `fx.decals`): Fab textures laid on the ground like the yantras, growing and turning (Trishul's electric ring, the dust ring of a slam, the Third Eye's spell circle). Also `zaps`, `flare`, `slashMark` (heavy cuts, finishers) and `embers`.
  - **Fab masks** (`fx.masks`, one RGB texture): R is the knife-light streak in `trail`, G the torn-energy erosion in `slash`, B the `sigil` star. The shaders use their own noise until it loads.
  - **Users:** `Powers` (the Damaru's yantra and shockwave, the Trishul's lightning trail and strike, the Third Eye's crimson yantra, Agni Chakra), `Combat` (trails, hit sparks), `Game` (parry sparks and impact frames), `Finishers`, and the Asuras' slam.
  - **Impact frames:** `ImpactEffect` turns the picture into a two-tone ink panel for a beat (`Cinematics.impactFrame`), never with Reduce flashes. |
| `gameplay/SpringBones.js` · `gameplay/Drapes.js` | Spring bones.
  - **The chain:** `SpringChain` is a verlet chain under a body bone. It has drag, a pull back to its rest pose, gravity, a swing limit and spheres riding the legs, and runs in fixed 60 Hz steps.
  - **Helpers:** `chainFromPoints` builds the bones; `rigCloth` re-weights a skinned cloth mesh's hanging part onto chains; `makeDrape` builds a pleated two-sided panel on a chain.
  - **Prady:** `Drapes` gives him the dhoti's front pleats and the sash's end, coloured from his texture and updated after every pose (`Game` calls `drapes.update`).
  - **Villains:** their loincloths are rigged in `Asuras.loinSprings`. Geometry is shared per kind, and the joints are kept in `geometry.userData.loinSpec`. |
| `gameplay/WorldEvents.js` | Calls for help between missions (one at a time, never over a story scene, fight or race): the pickpocket chase, someone drowning, the night ambush at the boats, the rooftop kite duel, Grahan (the blood moon: `game.grahan`, three waves). |
| `gameplay/Dread.js` | The fear layer: `want(key, level)` from any system, `threat()` per Asura; a heartbeat (62 → ~130 bpm, haptics), a drone, the grade's dread and the camera's sway. |
| `gameplay/HandDiya.js` | A diya carried in the hand: the wrist IK'd before the chest, its flame a light; shades fear it (`fearAt`), gusts and water put it out (`shy`, `windK`), any flame relights it (`extraSources`). |
| `gameplay/Grip.js` | Hands that hold: `orient()` turns a hand so the palm faces what it holds (the palm's frame measured once from the rig), `grip()` curls the fingers round a rung (`'bar'`, thumb wrapped back) or over an edge (`'ledge'`). Used by Traversal and Parkour after the arm IK. |
| `gameplay/Parkour.js` | Ropes from the waterfront roofs across the lane to the next row (E at the high end: slide, Space lets go), bamboo swing poles in the wider gaps (a pendulum: W pumps, Space releases tangentially), wall jumps (Space in the air beside a wall: a short planted push then a scripted flight), the beam's balance (arms out by IK, speed capped). |
| `gameplay/RoofRun.js` | Chhat Daud: the rooftop time trial (start flag on the ghat below the clearest climbing column of the first haveli, a flag on each of five roofs, the race HUD, R restarts, a fall sends him back). The chhaya: 20 Hz samples of his root and 22 body bones, quantised into `localStorage` (~180 KB a run) and replayed on a cloned skinned mesh in a shadow-and-gold rim material (one draw call). Best time and splits in the save (`world.roofRun`). |
| `gameplay/Guide.js` | Flow: one-time hint cards (`HINTS`: hang, ladder, rooftops, beam, swing, rope, wall jump, swimming, the glint, finishers, lock-on, the hand diya; the keys as bound; kept in `localStorage`; Settings → First-time hints) and the way back up (roof spots sampled while he stands on one; a fall of more than 6 m offers E for 8 s: `Game.warp()` back up). |
| `gameplay/Achievements.js` | 28 achievements, kept across journeys in `localStorage` (`lov-achievements`); systems report `event(name, data)`. Never earned in test sessions. |
| `core/Haptics.js` | Gamepad rumble (`play(name)` with dual-motor presets), off in Settings or on a keyboard. |
| `core/Input.js` (`ACTIONS`) | Rebinding: the game asks for default codes; `setBindings()` translates the player's keys into them (Controls screen in the pause menu swaps on conflict). |
| `ui/Journal.js` | J: the map (canvas: river, ghats, havelis, marks; track / fast travel), tasks, the three paths of siddhis, achievements. |
| `world/Galis.js` · `Kitchen.js` · `BhairavTemple.js` · `Ramnagar.js` | The lanes and their shops / shrines, Amma's kitchen, the Kaal Bhairav temple, Ramnagar Fort. |

## How to extend (recipes)

- **Changed the layout or any static collider?** Run `npm run bake:nav` with the dev server up
  (it rewrites `public/assets/nav/kashi.navmesh.*`). Until then the game warns in the console and
  its walkers steer straight, as they did before the navmesh.
- **Make something climbable:** give its ledge a collider through `physics.addBox(…, GROUPS.ledge)`
  (thin and level: Traversal finds the lip by itself, the camera ignores it). Anything on a
  facade that he must never climb through (a balcony, a sign) is a `GROUPS.decor` box.

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
- **New loose prop:** add a kind to `KINDS` in `world/PhysicsProps.js` (collider size, mass, buoyancy, sound) with a geometry function, and place it in `place()`. Loose things use `GROUPS.prop` (they rest on the exact treads, never the walking ramps); a ragdoll uses `GROUPS.ragdoll`.
- **New activity:** a class with `interaction()`, `update(dt)` and `stop()`; wire it into
  `Game.currentInteraction`, the update loop and `stopActivities`, and give it a test jump.
- **New Asura kind:** an entry in `ASURA_KINDS` (stats, attacks, `vein` / `skin` / `eye` colours,
  flags like `ranged`, `shield`, `leaper`) and any new attack in `ATTACKS`; its clips are roles in
  `ASSET_MANIFEST.enemies.roles`. A wave `{ kind, mini: true, name, title }` makes it a champion.
- **New siddhi:** an entry in `config.js SIDDHIS` (path, cost); give its effect in `Siddhis.apply()`
  (and read it where it acts, e.g. `combat.perks`).
- **New call for help:** a def in `WorldEvents` (`can(force)` finds a spot here or null, `begin`,
  `update`, `interact`, `stop`), plus a test jump in `Game.registerExtraJumps`.
- **New achievement:** add it to `ACHIEVEMENTS` and earn it in `Achievements.event()` from
  wherever it happens (`game.achievements?.event('name', data)`).
- **New rebindable key:** add it to `ACTIONS` in `core/Input.js`; keep asking for its default code.
- **New first-time hint:** an entry in `Guide.HINTS` (`id`, `when()` a cheap test, `title`, `text()`
  using `k(actionId)` for the key), or `game.guide.hint(id, title, text)` from anywhere.
- **Optimise a model:** `node tools/optimise-models.mjs <path under public/assets>` (needs the
  packages named in its header) writes a meshopt copy to `public/assets/opt/`; point the manifest
  at it and A/B it on screen. `--ktx` also tries KTX2 textures behind a PSNR/SSIM gate.

## Performance notes

- ~60 draw calls and ~1.4 M triangles at Medium (includes the shadow pass) on the ghats; the boat
  race adds ~10 (rival hulls are one instanced mesh, oars another, three boatmen). Measured
  2026-10-11 at Ultra on Dashashwamedh, per frame: the main view 64 draws, the sun's shadow map 44
  (redrawn every frame), the river's mirror 36, post-processing ~30 full-screen passes.
- Models are meshopt-compressed (27 GLBs, 24.8 → 19.2 MB). KTX2 textures were measured and left
  out: they would quarter the video memory but triple the files (`tools/optimise-models.mjs`).
- Everything static is merged per material; repeated things are `InstancedMesh`.
- Reflection pass renders at 33 % (Medium) / 50 % (High) of the screen and reuses the last shadow map.
- Adaptive resolution trims the pixel ratio only when the GPU is the bottleneck and two trimmed
  windows are slow (never below a preset's `minScale`; Very High holds 1.0).
- Colliders match what is drawn: `node tools/floor-audit.mjs` walks every floor Prady can stand on
  (physics, several layers per column) and finds visible geometry rising out of it (GPU, top-down,
  clipped per texel to knee height), clustered with the object's name. Run it after adding
  anything he can walk on or into; at ground level only the bobbing moored hulls (~0.2 m) remain.
- Props that block the view (straw umbrellas) dither away per instance (`occluderFade`); the saris on the dhobi lines do the same per pixel (StreetLife's cloth shader, the same `OCCLUDE` focus points).
- The boat you ride is 23.7 k triangles; moored boats use a 3.5 k LOD (`boat-lod.glb`).
- People: one draw call per body (body + head share an atlas; hair cards add one), shared
  materials per avatar (a private dithered copy only while fading), bodies up on the ghats stay
  out of the water mirror (layer 2), animation at 1/2 or 1/3 rate when far, none off screen,
  shadows only for the nearest few. Budgets: `BUDGETS` in `world/Crowd.js`. `?nocrowd` disables.
