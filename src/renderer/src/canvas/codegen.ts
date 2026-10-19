// Compile the canvas graph to Strudel code.
//
//   sample ──▶ sequencer ──▶ key / mode / length / velocity / effects ──▶ (plays)
//
// Each sequencer with a sound connected becomes one layer of a stack(). Steps have a
// fixed size (resolution, default 1/16) and length sets the loop, so different
// lengths drift against each other (polymeter).

import type { Edge } from '@xyflow/react'
import {
  DEFAULT_OCTAVE,
  EFFECTS,
  heldValues,
  loopSteps,
  velocityGain,
  isBank,
  LENGTH_STEPS,
  MODES,
  pieceCount,
  STEP_RESOLUTION,
  SYNTHS,
  TONICS
} from './model'
import type {
  CanvasNode,
  EffectData,
  KeyData,
  LengthData,
  ModeData,
  OctaveData,
  SampleData,
  SequencerData,
  Step,
  VelocityData
} from './model'

const quote = (s: string): string => JSON.stringify(s)

// Step lengths in 1/16 steps, from the Length in effect (cycling over the steps), or
// null for plain 1/16 steps. Length sets the length until something changes it.
export type Lens = number[] | null

const lensAt = (lens: Lens, i: number): number => (lens?.length ? lens[i % lens.length] : 1)

// Tokens as one loop, each step lasting its length: "a@4 b@4 ~@8" (mini-notation
// weights), stretched so a 1/16 is a 1/16: "[...]/bars".
// collapse: a value that's the same on every step can be written once (velocity, clip),
// but a hit pattern can't: every step must still be its own hit.
// Steps and lengths loop at their own counts, so the loop runs until they line up.
function stepped(stepTokens: string[], lens: Lens, collapse = true): string {
  if (
    collapse &&
    stepTokens.length &&
    stepTokens.every((tk) => tk === stepTokens[0]) &&
    stepTokens[0] !== '~'
  )
    return stepTokens[0]
  const n =
    lens?.length && stepTokens.length
      ? loopSteps(stepTokens.length, lens.length)
      : stepTokens.length
  const tokens = Array.from({ length: n }, (_, i) => stepTokens[i % stepTokens.length])
  const weights = tokens.map((_, i) => lensAt(lens, i))
  const total = weights.reduce((a, b) => a + b, 0)
  const body = tokens.map((tk, i) => (weights[i] === 1 ? tk : `${tk}@${weights[i]}`)).join(' ')
  const bars = +(total / STEP_RESOLUTION).toFixed(6)
  return bars === 1 ? body : `[${body}]/${bars}`
}

const steps = (values: Step[], toToken: (v: number) => string): string[] =>
  values.map((v) => (v === null ? '~' : toToken(v)))

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
const MAX_HARMONY_STEPS = 4096

// A Key or Mode sequencer as it appeared in the chain, with the step lengths then in effect.
export interface Stepped<T> {
  data: T
  lens: Lens
}

// One value per 1/16: each step's value repeated for its length.
const perSixteenth = (values: number[], lens: Lens): number[] =>
  Array.from(
    { length: lens?.length ? loopSteps(values.length, lens.length) : values.length },
    (_, i) => Array(lensAt(lens, i)).fill(values[i % values.length])
  ).flat()

