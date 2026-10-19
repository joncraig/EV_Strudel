// The playhead, as an external store: it changes every frame, so it stays out of
// React state. Components subscribe with a selector and only re-render when the
// selected value (a step index) changes.

import { useSyncExternalStore } from 'react'
import { stepAt, stepAtLens } from './model'

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

// Which step is playing (fixed step size, see stepAt), or -1 when stopped.
export function useStepIndex(length: number, resolution: number): number {
  return useSyncExternalStore(subscribe, () =>
    cycle < 0 ? -1 : stepAt(cycle, length, resolution || length)
  )
}

// Any value derived from the cycle; re-renders only when the derived value changes.
export function usePlayhead<T>(select: (cycle: number) => T): T {
  return useSyncExternalStore(subscribe, () => select(cycle))
}

// Outside React: call `onStep` only when the playing step changes (-1 when stopped).
// For per-frame visuals that update the DOM directly instead of re-rendering.
export function subscribeStep(
  length: number,
  resolution: number,
  onStep: (step: number) => void,
  lens: number[] | null = null
): () => void {
  let last = Number.NaN
  const check = (): void => {
    const step =
      cycle < 0
        ? -1
        : lens?.length
          ? stepAtLens(cycle, length, lens)
          : stepAt(cycle, length, resolution || length)
    if (step !== last) {
      last = step
      onStep(step)
    }
  }
  check()
  return subscribe(check)
}
