import { useEffect, useState } from 'react'
import { useStepLens } from './stepLens'
import { subscribeStep } from './playhead'
import {
  Handle,
  NodeProps,
  Position,
  useReactFlow,
  useNodes,
  useEdges,
  useNodeId,
  useNodesData
} from '@xyflow/react'
import { CHORD_TYPES } from './chords'
import { ParamFader } from './controls'
import { soloChanges } from './solo'
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
  BUS_MAX_VOLUME,
  VOICING_LABEL,
  VOICING_ROWS,
  type VoicingNode as VoicingNodeT,
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
      <Handle type="target" position={Position.Top} id="pattern" />
      <Handle type="source" position={Position.Bottom} id="pattern" />
    </div>
  )
}

// ---- Bus ----

// A modulation input on the bottom edge, under the control it moves (left: 0..1).
// A modulation input on the left edge, `at` (0..1) of the way down.
function ModInput({ param, at }: { param: string; at: number }): React.JSX.Element {
  return (
    <Handle
      type="target"
      position={Position.Left}
      id={MOD_PREFIX + param}
      className="mod-handle"
      style={{ top: `${at * 100}%` }}
    />
  )
}

// ---- Cards: every node is a block in its type's colour saying what it does in large
// text, readable zoomed out. Editing is in the bottom panel. ----

// At most `max` items, then "…".
const few = (items: string[], max = 4): string =>
  items.length > max ? `${items.slice(0, max).join(' ')} …` : items.join(' ')

// Consecutive repeats once ("C C G" -> "C G").
const runs = (items: string[]): string[] => items.filter((v, i) => i === 0 || v !== items[i - 1])

// Mute and Solo, the same on every card (top right).
function MuteSolo(): React.JSX.Element | null {
  const id = useNodeId()
  const node = useNodesData(id ?? '')
  const { updateNodeData, getNodes } = useReactFlow()
  if (!id || !node) return null
  const d = node.data as { muted?: boolean; solo?: boolean }
  return (
    <div className="bus-ms nodrag">
      <button
        className={d.muted ? 'on mute' : 'mute'}
        onClick={() => updateNodeData(id, { muted: !d.muted })}
      >
        M
      </button>
      <button
        className={d.solo ? 'on solo' : 'solo'}
        title="Solo (Shift: add to the solo)"
        onClick={(e) => {
          for (const c of soloChanges(getNodes(), [id], e.shiftKey))
            updateNodeData(c.id, { solo: c.solo })
        }}
      >
        S
      </button>
    </div>
  )
}

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
      <MuteSolo />
      <div className="card-big">{big || '–'}</div>
      {small && <div className="card-small">{small}</div>}
      {children}
    </div>
  )
}

// A chain node's pattern input and output.
const Ports = (): React.JSX.Element => (
  <>
    <Handle type="target" position={Position.Top} id="pattern" />
    <Handle type="source" position={Position.Bottom} id="pattern" />
  </>
)

// The Bus number shown everywhere (Duck's selector too): its place among the Buses.
function useBusNumber(id: string): number {
  const nodes = useNodes()
  return nodes.filter((n) => n.type === 'mix').findIndex((n) => n.id === id) + 1
}

// A Bus is a channel strip in the fader section at the bottom: volume and pan faders
// you drag right here (they act live on its audio), plus M/S. LFOs plug in on the left.
export function MixNode({ id, data }: NodeProps<MixNodeT>): React.JSX.Element {
  const { updateNodeData } = useReactFlow()
  const n = useBusNumber(id)
  const volume = data.volume ?? 1
  const db = volume > 0 ? `${(20 * Math.log10(volume)).toFixed(1)} dB` : '−∞'
  return (
    <Card className="mix-node" kind={`Bus ${n}`} big={db}>
      <div className="strip-faders nodrag">
        <ParamFader
          label="volume"
          display={db}
          value={volume}
          min={0}
          max={BUS_MAX_VOLUME}
          onChange={(v) => updateNodeData(id, { volume: v })}
        />
        <ParamFader
          label="pan"
          value={data.pan ?? 0}
          min={-1}
          max={1}
          onChange={(v) => updateNodeData(id, { pan: v })}
        />
      </div>
      <Handle type="target" position={Position.Top} id="pattern" />
      <ModInput param="volume" at={0.55} />
      <ModInput param="pan" at={0.8} />
    </Card>
  )
}

// Sidechain-style ducking: notes pass straight through, and each one dips the Buses
// picked in its panel.
export function DuckNode({ data }: NodeProps<DuckNodeT>): React.JSX.Element {
  const nodes = useNodes()
  const buses = nodes.filter((n) => n.type === 'mix').map((n) => n.id)
  const targets = (data.targets ?? [])
    .map((t) => buses.indexOf(t) + 1)
    .filter((i) => i > 0)
    .sort((a, b) => a - b)
  return (
    <Card
      className="duck-node"
      kind="Duck"
      big={`${Math.round(data.depth * 100)}%`}
      small={targets.length ? `→ Bus ${targets.join(', ')}` : '→ no Bus'}
    >
      <Ports />
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
      <ModInput param="rate" at={0.35} />
      <ModInput param="depth" at={0.7} />
      <Handle type="source" position={Position.Bottom} id="mod" className="mod-handle" />
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
      className="effect-node"
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

// Inversion / Spread / Bass: steps through one voicing choice for the chords around it.
export function VoicingNode({ id, data }: NodeProps<VoicingNodeT>): React.JSX.Element {
  const rows = VOICING_ROWS[data.param]
  const step = usePlayingStep(id, data.steps.length, data.resolution)
  const held = heldValues(data.steps, 0)
  const values = data.steps.filter((v): v is number => v !== null).map((v) => rows[v] ?? '?')
  return (
    <Card
      className={`voicing-node ${data.param}-node`}
      kind={VOICING_LABEL[data.param]}
      big={live(step, rows[held[step] ?? 0] ?? '?', values)}
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
