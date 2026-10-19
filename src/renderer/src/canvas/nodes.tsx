import { Handle, NodeProps, Position, useReactFlow, useNodes, useEdges } from '@xyflow/react'
import MiniSteps from './MiniSteps'
import { CHORD_TYPES } from './chords'
import { GROUP_TOGGLE_EVENT } from './groups'
import { usePlayhead } from './playhead'
import { useSounding, useStepLens } from './stepLens'
import {
  DEGREE_ROWS,
  stepAt,
  EFFECTS,
  EffectNode as EffectNodeT,
  MODES,
  CanvasNode,
  sequencerSample,
  KeyNode as KeyNodeT,
  MixNode as MixNodeT,
  LfoNode as LfoNodeT,
  DuckNode as DuckNodeT,
  PerformNode as PerformNodeT,
  LFO_SHAPES,
  lfoRateLabel,
  MOD_PREFIX,
  upstream,
  LengthNode as LengthNodeT,
  lengthLabel,
  STEP_RESOLUTION,
  ModeNode as ModeNodeT,
  OCTAVES,
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
  VELOCITY_LEVELS,
  VelocityNode as VelocityNodeT
} from './model'

// Title bar (drags the node). `right` holds header controls like the step grip.
function Header({ title, right }: { title: string; right?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="node-header">
      <span className="node-title">{title}</span>
      {right}
    </div>
  )
}

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
export function MixNode({ id, data }: NodeProps<MixNodeT>): React.JSX.Element {
  const { updateNodeData } = useReactFlow()
  const volume = data.volume ?? 1
  const db = volume > 0 ? `${(20 * Math.log10(volume)).toFixed(1)} dB` : '-inf dB'
  const pan = data.pan ?? 0
  const panText =
    Math.abs(pan) < 0.01 ? 'C' : pan < 0 ? `L${Math.round(-pan * 100)}` : `R${Math.round(pan * 100)}`
  return (
    <div className="node mix-node">
      <Handle type="target" position={Position.Left} id="pattern" />
      <Header
        title="Bus"
        right={
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
        }
      />
      <div className="node-summary">
        {db} · {panText}
      </div>
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
      <Handle type="source" position={Position.Right} id="pattern" />
    </div>
  )
}

// ---- Duck ----

const ms = (s: number): string => (s < 1 ? `${Math.round(s * 1000)} ms` : `${s.toFixed(2)} s`)

// Sidechain-style ducking: notes pass straight through, and each one dips the Buses
// wired to the duck output (bottom).
export function DuckNode({ data }: NodeProps<DuckNodeT>): React.JSX.Element {
  return (
    <div className="node duck-node">
      <Handle type="target" position={Position.Left} id="pattern" style={{ top: 17 }} />
      <Handle type="source" position={Position.Right} id="pattern" style={{ top: 17 }} />
      <Header title="Duck" />
      <div className="node-summary">
        {Math.round(data.depth * 100)}% · {ms(data.attack)} / {ms(data.release)}
      </div>
      <Handle type="source" position={Position.Bottom} id="duck" className="duck-handle" />
    </div>
  )
}

// ---- Strum / Arp ----

const ARP_LABEL = { up: 'up', down: 'down', updown: 'up-down', random: 'random' }