// The scale per 1/16, from the Key and Mode sequencers (C / Ionian when not wired).
// They loop at their own lengths, so the combined loop is lcm of the two, written
// compactly with weights: "[D3:dorian@16 E3:dorian@16 ...]/2". Empty steps hold.
function harmonyPattern(
  key: Stepped<KeyData> | null,
  mode: Stepped<ModeData> | null,
  octave: Stepped<OctaveData> | null,
  fallbackOctave: number
): string {
  const keys = key?.data.steps.length ? perSixteenth(heldValues(key.data.steps, 0), key.lens) : [0]
  const modes = mode?.data.steps.length
    ? perSixteenth(heldValues(mode.data.steps, 0), mode.lens)
    : [0]
  const octs = octave?.data.steps.length
    ? perSixteenth(heldValues(octave.data.steps, 0), octave.lens).map((o) => fallbackOctave + o)
    : [fallbackOctave]
  const lcm = (a: number, b: number): number => (a * b) / gcd(a, b)
  const length = Math.min(MAX_HARMONY_STEPS, lcm(lcm(keys.length, modes.length), octs.length))
  const at = (i: number): string =>
    `${TONICS[keys[i % keys.length]] ?? 'C'}${octs[i % octs.length]}:${MODES[modes[i % modes.length]]?.id ?? 'major'}`
  // Run-length encode: consecutive equal sixteenths become one weighted token.
  const runs: [string, number][] = []
  for (let i = 0; i < length; i++) {
    const tk = at(i)
    if (runs.length && runs[runs.length - 1][0] === tk) runs[runs.length - 1][1]++
    else runs.push([tk, 1])
  }
  if (runs.length === 1) return runs[0][0]
  const body = runs.map(([tk, n]) => (n === 1 ? tk : `${tk}@${n}`)).join(' ')
  const bars = +(length / STEP_RESOLUTION).toFixed(6)
  return bars === 1 ? body : `[${body}]/${bars}`
}

// Samples (Slices, or a sound triggered by Key/Mode/...) repitch by playback speed, like a
// sampler: Key = semitones above C, Octave = 12 semitones per octave away from 3. Speed
// changes tempo too, so a loop moved up a tone also plays ~12% faster. Follows the Key
// and Octave steps at their held lengths: "[1@16 1.1225@16]/2".
function transposePattern(
  key: Stepped<KeyData> | null,
  octave: Stepped<OctaveData> | null,
  // Oscillators have no playback speed: give them the note (MIDI) instead.
  asNote = false
): string | null {
  if (!key && !octave) return null
  const keys = key?.data.steps.length ? perSixteenth(heldValues(key.data.steps, 0), key.lens) : [0]
  const octs = octave?.data.steps.length
    ? perSixteenth(heldValues(octave.data.steps, 0), octave.lens).map((o) => DEFAULT_OCTAVE + o)
    : [DEFAULT_OCTAVE]
  const length = Math.min(
    MAX_HARMONY_STEPS,
    (keys.length * octs.length) / gcd(keys.length, octs.length)
  )
  const runs: [string, number][] = []
  for (let i = 0; i < length; i++) {
    const semis = keys[i % keys.length] + 12 * (octs[i % octs.length] - DEFAULT_OCTAVE)
    const tk = asNote ? String(48 + semis) : String(+Math.pow(2, semis / 12).toFixed(4))
    if (runs.length && runs[runs.length - 1][0] === tk) runs[runs.length - 1][1]++
    else runs.push([tk, 1])
  }
  if (runs.length === 1) return !asNote && runs[0][0] === '1' ? null : runs[0][0]
  const body = runs.map(([tk, n]) => (n === 1 ? tk : `${tk}@${n}`)).join(' ')
  const bars = +(length / STEP_RESOLUTION).toFixed(6)
  return bars === 1 ? body : `[${body}]/${bars}`
}

// Notes code has a placeholder where the scale goes: Key and Mode are chain nodes,
// so the scale is only known once the chain has been followed (see compile).
const SCALE = '__SCALE__'

// Built-in oscillators (no sample files): they take a note, not a slice or speed.
const isOscillator = (sample: SampleData): boolean =>
  SYNTHS.includes(sample.s) && sample.s !== 'piano'

