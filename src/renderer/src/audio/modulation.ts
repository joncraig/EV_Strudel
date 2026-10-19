// Live Bus Volume/Pan and LFO modulators, on the audio graph itself rather than in
// the Strudel code. Code changes are heard only after the scheduler's look-ahead and
// only on new notes; these act on the audio straight away, even on held notes.
//
// Each Bus is a Strudel orbit (codegen's busOrbits). Superdough gives every orbit a
// summing node -> output gain; a StereoPannerNode is put between them for Pan, and
// the output gain is the Volume. An LFO is an oscillator -> depth gain -> one scale
// gain per wire -> the target AudioParam, so it adds onto the target's own value at
// audio rate. LFOs can target other LFOs' Rate (oscillator frequency) and Depth.

import { getAudioContext, getSuperdoughAudioController } from '@strudel/webaudio'
import type { CanvasNode, LfoData, LfoShape, MixData } from '../canvas/model'
import { MOD_PREFIX } from '../canvas/model'
import type { Edge } from '@xyflow/react'

interface Orbit {
  summingNode: AudioNode
  output: GainNode
}

interface Clock {
  playing: boolean
  cps: number
  // Cycle position the listener hears now (scheduler time minus its look-ahead).
  heardCycle: () => number
}

const panners = new WeakMap<Orbit, StereoPannerNode>()

// The orbit for a Bus, with its pan stage in place.
function busStage(orbit: number): { volume: AudioParam; pan: AudioParam } {
  const o = getSuperdoughAudioController().getOrbit(orbit, [0, 1]) as Orbit
  let p = panners.get(o)
  if (!p) {
    p = new StereoPannerNode(o.output.context)
    o.summingNode.disconnect()
    o.summingNode.connect(p)
    p.connect(o.output)
    panners.set(o, p)
  }
  return { volume: o.output.gain, pan: p.pan }
}

// Move a param smoothly (a jump would click).
const glide = (param: AudioParam, value: number): void => {
  param.setTargetAtTime(value, getAudioContext().currentTime, 0.015)
}

// ---- LFO waves ----

// Fourier sine-series coefficients of each periodic shape (unit amplitude).
const HARMONICS = 48
function series(shape: Exclude<LfoShape, 'random'>): number[] {
  const b = new Array(HARMONICS + 1).fill(0)
  for (let k = 1; k <= HARMONICS; k++) {
    if (shape === 'sine') b[k] = k === 1 ? 1 : 0
    else if (shape === 'sawtooth') b[k] = ((k % 2 ? 1 : -1) * 2) / (Math.PI * k)
    else if (shape === 'square') b[k] = k % 2 ? 4 / (Math.PI * k) : 0
    else b[k] = k % 2 ? ((((k - 1) / 2) % 2 ? -1 : 1) * 8) / (Math.PI * Math.PI * k * k) : 0
  }
  return b
}

// A wave that starts `turns` (0..1) of the way through its cycle: an oscillator always
// starts at phase 0, so the phase is rotated into the wave itself.
function wave(ctx: BaseAudioContext, shape: Exclude<LfoShape, 'random'>, turns: number): PeriodicWave {
  const b = series(shape)
  const real = new Float32Array(HARMONICS + 1)
  const imag = new Float32Array(HARMONICS + 1)
  for (let k = 1; k <= HARMONICS; k++) {
    const a = 2 * Math.PI * k * turns
    real[k] = b[k] * Math.sin(a)
    imag[k] = b[k] * Math.cos(a)
  }
  return ctx.createPeriodicWave(real, imag, { disableNormalization: true })
}

interface Lfo {
  // Rate input: the oscillator frequency (or, for S&H, a dummy param).
  rate: AudioParam
  baseHz: number
  depth: GainNode
  stop: () => void
}

function startLfo(ctx: AudioContext, d: LfoData, clock: Clock): Lfo {
  const baseHz = clock.cps / d.rate
  const depth = new GainNode(ctx, { gain: d.depth })
  const t0 = ctx.currentTime + 0.02
  // Where the heard music is in this LFO's cycle at t0, plus its own phase.
  const turns = (((clock.heardCycle() + 0.02 * clock.cps) / d.rate + d.phase) % 1 + 1) % 1
  if (d.shape !== 'random') {
    const osc = new OscillatorNode(ctx, { frequency: baseHz })
    osc.setPeriodicWave(wave(ctx, d.shape, turns))
    osc.connect(depth)
    osc.start(t0)
    return {
      rate: osc.frequency,
      baseHz,
      depth,
      stop: () => {
        osc.stop()
        osc.disconnect()
        depth.disconnect()
      }
    }
  }
  // Sample & hold: a new random value at every cycle boundary, scheduled ahead.
  const src = new ConstantSourceNode(ctx, { offset: Math.random() * 2 - 1 })
  src.connect(depth)
  src.start(t0)
  const period = 1 / baseHz
  let next = t0 + (1 - turns) * period
  const fill = (): void => {
    while (next < ctx.currentTime + 1) {
      src.offset.setValueAtTime(Math.random() * 2 - 1, next)
      next += period
    }
  }
  fill()
  const timer = setInterval(fill, 250)
  return {
    // S&H rate isn't modulatable; give wires a harmless param to land on.
    rate: new GainNode(ctx).gain,
    baseHz,
    depth,
    stop: () => {
      clearInterval(timer)
      src.stop()
      src.disconnect()
      depth.disconnect()
    }
  }
}

