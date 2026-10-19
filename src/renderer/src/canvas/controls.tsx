import { valueDrag } from '../drag'
import { useNudge } from '../nudge'

// Width of one grid column on screen at zoom 1: a 16px cell plus its 2px gap.
export const CELL_PX = 18

// Drag and report movement in canvas units (screen px / zoom). Uses a pointer lock with
// a mouse, so the drag isn't stopped at the window or screen edge (see ../drag.ts).
function dragCanvas(
  e: React.PointerEvent,
  zoom: number,
  onMove: (dx: number, dy: number) => void
): void {
  valueDrag(e, (dx, dy) => onMove(dx / zoom, dy / zoom))
}

// Controls are drawn at their real size now (no zoomable canvas).
const useZoom = (): number => 1

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
  const touch = useNudge((n) => {
    const next = Math.min(max, Math.max(min, steps + n))
    if (next !== steps) onChange(next)
  })
  return (
    <div
      className="width-grip nodrag"
      title={`length ${steps} steps: drag to change`}
      onPointerDown={(e) => {
        touch()
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
  label,
  display
}: {
  value: number
  max: number
  onChange: (v: number) => void
  label: string
  // Shown on hover instead of the raw value.
  display?: string
}): React.JSX.Element {
  const zoom = useZoom()
  const set = (v: number): void => onChange(+Math.min(max, Math.max(0, v)).toFixed(2))
  // One notch = 1% of the travel.
  const touch = useNudge((n) => set(value + (n * max) / 100))
  return (
    <div
      className="fader nodrag"
      title={`${label} ${display ?? value.toFixed(2)}`}
      onPointerDown={(e) => {
        touch()
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

// Fader for a value in [min, max]; log scale moves evenly through octaves.
export function ParamFader({
  value,
  min,
  max,
  log,
  label,
  display,
  onChange
}: {
  value: number
  min: number
  max: number
  log?: boolean
  label: string
  // Shown instead of the number (e.g. dB).
  display?: string
  onChange: (v: number) => void
}): React.JSX.Element {
  const toT = (v: number): number =>
    log ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min)
  const fromT = (p: number): number => (log ? min * Math.pow(max / min, p) : min + p * (max - min))
  const shown =
    display ??
    (value >= 1000
      ? `${(value / 1000).toFixed(1)}k`
      : value >= 100
        ? value.toFixed(0)
        : value.toFixed(2))
  return (
    <div className="param">
      <span className="param-value">{shown}</span>
      <Fader
        label={label}
        display={shown}
        value={toT(value)}
        max={1}
        onChange={(p) => onChange(fromT(p))}
      />
      <span className="param-label">{label}</span>
    </div>
  )
}
