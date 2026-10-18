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
- Canvas next steps (not built): measure paging (nodes show one measure, page through several, like Ableton clips), Slice node (sets cut count for a single file; no slice controls on chips or menus), Extract node (narrow a bank to chosen pieces), chords (stacked degrees), per-step variant/velocity, modulator nodes
- Short strudel.cc links (`?id`) unsupported (stored in their Supabase). Could add later.
- Feature vision (discuss before building):
  - Happy accidents (controlled randomness / mutation)
  - Compounding modulators (modulators modulating modulators)

## Notes
- Chains: sequencers have a `pattern` output; modifier nodes (Velocity, Effect) take a `pattern` input and pass it on. Codegen plays only chain ends (`compile` in codegen.ts follows `pattern` edges); forks play each branch. Velocity = Strudel `velocity` (0..1, multiplies with gain); future: outs route to busses.
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
- Clicks/crackle (2026-10-18): got quieter when the playhead stopped drawing, so CPU contention, not overload. Audio context now uses latencyHint "playback" (baseLatency 10ms -> 20ms) and the playhead is one bar per grid moved by direct style writes (no grid re-render, no glow). Output measured at -0.6 dBFS peak: little headroom; consider a master limiter if clipping shows up.
- Steps: fixed step size `resolution` (steps per bar, default 16 = 1/16); length = steps.length, so a pattern spans length/resolution bars (`[...]/bars` in mini-notation). Old canvases migrate with resolution = old length (sound unchanged).
- Overnight white screen (2026-10-18) was NOT a leak: the Surface slept, Vite reloaded the page while Windows had networking suspended (`ERR_NETWORK_IO_SUSPENDED`), so no code loaded. Dev now reloads a blank page on `powerMonitor` resume. Renderer measured flat at idle and ~12 style recalcs/s while playing.
- Inspecting the running app: dev builds open a CDP port on 9225 (`src/main/index.ts`). `node scripts/cdp.mjs "<js>"` evaluates in the renderer (e.g. query DOM classes, click Play). Hot-reloading a shared module like `canvas/playhead.ts` can split it into two copies; restart dev after editing it.
- Effects: one `effect` node type; kinds + params in `EFFECTS` (model.ts), each param a Strudel control on a vertical fader (log for cutoffs). Delay and reverb are per-orbit in Strudel (shared by everything on that orbit), which is where busses will come in.
- Naming (Jon): call them Gain (level fader) and Velocity (per-step sequencer), never "volume". Old saved `volume` nodes migrate in `migrateCanvas` (model.ts).
- Undo: `canvas/useHistory.ts`, serialized snapshots; a burst of changes (drag, paint, fader) settles after 400ms into one step; selection is not recorded. Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, plus toolbar buttons.
- Parameter panel: `canvas/Panel.tsx`, docked under the canvas, settings for the single selected node (steps, gain, octave, mute/fold/clear; effect sliders + bypass; mode list; group name). Edits go through updateNodeData so they undo.
- Multi-selection: a tap on a selected node's controls (with 2+ selected) opens the node menu instead of editing (capture handler in Canvas.tsx).
- Sequencer controls: step count = drag the ↔ pill in the node header (`canvas/controls.tsx`); gain = vertical fader; grids paint by sliding (first cell decides on/erase).
- Touch: Jon is on a Surface touchscreen. HTML5 drag-and-drop does not start from touch in Chromium on Windows, so sounds drag with pointer events (`canvas/soundDrag.ts`). Keep touch targets large.
- Library folder: `Documents/EV_Strudel Library/*.strudel`. Patch metadata is in leading
  `// @title`, `// @source`, `// @tags` comment lines (`src/shared/patch.ts`), so files stay runnable.
- Library IPC lives in `src/main/library.ts`. Imports are fetched in main (no CORS). Delete goes to the Recycle Bin.
- CSP in `src/renderer/index.html` allows `unsafe-eval` (Strudel evaluates code) and
  `https:` connect/media (remote sample maps).
- Strudel packages have no TS types; stubbed in `src/renderer/src/strudel.d.ts`.
- StrictMode removed in `main.tsx` (double-mount would create two Strudel engines).

## Ports
Local view; the compendium `port-map` topic is the source of truth.

| Port | Bind | Purpose |
|------|------|---------|
| 5173 | localhost | Vite dev server (renderer) |
| 9225 | 127.0.0.1 | Dev-only Chrome DevTools Protocol (`scripts/cdp.mjs`) |

## Skills
The Stargate Compendium is available as an MCP server (`stargate-compendium`).
Use `list_topics`, `get_topic`, `search`, and `reload` to access shared knowledge.
