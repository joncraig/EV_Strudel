import { Handle, NodeProps, Position, useReactFlow, useNodes, useEdges } from '@xyflow/react'
import StepGrid from './StepGrid'
import { Fader, ParamFader, StepWidthGrip } from './controls'
import { GROUP_TOGGLE_EVENT } from './groups'
import { useModeIndex, usePlayhead, useStepIndex } from './playhead'
import {
  DEGREE_ROWS,
  EFFECTS,
  EffectNode as EffectNodeT,
  MODES,
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

const MAX_STEPS = 32

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
    const pos = cycle - Math.floor(cycle)
    return feeds.some((s) => s.data.steps[Math.floor(pos * s.data.steps.length)] != null)
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
  const current = useStepIndex(data.muted ? 0 : data.steps.length)
  const grid = (() => {
    switch (data.kind) {
      case 'degree':
        return <StepGrid steps={data.steps} rows={DEGREE_ROWS} onChange={(steps: Step[]) => update({ steps })} current={current} />
      case 'trigger':
        return <StepGrid steps={data.steps} rows={[1]} labels={['●']} onChange={(steps) => update({ steps })} current={current} />
      case 'slice': {
        // Show slices top-down from the highest, so the grid reads like a piano roll.
        const all = Array.from({ length: slices }, (_, i) => slices - 1 - i)
        const used = new Set(data.steps.map((v) => (v === null ? v : v % slices)))
        const rows = data.folded ? all.filter((v) => used.has(v)) : all
        if (!rows.length) return <div className="hint">Nothing placed yet. Unfold to pick slices.</div>
        return <StepGrid steps={data.steps} rows={rows} onChange={(steps) => update({ steps })} current={current} />
      }
    }
  })()

  return (
    <div className={`node sequencer-node ${data.muted ? 'muted' : ''}`}>
      <Handle type="target" position={Position.Left} id="sound" style={{ top: 40 }} />
      <Handle type="source" position={Position.Right} id="pattern" style={{ top: 40 }} />
      {data.kind === 'degree' && <Handle type="target" position={Position.Top} id="mode" />}
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
  const current = useStepIndex(data.steps.length)
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
          current={current}
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

// ---- Mode sequence ----

export function ModeNode({ id, data }: NodeProps<ModeNodeT>): React.JSX.Element {
  const { updateNodeData } = useReactFlow()
  const update = (patch: Partial<ModeNodeT['data']>): void => updateNodeData(id, patch)
  const setStep = (i: number, patch: Partial<ModeNodeT['data']['steps'][number]>): void =>
    update({ steps: data.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) })
  const active = useModeIndex(data.steps.length, data.cyclesPerStep)

  return (
    <div className="node mode-node">
      <Header title="Mode sequence" />
      <div className="node-body nodrag">
        {data.steps.map((step, i) => (
          <div className={`mode-step ${i === active ? 'now' : ''}`} key={i}>
            <span className="row-label">{i + 1}</span>
            <select value={step.tonic} onChange={(e) => setStep(i, { tonic: e.target.value })}>
              {TONICS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <select value={step.mode} onChange={(e) => setStep(i, { mode: e.target.value })}>
              {MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            {data.steps.length > 1 && (
              <button onClick={() => update({ steps: data.steps.filter((_, j) => j !== i) })}>×</button>
            )}
          </div>
        ))}
        <div className="seq-controls">
          <button onClick={() => update({ steps: [...data.steps, { ...data.steps[data.steps.length - 1] }] })}>
            + mode
          </button>
          <span>cycles each</span>
          <button onClick={() => update({ cyclesPerStep: Math.max(1, data.cyclesPerStep - 1) })}>−</button>
          <span className="value">{data.cyclesPerStep}</span>
          <button onClick={() => update({ cyclesPerStep: Math.min(16, data.cyclesPerStep + 1) })}>+</button>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} id="mode" />
    </div>
  )
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
