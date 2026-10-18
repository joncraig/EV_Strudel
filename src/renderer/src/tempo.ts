// A bar (one Strudel cycle) is 4 beats, so cycles per second = BPM / 240;
// Strudel's default 0.5 cps is 120 BPM.

export const DEFAULT_BPM = 120
export const MIN_BPM = 20
export const MAX_BPM = 300
export const bpmToCps = (bpm: number): number => bpm / 240
