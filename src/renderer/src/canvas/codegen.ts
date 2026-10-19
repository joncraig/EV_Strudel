// Compile the canvas graph to Strudel code.
//
//   sample ──▶ sequencer ──▶ key / mode / length / velocity / effects ──▶ (plays)
//
// Each sequencer with a sound connected becomes one layer of a stack(). Steps have a
// fixed size (resolution, default 1/16) and length sets the loop, so different
// lengths drift against each other (polymeter).

import type { Edge } from '@xyflow/react'
import { chordTones, voice } from './chords'
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
  TONICS,
  cellNotes
} from './model'
import type {
  Cell,
  CanvasNode,
  EffectData,
  KeyData,
  LengthData,
  ModeData,
  OctaveData,
  PerformData,
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
// make: build each step's token from its index and length (Strum / Arp need the length).
function stepped(
  stepTokens: string[],
  lens: Lens,
  collapse = true,
  make?: (i: number, w: number) => string
): string {
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
  const tokens = Array.from({ length: n }, (_, i) =>
    make ? make(i % stepTokens.length, lensAt(lens, i)) : stepTokens[i % stepTokens.length]
  )
  const weights = tokens.map((_, i) => lensAt(lens, i))
  const total = weights.reduce((a, b) => a + b, 0)
  const body = tokens.map((tk, i) => (weights[i] === 1 ? tk : `${tk}@${weights[i]}`)).join(' ')
  const bars = +(total / STEP_RESOLUTION).toFixed(6)
  return bars === 1 ? body : `[${body}]/${bars}`
}

// Mono steps (Slices): a chord's first note.
const firstNotes = (cells: Cell[]): Step[] => cells.map((c) => cellNotes(c)[0] ?? null)

// A step's notes as one token: a chord "[a,b,c]", or with a Strum / Arp node in the
// chain, the notes spread out across the step (w = the step's length in 1/16s).
function performToken(notes: string[], w: number, seed: number, p: PerformData | null): string {
  if (notes.length === 0) return '~'
  if (notes.length === 1) return notes[0]
  if (!p) return `[${notes.join(',')}]`
  const k = notes.length
  if (p.mode === 'arp') {
    const slots = Math.max(1, Math.round(w / Math.max(1, p.rate)))
    const period = Math.max(1, 2 * k - 2)
    const pick = (j: number): number => {
      if (p.pattern === 'down') return k - 1 - (j % k)
      if (p.pattern === 'updown') return j % period < k ? j % period : period - (j % period)
      if (p.pattern === 'random')
        return Math.abs((Math.sin((seed + 1) * 97.3 + j * 13.7) * 1e4) | 0) % k
      return j % k
    }
    return `[${Array.from({ length: slots }, (_, j) => notes[pick(j)]).join(' ')}]`
  }
  const order = p.direction === 'down' ? [...notes].reverse() : notes
  const strummed = order.map((nt, i) => {
    const o = Math.round((100 * p.amount * i) / (k - 1))
    return o > 0 ? `[~@${o} ${nt}@${100 - o}]` : nt
  })
  return `[${strummed.join(',')}]`
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
// Chords code has a placeholder for its notes, filled in once Key/Mode/Octave are known.
const CHORDS = '__CHORDS__'
// ... and one for the rhythm it plays on when another sequencer feeds it.
const RHYTHM = '__RHYTHM__'

// What Key, Mode and Octave are in effect at each 1/16 (they loop at their own lengths).
function harmonyAt(
  key: Stepped<KeyData> | null,
  mode: Stepped<ModeData> | null,
  octave: Stepped<OctaveData> | null,
  fallbackOctave: number
): { length: number; at: (i: number) => { tonic: number; modeId: string; octave: number } } {
  const keys = key?.data.steps.length ? perSixteenth(heldValues(key.data.steps, 0), key.lens) : [0]
  const modes = mode?.data.steps.length
    ? perSixteenth(heldValues(mode.data.steps, 0), mode.lens)
    : [0]
  const octs = octave?.data.steps.length
    ? perSixteenth(heldValues(octave.data.steps, 0), octave.lens).map((o) => fallbackOctave + o)
    : [fallbackOctave]
  const lcm = (a: number, b: number): number => (a * b) / gcd(a, b)
  return {
    length: Math.min(MAX_HARMONY_STEPS, lcm(lcm(keys.length, modes.length), octs.length)),
    at: (i) => ({
      tonic: keys[i % keys.length],
      modeId: MODES[modes[i % modes.length]]?.id ?? 'major',
      octave: octs[i % octs.length]
    })
  }
}

// A Chords sequencer as MIDI notes: each step's chord is worked out with the Key, Mode
// and Octave heard when it starts, so the loop runs until the steps and the harmony
// line up again. "[[50,53,57]@16 ~@16 ...]/bars".
function chordPattern(
  seq: SequencerData,
  lens: Lens,
  key: Stepped<KeyData> | null,
  mode: Stepped<ModeData> | null,
  octave: Stepped<OctaveData> | null,
  perform: PerformData | null
): string {
  const n = lens?.length ? loopSteps(seq.steps.length, lens.length) : seq.steps.length
  const weights = Array.from({ length: n }, (_, i) => lensAt(lens, i))
  const loop = weights.reduce((a, b) => a + b, 0)
  const h = harmonyAt(key, mode, octave, DEFAULT_OCTAVE)
  const total = Math.min(MAX_HARMONY_STEPS, (loop * h.length) / gcd(loop, h.length))
  const tokens: string[] = []
  for (let t = 0, i = 0; t < total; t += weights[i % n], i++) {
    const s = i % seq.steps.length
    const degree = cellNotes(seq.steps[s])[0]
    const w = weights[i % n]
    if (degree === undefined) {
      tokens.push(w === 1 ? '~' : `~@${w}`)
      continue
    }
    const at = h.at(t)
    const tones = voice(
      chordTones(degree, at.modeId, seq.quality?.[s] ?? null, seq.ext?.[s] ?? null),
      seq
    )
    const base = 12 * (at.octave + 1) + at.tonic
    const chord = performToken(
      tones.map((x) => String(base + x)),
      w,
      s,
      perform
    )
    tokens.push(w === 1 ? chord : `${chord}@${w}`)
  }
  const bars = +(total / STEP_RESOLUTION).toFixed(6)
  const body = tokens.join(' ')
  return bars === 1 ? body : `[${body}]/${bars}`
}

// Built-in oscillators (no sample files): they take a note, not a slice or speed.
const isOscillator = (sample: SampleData): boolean =>
  SYNTHS.includes(sample.s) && sample.s !== 'piano'

export function sequencerCode(
  seq: SequencerData,
  sample: SampleData,
  lens: Lens = null,
  perform: PerformData | null = null
): string | null {
  if (seq.steps.every((v) => v === null)) return null
  const sound = quote(sample.s)
  let code: string
  switch (seq.kind) {
    case 'degree': {
      // UI degrees are 1-based; Strudel's are 0-based. A chord is "[0,2,4]".
      const tokens = seq.steps.map((c) => cellNotes(c).map((v) => String(v - 1)))
      const degrees = stepped(
        tokens.map((d) => performToken(d, 1, 0, null)),
        lens,
        false,
        (i, w) => performToken(tokens[i], w, i, perform)
      )
      code = `n("${degrees}")${SCALE}.s(${sound})`
      // scale() turns n into a note, so n is free again to pick the sample variant.
      if (sample.n) code += `.n(${sample.n})`
      break
    }
    case 'chord': {
      code = `note("${CHORDS}")${RHYTHM}.s(${sound})`
      if (sample.n) code += `.n(${sample.n})`
      break
    }
    case 'slice': {
      // Steps set before the piece count was lowered wrap around.
      const count = pieceCount(sample)
      const picks = stepped(
        steps(firstNotes(seq.steps), (v) => String(v % count)),
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

// Without a Sample in the chain, Notes and Chords play this synth; other sequencers stay silent.
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
  const CHAIN = new Set([
    'sample',
    'velocity',
    'length',
    'effect',
    'key',
    'mode',
    'octave',
    'mix',
    'duck',
    'perform',
    // A sequencer is a chain node too: wired after a chain, it takes over the
    // triggering and everything set before it (sound, Length, Key ...) carries on.
    'sequencer'
  ])
  // Each Bus is its own orbit (2, 3, ...; chains without one share orbit 1).
  const busOrbits = new Map(nodes.filter((n) => n.type === 'mix').map((m, i) => [m.id, i + 2]))
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
    // Which file/slice an earlier Slices sequencer picked, when a later sequencer
    // took over the triggering (it holds, like every other setting).
    picks: { steps: Step[]; lens: Lens } | null
    // A Strum / Arp node in the chain (held like any setting).
    perform: PerformData | null
    // When a Chords sequencer follows another sequencer, that one's rhythm says when
    // chords play (Chords then only says which chord).
    rhythm: { steps: Cell[]; lens: Lens } | null
    mods: string // appended controls: .velocity() .clip() .delay() ...
  }

  let cutGroup = 0

  // Step lengths each stepping node ends up using, for its playhead.
  const stepLens = new Map<string, Lens>()

  const finish = (ctx: Ctx): string | null => {
    if (ctx.base) return ctx.base + ctx.mods
    if (!ctx.seq) return null
    const sample = ctx.sample ?? (ctx.seq.kind !== 'slice' ? DEFAULT_NOTE_SOUND : null)
    if (!sample) return null
    const code = sequencerCode(ctx.seq, sample, ctx.seqLens, ctx.perform)
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
    // Notes after a Slices sequencer play the files it picked (a multi-file sound).
    const picks =
      ctx.picks && ctx.seq.kind === 'degree' && isBank(sample)
        ? `.n("${stepped(
            heldValues(ctx.picks.steps, 0).map((v) => String(v % pieceCount(sample))),
            ctx.picks.lens
          )}")`
        : ''
    const rhythm = ctx.rhythm
      ? `.struct("${stepped(
          ctx.rhythm.steps.map((c) => (cellNotes(c).length ? 't' : '~')),
          ctx.rhythm.lens,
          false
        )}")`
      : ''
    const chords =
      ctx.seq.kind === 'chord'
        ? chordPattern(ctx.seq, ctx.seqLens, ctx.key, ctx.mode, ctx.octave, ctx.perform)
        : ''
    // Sampled notes (piano...) would ring to the end of the file and pile up when
    // played often; they hold for their step and fade out, like letting go of a key.
    // A Length later in the chain sets its own clip (it comes after, so it wins).
    const held =
      ctx.seq.kind !== 'slice' && !osc && sample !== DEFAULT_NOTE_SOUND
        ? '.clip(1).release(0.5)'
        : ''
    return (
      code.replace(SCALE, scale).replace(CHORDS, chords).replace(RHYTHM, rhythm) +
      picks +
      cut +
      pitch +
      held +
      ctx.mods
    )
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
    else if (n.type === 'perform') c.perform = n.data
    else if (n.type === 'duck') {
      // Every note here ducks the Buses its duck output is wired to.
      const targets = edges
        .filter((e) => e.source === n.id && e.sourceHandle === 'duck')
        .map((e) => busOrbits.get(e.target))
        .filter((o): o is number => o !== undefined)
      if (targets.length) {
        const orbit = targets.length === 1 ? String(targets[0]) : `"${targets.join(':')}"`
        c.mods += `.duckorbit(${orbit}).duckdepth(${n.data.depth}).duckonset(${n.data.attack}).duckattack(${n.data.release})`
      }
    }
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
  // parallel branches: each is its own voice and plays through the rest of the chain
  // (an Octave -1 wired beside the chain adds the same notes an octave down).
  const paramPaths = (id: string, seen: Set<string>): CanvasNode[][] | null => {
    const n = byId.get(id)
    if (!n || n.type === 'sequencer' || n.type === 'mix' || seen.has(id)) return null
    const paths: CanvasNode[][] = []
    for (const e of edges.filter((e) => e.target === id && e.sourceHandle === 'pattern')) {
      const up = paramPaths(e.source, new Set(seen).add(id))
      if (up === null) return null
      paths.push(...up)
    }
    return paths.length ? paths.map((p) => [...p, n]) : [[n]]
  }

  // The parameter chains wired into id beside the flow (not the wire it arrived on,
  // nor branches of the same flow, which are followed on their own).
  const sideChains = (id: string, from: string, flow: Set<string>): CanvasNode[][] =>
    edges
      .filter((e) => e.target === id && e.sourceHandle === 'pattern' && e.source !== from)
      .filter((e) => !flowReaches(e.source, flow))
      .map((e) => paramChain(e.source, new Set([id])))
      .filter((c): c is CanvasNode[] => !!c)

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
      if (next.type === 'sequencer') {
        // A later sequencer takes over when and what plays; an earlier Slices'
        // file choice holds. The Length in effect sets its step length. A Chords
        // sequencer only takes over what plays: the incoming notes still say when.
        if (next.data.muted) continue
        stepLens.set(next.id, ctx.length)
        const picks =
          ctx.seq?.kind === 'slice'
            ? { steps: firstNotes(ctx.seq.steps), lens: ctx.seqLens }
            : ctx.picks
        follow(
          next,
          {
            ...ctx,
            seq: next.data,
            seqLens: ctx.length,
            picks,
            rhythm:
              next.data.kind === 'chord' && ctx.seq
                ? { steps: ctx.seq.steps, lens: ctx.seqLens }
                : null
          },
          new Set(seen).add(next.id)
        )
        continue
      }
      if (next.type === 'mix') {
        const code = finish(ctx)
        if (code) {
          mixMembers.set(next.id, [...(mixMembers.get(next.id) ?? []), { code, path: seen }])
          active.add(next.id)
        }
        continue
      }
      // Other chains wired into the same input are parallel branches: the flow carries
      // on as it is, and once more through each of them (each its own voice).
      const voices: { ctx: Ctx; path: Set<string> }[] = [{ ctx, path: seen }]
      for (const chain of sideChains(next.id, node.id, seen)) {
        let c = ctx
        for (const p of chain) c = apply(c, p)
        voices.push({ ctx: c, path: new Set([...seen, ...chain.map((p) => p.id)]) })
        chain.forEach((p) => active.add(p.id))
      }
      for (const v of voices) follow(next, apply(v.ctx, next), new Set(v.path).add(next.id))
    }
  }

  const empty = {
    sample: null,
    key: null,
    mode: null,
    octave: null,
    length: null,
    seqLens: null,
    picks: null,
    perform: null,
    rhythm: null,
    mods: ''
  }
  // Whether a sequencer is fed by another sequencer's chain (then that chain carries
  // on through it, see follow, and it doesn't start one of its own).
  const fedBySequencer = (id: string, seen = new Set<string>()): boolean =>
    edges.some((e) => {
      if (e.target !== id || e.sourceHandle !== 'pattern' || seen.has(e.source)) return false
      seen.add(e.source)
      return byId.get(e.source)?.type === 'sequencer' || fedBySequencer(e.source, seen)
    })
  for (const node of nodes)
    if (node.type === 'sequencer' && !node.data.muted && !fedBySequencer(node.id)) {
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
    // Wired into anything but a Bus (a sequencer's input too), it isn't an end: it sets
    // that up. Wired only into Buses, it plays through them.
    const outs = edges.filter((e) => e.source === end.id && e.sourceHandle === 'pattern')
    const buses = outs
      .map((e) => byId.get(e.target))
      .filter((n): n is CanvasNode => n?.type === 'mix')
    if (active.has(end.id) || end.type === 'mix' || buses.length !== outs.length) continue
    for (const chain of paramPaths(end.id, new Set()) ?? []) clocked(end, chain, buses)
  }
  function clocked(end: CanvasNode, chain: CanvasNode[], buses: CanvasNode[]): void {
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
    if (!code) return
    const path = new Set(chain.map((n) => n.id))
    if (!buses.length) out.push({ code, layer: end.id, path })
    for (const bus of buses) {
      mixMembers.set(bus.id, [...(mixMembers.get(bus.id) ?? []), { code, path }])
      active.add(bus.id)
    }
  }

  // Mixes: once a Mix's inputs are known, it continues as one chain. A Mix that feeds
  // another Mix is done first, so keep going until nothing new arrives.
  const mixes = nodes.filter((n) => n.type === 'mix')
  const done = new Set<string>()
  for (let pass = 0; pass < mixes.length; pass++)
    for (const mix of mixes) {
      if (done.has(mix.id)) continue
      const feedsFromMix = edges.some(
        (e) => e.target === mix.id && byId.get(e.source)?.type === 'mix' && !done.has(e.source)
      )
      if (feedsFromMix) continue
      done.add(mix.id)
      // A Solo on the Bus itself, or after it, plays all of its inputs.
      const soloAfter = [mix.id, ...reachableFrom(mix.id)].some((id) => flag(id, 'solo'))
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
  const silent = (id: string): boolean =>
    (byId.get(id)?.data as { volume?: number } | undefined)?.volume === 0
  const sounding = new Set(
    heard.filter((l) => ![...l.path].some(silent)).flatMap((l) => [...l.path])
  )
  const code = lines.length ? `stack(\n  ${lines.join(',\n  ')}\n)` : 'silence'
  return { code, layers, active, stepLens, sounding, busOrbits }
}
