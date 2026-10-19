// The Strudel engine, created once per window. Hot reloads re-run App.tsx and remount
// it; making a second AudioContext + repl then left the old scheduler playing into one
// context while superdough built nodes in the other ("different audio context" errors,
// no sound). The engine lives on a window global so every module copy shares it, and
// App only swaps the callbacks it receives.
import { evalScope } from '@strudel/core'
import { transpiler } from '@strudel/transpiler'
import { registerSynthSounds, setAudioContext, webaudioRepl } from '@strudel/webaudio'

type Repl = ReturnType<typeof webaudioRepl>

export interface EngineHandlers {
  onEvalError: (e: Error) => void
  onToggle: (started: boolean) => void
}

export interface Engine {
  repl: Repl
  ready: Promise<unknown>
  handlers: EngineHandlers
}

const KEY = '__evStrudelEngine'
type Holder = { [KEY]?: Engine }

export function getEngine(): Engine {
  const w = window as unknown as Holder
  if (w[KEY]) return w[KEY]
  const handlers: EngineHandlers = { onEvalError: () => {}, onToggle: () => {} }
  // 100ms render buffer. There's no live input, so latency is free to spend: the audio
  // thread runs heavily loaded (a size-4 reverb is a 6s convolution), and a bigger
  // buffer absorbs load peaks that overran Strudel's ~10ms default and dropped out.
  // The scheduler looks 0.5s ahead too (patches/@strudel+core: latency 0.1 -> 0.5).
  const audioContext = setAudioContext(new AudioContext({ latencyHint: 0.1 }))
  const repl = webaudioRepl({
    audioContext,
    transpiler,
    onEvalError: (e: Error) => engine.handlers.onEvalError(e),
    onToggle: (started: boolean) => engine.handlers.onToggle(started)
  })
  const ready = Promise.all([
    evalScope(import('@strudel/core'), import('@strudel/mini'), import('@strudel/tonal'), import('@strudel/webaudio')),
    registerSynthSounds()
  ])
  const engine: Engine = { repl, ready, handlers }
  w[KEY] = engine
  return engine
}
