import { Handle, NodeProps, Position, useReactFlow, useNodes, useEdges } from '@xyflow/react'
import StepGrid from './StepGrid'
import { Fader, ParamFader, StepWidthGrip } from './controls'
import { GROUP_TOGGLE_EVENT } from './groups'
import { usePlayhead } from './playhead'
import {
  DEGREE_ROWS,
  MAX_STEPS,
  stepAt,
  EFFECTS,
  EffectNode as EffectNodeT,
  MODES,
  KeyNode as KeyNodeT,
  ModeNode as ModeNodeT,
  SampleData,
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
  // Flash while any sequencer this sound feeds has a hit on its current step.
  const nodes = useNodes()
  const edges = useEdges()
  const feeds = edges
    .filter((e) => e.source === id)
    .map((e) => nodes.find((n) => n.id === e.target))
    .filter((n): n is SequencerNodeT => n?.type === 'sequencer' && !n.data.muted)
  const hit = usePlayhead((cycle) => {
    if (cycle < 0) return false
    return feeds.some((s) => {
      const len = s.data.steps.length
      return s.data.steps[stepAt(cycle, len, s.data.resolution || len)] != null
    })
  })
  return (
    <div className={`node sample-chip ${hit ? 'hit' : ''}`} title={data.pack ? `${data.s} (${data.pack})` : data.s}>
      <span>{data.label ?? data.s}</span>
      {/* How many equal pieces a Slices sequencer cuts this into; change it from the node menu. */}
      <span className="slice-count" title={isBank(data) ? 'files' : 'slices'}>
        {pieceCount(data)}
      </span>
      <Handle type="source" position={Position.Right} id="sound" />
    </div>
  )
}

// ---- Sequencer ----

const KIND_LABEL: Record<SequencerKind, string> = {
  degree: 'Notes (scale degrees)',
  trigger: 'Rhythm (triggers)',
  slice: 'Slices (cut & rearrange)'
}

export function SequencerNode({ id, data }: NodeProps<SequencerNodeT>): React.JSX.Element {
  const { updateNodeData } = useReactFlow()
  const nodes = useNodes()
  const edges = useEdges()
  const sample = edges
    .filter((e) => e.target === id)
    .map((e) => nodes.find((n) => n.id === e.source))
    .find((n) => n?.type === 'sample')?.data as SampleData | undefined

  const update = (patch: Partial<SequencerNodeT['data']>): void => updateNodeData(id, patch)
  const setLength = (len: number): void => {
    const n = Math.min(MAX_STEPS, Math.max(1, len))
    update({ steps: Array.from({ length: n }, (_, i) => data.steps[i] ?? null) })
  }

  const slices = sample ? pieceCount(sample) : 8
  const timing = { resolution: data.resolution, muted: data.muted }
  const grid = (() => {
    switch (data.kind) {
      case 'degree':
        return <StepGrid steps={data.steps} rows={DEGREE_ROWS} onChange={(steps: Step[]) => update({ steps })} timing={timing} />
      case 'trigger':
        return <StepGrid steps={data.steps} rows={[1]} labels={['●']} onChange={(steps) => update({ steps })} timing={timing} />
      case 'slice': {
        // Show slices top-down from the highest, so the grid reads like a piano roll.
        const all = Array.from({ length: slices }, (_, i) => slices - 1 - i)
        const used = new Set(data.steps.map((v) => (v === null ? v : v % slices)))
        const rows = data.folded ? all.filter((v) => used.has(v)) : all
        if (!rows.length) return <div className="hint">Nothing placed yet. Unfold to pick slices.</div>
        return <StepGrid steps={data.steps} rows={rows} onChange={(steps) => update({ steps })} timing={timing} />
      }
    }
  })()

  return (
    <div className={`node sequencer-node ${data.muted ? 'muted' : ''}`}>
      <Handle type="target" position={Position.Left} id="sound" style={{ top: 40 }} />
      <Handle type="source" position={Position.Right} id="pattern" style={{ top: 40 }} />
      {data.kind === 'degree' && (
        <>
          <Handle type="target" position={Position.Top} id="key" style={{ left: '35%' }} />
          <Handle type="target" position={Position.Top} id="mode" style={{ left: '65%' }} />
        </>
      )}
      <Header
        title={KIND_LABEL[data.kind]}
        right={<StepWidthGrip steps={data.steps.length} max={MAX_STEPS} onChange={setLength} />}
      />
      <div className="node-body">
        <div className="seq-controls nodrag">
          {data.kind === 'degree' && (
            <>
              <span>oct</span>
              <button onClick={() => update({ octave: Math.max(0, data.octave - 1) })}>−</button>
              <span className="value">{data.octave}</span>
              <button onClick={() => update({ octave: Math.min(7, data.octave + 1) })}>+</button>
            </>
          )}
          <button className={data.muted ? 'on' : ''} onClick={() => update({ muted: !data.muted })}>
            M
          </button>
          {data.kind === 'slice' && (
            <button className={`fold ${data.folded ? 'on' : ''}`} onClick={() => update({ folded: !data.folded })}>
              Fold
            </button>
          )}
        </div>
        {!sample && <div className="hint">Connect a sample to the left input.</div>}
        {/* Grid, then the gain fader; the right edge drags the step count. */}
        <div className="seq-main">
          {grid}
          <Fader label="gain" value={data.gain} max={1.5} onChange={(gain) => update({ gain })} />
        </div>
      </div>
    </div>
  )
}

