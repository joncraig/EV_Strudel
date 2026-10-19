import { Edge, useReactFlow } from '@xyflow/react'
import PianoRoll from './PianoRoll'
import { SPREADS } from './chords'
import { valueDrag } from '../drag'
import { useNudge } from '../nudge'
import {
  BUS_MAX_VOLUME,
  CanvasNode,
  EFFECTS,
  LFO_RATES,
  LFO_SHAPES,
  lfoRateLabel,
  EffectParam,
  isBank,
  pieceCount,
  SequencerKind
} from './model'

// Settings for the selected node, docked under the canvas. Edits go through
// updateNodeData, so they land in undo like any other canvas change.

const KIND: Record<SequencerKind, string> = {
  degree: 'Notes sequencer',
  slice: 'Slices sequencer',
  chord: 'Chords'
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
  const toT = (v: number): number =>
    log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min)
  const fromT = (p: number): number => (log ? min * Math.pow(max / min, p) : min + p * (max - min))
  const shown =
    value >= 1000
      ? `${(value / 1000).toFixed(1)}k`
      : value >= 100
        ? value.toFixed(0)
        : value.toFixed(2)
  const t = Math.min(1, Math.max(0, toT(value)))
  const setT = (p: number): void => onChange(+fromT(Math.min(1, Math.max(0, p))).toFixed(3))
  // One notch = 1% of the travel.
  const touch = useNudge((n) => setT(t + n / 100))
  return (
    <div className="pfield slider">
      <span className="plabel">{label}</span>
      <div
        className="hbar"
        onPointerDown={(e) => {
          touch()
          const r = e.currentTarget.getBoundingClientRect()
          const start = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
          const set = (p: number): void => onChange(+fromT(Math.min(1, Math.max(0, p))).toFixed(3))
          set(start)
          valueDrag(e, (dx) => set(start + dx / r.width))
        }}
      >
        <div className="hbar-fill" style={{ width: `${t * 100}%` }} />
      </div>
      <span className="pvalue">{shown}</span>
    </div>
  )
}

