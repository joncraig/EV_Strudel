// Play/stop and tempo.

import { MAX_BPM, MIN_BPM } from '../tempo'
import { valueDrag } from '../drag'

interface Props {
  playing: boolean
  bpm: number
  onPlay: () => void
  onStop: () => void
  onBpm: (bpm: number) => void
}

const clamp = (v: number): number => Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(v)))

function Transport({ playing, bpm, onPlay, onStop, onBpm }: Props): React.JSX.Element {
  // Drag the number up/down (or sideways) to change tempo: 1 BPM per 4px. A mouse drag
  // isn't stopped at the screen edge (pointer lock, see ../drag.ts).
  const onDragTempo = (e: React.PointerEvent): void => {
    const start = bpm
    valueDrag(e, (dx, dy) => onBpm(clamp(start + (dx - dy) / 4)))
  }

  return (
    <div className="transport">
      {playing ? (
        <button className="play on" onClick={onStop}>
          ■
        </button>
      ) : (
        <button className="play" onClick={onPlay}>
          ▶
        </button>
      )}
      <div className="tempo">
        <button onClick={() => onBpm(clamp(bpm - 1))}>−</button>
        <span className="bpm" title="Drag to change tempo" onPointerDown={onDragTempo}>
          {bpm}
          <small>BPM</small>
        </span>
        <button onClick={() => onBpm(clamp(bpm + 1))}>+</button>
      </div>
    </div>
  )
}

export default Transport
