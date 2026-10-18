// The playhead, as an external store: it changes every frame, so it stays out of
// React state. Components subscribe with a selector and only re-render when the
// selected value (a step index) changes.

import { useSyncExternalStore } from 'react'

// Current cycle position, or -1 when stopped.
let cycle = -1
const listeners = new Set<() => void>()

export function setPlayhead(c: number): void {
  cycle = c
  listeners.forEach((l) => l())
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

// Which of `length` steps is playing (steps fill one cycle), or -1 when stopped.
export function useStepIndex(length: number): number {
  return useSyncExternalStore(subscribe, () =>
    cycle < 0 || length <= 0 ? -1 : Math.floor((cycle - Math.floor(cycle)) * length)
  )
}

// Which mode step is active, or -1 when stopped.
export function useModeIndex(steps: number, cyclesPerStep: number): number {
  return useSyncExternalStore(subscribe, () =>
    cycle < 0 || steps <= 0 ? -1 : Math.floor(cycle / Math.max(1, cyclesPerStep)) % steps
  )
}


// Any value derived from the cycle; re-renders only when the derived value changes.
export function usePlayhead<T>(select: (cycle: number) => T): T {
  return useSyncExternalStore(subscribe, () => select(cycle))
}
