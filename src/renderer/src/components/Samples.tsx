import { useEffect, useMemo, useState } from 'react'
import { startSoundDrag, wasDragging } from '../canvas/soundDrag'
import { packSounds } from '../canvas/packSounds'
import type { DownloadProgress, PackSounds, PackStatus } from '../../../shared/samplePacks'

interface Props {
  loaded: Set<string>
  onLoad: (id: string) => Promise<void>
  onAudition: (sound: string, n: number) => void
}

const cleanError = (e: unknown): string =>
  e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': /, '') : String(e)

const MAX_VARIANTS = 64

function Samples({ loaded, onLoad, onAudition }: Props): React.JSX.Element {
  const [packs, setPacks] = useState<PackStatus[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [sounds, setSounds] = useState<Record<string, PackSounds>>({})

  const [progress, setProgress] = useState<Record<string, DownloadProgress>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  const refresh = (): Promise<void> => window.api.samples.list().then(setPacks)

  useEffect(() => {
    refresh()
    // Loaded packs save themselves to the library in the background; refresh when one finishes.
    return window.api.samples.onProgress((p) => {
      setProgress((m) => ({ ...m, [p.id]: p }))
      if (p.done === p.total) refresh()
    })
  }, [])

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(cleanError(e))
    }
  }

  const toggle = (id: string): void => {
    if (open === id) return setOpen(null)
    setOpen(id)
    setExpanded(null)
    if (!sounds[id])
      run(async () => {
        const s = await packSounds(id)
        setSounds((m) => ({ ...m, [id]: s }))
      })
  }

  // Auditioning a sound needs its pack registered with Strudel first.
  const audition = (id: string, sound: string, n: number): void => {
    run(async () => {
      if (!loaded.has(id)) await onLoad(id)
      onAudition(sound, n)
    })
  }


  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const match = (s: string): boolean => words.every((w) => s.toLowerCase().includes(w))

  // With a pack open, the search filters its sounds; otherwise it filters packs.
  const shownPacks = open ? packs : packs.filter((p) => match(`${p.name} ${p.description}`))
  const shownSounds = useMemo(
    () =>
      open && sounds[open]
        ? Object.entries(sounds[open]).filter(([name, info]) => match(`${name} ${info.variants.join(' ')}`))
        : [],
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
          const saving = prog && prog.done < prog.total
          return (
            <li key={p.id} className="collection-wrap">
              <div className={`collection ${open === p.id ? 'open' : ''}`} onClick={() => toggle(p.id)}>
                <div className="patch-title">
                  {open === p.id ? '▾' : '▸'} {p.name}
                  {sounds[p.id] && <span className="count"> {Object.keys(sounds[p.id]).length}</span>}
                  {loaded.has(p.id) && <span className="badge">loaded</span>}
                  {saving ? (
                    <span className="badge local">saving {prog.done}/{prog.total}</span>
                  ) : (
                    p.downloaded && <span className="badge local">saved</span>
                  )}
                </div>
                <div className="patch-tags">{p.description}</div>
              </div>
              {open === p.id && (
                <ul className="items">
                  {!sounds[p.id] && <li className="empty">Loading…</li>}
                  {shownSounds.map(([name, info]) => {
                    const count = info.variants.length
                    const hasVariants = !info.multisample && count > 1
                    return (
                      <li key={name} className={`sound ${expanded === name ? 'active' : ''}`}>
                        <div className="sound-row">
                          <span
                            className="grip"
                            title="Drag onto the canvas"
                            onPointerDown={(e) => startSoundDrag(e, { s: name, pack: p.id })}
                          >
                            ⠿
                          </span>
                          {/* Tap to play; swipe sideways to drag onto the canvas. */}
                          <span
                            className="sound-name"
                            onPointerDown={(e) => startSoundDrag(e, { s: name, pack: p.id }, 'x')}
                            onClick={() => !wasDragging() && audition(p.id, name, 0)}
                          >
                            ▶ {name}
                          </span>
                          {info.multisample ? (
                            <span className="sound-kind" title="Pitched instrument: plays the notes you sequence">
                              instrument
                            </span>
                          ) : (
                            hasVariants && (
                              <button className="expand" onClick={() => setExpanded(expanded === name ? null : name)}>
                                {count} files {expanded === name ? '▾' : '▸'}
                              </button>
                            )
                          )}
                        </div>
                        {expanded === name && (
                          <ul className="variant-list">
                            {info.variants.slice(0, MAX_VARIANTS).map((file, n) => (
                              <li key={n}>
                                <span
                                  className="grip"
                                  title="Drag onto the canvas"
                                  onPointerDown={(e) => startSoundDrag(e, { s: name, pack: p.id, n })}
                                >
                                  ⠿
                                </span>
                                <span
                                  className="sound-name"
                                  onPointerDown={(e) => startSoundDrag(e, { s: name, pack: p.id, n }, 'x')}
                                  onClick={() => !wasDragging() && audition(p.id, name, n)}
                                >
                                  ▶ <span className="variant-n">{n}</span> {file}
                                </span>
                              </li>
                            ))}
                            {count > MAX_VARIANTS && (
                              <li className="empty">…and {count - MAX_VARIANTS} more (pick them on the canvas node)</li>
                            )}
                          </ul>
                        )}
                      </li>
                    )
                  })}
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
