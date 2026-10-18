# EV_Strudel

Electron UI frontend for Strudel (live-coding music). A nice editor built on the
`@strudel/*` npm packages (not the stock REPL web component).
License: AGPL-3.0-or-later (required because Strudel is AGPL).

## Current Session Status
2026-10-18: Patch library v1 + Browse tab (catalog of ~1 official + 25 GitHub collections, ~2.5k patches) pushed. Typecheck + build pass.
NOT yet verified in the running app (audio, import, save/load). Jon to test with `npm run dev`.

## Active TODO
- Verify in `npm run dev`: audio, save/open/delete, import (strudel.cc long URL, gist, GitHub file, raw URL, pasted code)
- Short strudel.cc links (`?id`) unsupported (stored in their Supabase). Could add later.
- Feature vision (discuss before building):
  - Novel interfaces for navigating chords and modes
  - Looping sequencers, polyrhythms
  - Happy accidents (controlled randomness / mutation)
  - Compounding modulators (modulators modulating modulators)

## Notes
- Library folder: `Documents/EV_Strudel Library/*.strudel`. Patch metadata is in leading
  `// @title`, `// @source`, `// @tags` comment lines (`src/shared/patch.ts`), so files stay runnable.
- Catalog list: `src/shared/catalog.ts` (add repos there). Browse uses unauthenticated GitHub tree API (60 req/hr), cached per session. Official tunes parsed from Codeberg `tunes.mjs` (29 of 32 parse).
- Library IPC lives in `src/main/library.ts`. Imports are fetched in main (no CORS). Delete goes to the Recycle Bin.
- CSP in `src/renderer/index.html` allows `unsafe-eval` (Strudel evaluates code) and
  `https:` connect/media (remote sample maps).
- Strudel packages have no TS types; stubbed in `src/renderer/src/strudel.d.ts`.
- StrictMode removed in `main.tsx` (double-mount would create two editors).

## Skills
The Stargate Compendium is available as an MCP server (`stargate-compendium`).
Use `list_topics`, `get_topic`, `search`, and `reload` to access shared knowledge.
