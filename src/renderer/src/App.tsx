import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { evalScope } from '@strudel/core'
import { transpiler } from '@strudel/transpiler'
import { getAudioContext, initAudio, registerSynthSounds, samples, superdough, webaudioRepl } from '@strudel/webaudio'
import Library from './components/Library'
import Samples from './components/Samples'
import Canvas from './canvas/Canvas'
import { compile } from './canvas/codegen'
import type { CanvasState, DraggedSound } from './canvas/model'
import type { PatchSummary } from '../../shared/patch'

interface Current {
  file: string | null
  title: string
  tags: string
  source?: string
  // What was last saved/opened, to tell whether there are unsaved changes.
  savedCanvas: string
  // Set when the open patch is plain code with no canvas: it plays as-is.
  codeOnly?: string
}

const EMPTY: CanvasState = { nodes: [], edges: [] }
const PINNED_KEY = 'ev-strudel:auto-load-packs'
const AUTOSAVE_KEY = 'ev-strudel:canvas-autosave'

function readPinned(): Set<string> {
  try {
    const raw = localStorage.getItem(PINNED_KEY)
    if (raw) return new Set(JSON.parse(raw))
  } catch {
    // Fall through to the default.
  }
  return new Set(['dirt-samples'])
}

function readAutosave(): CanvasState {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    // Start empty.
  }
  return EMPTY
}

const serialize = (s: CanvasState): string =>
  // Only what matters for the music and layout, not React Flow's runtime fields.
  JSON.stringify({
    nodes: s.nodes.map(({ id, type, position, data }) => ({ id, type, position, data })),
    edges: s.edges.map(({ id, source, target, sourceHandle, targetHandle, animated }) => ({
      id,
      source,
      target,
      sourceHandle,
      targetHandle,
      animated
    }))
  })

const blank = (): Current => ({ file: null, title: 'Untitled', tags: '', savedCanvas: serialize(EMPTY) })

type Repl = ReturnType<typeof webaudioRepl>

