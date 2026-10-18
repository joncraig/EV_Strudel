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
  // Every node on a playing chain; the rest are shown as not playing.
  active: Set<string>
}

// Without a Sample in the chain, Notes play this synth; other sequencers stay silent.
const DEFAULT_NOTE_SOUND: SampleData = { s: 'triangle', n: 0, slices: 8 }

// Parameter chains (no sequencer) wired into a sequencer or any node of a playing
// chain set values there, held until overridden later in the chain.
// A chain starts at a sequencer (when) and every node after it adds a dimension of
// what: Sample (sound), Key, Mode, Length, Velocity, effects, each with its own
// length. Only chain ends play. A Mix gathers several chains, stacks them, and
// continues as one chain on its own orbit, so effects after it are shared by its
// inputs (and its delay/reverb are its own).
export function compile(nodes: CanvasNode[], edges: Edge[]): Compiled {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const CHAIN = new Set(['sample', 'velocity', 'length', 'effect', 'key', 'mode', 'mix'])
  const patternOuts = (id: string): CanvasNode[] =>
    edges
      .filter((e) => e.source === id && e.sourceHandle === 'pattern')
      .map((e) => byId.get(e.target))
      .filter((n): n is CanvasNode => !!n && CHAIN.has(n.type))

  // What a chain has gathered so far. A sequencer start builds its pattern only at
  // the end, once it knows its sound and scale; a Mix start is already a pattern.
  interface Ctx {
    seq: SequencerData | null
    base: string | null
    sample: SampleData | null
    key: KeyData | null
    mode: ModeData | null
    mods: string // appended controls: .velocity() .clip() .delay() ...
  }

  const finish = (ctx: Ctx): string | null => {
    if (ctx.base) return ctx.base + ctx.mods
    if (!ctx.seq) return null
    const sample = ctx.sample ?? (ctx.seq.kind === 'degree' ? DEFAULT_NOTE_SOUND : null)
    if (!sample) return null
    const code = sequencerCode(ctx.seq, sample)
    if (!code) return null
    const scale = `.scale("${harmonyPattern(ctx.key, ctx.mode, ctx.seq.octave)}")`
    return code.replace(SCALE, scale) + ctx.mods
  }

  // Parameter nodes set values that hold until something later overrides them.
  const apply = (ctx: Ctx, n: CanvasNode): Ctx => {
    const c = { ...ctx }
    if (n.type === 'sample') {
      // The first sound sets how the sequencer plays (files, slices); later ones re-voice it.
      if (!c.sample && !c.base) c.sample = n.data
      else c.mods += `.s(${quote(n.data.s)}).n(${n.data.n})`
    } else if (n.type === 'key') c.key = n.data
    else if (n.type === 'mode') c.mode = n.data
    else if (n.type === 'velocity') c.mods += velocityCode(n.data)
    else if (n.type === 'length') c.mods += lengthCode(n.data)
    else if (n.type === 'effect') c.mods += effectCode(n.data)
    return c
  }

  // A parameter chain is a run of parameter nodes with no sequencer upstream
  // (e.g. Length -> Key -> Mode). Wired into a node, its values apply there, in
  // order, before that node's own; returns null if a sequencer is upstream (that's
  // a playing chain, handled by follow).
  const paramChain = (id: string, seen: Set<string>): CanvasNode[] | null => {
    const n = byId.get(id)
    if (!n || n.type === 'sequencer' || n.type === 'mix' || seen.has(id)) return null
    const before: CanvasNode[] = []
    for (const e of edges.filter((e) => e.target === id && e.sourceHandle === 'pattern')) {
      const up = paramChain(e.source, new Set(seen).add(id))
      if (up === null) return null
      before.push(...up)
    }
    return [...before, n]
  }
  // Apply the parameter chains wired into id (skipping the edge the flow arrived on).
  const applySide = (ctx: Ctx, id: string, from: string | null): Ctx => {
    let c = ctx
    for (const e of edges.filter((e) => e.target === id && e.sourceHandle === 'pattern' && e.source !== from)) {
      const chain = paramChain(e.source, new Set([id]))
      if (chain) for (const p of chain) c = apply(c, p)
    }
    return c
  }

  const lines: string[] = []
  const layers: string[] = []
  const active = new Set<string>()
  const mixMembers = new Map<string, string[]>()

  const follow = (node: CanvasNode, ctx: Ctx, seen: Set<string>): void => {
    active.add(node.id)
    const outs = patternOuts(node.id).filter((n) => !seen.has(n.id))
    if (!outs.length) {
      const code = finish(ctx)
      if (code) {
        lines.push(code)
        layers.push(node.id)
      }
      return
    }
    for (const next of outs) {
      if (next.type === 'mix') {
        const code = finish(ctx)
        if (code) {
          mixMembers.set(next.id, [...(mixMembers.get(next.id) ?? []), code])
          active.add(next.id)
        }
        continue
      }
      // Parameter chains wired into this node apply here, then the node itself.
      let c = applySide(ctx, next.id, node.id)
      c = apply(c, next)
      follow(next, c, new Set(seen).add(next.id))
    }
  }

  const empty = { sample: null, key: null, mode: null, mods: '' }
  for (const node of nodes)
    if (node.type === 'sequencer' && !node.data.muted)
      follow(node, applySide({ ...empty, seq: node.data, base: null }, node.id, null), new Set([node.id]))

  // Mixes: once a Mix's inputs are known, it continues as one chain. A Mix that feeds
  // another Mix is done first, so keep going until nothing new arrives.
  const mixes = nodes.filter((n) => n.type === 'mix')
  const done = new Set<string>()
  for (let pass = 0; pass < mixes.length; pass++)
    for (const [i, mix] of mixes.entries()) {
      if (done.has(mix.id)) continue
      const feedsFromMix = edges.some(
        (e) => e.target === mix.id && byId.get(e.source)?.type === 'mix' && !done.has(e.source)
      )
      if (feedsFromMix) continue
      done.add(mix.id)
      const members = mixMembers.get(mix.id) ?? []
      if (!members.length) continue
      const base = `stack(${members.join(', ')}).orbit(${i + 2})`
      follow(mix, { ...empty, seq: null, base }, new Set([mix.id]))
    }

  const code = lines.length ? `stack(\n  ${lines.join(',\n  ')}\n)` : 'silence'
  return { code, layers, active }
}
