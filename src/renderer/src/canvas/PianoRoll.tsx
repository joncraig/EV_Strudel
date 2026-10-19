import { useEffect, useRef, useState } from 'react'
import type { Edge } from '@xyflow/react'
import StepGrid from './StepGrid'
import { useSounding, useStepLens } from './stepLens'
import { packSounds } from './packSounds'
import {
  CanvasNode,
  DEGREE_ROWS,
  downstream,
  sequencerSample,
  degreeName,
  isBank,
  KeyData,
  KeyNode,
  LENGTH_FULL_STEP,
  LengthNode,
  lengthLabel,
  ModeData,
  ModeNode,
  OCTAVES,
  octaveLabel,
  OctaveData,
  OctaveNode,
  DEFAULT_OCTAVE,
  MODES,
  TONICS,
  pieceCount,
  SequencerNode,
  Step,
  cellNotes,
  type Cell,
  VELOCITY_LEVELS,
  velocityDb,
  VelocityNode
} from './model'

// The selected sequencer's whole pattern, large, in the bottom panel: rows are named
// (pitches from the wired mode, file names for a bank), bar lines every 16 steps.
// It edits the same steps as the node.

interface Props {
  node: SequencerNode | VelocityNode | LengthNode | KeyNode | ModeNode | OctaveNode
  nodes: CanvasNode[]
  edges: Edge[]
  onSteps: (steps: Cell[]) => void
}

function PianoRoll({ node, nodes, edges, onSteps }: Props): React.JSX.Element {
  const sample = node.type === 'sequencer' ? sequencerSample(nodes, edges, node.id) : undefined
  const key =
    node.type === 'sequencer'
      ? (downstream(nodes, edges, node.id, 'key')?.data as KeyData | undefined)
      : undefined
  const mode =
    node.type === 'sequencer'
      ? (downstream(nodes, edges, node.id, 'mode')?.data as ModeData | undefined)
      : undefined

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
  if (node.type === 'key' || node.type === 'mode' || node.type === 'octave') {
    const names =
      node.type === 'key'
        ? [...TONICS]
        : node.type === 'mode'
          ? MODES.map((m) => m.label)
          : OCTAVES.map((o) => `octave ${octaveLabel(o)}`)
    const all = names.map((_, i) => names.length - 1 - i)
    const used = new Set(node.data.steps.filter((v) => v !== null))
    rows = node.data.folded && all.some((v) => used.has(v)) ? all.filter((v) => used.has(v)) : all
    labels = rows.map((v) => names[v])
    // Octave rows hold octave numbers, not indexes.
    if (node.type === 'octave') {
      const all2 = [...OCTAVES].reverse()
      const used2 = new Set(node.data.steps.filter((v) => v !== null))
      rows =
        node.data.folded && all2.some((v) => used2.has(v)) ? all2.filter((v) => used2.has(v)) : all2
      labels = rows.map((v) => `octave ${octaveLabel(v)}`)
    }
  } else if (node.type === 'velocity' || node.type === 'length') {
    rows = Array.from({ length: VELOCITY_LEVELS }, (_, i) => VELOCITY_LEVELS - i)
    labels = rows.map((v) => (node.type === 'length' ? lengthLabel(v) : `${velocityDb(v)} dB`))
    bars = node.type === 'velocity'
    if (node.type === 'length' && node.data.folded) {
      const used = new Set(node.data.steps)
      const keep = rows.map((v, i) => [v, labels[i]] as const).filter(([v]) => used.has(v))
      rows = keep.map(([v]) => v)
      labels = keep.map(([, l]) => l)
    }
  } else if (node.data.kind === 'degree') {
    // Named from the first key and mode set in the wired sequencers (C Ionian if none).
    const tonic = TONICS[key?.steps.find((v) => v !== null) ?? 0]
    const modeId = MODES[mode?.steps.find((v) => v !== null) ?? 0].id
    rows = DEGREE_ROWS
    const octave =
      ((downstream(nodes, edges, node.id, 'octave')?.data as OctaveData | undefined)?.steps.find(
        (v) => v !== null
      ) ?? 0) + (node.data.octave ?? DEFAULT_OCTAVE)
    labels = rows.map((d) => degreeName(d, tonic, modeId, octave))
  } else {
    const count = sample ? pieceCount(sample) : 8
    const all = Array.from({ length: count }, (_, i) => count - 1 - i)
    const used = new Set(
      node.data.steps.map((v) => (v === null ? v : (cellNotes(v)[0] ?? 0) % count))
    )
    rows = node.data.folded && all.some((v) => used.has(v)) ? all.filter((v) => used.has(v)) : all
    labels = rows.map((v) =>
      sample && isBank(sample) ? (files?.[v] ?? `file ${v}`) : `slice ${v + 1}`
    )
  }

  // Rows always fit the panel's height (it never scrolls vertically, only sideways for
  // long patterns): row height = available height / rows, thinner gaps when crowded.
  const boxRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const muted = node.type === 'sequencer' && node.data.muted
  const lens = useStepLens(node.id)
  const sounding = useSounding(node.id)
  return (
    <div
      className="piano-roll"
      ref={boxRef}
      style={(() => {
        const n = Math.max(1, rows.length)
        const gap = n > 20 ? 1 : 3
        // Leave room for a horizontal scrollbar.
        const rowH = Math.max(2, Math.min(26, Math.floor((height - 14 - gap * (n - 1)) / n)))
        return { ['--row-h' as string]: `${rowH}px`, ['--row-gap' as string]: `${gap}px` }
      })()}
    >
      <StepGrid
        steps={node.data.steps}
        rows={rows}
        labels={labels}
        bars={bars}
        noRests={node.type === 'velocity' || node.type === 'length'}
        roll
        poly={node.type === 'sequencer' && node.data.kind === 'degree'}
        timing={{ resolution: node.data.resolution, muted, lens, sounding }}
        onChange={(steps) =>
          onSteps(
            node.type === 'velocity'
              ? (steps as Step[]).map((v) => v ?? VELOCITY_LEVELS)
              : node.type === 'length'
                ? (steps as Step[]).map((v) => v ?? LENGTH_FULL_STEP)
                : steps
          )
        }
      />
    </div>
  )
}

export default PianoRoll
