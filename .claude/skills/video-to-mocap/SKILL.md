---
name: video-to-mocap
description: Turn a video (or still) of one person into an animation clip on Prady's skeleton with Motion2MixamoRig (GVHMR), then bake it into the game. Use when the user wants a new move or pose for Prady (a sword form, a dance, a pranam), has filmed one, or asks for motion from a video. Not for crowd/Asura bodies (those are Rocketbox: tools/bake-people.mjs).
---

# Video → motion capture for Prady (Motion2MixamoRig)

Tool: `~/Desktop/PradyAnim/ext/Motion2MixamoRig` (github.com/MaxLiu22/Motion2MixamoRig, cloned
2026-10-12, Apache-2.0 code). Its own Python 3.11 venv is at `.venv` (made with `uv`). The CLI is `m2mr`.
It runs GVHMR (world-grounded human mesh recovery) on the video. The result is SMPL-X joints,
retargeted onto any Mixamo-named FBX. Prady's rig is Mixamo-named.

## Licences: say these before using a result in the game
- **GVHMR** (the weights and the `gvhmr` PyPI package, a community repackaging by ryanrudes) is for
  "educational, research and non-profit purposes only". Commercial use needs permission from
  Zhejiang University (xwzhou@zju.edu.cn).
- **SMPL-X** (required, `assets/body_models/smplx/SMPLX_NEUTRAL.npz`): MPI-gated and non-commercial
  by default. **Only the user can register and download it** at https://smpl-x.is.tue.mpg.de/.
  Never fetch it from a mirror.
- So: fine while the game is free and non-profit. If it is ever sold, these clips need commercial
  licences or re-capture with a commercial tool.
- Input video: only the user's own footage, or clips under a licence that allows it (e.g. Mixkit).
  Test clips already in `assets/video/`: Mixkit 49634 (round kick) and 49635 (punches).

## Run (what actually works, 2026-10-12)
```bash
cd ~/Desktop/PradyAnim/ext/Motion2MixamoRig && source .venv/bin/activate
GVHMR_BODY_MODELS=$HOME/Desktop/PradyAnim/ext/body_models_padded \
  m2mr run --video assets/video/<clip>.mp4 --rig assets/mixamo/Prady.fbx
```
- **Body model:** the user's SMPL-X download is a stripped variant (no hand PCA, no landmarks).
  - `body_models_padded/` holds a copy with those fields zero-filled. That is exact, because GVHMR runs flat hands without PCA.
  - Keep the `GVHMR_BODY_MODELS` override. Never change the user's own file.
- **Weights:** about 3 GB, already downloaded. Expect a few minutes for 6 s of video on the M5.
- **Only use the extraction.** It writes `outputs/<run>/skeleton_motion.npz` (24 SMPL joints, Y up, metres).
  - m2mr's own retarget then fails on Prady with "rest FK mismatch".
  - Its FBX parser accepts only FBX files as Mixamo's website exports them; Blender FBX fails.
  - Ignore that failure. The game's own path is better.
- **Video rules:** exactly one person, head to toe in frame the whole time, a steady camera, good light.

## Into the game
1. Convert the joints:
   `python ~/Desktop/PradyAnim/Scripts/npz_to_json.py outputs/<run>/skeleton_motion.npz "<repo>/source-assets/m2mr/<clip>.json"`
2. Add an entry to `VIDEO` in `tools/retarget.js`, then run `node tools/bake-mocap.mjs video`. This writes `source-assets/m2mr/prady-video.json` (not shipped).
   - Each entry has a name, the file, start and end, and `rootMotion` / `strike` like the CMU entries.
   - `tools/joints-to-clip.js` poses Prady from the joints: hips from the pelvis frame, every bone aimed along its joint pair, the chest twisted to the shoulders.
   - Then `retargetClip` shapes it like any other clip.
3. To cut a move, find its peak from the joints (e.g. the highest ankle for a kick).
   - Set `start` and `end` around it, and `strike.t` = peak − start.
   - In `Combat.js` MOVES: hits `t` = that time in clip seconds; `ts` scales the speed.
4. Check before adopting:
   - Render it beside the source frames (scratchpad `ue/ab.mjs` pattern).
   - Land it on a shade in game with `combat.start(name, true, asura)`, with Prady on the shade's level. `forceMove` is the finisher path and deals no damage itself.
5. Merge into a NEW clip file: `node tools/merge-clips.mjs <base> source-assets/m2mr/prady-video.json <new> <clip>`. Then point the manifest at it.

### Judging a take (do this before cutting)
- Bake the whole take as a preview: `VIDEO_PREVIEW`, `node tools/bake-mocap.mjs videoPreview`.
  Render source frames beside Prady at chosen times (scratchpad `ue/pvsheet.sh` pattern: the
  video frame over the posed character, the camera following him).
- Sanity-check the joints: proportions, pelvis travel, head below the pelvis for inversions. Find
  events from them: a wrist at full reach for punches, the highest ankle for kicks.
  - Named takes lie. "cartwheels" (41017) holds handstands; the "backflip" (1222) also has a cartwheel at 3.9–5 s.
  - A punch peak can be a strike angled down to the floor (karate 7.47 s), not a body shot.
- Handheld or beach footage: horizontal travel is noise, so bake in place and let the game move him.
- Floor drift: pass `floor: true`, which measures the floor from the lowest ankle in the span.
- Jumps: monocular capture loses flight height.
  - `air: { from, to, speed }` rebuilds the flight as a ballistic arc (rise g·T²/8).
  - `speed` is the take's slow motion: 2 for Mixkit 1222.
- Measure against the clip it would replace: scratchpad `ue/ab.mjs`, with PAIR for renamed clips.
  Jitter is RMS of the 2nd difference in cm/f²; slip is planted-toe travel.
- Then land it in game: `combat.start(name, true, asura)`, the strike and the damage.
- A new clip needs registering three times:
  - the `ASSET_MANIFEST.character.anims` entry;
  - the `CharacterAnimator` clip list;
  - a MOVES entry (or the dodge).

Shipped (`prady-mocap-v4.json`):
- `roundKick` (Mixkit 49634): the heavy. Jitter 0.24 cm/f², against 0.8 for the CMU kick.
- `sideKick` (12971, 1.6–3.3 s): head-high, the end of every other bare-handed combo.
  - Jitter 0.54 against 0.96 for the front kick; slip 44 against 84 cm.
  - Lands at 1.5 m.
- `backFlip` (1222, 5.95–8.2 s, floor + air at 2× slow motion): the no-direction dodge.
  - Dur 1.0 s; travels 2.4 m only between 12% and 72% of the move.

Rejected:
- Kata and karate punches (formal snap-and-hold; the one-two had jitter 7.25).
- 21756 walljump (degenerate extraction).
- 41017 (no cartwheel in it).

## Related, not usable yet
- DirtyMoCap (WangLongZJU, SIGGRAPH Asia 2026) cleans noisy optical-marker capture into SMPL-H.
- As of 2026-10-12 its repository has no code ("Code will be released here").
- It needs marker data (e.g. CMU's raw C3D files), not video. Revisit if the code ships.
