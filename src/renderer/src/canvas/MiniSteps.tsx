import { useEffect, useRef } from 'react'
import { cellNotes, type Cell } from './model'
import { subscribeStep } from './playhead'

// A node's steps at a glance, read-only (editing is in the bottom panel): one thin
// column per step in a fixed-width strip, each note a dot at its row's height (or a
// level bar). The playing column is marked by direct DOM updates, like StepGrid.
function MiniSteps({
  steps,
  rows,
  bars = false,
  timing
}: {
  steps: Cell[]
  // Row values top to bottom (a note's height in the strip).
  rows: number[]
  bars?: boolean
  timing?: { resolution: number; muted?: boolean; lens?: number[] | null; sounding?: boolean }
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const length = steps.length
  const resolution = timing?.resolution ?? 0
  const muted = !timing || timing.muted
  const lens = timing?.lens ?? null
  const lensKey = lens?.join(',') ?? ''
  const sounding = !!timing?.sounding
  useEffect(() => {
    const el = ref.current
    if (!el || muted) return
    return subscribeStep(
      length,
      resolution,
      (step) => {
        el.querySelectorAll('.now').forEach((c) => c.classList.remove('now', 'hit'))
        const col = step >= 0 ? el.children[step] : null
        col?.classList.add('now')
        if (sounding && col?.childElementCount) col.classList.add('hit')
      },
      lens
    )
    // lensKey stands in for lens (a new array each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [length, resolution, muted, lensKey, sounding])

  const span = Math.max(1, rows.length - 1)
  const y = (v: number): number => {
    const r = rows.indexOf(v)
    return r < 0 ? 50 : (r / span) * 100
  }
  return (
    <div className="mini-steps" ref={ref}>
      {steps.map((c, i) => (
        <div key={i} className={`mini-col ${i % 16 === 0 ? 'bar' : ''}`}>
          {bars
            ? typeof c === 'number' && <div className="mini-bar" style={{ top: `${y(c)}%` }} />
            : cellNotes(c).map((v) => <div key={v} className="mini-dot" style={{ top: `${y(v)}%` }} />)}
        </div>
      ))}
    </div>
  )
}

export default MiniSteps
