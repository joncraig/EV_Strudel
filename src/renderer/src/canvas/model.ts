// Canvas graph model. The canvas compiles to Strudel code (see codegen.ts); nothing
// here talks to audio directly.

import type { Edge, Node } from '@xyflow/react'

export const TONICS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const

// Strudel scale names; ':' separates words in mini-notation ("C:harmonic:minor").
export const MODES: { id: string; label: string }[] = [
  { id: 'major', label: 'Ionian (major)' },
  { id: 'dorian', label: 'Dorian' },
  { id: 'phrygian', label: 'Phrygian' },
  { id: 'lydian', label: 'Lydian' },
  { id: 'mixolydian', label: 'Mixolydian' },
  { id: 'minor', label: 'Aeolian (minor)' },
  { id: 'locrian', label: 'Locrian' },
  { id: 'harmonic:minor', label: 'Harmonic minor' },
  { id: 'melodic:minor', label: 'Melodic minor' },
  { id: 'major:pentatonic', label: 'Major pentatonic' },
  { id: 'minor:pentatonic', label: 'Minor pentatonic' },
  { id: 'whole:tone', label: 'Whole tone' },
  { id: 'chromatic', label: 'Chromatic' }
]

export interface ModeStep {
  tonic: string
  mode: string
}

export type SequencerKind = 'degree' | 'slice'

// A step is a degree (1-based), a piece index (0-based), or null for a rest.
export type Step = number | null

export interface SampleData extends Record<string, unknown> {
  s: string
  n: number
  pack?: string
  // Shown on the chip: the file name when a single variant was dragged.
  label?: string
  // Number of equal slices to cut the sample into (for slice sequencers).
  slices: number
  // Set when a whole multi-file sound was dragged: its files are the pieces.
  files?: number
}

// What a Slices sequencer picks from: the sound's files, or cuts of one file.
export const isBank = (s: SampleData): boolean => (s.files ?? 0) > 1
// A multi-file sound's pieces are its files; a single sound is one piece (the whole
// sound) until a Slice node cuts it.
export const pieceCount = (s: SampleData): number => (isBank(s) ? (s.files as number) : 1)

export interface SequencerData extends Record<string, unknown> {
  kind: SequencerKind
  // Length is steps.length; each step lasts 1/resolution of a bar (one Strudel cycle).
  steps: Step[]
  resolution: number
  octave: number
  // Older saves had a gain fader here; migrateCanvas removes it (Velocity sets level).
  gain?: number
  muted: boolean
  // Slices: show only rows that have hits (like Ableton's Fold).
  folded?: boolean
}

// Key and Mode are step sequencers like the others (1/16 steps). A step holds an
// index into TONICS / MODES; an empty step holds whatever came before.
export interface KeyData extends Record<string, unknown> {
  steps: Step[]
  resolution: number
  folded?: boolean
}

export interface ModeData extends Record<string, unknown> {
  steps: Step[]
  resolution: number
  folded?: boolean
}

// Octave as a step sequencer: a step holds an octave number (1..7); empty steps hold.
// Octave steps are relative: octaves up or down from where the sound already is
// (notes: octave 3; samples: their original pitch). 0 = no change.
export interface OctaveData extends Record<string, unknown> {
  steps: Step[]
  resolution: number
  folded?: boolean
  // 2 = relative steps (-4..+4). Older saves held absolute octaves 1..7.
  version?: number
}
export const OCTAVES = [-4, -3, -2, -1, 0, 1, 2, 3, 4]
export const octaveLabel = (v: number): string => (v > 0 ? `+${v}` : String(v))
export const DEFAULT_OCTAVE = 3

// The list-style mode node from before Key and Mode were split (migrated on load).
interface LegacyModeData {
  steps: ModeStep[]
  cyclesPerStep: number
}

export type SampleNode = Node<SampleData, 'sample'>
export type SequencerNode = Node<SequencerData, 'sequencer'>
export interface GroupData extends Record<string, unknown> {
  label: string
  collapsed: boolean
  // Frame size while expanded, restored when the group is opened again.
  width: number
  height: number
}

// Per-step loudness, applied to whatever pattern is wired into it. Steps are levels
// 1..VELOCITY_LEVELS (top = full). Its own step count, so accents can run polymetric.
export interface VelocityData extends Record<string, unknown> {
  steps: number[]
  resolution: number
}

export const VELOCITY_LEVELS = 8

