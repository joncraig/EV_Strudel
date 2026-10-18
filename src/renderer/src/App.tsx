import { useEffect, useRef } from 'react'
import { evalScope } from '@strudel/core'
import { transpiler } from '@strudel/transpiler'
import {
  getAudioContext,
  initAudioOnFirstClick,
  registerSynthSounds,
  samples,
  webaudioOutput
} from '@strudel/webaudio'
import { StrudelMirror } from '@strudel/codemirror'

const initialCode = `note("<c3 eb3 g3 bb3>*2").s("sawtooth").lpf(sine.range(400, 2000).slow(4))`

function App(): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const mirrorRef = useRef<any>(null)

  useEffect(() => {
    if (!rootRef.current || mirrorRef.current) return
    mirrorRef.current = new StrudelMirror({
      root: rootRef.current,
      initialCode,
      defaultOutput: webaudioOutput,
      getTime: () => getAudioContext().currentTime,
      transpiler,
      prebake: async () => {
        initAudioOnFirstClick()
        await Promise.all([
          evalScope(
            import('@strudel/core'),
            import('@strudel/mini'),
            import('@strudel/tonal'),
            import('@strudel/webaudio'),
            import('@strudel/codemirror')
          ),
          registerSynthSounds(),
          samples('github:tidalcycles/dirt-samples')
        ])
      }
    })
  }, [])

  return (
    <div className="app">
      <div className="toolbar">
        <button onClick={() => mirrorRef.current?.evaluate()}>Play (Ctrl+Enter)</button>
        <button onClick={() => mirrorRef.current?.stop()}>Stop (Ctrl+.)</button>
      </div>
      <div className="editor" ref={rootRef} />
    </div>
  )
}

export default App
