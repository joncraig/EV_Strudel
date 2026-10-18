import { useMemo, useState } from 'react'
import type { PatchSummary } from '../../../shared/patch'

interface Props {
  patches: PatchSummary[]
  current: string | null
  onOpen: (file: string) => void
  onDelete: (file: string) => void
  onImport: (input: string) => Promise<void>
}

function Library({ patches, current, onOpen, onDelete, onImport }: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [importText, setImportText] = useState('')
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Every word must appear in the title, tags, source or code.
  const filtered = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return patches
    return patches.filter((p) => {
      const hay = [p.title, p.tags.join(' '), p.source ?? '', p.preview].join(' ').toLowerCase()
      return words.every((w) => hay.includes(w))
    })
  }, [patches, query])

  const runImport = async (): Promise<void> => {
    if (!importText.trim()) return
    setImporting(true)
    setError(null)
    try {
      await onImport(importText)
      setImportText('')
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': /, '') : String(e))
    } finally {
      setImporting(false)
    }
  }

  return (
    <aside className="library">
      <input
        className="search"
        placeholder={`Search ${patches.length} patches…`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul className="patch-list">
        {filtered.map((p) => (
          <li
            key={p.file}
            className={p.file === current ? 'active' : ''}
            onClick={() => onOpen(p.file)}
            title={p.preview}
          >
            <div className="patch-title">{p.title}</div>
            {p.tags.length > 0 && <div className="patch-tags">{p.tags.join(' · ')}</div>}
            <button
              className="delete"
              title="Move to Recycle Bin"
              onClick={(e) => {
                e.stopPropagation()
                if (confirm(`Move "${p.title}" to the Recycle Bin?`)) onDelete(p.file)
              }}
            >
              ×
            </button>
          </li>
        ))}
        {filtered.length === 0 && <li className="empty">No patches match.</li>}
      </ul>
      <div className="import">
        <textarea
          placeholder="Paste a strudel.cc share URL, gist, GitHub file, raw URL, or code…"
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          rows={3}
        />
        <button onClick={runImport} disabled={importing || !importText.trim()}>
          {importing ? 'Importing…' : 'Import to library'}
        </button>
        {error && <div className="error">{error}</div>}
      </div>
    </aside>
  )
}

export default Library