// Rows are 6 dB apart (loudness is heard in dB, not amplitude): top row 0 dB, bottom
// row -42 dB, nearly silent. Strudel's velocity multiplies gain linearly.
export const velocityDb = (level: number): number => -6 * (VELOCITY_LEVELS - level)
export const velocityGain = (level: number): number => Math.pow(10, velocityDb(level) / 20)

export const newVelocity = (length = 1): VelocityData => ({
  steps: Array(length).fill(VELOCITY_LEVELS),
  resolution: STEP_RESOLUTION
})

export type VelocityNode = Node<VelocityData, 'velocity'>

// Per-step note length, in steps: a step holds an index (1..8) into LENGTH_STEPS.
// Becomes Strudel's clip, which multiplies each note's duration (one step) and cuts
// samples off at the end: 2 = held for two steps, 0.5 = staccato.
// In steps (a step is a 1/16 note), shortest first: 1/16 up to a whole bar.
export const LENGTH_STEPS = [1, 2, 3, 4, 6, 8, 12, 16]
const LENGTH_NAMES = ['1/16', '1/8', '3/16', '1/4', '3/8', '1/2', '3/4', '1 bar']
export const LENGTH_FULL_STEP = 1 // index of one step (1/16)
export const lengthLabel = (level: number): string => LENGTH_NAMES[level - 1] ?? ''

export interface LengthData extends Record<string, unknown> {
  steps: number[]
  resolution: number
  // 2 = note-value table (1/16..1 bar). Older nodes used step fractions (1/4 step..8).
  version?: number
  folded?: boolean
}

export type LengthNode = Node<LengthData, 'length'>

// ---- Effects: pattern in, pattern out, each setting is a Strudel control ----

export interface EffectParam {
  key: string // Strudel control name
  label: string
  min: number
  max: number
  value: number // default
  log?: boolean // frequencies: fader moves evenly through octaves
}

export const EFFECTS = {
  delay: {
    label: 'Delay',
    params: [
      { key: 'delay', label: 'wet', min: 0, max: 1, value: 0.5 },
      { key: 'delaytime', label: 'time', min: 0.01, max: 1, value: 0.25 },
      { key: 'delayfeedback', label: 'fdbk', min: 0, max: 0.95, value: 0.5 }
    ]
  },
  reverb: {
    label: 'Reverb',
    params: [
      { key: 'room', label: 'wet', min: 0, max: 1, value: 0.5 },
      { key: 'size', label: 'size', min: 0, max: 10, value: 4 }
    ]
  },
  lowpass: {
    label: 'Low-pass',
    params: [
      { key: 'lpf', label: 'cutoff', min: 40, max: 16000, value: 2000, log: true },
      { key: 'lpq', label: 'reso', min: 0, max: 20, value: 1 }
    ]
  },
  highpass: {
    label: 'High-pass',
    params: [
      { key: 'hpf', label: 'cutoff', min: 20, max: 8000, value: 300, log: true },
      { key: 'hpq', label: 'reso', min: 0, max: 20, value: 1 }
    ]
  },
  crush: {
    label: 'Bitcrush',
    params: [{ key: 'crush', label: 'bits', min: 1, max: 16, value: 6 }]
  },
  distort: {
    label: 'Distortion',
    params: [
      { key: 'distort', label: 'drive', min: 0, max: 10, value: 2 },
      // Output level after the drive (distortion adds a lot of volume).
      { key: 'distortvol', label: 'level', min: 0, max: 1, value: 0.5 }
    ]
  },
  phaser: {
    label: 'Phaser',
    params: [
      { key: 'phaser', label: 'rate', min: 0, max: 10, value: 2 },
      { key: 'phaserdepth', label: 'depth', min: 0, max: 1, value: 0.5 }
    ]
  },
  coarse: {
    label: 'Downsample',
    params: [{ key: 'coarse', label: 'amount', min: 1, max: 32, value: 4 }]
  },
  pan: { label: 'Pan', params: [{ key: 'pan', label: 'L–R', min: 0, max: 1, value: 0.5 }] }
} satisfies Record<string, { label: string; params: EffectParam[] }>

export type EffectKind = keyof typeof EFFECTS

export interface EffectData extends Record<string, unknown> {
  kind: EffectKind
  params: Record<string, number>
  bypass?: boolean
}

export const newEffect = (kind: EffectKind): EffectData => ({
  kind,
  params: Object.fromEntries(EFFECTS[kind].params.map((p) => [p.key, p.value]))
})

