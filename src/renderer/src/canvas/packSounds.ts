// Renderer-side cache of each pack's sound list, plus a request to audition a sound.
// Nodes on the canvas use these without needing props threaded through React Flow.

import type { PackSounds } from '../../../shared/samplePacks'

const cache = new Map<string, Promise<PackSounds>>()

export function packSounds(pack: string): Promise<PackSounds> {
  let p = cache.get(pack)
  if (!p) {
    p = window.api.samples.sounds(pack)
    cache.set(pack, p)
    p.catch(() => cache.delete(pack))
  }
  return p
}

export const AUDITION_EVENT = 'ev-audition'

export interface AuditionDetail {
  s: string
  n: number
  pack?: string
}

// App loads the pack if needed, then plays the sound.
export const requestAudition = (detail: AuditionDetail): void => {
  window.dispatchEvent(new CustomEvent<AuditionDetail>(AUDITION_EVENT, { detail }))
}
