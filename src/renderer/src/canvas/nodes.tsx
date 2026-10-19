import { useEffect, useState } from 'react'
import { useStepLens } from './stepLens'
import { subscribeStep } from './playhead'
import { Handle, NodeProps, Position, useReactFlow, useNodes, useEdges } from '@xyflow/react'
import { CHORD_TYPES } from './chords'
import { GROUP_TOGGLE_EVENT } from './groups'
import { usePlayhead } from './playhead'
import {
  stepAt,
  EFFECTS,
  EffectNode as EffectNodeT,
  MODES,
  CanvasNode,
  KeyNode as KeyNodeT,
  MixNode as MixNodeT,
  LfoNode as LfoNodeT,
  DuckNode as DuckNodeT,
  PerformNode as PerformNodeT,
  lfoRateLabel,
  MOD_PREFIX,
  upstream,
  LengthNode as LengthNodeT,
  lengthLabel,
  ModeNode as ModeNodeT,
  octaveLabel,
  OctaveNode as OctaveNodeT,
  SampleNode as SampleNodeT,
  SequencerKind,
  SequencerNode as SequencerNodeT,
  cellNotes,
  GroupNode as GroupNodeT,
  isBank,
  pieceCount,
  TONICS,
  heldValues,
  STEP_RESOLUTION,
  velocityDb,
  VelocityNode as VelocityNodeT
} from './model'

// ---- Sample ----

// A sound on the canvas: just its name and an output. Picking files, slicing etc.
// will be separate nodes wired after it.
export function SampleNode({ id, data }: NodeProps<SampleNodeT>): React.JSX.Element {
  // Flash while any sequencer that plays this sound has a hit on its current step.
  const nodes = useNodes() as CanvasNode[]
  const edges = useEdges()
  const feeds = upstream(nodes, edges, id, 'sequencer').filter(
    (n): n is SequencerNodeT => n.type === 'sequencer' && !n.data.muted
  )
  const hit = usePlayhead((cycle) => {
    if (cycle < 0) return false
    return feeds.some((s) => {
      const len = s.data.steps.length
      return s.data.steps[stepAt(cycle, len, s.data.resolution || len)] != null
    })
  })
  return (
    <div
      className={`node sample-chip ${hit ? 'hit' : ''}`}
      title={data.pack ? `${data.s} (${data.pack})` : data.s}
    >
      <span>{data.label ?? data.s}</span>
      {/* How many equal pieces a Slices sequencer cuts this into; change it from the node menu. */}
      {isBank(data) && (
        <span className="slice-count" title="files">
          {pieceCount(data)}
        </span>
      )}
      <Handle type="target" position={Position.Left} id="pattern" />
      <Handle type="source" position={Position.Right} id="pattern" />
    </div>
  )
}

// ---- Bus ----

// A modulation input on the bottom edge, under the control it moves (left: 0..1).
function ModInput({ param, left }: { param: string; left: number }): React.JSX.Element {
  return (
    <Handle
      type="target"
      position={Position.Bottom}
      id={MOD_PREFIX + param}
      className="mod-handle"
      style={{ left: `${left * 100}%` }}
    />
  )
}

// Several chains in, one out: they play stacked through whatever follows, sharing
// its effects. Each Bus is its own orbit, so its delay and reverb are its own. Volume
// and Pan act on its audio live (audio/modulation.ts) and take LFOs from below.
// ---- Cards: every node is a block in its type's colour saying what it does in large
// text, readable zoomed out. Editing is in the bottom panel. ----

// At most `max` items, then "…".
const few = (items: string[], max = 4): string =>
  items.length > max ? `${items.slice(0, max).join(' ')} …` : items.join(' ')

// Consecutive repeats once ("C C G" -> "C G").
const runs = (items: string[]): string[] => items.filter((v, i) => i === 0 || v !== items[i - 1])

function Card({
  className,
  kind,
  big,
  small,
  children
}: {
  className: string
  // The node type, small and dim (the colour already says it).
  kind: string
  big: React.ReactNode
  small?: React.ReactNode
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={`node card ${className}`}>
      <span className="card-kind">{kind}</span>
      <div className="card-big">{big || '–'}</div>
      {small && <div className="card-small">{small}</div>}
      {children}
    </div>
  )
}

// A chain node's pattern input and output.
const Ports = (): React.JSX.Element => (
  <>
    <Handle type="target" position={Position.Left} id="pattern" />
    <Handle type="source" position={Position.Right} id="pattern" />
  </>
)

