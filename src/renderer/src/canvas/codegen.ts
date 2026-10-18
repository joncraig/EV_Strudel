// Compile the canvas graph to Strudel code.
//
//   sample ──▶ sequencer ──▶ key / mode / length / velocity / effects ──▶ (plays)
//
// Each sequencer with a sound connected becomes one layer of a stack(). Steps have a
// fixed size (resolution, default 1/16) and length sets the loop, so different
// lengths drift against each other (polymeter).

import type { Edge } from '@xyflow/react'
import { EFFECTS, heldValues, isBank, LENGTH_STEPS, MODES, pieceCount, STEP_RESOLUTION, TONICS, VELOCITY_LEVELS } from './model'
import type { CanvasNode, EffectData, KeyData, LengthData, ModeData, SampleData, SequencerData, Step, VelocityData } from './model'

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

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
const MAX_HARMONY_STEPS = 4096

// The scale per step, from the Key and Mode sequencers (C / Ionian when not wired).
// Their lengths can differ, so the combined loop runs for lcm(lengths) steps, e.g.
// "[D3:dorian D3:dorian ... E3:phrygian ...]/8". Empty steps hold the last value.
function harmonyPattern(key: KeyData | null, mode: ModeData | null, octave: number): string {
  const keys = key?.steps.length ? heldValues(key.steps, 0) : [0]
  const modes = mode?.steps.length ? heldValues(mode.steps, 0) : [0]
  const length = Math.min(MAX_HARMONY_STEPS, (keys.length * modes.length) / gcd(keys.length, modes.length))
  const tokens = Array.from(
    { length },
    (_, i) => `${TONICS[keys[i % keys.length]] ?? 'C'}${octave}:${MODES[modes[i % modes.length]]?.id ?? 'major'}`
  )
  if (tokens.every((tk) => tk === tokens[0])) return tokens[0]
  return timed(tokens.join(' '), length, STEP_RESOLUTION)
}

// Notes code has a placeholder where the scale goes: Key and Mode are chain nodes,
// so the scale is only known once the chain has been followed (see compile).
const SCALE = '__SCALE__'

export function sequencerCode(seq: SequencerData, sample: SampleData): string | null {
  if (seq.steps.every((v) => v === null)) return null
  const sound = quote(sample.s)
  const len = seq.steps.length
  const res = seq.resolution || len
  let code: string
  switch (seq.kind) {
    case 'degree': {
      // UI degrees are 1-based; Strudel's are 0-based.
      const degrees = timed(stepPattern(seq.steps, (v) => String(v - 1)), len, res)
      code = `n("${degrees}")${SCALE}.s(${sound})`
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

// Strudel's clip multiplies each note's duration and cuts samples at the end.
export function lengthCode(data: LengthData): string {
  const factors = data.steps.map((v) => LENGTH_STEPS[v - 1] ?? 1).join(' ')
  return `.clip("${timed(factors, data.steps.length, data.resolution || data.steps.length)}")`
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
  const CHAIN = new Set(['velocity', 'length', 'effect', 'key', 'mode'])
  const patternOuts = (id: string): CanvasNode[] =>
    edges
      .filter((e) => e.source === id && e.sourceHandle === 'pattern')
      .map((e) => byId.get(e.target))
      .filter((n): n is CanvasNode => !!n && CHAIN.has(n.type))

  // Key and Mode anywhere in a chain set the scale for that chain's Notes.
  interface Harmony {
    key: KeyData | null
    mode: ModeData | null
    octave: number
  }

  const lines: string[] = []
  const layers: string[] = []
  const follow = (node: CanvasNode, code: string, seen: Set<string>, harmony: Harmony): void => {
    const outs = patternOuts(node.id).filter((n) => !seen.has(n.id))
    if (!outs.length) {
      const scale = `.scale("${harmonyPattern(harmony.key, harmony.mode, harmony.octave)}")`
      lines.push(code.replace(SCALE, scale))
      layers.push(node.id)
      return
    }
    for (const next of outs) {
      const h =
        next.type === 'key'
          ? { ...harmony, key: next.data }
          : next.type === 'mode'
            ? { ...harmony, mode: next.data }
            : harmony
      const applied =
        next.type === 'velocity'
          ? code + velocityCode(next.data)
          : next.type === 'length'
            ? code + lengthCode(next.data)
            : next.type === 'effect'
              ? code + effectCode(next.data)
              : code
      follow(next, applied, new Set(seen).add(next.id), h)
    }
  }

  for (const node of nodes) {
    if (node.type !== 'sequencer' || node.data.muted) continue
    const sample = inputs(node.id, 'sample')
    if (!sample) continue
    const code = sequencerCode(node.data, sample.data as SampleData)
    if (code) follow(node, code, new Set([node.id]), { key: null, mode: null, octave: node.data.octave })
  }
  const code = lines.length ? `stack(\n  ${lines.join(',\n  ')}\n)` : 'silence'
  return { code, layers }
}

export type { SequencerData }
