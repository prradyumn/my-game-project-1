# PRADY — Legend of Kashi · project rules for AI coding assistants

Open-world mythological adventure on the ghats of Varanasi. Browser game: plain JavaScript ES
modules, three.js r186, Rapier 0.21 (physics), postprocessing 6.x, Vite. Hero: **Prady**.

Read first: `README.md` (features, controls), `docs/ARCHITECTURE.md` (every system, coordinate
conventions, extension recipes), `docs/AI_HANDOFF.md` (roadmap + prompts), `docs/ASSETS.md`.

Rules:
- No TypeScript, no UI frameworks. One system per file; match the surrounding style.
- +Y up, metres. River flows +X, city on -Z, river on +Z, water at y = 0. Place things with the
  bank-frame helpers in `src/world/WorldLayout.js` (`ghatToWorld`, `frameAtX`, `frameToWorld`).
- Tunables live in `src/config.js`; asset paths live only in `ASSET_MANIFEST` (`src/core/Assets.js`).
- Static geometry → `MeshBuilder` (merged); repeated objects → `InstancedMesh`. Budget: < 100 draw
  calls, < 2M triangles, 60 fps on a 16 GB MacBook Air at the Medium preset.
- Colliders only through `src/core/Physics.js`. Materials near water → `makeWaterAware()`.
- Never delete, rename or overwrite files in `public/assets/`; add new files beside them.
- Never put API keys in client code.
- Verify every change: `npm run check:world && npm run build`, then play it at
  `http://localhost:5173/?debug` (keys 1–4 are debug shortcuts).