export type EffectNode = Node<EffectData, 'effect'>
// A Bus (type 'mix' in saved files): several chains in, one out; they play stacked
// through whatever follows (shared effects). Each Bus is its own Strudel orbit, so its
// delay/reverb are its own, and its Volume and Pan act live on the orbit's audio
// (audio/modulation.ts), not through the code, so they move instantly and can be
// modulated smoothly.
export interface MixData extends Record<string, unknown> {
  label?: string
  // Linear gain, 0..1.5 (1 = unchanged).
  volume?: number
  // -1 (left) .. 1 (right).
  pan?: number
}

export const BUS_MAX_VOLUME = 1.5

export type MixNode = Node<MixData, 'mix'>

// ---- Modulators ----

// An LFO: a repeating wave, synced to the tempo, added onto whatever its mod output is
// wired to (a Bus's Volume or Pan, or another LFO's Rate or Depth).
export type LfoShape = 'sine' | 'triangle' | 'sawtooth' | 'square' | 'random'
export const LFO_SHAPES: { id: LfoShape; label: string }[] = [
  { id: 'sine', label: 'Sine' },
  { id: 'triangle', label: 'Tri' },
  { id: 'sawtooth', label: 'Saw' },
  { id: 'square', label: 'Square' },
  { id: 'random', label: 'S&H' }
]
// One cycle of the wave, in bars.
export const LFO_RATES = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8, 16]
export const lfoRateLabel = (bars: number): string =>
  bars >= 1 ? `${bars} bar${bars === 1 ? '' : 's'}` : `1/${Math.round(1 / bars)}`

export interface LfoData extends Record<string, unknown> {
  shape: LfoShape
  // Bars per cycle (one of LFO_RATES).
  rate: number
  // How far it swings, 0..1 (1 = the target's full range; see modulation.ts).
  depth: number
  // Where in the cycle it starts at bar 1, 0..1.
  phase: number
}

export const newLfo = (): LfoData => ({ shape: 'sine', rate: 1, depth: 0.5, phase: 0 })

// Modulation inputs each node type has (handle id = MOD_PREFIX + param).
export const MOD_PREFIX = 'mod:'
export const MOD_TARGETS: Record<string, string[]> = {
  mix: ['volume', 'pan'],
  lfo: ['rate', 'depth']
}

export type LfoNode = Node<LfoData, 'lfo'>
export type KeyNode = Node<KeyData, 'key'>
export type OctaveNode = Node<OctaveData, 'octave'>
export type ModeNode = Node<ModeData, 'mode'>
export type GroupNode = Node<GroupData, 'group'>
export type CanvasNode =
  | SampleNode
  | SequencerNode
  | MixNode
  | LfoNode
  | KeyNode
  | OctaveNode
  | ModeNode
  | VelocityNode
  | LengthNode
  | EffectNode
  | GroupNode

export interface CanvasState {
  nodes: CanvasNode[]
  edges: Edge[]
}

// Steps per bar (a bar is one Strudel cycle): every step is a 1/16.
export const STEP_RESOLUTION = 16

export const MAX_STEPS = 128

// Which step is playing at a cycle position: steps have a fixed size, so a pattern
// longer than a bar spans several cycles and loops after length steps.
export const stepAt = (cycle: number, length: number, resolution: number): number =>
  length > 0 ? ((Math.floor(cycle * resolution) % length) + length) % length : -1

// How many steps until a pattern of `length` steps and a list of step lengths line
// up again (lcm), capped so a long pair can't blow up.
const gcdN = (a: number, b: number): number => (b ? gcdN(b, a % b) : a)
export const loopSteps = (length: number, lensCount: number): number =>
  Math.min(4096, (length * lensCount) / gcdN(length, lensCount))

// The playing step when steps have varying lengths (in 1/16 steps). The steps and the
// lengths each loop at their own count: step i lasts lens[i % lens.length].
export function stepAtLens(cycle: number, length: number, lens: number[]): number {
  const n = loopSteps(length, lens.length)
  const w = Array.from({ length: n }, (_, i) => lens[i % lens.length])
  const total = w.reduce((a, b) => a + b, 0)
  if (!total) return -1
  let pos = Math.floor(cycle * STEP_RESOLUTION) % total
  for (let i = 0; i < n; i++) {
    if (pos < w[i]) return i % length
    pos -= w[i]
  }
  return -1
}

// Degree rows shown in the grid, top to bottom.
export const DEGREE_ROWS = [8, 7, 6, 5, 4, 3, 2, 1]

