// Places to find patches. `strudel-tunes` is the official example file (many tunes
// in one .mjs); `github` lists every .strudel file in a repo.

export type Collection =
  | { id: string; name: string; description: string; kind: 'strudel-tunes'; url: string }
  | { id: string; name: string; description: string; kind: 'github'; repo: string }

export interface CatalogItem {
  title: string
  url: string
}

export const STRUDEL_TUNES_URL =
  'https://codeberg.org/uzu/strudel/raw/branch/main/website/src/repl/tunes.mjs'

const gh = (repo: string, description: string): Collection => ({
  id: repo,
  name: repo,
  description,
  kind: 'github',
  repo
})

export const CATALOG: Collection[] = [
  {
    id: 'strudel-official',
    name: 'Strudel official examples',
    description: 'The tunes that ship with strudel.cc (shuffle button).',
    kind: 'strudel-tunes',
    url: STRUDEL_TUNES_URL
  },
  gh('nukleas/cycletron', 'Big corpus sorted by rhythm, harmony, timbre and form, plus songs.'),
  gh('tzfm/rustel', 'Large set of patterns.'),
  gh('calv-io-n/strudel-studio', 'Studio sketches.'),
  gh('fatmmouse/beatdarwin-canon', 'Evolved beats.'),
  gh('jan-oboth/strudel', 'Personal patterns.'),
  gh('thedavidweng/strudel-tui', 'Acid, melody and other demo patterns.'),
  gh('splashkes/crutchfield-machine', 'Breakbeat, acid, dub pulse, pad drift.'),
  gh('Zanark/SubwooferLullabies', 'Bass-heavy tracks.'),
  gh('ElleNajt/vibe-duet', 'Duet pieces.'),
  gh('lmorv/CART398-LiveCoding-', 'Live-coding class work.'),
  gh('emin-grbo/app-maker-outpost', 'Assorted tracks.'),
  gh('MrityunjayBhardwaj/Stave', 'Patterns.'),
  gh('chrisguest75/audio_processing_examples', 'Examples.'),
  gh('alessandrodevecchi/coding-misk', 'Misc sketches.'),
  gh('BLamy/orly', 'Tracks.'),
  gh('MangoMindset/strudels', 'Strudels.'),
  gh('A5TA/strudel-agents', 'Agent-made tracks.'),
  gh('sarefo/strudel', 'Patterns.'),
  gh('pandamusrex/strudel-arrangements', 'Arrangements.'),
  gh('manasseh152/Beats', 'Beats.'),
  gh('jeremyprz/muffin', 'Tracks.'),
  gh('fran0x/neiro', 'Tracks.'),
  gh('alexsantos-eth/the-music-language', 'Examples.'),
  gh('aalokok/LiveCoding', 'Live-coding sketches.'),
  gh('FSXAC/StrudelPlayground', 'Playground patterns.'),
]

// The official tunes file is `export const name = \`code\`` repeated.
export function parseTunes(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /export const (\w+)\s*=\s*`([\s\S]*?)`;?\s*(?=export const|$)/g
  for (let m = re.exec(text); m; m = re.exec(text)) out[m[1]] = m[2].replace(/\\`/g, '`').replace(/\\\$/g, '$')
  return out
}
