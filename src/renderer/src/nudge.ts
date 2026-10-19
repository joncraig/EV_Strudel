// Up/Down arrows nudge the value that was last touched (a fader, the step pill, a
// panel slider, the tempo). A control calls useNudge with how to step itself; the hook
// returns `touch`, which the control calls when it's pressed to become the target.
// Shift steps ten times as far.

import { useEffect, useId, useRef } from 'react'

// Gets the number of notches to move: +1/-1, or +10/-10 with Shift.
type Step = (notches: number) => void

let activeId: string | null = null
const steppers = new Map<string, React.MutableRefObject<Step>>()

export function useNudge(step: Step): () => void {
  const id = useId()
  const ref = useRef(step)
  ref.current = step // always the latest value
  useEffect(() => {
    steppers.set(id, ref)
    return () => {
      steppers.delete(id)
      if (activeId === id) activeId = null
    }
  }, [id])
  return () => {
    activeId = id
  }
}

export function installNudgeKeys(): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if ((e.target as HTMLElement).closest?.('input, textarea, select, .context-menu')) return
    const step = activeId && steppers.get(activeId)?.current
    if (!step) return
    e.preventDefault()
    e.stopPropagation() // React Flow would move the selected nodes
    step((e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1))
  }
  // One listener per window: a hot reload re-runs this, and two listeners would step
  // twice per press.
  const w = window as unknown as { __evNudgeKeys?: (e: KeyboardEvent) => void }
  if (w.__evNudgeKeys) window.removeEventListener('keydown', w.__evNudgeKeys, true)
  w.__evNudgeKeys = onKey
  window.addEventListener('keydown', onKey, true)
  return () => window.removeEventListener('keydown', onKey, true)
}
