import { useEffect, useState } from 'react'
import { Handle, NodeProps, Position, useReactFlow, useNodes, useEdges } from '@xyflow/react'
import StepGrid from './StepGrid'
import { packSounds, requestAudition } from './packSounds'
import type { SoundInfo } from '../../../shared/samplePacks'
import {
  DEGREE_ROWS,
  MODES,
  ModeNode as ModeNodeT,
  SampleData,
  SampleNode as SampleNodeT,
  SequencerKind,
  SequencerNode as SequencerNodeT,
  Step,
  TONICS
} from './model'

const MAX_STEPS = 32

function useUpdate<T extends Record<string, unknown>>(id: string): (patch: Partial<T>) => void {
  const { updateNodeData } = useReactFlow()
  return (patch) => updateNodeData(id, patch)
}

function Header({ title, id }: { title: string; id: string }): React.JSX.Element {
  const { deleteElements } = useReactFlow()
  return (
    <div className="node-header">
      <span>{title}</span>
      <button className="node-x nodrag" title="Delete" onClick={() => deleteElements({ nodes: [{ id }] })}>
        ×
      </button>
    </div>
  )
}

// ---- Sample ----

export function SampleNode({ id, data }: NodeProps<SampleNodeT>): React.JSX.Element {
  const update = useUpdate<SampleData>(id)
  const [info, setInfo] = useState<SoundInfo | null>(null)

  useEffect(() => {
    if (!data.pack) return
    let live = true
    packSounds(data.pack)
      .then((all) => live && setInfo(all[data.s] ?? null))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [data.pack, data.s])

  const files = info && !info.multisample ? info.variants : []
  const pick = (n: number): void => {
    const next = (n + files.length) % files.length
    update({ n: next })
    requestAudition({ s: data.s, n: next, pack: data.pack })
  }

  return (
    <div className="node sample-node">
      <Header title={info?.multisample ? 'Instrument' : 'Sample'} id={id} />
      <div className="node-body nodrag">
        <div className="sample-title">
          <button title="Play" onClick={() => requestAudition({ s: data.s, n: data.n, pack: data.pack })}>
            ▶
          </button>
          <span className="sound-label">{data.s}</span>
        </div>
        {files.length > 1 && (
          <div className="variant-picker">
            <button onClick={() => pick(data.n - 1)}>◀</button>
            <select value={data.n} onChange={(e) => pick(Number(e.target.value))}>
              {files.map((f, n) => (
                <option key={n} value={n}>
                  {n} · {f}
                </option>
              ))}
            </select>
            <button onClick={() => pick(data.n + 1)}>▶</button>
          </div>
        )}
        {files.length === 1 && <div className="file-label">{files[0]}</div>}
        {!info?.multisample && (
          <div className="seq-controls" title="Cut the sample into equal slices for a Slices sequencer">
            <span>cut into</span>
            <button onClick={() => update({ slices: Math.max(1, data.slices - 1) })}>−</button>
            <span className="value">{data.slices}</span>
            <button onClick={() => update({ slices: Math.min(64, data.slices + 1) })}>+</button>
            <span>slices</span>
          </div>
        )}
      </div>
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

  const slices = sample?.slices ?? 8
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
      <Header title={KIND_LABEL[data.kind]} id={id} />
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
      <Header title="Mode sequence" id={id} />
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