export function sequencerCode(
  seq: SequencerData,
  sample: SampleData,
  lens: Lens = null
): string | null {
  if (seq.steps.every((v) => v === null)) return null
  const sound = quote(sample.s)
  let code: string
  switch (seq.kind) {
    case 'degree': {
      // UI degrees are 1-based; Strudel's are 0-based.
      const degrees = stepped(
        steps(seq.steps, (v) => String(v - 1)),
        lens,
        false
      )
      code = `n("${degrees}")${SCALE}.s(${sound})`
      // scale() turns n into a note, so n is free again to pick the sample variant.
      if (sample.n) code += `.n(${sample.n})`
      break
    }
    case 'slice': {
      // Steps set before the piece count was lowered wrap around.
      const count = pieceCount(sample)
      const picks = stepped(
        steps(seq.steps, (v) => String(v % count)),
        lens,
        false
      )
      // A multi-file sound picks files; a single file is cut into equal slices.
      code = isOscillator(sample)
        ? `n("${picks}").s(${sound})`
        : isBank(sample)
          ? `n("${picks}").s(${sound})`
          : `s(${sound}).n(${sample.n}).slice(${count}, "${picks}")`
      break
    }
  }
  return code
}

// Strudel's velocity is 0..1 and multiplies with gain, so accents scale the channel level.
export function velocityCode(data: VelocityData, lens: Lens = null): string {
  return `.velocity("${stepped(
    data.steps.map((v) => String(+velocityGain(v).toFixed(4))),
    lens
  )}")`
}

// Strudel's clip multiplies each note's duration and cuts samples at the end.
// Each step's length in 1/16 steps.
export const lengthValues = (data: LengthData): number[] =>
  data.steps.map((v) => LENGTH_STEPS[v - 1] ?? 1)