// ---- Applying the canvas ----

let running: { key: string; stop: () => void; lfos: Map<string, Lfo>; wires: Map<string, GainNode> } | null = null

export function applyModulation(nodes: CanvasNode[], edges: Edge[], busOrbits: Map<string, number>, clock: Clock): void {
  const ctx = getAudioContext() as AudioContext
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const buses = new Map<string, { volume: AudioParam; pan: AudioParam; data: MixData }>()
  for (const [id, orbit] of busOrbits) {
    const n = byId.get(id)
    if (n?.type === 'mix') buses.set(id, { ...busStage(orbit), data: n.data })
  }
  for (const b of buses.values()) {
    glide(b.volume, b.data.volume ?? 1)
    glide(b.pan, b.data.pan ?? 0)
  }

  const lfoNodes = nodes.filter((n): n is Extract<CanvasNode, { type: 'lfo' }> => n.type === 'lfo')
  const wires = edges.filter((e) => e.sourceHandle === 'mod' && byId.get(e.source)?.type === 'lfo')
  // Rebuild when anything but depth changes; depth (and bus values above) update live.
  const key = JSON.stringify([
    clock.playing,
    clock.cps,
    [...busOrbits],
    lfoNodes.map((n) => [n.id, n.data.shape, n.data.rate, n.data.phase]),
    wires.map((e) => [e.id, e.source, e.target, e.targetHandle])
  ])
  if (running?.key === key) {
    for (const n of lfoNodes) running.lfos.get(n.id)?.depth.gain.setTargetAtTime(n.data.depth, ctx.currentTime, 0.015)
    for (const e of wires) {
      const w = running.wires.get(e.id)
      const scale = wireScale(e, byId, buses, running.lfos)
      if (w && scale !== null) w.gain.setTargetAtTime(scale, ctx.currentTime, 0.015)
    }
    return
  }
  running?.stop()
  running = null
  if (!clock.playing || !lfoNodes.length) return

  const lfos = new Map(lfoNodes.map((n) => [n.id, startLfo(ctx, n.data, clock)]))
  const made = new Map<string, GainNode>()
  for (const e of wires) {
    const target = modTarget(e, byId, buses, lfos)
    const scale = wireScale(e, byId, buses, lfos)
    const src = lfos.get(e.source)
    if (!target || scale === null || !src) continue
    const g = new GainNode(ctx, { gain: scale })
    src.depth.connect(g).connect(target)
    made.set(e.id, g)
  }
  running = {
    key,
    lfos,
    wires: made,
    stop: () => {
      for (const l of lfos.values()) l.stop()
      for (const g of made.values()) g.disconnect()
    }
  }
}

type Buses = Map<string, { volume: AudioParam; pan: AudioParam; data: MixData }>

function modTarget(e: Edge, byId: Map<string, CanvasNode>, buses: Buses, lfos: Map<string, Lfo>): AudioParam | null {
  const param = e.targetHandle?.startsWith(MOD_PREFIX) ? e.targetHandle.slice(MOD_PREFIX.length) : null
  const t = byId.get(e.target)
  if (!param || !t) return null
  if (t.type === 'mix') {
    const b = buses.get(t.id)
    return b ? (param === 'pan' ? b.pan : b.volume) : null
  }
  if (t.type === 'lfo') {
    const l = lfos.get(t.id)
    return l ? (param === 'rate' ? l.rate : l.depth.gain) : null
  }
  return null
}

// What depth 1 means on each target: the Bus's own volume (so it swings 0..2x), the
// full pan, the target LFO's own rate (+-100%), or full depth.
function wireScale(e: Edge, byId: Map<string, CanvasNode>, buses: Buses, lfos: Map<string, Lfo>): number | null {
  const param = e.targetHandle?.slice(MOD_PREFIX.length)
  const t = byId.get(e.target)
  if (!t) return null
  if (t.type === 'mix') return param === 'pan' ? 1 : (buses.get(t.id)?.data.volume ?? 1)
  if (t.type === 'lfo') return param === 'rate' ? (lfos.get(t.id)?.baseHz ?? 0) : 1
  return null
}