// ---- Velocity ----

const LEVEL_ROWS = Array.from({ length: VELOCITY_LEVELS }, (_, i) => VELOCITY_LEVELS - i)

// Per-step loudness for whatever pattern is wired in; passes the result on.
export function VelocityNode({ id, data }: NodeProps<VelocityNodeT>): React.JSX.Element {
  const { updateNodeData } = useReactFlow()
  const timing = { resolution: data.resolution }
  const setLength = (len: number): void => {
    const n = Math.min(MAX_STEPS, Math.max(1, len))
    updateNodeData(id, { steps: Array.from({ length: n }, (_, i) => data.steps[i] ?? VELOCITY_LEVELS) })
  }
  return (
    <div className="node velocity-node">
      <Handle type="target" position={Position.Left} id="pattern" style={{ top: 40 }} />
      <Handle type="source" position={Position.Right} id="pattern" style={{ top: 40 }} />
      <Header
        title="Velocity"
        right={<StepWidthGrip steps={data.steps.length} max={MAX_STEPS} onChange={setLength} />}
      />
      <div className="node-body">
        <StepGrid
          steps={data.steps}
          rows={LEVEL_ROWS}
          labels={LEVEL_ROWS.map(() => '')}
          bars
          timing={timing}
          onChange={(steps) => updateNodeData(id, { steps: steps.map((v) => v ?? VELOCITY_LEVELS) })}
        />
      </div>
    </div>
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

function HarmonyNode({
  id,
  data,
  kind
}: {
  id: string
  data: KeyNodeT['data'] | ModeNodeT['data']
  kind: 'key' | 'mode'
}): React.JSX.Element {
  const { updateNodeData } = useReactFlow()
  const update = (patch: Record<string, unknown>): void => updateNodeData(id, patch)
  const setLength = (len: number): void => {
    const n = Math.min(MAX_STEPS, Math.max(1, len))
    update({ steps: Array.from({ length: n }, (_, i) => data.steps[i] ?? null) })
  }
  const allRows = kind === 'key' ? KEY_ROWS : MODE_ROWS
  const used = new Set(data.steps.filter((v) => v !== null))
  const rows = data.folded ? allRows.filter((v) => used.has(v)) : allRows
  const labels = rows.map((v) => (kind === 'key' ? TONICS[v] : MODES[v].label.replace(/ (.*)/, '')))
  return (
    <div className={`node harmony-node ${kind}-node`}>
      <Handle type="source" position={Position.Right} id={kind} style={{ top: 40 }} />
      <Header
        title={kind === 'key' ? 'Key' : 'Mode'}
        right={<StepWidthGrip steps={data.steps.length} max={MAX_STEPS} onChange={setLength} />}
      />
      <div className="node-body">
        <div className="seq-controls nodrag">
          <button className={`fold ${data.folded ? 'on' : ''}`} onClick={() => update({ folded: !data.folded })}>
            Fold
          </button>
          <span className="hint-inline">empty steps hold</span>
        </div>
        {rows.length ? (
          <StepGrid
            steps={data.steps}
            rows={rows}
            labels={labels}
            timing={{ resolution: data.resolution }}
            onChange={(steps) => update({ steps })}
          />
        ) : (
          <div className="hint">Nothing placed yet. Unfold to pick.</div>
        )}
      </div>
    </div>
  )
}

export function KeyNode({ id, data }: NodeProps<KeyNodeT>): React.JSX.Element {
  return <HarmonyNode id={id} data={data} kind="key" />
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
