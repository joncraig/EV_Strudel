import { Handle, NodeProps, Position, useReactFlow, useNodes, useEdges } from '@xyflow/react'
import StepGrid from './StepGrid'
import { CHORD_TYPES, SPREADS } from './chords'
import { ParamFader, StepWidthGrip } from './controls'
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
  BUS_MAX_VOLUME,
  LfoNode as LfoNodeT,
  DuckNode as DuckNodeT,
  PerformNode as PerformNodeT,
  LFO_RATES,
  LFO_SHAPES,
  lfoRateLabel,
  MOD_PREFIX,
  upstream,
  LENGTH_FULL_STEP,
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
  const db = volume > 0 ? `${(20 * Math.log10(volume)).toFixed(1)} dB` : '-inf'
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
      <div className="node-body bus-body nodrag">
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

// Sidechain-style ducking: notes pass straight through, and each one dips the Buses
// wired to the duck output (bottom).
export function DuckNode({ id, data }: NodeProps<DuckNodeT>): React.JSX.Element {
  const { updateNodeData } = useReactFlow()
  const ms = (s: number): string => (s < 1 ? `${Math.round(s * 1000)} ms` : `${s.toFixed(2)} s`)
  return (
    <div className="node duck-node">
      <Handle type="target" position={Position.Left} id="pattern" style={{ top: 40 }} />
      <Handle type="source" position={Position.Right} id="pattern" style={{ top: 40 }} />
      <Header title="Duck" />
      <div className="node-body bus-body nodrag">
        <ParamFader
          label="depth"
          value={data.depth}
          min={0}
          max={1}
          onChange={(depth) => updateNodeData(id, { depth })}
        />
        <ParamFader
          label="attack"
          display={ms(data.attack)}
          log
          value={data.attack}
          min={0.001}
          max={0.5}
          onChange={(attack) => updateNodeData(id, { attack })}
        />
        <ParamFader
          label="release"
          display={ms(data.release)}
          log
          value={data.release}
          min={0.01}
          max={2}
          onChange={(release) => updateNodeData(id, { release })}
        />
      </div>
      <Handle type="source" position={Position.Bottom} id="duck" className="duck-handle" />
    </div>
  )
}

// ---- Strum / Arp ----

