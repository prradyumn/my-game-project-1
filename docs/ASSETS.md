# Assets

Everything the game loads lives in `public/assets/` and is referenced from exactly one place:
`ASSET_MANIFEST` in `src/core/Assets.js` (full-resolution originals are kept in `source-assets/`,
which is not shipped in the web build). The manifest is the
only list the game reads. The files are yours — the game never fetches anything
from Genex or any other service at runtime. Everything else you see (city, ghats, temples,
water, sky, particles, umbrellas, trees, birds) is generated in code.

## What was generated (Genex, Oct 2026)

| Role | File(s) | Made with | Notes |
| --- | --- | --- | --- |
| Prady (hero) | `characters/prady-game-2k.glb` (used) · `source-assets/characters/…-rigged-uthana-glb.glb` (original 4K) | Genex character lane (Meshy mesh, Uthana auto-rig) | 31 k triangles, Mixamo-named skeleton (`mixamorig:*`). The Meshy rigs (`…-rigged-a1/a2`) failed the arm-pose check and are kept only for reference. |
| Walk / run clips | `characters/animate-character-…-walk-forward-….glb`, `…-run-forward-….glb` | Genex character_motion (Uthana) | Root motion is stripped at load; idle, swim and jump are derived from these in code. |
| Boat | `models/boat-game-1k.glb` (ridden) · `models/boat-lod.glb` (moored) · `source-assets/models/traditional-wooden-rowing-boat-….glb` (original) | Genex model lane (Tripo) | Optimised copies made with `@gltf-transform/cli` (resize, simplify). |
| Sandstone | `textures/seamless-tileable-texture-straight-top-d-cmuyhilb.png` | Genex image lane | Made seamless + normal/roughness maps in code (`utils/textures.js → makeSurfaceSet`). |
| Lime plaster | `textures/seamless-tileable-texture-flat-front-on-cmuyhin9.png` | Genex image lane | Tinted per building by vertex colour. |
| River sand | `textures/seamless-tileable-texture-straight-top-d-cmuyhip5.png` | Genex image lane | Riverbed + far bank. |
| Key art | `images/cinematic-key-art-…png` | Genex image lane | Title / loading screen background — also good for your store page and social posts. |
| Music | `audio/seamless-meditative-loop-…mp3` | Genex music (90 s loop) | Tanpura, bansuri, sitar — raga Bhairav mood. |
| Narration | `audio/kashi-older-than-history-….mp3`, `audio/the-five-flames-burn-once-more-….mp3` | Genex voice ("elder") | Intro + finale. Subtitled in the game. |
| SFX | river ambience, aarti ambience, underwater, fire crackle, swim strokes, splash, temple bell, conch, flame ignite, bead chime, footstep, oar stroke, pigeons | Genex sfx | All in `public/assets/audio/`, mapped by role in the manifest. |

| Motion capture (idle, walk, run, sneak, agree, head-shake, soldier set) | `characters/prady-mocap.json` | Mixamo mocap from the three.js example characters (`source-assets/mixamo/Xbot.glb`, `Soldier.glb`), retargeted onto Prady with `tools/retarget.html` | Mixamo animations are royalty-free for use inside your game; don't redistribute them as standalone files. |
| Carved temple sandstone, weathered wood, straw weave | `textures/gemini-*.jpg` (1K) · `source-assets/textures/*-2k.jpg` | Gemini 3 Pro Image via `tools/gemini-image.mjs` | Temples, takhts/balconies/platforms/pyres, umbrella canopies. |

