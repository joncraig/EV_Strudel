# EV_Strudel

Electron UI frontend for Strudel (live-coding music). A nice editor built on the
`@strudel/*` npm packages (not the stock REPL web component).
License: AGPL-3.0-or-later (required because Strudel is AGPL).

## Current Session Status
2026-10-18: Node canvas v1 replaces the code editor (Jon: no code editor for now). Sample,
Notes (scale degrees), Rhythm, Slices sequencers + sequencable Mode node. Canvas compiles to
Strudel code; codegen verified against real Strudel in Node. Typecheck + build pass.
NOTHING verified in the running app yet (canvas, audio, samples, patches). Jon to test with `npm run dev`.

## Active TODO
- Verify in `npm run dev`: canvas (drag sample in, wire, play, live edits), Samples tab (play, variants, download + offline), Patches save/open/import
- Canvas next steps (not built): Slice node (sets cut count for a single file; no slice controls on chips or menus), Extract node (narrow a bank to chosen pieces), chords (stacked degrees), per-step variant/velocity, modulator nodes
- Short strudel.cc links (`?id`) unsupported (stored in their Supabase). Could add later.
- Feature vision (discuss before building):
  - Happy accidents (controlled randomness / mutation)
  - Compounding modulators (modulators modulating modulators)

## Notes
- Canvas: `src/renderer/src/canvas/`, React Flow (`@xyflow/react`). `codegen.ts` turns the graph into a
  `stack()`. Degrees are 1-based in the UI, 0-based in Strudel. Mode node becomes
  `.scale("<D3:dorian ...>")`, one entry per cycle. Each sequencer fits its steps into one cycle,
  so different lengths give polyrhythms.
- Saved canvases: JSON in a `// @canvas` meta line plus generated code below, so files still run on
  strudel.cc. Code-only patches play but can't be edited on the canvas.
- Audio engine: headless `webaudioRepl` (no StrudelMirror). `@strudel/codemirror` still installed, unused.
- Testing codegen in Node: stub `@kabelsalat/web` with a loader hook, import @strudel dist, `queryArc` the pattern.
- Sample packs: catalog in `src/shared/samplePacks.ts`; main side `src/main/samples.ts`. No load/save buttons (Jon): a pack loads on demand (tap, drop, Play) and then saves itself to `Library/samples/<id>/` in the background (rewritten `strudel.json`, served via `evsamples://pack/<id>/`); saved packs load locally after that.
- Dev restarts: Claude relaunches `npm run dev` itself whenever a change needs it (main/preload changes don't hot-reload). Stop only this project's node/electron PIDs (match the project path in the command line), then run `npm.cmd run dev` in the "dev" terminal tab (PowerShell blocks `npm.ps1`).
- Touch: Jon is on a Surface touchscreen. HTML5 drag-and-drop does not start from touch in Chromium on Windows, so sounds drag with pointer events (`canvas/soundDrag.ts`). Keep touch targets large.
- Library folder: `Documents/EV_Strudel Library/*.strudel`. Patch metadata is in leading
  `// @title`, `// @source`, `// @tags` comment lines (`src/shared/patch.ts`), so files stay runnable.
- Library IPC lives in `src/main/library.ts`. Imports are fetched in main (no CORS). Delete goes to the Recycle Bin.
- CSP in `src/renderer/index.html` allows `unsafe-eval` (Strudel evaluates code) and
  `https:` connect/media (remote sample maps).
- Strudel packages have no TS types; stubbed in `src/renderer/src/strudel.d.ts`.
- StrictMode removed in `main.tsx` (double-mount would create two Strudel engines).

## Skills
The Stargate Compendium is available as an MCP server (`stargate-compendium`).
Use `list_topics`, `get_topic`, `search`, and `reload` to access shared knowledge.
