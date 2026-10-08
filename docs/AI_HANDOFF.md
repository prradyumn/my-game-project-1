# Continuing PRADY with Claude Opus or Gemini

This project was built so any capable coding model can pick it up: plain JS modules, one system
per file, all tunables in `src/config.js`, all asset paths in `src/core/Assets.js`, and a pure
data layout (`src/world/WorldLayout.js`) you can test in Node.

## Context to give the model

- **Claude Code / Claude Opus:** opens `CLAUDE.md` automatically.
- **Gemini CLI:** opens `GEMINI.md` automatically.
- **Any chat model (API or web):** paste `README.md`, `docs/ARCHITECTURE.md` and the 2–4 source
  files the change touches. Don't paste the whole repo; the architecture doc is the map.

## The loop that keeps it stable

1. Make **one feature per session** and say which files it may touch.
2. `npm run check:world` — layout invariants (no overlapping buildings, beads above ground…).
3. `npm run build` — must finish with no errors.
4. `npm run dev`, open `http://localhost:5173/?debug`, and play the feature yourself. Keys `1`–`4`
   skip to the finale, change the time, teleport to flames and toggle water-running.
5. Commit once it plays right (`git init` once, then `git add -A && git commit -m "…"`), so a bad
   AI change is one `git checkout` away from undone.

## House rules for AI changes (paste these when you start)

```
Project rules:
- Plain JavaScript ES modules, three.js r186, Rapier 0.21, postprocessing 6.x. No TypeScript, no frameworks.
- +Y up, metres. River flows +X, city on -Z, river on +Z. Use the bank frame helpers in WorldLayout.js
  (ghatToWorld, frameAtX, frameToWorld) for placement.
- Tunables go in src/config.js. Asset paths go only in ASSET_MANIFEST (src/core/Assets.js).
- Static geometry: merge with MeshBuilder; repeated objects: InstancedMesh. Keep draw calls < 100
  and triangles < 2M (MacBook Air target, 60 fps at the Medium preset).
- Every collider goes through Physics.js helpers (addBox/addCylinder/addTrimesh).
- New materials that touch water should use makeWaterAware() from world/materials.js.
- Never delete or rename files in public/assets; add new ones next to them.
- After changes: npm run check:world && npm run build must pass.
```

## Roadmap (biggest impact first)

1. **Full animation set for Prady:** idle, swim, tread water, jump/fall/land, sit-and-row, namaste
   (for lighting flames) and climb. Mixamo clips plug straight into `ASSET_MANIFEST.character.clips`
   (see `docs/ASSETS.md`).
2. **A living Kashi:** instanced pilgrims, sadhus on the ghats, boatmen rowing, cows in the lanes,
   priests performing the evening aarti, ambient chatter.
3. **Mythic combat:** corrupted "Asura" spirits that rise from the dark river at night; trishul
   combos, a damaru shockwave, a "third eye" focus power, a health bar and save points.