| Asura shades / Rakshasa / Andhaka | `people/Male_Adult_11.glb` + `people/motions-asura.glb` | Rocketbox body (MIT) with the ember-crack shader and horns in code; CMU takes (crouched idle, bent-over walk, sideways sneak, hooks, lunge, overhead chop, reel back, fall) baked by `tools/bake-people.mjs pack` | `PACK_ASURA` in `tools/people-config.js`. |
| Prady's fighting mocap | `characters/prady-mocap.json` (29 clips) | CMU takes (boxing, swordplay, kicks, rolls, a backward hop, falls, a get-up) via `tools/retarget.js` | Every take picked from contact sheets (`tools/mocap-sheet.html`) and measured with `tools/bvh-measure.mjs`. |
| Prady's traversal mocap | `characters/prady-moves.json` (vault, scramble, ladder) | CMU 141_08 (a running leap), 01_02 (a playground climb), 13_33 (stepping up, arms forward) via `tools/retarget.js ?set=moves` (`node tools/bake-mocap.mjs moves`) | A second file so the first is never rewritten. |
| More Asura motion | `people/motions-asura2.glb` (fall, getUp, leap, block) | CMU 90_18, 140_08, 141_08, 135_10 via `tools/bake-people.mjs pack:asura2` | Thrown flat by the Damaru and up again, the Vetala's leap, the Kavacha's guard. |
| A sprint for the crowd | `people/motions-mx.glb` (run) | The three.js Xbot Mixamo run, `tools/bake-people.mjs pack:mx` | The pickpocket's run (grown men of the crowd). |
| Chapter voices (61 lines) | `audio/voice/ch1…ch5/*.mp3` | Gemini 2.5 Pro TTS via `tools/voice-lines.mjs` (cast in `chapters/lines.js`) | Each line transcribed back and checked against its text. |
| Battle music | `audio/battle-ghats-loop.mp3`, `audio/battle-andhaka-loop.mp3` | Gemini Lyria via `tools/gemini-music.mjs`, cut to 48 s seamless loops (crossfaded on the bar, padded with their own wrapped audio; `ASSET_MANIFEST.battleMusic.*.loop`) | Tabla, dholak, sitar; Andhaka's darker. |
| Asura sounds | `audio/sfx/asura-*.mp3`, `audio/sfx/andhaka-roar.mp3` | Genex sfx, pitched / levelled copies (originals beside them in `audio/`) | |
| Cow and street dog | `animals/cow.glb`, `animals/dog.glb` · originals in `source-assets/animals/` (model, rig, walk) | Genex model lane (Tripo) → `model rig --type quadruped` → `model animate --preset walk` | 19 k / 15 k triangles, one in-place walk clip (2.6 s) each; baked to 1K WebP + meshopt with `@gltf-transform/cli` (resize → meshopt → webp), 11 MB → 0.6 MB. Front yaw, scale and stride in `ASSET_MANIFEST.animals`. |
| The fight, recorded | `audio/sfx/blade-hit-lv.mp3`, `blade-whoosh-lv`, `heavy-whoosh-lv`, `parry-clang`, `block-impact`, `body-hit`, `heavy-hit`, `shield-clang` | Genex sfx (originals in `source-assets/sfx/`), trimmed and peak-levelled with ffmpeg | Replace the synthesized sounds of the same names (`AudioManager.synth` keeps the synth only as a fallback). The `-lv` copies (also `slowmo-boom-lv`, `cow-moo-lv`) are the first levelling brought up 15–37 dB to peak with the rest: `blade-hit.mp3` peaked at -41 dBFS, so the sword was all but silent in a fight. The quiet originals stay beside them. |
| Cinematic stingers | `audio/sfx/slowmo-boom.mp3`, `braam.mp3`, `riser.mp3`, `victory.mp3`, `heartbeat.mp3`, `title-shimmer.mp3` · `slowmo-swell.mp3` (the heavy whoosh reversed, made with ffmpeg) | Genex sfx | Finisher slow motion and last blow, a champion's / Andhaka's coming, the Third Eye, a fight won, low prana, a chapter's title. |
| Ghat life sounds | `audio/sfx/crowd-murmur.mp3` (20 s loop), `cow-moo.mp3`, `dog-bark.mp3`, `dog-yelp.mp3` | Genex sfx | The crowd murmur follows how many people are near (Game.updateAmbience). |
| Real flame (fire flipbook) | `textures/fx/flame-16x4.webp` · original `source-assets/fx/unity-labs-SmallFlame01_16x4.png` + `LICENSE-unity-labs-vfx.txt` | Unity Labs' free VFX flipbooks (CC0, 2016) | 64 frames of simulated flame, re-encoded to WebP (323 KB). The big fires in `world/Fire.js`. |
| Real PBR sets: lime plaster, weathered planks | `textures/pbr/white_rough_plaster_*_1k.jpg`, `textures/pbr/weathered_brown_planks_*_1k.jpg` (colour, GL normal, AO/rough/metal packed in R/G/B) · licence `source-assets/textures/polyhaven/LICENSE.txt` | **Poly Haven** (CC0) API, loaded by `utils/textures.js → pbrSet()` (`ASSET_MANIFEST.pbr`) | Haveli plaster (contrast and level flattened so the per-building tint still reads) and the wood of takhts, balconies and boats. `sandstone_blocks_08` is downloaded but unused: the generated sandstone reads better on the ghats. |
| Navmesh (where things can walk) | `nav/kashi.navmesh.bin` (1 MB, 0.26 MB gzipped) · `nav/kashi.navmesh.json` (the collider signature it fits) | Baked from the world's own colliders by `npm run bake:nav` (recast-navigation, MIT) | Dogs, cows and Asuras path round obstacles. Re-bake after any layout or collider change. |
| The score: dawn, day, evening and night ragas, tension, reveal | `audio/score/*.mp3` (128 kbps; ~14 MB, fetched after the game begins) · 160 kbps masters `source-assets/music/score-*-lyria.mp3` | Lyria 3.5 via `tools/gemini-music.mjs`, each checked by ear (Gemini listening: instruments, percussion, glitches) | `gameplay/Score.js`. Dawn Bhairav on bansuri, day Desh on sitar and santoor, evening Yaman on sarangi and harmonium, night Malkauns on low bansuri and esraj (~3 min each, natural fade-outs); tension trimmed to 2 min; reveal 62 s, its peak at 31–39 s. |
| Crowd barks (30 lines) | `audio/barks/*.mp3` (800 KB) | Gemini 2.5 Pro TTS via `tools/gemini-tts.mjs`, voices none of the story characters use; each checked by ear for the speaker (man / woman, the -m / -f in its id) and the words | `world/Barks.js`, groups in `ASSET_MANIFEST.barks`. Banarasi Hindi: chai, kachori and flower sellers, pilgrims, boatmen, a priest's mantra, a dhobi; "Arre, dhyan se!", "Talwar! Hato!", "Asur! Bhago!", "Shabaash, beta!". |
| Kaal Bhairav murti | `images/gemini-bhairav-murti-v2.jpg` (2K original in `source-assets/images/`) | Gemini 3 Pro Image | The relief in the temple's sanctum. |
| Trailer music (not in the game) | `source-assets/music/trailer-lyria.mp3` (94 s) | Lyria 3.5 via `tools/gemini-music.mjs` (one of three takes; Gemini listening rated it 9/10) | The trailer's three acts: bansuri wonder, rising threat to a pause at 52 s, battle from 55.9 s (~159 bpm). The cut is in `tools/trailer/edl.mjs`; the trailer itself is in `marketing/trailer/`. |

