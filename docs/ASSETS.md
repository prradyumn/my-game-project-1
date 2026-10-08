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
| Chapter voices (61 lines) | `audio/voice/ch1…ch5/*.mp3` | Gemini 2.5 Pro TTS via `tools/voice-lines.mjs` (cast in `chapters/lines.js`) | Each line transcribed back and checked against its text. |
| Battle music | `audio/battle-ghats-loop.mp3`, `audio/battle-andhaka-loop.mp3` | Gemini Lyria via `tools/gemini-music.mjs`, cut to 48 s seamless loops (crossfaded on the bar, padded with their own wrapped audio; `ASSET_MANIFEST.battleMusic.*.loop`) | Tabla, dholak, sitar; Andhaka's darker. |
| Asura sounds | `audio/sfx/asura-*.mp3`, `audio/sfx/andhaka-roar.mp3` | Genex sfx, pitched / levelled copies (originals beside them in `audio/`) | |
| Kaal Bhairav murti | `images/gemini-bhairav-murti-v2.jpg` (2K original in `source-assets/images/`) | Gemini 3 Pro Image | The relief in the temple's sanctum. |

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
