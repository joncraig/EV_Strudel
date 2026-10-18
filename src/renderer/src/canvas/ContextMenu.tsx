import { useEffect, useRef, useState } from 'react'

export interface MenuItem {
  label: string
  onSelect: () => void
  danger?: boolean
  // Matches the colour of the node it adds.
  color?: string
}

export interface MenuSection {
  title?: string
  items: MenuItem[]
}

interface Props {
  // Screen point to open at.
  x: number
  y: number
  sections: MenuSection[]
  onClose: () => void
  // Typing filters the items (no text box, so no on-screen keyboard); Enter picks the first.
  searchable?: boolean
}

// A Shift+A style pop-up menu, sized for touch. Closes on pick, outside tap or Escape.
function ContextMenu({ x, y, sections, onClose, searchable = false }: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const shown = q
    ? sections
        .map((s) => ({ ...s, items: s.items.filter((i) => i.label.toLowerCase().includes(q)) }))
        .filter((s) => s.items.length)
    : sections
  const firstRef = useRef<MenuItem | null>(null)
  useEffect(() => {
    firstRef.current = shown[0]?.items[0] ?? null
  })

  useEffect(() => {
    if (!searchable) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'Backspace') setQuery((s) => s.slice(0, -1))
      else if (e.key === 'Enter') {
        const first = firstRef.current
        if (first) {
          first.onSelect()
          onClose()
        }
      } else if (e.key.length === 1) setQuery((s) => s + e.key)
      else return
      // Captured first so the canvas doesn't see it (Backspace there deletes nodes).
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [searchable, onClose])

  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    // Defer so the tap that opened the menu doesn't immediately close it.
    const t = setTimeout(() => window.addEventListener('pointerdown', onDown), 0)
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // Keep the menu on screen.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.right > window.innerWidth) el.style.left = `${Math.max(4, window.innerWidth - r.width - 4)}px`
    if (r.bottom > window.innerHeight) el.style.top = `${Math.max(4, window.innerHeight - r.height - 4)}px`
  }, [x, y])

  return (
    <div className="context-menu" ref={ref} style={{ left: x, top: y }}>
      {searchable && (
        <div className={`menu-search ${q ? 'active' : ''}`}>{query || 'Type to search…'}</div>
      )}
      {shown.map((section, i) => (
        <div className="menu-section" key={i}>
          {section.title && <div className="menu-title">{section.title}</div>}
          {section.items.map((item) => (
            <button
              key={item.label}
              className={item.danger ? 'danger' : ''}
              style={item.color ? { borderLeftColor: item.color } : undefined}
              onClick={() => {
                item.onSelect()
                onClose()
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ))}
      {q && !shown.length && <div className="menu-empty">Nothing matches “{query}”</div>}
    </div>
  )
}

export default ContextMenu
