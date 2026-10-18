import { createContext, useContext } from 'react'
import type { Lens } from './codegen'

// Step lengths (in 1/16 steps) each stepping node plays at, from compile(), so its
// playhead moves at the held Length rather than every 1/16.
export const StepLensContext = createContext<Map<string, Lens>>(new Map())

export const useStepLens = (id: string): Lens => useContext(StepLensContext).get(id) ?? null
