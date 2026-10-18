import { Edge, useReactFlow } from '@xyflow/react'
import PianoRoll from './PianoRoll'
import {
  CanvasNode,
  EFFECTS,
  EffectParam,
  isBank,
  MAX_STEPS,
  pieceCount,
  SequencerKind,
  VELOCITY_LEVELS
} from './model'

// Settings for the selected node, docked under the canvas. Edits go through
// updateNodeData, so they land in undo like any other canvas change.


const KIND: Record<SequencerKind, string> = {
  degree: 'Notes sequencer',
  trigger: 'Rhythm sequencer',
  slice: 'Slices sequencer'
}

function Stepper({
  label,
  value,
  min,
  max,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}): React.JSX.Element {
  return (
    <div className="pfield">
      <span className="plabel">{label}</span>
      <div className="stepper">
        <button onClick={() => onChange(Math.max(min, value - 1))}>−</button>
        <span className="pvalue">{value}</span>
        <button onClick={() => onChange(Math.min(max, value + 1))}>+</button>
      </div>
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  log,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  log?: boolean
  onChange: (v: number) => void
}): React.JSX.Element {
  // The range input works in 0..1000; log scale moves evenly through octaves.
  const toT = (v: number): number => (log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min))
  const fromT = (p: number): number => (log ? min * Math.pow(max / min, p) : min + p * (max - min))
  const shown = value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value >= 100 ? value.toFixed(0) : value.toFixed(2)
  return (
    <div className="pfield slider">
      <span className="plabel">{label}</span>
      <input
        type="range"
        min={0}
        max={1000}
        value={Math.round(toT(value) * 1000)}
        onChange={(e) => onChange(+fromT(Number(e.target.value) / 1000).toFixed(3))}
      />
      <span className="pvalue">{shown}</span>
    </div>
  )
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }): React.JSX.Element {
  return (
    <button className={`ptoggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
      {label}
    </button>
  )
}

function Panel({ nodes, edges }: { nodes: CanvasNode[]; edges: Edge[] }): React.JSX.Element {
  const { updateNodeData } = useReactFlow()
  const selected = nodes.filter((n) => n.selected)

  if (selected.length !== 1)
    return (
      <div className="panel empty">
        {selected.length > 1 ? `${selected.length} nodes selected` : 'Tap a node to see its settings here.'}
      </div>
    )

  const node = selected[0]
  const set = (patch: Record<string, unknown>): void => updateNodeData(node.id, patch)
  const resize = <T,>(steps: T[], n: number, fill: T): T[] => Array.from({ length: n }, (_, i) => steps[i] ?? fill)

  let title = ''
  let body: React.ReactNode = null
  switch (node.type) {
    case 'sample': {
      const d = node.data
      title = d.label ?? d.s
      body = (
        <>
          <div className="pinfo">
            <div>
              sound <b>{d.s}</b>
              {d.pack && <> from {d.pack}</>}
            </div>
            <div>
              {isBank(d) ? `${pieceCount(d)} files to pick from` : `cut into ${pieceCount(d)} slices`}
              {d.n ? ` · file ${d.n}` : ''}
            </div>
          </div>
        </>
      )
      break
    }
    case 'sequencer': {
      const d = node.data
      title = KIND[d.kind]
      body = (
        <>
          <Stepper
            label="length"
            value={d.steps.length}
            min={1}
            max={MAX_STEPS}
            onChange={(n) => set({ steps: resize(d.steps, n, null) })}
          />
          {d.kind === 'degree' && (
            <Stepper label="octave" value={d.octave} min={0} max={7} onChange={(octave) => set({ octave })} />
          )}
          <Slider label="gain" value={d.gain} min={0} max={1.5} onChange={(gain) => set({ gain })} />
          <Toggle label="Mute" on={d.muted} onChange={(muted) => set({ muted })} />
          {d.kind === 'slice' && <Toggle label="Fold" on={!!d.folded} onChange={(folded) => set({ folded })} />}
          <button className="ptoggle" onClick={() => set({ steps: d.steps.map(() => null) })}>
            Clear
          </button>
        </>
      )
      break
    }
    case 'velocity': {
      const d = node.data
      title = 'Velocity sequencer'
      body = (
        <>
          <Stepper
            label="length"
            value={d.steps.length}
            min={1}
            max={MAX_STEPS}
            onChange={(n) => set({ steps: resize(d.steps, n, VELOCITY_LEVELS) })}
          />
        </>
      )
      break
    }
    case 'effect': {
      const d = node.data
      title = EFFECTS[d.kind].label
      body = (
        <>
          {(EFFECTS[d.kind].params as EffectParam[]).map((p) => (
            <Slider
              key={p.key}
              label={p.label}
              value={d.params[p.key] ?? p.value}
              min={p.min}
              max={p.max}
              log={p.log}
              onChange={(v) => set({ params: { ...d.params, [p.key]: v } })}
            />
          ))}
          <Toggle label="Bypass" on={!!d.bypass} onChange={(bypass) => set({ bypass })} />
        </>
      )
      break
    }
    case 'key':
    case 'mode': {
      const d = node.data
      title = node.type === 'key' ? 'Key sequencer' : 'Mode sequencer'
      body = (
        <>
          <Stepper
            label="length"
            value={d.steps.length}
            min={1}
            max={MAX_STEPS}
            onChange={(n) => set({ steps: resize(d.steps, n, null) })}
          />
          <Toggle label="Fold" on={!!d.folded} onChange={(folded) => set({ folded })} />
          <span className="plabel">Empty steps hold the last {node.type}.</span>
        </>
      )
      break
    }
    case 'group': {
      const d = node.data
      title = 'Group'
      body = (
        <div className="pfield">
          <span className="plabel">name</span>
          <input className="pname" value={d.label} onChange={(e) => set({ label: e.target.value })} />
        </div>
      )
      break
    }
  }

  const roll =
    node.type === 'sequencer' || node.type === 'velocity' || node.type === 'key' || node.type === 'mode' ? (
      <PianoRoll node={node} nodes={nodes} edges={edges} onSteps={(steps) => set({ steps })} />
    ) : null

  return (
    <div className={`panel ${roll ? 'with-roll' : ''}`}>
      <div className="panel-top">
        <div className="ptitle">{title}</div>
        <div className="pbody">{body}</div>
      </div>
      {roll}
    </div>
  )
}

export default Panel