// Every new node starts as one step; drag its length pill to make it longer.
export const newSequencer = (kind: SequencerKind, length = 1): SequencerData => ({
  kind,
  steps: Array(length).fill(null),
  resolution: STEP_RESOLUTION,
  octave: kind === 'degree' ? 3 : 0,
  muted: false
})

// One step, set (C, Ionian); lengthen it to sequence changes.
export const newKey = (): KeyData => ({
  steps: [0],
  resolution: STEP_RESOLUTION
})
// One octave unless lengthened into a sequence.
export const newOctave = (): OctaveData => ({ steps: [0], resolution: STEP_RESOLUTION, version: 2 })
export const newMode = (): ModeData => ({
  steps: [0],
  resolution: STEP_RESOLUTION
})

// One length unless it's lengthened into a sequence of them.
export const newLength = (length = 1): LengthData => ({
  steps: Array(length).fill(LENGTH_FULL_STEP),
  resolution: STEP_RESOLUTION,
  version: 2
})

// Fill holds: each empty step takes the last set value (wrapping, so the start of
// the loop holds what the end set). All-empty gives the fallback.
export function heldValues(steps: Step[], fallback: number): number[] {
  const last = [...steps].reverse().find((v) => v !== null)
  let cur = last ?? fallback
  return steps.map((v) => (cur = v ?? cur))
}

export const SYNTHS = ['sawtooth', 'square', 'triangle', 'sine', 'piano', 'supersaw']

// Synths that are really sample instruments, and the pack that provides them.
export const SYNTH_PACKS: Record<string, string> = { piano: 'piano' }

