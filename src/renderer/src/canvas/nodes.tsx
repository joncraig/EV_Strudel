import { Handle, NodeProps, Position, useReactFlow, useNodes, useEdges } from '@xyflow/react'
import StepGrid from './StepGrid'
import { Fader, ParamFader, StepWidthGrip } from './controls'
import { GROUP_TOGGLE_EVENT } from './groups'
import { usePlayhead } from './playhead'
import { useSounding, useStepLens } from './stepLens'
import {
  DEGREE_ROWS,
  MAX_STEPS,
  stepAt,
  EFFECTS,
  EffectNode as EffectNodeT,
  MODES,
  CanvasNode,
  sequencerSample,
  KeyNode as KeyNodeT,
  MixNode as MixNodeT,
  upstream,
  LENGTH_FULL_STEP,
  LengthNode as LengthNodeT,
  lengthLabel,
  STEP_RESOLUTION,
  ModeNode as ModeNodeT,
  OCTAVES,
  OctaveNode as OctaveNodeT,
  SampleNode as SampleNodeT,
  SequencerKind,
  SequencerNode as SequencerNodeT,
  Step,
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

// ---- Mix ----

// Several chains in, one out: they play stacked through whatever follows, sharing
// its effects. Each Mix is its own orbit (bus), so its delay and reverb are its own.
export function MixNode({ id }: NodeProps<MixNodeT>): React.JSX.Element {
  const edges = useEdges()
  const inputs = edges.filter((e) => e.target === id).length
  return (
    <div className="node mix-node">
      <Handle type="target" position={Position.Left} id="pattern" />
      <Header title="Mix" />
      <div className="node-body">
        <div className="mix-count">
          {inputs} input{inputs === 1 ? '' : 's'}
        </div>
      </div>
      <Handle type="source" position={Position.Right} id="pattern" />
    </div>
  )
}

// ---- Sequencer ----

const KIND_LABEL: Record<SequencerKind, string> = {
  degree: 'Notes (scale degrees)',
  slice: 'Slices (cut & rearrange)'
}

export function SequencerNode({ id, data }: NodeProps<SequencerNodeT>): React.JSX.Element {
  const { updateNodeData } = useReactFlow()
  const nodes = useNodes()
  const edges = useEdges()
  // The sound this sequencer plays (wired in, or after it), as the music resolves it.
  const sample = sequencerSample(nodes as CanvasNode[], edges, id)

  const update = (patch: Partial<SequencerNodeT['data']>): void => updateNodeData(id, patch)
  const setLength = (len: number): void => {
    const n = Math.min(MAX_STEPS, Math.max(1, len))
    update({ steps: Array.from({ length: n }, (_, i) => data.steps[i] ?? null) })
  }

  const slices = sample ? pieceCount(sample) : 8
  const timing = {
    resolution: data.resolution,
    muted: data.muted,
    lens: useStepLens(id),
    sounding: useSounding(id)
  }
  const grid = (() => {
    switch (data.kind) {
      case 'degree':
        return (
          <StepGrid
            steps={data.steps}
            rows={DEGREE_ROWS}
            onChange={(steps: Step[]) => update({ steps })}
            timing={timing}
          />
        )
      case 'slice': {
        // Show slices top-down from the highest, so the grid reads like a piano roll.
        const all = Array.from({ length: slices }, (_, i) => slices - 1 - i)
        const used = new Set(data.steps.map((v) => (v === null ? v : v % slices)))
        // Fold shows only rows in use (all rows while nothing is placed).
        const usedRows = all.filter((v) => used.has(v))
        const rows = data.folded && usedRows.length ? usedRows : all
        return (
          <StepGrid
            steps={data.steps}
            rows={rows}
            onChange={(steps) => update({ steps })}
            timing={timing}
          />
        )
      }
    }
  })()

  return (
    <div className={`node sequencer-node ${data.muted ? 'muted' : ''}`}>
      {/* Parameter chains (Length, Key, Mode ...) wired in set values for this sequencer's notes. */}
      <Handle type="target" position={Position.Left} id="pattern" style={{ top: 40 }} />
      <Handle type="source" position={Position.Right} id="pattern" style={{ top: 40 }} />
      <Header
        title={KIND_LABEL[data.kind]}
        right={<StepWidthGrip steps={data.steps.length} max={MAX_STEPS} onChange={setLength} />}
      />
      <div className="node-body">
        <div className="seq-controls nodrag">
          <button className={data.muted ? 'on' : ''} onClick={() => update({ muted: !data.muted })}>
            M
          </button>
          {data.kind === 'slice' && (
            <button
              className={`fold ${data.folded ? 'on' : ''}`}
              onClick={() => update({ folded: !data.folded })}
            >
              Fold
            </button>
          )}
        </div>
        {/* Grid, then the gain fader; the right edge drags the step count. */}
        <div className="seq-main">
          {grid}
          <Fader label="gain" value={data.gain} max={1.5} onChange={(gain) => update({ gain })} />
        </div>
      </div>
    </div>
  )
}

// ---- Velocity and Length: level-bar sequencers that shape the pattern wired in ----

const LEVEL_ROWS = Array.from({ length: VELOCITY_LEVELS }, (_, i) => VELOCITY_LEVELS - i)

function LevelNode({
  id,
  steps,
  title,
  kind,
  fill,
  folded = false
}: {
  id: string
  steps: number[]
  title: string
  kind: 'velocity' | 'length'
  fill: number // value for new or cleared steps
  folded?: boolean
}): React.JSX.Element {
  const { updateNodeData } = useReactFlow()
  const lens = useStepLens(id)
  const sounding = useSounding(id)
  const setLength = (len: number): void => {
    const n = Math.min(MAX_STEPS, Math.max(1, len))
    updateNodeData(id, { steps: Array.from({ length: n }, (_, i) => steps[i] ?? fill) })
  }
  return (
    <div className={`node level-node ${kind}-node`}>
      <Handle type="target" position={Position.Left} id="pattern" style={{ top: 40 }} />
      <Handle type="source" position={Position.Right} id="pattern" style={{ top: 40 }} />
      <Header
        title={title}
        right={<StepWidthGrip steps={steps.length} max={MAX_STEPS} onChange={setLength} />}
      />
      <div className="node-body">
        {kind === 'length' && (
          <div className="seq-controls nodrag">
            <button
              className={`fold ${folded ? 'on' : ''}`}
              onClick={() => updateNodeData(id, { folded: !folded })}
            >
              Fold
            </button>
          </div>
        )}
        {/* Velocity reads as level bars; Length shows just the picked value per step. */}
        <StepGrid
          steps={steps}
          rows={
            kind === 'length' && folded ? LEVEL_ROWS.filter((v) => steps.includes(v)) : LEVEL_ROWS
          }
          labels={(kind === 'length' && folded
            ? LEVEL_ROWS.filter((v) => steps.includes(v))
            : LEVEL_ROWS
          ).map((v) => (kind === 'length' ? lengthLabel(v) : ''))}
          bars={kind === 'velocity'}
          noRests
          timing={{ resolution: STEP_RESOLUTION, lens, sounding }}
          onChange={(next) => updateNodeData(id, { steps: next.map((v) => v ?? fill) })}
        />
      </div>
    </div>
  )
}

// Per-step loudness (Strudel velocity).
export function VelocityNode({ id, data }: NodeProps<VelocityNodeT>): React.JSX.Element {
  return (
    <LevelNode id={id} steps={data.steps} title="Velocity" kind="velocity" fill={VELOCITY_LEVELS} />
  )
}

// Per-step note length in steps (Strudel clip); rows read ¼ … 8.
export function LengthNode({ id, data }: NodeProps<LengthNodeT>): React.JSX.Element {
  return (
    <LevelNode
      id={id}
      steps={data.steps}
      title="Length"
      kind="length"
      fill={LENGTH_FULL_STEP}
      folded={data.folded}
    />
  )
}

// ---- Effect ----

// One Strudel effect on the pattern wired in; passes the result on.
export function EffectNode({ id, data }: NodeProps<EffectNodeT>): React.JSX.Element {
  const { updateNodeData } = useReactFlow()
  const spec = EFFECTS[data.kind]
  return (
    <div className={`node effect-node ${data.bypass ? 'muted' : ''}`}>
      <Handle type="target" position={Position.Left} id="pattern" style={{ top: 40 }} />
      <Handle type="source" position={Position.Right} id="pattern" style={{ top: 40 }} />
      <Header title={data.bypass ? `${spec.label} (bypassed)` : spec.label} />
      <div className="node-body nodrag params">
        {spec.params.map((p) => (
          <ParamFader
            key={p.key}
            label={p.label}
            min={p.min}
            max={p.max}
            log={p.log}
            value={data.params[p.key] ?? p.value}
            onChange={(v) => updateNodeData(id, { params: { ...data.params, [p.key]: v } })}
          />
        ))}
      </div>
    </div>
  )
}

// ---- Key and Mode sequencers ----

// Rows top to bottom: highest index first, so the grid reads like a piano roll.
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
  const { updateNodeData } = useReactFlow()
  const lens = useStepLens(id)
  const sounding = useSounding(id)
  const update = (patch: Record<string, unknown>): void => updateNodeData(id, patch)
  const setLength = (len: number): void => {
    const n = Math.min(MAX_STEPS, Math.max(1, len))
    update({ steps: Array.from({ length: n }, (_, i) => data.steps[i] ?? null) })
  }
  const allRows = kind === 'key' ? KEY_ROWS : kind === 'mode' ? MODE_ROWS : OCTAVE_ROWS
  const used = new Set(data.steps.filter((v) => v !== null))
  const usedRows = allRows.filter((v) => used.has(v))
  const rows = data.folded && usedRows.length ? usedRows : allRows
  const labels = rows.map((v) =>
    kind === 'key' ? TONICS[v] : kind === 'mode' ? MODES[v].label.replace(/ (.*)/, '') : `oct ${v}`
  )
  return (
    <div className={`node harmony-node ${kind}-node`}>
      <Handle type="target" position={Position.Left} id="pattern" style={{ top: 40 }} />
      <Handle type="source" position={Position.Right} id="pattern" style={{ top: 40 }} />
      <Header
        title={kind === 'key' ? 'Key' : kind === 'mode' ? 'Mode' : 'Octave'}
        right={<StepWidthGrip steps={data.steps.length} max={MAX_STEPS} onChange={setLength} />}
      />
      <div className="node-body">
        <div className="seq-controls nodrag">
          <button
            className={`fold ${data.folded ? 'on' : ''}`}
            onClick={() => update({ folded: !data.folded })}
          >
            Fold
          </button>
        </div>
        <StepGrid
          steps={data.steps}
          rows={rows}
          labels={labels}
          timing={{ resolution: data.resolution, lens, sounding }}
          onChange={(steps) => update({ steps })}
        />
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
