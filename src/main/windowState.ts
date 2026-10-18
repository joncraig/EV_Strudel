import { app, BrowserWindow, Rectangle, screen } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

// Window size/position persistence (compendium: renderer-deep-dive "Window State Persistence",
// ev-scaffold-checklist #12). Saved on every move/resize, debounced, because before-quit
// never fires when dev mode is killed with Ctrl+C.

interface WindowState {
  bounds: Partial<Rectangle> & { width: number; height: number }
  isMaximized: boolean
}

const DEFAULT: WindowState = { bounds: { width: 1280, height: 800 }, isMaximized: false }
const MIN_VISIBLE = 80

const statePath = (): string => join(app.getPath('userData'), 'window-state.json')

// Drop x/y if the saved rect isn't meaningfully on any current display
// (monitor unplugged, laptop undocked); Electron then centres on the primary.
function clampToDisplays(bounds: WindowState['bounds']): WindowState['bounds'] {
  const { x, y, width, height } = bounds
  if (x === undefined || y === undefined) return { width, height }
  const visible = screen.getAllDisplays().some(({ workArea: a }) => {
    const w = Math.min(x + width, a.x + a.width) - Math.max(x, a.x)
    const h = Math.min(y + height, a.y + a.height) - Math.max(y, a.y)
    return w >= MIN_VISIBLE && h >= MIN_VISIBLE
  })
  return visible ? bounds : { width, height }
}

export function loadWindowState(): WindowState {
  try {
    const saved = JSON.parse(readFileSync(statePath(), 'utf8')) as WindowState
    if (saved.bounds?.width > 0 && saved.bounds?.height > 0)
      return { bounds: clampToDisplays(saved.bounds), isMaximized: !!saved.isMaximized }
  } catch {
    // First launch or unreadable file: use defaults.
  }
  return DEFAULT
}

export function trackWindowState(win: BrowserWindow, initial: WindowState): void {
  // getBounds() returns the full-screen rect while maximized, so remember the last
  // normal bounds separately and save those.
  let normalBounds = { ...initial.bounds }
  let timer: NodeJS.Timeout | null = null

  const save = (): void => {
    if (win.isDestroyed()) return
    if (!win.isMaximized() && !win.isMinimized()) normalBounds = win.getBounds()
    try {
      writeFileSync(statePath(), JSON.stringify({ bounds: normalBounds, isMaximized: win.isMaximized() }))
    } catch (e) {
      console.error('Could not save window state', e)
    }
  }
  const saveSoon = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, 1000)
  }

  win.on('resize', saveSoon)
  win.on('move', saveSoon)
  win.on('maximize', saveSoon)
  win.on('unmaximize', saveSoon)
  win.on('close', () => {
    if (timer) clearTimeout(timer)
    save()
  })
}
