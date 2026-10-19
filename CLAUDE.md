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
- Canvas next steps (not built): Freeze/Cache node (render a chain once with Strudel's offline renderer, renderPatternAudio, and loop the buffer to save audio-thread CPU; unfreezes on edit; loop length = lcm of the chain's lengths; wrap reverb/delay tails), Output nodes so a chain can output mid-chain (today the only output is each chain's last unconnected node), measure paging (nodes show one measure, page through several, like Ableton clips), Slice node (sets cut count for a single file; no slice controls on chips or menus), Extract node (narrow a bank to chosen pieces), chords (stacked degrees), per-step variant/velocity, modulator nodes. Modulating effect/synth params (per-note in Strudel, so they step like Velocity) is next after Bus/LFO; LFO free-Hz rate not built
- Short strudel.cc links (`?id`) unsupported (stored in their Supabase). Could add later.
- Feature vision (discuss before building):
  - Happy accidents (controlled randomness / mutation)
  - Compounding modulators (modulators modulating modulators)

## Notes
- Parameters (Jon): EVERY node sets its value until something later changes it, in any order. Length sets the length: sequencers after it (incl. Key/Mode/Velocity) step at it (mini-notation `@` weights, `stepped()`), notes after it sound for it (clip relative to the sequencer's step). A Length wired into a sequencer's input only sets its step length. Playheads follow via `stepLens` (compile) + `StepLensContext`. A parameter-only chain wired into a sequencer's input applies there; wired beside a flow it is a parallel voice. Every input takes several wires: they are parallel branches (Jon), EACH its own voice through the rest of the chain, sound or not (an Octave -1 wired beside the chain = same notes an octave down; `paramPaths`, `sideChains` in follow). Exception: a sequencer's own input, where sounds are voices and other chains (Length, Key...) set it up. Sound comes out at each chain's last unconnected output.
- Clocks (Jon: "almost all nodes are sequencers"): a chain with a sound but no Notes/Slices is triggered by the stepping node (Key/Mode/Octave/Velocity; NEVER Length, which only sets durations) nearest after the sound, else nearest before; its set steps are the hits, each lasting the held Length (clip 1).
- Sample chains (Slices / clocked sounds) get a per-chain `.cut(n)`: a new hit stops the previous one, so long loops restart instead of stacking. Notes stay polyphonic. `stepped()` never collapses hit patterns (only constant value patterns). New nodes default to 1 step.
- Chains: a sequencer (when) starts a chain; every node after it adds a dimension (Sample = sound, Key, Mode, Length, Velocity, effects), each with its own length. Only chain ends play; forks play each branch. Mix: many inputs, one output; stacks its chains on its own orbit (2+) so effects after it (and its delay/reverb) are shared by its inputs. Old sound wires migrate in `chainSamples`. Notes with no Sample play `triangle`. Velocity = Strudel `velocity` (0..1, multiplies with gain); future: outs route to busses.
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
- Audio performance (2026-10-18): main thread was NOT the limit; the audio render thread (Realtime AudioWorklet thread) runs ~50-86% busy, mostly the convolution reverb (size 4 = 6s IR) and delay feedback. Fixes: CSP allows data: so Strudel worklets load; backgroundThrottling off; reverb IRs built in a worker + cached (`audio/fastReverb.ts`); AudioContext latencyHint 0.1 (no live input, latency is free); scheduler look-ahead patched 0.1 -> 0.5s (`patches/@strudel+core+1.2.6.patch`, applied by patch-package postinstall; clear node_modules/.vite after changing it). Measure with CDP traces (per-thread RunTask) and "skip query: too late" counts (clear console first).
- Steps: every step is a 1/16 (`STEP_RESOLUTION` in model.ts); length = steps.length, so a pattern spans length/16 bars (`[...]/bars` in mini-notation). Jon: no per-node step-size setting; a note-length node may come later. Old canvases migrate to 1/16 on purpose (their sound changes).
- Overnight white screen (2026-10-18) was NOT a leak: the Surface slept, Vite reloaded the page while Windows had networking suspended (`ERR_NETWORK_IO_SUSPENDED`), so no code loaded. Dev now reloads a blank page on `powerMonitor` resume. Renderer measured flat at idle and ~12 style recalcs/s while playing.
- Inspecting the running app: dev builds open a CDP port on 9225 (`src/main/index.ts`). `node scripts/cdp.mjs "<js>"` evaluates in the renderer (e.g. query DOM classes, click Play). Hot-reloading a shared module like `canvas/playhead.ts` can split it into two copies; restart dev after editing it.
- Length sequencer: per-step note length as note values 1/16, 1/8, 3/16, 1/4, 3/8, 1/2, 3/4, 1 bar (`LENGTH_STEPS` in steps; v1 tables migrate to nearest) -> Strudel `clip`, which multiplies each note's duration and cuts samples at the end. Shares `LevelNode` with Velocity.
- Effects: one `effect` node type; kinds + params in `EFFECTS` (model.ts), each param a Strudel control on a vertical fader (log for cutoffs). Delay and reverb are per-orbit in Strudel (shared by everything on that orbit), which is where busses will come in.
- Naming (Jon): call them Gain (level fader) and Velocity (per-step sequencer), never "volume". Old saved `volume` nodes migrate in `migrateCanvas` (model.ts).
- Undo: `canvas/useHistory.ts`, serialized snapshots; a burst of changes (drag, paint, fader) settles after 400ms into one step; selection is not recorded. Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y, plus toolbar buttons.
- Parameter panel: `canvas/Panel.tsx`, in a fixed 260px dock under the canvas (never resizes with selection; ▾/▴ tab or View > Show Panel hides it, remembered), settings for the single selected node (steps, gain, octave, mute/fold/clear; effect sliders + bypass; mode list; group name). Edits go through updateNodeData so they undo.
- Mute / Solo (node menu, any node, acts on the selection): a chain is silent if any node on its path is muted; while anything is soloed only chains through a soloed node play (a Solo after a Mix plays all its inputs). Muted nodes dim, soloed ones get a yellow ring. `compile().sounding` = nodes on heard chains (no gain 0 on the path); their grids flash the playing step's set cells (`.cell.hit`, direct DOM in StepGrid). Hot reloads of canvas modules can start a second audio engine (no sound, "different audio context" errors): reload the window.
- Bus + LFO (2026-10-18): the Mix node is shown as **Bus** (type stays 'mix' in saves). Each Bus is its own orbit (codegen busOrbits, 2+); its Volume (linear 0..1.5) and Pan act LIVE on the orbit audio in `audio/modulation.ts` (StereoPanner inserted between orbit summingNode and output; output.gain = volume), not via code, so no look-ahead lag and held notes move. LFO node (shape sine/tri/saw/square/S&H, rate in bars synced to tempo, depth, phase): OscillatorNode with a phase-rotated PeriodicWave -> depth gain -> per-wire scale gain -> target AudioParam. Mod wires: LFO 'mod' output -> 'mod:<param>' inputs on the bottom edge (Bus volume/pan, LFO rate/depth = compounding). Depth 1 = Bus volume swings 0..2x, full pan, +-100% rate. The sequencer Gain fader is gone (Velocity sets level); old gain 0 migrates to muted. Testing modulation via CDP: import the app's own module URLs (performance resource entries), not /@id/, or you get a second superdough copy.
- Feedback: no "not playing" warnings (Jon: parameter chains are not errors). Ctrl+D / node menu Duplicate copies selected nodes and their inner wires. Add menu: type to filter (keys captured so Backspace never deletes nodes), Enter picks first.
- Blender-style wiring: dragging from a connected input picks up its most recent wire, even with several (drop on empty = disconnect, on an output = reconnect); dragging a free chain node over a pattern wire highlights it and splices the node in on drop.
- Testing on Jon's live canvas: snapshot the FULL serialized canvas (localStorage `ev-strudel:canvas-autosave`) before a test and undo until it matches exactly; never undo by count or compare only wires/ids. Over-undos twice rolled back his edits (recovered with exact redo counts). Baselines saved to a file must be parsed once, not double-encoded.
- Gestures: tap selects (node) / clears selection (empty canvas); long-press (500ms) or right-click opens the node menu or the add menu; drag on empty canvas = selection box (React Flow selectionOnDrag); pan = two fingers, trackpad scroll, middle/right mouse; pinch or Ctrl+scroll zooms; Ctrl+click deletes. Synthetic events can't test the selection box (pointer capture): use CDP Input.dispatchMouseEvent.
- Sequencers: Notes and Slices only (Rhythm removed; old ones migrate to Slices playing piece 0). A single sound is one piece (the whole sound); cutting into slices will be a Slice node. Octave is a chain sequencer like Key/Mode, RELATIVE (Jon): steps -4..+4, 0 = no change (notes stay at octave 3, samples at original pitch); old absolute 1-7 saves migrate (v - 3, OctaveData.version 2); the Notes octave control is gone.
- Harmony: Key and Mode are step sequencers (1/16 steps, index into TONICS/MODES, empty steps hold) AND chain nodes (pattern in/out) like Velocity/Length; Jon: no special inputs for one dimension of the notes. Codegen collects key/mode along the chain and fills the `__SCALE__` placeholder in Notes code (`harmonyPattern`, lcm of lengths). Migrations: list-style mode -> Key+Mode (`splitLegacyModes`), top-input wiring -> chain (`chainHarmony`). No animated wires. MAX_STEPS 128.
- Menu: native File/Edit/View (`src/main/menu.ts`) sends commands to the renderer (`menu:command`); accelerators shown but not registered so the renderer keeps handling keys. Toolbar = transport, patch name (+ dirty dot), Undo/Redo. Open patch file/name persist in localStorage (`ev-strudel:current-patch`).
- Canvas commits go through `commit()` on a latest-state ref (Canvas.tsx) so several changes in one tick (select + paint) build on each other.
- Transport: Play/Stop + BPM in the toolbar (`components/Transport.tsx`); cps = BPM/240 (bar = 4 beats); tempo saved as `// @tempo` in patches and in localStorage.
- Piano roll: `canvas/PianoRoll.tsx` in the bottom panel for the selected sequencer/Velocity node: whole pattern, bar lines every 16, rows named (pitches from the first wired mode via `degreeName`, file names for banks). Mono per step for now.
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