The texture lane was down at the provider while building, so the three surfaces came from the
image lane and are processed into PBR sets in the browser instead.

## Replacing or adding assets without Genex (free sources)

| Need | Free source | How it plugs in |
| --- | --- | --- |
| More animations for Prady (idle, swim, jump, sit, namaste, fight…) | **Mixamo** (free Adobe account). Best: export Prady to FBX in Blender, upload to Mixamo, auto-rig, then download each animation "without skin" and convert FBX → GLB in Blender. | Add each clip to `ASSET_MANIFEST.character.clips`. Names `idle`, `swim`, `jump`/`fall` replace the procedural versions automatically. Bones are already `mixamorig:*`, so clips made for Prady's rig bind by name. Always check the result in-game: clips made on a different Mixamo body can look slightly off. |
| NPCs (pilgrims, sadhus, boatmen) | Mixamo characters, **Quaternius** (CC0), Ready Player Me | Load like Prady (`Game.buildCharacter`), drive them with simple waypoint scripts. |
| Props / buildings | **Poly Haven** (CC0), **Kenney** (CC0), **Quaternius** (CC0), Sketchfab (check each licence) | GLB into `public/assets/models/`, add a manifest entry. |
| Textures | **Poly Haven**, **ambientCG** (both CC0, full PBR sets) | Point `ASSET_MANIFEST.textures.*` at the colour map; `makeSurfaceSet` derives the rest, or load the real normal/roughness maps instead. |
| Sky HDRI | Poly Haven HDRIs (CC0) | Load with `RGBELoader`, set `scene.environment`. |
| Music / SFX | Freesound (check CC licence per sound), Pixabay Audio, Sonniss GDC bundles | mp3/ogg into `public/assets/audio/`, add to the manifest. |

