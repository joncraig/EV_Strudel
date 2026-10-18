// Play/stop and tempo.

import { MAX_BPM, MIN_BPM } from '../tempo'

interface Props {
  playing: boolean
  bpm: number
  onPlay: () => void
  onStop: () => void
  onBpm: (bpm: number) => void
}

const clamp = (v: number): number => Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(v)))

function Transport({ playing, bpm, onPlay, onStop, onBpm }: Props): React.JSX.Element {
  // Drag the number up/down (or sideways) to change tempo: 1 BPM per 4px.
  const onDragTempo = (e: React.PointerEvent): void => {
    e.preventDefault()
    const { pointerId, clientX: x0, clientY: y0 } = e
    const start = bpm
    const move = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId) return
      onBpm(clamp(start + (ev.clientX - x0 - (ev.clientY - y0)) / 4))
    }
    const up = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId) return
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
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
