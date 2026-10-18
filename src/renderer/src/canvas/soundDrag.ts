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

const DRAG_THRESHOLD = 6

function emit(detail: SoundDropDetail): void {
  window.dispatchEvent(new CustomEvent<SoundDropDetail>(SOUND_DROP_EVENT, { detail }))
}

export const addSound = (sound: DraggedSound): void => emit({ sound, point: null })

// Call from onPointerDown on the drag handle (which needs `touch-action: none`).
export function startSoundDrag(e: React.PointerEvent, sound: DraggedSound): void {
  if (e.button !== 0) return
  e.preventDefault()
  const startX = e.clientX
  const startY = e.clientY
  let ghost: HTMLDivElement | null = null

  const move = (ev: PointerEvent): void => {
    if (ev.pointerId !== e.pointerId) return
    if (!ghost) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return
      ghost = document.createElement('div')
      ghost.className = 'drag-ghost'
      ghost.textContent = sound.s
      document.body.appendChild(ghost)
    }
    ghost.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY - 14}px)`
  }

  const end = (ev: PointerEvent): void => {
    if (ev.pointerId !== e.pointerId) return
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', end)
    window.removeEventListener('pointercancel', end)
    if (!ghost) return
    ghost.remove()
    if (ev.type === 'pointerup') emit({ sound, point: { x: ev.clientX, y: ev.clientY } })
  }

  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', end)
  window.addEventListener('pointercancel', end)
}
