import { useEffect, useRef } from 'react'
import type { Step } from './model'
import { subscribeStep } from './playhead'

interface Props {
  steps: Step[]
  // Row values top to bottom, and their labels.
  rows: number[]
  labels?: string[]
  onChange: (steps: Step[]) => void
  // Pattern timing, for the playhead bar. Omit (or muted) for no playhead.
  timing?: { resolution: number; muted?: boolean }
  // Level bars: a cell is lit when its row is at or below the step's value, and a
  // step always has a value (no rests).
  bars?: boolean
}

// Press a cell and slide across others to paint. The first cell decides the stroke:
// turning a cell on paints "on" (that row) along the way; turning one off erases.
// In bar mode every column touched takes the level under the pointer.
function StepGrid({ steps, rows, labels, onChange, timing, bars = false }: Props): React.JSX.Element {
  // Latest steps for the stroke handlers, which outlive a render.
  const stepsRef = useRef(steps)
  useEffect(() => {
    stepsRef.current = steps
  }, [steps])

  // The playhead is one bar moved over the playing column by direct style updates,
  // so the grid itself never re-renders while playing (re-rendering every cell each
  // step competed with the audio thread on the Surface and caused clicks).
  const gridRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const length = steps.length
  const resolution = timing?.resolution ?? 0
  const muted = !timing || timing.muted
  useEffect(() => {
    const bar = barRef.current
    if (!bar) return
    if (muted) {
      bar.style.display = 'none'
      return
    }
    return subscribeStep(length, resolution, (step) => {
      const cell = gridRef.current?.querySelector<HTMLElement>(`.cell[data-i="${step}"]`)
      if (step < 0 || !cell) {
        bar.style.display = 'none'
        return
      }
      bar.style.display = 'block'
      bar.style.transform = `translateX(${cell.offsetLeft}px)`
    })
  }, [length, resolution, muted])

  const cellAt = (x: number, y: number): { i: number; v: number } | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null
    const cell = el?.closest<HTMLElement>('.cell')
    if (!cell?.dataset.i) return null
    return { i: Number(cell.dataset.i), v: Number(cell.dataset.v) }
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    const start = cellAt(e.clientX, e.clientY)
    if (!start) return
    e.preventDefault()
    e.stopPropagation()
    const erase = !bars && stepsRef.current[start.i] === start.v
    const { pointerId } = e

    const apply = ({ i, v }: { i: number; v: number }): void => {
      const cur = stepsRef.current
      const next = bars ? v : erase ? (cur[i] === v ? null : cur[i]) : v
      if (cur[i] === next) return
      const copy = [...cur]
      copy[i] = next
      stepsRef.current = copy
      onChange(copy)
    }
    apply(start)

    const move = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId) return
      const hit = cellAt(ev.clientX, ev.clientY)
      if (hit) apply(hit)
    }
    const up = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId) return
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  return (
    <div className="step-grid nodrag" ref={gridRef} onPointerDown={onPointerDown}>
      <div className="playhead-bar" ref={barRef} />
      {rows.map((v, r) => (
        <div className="grid-row" key={v}>
          <span className="row-label">{labels?.[r] ?? v}</span>
          {steps.map((s, i) => (
            <div
              key={i}
              data-i={i}
              data-v={v}
              className={`cell ${(bars ? s !== null && v <= s : s === v) ? 'on' : ''} ${i % 4 === 0 ? 'beat' : ''}`}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

export default StepGrid