// Plays the chords of the chain it's in note by note: Strum spreads each chord's
// notes across the start of its step, Arp plays them one at a time.
export function PerformNode({ data }: NodeProps<PerformNodeT>): React.JSX.Element {
  return (
    <div className="node perform-node">
      <Handle type="target" position={Position.Left} id="pattern" style={{ top: 17 }} />
      <Handle type="source" position={Position.Right} id="pattern" style={{ top: 17 }} />
      <Header title="Strum / Arp" />
      <div className="node-summary">
        {data.mode === 'arp'
          ? `Arp · ${ARP_LABEL[data.pattern]} · ${data.rate}/16`
          : `Strum · ${data.direction} · ${Math.round(data.amount * 100)}%`}
      </div>
    </div>
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
  const shape = LFO_SHAPES.find((s) => s.id === data.shape)?.label ?? data.shape
  return (
    <div className="node lfo-node">
      <Header title="LFO" />
      <svg className="lfo-wave" viewBox="0 0 120 32" preserveAspectRatio="none">
        <path d={wavePath(data.shape, 120, 32)} />
      </svg>
      <div className="node-summary">
        {shape} · {lfoRateLabel(data.rate)} · {Math.round(data.depth * 100)}%
      </div>
      <ModInput param="rate" left={0.15} />
      <ModInput param="depth" left={0.35} />
      <Handle type="source" position={Position.Right} id="mod" className="mod-handle" />
    </div>
  )
}

// ---- Sequencers: a summary on the canvas, edited in the bottom panel ----

const KIND_LABEL: Record<SequencerKind, string> = {
  degree: 'Notes',
  slice: 'Slices',
  chord: 'Chords'
}

// Chords rows: one chord type each (top: in key).
const CHORD_ROWS = CHORD_TYPES.map((_, i) => i)

// The step count, in the title bar.
const StepCount = ({ n }: { n: number }): React.JSX.Element => (
  <span className="step-count">{n}</span>
)

export function SequencerNode({ id, data }: NodeProps<SequencerNodeT>): React.JSX.Element {
  const nodes = useNodes()
  const edges = useEdges()
  // The sound this sequencer plays (wired in, or after it), as the music resolves it.
  const sample = sequencerSample(nodes as CanvasNode[], edges, id)
  const slices = sample ? pieceCount(sample) : 8
  const timing = {
    resolution: data.resolution,
    muted: data.muted,
    lens: useStepLens(id),
    sounding: useSounding(id)
  }
  const rows =
    data.kind === 'chord'
      ? CHORD_ROWS
      : data.kind === 'degree'
        ? DEGREE_ROWS
        : Array.from({ length: slices }, (_, i) => slices - 1 - i)
  // Chords: the types in use, in order of first use.
  const types =
    data.kind === 'chord'
      ? [...new Set(data.steps.flatMap((c) => cellNotes(c)))]
          .map((t) => CHORD_TYPES[t]?.label)
          .join(' ')
      : ''
  return (
    <div className={`node sequencer-node ${data.muted ? 'muted' : ''}`}>
      {/* Parameter chains (Length, Key, Mode ...) wired in set values for this sequencer's notes. */}
      <Handle type="target" position={Position.Left} id="pattern" style={{ top: 17 }} />
      <Handle type="source" position={Position.Right} id="pattern" style={{ top: 17 }} />
      <Header title={KIND_LABEL[data.kind]} right={<StepCount n={data.steps.length} />} />
      <MiniSteps steps={data.steps} rows={rows} timing={timing} />
      {types && <div className="node-summary">{types}</div>}
    </div>
  )
}

// ---- Velocity and Length: level sequencers that shape the pattern wired in ----

const LEVEL_ROWS = Array.from({ length: VELOCITY_LEVELS }, (_, i) => VELOCITY_LEVELS - i)

function LevelNode({
  id,
  steps,
  title,
  kind
}: {
  id: string
  steps: number[]
  title: string
  kind: 'velocity' | 'length'
}): React.JSX.Element {
  const lens = useStepLens(id)
  const sounding = useSounding(id)
  // Length: the lengths in use.
  const used = kind === 'length' ? [...new Set(steps)].map(lengthLabel).join(' ') : ''
  return (
    <div className={`node level-node ${kind}-node`}>
      <Handle type="target" position={Position.Left} id="pattern" style={{ top: 17 }} />
      <Handle type="source" position={Position.Right} id="pattern" style={{ top: 17 }} />
      <Header title={title} right={<StepCount n={steps.length} />} />
      <MiniSteps
        steps={steps}
        rows={LEVEL_ROWS}
        bars={kind === 'velocity'}
        timing={{ resolution: STEP_RESOLUTION, lens, sounding }}
      />
      {used && <div className="node-summary">{used}</div>}
    </div>
  )
}

// Per-step loudness (Strudel velocity).
export function VelocityNode({ id, data }: NodeProps<VelocityNodeT>): React.JSX.Element {
  return <LevelNode id={id} steps={data.steps} title="Velocity" kind="velocity" />
}

// Per-step note length (Strudel clip).
export function LengthNode({ id, data }: NodeProps<LengthNodeT>): React.JSX.Element {
  return <LevelNode id={id} steps={data.steps} title="Length" kind="length" />
}

// ---- Effect ----

const short = (v: number): string =>
  v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v >= 100 ? v.toFixed(0) : String(+v.toFixed(2))

// One Strudel effect on the pattern wired in; passes the result on.
export function EffectNode({ data }: NodeProps<EffectNodeT>): React.JSX.Element {
  const spec = EFFECTS[data.kind]
  return (
    <div className={`node effect-node ${data.bypass ? 'muted' : ''}`}>
      <Handle type="target" position={Position.Left} id="pattern" style={{ top: 17 }} />
      <Handle type="source" position={Position.Right} id="pattern" style={{ top: 17 }} />
      <Header title={data.bypass ? `${spec.label} (off)` : spec.label} />
      <div className="node-summary">
        {spec.params.map((p) => `${p.label} ${short(data.params[p.key] ?? p.value)}`).join(' · ')}
      </div>
    </div>
  )
}

// ---- Key, Mode and Octave sequencers ----

// Rows top to bottom: highest index first, so the strip reads like a piano roll.
const KEY_ROWS = TONICS.map((_, i) => TONICS.length - 1 - i)
const MODE_ROWS = MODES.map((_, i) => MODES.length - 1 - i)
const OCTAVE_ROWS = [...OCTAVES].reverse()

function HarmonyNode({
  id,
  data,
  kind
}: {
  id: string
  data: KeyNodeT['data'] | ModeNodeT['data'] | OctaveNodeT['data']
  kind: 'key' | 'mode' | 'octave'
}): React.JSX.Element {
  const lens = useStepLens(id)
  const sounding = useSounding(id)
  const rows = kind === 'key' ? KEY_ROWS : kind === 'mode' ? MODE_ROWS : OCTAVE_ROWS
  const name = (v: number): string =>
    kind === 'key'
      ? TONICS[v]
      : kind === 'mode'
        ? MODES[v].label.replace(/ (.*)/, '')
        : octaveLabel(v)
  // The values it steps through, in order.
  const values = data.steps.filter((v): v is number => v !== null)
  const seq = values.filter((v, i) => i === 0 || v !== values[i - 1]).map(name)
  return (
    <div className={`node harmony-node ${kind}-node`}>
      <Handle type="target" position={Position.Left} id="pattern" style={{ top: 17 }} />
      <Handle type="source" position={Position.Right} id="pattern" style={{ top: 17 }} />
      <Header
        title={kind === 'key' ? 'Key' : kind === 'mode' ? 'Mode' : 'Octave'}
        right={<StepCount n={data.steps.length} />}
      />
      <MiniSteps
        steps={data.steps}
        rows={rows}
        timing={{ resolution: data.resolution, lens, sounding }}
      />
      <div className="node-summary">
        {seq.length > 6 ? `${seq.slice(0, 6).join(' ')} …` : seq.join(' ')}
      </div>
    </div>
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
