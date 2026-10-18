import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { evalScope } from '@strudel/core'
import { transpiler } from '@strudel/transpiler'
import {
  getAudioContext,
  initAudio,
  registerSynthSounds,
  samples,
  setAudioContext,
  superdough,
  webaudioRepl
} from '@strudel/webaudio'
import Library from './components/Library'
import Transport from './components/Transport'
import { bpmToCps, DEFAULT_BPM } from './tempo'
import Samples from './components/Samples'
import Canvas from './canvas/Canvas'
import { compile } from './canvas/codegen'
import { migrateCanvas, SYNTH_PACKS } from './canvas/model'
import { AUDITION_EVENT, AuditionDetail } from './canvas/packSounds'
import { setPlayhead } from './canvas/playhead'
import { useHistory } from './canvas/useHistory'
import type { CanvasState, DraggedSound } from './canvas/model'
import type { PatchSummary } from '../../shared/patch'
import type { MenuCommand } from '../../shared/menu'
import { TOGGLE_CODE_EVENT } from './events'

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
const AUTOSAVE_KEY = 'ev-strudel:canvas-autosave'
const BPM_KEY = 'ev-strudel:bpm'
const CURRENT_KEY = 'ev-strudel:current-patch'

function readBpm(): number {
  try {
    return Number(localStorage.getItem(BPM_KEY)) || DEFAULT_BPM
  } catch {
    return DEFAULT_BPM
  }
}

function readAutosave(): CanvasState {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY)
    if (raw) return migrateCanvas(JSON.parse(raw))
  } catch {
    // Start empty.
  }
  return EMPTY
}

const serialize = (s: CanvasState): string =>
  // Only what matters for the music and layout, not React Flow's runtime fields.
  JSON.stringify({
    nodes: s.nodes.map(({ id, type, position, data, parentId, hidden, style }) => ({
      id,
      type,
      position,
      data,
      parentId,
      hidden,
      style
    })),
    edges: s.edges.map(({ id, source, target, sourceHandle, targetHandle, animated }) => ({
      id,
      source,
      target,
      sourceHandle,
      targetHandle,
      animated
    }))
  })

function readCurrent(): Current {
  try {
    const raw = localStorage.getItem(CURRENT_KEY)
    if (raw) {
      const { file, title, tags, source } = JSON.parse(raw)
      // Treat the autosaved canvas as what was last saved, so it doesn't show as dirty.
      return { file: file ?? null, title: title || 'Untitled', tags: tags ?? '', source, savedCanvas: serialize(readAutosave()) }
    }
  } catch {
    // Fall through.
  }
  return blank()
}

const blank = (): Current => ({ file: null, title: 'Untitled', tags: '', savedCanvas: serialize(EMPTY) })

type Repl = ReturnType<typeof webaudioRepl>

