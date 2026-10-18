import { useEffect, useMemo, useState } from 'react'
import type { DownloadProgress, PackSounds, PackStatus } from '../../../shared/samplePacks'

interface Props {
  // Packs that load automatically at startup.
  pinned: Set<string>
  loaded: Set<string>
  onLoad: (id: string) => Promise<void>
  onTogglePin: (id: string) => void
  onAudition: (sound: string, n: number) => void
  onInsert: (sound: string) => void
}

const cleanError = (e: unknown): string =>
  e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': /, '') : String(e)

const MAX_VARIANTS = 32

function Samples({ pinned, loaded, onLoad, onTogglePin, onAudition, onInsert }: Props): React.JSX.Element {
  const [packs, setPacks] = useState<PackStatus[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [sounds, setSounds] = useState<Record<string, PackSounds>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<Record<string, DownloadProgress>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  const refresh = (): Promise<void> => window.api.samples.list().then(setPacks)

  useEffect(() => {
    refresh()
    return window.api.samples.onProgress((p) => setProgress((m) => ({ ...m, [p.id]: p })))
  }, [])

  const run = async (id: string, fn: () => Promise<void>): Promise<void> => {
    setError(null)
    setBusy(id)
    try {
      await fn()
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setBusy(null)
    }
  }

  const toggle = (id: string): void => {
    if (open === id) return setOpen(null)
    setOpen(id)
    setExpanded(null)
    if (!sounds[id])
      run(id, async () => {
        const s = await window.api.samples.sounds(id)
        setSounds((m) => ({ ...m, [id]: s }))
      })
  }

  // Auditioning a sound needs its pack registered with Strudel first.
  const audition = (id: string, sound: string, n: number): void => {
    run(id, async () => {
      if (!loaded.has(id)) await onLoad(id)
      onAudition(sound, n)
    })
  }

  const download = (id: string): Promise<void> =>
    run(id, async () => {
      const result = await window.api.samples.download(id)
      if (result.failed) setError(`${result.failed} of ${result.total} files failed to download.`)
      await refresh()
    })

  const removeLocal = (p: PackStatus): void => {
    if (!confirm(`Delete the downloaded copy of "${p.name}"? It will stream from the web again.`)) return
    run(p.id, async () => {
      await window.api.samples.remove(p.id)
      await refresh()
    })
  }

  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const match = (s: string): boolean => words.every((w) => s.toLowerCase().includes(w))

  // With a pack open, the search filters its sounds; otherwise it filters packs.
  const shownPacks = open ? packs : packs.filter((p) => match(`${p.name} ${p.description}`))
  const shownSounds = useMemo(
    () => (open && sounds[open] ? Object.entries(sounds[open]).filter(([name]) => match(name)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, sounds, query]
  )

  return (
    <div className="browse samples">
      <input
        className="search"
        placeholder={open ? 'Filter sounds…' : `Search ${packs.length} sample packs…`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {error && <div className="error">{error}</div>}
      <ul className="patch-list">
        {shownPacks.map((p) => {
          const prog = progress[p.id]
          const downloadingNow = busy === p.id && prog && prog.done < prog.total
          return (
            <li key={p.id} className="collection-wrap">
              <div className={`collection ${open === p.id ? 'open' : ''}`} onClick={() => toggle(p.id)}>
                <div className="patch-title">
                  {open === p.id ? '▾' : '▸'} {p.name}
                  {sounds[p.id] && <span className="count"> {Object.keys(sounds[p.id]).length}</span>}
                  {loaded.has(p.id) && <span className="badge">loaded</span>}
                  {p.downloaded && <span className="badge local">offline</span>}
                </div>
                <div className="patch-tags">{p.description}</div>
                <div className="pack-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className={pinned.has(p.id) ? 'on' : ''}
                    title="Load this pack every time the app starts"
                    onClick={() => onTogglePin(p.id)}
                  >
                    {pinned.has(p.id) ? '★ auto-load' : '☆ auto-load'}
                  </button>
                  {!loaded.has(p.id) && (
                    <button disabled={busy === p.id} onClick={() => run(p.id, () => onLoad(p.id))}>
                      Load now
                    </button>
                  )}
                  {p.downloaded ? (
                    <button onClick={() => removeLocal(p)}>Delete local</button>
                  ) : (
                    <button disabled={busy === p.id} onClick={() => download(p.id)}>
                      {downloadingNow ? `${prog.done}/${prog.total}` : 'Download'}
                    </button>
                  )}
                </div>
              </div>
              {open === p.id && (
                <ul className="items">
                  {!sounds[p.id] && <li className="empty">Loading…</li>}
                  {shownSounds.map(([name, count]) => (
                    <li key={name} className={expanded === name ? 'active' : ''}>
                      <div className="sound-row">
                        <span className="sound-name" title="Play" onClick={() => audition(p.id, name, 0)}>
                          ▶ {name}
                        </span>
                        {count > 1 && (
                          <span className="count" onClick={() => setExpanded(expanded === name ? null : name)}>
                            {count} {expanded === name ? '▾' : '▸'}
                          </span>
                        )}
                        <button className="keep" title={`Insert s("${name}") at the cursor`} onClick={() => onInsert(name)}>
                          ⤵
                        </button>
                      </div>
                      {expanded === name && (
                        <div className="variants">
                          {Array.from({ length: Math.min(count, MAX_VARIANTS) }, (_, n) => (
                            <button key={n} onClick={() => audition(p.id, name, n)}>
                              {n}
                            </button>
                          ))}
                          {count > MAX_VARIANTS && <span className="count">+{count - MAX_VARIANTS}</span>}
                        </div>
                      )}
                    </li>
                  ))}
                  {sounds[p.id] && shownSounds.length === 0 && <li className="empty">Nothing matches.</li>}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default Samples
