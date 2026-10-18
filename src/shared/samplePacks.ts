// Sample packs: Strudel sample maps (strudel.json style) found on GitHub.
// Each `url` points straight at the JSON; files resolve relative to it unless it sets `_base`.

export interface SamplePack {
  id: string
  name: string
  description: string
  url: string
}

export interface PackStatus extends SamplePack {
  downloaded: boolean
}

// sound name -> number of variants (n)
export type PackSounds = Record<string, number>

export interface DownloadProgress {
  id: string
  done: number
  total: number
  failed: number
}

const raw = (repo: string, path = 'strudel.json'): string =>
  `https://raw.githubusercontent.com/${repo}/HEAD/${path}`

const pack = (id: string, name: string, description: string, url: string): SamplePack => ({
  id,
  name,
  description,
  url
})

export const SAMPLE_PACKS: SamplePack[] = [
  pack('dirt-samples', 'Dirt-Samples', 'The classic TidalCycles set (loaded by default). 218 sounds.', raw('tidalcycles/dirt-samples')),
  pack('tidal-drum-machines', 'Tidal Drum Machines', 'Hundreds of classic drum machines, as bank_sound (e.g. RolandTR808_bd). 683 sounds.', raw('felixroos/dough-samples', 'tidal-drum-machines.json')),
  pack('piano', 'Salamander Piano', 'Multisampled grand piano, pitched by note.', raw('felixroos/dough-samples', 'piano.json')),
  pack('vcsl', 'VCSL', 'Versilian Community Sample Library: orchestral percussion, winds, more. 128 sounds.', raw('felixroos/dough-samples', 'vcsl.json')),
  pack('emu-sp12', 'E-mu SP-12', 'Gritty 12-bit sampler drums.', raw('felixroos/dough-samples', 'EmuSP12.json')),
  pack('mridangam', 'Mridangam', 'South Indian drum strokes (ta, ki, nam, dhin…).', raw('felixroos/dough-samples', 'mridangam.json')),
  pack('felixroos-samples', 'felixroos samples', 'Drums, Rhodes and keys from Strudel’s author.', raw('felixroos/samples')),
  pack('clean-breaks', 'Clean Breaks', 'Classic breakbeats (Funky Drummer, Amen-era) by yaxu.', raw('yaxu/clean-breaks')),
  pack('crate', 'Crate', 'Drum and percussion crate by eddyflux. 367 files.', raw('eddyflux/crate')),
  pack('wax', 'Wax', 'Vinyl loops, vocals and atmospheres by eddyflux.', raw('eddyflux/wax')),
  pack('dough-amiga', 'Dough Amiga', 'Huge Amiga ST-xx sample disks. 10k+ files.', raw('Bubobubobubobubo/Dough-Amiga')),
  pack('dough-fox', 'Dough Fox', 'Kicks, snaps, beeps and more.', raw('Bubobubobubobubo/Dough-Fox')),
  pack('dough-samples', 'Dough Samples', 'General drum kit and stabs.', raw('Bubobubobubobubo/Dough-Samples')),
  pack('dough-waveforms', 'Dough Waveforms', 'Single-cycle wavetables (wt_*).', raw('Bubobubobubobubo/Dough-Waveforms')),
  pack('glorkglunk', 'Glorkglunk Wavetables', 'Wavetables: FM, growl, robot, sync…', raw('kyrsive/glorkglunk-wavetables')),
  pack('equovil', 'Xtra Equovil', 'Drum loops, vocal chops and FX. 647 files.', raw('kyrsive/xtra-equovil-samples')),
  pack('tr707', 'Roland TR-707', 'TR-707 drum machine.', raw('bingaman/tr707')),
  pack('garden', 'Garden', 'Drum kit by mot4i.', raw('mot4i/garden')),
  pack('emptyflash', 'emptyflash', 'ER-1 drums, booms, dopplers. 238 files.', raw('emptyflash/samples')),
  pack('concordia-extra', 'Concordia extras', 'Breaks, bass, guitar, drums. 709 files.', raw('concordia-dcart/samples-extra')),
  pack('bases-funk', 'Bases Funk', 'Brazilian funk beats, atabaque, vocals. 505 files.', raw('Jayquan75/bases-funk')),
  pack('m8-dnb', 'M8 168 DnB / Jungle', 'Breaks, bass, pads, vox at 168 bpm.', raw('creativenucleus/strudel-m8-168-dnb-jungle')),
  pack('shigeto', 'Shigeto', '120 bpm loops in many keys.', raw('HnnhBot/strudel', 'shigeto/strudel.json')),
  pack('stems', 'Stems', '665 long stems and textures.', raw('krillerxyz/stems')),
  pack('chrono-trigger', 'Chrono Trigger', 'Instruments from the SNES soundtrack.', raw('lynn/sounds', 'chrono-trigger/strudel.json')),
  pack('medieval', 'Medieval Sounds', 'Bagpipes, anvils, armour, battle hits. 129 sounds.', raw('jpopesculian/medieval-sounds')),
  pack('beatbox', 'Beatbox', 'Human beatbox hits and phrases.', raw('jeroenjanssens/beatbox-samples')),
  pack('nfolk', 'Nordic Folk', 'Hurdy-gurdy, flutes, frame drum, whistle.', raw('boggodan/nfolk')),
  pack('bmetal', 'Metal', 'Guitar chugs and tremolo.', raw('boggodan/bmetal')),
  pack('pond', 'Pond', 'Textures and vocal bits by TodePond.', raw('TodePond/pond')),
  pack('flbass', 'FL Bass', 'Bass multisample.', raw('cleary/samples-flbass')),
  pack('breaks', 'Breaks', 'Ten breakbeats.', raw('byolim/breaks')),
  pack('eerieear', 'eerieear', 'Vocals, strings, oddities.', raw('eerieear/samples')),
  pack('bpb-808', 'BPB 808 clean', 'Clean 808 kit.', raw('mlaass/nkido', 'web/static/samples/bpb_808_clean/strudel.json')),
  pack('polifonia', 'Polifonia', 'Italian polyphony samples.', raw('fstiffo/polifonia-samples')),
  pack('algorave-dave', 'Algorave Dave', 'Vocal and loop samples.', raw('algorave-dave/samples'))
]

// Sample maps hold strings, arrays of strings, or { note: string | string[] } objects.
export function countSounds(map: Record<string, unknown>): PackSounds {
  const out: PackSounds = {}
  for (const [key, value] of Object.entries(map)) {
    if (key.startsWith('_')) continue
    if (typeof value === 'string') out[key] = 1
    else if (Array.isArray(value)) out[key] = value.length
    else if (value && typeof value === 'object') out[key] = Object.keys(value).length
  }
  return out
}