function App(): React.JSX.Element {
  const [patches, setPatches] = useState<PatchSummary[]>([])
  const [current, setCurrent] = useState<Current>(readCurrent)
  const [canvas, setCanvas] = useState<CanvasState>(readAutosave)
  const [tab, setTab] = useState<'samples' | 'library'>('samples')
  const [playing, setPlaying] = useState(false)
  const [evalError, setEvalError] = useState<string | null>(null)

  const replRef = useRef<Repl | null>(null)

  // Tempo: kept with the patch and the autosave, applied to the scheduler.
  const [bpm, setBpm] = useState<number>(readBpm)
  const bpmRef = useRef(bpm)
  useEffect(() => {
    bpmRef.current = bpm
    replRef.current?.setCps(bpmToCps(bpm))
    try {
      localStorage.setItem(BPM_KEY, String(bpm))
    } catch {
      // Convenience only.
    }
  }, [bpm])
  const readyRef = useRef<Promise<unknown> | null>(null)

  // ---- Sample packs ----
  // Packs load on demand (audition, drop, play); each loads once per session.
  const [loaded, setLoaded] = useState<Set<string>>(new Set())
  const loadingRef = useRef(new Map<string, Promise<void>>())

  const loadPack = useCallback((id: string): Promise<void> => {
    let p = loadingRef.current.get(id)
    if (!p) {
      p = window.api.samples
        .loadUrl(id)
        .then((url) => samples(url))
        .then(() => {
          setLoaded((s) => new Set(s).add(id))
          // Anything loaded also gets saved to the library, so it works offline next time.
          window.api.samples.download(id).catch((e) => console.warn(`Saving pack ${id} failed`, e))
        })
      loadingRef.current.set(id, p)
      p.catch(() => loadingRef.current.delete(id))
    }
    return p
  }, [])

  // ---- Strudel engine (no editor: the canvas compiles to code) ----
  useEffect(() => {
    if (replRef.current) return
    // "playback" latency gives the audio thread a bigger buffer, so a busy UI frame
    // doesn't cause dropouts (heard as clicks). Strudel's default is "interactive"
    // (~10ms), which crackled on the Surface while the playhead was drawing.
    const audioContext = setAudioContext(new AudioContext({ latencyHint: 'playback' }))
    replRef.current = webaudioRepl({
      audioContext,
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
      registerSynthSounds()
    ])
  }, [])

  const playSound = (s: string, n: number): void => {
    const ctx = getAudioContext()
    ctx.resume()
    superdough({ s, n, gain: 0.8 }, ctx.currentTime + 0.05, 1)
  }

  // Canvas nodes ask to preview a sound (see canvas/packSounds.ts).
  useEffect(() => {
    const listener = (e: Event): void => {
      const { s, n, pack } = (e as CustomEvent<AuditionDetail>).detail
      Promise.resolve(readyRef.current)
        .then(() => (pack ? loadPack(pack) : undefined))
        .then(() => playSound(s, n))
        .catch((err) => setEvalError(String(err)))
    }
    window.addEventListener(AUDITION_EVENT, listener)
    return () => window.removeEventListener(AUDITION_EVENT, listener)
  }, [loadPack])

  const compiled = useMemo(() => current.codeOnly ?? compile(canvas.nodes, canvas.edges).code, [canvas, current.codeOnly])

  // Packs the current music needs. Code-only patches get what strudel.cc preloads.
  const neededPacks = useMemo(() => {
    if (current.codeOnly) return ['dirt-samples', 'tidal-drum-machines', 'piano']
    const ids = new Set<string>()
    for (const node of canvas.nodes) {
      if (node.type !== 'sample') continue
      const pack = node.data.pack ?? SYNTH_PACKS[node.data.s]
      if (pack) ids.add(pack)
    }
    return [...ids]
  }, [canvas, current.codeOnly])

  // Load what's needed, then (re)evaluate. A failed pack shows an error but
  // doesn't stop the rest from playing.
  const evaluate = useCallback(
    async (code: string) => {
      await readyRef.current
      const failed = (await Promise.allSettled(neededPacks.map(loadPack))).filter((r) => r.status === 'rejected')
      setEvalError(failed.length ? `${failed.length} sample pack(s) failed to load` : null)
      replRef.current?.setCps(bpmToCps(bpmRef.current))
      await replRef.current?.evaluate(code)
    },
    [neededPacks, loadPack]
  )

  const play = async (): Promise<void> => {
    await initAudio()
    await evaluate(compiled)
  }

  const stop = (): void => replRef.current?.stop()

  // While playing, every canvas edit re-evaluates (debounced) so changes are heard live.
  const playingRef = useRef(playing)
  useEffect(() => {
    playingRef.current = playing
  }, [playing])

  // Feed the playhead from the scheduler every frame while playing.
  useEffect(() => {
    if (!playing) return setPlayhead(-1)
    let raf = 0
    const tick = (): void => {
      const scheduler = replRef.current?.scheduler
      if (scheduler) setPlayhead(scheduler.now())
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      setPlayhead(-1)
    }
  }, [playing])
  useEffect(() => {
    if (!playingRef.current) return
    const t = setTimeout(() => evaluate(compiled), 120)
    return () => clearTimeout(t)
  }, [compiled, evaluate])

  // ---- Canvas state ----
  const history = useHistory(serialize(canvas))
  const canvasRef = useRef(canvas)
  useEffect(() => {
    canvasRef.current = canvas
  }, [canvas])
  const { record, undo: popUndo, redo: popRedo } = history

  const applyCanvas = useCallback((s: CanvasState): string => {
    setCanvas(s)
    const json = serialize(s)
    try {
      localStorage.setItem(AUTOSAVE_KEY, json)
    } catch {
      // Autosave is a convenience only.
    }
    return json
  }, [])

  const onCanvasChange = useCallback((s: CanvasState) => record(applyCanvas(s)), [applyCanvas, record])

  // Snapshots don't store selection; keep what's selected now across undo/redo.
  const restore = useCallback(
    (json: string) => {
      const s = JSON.parse(json) as CanvasState
      const selected = new Set(canvasRef.current.nodes.filter((n) => n.selected).map((n) => n.id))
      applyCanvas({ nodes: s.nodes.map((n) => (selected.has(n.id) ? { ...n, selected: true } : n)), edges: s.edges })
    },
    [applyCanvas]
  )
  const undo = useCallback(() => {
    const prev = popUndo()
    if (prev) restore(prev)
  }, [popUndo, restore])
  const redo = useCallback(() => {
    const next = popRedo()
    if (next) restore(next)
  }, [popRedo, restore])

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
    if (meta.tempo) setBpm(meta.tempo)
    if (meta.canvas) {
      const state = migrateCanvas(JSON.parse(meta.canvas))
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

  // Save to the open patch, or (asNew / nothing open) to a new file named from the title.
  const save = useCallback(async (asNew = false) => {
    if (current.codeOnly) return
    const tags = current.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    const savedCanvas = serialize(canvas)
    const file = await window.api.library.save(
      asNew ? null : current.file,
      { title: current.title.trim() || 'Untitled', tags, source: current.source, canvas: savedCanvas, tempo: bpm },
      compile(canvas.nodes, canvas.edges).code
    )
    setCurrent((c) => ({ ...c, file, savedCanvas }))
    refresh()
  }, [current, canvas, bpm, refresh])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Leave text fields their own undo.
      const typing = (e.target as HTMLElement).closest?.('input, textarea, select')
      if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      }
      if ((e.ctrlKey || e.metaKey) && !typing && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        save()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '.') stop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save, undo, redo])

  // Native menu commands (main/menu.ts). Read through a ref so the latest handlers run.
  const toggleCode = (): void => {
    window.dispatchEvent(new Event(TOGGLE_CODE_EVENT))
  }
  const menuHandlers = { new: newPatch, open: () => setTab('library'), save: () => save(), saveAs: () => save(true), showFolder: () => window.api.library.openFolder(), undo, redo, toggleCode }
  const menuRef = useRef(menuHandlers)
  useEffect(() => {
    menuRef.current = menuHandlers
  })
  useEffect(() => window.api.menu.onCommand((cmd: MenuCommand) => void menuRef.current[cmd]()), [])

  // Remember which patch is open (and its name) across restarts, alongside the canvas autosave.
  useEffect(() => {
    try {
      const { file, title, tags, source } = current
      localStorage.setItem(CURRENT_KEY, JSON.stringify({ file, title, tags, source }))
    } catch {
      // Convenience only.
    }
  }, [current])

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
        <Transport playing={playing} bpm={bpm} onPlay={play} onStop={stop} onBpm={setBpm} />
        <span className="sep" />
        <input
          className="title"
          title="Patch name"
          value={current.title}
          onChange={(e) => setCurrent({ ...current, title: e.target.value })}
        />
        {dirty && (
          <span className="dirty" title="Unsaved changes (File > Save)">
            •
          </span>
        )}
        <button onClick={undo} disabled={!history.canUndo} title="Undo (Ctrl+Z)">
          ↶ Undo
        </button>
        <button onClick={redo} disabled={!history.canRedo} title="Redo (Ctrl+Shift+Z)">
          ↷ Redo
        </button>
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
              loaded={loaded}
              onLoad={loadPack}
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
