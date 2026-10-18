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

export type SequencerKind = 'degree' | 'trigger' | 'slice'

// A step is a degree (1-based), a slice index (0-based), 1 for a trigger, or null for a rest.
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
export const pieceCount = (s: SampleData): number => (isBank(s) ? (s.files as number) : s.slices)

export interface SequencerData extends Record<string, unknown> {
  kind: SequencerKind
  // Length is steps.length; each step lasts 1/resolution of a bar (one Strudel cycle).
  steps: Step[]
  resolution: number
  octave: number
  gain: number
  muted: boolean
  // Slices: show only rows that have hits (like Ableton's Fold).
  folded?: boolean
}

export interface ModeData extends Record<string, unknown> {
  steps: ModeStep[]
  // Cycles each mode step lasts.
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

export const newVelocity = (length = 16): VelocityData => ({
  steps: Array(length).fill(VELOCITY_LEVELS),
  resolution: STEP_RESOLUTION
})

export type VelocityNode = Node<VelocityData, 'velocity'>

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
  crush: { label: 'Bitcrush', params: [{ key: 'crush', label: 'bits', min: 1, max: 16, value: 6 }] },
  distort: { label: 'Distortion', params: [{ key: 'distort', label: 'drive', min: 0, max: 10, value: 2 }] },
  phaser: {
    label: 'Phaser',
    params: [
      { key: 'phaser', label: 'rate', min: 0, max: 10, value: 2 },
      { key: 'phaserdepth', label: 'depth', min: 0, max: 1, value: 0.5 }
    ]
  },
  coarse: { label: 'Downsample', params: [{ key: 'coarse', label: 'amount', min: 1, max: 32, value: 4 }] },
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
export type ModeNode = Node<ModeData, 'mode'>
export type GroupNode = Node<GroupData, 'group'>
export type CanvasNode = SampleNode | SequencerNode | ModeNode | VelocityNode | EffectNode | GroupNode

export interface CanvasState {
  nodes: CanvasNode[]
  edges: Edge[]
}

// Steps per bar (a bar is one Strudel cycle): every step is a 1/16.
export const STEP_RESOLUTION = 16

export const MAX_STEPS = 64

// Which step is playing at a cycle position: steps have a fixed size, so a pattern
// longer than a bar spans several cycles and loops after length steps.
export const stepAt = (cycle: number, length: number, resolution: number): number =>
  length > 0 ? ((Math.floor(cycle * resolution) % length) + length) % length : -1

// Degree rows shown in the grid, top to bottom.
export const DEGREE_ROWS = [8, 7, 6, 5, 4, 3, 2, 1]

export const newSequencer = (kind: SequencerKind, length = 16): SequencerData => ({
  kind,
  steps: Array(length).fill(null),
  resolution: STEP_RESOLUTION,
  octave: kind === 'degree' ? 3 : 0,
  gain: 0.8,
  muted: false
})

export const newMode = (): ModeData => ({
  steps: [{ tonic: 'C', mode: 'dorian' }],
  cyclesPerStep: 2
})

export const SYNTHS = ['sawtooth', 'square', 'triangle', 'sine', 'piano', 'supersaw']

// Synths that are really sample instruments, and the pack that provides them.
export const SYNTH_PACKS: Record<string, string> = { piano: 'piano' }

let counter = 0
export const nodeId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${counter++}`

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
  return {
    nodes: state.nodes.map((n) => {
      let node = (n.type as string) === 'volume' ? ({ ...n, type: 'velocity' } as CanvasNode) : n
      // Every step is a 1/16 for now (a note-length node may change that later). Older
      // canvases had steps squeezed into one bar; they become 1/16 steps, by design.
      if ((node.type === 'sequencer' || node.type === 'velocity') && node.data.resolution !== STEP_RESOLUTION)
        node = { ...node, data: { ...node.data, resolution: STEP_RESOLUTION } } as CanvasNode
      return node
    }),
    edges: state.edges
  }
}
