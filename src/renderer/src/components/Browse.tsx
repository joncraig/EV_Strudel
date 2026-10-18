import { useEffect, useMemo, useState } from 'react'
import type { CatalogItem, Collection } from '../../../shared/catalog'

interface Props {
  onAudition: (url: string) => Promise<void>
  onKeep: (url: string) => Promise<void>
  auditioning: string | null
}

const cleanError = (e: unknown): string =>
  e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': /, '') : String(e)

function Browse({ onAudition, onKeep, auditioning }: Props): React.JSX.Element {
  const [collections, setCollections] = useState<Collection[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [items, setItems] = useState<Record<string, CatalogItem[]>>({})
  const [loading, setLoading] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [kept, setKept] = useState<Set<string>>(new Set())

  useEffect(() => {
    window.api.catalog.list().then(setCollections)
  }, [])

  const toggle = async (id: string): Promise<void> => {
    setError(null)
    if (open === id) return setOpen(null)
    setOpen(id)
    if (items[id]) return
    setLoading(id)
    try {
      const list = await window.api.catalog.browse(id)
      setItems((m) => ({ ...m, [id]: list }))
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setLoading(null)
    }
  }

  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const match = (s: string): boolean => words.every((w) => s.toLowerCase().includes(w))

  const shown = useMemo(
    () => (open && items[open] ? items[open].filter((i) => match(i.title)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, items, query]
  )

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(cleanError(e))
    }
  }

  return (
    <div className="browse">
      <input
        className="search"
        placeholder={open ? 'Filter this collection…' : 'Pick a collection…'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {error && <div className="error">{error}</div>}
      <ul className="patch-list">
        {collections.map((c) => (
          <li key={c.id} className="collection-wrap">
            <div className={`collection ${open === c.id ? 'open' : ''}`} onClick={() => toggle(c.id)}>
              <div className="patch-title">
                {open === c.id ? '▾' : '▸'} {c.name}
                {items[c.id] && <span className="count"> {items[c.id].length}</span>}
              </div>
              <div className="patch-tags">{c.description}</div>
            </div>
            {open === c.id && (
              <ul className="items">
                {loading === c.id && <li className="empty">Loading…</li>}
                {shown.map((item) => (
                  <li
                    key={item.url}
                    className={item.url === auditioning ? 'active' : ''}
                    onClick={() => run(() => onAudition(item.url))}
                    title="Load into the editor to try it"
                  >
                    <div className="patch-title">{item.title}</div>
                    <button
                      className="keep"
                      title="Save to library"
                      disabled={kept.has(item.url)}
                      onClick={(e) => {
                        e.stopPropagation()
                        run(async () => {
                          await onKeep(item.url)
                          setKept((s) => new Set(s).add(item.url))
                        })
                      }}
                    >
                      {kept.has(item.url) ? '✓' : '+'}
                    </button>
                  </li>
                ))}
                {!loading && items[c.id] && shown.length === 0 && <li className="empty">Nothing matches.</li>}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default Browse
