import { useEffect, useRef } from 'react'

export interface MenuItem {
  label: string
  onSelect: () => void
  danger?: boolean
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
}

// A Shift+A style pop-up menu, sized for touch. Closes on pick, outside tap or Escape.
function ContextMenu({ x, y, sections, onClose }: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

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
      {sections.map((section, i) => (
        <div className="menu-section" key={i}>
          {section.title && <div className="menu-title">{section.title}</div>}
          {section.items.map((item) => (
            <button
              key={item.label}
              className={item.danger ? 'danger' : ''}
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
    </div>
  )
}

export default ContextMenu