export function MixNode({ id, data }: NodeProps<MixNodeT>): React.JSX.Element {
  const { updateNodeData } = useReactFlow()
  const volume = data.volume ?? 1
  const db = volume > 0 ? `${(20 * Math.log10(volume)).toFixed(1)} dB` : '−∞'
  const pan = data.pan ?? 0
  return (
    <Card
      className="mix-node"
      kind="Bus"
      big={db}
      small={
        Math.abs(pan) < 0.01
          ? null
          : pan < 0
            ? `L ${Math.round(-pan * 100)}`
            : `R ${Math.round(pan * 100)}`
      }
    >
      <div className="bus-ms nodrag">
        <button
          className={data.muted ? 'on mute' : 'mute'}
          onClick={() => updateNodeData(id, { muted: !data.muted })}
        >
          M
        </button>
        <button
          className={data.solo ? 'on solo' : 'solo'}
          onClick={() => updateNodeData(id, { solo: !data.solo })}
        >
          S
        </button>
      </div>
      <Ports />
      <ModInput param="volume" left={0.3} />
      <ModInput param="pan" left={0.7} />
      {/* Duck nodes wire in here: their notes dip this Bus. */}
      <Handle
        type="target"
        position={Position.Bottom}
        id="duck"
        className="duck-handle"
        style={{ left: '50%' }}
      />
    </Card>
  )
}

// Sidechain-style ducking: notes pass straight through, and each one dips the Buses
// wired to the duck output (bottom).
export function DuckNode({ data }: NodeProps<DuckNodeT>): React.JSX.Element {
  return (
    <Card className="duck-node" kind="Duck" big={`${Math.round(data.depth * 100)}%`}>
      <Ports />
      <Handle type="source" position={Position.Bottom} id="duck" className="duck-handle" />
    </Card>
  )
}

const ARROW = { up: '↑', down: '↓', updown: '↕', random: '?' }

// Plays the chords of the chain it's in note by note: Strum spreads each chord's
// notes across the start of its step, Arp plays them one at a time.
export function PerformNode({ data }: NodeProps<PerformNodeT>): React.JSX.Element {
  return (
    <Card
      className="perform-node"
      kind={data.mode === 'arp' ? 'Arp' : 'Strum'}
      big={data.mode === 'arp' ? `Arp ${ARROW[data.pattern]}` : `Strum ${ARROW[data.direction]}`}
      small={data.mode === 'arp' ? `${data.rate}/16` : null}
    >
      <Ports />
    </Card>
  )
}

// ---- LFO ----

// One cycle of each shape, for the little picture on the node.
function wavePath(shape: string, w: number, h: number): string {
  const pts: string[] = []
  for (let i = 0; i <= 48; i++) {
    const t = i / 48
    const v =
      shape === 'sine'
        ? Math.sin(2 * Math.PI * t)
        : shape === 'triangle'
          ? 1 - 4 * Math.abs(((t + 0.25) % 1) - 0.5)
          : shape === 'sawtooth'
            ? 2 * ((t + 0.5) % 1) - 1
            : shape === 'square'
              ? t < 0.5
                ? 1
                : -1
              : [0.6, -0.4, 0.9, -0.8, 0.2, -0.1][Math.floor(t * 5.999)]
    pts.push(`${(t * w).toFixed(1)},${((1 - v) * 0.5 * h).toFixed(1)}`)
  }
  return 'M' + pts.join(' L')
}

// A repeating wave synced to the tempo; its mod output (right) adds onto whatever it's
// wired to. Rate and Depth take other LFOs from below (modulators modulating modulators).
export function LfoNode({ data }: NodeProps<LfoNodeT>): React.JSX.Element {
  return (
    <Card
      className="lfo-node"
      kind="LFO"
      big={
        <svg className="lfo-wave" viewBox="0 0 120 32" preserveAspectRatio="none">
          <path d={wavePath(data.shape, 120, 32)} />
        </svg>
      }
      small={lfoRateLabel(data.rate)}
    >
      <ModInput param="rate" left={0.15} />
      <ModInput param="depth" left={0.35} />
      <Handle type="source" position={Position.Right} id="mod" className="mod-handle" />
    </Card>
  )
}

// ---- Sequencers ----

const KIND_LABEL: Record<SequencerKind, string> = {
  degree: 'Notes',
  slice: 'Slices',
  chord: 'Chords'
}
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII']

// The step playing now (-1 when stopped), at the step lengths this node plays at.
// Re-renders only when the step changes.
function usePlayingStep(id: string, length: number, resolution: number): number {
  const lens = useStepLens(id)
  const lensKey = lens?.join(',') ?? ''
  const [step, setStep] = useState(-1)
  useEffect(
    () => subscribeStep(length, resolution, setStep, lens),
    // lensKey stands in for lens (a new array each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [length, resolution, lensKey]
  )
  return step
}

// While playing, a card shows the step playing now; stopped, what it steps through.
function live(step: number, now: string, all: string[], max = 4): string {
  return step >= 0 ? now : few(runs(all), max)
}

