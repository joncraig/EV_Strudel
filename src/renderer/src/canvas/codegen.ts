// Compile the canvas graph to Strudel code.
//
//   sample ──▶ sequencer ──▶ velocity ──▶ (plays)
//                  ▲
//                 mode
//
// Each sequencer with a sound connected becomes one layer of a stack(). Steps have a
// fixed size (resolution, default 1/16) and length sets the loop, so different
// lengths drift against each other (polymeter).

import type { Edge } from '@xyflow/react'
import { EFFECTS, isBank, pieceCount, VELOCITY_LEVELS } from './model'
import type { CanvasNode, EffectData, ModeData, SampleData, SequencerData, Step, VelocityData } from './model'

const DEFAULT_MODE: ModeData = { steps: [{ tonic: 'C', mode: 'major' }], cyclesPerStep: 1 }

const quote = (s: string): string => JSON.stringify(s)

function stepPattern(steps: Step[], toToken: (v: number) => string): string {
  return steps.map((v) => (v === null ? '~' : toToken(v))).join(' ')
}

// Steps have a fixed size (1/resolution of a bar), so the pattern spans
// length/resolution bars: "[a b c]/2" in mini-notation plays over two cycles.
function timed(pattern: string, length: number, resolution: number): string {
  const bars = +(length / resolution).toFixed(6)
  return bars === 1 ? pattern : `[${pattern}]/${bars}`
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
  const len = seq.steps.length
  const res = seq.resolution || len
  let code: string
  switch (seq.kind) {
    case 'degree': {
      // UI degrees are 1-based; Strudel's are 0-based.
      const degrees = timed(stepPattern(seq.steps, (v) => String(v - 1)), len, res)
      code = `n("${degrees}").scale("${modePattern(mode ?? DEFAULT_MODE, seq.octave)}").s(${sound})`
      // scale() turns n into a note, so n is free again to pick the sample variant.
      if (sample.n) code += `.n(${sample.n})`
      break
    }
    case 'trigger': {
      code = `s(${sound}).n(${sample.n}).struct("${timed(stepPattern(seq.steps, () => 'x'), len, res)}")`
      break
    }
    case 'slice': {
      // Steps set before the piece count was lowered wrap around.
      const count = pieceCount(sample)
      const picks = timed(stepPattern(seq.steps, (v) => String(v % count)), len, res)
      // A multi-file sound picks files; a single file is cut into equal slices.
      code = isBank(sample)
        ? `n("${picks}").s(${sound})`
        : `s(${sound}).n(${sample.n}).slice(${count}, "${picks}")`
      break
    }
  }
  return `${code}.gain(${seq.gain})`
}

// Strudel's velocity is 0..1 and multiplies with gain, so accents scale the channel level.
export function velocityCode(data: VelocityData): string {
  const levels = timed(
    data.steps.map((v) => +(v / VELOCITY_LEVELS).toFixed(3)).join(' '),
    data.steps.length,
    data.resolution || data.steps.length
  )
  return `.velocity("${levels}")`
}

// Each setting becomes its Strudel control, e.g. .delay(0.5).delaytime(0.25).
export function effectCode(data: EffectData): string {
  if (data.bypass) return ''
  return EFFECTS[data.kind].params
    .map((p) => `.${p.key}(${+(data.params[p.key] ?? p.value).toFixed(3)})`)
    .join('')
}

export interface Compiled {
  code: string
  // Ids of the node that ends each playing chain, in stack order.
  layers: string[]
}

// Sequencers make patterns; nodes on their `pattern` output (Velocity, effects)
// modify them. Only the end of each chain plays, so a sequencer feeding a Velocity
// node is heard once, with the velocity applied. A fork plays each branch.
export function compile(nodes: CanvasNode[], edges: Edge[]): Compiled {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const inputs = (id: string, type: CanvasNode['type']): CanvasNode | undefined =>
    edges
      .filter((e) => e.target === id)
      .map((e) => byId.get(e.source))
      .find((n) => n?.type === type)
  const patternOuts = (id: string): CanvasNode[] =>
    edges
      .filter((e) => e.source === id && e.sourceHandle === 'pattern')
      .map((e) => byId.get(e.target))
      .filter((n): n is CanvasNode => n?.type === 'velocity' || n?.type === 'effect')

  const lines: string[] = []
  const layers: string[] = []
  const follow = (node: CanvasNode, code: string, seen: Set<string>): void => {
    const outs = patternOuts(node.id).filter((n) => !seen.has(n.id))
    if (!outs.length) {
      lines.push(code)
      layers.push(node.id)
      return
    }
    for (const next of outs) {
      const applied =
        next.type === 'velocity'
          ? code + velocityCode(next.data)
          : next.type === 'effect'
            ? code + effectCode(next.data)
            : code
      follow(next, applied, new Set(seen).add(next.id))
    }
  }

  for (const node of nodes) {
    if (node.type !== 'sequencer' || node.data.muted) continue
    const sample = inputs(node.id, 'sample')
    if (!sample) continue
    const mode = inputs(node.id, 'mode')
    const code = sequencerCode(node.data, sample.data as SampleData, mode ? (mode.data as ModeData) : null)
    if (code) follow(node, code, new Set([node.id]))
  }
  const code = lines.length ? `stack(\n  ${lines.join(',\n  ')}\n)` : 'silence'
  return { code, layers }
}

export type { SequencerData }
