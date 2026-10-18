// Value drags (faders, the length pill, tempo) that aren't stopped by the window or
// screen edges. With a mouse or trackpad the drag takes a Pointer Lock: the cursor
// hides and raw movement keeps coming however far you go; it reappears where you
// grabbed. Touch and pen have no edges to hit, so they track the pointer as usual.
//
// Pointer Lock gotchas (compendium: pointer-lock-drag): it can only be requested from
// a user gesture such as pointerdown; a lock granted after a fast click must be released;
// each drag only reacts to its own lock.

// onMove gets the total movement since the press, in screen pixels.
export function valueDrag(
  e: React.PointerEvent,
  onMove: (dx: number, dy: number) => void,
  onEnd?: () => void
): void {
  e.preventDefault()
  e.stopPropagation()
  const target = e.currentTarget as HTMLElement
  const { pointerId, clientX: x0, clientY: y0 } = e

  if (e.pointerType !== 'mouse') {
    const move = (ev: PointerEvent): void => {
      if (ev.pointerId === pointerId) onMove(ev.clientX - x0, ev.clientY - y0)
    }
    const up = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId) return
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      onEnd?.()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return
  }

  let dx = 0
  let dy = 0
  let ended = false
  const move = (ev: MouseEvent): void => {
    // Locked: movementX/Y are raw deltas, not limited by the edges.
    dx += ev.movementX
    dy += ev.movementY
    onMove(dx, dy)
  }
  const finish = (): void => {
    if (ended) return
    ended = true
    document.removeEventListener('mousemove', move)
    document.removeEventListener('mouseup', finish)
    document.removeEventListener('pointerlockchange', onLockChange)
    if (document.pointerLockElement === target) document.exitPointerLock()
    onEnd?.()
  }
  const onLockChange = (): void => {
    // Lost the lock (Escape, focus change): end the drag. Only our own lock counts.
    if (document.pointerLockElement !== target) finish()
  }
  document.addEventListener('mousemove', move)
  document.addEventListener('mouseup', finish)
  try {
    const p = target.requestPointerLock() as unknown as Promise<void> | undefined
    p?.then(
      () => {
        // A fast click can end the drag before the lock arrives: give it straight back.
        if (ended) document.exitPointerLock()
        else document.addEventListener('pointerlockchange', onLockChange)
      },
      () => {
        // Lock refused: still works, just bounded by the window like a normal drag.
      }
    )
  } catch {
    // Older API without a promise; the drag still works without the lock.
  }
}
