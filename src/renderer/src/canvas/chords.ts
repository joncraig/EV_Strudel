// Chord maths for the Chords sequencer (Orchid-style: a root per step, plus a quality
// and an extension). Everything here is in semitones; codegen turns it into MIDI notes
// with the Key, Mode and Octave in effect at each step.

import { MODE_STEPS, TONICS } from './model'

export type Quality = 'maj' | 'min' | 'sus2' | 'sus4' | 'dim' | 'aug'
export type Extension = '6' | '7' | 'maj7' | '9' | 'add9'
export type Spread = 'close' | 'open' | 'wide'

export const QUALITIES: { id: Quality; label: string }[] = [
  { id: 'maj', label: 'Maj' },
  { id: 'min', label: 'Min' },
  { id: 'sus2', label: 'Sus2' },
  { id: 'sus4', label: 'Sus4' },
  { id: 'dim', label: 'Dim' },
  { id: 'aug', label: 'Aug' }
]
export const EXTENSIONS: { id: Extension; label: string }[] = [
  { id: '6', label: '6' },
  { id: '7', label: '7' },
  { id: 'maj7', label: 'M7' },
  { id: '9', label: '9' },
  { id: 'add9', label: 'add9' }
]
export const SPREADS: Spread[] = ['close', 'open', 'wide']

// Chosen quality / extension per step (null = in key / none), and the node's voicing.
export interface ChordSettings {
  quality?: (Quality | null)[]
  ext?: (Extension | null)[]
  inversion?: number
  spread?: Spread
  bass?: boolean
}

const TRIADS: Record<Quality, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8]
}

// Semitones of a step's chord above the key's tonic, before voicing. `degree` is
// 1-based in the mode. With no quality the chord is built from the mode itself
// (every other scale note), so tapping roots alone stays in key.
export function chordTones(
  degree: number,
  modeId: string,
  quality: Quality | null,
  ext: Extension | null
): number[] {
  const scale = MODE_STEPS[modeId] ?? MODE_STEPS.major
  const n = scale.length
  // Scale note i (0-based, may run past the octave).
  const at = (i: number): number => scale[((i % n) + n) % n] + 12 * Math.floor(i / n)
  const r = degree - 1
  const root = at(r)
  if (!quality) {
    const tones = [at(r), at(r + 2), at(r + 4)]
    if (ext === '6') tones.push(at(r + 5))
    if (ext === '7' || ext === '9') tones.push(at(r + 6))
    if (ext === 'maj7') tones.push(root + 11)
    if (ext === '9' || ext === 'add9') tones.push(at(r + 8))
    return tones
  }
  const tones = TRIADS[quality].map((s) => root + s)
  if (ext === '6') tones.push(root + 9)
  if (ext === '7' || ext === '9') tones.push(root + (quality === 'dim' ? 9 : 10))
  if (ext === 'maj7') tones.push(root + 11)
  if (ext === '9' || ext === 'add9') tones.push(root + 14)
  return tones
}

// Inversion moves the lowest notes up an octave; open lifts the second note an octave,
// wide lifts every other note; bass adds the root an octave below.
export function voice(tones: number[], s: ChordSettings): number[] {
  let v = [...tones].sort((a, b) => a - b)
  for (let k = 0; k < (s.inversion ?? 0) % Math.max(1, v.length); k++) {
    v[0] += 12
    v.sort((a, b) => a - b)
  }
  if (s.spread === 'open' && v.length > 2) v[1] += 12
  if (s.spread === 'wide') v = v.map((t, i) => (i % 2 ? t + 12 : t))
  if (s.bass) v.unshift(tones[0] - 12)
  return [...new Set(v)].sort((a, b) => a - b)
}

// "Dm7" for a step, given the key and mode it's heard in.
export function chordName(
  degree: number,
  tonic: number,
  modeId: string,
  quality: Quality | null,
  ext: Extension | null
): string {
  const t = chordTones(degree, modeId, quality, ext)
  const rel = t.map((x) => x - t[0])
  const q =
    quality ??
    (rel[1] === 4 && rel[2] === 7
      ? 'maj'
      : rel[1] === 3 && rel[2] === 7
        ? 'min'
        : rel[1] === 3 && rel[2] === 6
          ? 'dim'
          : rel[1] === 4 && rel[2] === 8
            ? 'aug'
            : null)
  const suffix = { maj: '', min: 'm', sus2: 'sus2', sus4: 'sus4', dim: 'dim', aug: '+' }
  const root = TONICS[(((tonic + t[0]) % 12) + 12) % 12]
  const e = ext === 'maj7' ? 'maj7' : (ext ?? '')
  return `${root}${q ? suffix[q] : ''}${q === 'min' && e === 'maj7' ? '(maj7)' : e}`
}