let counter = 0
export const nodeId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${counter++}`

// A sound dragged or added from the Samples tab.

export interface DraggedSound {
  s: string
  pack?: string
  // Shown on the chip: the file name when a single variant was dragged.
  label?: string
  // Sample variant; 0 when not given.
  n?: number
  // File count, when a whole multi-file sound is dragged.
  files?: number
}

// Bring older saved canvases up to date. (The Velocity node was briefly called Volume.)
export function migrateCanvas(state: CanvasState): CanvasState {
  state = chainSamples(chainHarmony(splitLegacyModes(state)))
  // Wires are all drawn the same now (key/mode used to be animated).
  state = {
    nodes: state.nodes,
    edges: state.edges.map((e) => (e.animated ? { ...e, animated: false } : e))
  }
  return {
    nodes: state.nodes.map((n) => {
      let node = (n.type as string) === 'volume' ? ({ ...n, type: 'velocity' } as CanvasNode) : n
      // Every step is a 1/16 for now (a note-length node may change that later). Older
      // canvases had steps squeezed into one bar; they become 1/16 steps, by design.
      if (
        (node.type === 'sequencer' || node.type === 'velocity' || node.type === 'length') &&
        node.data.resolution !== STEP_RESOLUTION
      )
        node = { ...node, data: { ...node.data, resolution: STEP_RESOLUTION } } as CanvasNode
      // The gain fader is gone (Velocity sets level): a sequencer at 0 becomes muted,
      // otherwise its gain is dropped.
      if (node.type === 'sequencer' && node.data.gain !== undefined) {
        const { gain, ...rest } = node.data
        node = { ...node, data: { ...rest, muted: rest.muted || gain === 0 } } as CanvasNode
      }
      // Rhythm sequencers are gone: a Slices sequencer with one row is the same thing.
      if (node.type === 'sequencer' && (node.data.kind as string) === 'trigger')
        node = {
          ...node,
          data: {
            ...node.data,
            kind: 'slice',
            steps: node.data.steps.map((v) => (v === null ? null : 0))
          }
        } as CanvasNode
      // Octave steps were absolute (1..7, 3 = normal); now they're relative to 3.
      if (node.type === 'octave' && node.data.version !== 2)
        node = {
          ...node,
          data: {
            ...node.data,
            version: 2,
            steps: node.data.steps.map((v) => (v === null ? null : v - DEFAULT_OCTAVE))
          }
        } as CanvasNode
      // Length table v1 was [1/4, 1/2, 1, 2, 3, 4, 6, 8] steps; map to the nearest v2 value.
      if (node.type === 'length' && node.data.version !== 2) {
        const V1 = [0.25, 0.5, 1, 2, 3, 4, 6, 8]
        const nearest = (steps: number): number =>
          LENGTH_STEPS.reduce(
            (best, s, i) => (Math.abs(s - steps) < Math.abs(LENGTH_STEPS[best] - steps) ? i : best),
            0
          ) + 1
        node = {
          ...node,
          data: {
            ...node.data,
            version: 2,
            steps: node.data.steps.map((v) => nearest(V1[v - 1] ?? 1))
          }
        } as CanvasNode
      }
      return node
    }),
    edges: state.edges
  }
}

// ---- Pitch names for scale degrees (for labelling the piano roll) ----

const MODE_STEPS: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  minor: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  'harmonic:minor': [0, 2, 3, 5, 7, 8, 11],
  'melodic:minor': [0, 2, 3, 5, 7, 9, 11],
  'major:pentatonic': [0, 2, 4, 7, 9],
  'minor:pentatonic': [0, 3, 5, 7, 10],
  'whole:tone': [0, 2, 4, 6, 8, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
}
const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

// "D3" for degree 1 of D dorian at octave 3, "E3" for degree 2, and so on (1-based).
export function degreeName(degree: number, tonic: string, mode: string, octave: number): string {
  const steps = MODE_STEPS[mode] ?? MODE_STEPS.major
  const tonicPc = Math.max(
    0,
    SHARPS.indexOf(tonic) >= 0 ? SHARPS.indexOf(tonic) : FLATS.indexOf(tonic)
  )
  const i = degree - 1
  const semis =
    tonicPc +
    steps[((i % steps.length) + steps.length) % steps.length] +
    12 * Math.floor(i / steps.length)
  const names = tonic.includes('b') || tonic === 'F' ? FLATS : SHARPS
  return `${names[((semis % 12) + 12) % 12]}${octave + Math.floor(semis / 12)}`
}

// Old "Mode sequence" nodes held a list of {tonic, mode} each lasting N bars. Turn
// each into a Mode sequencer (same id) plus a Key sequencer wired to the same Notes
// sequencers, with a change marked at the start of each list entry.
function splitLegacyModes(state: CanvasState): CanvasState {
  const nodes: CanvasNode[] = []
  const edges = [...state.edges]
  for (const n of state.nodes) {
    const legacy = n.data as unknown as LegacyModeData
    if (n.type !== 'mode' || legacy.cyclesPerStep === undefined) {
      nodes.push(n)
      continue
    }
    const span = Math.max(1, legacy.cyclesPerStep) * STEP_RESOLUTION
    const length = Math.min(MAX_STEPS, Math.max(1, legacy.steps.length) * span)
    const keySteps: Step[] = Array(length).fill(null)
    const modeSteps: Step[] = Array(length).fill(null)
    legacy.steps.forEach((s, i) => {
      if (i * span >= length) return
      keySteps[i * span] = Math.max(0, (TONICS as readonly string[]).indexOf(s.tonic))
      modeSteps[i * span] = Math.max(
        0,
        MODES.findIndex((m) => m.id === s.mode)
      )
    })
    const keyId = `${n.id}-key`
    nodes.push({
      id: keyId,
      type: 'key',
      position: { x: n.position.x, y: n.position.y - 300 },
      parentId: n.parentId,
      data: { steps: keySteps, resolution: STEP_RESOLUTION }
    } as CanvasNode)
    nodes.push({ ...n, data: { steps: modeSteps, resolution: STEP_RESOLUTION } } as CanvasNode)
    for (const e of state.edges.filter((e) => e.source === n.id && e.sourceHandle === 'mode'))
      edges.push({
        ...e,
        id: `${e.id}-key`,
        source: keyId,
        sourceHandle: 'key',
        targetHandle: 'key'
      })
  }
  return { nodes, edges }
}

// Key and Mode used to plug into a Notes sequencer's own key/mode inputs. They're
// chain nodes now: rewire Notes -> Key -> Mode -> (whatever Notes fed before).
function chainHarmony(state: CanvasState): CanvasState {
  const byId = new Map(state.nodes.map((n) => [n.id, n]))
  const old = state.edges.filter(
    (e) =>
      (e.targetHandle === 'key' || e.targetHandle === 'mode') &&
      byId.get(e.target)?.type === 'sequencer'
  )
  if (!old.length) return state
  let edges = state.edges.filter((e) => !old.includes(e))
  for (const seqId of new Set(old.map((e) => e.target))) {
    const chain = ['key', 'mode']
      .map((h) => old.find((e) => e.target === seqId && e.targetHandle === h)?.source)
      .filter((id): id is string => !!id)
    const outs = edges.filter((e) => e.source === seqId && e.sourceHandle === 'pattern')
    edges = edges.filter((e) => !outs.includes(e))
    const link = (source: string, target: string): Edge => ({
      id: `e-${source}-${target}-pattern`,
      source,
      target,
      sourceHandle: 'pattern',
      targetHandle: 'pattern'
    })
    let prev = seqId
    for (const id of chain) {
      edges.push(link(prev, id))
      prev = id
    }
    for (const o of outs) edges.push({ ...o, id: `${o.id}-via-${prev}`, source: prev })
  }
  return { nodes: state.nodes, edges }
}

// ---- Chain walking (pattern wires) ----

const patternEdges = (edges: Edge[]): Edge[] => edges.filter((e) => e.sourceHandle === 'pattern')

// First node of a type after id along the chain (e.g. the Sample a sequencer plays).
export function downstream(
  nodes: CanvasNode[],
  edges: Edge[],
  id: string,
  type: CanvasNode['type']
): CanvasNode | undefined {
  const pe = patternEdges(edges)
  const seen = new Set([id])
  let frontier = [id]
  while (frontier.length) {
    const next: string[] = []
    for (const from of frontier)
      for (const e of pe.filter((e) => e.source === from)) {
        const n = nodes.find((n) => n.id === e.target)
        if (!n || seen.has(n.id)) continue
        if (n.type === type) return n
        seen.add(n.id)
        if (n.type !== 'mix') next.push(n.id) // a Mix starts a new, shared chain
      }
    frontier = next
  }
  return undefined
}

// Nodes of a type before id along the chain (e.g. the sequencers feeding a Sample).
export function upstream(
  nodes: CanvasNode[],
  edges: Edge[],
  id: string,
  type: CanvasNode['type']
): CanvasNode[] {
  const pe = patternEdges(edges)
  const seen = new Set([id])
  const found: CanvasNode[] = []
  let frontier = [id]
  while (frontier.length) {
    const next: string[] = []
    for (const to of frontier)
      for (const e of pe.filter((e) => e.target === to)) {
        const n = nodes.find((n) => n.id === e.source)
        if (!n || seen.has(n.id)) continue
        seen.add(n.id)
        if (n.type === type) found.push(n)
        if (n.type !== 'mix') next.push(n.id)
      }
    frontier = next
  }
  return found
}

// Samples used to plug into a sequencer's sound input. Sound is a chain dimension
// now: rewire Sample -> Seq as Seq -> Sample -> (whatever Seq fed before). A sample
// that fed several sequencers is copied, one per sequencer, so chains stay separate.
function chainSamples(state: CanvasState): CanvasState {
  const old = state.edges.filter((e) => e.sourceHandle === 'sound')
  if (!old.length) return state
  const nodes = [...state.nodes]
  let edges = state.edges.filter((e) => !old.includes(e))
  const used = new Set<string>()
  for (const e of old) {
    let sampleId = e.source
    const original = nodes.find((n) => n.id === e.source)
    if (!original) continue
    if (used.has(sampleId)) {
      sampleId = `${e.source}-${e.target}`
      nodes.push({
        ...original,
        id: sampleId,
        position: { x: original.position.x, y: original.position.y + 60 }
      })
    }
    used.add(sampleId)
    const outs = edges.filter((x) => x.source === e.target && x.sourceHandle === 'pattern')
    edges = edges.filter((x) => !outs.includes(x))
    edges.push({
      id: `e-${e.target}-${sampleId}-pattern`,
      source: e.target,
      target: sampleId,
      sourceHandle: 'pattern',
      targetHandle: 'pattern'
    })
    for (const o of outs) edges.push({ ...o, id: `${o.id}-via-${sampleId}`, source: sampleId })
  }
  return { nodes, edges }
}

// The sound a sequencer plays, as compile() resolves it: a Sample in a parameter
// chain wired into it comes first; otherwise the first Sample after it.
export function sequencerSample(
  nodes: CanvasNode[],
  edges: Edge[],
  id: string
): SampleData | undefined {
  const pe = patternEdges(edges)
  const seen = new Set([id])
  let frontier = [id]
  while (frontier.length) {
    const next: string[] = []
    for (const to of frontier)
      for (const e of pe.filter((e) => e.target === to)) {
        const n = nodes.find((n) => n.id === e.source)
        // Another sequencer upstream is a separate playing chain, not a parameter.
        if (!n || seen.has(n.id) || n.type === 'sequencer' || n.type === 'mix') continue
        if (n.type === 'sample') return n.data
        seen.add(n.id)
        next.push(n.id)
      }
    frontier = next
  }
  return downstream(nodes, edges, id, 'sample')?.data as SampleData | undefined
}