function App(): React.JSX.Element {
  const [patches, setPatches] = useState<PatchSummary[]>([])
  const [current, setCurrent] = useState<Current>(blank())
  const [canvas, setCanvas] = useState<CanvasState>(readAutosave)
  const [tab, setTab] = useState<'samples' | 'library'>('samples')
  const [playing, setPlaying] = useState(false)
  const [evalError, setEvalError] = useState<string | null>(null)

  const replRef = useRef<Repl | null>(null)
  const readyRef = useRef<Promise<unknown> | null>(null)

  // ---- Sample packs ----
  const [pinned, setPinned] = useState<Set<string>>(readPinned)
  const [loaded, setLoaded] = useState<Set<string>>(new Set())

  const loadPack = useCallback(async (id: string) => {
    await samples(await window.api.samples.loadUrl(id))
    setLoaded((s) => new Set(s).add(id))
  }, [])

  const togglePin = (id: string): void => {
    const next = new Set(pinned)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setPinned(next)
    try {
      localStorage.setItem(PINNED_KEY, JSON.stringify([...next]))
    } catch {
      // Not fatal: the pin just won't survive a restart.
    }
  }

  // ---- Strudel engine (no editor: the canvas compiles to code) ----
  useEffect(() => {
    if (replRef.current) return
    replRef.current = webaudioRepl({
      transpiler,
      onEvalError: (e: Error) => setEvalError(e.message),
      onToggle: (started: boolean) => setPlaying(started)
    })
    readyRef.current = Promise.all([
      evalScope(
        import('@strudel/core'),
        import('@strudel/mini'),
        import('@strudel/tonal'),
        import('@strudel/webaudio')
      ),
      registerSynthSounds(),
      ...[...readPinned()].map((id) => loadPack(id).catch(console.error))
    ])
  }, [loadPack])

  const playSound = (s: string, n: number): void => {
    const ctx = getAudioContext()
    ctx.resume()
    superdough({ s, n, gain: 0.8 }, ctx.currentTime + 0.05, 1)
  }

  const compiled = useMemo(() => current.codeOnly ?? compile(canvas.nodes, canvas.edges).code, [canvas, current.codeOnly])

  const play = async (): Promise<void> => {
    await initAudio()
    await readyRef.current
    setEvalError(null)
    await replRef.current?.evaluate(compiled)
  }

  const stop = (): void => replRef.current?.stop()

  // While playing, every canvas edit re-evaluates (debounced) so changes are heard live.
  const playingRef = useRef(playing)
  useEffect(() => {
    playingRef.current = playing
  }, [playing])
  useEffect(() => {
    if (!playingRef.current) return
    const t = setTimeout(() => {
      setEvalError(null)
      replRef.current?.evaluate(compiled)
    }, 120)
    return () => clearTimeout(t)
  }, [compiled])

  // ---- Canvas state ----
  const onCanvasChange = useCallback((s: CanvasState) => {
    setCanvas(s)
    try {
      localStorage.setItem(AUTOSAVE_KEY, serialize(s))
    } catch {
      // Autosave is a convenience only.
    }
  }, [])

  const onSoundDropped = (sound: DraggedSound): void => {
    if (sound.pack && !loaded.has(sound.pack)) loadPack(sound.pack).catch((e) => setEvalError(String(e)))
  }

  const dirty = !current.codeOnly && serialize(canvas) !== current.savedCanvas

  // ---- Patches ----
  const refresh = useCallback(async () => setPatches(await window.api.library.list()), [])

  useEffect(() => {
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])

  const confirmDiscard = (): boolean => !dirty || confirm(`Discard unsaved changes to "${current.title}"?`)

  const open = async (file: string): Promise<void> => {
    if (file === current.file || !confirmDiscard()) return
    const { meta, code } = await window.api.library.read(file)
    const base = { file, title: meta.title, tags: meta.tags.join(', '), source: meta.source }
    if (meta.canvas) {
      const state = JSON.parse(meta.canvas) as CanvasState
      onCanvasChange(state)
      setCurrent({ ...base, savedCanvas: serialize(state) })
    } else {
      // Plain code patch: nothing to show on the canvas, but it can still play.
      setCurrent({ ...base, savedCanvas: serialize(canvas), codeOnly: code })
    }
  }

  const newPatch = (): void => {
    if (!confirmDiscard()) return
    onCanvasChange(EMPTY)
    setCurrent(blank())
  }

  const save = useCallback(async () => {
    if (current.codeOnly) return
    const tags = current.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    const savedCanvas = serialize(canvas)
    const file = await window.api.library.save(
      current.file,
      { title: current.title.trim() || 'Untitled', tags, source: current.source, canvas: savedCanvas },
      compile(canvas.nodes, canvas.edges).code
    )
    setCurrent((c) => ({ ...c, file, savedCanvas }))
    refresh()
  }, [current, canvas, refresh])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        save()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '.') stop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save])

  const remove = async (file: string): Promise<void> => {
    await window.api.library.remove(file)
    if (file === current.file) setCurrent((c) => ({ ...c, file: null }))
    refresh()
  }

  const importPatches = async (input: string): Promise<void> => {
    const files = await window.api.library.import(input)
    await refresh()
    if (files.length) await open(files[0])
  }

  return (
    <div className="app">
      <div className="toolbar">
        {playing ? (
          <button className="on" onClick={stop}>
            ■ Stop
          </button>
        ) : (
          <button onClick={play}>▶ Play</button>
        )}
        <span className="sep" />
        <input
          className="title"
          value={current.title}
          onChange={(e) => setCurrent({ ...current, title: e.target.value })}
        />
        <input
          className="tags"
          placeholder="tags, comma separated"
          value={current.tags}
          onChange={(e) => setCurrent({ ...current, tags: e.target.value })}
        />
        <button onClick={save} disabled={!!current.codeOnly}>
          {dirty ? 'Save •' : 'Save'}
        </button>
        <button onClick={newPatch}>New</button>
        <button onClick={() => window.api.library.openFolder()}>Open folder</button>
        {current.source && (
          <a className="source" href={current.source} target="_blank" rel="noreferrer">
            source
          </a>
        )}
        {current.codeOnly && (
          <span className="notice">
            Code-only patch: plays as-is, can&apos;t be edited on the canvas.{' '}
            <button onClick={() => setCurrent(blank())}>Back to canvas</button>
          </span>
        )}
        {evalError && <span className="eval-error">{evalError}</span>}
      </div>
      <div className="main">
        <div className="sidebar">
          <div className="tabs">
            <button className={tab === 'samples' ? 'on' : ''} onClick={() => setTab('samples')}>
              Samples
            </button>
            <button className={tab === 'library' ? 'on' : ''} onClick={() => setTab('library')}>
              Patches
            </button>
          </div>
          {tab === 'samples' ? (
            <Samples
              pinned={pinned}
              loaded={loaded}
              onLoad={loadPack}
              onTogglePin={togglePin}
              onAudition={playSound}
            />
          ) : (
            <Library
              patches={patches}
              current={current.file}
              onOpen={open}
              onDelete={remove}
              onImport={importPatches}
            />
          )}
        </div>
        <ReactFlowProvider>
          <Canvas state={canvas} onChange={onCanvasChange} onSoundDropped={onSoundDropped} />
        </ReactFlowProvider>
      </div>
    </div>
  )
}

export default App
