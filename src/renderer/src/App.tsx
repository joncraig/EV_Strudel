import { useCallback, useEffect, useRef, useState } from 'react'
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
import Library from './components/Library'
import type { PatchSummary } from '../../shared/patch'

const initialCode = `note("<c3 eb3 g3 bb3>*2").s("sawtooth").lpf(sine.range(400, 2000).slow(4))`

interface Current {
  file: string | null
  title: string
  tags: string
  source?: string
  savedCode: string
}

const blank = (code = initialCode): Current => ({
  file: null,
  title: 'Untitled',
  tags: '',
  savedCode: code
})

function App(): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  // StrudelMirror ships without types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mirrorRef = useRef<any>(null)
  const [patches, setPatches] = useState<PatchSummary[]>([])
  const [current, setCurrent] = useState<Current>(blank())
  const [dirty, setDirty] = useState(false)

  const refresh = useCallback(async () => setPatches(await window.api.library.list()), [])

  useEffect(() => {
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])

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

  // The editor has no change callback we can hook, so check after each keystroke.
  const checkDirty = (): void => {
    const code = mirrorRef.current?.code
    if (code !== undefined) setDirty(code !== current.savedCode)
  }

  const confirmDiscard = (): boolean =>
    !dirty || confirm(`Discard unsaved changes to "${current.title}"?`)

  const open = async (file: string): Promise<void> => {
    if (file === current.file || !confirmDiscard()) return
    const { meta, code } = await window.api.library.read(file)
    mirrorRef.current.setCode(code)
    setCurrent({ file, title: meta.title, tags: meta.tags.join(', '), source: meta.source, savedCode: code })
    setDirty(false)
  }

  const newPatch = (): void => {
    if (!confirmDiscard()) return
    mirrorRef.current.setCode('')
    setCurrent(blank(''))
    setDirty(false)
  }

  const save = useCallback(async () => {
    const code: string = mirrorRef.current.code
    const tags = current.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    const file = await window.api.library.save(
      current.file,
      { title: current.title.trim() || 'Untitled', tags, source: current.source },
      code
    )
    setCurrent((c) => ({ ...c, file, savedCode: code }))
    setDirty(false)
    refresh()
  }, [current, refresh])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        save()
      }
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
    if (files.length) {
      const first = files[0]
      // Open the first imported patch straight away.
      const { meta, code } = await window.api.library.read(first)
      if (!confirmDiscard()) return
      mirrorRef.current.setCode(code)
      setCurrent({ file: first, title: meta.title, tags: meta.tags.join(', '), source: meta.source, savedCode: code })
      setDirty(false)
    }
  }

  return (
    <div className="app">
      <div className="toolbar">
        <button onClick={() => mirrorRef.current?.evaluate()}>▶ Play</button>
        <button onClick={() => mirrorRef.current?.stop()}>■ Stop</button>
        <span className="sep" />
        <input
          className="title"
          value={current.title}
          onChange={(e) => {
            setCurrent({ ...current, title: e.target.value })
            setDirty(true)
          }}
        />
        <input
          className="tags"
          placeholder="tags, comma separated"
          value={current.tags}
          onChange={(e) => {
            setCurrent({ ...current, tags: e.target.value })
            setDirty(true)
          }}
        />
        <button onClick={save}>{dirty ? 'Save •' : 'Save'}</button>
        <button onClick={newPatch}>New</button>
        <button onClick={() => window.api.library.openFolder()}>Open folder</button>
        {current.source && (
          <a className="source" href={current.source} target="_blank" rel="noreferrer">
            source
          </a>
        )}
      </div>
      <div className="main">
        <Library
          patches={patches}
          current={current.file}
          onOpen={open}
          onDelete={remove}
          onImport={importPatches}
        />
        <div className="editor" ref={rootRef} onKeyUp={checkDirty} onInput={checkDirty} />
      </div>
    </div>
  )
}

export default App
