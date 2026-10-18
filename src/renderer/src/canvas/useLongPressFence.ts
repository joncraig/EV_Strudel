import { useEffect, useRef, useState } from 'react'

// Long-press on empty canvas, then drag, to fence-select. A drag that starts moving
// before the long-press fires stays a pan (React Flow's default).
//
// React Flow's pan is driven by d3-zoom, which starts listening on pointer down. Once
// the fence is active we stop move events in the capture phase on window, so d3 never
// sees them; the up/end events go through so d3 finishes its (motionless) gesture.

const HOLD_MS = 450
const MOVE_TOLERANCE = 8

export interface Fence {
  // Screen coordinates.
  x0: number
  y0: number
  x1: number
  y1: number
  // Top-left of the canvas element on screen, for drawing the fence inside it.
  ox: number
  oy: number
}

export function useLongPressFence(
  root: React.RefObject<HTMLElement | null>,
  onSelect: (fence: Fence) => void
): { fence: Fence | null; suppressClick: () => boolean } {
  const [fence, setFence] = useState<Fence | null>(null)
  const onSelectRef = useRef(onSelect)
  const suppressRef = useRef(false)

  useEffect(() => {
    onSelectRef.current = onSelect
  })

  useEffect(() => {
    const el = root.current
    if (!el) return

    const onDown = (e: PointerEvent): void => {
      if (!(e.target as HTMLElement).classList.contains('react-flow__pane')) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const { pointerId } = e
      const start = { x: e.clientX, y: e.clientY }
      let current: Fence | null = null

      const timer = setTimeout(() => {
        const r = el.getBoundingClientRect()
        current = { x0: start.x, y0: start.y, x1: start.x, y1: start.y, ox: r.left, oy: r.top }
        setFence(current)
        window.addEventListener('pointermove', block, true)
        window.addEventListener('touchmove', block, { capture: true, passive: false })
        window.addEventListener('mousemove', block, true)
      }, HOLD_MS)

      // Before the fence: moving cancels the long-press (it's a pan).
      const earlyMove = (ev: PointerEvent): void => {
        if (ev.pointerId !== pointerId || current) return
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > MOVE_TOLERANCE) cleanup()
      }

      // During the fence: track the pointer and keep the move from d3-zoom.
      const block = (ev: Event): void => {
        ev.stopPropagation()
        if (ev.cancelable) ev.preventDefault()
        if (ev instanceof PointerEvent && ev.pointerId === pointerId && current) {
          current = { ...current, x1: ev.clientX, y1: ev.clientY }
          setFence(current)
        }
      }

      const end = (ev: PointerEvent): void => {
        if (ev.pointerId !== pointerId) return
        const done = current
        cleanup()
        if (done && ev.type === 'pointerup') {
          // The click that follows this pointerup shouldn't open the add menu.
          suppressRef.current = true
          setTimeout(() => (suppressRef.current = false), 0)
          onSelectRef.current(done)
        }
      }

      function cleanup(): void {
        clearTimeout(timer)
        window.removeEventListener('pointermove', earlyMove)
        window.removeEventListener('pointerup', end)
        window.removeEventListener('pointercancel', end)
        window.removeEventListener('pointermove', block, true)
        window.removeEventListener('touchmove', block, true)
        window.removeEventListener('mousemove', block, true)
        current = null
        setFence(null)
      }

      window.addEventListener('pointermove', earlyMove)
      window.addEventListener('pointerup', end)
      window.addEventListener('pointercancel', end)
    }

    el.addEventListener('pointerdown', onDown)
    return () => el.removeEventListener('pointerdown', onDown)
  }, [root])

  return { fence, suppressClick: () => suppressRef.current }
}