4. **Story chapters:** dialogue system, cutscenes on the camera rig, legends of Kashi
   (Manikarnika's lost earring, Kaal Bhairav the city guardian, Annapurna).
5. **Festivals & weather:** Dev Deepawali (every step lit with diyas), monsoon rain, river mist
   at dawn, Holi colours.
6. **Tech polish:** KTX2 compressed textures, cascaded shadows, god rays, TAA, touch controls,
   multiple save slots.
7. **Ship it:** `npm run build` → Vercel, Netlify or itch.io. Use photo mode (P, then `[` `]`)
   to capture a trailer.

## Ready-to-use prompts

**Session starter**
```
Read CLAUDE.md (or GEMINI.md), README.md and docs/ARCHITECTURE.md. Summarise how Player.js,
CharacterAnimator.js and Quest.js interact in 10 lines, then wait for my task.
```

**Add Mixamo animations**
```
I added these GLB clips (Mixamo, mixamorig bones) in public/assets/characters/: idle.glb,
swimming.glb, treading-water.glb, jump.glb, sitting.glb, namaste.glb. Wire them into
ASSET_MANIFEST.character.clips and CharacterAnimator: use 'treading' when swimming slowly,
'sit' in the boat, and play 'namaste' once (upper body only, other bones keep the base state)
when a sacred flame is lit. Keep the procedural fallbacks for any missing file.
```

**NPC pilgrims**
```
Add src/gameplay/Crowd.js: 60 pilgrims on the ghats using one skinned NPC GLB I'll put at
public/assets/characters/pilgrim.glb (add it to ASSET_MANIFEST). Use the layout's landings
for waypoints, walk/idle states, avoid the player with a simple separation force, cull
animation updates beyond 60 m, and gather 20 of them at Dashashwamedh during the evening aarti.
Keep draw calls under 100.
```

**Night combat**
```
Add a combat system: Asura spirits (start with a glowing procedural mesh, I'll swap in a model
later) spawn from the river after 21:00 near unlit flames. Prady gets light attack (left click),
heavy attack (right click), dodge (Alt) and a 'Damaru' shockwave (Q, 8 s cooldown). Add health to
Player, a health bar to UI.js, and hit-stop + camera shake. Lit flames stop spawns nearby.
Put all numbers in config.js.
```

**Dev Deepawali festival**
```
Add a 'Dev Deepawali' night event: when all 5 flames are lit and it's after 19:00, place
thousands of diyas along every step edge (one InstancedMesh + the existing FireSystem glow, LOD:
only nearest 600 get flames), launch fireworks over the river, and play the aarti ambience
louder. Keep 60 fps on Medium.
```

**Touch controls**
```
Add mobile/touch support: left virtual joystick for movement, right-side drag for camera,
buttons for jump, dive, interact and sprint. Detect touch devices, default them to the Low
preset, and lay the HUD out for phone landscape.
```

## Leaving Genex (optional)

The game doesn't depend on Genex. To remove the tooling completely:
- `npm uninstall @genex-ai/cli-demo`
- delete `.genex/`, the `.claude/skills/genex-tool-*` folders, and the managed block in `AGENTS.md`
  (and the `@AGENTS.md` line in `CLAUDE.md` if you don't want those rules any more).

## In-game AI (NPCs that talk)

If you later want NPCs that answer in their own words, **never** put a Claude or Gemini API key in
this browser game: anyone could read it from the bundle and spend your money. Use a small server
you control (e.g. a Vercel function holding the key, with rate limits), or a platform where the
player pays for and approves their own usage.

## Unreal Engine later (Unreal MCP)

Everything here ports: Prady and the boat are GLB (import directly, or convert to FBX), the
skeleton is Mixamo-named so UE's IK Retargeter maps Mixamo/UE mannequin animations onto it,
textures and audio are plain files, and the whole map is data in `src/world/WorldLayout.js`
(`generateLayout()` returns every ghat, building, temple, flame and bead position as JSON that an
Unreal MCP agent can rebuild as a level).

## Known gotchas

- three.js's AnimationMixer does not rewrite a bone whose animated value hasn't changed.
  `CharacterAnimator` restores the clean pose before each update; any new procedural bone edit
  must run AFTER `mixer.update` inside that cycle, or rotations will accumulate (spinning head).
- `Skeleton.pose()` double-applies the armature transform on Prady's rig — use the glTF's
  loaded node transforms as the rest pose (see `Retarget.js`).

- `world/materials.js` patches three.js shader chunks (`map_fragment`, `roughnessmap_fragment`,
  `project_vertex`, `opaque_fragment`). After upgrading three.js, check those chunk names still exist.
- `postprocessing@6` requires `three < 0.187`. Upgrade both together.
- Browsers only allow audio after a click, and only allow mouse look after the canvas is clicked;
  both are handled. Keep it that way if you change the start flow.
- Rapier's ray hit field is `timeOfImpact` in 0.21 (it was `toi` in older versions).
