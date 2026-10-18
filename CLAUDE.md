# EV_Strudel

Electron UI frontend for Strudel (live-coding music). A nice editor built on the
`@strudel/*` npm packages (not the stock REPL web component).
License: AGPL-3.0-or-later (required — Strudel is AGPL).

## Current Session Status
2026-10-18: Scaffolded electron-vite + React + TS. Minimal StrudelMirror editor in
`src/renderer/src/App.tsx` (Play/Stop, synths + dirt-samples). Typecheck + build pass.
Audio NOT yet verified in the running app. Pushed to github.com/joncraig/EV_Strudel.

## Active TODO
- Verify audio in `npm run dev` (Jon)
- Feature vision (not yet designed — discuss before building):
  - Patch library: easy finding, downloading, recalling patches
  - Novel interfaces for navigating chords and modes
  - Looping sequencers, polyrhythms
  - Happy accidents (controlled randomness / mutation)
  - Compounding modulators (modulators modulating modulators)

## Notes
- CSP in `src/renderer/index.html` allows `unsafe-eval` (Strudel evaluates code) and
  `https:` connect/media (remote sample maps).
- Strudel packages have no TS types; stubbed in `src/renderer/src/strudel.d.ts`.
- StrictMode removed in `main.tsx` (double-mount would create two editors).

## Skills
The Stargate Compendium is available as an MCP server (`stargate-compendium`).
Use `list_topics`, `get_topic`, `search`, and `reload` to access shared knowledge.