function Toggle({
  label,
  on,
  onChange
}: {
  label: string
  on: boolean
  onChange: (v: boolean) => void
}): React.JSX.Element {
  return (
    <button className={`ptoggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
      {label}
    </button>
  )
}

function Panel({ nodes, edges }: { nodes: CanvasNode[]; edges: Edge[] }): React.JSX.Element {
  const { updateNodeData } = useReactFlow()
  const selected = nodes.filter((n) => n.selected)

  // Always the same size: with nothing (or several things) selected it's just empty.
  if (selected.length !== 1) return <div className="panel empty" />

  const node = selected[0]
  const set = (patch: Record<string, unknown>): void => updateNodeData(node.id, patch)

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
              {isBank(d)
                ? `${pieceCount(d)} files to pick from`
                : `cut into ${pieceCount(d)} slices`}
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
          <Toggle label="Mute" on={d.muted} onChange={(muted) => set({ muted })} />
          {d.kind === 'slice' && (
            <Toggle label="Fold" on={!!d.folded} onChange={(folded) => set({ folded })} />
          )}
          {d.kind === 'chord' && (
            <>
              {[0, 1, 2, 3].map((k) => (
                <Toggle
                  key={k}
                  label={k ? `inv ${k}` : 'root'}
                  on={(d.inversion ?? 0) === k}
                  onChange={() => set({ inversion: k })}
                />
              ))}
              {SPREADS.map((sp) => (
                <Toggle
                  key={sp}
                  label={sp}
                  on={(d.spread ?? 'close') === sp}
                  onChange={() => set({ spread: sp })}
                />
              ))}
              <Toggle label="Bass" on={!!d.bass} onChange={(bass) => set({ bass })} />
            </>
          )}
          <button className="ptoggle" onClick={() => set({ steps: d.steps.map(() => null) })}>
            Clear
          </button>
        </>
      )
      break
    }
    case 'length':
    case 'velocity': {
      const d = node.data
      title = node.type === 'length' ? 'Length sequencer' : 'Velocity sequencer'
      body = (
        <>
          {node.type === 'length' && (
            <Toggle label="Fold" on={!!d.folded} onChange={(folded) => set({ folded })} />
          )}
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
    case 'mode':
    case 'octave': {
      const d = node.data
      title =
        node.type === 'key'
          ? 'Key sequencer'
          : node.type === 'mode'
            ? 'Mode sequencer'
            : 'Octave sequencer'
      body = (
        <>
          <Toggle label="Fold" on={!!d.folded} onChange={(folded) => set({ folded })} />
          <span className="plabel">Empty steps hold the last {node.type}.</span>
        </>
      )
      break
    }
    case 'mix': {
      const d = node.data
      title = 'Bus'
      body = (
        <>
          <Toggle label="Mute" on={!!d.muted} onChange={(muted) => set({ muted })} />
          <Toggle label="Solo" on={!!d.solo} onChange={(solo) => set({ solo })} />
          <Slider
            label="volume"
            value={d.volume ?? 1}
            min={0}
            max={BUS_MAX_VOLUME}
            onChange={(volume) => set({ volume })}
          />
          <Slider
            label="pan"
            value={d.pan ?? 0}
            min={-1}
            max={1}
            onChange={(pan) => set({ pan })}
          />
        </>
      )
      break
    }
    case 'perform': {
      const d = node.data
      title = 'Strum / Arp'
      body = (
        <>
          <Toggle label="Strum" on={d.mode === 'strum'} onChange={() => set({ mode: 'strum' })} />
          <Toggle label="Arp" on={d.mode === 'arp'} onChange={() => set({ mode: 'arp' })} />
          {d.mode === 'arp' ? (
            <>
              {(['up', 'down', 'updown', 'random'] as const).map((p) => (
                <Toggle
                  key={p}
                  label={p === 'updown' ? 'up-down' : p}
                  on={d.pattern === p}
                  onChange={() => set({ pattern: p })}
                />
              ))}
              {[1, 2, 3, 4].map((r) => (
                <Toggle
                  key={r}
                  label={`${r}/16`}
                  on={d.rate === r}
                  onChange={() => set({ rate: r })}
                />
              ))}
            </>
          ) : (
            <>
              {(['up', 'down'] as const).map((p) => (
                <Toggle
                  key={p}
                  label={p}
                  on={d.direction === p}
                  onChange={() => set({ direction: p })}
                />
              ))}
              <Slider
                label="spread"
                value={d.amount}
                min={0}
                max={0.5}
                onChange={(amount) => set({ amount })}
              />
            </>
          )}
        </>
      )
      break
    }
    case 'duck': {
      const d = node.data
      title = 'Duck'
      body = (
        <>
          <Slider
            label="depth"
            value={d.depth}
            min={0}
            max={1}
            onChange={(depth) => set({ depth })}
          />
          <Slider
            label="attack s"
            value={d.attack}
            min={0.001}
            max={0.5}
            log
            onChange={(attack) => set({ attack })}
          />
          <Slider
            label="release s"
            value={d.release}
            min={0.01}
            max={2}
            log
            onChange={(release) => set({ release })}
          />
        </>
      )
      break
    }
    case 'lfo': {
      const d = node.data
      title = 'LFO'
      body = (
        <>
          {LFO_SHAPES.map((sh) => (
            <Toggle
              key={sh.id}
              label={sh.label}
              on={d.shape === sh.id}
              onChange={() => set({ shape: sh.id })}
            />
          ))}
          {LFO_RATES.map((r) => (
            <Toggle
              key={r}
              label={lfoRateLabel(r)}
              on={d.rate === r}
              onChange={() => set({ rate: r })}
            />
          ))}
          <Slider
            label="depth"
            value={d.depth}
            min={0}
            max={1}
            onChange={(depth) => set({ depth })}
          />
          <Slider
            label="phase"
            value={d.phase}
            min={0}
            max={1}
            onChange={(phase) => set({ phase })}
          />
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
          <input
            className="pname"
            value={d.label}
            onChange={(e) => set({ label: e.target.value })}
          />
        </div>
      )
      break
    }
  }

  const roll =
    node.type === 'sequencer' ||
    node.type === 'velocity' ||
    node.type === 'length' ||
    node.type === 'key' ||
    node.type === 'mode' ||
    node.type === 'octave' ? (
      <PianoRoll node={node} nodes={nodes} edges={edges} onSteps={(steps) => set({ steps })} />
    ) : null

  return (
    <div className="panel">
      <div className="panel-top">
        <div className="ptitle">{title}</div>
        <div className="pbody">{body}</div>
      </div>
      {roll}
    </div>
  )
}

export default Panel
