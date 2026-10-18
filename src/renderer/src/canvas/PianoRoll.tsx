import { useEffect, useState } from 'react'
import type { Edge } from '@xyflow/react'
import StepGrid from './StepGrid'
import { packSounds } from './packSounds'
import {
  CanvasNode,
  DEGREE_ROWS,
  downstream,
  degreeName,
  isBank,
  KeyData,
  KeyNode,
  LENGTH_FULL_STEP,
  LengthNode,
  lengthLabel,
  ModeData,
  ModeNode,
  MODES,
  TONICS,
  pieceCount,
  SampleData,
  SequencerNode,
  Step,
  VELOCITY_LEVELS,
  VelocityNode
} from './model'

// The selected sequencer's whole pattern, large, in the bottom panel: rows are named
// (pitches from the wired mode, file names for a bank), bar lines every 16 steps.
// It edits the same steps as the node.

interface Props {
  node: SequencerNode | VelocityNode | LengthNode | KeyNode | ModeNode
  nodes: CanvasNode[]
  edges: Edge[]
  onSteps: (steps: Step[]) => void
}

function PianoRoll({ node, nodes, edges, onSteps }: Props): React.JSX.Element {
  const sample =
    node.type === 'sequencer' ? (downstream(nodes, edges, node.id, 'sample')?.data as SampleData | undefined) : undefined
  const key = node.type === 'sequencer' ? (downstream(nodes, edges, node.id, 'key')?.data as KeyData | undefined) : undefined
  const mode = node.type === 'sequencer' ? (downstream(nodes, edges, node.id, 'mode')?.data as ModeData | undefined) : undefined

  // File names for a bank, loaded from the pack's sound list.
  const [files, setFiles] = useState<string[] | null>(null)
  useEffect(() => {
    if (!sample?.pack || !isBank(sample)) return
    let live = true
    packSounds(sample.pack)
      .then((all) => live && setFiles(all[sample.s]?.variants ?? null))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [sample?.pack, sample?.s, sample?.files])

  let rows: number[]
  let labels: string[]
  let bars = false
  if (node.type === 'key' || node.type === 'mode') {
    const names = node.type === 'key' ? [...TONICS] : MODES.map((m) => m.label)
    const all = names.map((_, i) => names.length - 1 - i)
    const used = new Set(node.data.steps.filter((v) => v !== null))
    rows = node.data.folded ? all.filter((v) => used.has(v)) : all
    labels = rows.map((v) => names[v])
  } else if (node.type === 'velocity' || node.type === 'length') {
    rows = Array.from({ length: VELOCITY_LEVELS }, (_, i) => VELOCITY_LEVELS - i)
    labels = rows.map((v) =>
      node.type === 'length' ? lengthLabel(v) : `${Math.round((v / VELOCITY_LEVELS) * 100)}%`
    )
    bars = true
  } else if (node.data.kind === 'degree') {
    // Named from the first key and mode set in the wired sequencers (C Ionian if none).
    const tonic = TONICS[key?.steps.find((v) => v !== null) ?? 0]
    const modeId = MODES[mode?.steps.find((v) => v !== null) ?? 0].id
    rows = DEGREE_ROWS
    labels = rows.map((d) => degreeName(d, tonic, modeId, node.data.octave))
  } else if (node.data.kind === 'trigger') {
    rows = [1]
    labels = [sample?.label ?? sample?.s ?? 'hit']
  } else {
    const count = sample ? pieceCount(sample) : 8
    const all = Array.from({ length: count }, (_, i) => count - 1 - i)
    const used = new Set(node.data.steps.map((v) => (v === null ? v : v % count)))
    rows = node.data.folded ? all.filter((v) => used.has(v)) : all
    labels = rows.map((v) => (sample && isBank(sample) ? (files?.[v] ?? `file ${v}`) : `slice ${v + 1}`))
  }

  const muted = node.type === 'sequencer' && node.data.muted
  return (
    <div className="piano-roll">
      {rows.length ? (
        <StepGrid
          steps={node.data.steps}
          rows={rows}
          labels={labels}
          bars={bars}
          roll
          timing={{ resolution: node.data.resolution, muted }}
          onChange={(steps) =>
            onSteps(
              node.type === 'velocity'
                ? steps.map((v) => v ?? VELOCITY_LEVELS)
                : node.type === 'length'
                  ? steps.map((v) => v ?? LENGTH_FULL_STEP)
                  : steps
            )
          }
        />
      ) : (
        <div className="hint">Nothing placed yet. Turn Fold off to pick slices.</div>
      )}
    </div>
  )
}

export default PianoRoll