## Adding more motion capture (smooth, no extra cost)

1. Download any Mixamo animation (free Adobe account) as FBX, convert it to GLB (Blender:
   File → Import FBX → Export glTF Binary), and put it in `source-assets/mixamo/`.
2. Add it to `SOURCES` in `tools/retarget.js` (`{ url, clips: { myName: 'clipNameInFile' } }`).
3. With `npm run dev` running: `node tools/bake-mocap.mjs` → rewrites `prady-mocap.json`.
4. Use it: map a role in `ASSET_MANIFEST.character.mocapClips`, or play it from code by name.
   Check it in `tools/anim-lab.html?mocap=myName&mode=play`.

## The people (crowd)

- Bodies: 12 Microsoft Rocketbox avatars (MIT) in `source-assets/rocketbox/`, chosen and given a
  role in `tools/people-config.js`. Motions: the Xbot Mixamo idle/walk/agree/headShake plus CMU
  takes (talk, sit, sitChin, wash, wait, stretch, wave), each with a hand-picked loopable segment.
- `npm run dev` then `npm run bake:people [AvatarId]`: retargets every motion onto each avatar
  (`gameplay/Retarget.js`, Biped bone map), welds the mesh, packs body + head into one texture
  atlas, exports GLB, then gltf-transform meshopt + WebP → `public/assets/people/*.glb`
  (~0.8–1.3 MB each). The game loads them lazily after the title screen (`world/Crowd.js`).
- Preview: `tools/people-view.html?id=Male_Adult_15` (every clip side by side).
- Prady's extra CMU clips (wave, stretch, lookAround) are baked by `tools/retarget.js` into
  `prady-mocap.json` (`npm run bake:mocap`).

## The gameplay video

`npm run dev` then `npm run video:intro` (or `--preview` for three stills per shot,
`--edit-only` to re-cut from the captured clips). It drives the real game shot by shot on a
virtual 30 fps clock (Playwright + Chrome), overlays the captions, logs the game's own sound calls
and rebuilds the soundtrack with ffmpeg → `public/assets/video/prady-intro.mp4` (+ poster).
Shots, captions and camera paths are in `tools/intro-video.mjs`.

## Generating textures with Gemini

```bash
GEMINI_API_KEY=... node tools/gemini-image.mjs --out public/assets/textures/my-surface.png \
  --prompt "Seamless tileable texture, straight-on orthographic photo of ..., flat even lighting, no shadows, no text"
```
Keep a 1K copy in `public/assets/textures/` (the game derives normal + roughness maps itself) and the
2K original in `source-assets/textures/`. Never put the key in game code.

## Tools

- `node tools/glb-info.mjs file.glb` — node tree, skeleton names, animations.
- `npx @gltf-transform/cli inspect file.glb` — triangles, textures, sizes.
- `npx @gltf-transform/cli resize in.glb out.glb --width 1024 --height 1024` — shrink textures.
- `npx @gltf-transform/cli simplify in.glb out.glb --ratio 0.2` — make a LOD.

Keep models under ~30 k triangles each and textures at 1–2 K for the MacBook Air target.