// Note duration relative to the step it sits on (clip = length / step length): a 1/4
// note on a 1/16 step is clip 4; on a 1/4 step it's clip 1. Clip also cuts samples off.
export function lengthCode(data: LengthData, noteLens: Lens, lens: Lens = null): string {
  const values = lengthValues(data)
  const factors = values.map((v, i) => String(+(v / lensAt(noteLens, i)).toFixed(4)))
  return `.clip("${stepped(factors, lens)}")`
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
  // Every node on a playing chain.
  active: Set<string>
  // Step lengths (1/16 units) each stepping node plays at, for its playhead; absent = 1/16.
  stepLens: Map<string, Lens>
  // Nodes on a chain that is heard (not muted, not left out by a Solo).
  sounding: Set<string>
  // The orbit each Bus plays on (for its live Volume/Pan and modulation).
  busOrbits: Map<string, number>
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
  const CHAIN = new Set(['sample', 'velocity', 'length', 'effect', 'key', 'mode', 'octave', 'mix'])
  const patternOuts = (id: string): CanvasNode[] =>
    edges
      .filter((e) => e.source === id && e.sourceHandle === 'pattern')
      .map((e) => byId.get(e.target))
      .filter((n): n is CanvasNode => !!n && CHAIN.has(n.type))

  // Every node downstream of id (following pattern wires).
  const reachableFrom = (id: string, seen = new Set<string>()): Set<string> => {
    for (const e of edges)
      if (e.source === id && e.sourceHandle === 'pattern' && !seen.has(e.target)) {
        seen.add(e.target)
        reachableFrom(e.target, seen)
      }
    return seen
  }

  // What a chain has gathered so far. A sequencer start builds its pattern only at
  // the end, once it knows its sound and scale; a Mix start is already a pattern.
  interface Ctx {
    seq: SequencerData | null
    base: string | null
    sample: SampleData | null
    key: Stepped<KeyData> | null
    mode: Stepped<ModeData> | null
    octave: Stepped<OctaveData> | null
    // The Length in effect: sequencers after it step at these lengths.
    length: Lens
    // Step lengths of the playing sequencer (notes are clipped relative to them).
    seqLens: Lens
    mods: string // appended controls: .velocity() .clip() .delay() ...
  }

  let cutGroup = 0

  // Step lengths each stepping node ends up using, for its playhead.
  const stepLens = new Map<string, Lens>()

  const finish = (ctx: Ctx): string | null => {
    if (ctx.base) return ctx.base + ctx.mods
    if (!ctx.seq) return null
    const sample = ctx.sample ?? (ctx.seq.kind === 'degree' ? DEFAULT_NOTE_SOUND : null)
    if (!sample) return null
    const code = sequencerCode(ctx.seq, sample, ctx.seqLens)
    if (!code) return null
    // Sample hits (Slices, or a sound triggered by a stepping node) cut the chain's
    // previous hit, so a loop longer than its step restarts instead of stacking. Notes
    // stay polyphonic. One cut group per playing chain.
    const cut = ctx.seq.kind === 'slice' ? `.cut(${++cutGroup})` : ''
    // Samples repitch by speed; oscillators (sine, saw...) play the note itself.
    const osc = isOscillator(sample)
    const shift = ctx.seq.kind === 'slice' ? transposePattern(ctx.key, ctx.octave, osc) : null
    const pitch = shift ? (osc ? `.note("${shift}")` : `.speed("${shift}")`) : ''
    const scale = `.scale("${harmonyPattern(ctx.key, ctx.mode, ctx.octave, ctx.seq.octave ?? DEFAULT_OCTAVE)}")`
    return code.replace(SCALE, scale) + cut + pitch + ctx.mods
  }

  // Parameter nodes set values that hold until something later overrides them.
  const apply = (ctx: Ctx, n: CanvasNode): Ctx => {
    const c = { ...ctx }
    if (n.type === 'sample') {
      // The first sound sets how the sequencer plays (files, slices); later ones re-voice it.
      if (!c.sample && !c.base) c.sample = n.data
      else c.mods += `.s(${quote(n.data.s)}).n(${n.data.n})`
    } else if (n.type === 'key') {
      c.key = { data: n.data, lens: c.length }
      stepLens.set(n.id, c.length)
    } else if (n.type === 'mode') {
      c.mode = { data: n.data, lens: c.length }
      stepLens.set(n.id, c.length)
    } else if (n.type === 'octave') {
      c.octave = { data: n.data, lens: c.length }
      stepLens.set(n.id, c.length)
    } else if (n.type === 'velocity') {
      c.mods += velocityCode(n.data, c.length)
      stepLens.set(n.id, c.length)
    } else if (n.type === 'length') {
      // Notes playing through here sound for this length; what steps after steps at it.
      if (c.seq || c.base) c.mods += lengthCode(n.data, c.seqLens, lengthValues(n.data))
      // Its own steps last their own lengths.
      c.length = lengthValues(n.data)
      stepLens.set(n.id, c.length)
    } else if (n.type === 'effect') c.mods += effectCode(n.data)
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
  // Every way through a parameter chain ending at id. Several wires into one input are
  // parallel branches: each branch with a sound is its own voice and plays through the
  // rest of the chain; branches without a sound are settings that apply to every voice.
  const paramPaths = (id: string, seen: Set<string>): CanvasNode[][] | null => {
    const n = byId.get(id)
    if (!n || n.type === 'sequencer' || n.type === 'mix' || seen.has(id)) return null
    const side: CanvasNode[] = []
    const voices: CanvasNode[][] = []
    for (const e of edges.filter((e) => e.target === id && e.sourceHandle === 'pattern')) {
      const up = paramPaths(e.source, new Set(seen).add(id))
      if (up === null) return null
      for (const p of up) {
        if (p.some((x) => x.type === 'sample')) voices.push(p)
        else side.push(...p)
      }
    }
    return voices.length ? voices.map((v) => [...side, ...v, n]) : [[...side, n]]
  }

  // Apply the parameter chains wired into id (skipping the edge the flow arrived on).
  // A chain that branches off this same flow upstream is a parallel branch, not a
  // setting: it's followed on its own (see follow).
  const applySide = (
    ctx: Ctx,
    id: string,
    from: string | null,
    flow: Set<string> = new Set()
  ): Ctx => {
    let c = ctx
    for (const e of edges.filter(
      (e) => e.target === id && e.sourceHandle === 'pattern' && e.source !== from
    )) {
      if (flowReaches(e.source, flow)) continue
      const chain = paramChain(e.source, new Set([id]))
      if (chain) for (const p of chain) c = apply(c, p)
    }
    return c
  }
  // Whether id is, or is fed by, a node the flow already went through.
  const flowReaches = (id: string, flow: Set<string>, seen = new Set<string>()): boolean => {
    if (flow.has(id)) return true
    if (seen.has(id)) return false
    seen.add(id)
    return edges.some(
      (e) => e.target === id && e.sourceHandle === 'pattern' && flowReaches(e.source, flow, seen)
    )
  }

  // Every playing chain, with the nodes it runs through (for Mute / Solo).
  interface Line {
    code: string
    layer: string
    path: Set<string>
  }
  const out: Line[] = []
  const active = new Set<string>()
  const mixMembers = new Map<string, { code: string; path: Set<string> }[]>()

  // Mute / Solo work on any node: a chain is silent if any node on it is muted, and
  // while anything is soloed only chains running through a soloed node play.
  const flag = (id: string, key: 'muted' | 'solo'): boolean =>
    !!(byId.get(id)?.data as { muted?: boolean; solo?: boolean } | undefined)?.[key]
  const anySolo = nodes.some((n) => flag(n.id, 'solo'))
  const plays = (path: Set<string>, soloAfter = false): boolean => {
    const ids = [...path]
    if (ids.some((id) => flag(id, 'muted'))) return false
    return !anySolo || soloAfter || ids.some((id) => flag(id, 'solo'))
  }

  const follow = (node: CanvasNode, ctx: Ctx, seen: Set<string>): void => {
    active.add(node.id)
    const outs = patternOuts(node.id).filter((n) => !seen.has(n.id))
    if (!outs.length) {
      const code = finish(ctx)
      if (code) {
        out.push({ code, layer: node.id, path: seen })
      }
      return
    }
    for (const next of outs) {
      if (next.type === 'mix') {
        const code = finish(ctx)
        if (code) {
          mixMembers.set(next.id, [...(mixMembers.get(next.id) ?? []), { code, path: seen }])
          active.add(next.id)
        }
        continue
      }
      // Parameter chains wired into this node apply here, then the node itself.
      let c = applySide(ctx, next.id, node.id, seen)
      c = apply(c, next)
      follow(next, c, new Set(seen).add(next.id))
    }
  }

  const empty = {
    sample: null,
    key: null,
    mode: null,
    octave: null,
    length: null,
    seqLens: null,
    mods: ''
  }
  for (const node of nodes)
    if (node.type === 'sequencer' && !node.data.muted) {
      // What's wired into a sequencer applies before it starts: a Length there sets its
      // step lengths (notes then fill their steps), not a note duration. Each branch
      // with a sound wired in is its own voice (see paramPaths).
      const ins = edges.filter((e) => e.target === node.id && e.sourceHandle === 'pattern')
      const paths = ins.map((e) => paramPaths(e.source, new Set([node.id])) ?? []).flat()
      const side = paths.filter((p) => !p.some((x) => x.type === 'sample')).flat()
      const voices = paths.filter((p) => p.some((x) => x.type === 'sample'))
      for (const voice of voices.length ? voices : [[]]) {
        let start: Ctx = { ...empty, seq: null, base: null }
        for (const p of [...side, ...voice]) start = apply(start, p)
        stepLens.set(node.id, start.length)
        follow(node, { ...start, seq: node.data, seqLens: start.length }, new Set([node.id]))
      }
    }

  // Chains with a sound but no Notes/Slices sequencer: almost every node steps, so the
  // stepping node nearest after the sound (else nearest before) says when it plays.
  // Each set step is a hit (Key/Mode/Octave: the steps you set; Velocity: every step).
  // Length never triggers; it sets how long things are. The whole chain's parameters still apply.
  // Length only sets durations, it never triggers.
  const STEPPING = new Set(['key', 'mode', 'octave', 'velocity'])
  for (const end of nodes) {
    // Wired into anything (a sequencer's input too), it isn't an end: it sets that up.
    if (
      active.has(end.id) ||
      edges.some((e) => e.source === end.id && e.sourceHandle === 'pattern')
    )
      continue
    for (const chain of paramPaths(end.id, new Set()) ?? []) clocked(end, chain)
  }
  function clocked(end: CanvasNode, chain: CanvasNode[]): void {
    const si = chain.findIndex((n) => n.type === 'sample')
    if (si < 0) return
    const clock =
      chain.slice(si + 1).find((n) => STEPPING.has(n.type)) ??
      [...chain.slice(0, si)].reverse().find((n) => STEPPING.has(n.type))
    if (!clock || !('steps' in clock.data)) return
    // Walk the chain: parameters before the clock set what it steps at.
    let ctx: Ctx = { ...empty, seq: null, base: null }
    let clockLens: Lens = null
    for (const n of chain) {
      if (n.id === clock.id) clockLens = ctx.length
      ctx = apply(ctx, n)
      active.add(n.id)
    }
    const hits = (clock.data.steps as Step[]).map((v) => (v === null ? null : 0))
    const seq: SequencerData = {
      kind: 'slice',
      steps: hits,
      resolution: STEP_RESOLUTION,
      octave: DEFAULT_OCTAVE,
      muted: false
    }
    // A held Length sets how long each hit sounds: a full step at that length.
    const held = clockLens ? { ...ctx, mods: '.clip(1)' + ctx.mods } : ctx
    const code = finish({ ...held, seq, seqLens: clockLens })
    if (code) {
      out.push({ code, layer: end.id, path: new Set(chain.map((n) => n.id)) })
    }
  }

  // Mixes: once a Mix's inputs are known, it continues as one chain. A Mix that feeds
  // another Mix is done first, so keep going until nothing new arrives.
  const mixes = nodes.filter((n) => n.type === 'mix')
  // Each Bus is its own orbit (2, 3, ...; chains without one share orbit 1).
  const busOrbits = new Map(mixes.map((m, i) => [m.id, i + 2]))
  const done = new Set<string>()
  for (let pass = 0; pass < mixes.length; pass++)
    for (const mix of mixes) {
      if (done.has(mix.id)) continue
      const feedsFromMix = edges.some(
        (e) => e.target === mix.id && byId.get(e.source)?.type === 'mix' && !done.has(e.source)
      )
      if (feedsFromMix) continue
      done.add(mix.id)
      // A Solo after the Mix plays all of its inputs.
      const soloAfter = [...reachableFrom(mix.id)].some((id) => flag(id, 'solo'))
      const members = (mixMembers.get(mix.id) ?? []).filter((m) => plays(m.path, soloAfter))
      if (!members.length) continue
      const base = `stack(${members.map((m) => m.code).join(', ')}).orbit(${busOrbits.get(mix.id)})`
      follow(
        mix,
        { ...empty, seq: null, base },
        new Set([mix.id, ...members.flatMap((m) => [...m.path])])
      )
    }

  const heard = out.filter((l) => plays(l.path))
  const lines = heard.map((l) => l.code)
  const layers = heard.map((l) => l.layer)
  // Nodes on a chain that reaches the output (their grids flash as they play).
  // A chain through a Bus at volume 0 makes no sound, so it doesn't count.
  const silent = (id: string): boolean => (byId.get(id)?.data as { volume?: number } | undefined)?.volume === 0
  const sounding = new Set(heard.filter((l) => ![...l.path].some(silent)).flatMap((l) => [...l.path]))
  const code = lines.length ? `stack(\n  ${lines.join(',\n  ')}\n)` : 'silence'
  return { code, layers, active, stepLens, sounding, busOrbits }
}
