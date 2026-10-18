import { Handle, NodeProps, Position, useReactFlow, useNodes, useEdges } from '@xyflow/react'
import StepGrid from './StepGrid'
import { GROUP_TOGGLE_EVENT } from './groups'
import {
  DEGREE_ROWS,
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
  TONICS
} from './model'

const MAX_STEPS = 32

function Header({ title }: { title: string }): React.JSX.Element {
  return <div className="node-header">{title}</div>
}

// ---- Sample ----

// A sound on the canvas: just its name and an output. Picking files, slicing etc.
// will be separate nodes wired after it.
export function SampleNode({ data }: NodeProps<SampleNodeT>): React.JSX.Element {
  return (
    <div className="node sample-chip" title={data.pack ? `${data.s} (${data.pack})` : data.s}>
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
  const grid = (() => {
    switch (data.kind) {
      case 'degree':
        return <StepGrid steps={data.steps} rows={DEGREE_ROWS} onChange={(steps: Step[]) => update({ steps })} />
      case 'trigger':
        return <StepGrid steps={data.steps} rows={[1]} labels={['●']} onChange={(steps) => update({ steps })} />
      case 'slice': {
        // Show slices top-down from the highest, so the grid reads like a piano roll.
        const rows = Array.from({ length: slices }, (_, i) => slices - 1 - i)
        return <StepGrid steps={data.steps} rows={rows} onChange={(steps) => update({ steps })} />
      }
    }
  })()

  return (
    <div className={`node sequencer-node ${data.muted ? 'muted' : ''}`}>
      <Handle type="target" position={Position.Left} id="sound" style={{ top: 40 }} />
      {data.kind === 'degree' && <Handle type="target" position={Position.Top} id="mode" />}
      <Header title={KIND_LABEL[data.kind]} />
      <div className="node-body">
        <div className="seq-controls nodrag">
          <span>steps</span>
          <button onClick={() => setLength(data.steps.length - 1)}>−</button>
          <span className="value">{data.steps.length}</span>
          <button onClick={() => setLength(data.steps.length + 1)}>+</button>
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
          <button title="Clear" onClick={() => update({ steps: data.steps.map(() => null) })}>
            ⌫
          </button>
        </div>
        {!sample && <div className="hint">Connect a sample to the left input.</div>}
        {grid}
        <label className="nodrag">
          gain
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.01}
            value={data.gain}
            onChange={(e) => update({ gain: Number(e.target.value) })}
          />
        </label>
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

  return (
    <div className="node mode-node">
      <Header title="Mode sequence" />
      <div className="node-body nodrag">
        {data.steps.map((step, i) => (
          <div className="mode-step" key={i}>
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
