import { useCallback, useRef, useState } from 'react'

// Undo/redo over serialized canvas snapshots.
//
// A burst of changes (a drag, a paint stroke, a fader move) is one step: the first
// change in a burst records the state from before it, and the burst ends after
// SETTLE_MS without changes. Changes that don't alter the serialized canvas (like
// selection) aren't recorded.

const SETTLE_MS = 400
const MAX_STEPS = 200

export interface History {
  // Call with the serialized canvas after every change.
  record: (serialized: string) => void
  // Return the snapshot to restore, or null when there's nothing to undo/redo.
  undo: () => string | null
  redo: () => string | null
  canUndo: boolean
  canRedo: boolean
}

export function useHistory(initial: string): History {
  const past = useRef<string[]>([])
  const future = useRef<string[]>([])
  const settled = useRef(initial) // state at the end of the last burst
  const latest = useRef(initial)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [counts, setCounts] = useState({ past: 0, future: 0 })
  const bump = (): void => setCounts({ past: past.current.length, future: future.current.length })

  const endBurst = (): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    settled.current = latest.current
  }

  const record = useCallback((s: string) => {
    if (s === latest.current) return
    if (!timer.current) {
      past.current.push(settled.current)
      if (past.current.length > MAX_STEPS) past.current.shift()
      future.current = []
      bump()
    } else clearTimeout(timer.current)
    latest.current = s
    timer.current = setTimeout(endBurst, SETTLE_MS)
  }, [])

  const undo = useCallback((): string | null => {
    endBurst()
    const prev = past.current.pop()
    if (prev === undefined) return null
    future.current.push(settled.current)
    settled.current = latest.current = prev
    bump()
    return prev
  }, [])

  const redo = useCallback((): string | null => {
    endBurst()
    const next = future.current.pop()
    if (next === undefined) return null
    past.current.push(settled.current)
    settled.current = latest.current = next
    bump()
    return next
  }, [])

  return { record, undo, redo, canUndo: counts.past > 0, canRedo: counts.future > 0 }
}
