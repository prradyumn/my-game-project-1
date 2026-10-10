# Trailer pipeline

How `marketing/trailer/The-Legend-of-Varanasi-Trailer.mp4` was made, and how to re-cut it. Every shot
is the game itself running at Ultra in headless Chrome. The game clock is stepped by hand, one frame at
a time, so nothing drops or stutters however slow the machine is. Edit, grade, titles and mix are
plain ffmpeg.

Work files (captured frames, clips, mixes; about 6 GB) go to `$TRAILER_WORK`. The default is
`$TMPDIR/varanasi-trailer`, which keeps them out of the repo.

## Steps

```sh
npm run dev                               # the game on :5173 (the rig captures from it)
node tools/trailer/scout.mjs /tmp/scout sunrise hero    # quick stills of shots (N=5 for five each)
node tools/trailer/render.mjs sunrise hero:blur fight1:blur …   # final takes, 1920x1080
sh tools/trailer/clips.sh                 # frames -> clips/*.mp4 (+ a contact sheet each)
node tools/trailer/titles.mjs             # title cards (transparent PNG sequences)
node tools/trailer/export-sounds.mjs      # the engine's synthesized rain, thunder, sword sounds
sh tools/trailer/prep-audio.sh            # voice-over cut from the game's lines, effects levelled
node tools/trailer/build.mjs --preview    # 960 px quick cut;  without --preview: the master
```

## Files

| File | What it is |
|---|---|
| `rig.mjs` | Capture rig. Runs the game at Ultra on a manual clock. It has a spline camera (`T.cam`) and drives Prady, the weather, the hour and key presses. `rec()` saves 30 fps; a `name:blur` take saves 60 Hz sub-frames, blended into motion blur. |
| `shots.js` | Every shot: set-up, camera, and timed beats such as lightning, sword draws and Damaru casts. Also holds the fight bot, plus profile and orbit cameras that stay out of walls and the river. |
| `edl.mjs` | The edit: cut times, source in-points, grade, letterbox framing, voice-over, beds and one-shot effects. Edit this file to re-cut. |
| `build.mjs` | Builds the edit with ffmpeg in two passes, sound (seconds) then picture. Applies the grade, the 2.39:1 bars and film grain. The sound is ducked under the voice and the hits, then given one static gain to -14 LUFS. `STEM=music\|vo\|fx` renders a single stem. |
| `titles.html` / `titles.mjs` | Title cards in the game's own type (Cinzel, Marcellus, Tiro Devanagari). |
| `music/hits.mjs`, `music/tempo2.mjs` | Find the drum hits and tempo that the cuts land on. |
| `watch.mjs` | Ask Gemini to watch or listen (`--key-file`; the key never goes in game code). On long videos it misjudges sound, so check short audio excerpts instead. |

The music is `source-assets/music/trailer-lyria.mp3`, made with Lyria 3.5 through `tools/gemini-music.mjs`.
