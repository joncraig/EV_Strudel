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
  // Number of equal slices to cut the sample into (for slice sequencers).
  slices: number
}

export interface SequencerData extends Record<string, unknown> {
  kind: SequencerKind
  steps: Step[]
  octave: number
  gain: number
  muted: boolean
}

export interface ModeData extends Record<string, unknown> {
  steps: ModeStep[]
  // Cycles each mode step lasts.
  cyclesPerStep: number
}

export type SampleNode = Node<SampleData, 'sample'>
export type SequencerNode = Node<SequencerData, 'sequencer'>
export type ModeNode = Node<ModeData, 'mode'>
export type CanvasNode = SampleNode | SequencerNode | ModeNode

export interface CanvasState {
  nodes: CanvasNode[]
  edges: Edge[]
}

// Degree rows shown in the grid, top to bottom.
export const DEGREE_ROWS = [8, 7, 6, 5, 4, 3, 2, 1]

export const newSequencer = (kind: SequencerKind, length = 8): SequencerData => ({
  kind,
  steps: Array(length).fill(null),
  octave: kind === 'degree' ? 3 : 0,
  gain: 0.8,
  muted: false
})

export const newMode = (): ModeData => ({
  steps: [{ tonic: 'C', mode: 'dorian' }],
  cyclesPerStep: 2
})

export const SYNTHS = ['sawtooth', 'square', 'triangle', 'sine', 'piano', 'supersaw']

let counter = 0
export const nodeId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${counter++}`

// Drag-and-drop payload from the Samples tab.
export const SOUND_MIME = 'application/x-ev-sound'

export interface DraggedSound {
  s: string
  pack?: string
}
