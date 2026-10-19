// Dragging sounds from the Samples tab onto the canvas with pointer events.
// HTML5 drag-and-drop doesn't start from touch in Chromium on Windows, so this
// works the same for touch, pen and mouse.

import type { DraggedSound } from './model'

export const SOUND_DROP_EVENT = 'ev-sound-drop'

export interface SoundDropDetail {
  sound: DraggedSound
  // Screen point of the drop, or null for "add it somewhere visible" (tap to add).
  point: { x: number; y: number } | null
}

const DRAG_THRESHOLD = 8

function emit(detail: SoundDropDetail): void {
  window.dispatchEvent(new CustomEvent<SoundDropDetail>(SOUND_DROP_EVENT, { detail }))
}

export const addSound = (sound: DraggedSound): void => emit({ sound, point: null })

// Set while a drag is in progress or just ended, so the row's click (play) can be skipped.
let dragging = false
export const wasDragging = (): boolean => dragging

/**
 * Call from onPointerDown.
 * - axis 'any': drags in every direction. The element needs `touch-action: none`.
 * - axis 'x': only a mostly-horizontal move starts a drag, so vertical swipes keep
 *   scrolling the list. The element needs `touch-action: pan-y`.
 */
export function startSoundDrag(
  e: React.PointerEvent,
  sound: DraggedSound,
  axis: 'any' | 'x' = 'any'
): void {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  const target = e.currentTarget as HTMLElement
  const { pointerId } = e
  const startX = e.clientX
  const startY = e.clientY
  let ghost: HTMLDivElement | null = null

  const move = (ev: PointerEvent): void => {
    if (ev.pointerId !== pointerId) return
    if (!ghost) {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      if (axis === 'x' && Math.abs(dx) < Math.abs(dy)) return cleanup()
      ghost = document.createElement('div')
      ghost.className = 'drag-ghost'
      ghost.textContent = sound.s
      document.body.appendChild(ghost)
      dragging = true
      try {
        target.setPointerCapture(pointerId)
      } catch {
        // Capture is a nicety; window listeners still see the events.
      }
    }
    ev.preventDefault()
    ghost.style.transform = `translate(${ev.clientX - 20}px, ${ev.clientY - 44}px)`
  }

  const end = (ev: PointerEvent): void => {
    if (ev.pointerId !== pointerId) return
    const dropped = ghost && ev.type === 'pointerup'
    cleanup()
    if (dropped) emit({ sound, point: { x: ev.clientX, y: ev.clientY } })
  }

  function cleanup(): void {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    ghost?.remove()
    ghost = null
    // Let the click that follows pointerup see the flag, then clear it.
    setTimeout(() => (dragging = false), 0)
  }

  window.addEventListener('pointermove', move, { passive: false })
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
}