export function SequencerNode({ id, data }: NodeProps<SequencerNodeT>): React.JSX.Element {
  const word = (c: (typeof data.steps)[number]): string => {
    const notes = cellNotes(c)
    if (!notes.length) return '·'
    if (data.kind === 'chord') return CHORD_TYPES[notes[0]]?.label ?? '?'
    if (data.kind === 'degree') return notes.map((d) => ROMAN[d - 1] ?? d).join('+')
    return String(notes[0] + 1)
  }
  const step = usePlayingStep(id, data.steps.length, data.resolution)
  const set = data.steps.filter((c) => cellNotes(c).length)
  return (
    <Card
      className={`sequencer-node ${data.kind}-seq ${data.muted ? 'muted' : ''}`}
      kind={KIND_LABEL[data.kind]}
      big={live(data.muted ? -1 : step, word(data.steps[step] ?? null), set.map(word))}
    >
      <Ports />
    </Card>
  )
}

// Per-step loudness (Strudel velocity).
export function VelocityNode({ id, data }: NodeProps<VelocityNodeT>): React.JSX.Element {
  const db = (v: number): string => String(velocityDb(v))
  const step = usePlayingStep(id, data.steps.length, STEP_RESOLUTION)
  return (
    <Card
      className="velocity-node"
      kind="Velocity"
      big={live(step, db(data.steps[step] ?? 0), data.steps.map(db))}
      small="dB"
    >
      <Ports />
    </Card>
  )
}

// Per-step note length (Strudel clip).
export function LengthNode({ id, data }: NodeProps<LengthNodeT>): React.JSX.Element {
  const step = usePlayingStep(id, data.steps.length, STEP_RESOLUTION)
  return (
    <Card
      className="length-node"
      kind="Length"
      big={live(step, lengthLabel(data.steps[step] ?? 1), data.steps.map(lengthLabel))}
    >
      <Ports />
    </Card>
  )
}

const short = (v: number): string =>
  v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v >= 100 ? v.toFixed(0) : String(+v.toFixed(2))

// One Strudel effect on the pattern wired in; passes the result on.
export function EffectNode({ data }: NodeProps<EffectNodeT>): React.JSX.Element {
  const spec = EFFECTS[data.kind]
  return (
    <Card
      className={`effect-node ${data.bypass ? 'muted' : ''}`}
      kind="Effect"
      big={spec.label}
      small={spec.params.map((p) => short(data.params[p.key] ?? p.value)).join(' · ')}
    >
      <Ports />
    </Card>
  )
}

function HarmonyNode({
  id,
  data,
  kind
}: {
  id: string
  data: KeyNodeT['data'] | ModeNodeT['data'] | OctaveNodeT['data']
  kind: 'key' | 'mode' | 'octave'
}): React.JSX.Element {
  const name = (v: number): string =>
    kind === 'key'
      ? TONICS[v]
      : kind === 'mode'
        ? MODES[v].label.replace(/ (.*)/, '')
        : octaveLabel(v)
  const step = usePlayingStep(id, data.steps.length, data.resolution)
  // Empty steps hold the value before them (wrapping round).
  const held = heldValues(data.steps, 0)
  const values = data.steps.filter((v): v is number => v !== null).map(name)
  return (
    <Card
      className={`harmony-node ${kind}-node`}
      kind={kind === 'key' ? 'Key' : kind === 'mode' ? 'Mode' : 'Octave'}
      big={live(step, name(held[step] ?? 0), values, kind === 'mode' ? 2 : 4)}
    >
      <Ports />
    </Card>
  )
}

export function KeyNode({ id, data }: NodeProps<KeyNodeT>): React.JSX.Element {
  return <HarmonyNode id={id} data={data} kind="key" />
}

export function OctaveNode({ id, data }: NodeProps<OctaveNodeT>): React.JSX.Element {
  return <HarmonyNode id={id} data={data} kind="octave" />
}

export function ModeNode({ id, data }: NodeProps<ModeNodeT>): React.JSX.Element {
  return <HarmonyNode id={id} data={data} kind="mode" />
}

// ---- Group ----

// A frame around grouped nodes. Tap the arrow to collapse it to its title bar.
export function GroupNode({ id, data }: NodeProps<GroupNodeT>): React.JSX.Element {
  const toggle = (): void => {
    window.dispatchEvent(new CustomEvent(GROUP_TOGGLE_EVENT, { detail: id }))
  }
  return (
    <div className={`group-frame ${data.collapsed ? 'collapsed' : ''}`}>
      <div className="group-header">
        <button className="group-toggle nodrag" onClick={toggle}>
          {data.collapsed ? '▸' : '▾'}
        </button>
        <span>{data.label}</span>
      </div>
    </div>
  )
}
