import { useStore } from '@xyflow/react'

// Width of one grid column on screen at zoom 1: a 16px cell plus its 2px gap.
export const CELL_PX = 18

// Drag a pointer and report movement in canvas units (screen px / zoom).
function dragCanvas(e: React.PointerEvent, zoom: number, onMove: (dx: number, dy: number) => void): void {
  e.preventDefault()
  e.stopPropagation()
  const { pointerId, clientX: x0, clientY: y0 } = e
  const move = (ev: PointerEvent): void => {
    if (ev.pointerId === pointerId) onMove((ev.clientX - x0) / zoom, (ev.clientY - y0) / zoom)
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

const useZoom = (): number => useStore((s) => s.transform[2])

// The node's right edge: drag it to change how many steps (columns) there are.
export function StepWidthGrip({
  steps,
  min = 1,
  max = 32,
  onChange
}: {
  steps: number
  min?: number
  max?: number
  onChange: (steps: number) => void
}): React.JSX.Element {
  const zoom = useZoom()
  return (
    <div
      className="width-grip nodrag"
      title={`${steps} steps: drag to change`}
      onPointerDown={(e) => {
        const start = steps
        let last = start
        dragCanvas(e, zoom, (dx) => {
          const next = Math.min(max, Math.max(min, start + Math.round(dx / CELL_PX)))
          if (next !== last) {
            last = next
            onChange(next)
          }
        })
      }}
    >
      <span>{steps}</span>
    </div>
  )
}

// A vertical fader: drag up for more. Tap anywhere on it to jump there.
export function Fader({
  value,
  max,
  onChange,
  label
}: {
  value: number
  max: number
  onChange: (v: number) => void
  label: string
}): React.JSX.Element {
  const zoom = useZoom()
  const set = (v: number): void => onChange(+Math.min(max, Math.max(0, v)).toFixed(2))
  return (
    <div
      className="fader nodrag"
      title={`${label} ${value.toFixed(2)}`}
      onPointerDown={(e) => {
        const track = e.currentTarget.getBoundingClientRect()
        // Jump to where the track was touched, then follow the drag.
        const fromY = (clientY: number): number => ((track.bottom - clientY) / track.height) * max
        const start = fromY(e.clientY)
        set(start)
        dragCanvas(e, zoom, (_dx, dy) => set(start - ((dy * zoom) / track.height) * max))
      }}
    >
      <div className="fader-fill" style={{ height: `${(value / max) * 100}%` }} />
    </div>
  )
}
