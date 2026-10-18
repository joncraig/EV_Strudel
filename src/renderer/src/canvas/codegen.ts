// Compile the canvas graph to Strudel code.
//
//   sample ──▶ sequencer ◀── mode
//
// Each sequencer with a sound connected becomes one layer of a stack(). Every
// sequencer squeezes its steps into one cycle, so different lengths give polyrhythms.

import type { Edge } from '@xyflow/react'
import type { CanvasNode, ModeData, SampleData, SequencerData, Step } from './model'

const DEFAULT_MODE: ModeData = { steps: [{ tonic: 'C', mode: 'major' }], cyclesPerStep: 1 }

const quote = (s: string): string => JSON.stringify(s)

function stepPattern(steps: Step[], toToken: (v: number) => string): string {
  return steps.map((v) => (v === null ? '~' : toToken(v))).join(' ')
}

// "<C3:dorian C3:dorian D3:phrygian ...>": one entry per cycle.
function modePattern(mode: ModeData, octave: number): string {
  const perCycle = mode.steps.flatMap((m) =>
    Array(Math.max(1, mode.cyclesPerStep)).fill(`${m.tonic}${octave}:${m.mode}`)
  )
  return perCycle.length === 1 ? perCycle[0] : `<${perCycle.join(' ')}>`
}

export function sequencerCode(seq: SequencerData, sample: SampleData, mode: ModeData | null): string | null {
  if (seq.steps.every((v) => v === null)) return null
  const sound = quote(sample.s)
  let code: string
  switch (seq.kind) {
    case 'degree': {
      // UI degrees are 1-based; Strudel's are 0-based.
      const degrees = stepPattern(seq.steps, (v) => String(v - 1))
      code = `n("${degrees}").scale("${modePattern(mode ?? DEFAULT_MODE, seq.octave)}").s(${sound})`
      // scale() turns n into a note, so n is free again to pick the sample variant.
      if (sample.n) code += `.n(${sample.n})`
      break
    }
    case 'trigger': {
      code = `s(${sound}).n(${sample.n}).struct("${stepPattern(seq.steps, () => 'x')}")`
      break
    }
    case 'slice': {
      const slices = stepPattern(seq.steps, (v) => String(v))
      code = `s(${sound}).n(${sample.n}).slice(${sample.slices}, "${slices}")`
      break
    }
  }
  return `${code}.gain(${seq.gain})`
}

export interface Compiled {
  code: string
  // Sequencer ids that produced a layer, in stack order.
  layers: string[]
}

export function compile(nodes: CanvasNode[], edges: Edge[]): Compiled {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const inputs = (id: string, type: CanvasNode['type']): CanvasNode | undefined =>
    edges
      .filter((e) => e.target === id)
      .map((e) => byId.get(e.source))
      .find((n) => n?.type === type)

  const lines: string[] = []
  const layers: string[] = []
  for (const node of nodes) {
    if (node.type !== 'sequencer' || node.data.muted) continue
    const sample = inputs(node.id, 'sample')
    if (!sample) continue
    const mode = inputs(node.id, 'mode')
    const code = sequencerCode(
      node.data,
      sample.data as SampleData,
      mode ? (mode.data as ModeData) : null
    )
    if (code) {
      lines.push(code)
      layers.push(node.id)
    }
  }
  const code = lines.length ? `stack(\n  ${lines.join(',\n  ')}\n)` : 'silence'
  return { code, layers }
}

export type { SequencerData }
