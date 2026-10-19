import { useEffect, useRef } from 'react'
import { cellNotes, toCell, type Cell } from './model'
import { subscribeStep } from './playhead'
import { useNudge } from '../nudge'

interface Props {
  // One value per step; with poly, a step can hold several (a chord).
  steps: Cell[]
  // Row values top to bottom, and their labels.
  rows: number[]
  labels?: string[]
  onChange: (steps: Cell[]) => void
  // Pattern timing, for the playhead bar. Omit (or muted) for no playhead.
  // sounding: the node is on a chain that's heard, so the playing step's set cells flash.
  timing?: { resolution: number; muted?: boolean; lens?: number[] | null; sounding?: boolean }
  // Level bars: a cell is lit when its row is at or below the step's value, and a
  // step always has a value (no rests).
  bars?: boolean
  // Every step always has a value: tapping picks the row, never makes a rest.
  noRests?: boolean
  // Large piano-roll cells with bar lines (bottom panel).
  roll?: boolean
  // Chords: each cell toggles on its own, so a step can hold several rows (Notes).
  poly?: boolean
  // Told which step was pressed (Chords: the quality buttons act on it).
  onPress?: (i: number) => void
}

// Press a cell and slide across others to paint. The first cell decides the stroke:
// turning a cell on paints "on" (that row) along the way; turning one off erases.
// In bar mode every column touched takes the level under the pointer. With poly, a
// step keeps the notes it has: painting adds the row, erasing removes just that row.
function StepGrid({
  steps,
  rows,
  labels,
  onChange,
  timing,
  bars = false,
  roll = false,
  noRests = false,
  poly = false,
  onPress
}: Props): React.JSX.Element {
  // Latest steps for the stroke handlers, which outlive a render.
  const stepsRef = useRef(steps)
  useEffect(() => {
    stepsRef.current = steps
  }, [steps])

  // Up/Down arrows move the last painted step a row up or down the grid (Shift: 10);
  // a chord moves as a whole, keeping its shape, as far as the grid allows.
  const lastRef = useRef<number | null>(null)
  const touch = useNudge((n) => {
    const i = lastRef.current
    const cur = stepsRef.current
    if (i === null || i >= cur.length) return
    const at = cellNotes(cur[i]).map((v) => rows.indexOf(v))
    if (!at.length || at.some((r) => r < 0)) return
    const shift = Math.max(-Math.min(...at), Math.min(rows.length - 1 - Math.max(...at), -n))
    if (!shift) return
    const copy = [...cur]
    copy[i] = toCell(at.map((r) => rows[r + shift]))
    stepsRef.current = copy
    onChange(copy)
  })

  // The playhead is one bar moved over the playing column by direct style updates,
  // so the grid itself never re-renders while playing (re-rendering every cell each
  // step competed with the audio thread on the Surface and caused clicks).
  const gridRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const length = steps.length
  const resolution = timing?.resolution ?? 0
  const muted = !timing || timing.muted
  const lens = timing?.lens ?? null
  const lensKey = lens?.join(',') ?? ''
  const sounding = !!timing?.sounding
  useEffect(() => {
    const bar = barRef.current
    if (!bar) return
    if (muted) {
      bar.style.display = 'none'
      return
    }
    return subscribeStep(
      length,
      resolution,
      (step) => {
        const grid = gridRef.current
        grid?.querySelectorAll('.cell.hit').forEach((c) => c.classList.remove('hit'))
        if (sounding && step >= 0)
          grid
            ?.querySelectorAll(`.cell.on[data-i="${step}"]`)
            .forEach((c) => c.classList.add('hit'))
        const cell = grid?.querySelector<HTMLElement>(`.cell[data-i="${step}"]`)
        if (step < 0 || !cell) {
          bar.style.display = 'none'
          return
        }
        bar.style.display = 'block'
        bar.style.width = `${cell.offsetWidth}px`
        bar.style.transform = `translateX(${cell.offsetLeft}px)`
      },
      lens
    )
    // lensKey stands in for lens (a new array each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [length, resolution, muted, lensKey, sounding])

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
    const erase = !bars && !noRests && cellNotes(stepsRef.current[start.i]).includes(start.v)
    const { pointerId } = e
    touch()
    lastRef.current = start.i
    onPress?.(start.i)

    const apply = ({ i, v }: { i: number; v: number }): void => {
      const cur = stepsRef.current
      const notes = cellNotes(cur[i])
      const next: Cell = bars
        ? v
        : poly
          ? toCell(erase ? notes.filter((x) => x !== v) : [...notes, v])
          : erase
            ? cur[i] === v
              ? null
              : cur[i]
            : v
      if (JSON.stringify(cur[i]) === JSON.stringify(next)) return
      const copy = [...cur]
      copy[i] = next
      stepsRef.current = copy
      onChange(copy)
    }
    apply(start)

    const move = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId) return
      const hit = cellAt(ev.clientX, ev.clientY)
      if (hit) {
        lastRef.current = hit.i
        apply(hit)
      }
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
    <div
      className={`step-grid nodrag ${roll ? 'roll' : ''}`}
      ref={gridRef}
      onPointerDown={onPointerDown}
    >
      <div className="playhead-bar" ref={barRef} />
      {rows.map((v, r) => (
        <div className="grid-row" key={v}>
          <span className="row-label">{labels?.[r] ?? v}</span>
          {steps.map((s, i) => (
            <div
              key={i}
              data-i={i}
              data-v={v}
              className={`cell ${(bars ? typeof s === 'number' && v <= s : cellNotes(s).includes(v)) ? 'on' : ''} ${i % 4 === 0 ? 'beat' : ''} ${i % 16 === 0 ? 'barline' : ''}`}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

export default StepGrid