// Plays the chords of the chain it's in note by note: Strum spreads each chord's
// notes across the start of its step, Arp plays them one at a time.
export function PerformNode({ id, data }: NodeProps<PerformNodeT>): React.JSX.Element {
  const { updateNodeData } = useReactFlow()
  const update = (patch: Partial<PerformNodeT['data']>): void => updateNodeData(id, patch)
  const pick = <T extends string>(
    options: [T, string][],
    value: T,
    set: (v: T) => void
  ): React.JSX.Element => (
    <div className="chord-row">
      {options.map(([v, label]) => (
        <button key={v} className={value === v ? 'on' : ''} onClick={() => set(v)}>
          {label}
        </button>
      ))}
    </div>
  )
  return (
    <div className="node perform-node">
      <Handle type="target" position={Position.Left} id="pattern" style={{ top: 40 }} />
      <Handle type="source" position={Position.Right} id="pattern" style={{ top: 40 }} />
      <Header title="Strum / Arp" />
      <div className="node-body chord-controls nodrag">
        {pick(
          [
            ['strum', 'Strum'],
            ['arp', 'Arp']
          ],
          data.mode,
          (mode) => update({ mode })
        )}
        {data.mode === 'arp' ? (
          <>
            {pick(
              [
                ['up', 'Up'],
                ['down', 'Down'],
                ['updown', 'Up-down'],
                ['random', 'Random']
              ],
              data.pattern,
              (pattern) => update({ pattern })
            )}
            {pick(
              [
                ['1', '1/16'],
                ['2', '1/8'],
                ['3', '3/16'],
                ['4', '1/4']
              ],
              String(data.rate) as '1' | '2' | '3' | '4',
              (r) => update({ rate: Number(r) })
            )}
          </>
        ) : (
          <>
            {pick(
              [
                ['up', 'Up'],
                ['down', 'Down']
              ],
              data.direction,
              (direction) => update({ direction })
            )}
            <div className="bus-body">
              <ParamFader
                label="spread"
                value={data.amount}
                min={0}
                max={0.5}
                onChange={(amount) => update({ amount })}
              />
            </div>
          </>
        )}
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
export function LfoNode({ id, data }: NodeProps<LfoNodeT>): React.JSX.Element {
  const { updateNodeData } = useReactFlow()
  const update = (patch: Partial<LfoNodeT['data']>): void => updateNodeData(id, patch)
  const ri = Math.max(0, LFO_RATES.indexOf(data.rate))
  return (
    <div className="node lfo-node">
      <Header title="LFO" />
      <div className="node-body">
        <div className="lfo-shapes nodrag">
          {LFO_SHAPES.map((sh) => (
            <button
              key={sh.id}
              className={data.shape === sh.id ? 'on' : ''}
              onClick={() => update({ shape: sh.id })}
            >
              {sh.label}
            </button>
          ))}
        </div>
        <svg className="lfo-wave" viewBox="0 0 120 32" preserveAspectRatio="none">
          <path d={wavePath(data.shape, 120, 32)} />
        </svg>
        <div className="lfo-rate nodrag">
          <button disabled={ri === 0} onClick={() => update({ rate: LFO_RATES[ri - 1] })}>
            −
          </button>
          <span>{lfoRateLabel(data.rate)}</span>
          <button
            disabled={ri === LFO_RATES.length - 1}
            onClick={() => update({ rate: LFO_RATES[ri + 1] })}
          >
            +
          </button>
        </div>
        <div className="bus-body nodrag">
          <ParamFader
            label="depth"
            value={data.depth}
            min={0}
            max={1}
            onChange={(depth) => update({ depth })}
          />
          <ParamFader
            label="phase"
            value={data.phase}
            min={0}
            max={1}
            onChange={(phase) => update({ phase })}
          />
        </div>
      </div>
      <ModInput param="rate" left={0.15} />
      <ModInput param="depth" left={0.35} />
      <Handle type="source" position={Position.Right} id="mod" className="mod-handle" />
    </div>
  )
}

// ---- Sequencer ----

const KIND_LABEL: Record<SequencerKind, string> = {
  degree: 'Notes (scale degrees)',
  slice: 'Slices (cut & rearrange)',
  chord: 'Chords'
}

// Chords rows: one chord type each (top: in key); Notes rows: scale degrees as roman
// numerals (VIII = the octave above I).
const CHORD_ROWS = CHORD_TYPES.map((_, i) => i)
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII']

// Voicing for every chord of a Chords node: inversion, spread and an added bass note.
function VoicingControls({
  id,
  data
}: {
  id: string
  data: SequencerNodeT['data']
}): React.JSX.Element {
  const { updateNodeData } = useReactFlow()
  return (
    <div className="chord-controls nodrag">
      <div className="chord-row">
        <button onClick={() => updateNodeData(id, { inversion: ((data.inversion ?? 0) + 1) % 4 })}>
          Inv {data.inversion ?? 0}
        </button>
        <button
          onClick={() =>
            updateNodeData(id, {
              spread: SPREADS[(SPREADS.indexOf(data.spread ?? 'close') + 1) % SPREADS.length]
            })
          }
        >
          {data.spread ?? 'close'}
        </button>
        <button
          className={data.bass ? 'on' : ''}
          onClick={() => updateNodeData(id, { bass: !data.bass })}
        >
          Bass
        </button>
      </div>
    </div>
  )
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
      case 'chord':
        return (
          <>
            <StepGrid
              steps={data.steps}
              rows={CHORD_ROWS}
              labels={CHORD_TYPES.map((t) => t.label)}
              onChange={(steps) => update({ steps })}
              timing={timing}
            />
            <VoicingControls id={id} data={data} />
          </>
        )
      case 'degree':
        return (
          <StepGrid
            steps={data.steps}
            rows={DEGREE_ROWS}
            labels={DEGREE_ROWS.map((d) => ROMAN[d - 1])}
            onChange={(steps) => update({ steps })}
            timing={timing}
            poly
          />
        )
      case 'slice': {
        // Show slices top-down from the highest, so the grid reads like a piano roll.
        const all = Array.from({ length: slices }, (_, i) => slices - 1 - i)
        const used = new Set(
          data.steps.map((v) => (v === null ? v : (cellNotes(v)[0] ?? 0) % slices))
        )
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
        {/* The right edge drags the step count. */}
        <div className="seq-main">{grid}</div>
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
    kind === 'key'
      ? TONICS[v]
      : kind === 'mode'
        ? MODES[v].label.replace(/ (.*)/, '')
        : octaveLabel(v)
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
