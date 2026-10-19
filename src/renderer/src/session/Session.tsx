// The session view (Ableton-style, Jon 2026-10-18): channels are columns, scenes are
// rows, each cell a clip; Bus/channel fader strips along the bottom. The selected
// clip's nodes are edited left to right in the bottom panel. No wires: a clip is its
// nodes in order, and routing is a selector (Output on a strip, targets on a Duck).

import { useEffect, useRef, useState } from 'react'
import ContextMenu, { type MenuSection } from '../canvas/ContextMenu'
import NodeEditor from '../canvas/Panel'
import { ParamFader } from '../canvas/controls'
import { SOUND_DROP_EVENT, type SoundDropDetail } from '../canvas/soundDrag'
import { SoundingContext, StepLensContext } from '../canvas/stepLens'
import {
  BUS_MAX_VOLUME,
  isBank,
  nodeId,
  type CanvasNode,
  type DraggedSound,
  type Edge
} from '../canvas/model'
import { TOGGLE_CODE_EVENT, TOGGLE_PANEL_EVENT } from '../events'
import { valueDrag } from '../drag'
import { addSections, kindColor } from './catalog'
import { soloChanges } from '../canvas/solo'
import { songGraph, type Channel, type Clip, type Song, compileSong } from './song'

const PANEL_KEY = 'ev-strudel:panel'
const NODE_W = 330 // a typical node column in the clip editor (for drag reordering)

// Colours for channels, by position.
const CHANNEL_COLORS = [
  '#c9643b',
  '#3b8fc9',
  '#5aa04a',
  '#a050c0',
  '#c9a53b',
  '#3bb3a5',
  '#c94f7a',
  '#7f8fa6'
]
const channelColor = (i: number): string => CHANNEL_COLORS[i % CHANNEL_COLORS.length]

interface Selected {
  channel: string
  scene: number
}

interface Props {
  song: Song
  onChange: (song: Song) => void
  compiled: ReturnType<typeof compileSong>
  // Clips waiting for the next bar: channel id -> scene (null = stop).
  queued: Record<string, number | null>
  onLaunch: (changes: Record<string, number | null>) => void
  onSoundDropped: (sound: DraggedSound) => void
}

// A node's colour key for the clip cell's strip (what the clip is made of, in order).
const nodeKind = (n: CanvasNode): string =>
  n.type === 'effect'
    ? 'fx:'
    : n.type === 'voicing'
      ? 'voicing:'
      : n.type === 'sample'
        ? 'synth:'
        : n.type === 'sequencer'
          ? (n.data.kind as string)
          : (n.type ?? '')

// What a clip is, in a word: its sound, else its first sequencer.
function clipTitle(clip: Clip): string {
  if (clip.name) return clip.name
  const s = clip.nodes.find((n) => n.type === 'sample')
  if (s) return (s.data.label as string) ?? (s.data.s as string)
  const q = clip.nodes.find((n) => n.type === 'sequencer')
  return q
    ? ({ degree: 'Notes', slice: 'Slices', chord: 'Chords' }[q.data.kind as string] ?? 'Clip')
    : 'Clip'
}

function Session({
  song,
  onChange,
  compiled,
  queued,
  onLaunch,
  onSoundDropped
}: Props): React.JSX.Element {
  // A node tile picked in the clip editor: Delete / Ctrl+D act on it rather than the clip.
  const [pickedNode, setPickedNode] = useState<string | null>(null)
  const [selected, setSelected] = useState<Selected | null>(() => {
    const c = song.channels.find((ch) => ch.kind === 'track' && ch.clips.some(Boolean))
    return c ? { channel: c.id, scene: c.clips.findIndex(Boolean) } : null
  })
  const [menu, setMenu] = useState<{
    x: number
    y: number
    sections: MenuSection[]
    search?: boolean
  } | null>(null)
  const [showCode, setShowCode] = useState(false)
  const [panelOpen, setPanelOpen] = useState(() => {
    try {
      return localStorage.getItem(PANEL_KEY) !== 'closed'
    } catch {
      return true
    }
  })
  const togglePanel = (): void =>
    setPanelOpen((open) => {
      try {
        localStorage.setItem(PANEL_KEY, open ? 'closed' : 'open')
      } catch {
        // A convenience only.
      }
      return !open
    })
  useEffect(() => {
    const code = (): void => setShowCode((v) => !v)
    const panel = (): void => togglePanel()
    window.addEventListener(TOGGLE_CODE_EVENT, code)
    window.addEventListener(TOGGLE_PANEL_EVENT, panel)
    return () => {
      window.removeEventListener(TOGGLE_CODE_EVENT, code)
      window.removeEventListener(TOGGLE_PANEL_EVENT, panel)
    }
  }, [])

  const tracks = song.channels
  const channel = (id: string): Channel | undefined => song.channels.find((c) => c.id === id)
  const update = (id: string, patch: Partial<Channel>): void =>
    onChange({
      ...song,
      channels: song.channels.map((c) => (c.id === id ? { ...c, ...patch } : c))
    })
  const setClip = (chId: string, scene: number, clip: Clip | null): void => {
    const ch = channel(chId)
    if (!ch) return
    const clips = [...ch.clips]
    while (clips.length <= scene) clips.push(null)
    clips[scene] = clip
    update(chId, { clips })
  }

  // ---- The selected clip (or a Bus's chain) and its nodes ----
  const selCh = selected ? channel(selected.channel) : undefined
  const selNodes: CanvasNode[] | null = selCh
    ? selCh.kind === 'bus'
      ? (selCh.nodes ?? [])
      : (selCh.clips[selected!.scene]?.nodes ?? null)
    : null
  const setNodes = (nodes: CanvasNode[]): void => {
    if (!selCh || !selected) return
    if (selCh.kind === 'bus') update(selCh.id, { nodes })
    else {
      const clip = selCh.clips[selected.scene]
      if (clip) setClip(selCh.id, selected.scene, { ...clip, nodes })
    }
  }
  // The graph the selected clip is compiled in (as if it were playing), for names and
  // sounds in its editors.
  const selChId = selCh?.id
  const selKind = selCh?.kind
  const selScene = selected?.scene
  const selGraph = ((): { nodes: CanvasNode[]; edges: Edge[] } => {
    if (!selChId || selScene === undefined) return { nodes: [], edges: [] }
    return songGraph({
      ...song,
      channels: song.channels.map((c) =>
        c.id === selChId && selKind === 'track' ? { ...c, playing: selScene } : c
      )
    })
  })()

  const insertAt = (i: number, x: number, y: number): void => {
    if (!selNodes) return
    setMenu({
      x,
      y,
      search: true,
      sections: addSections((node) => {
        const next = [...selNodes]
        next.splice(i, 0, node)
        setNodes(next)
      })
    })
  }
  const nodeMenu = (i: number, x: number, y: number): void => {
    if (!selNodes) return
    const n = selNodes[i]
    setMenu({
      x,
      y,
      sections: [
        {
          items: [
            {
              label: 'Duplicate',
              onSelect: () => {
                const next = [...selNodes]
                next.splice(i + 1, 0, {
                  ...n,
                  id: nodeId(n.type ?? 'node'),
                  data: structuredClone(n.data)
                } as CanvasNode)
                setNodes(next)
              }
            },
            {
              label: 'Delete',
              danger: true,
              onSelect: () => setNodes(selNodes.filter((_, j) => j !== i))
            }
          ]
        }
      ]
    })
  }
  // Drag a node's grip sideways to move it along the clip.
  const dragNode = (e: React.PointerEvent, i: number): void => {
    if (!selNodes) return
    const start = i
    let to = i
    const el = (e.currentTarget as HTMLElement).closest<HTMLElement>('.clip-node')
    valueDrag(
      e,
      (dx) => {
        to = Math.max(0, Math.min(selNodes.length - 1, start + Math.round(dx / NODE_W)))
        if (el) el.style.transform = `translateX(${dx}px)`
      },
      () => {
        if (el) el.style.transform = ''
        if (to === start) return
        const next = [...selNodes]
        const [moved] = next.splice(start, 1)
        next.splice(to, 0, moved)
        setNodes(next)
      }
    )
  }

  // ---- Channels, scenes, clips ----
  const addChannel = (kind: 'track' | 'bus'): void => {
    const id = nodeId(kind === 'bus' ? 'bus' : 'ch')
    const n = song.channels.filter((c) => c.kind === kind).length + 1
    onChange({
      ...song,
      channels: [
        ...song.channels,
        kind === 'bus'
          ? { id, name: `Bus ${n}`, kind, clips: [], playing: null, nodes: [] }
          : { id, name: `${n}`, kind, clips: song.scenes.map(() => null), playing: null }
      ]
    })
  }
  const addScene = (): void =>
    onChange({
      ...song,
      scenes: [...song.scenes, { id: nodeId('scene'), name: `${song.scenes.length + 1}` }]
    })
  const newClip = (chId: string, scene: number): void => {
    setClip(chId, scene, { id: nodeId('clip'), nodes: [] })
    setSelected({ channel: chId, scene })
  }

  // ---- Clip selection: one slot, or several by fence (drag a box over the grid from
  // empty space). Copy, paste, duplicate, delete and drag act on the whole selection,
  // keeping the clips' layout. A pasted or duplicated clip gets fresh node ids. ----
  const [multi, setMulti] = useState<Selected[]>([])
  const group: Selected[] = multi.length > 1 ? multi : selected ? [selected] : []
  const inGroup = (chId: string, scene: number): boolean =>
    group.some((g) => g.channel === chId && g.scene === scene)
  const selectOne = (sel: Selected): void => {
    setMulti([])
    setSelected(sel)
  }
  const chIndex = (id: string): number => song.channels.findIndex((c) => c.id === id)
  const cloneClip = (c: Clip): Clip => ({
    id: nodeId('clip'),
    name: c.name,
    nodes: c.nodes.map(
      (n) => ({ ...n, id: nodeId(n.type ?? 'node'), data: structuredClone(n.data) }) as CanvasNode
    )
  })
  const clipAt = (sel: Selected): Clip | null => channel(sel.channel)?.clips[sel.scene] ?? null
  // The song with one slot changed (adding scenes if it's past the last one).
  const withClip = (base: Song, chId: string, scene: number, clip: Clip | null): Song => {
    const scenes = [...base.scenes]
    while (scenes.length <= scene)
      scenes.push({ id: nodeId('scene'), name: `${scenes.length + 1}` })
    return {
      ...base,
      scenes,
      channels: base.channels.map((c) => {
        if (c.id !== chId) return c
        const clips = [...c.clips]
        while (clips.length <= scene) clips.push(null)
        clips[scene] = clip
        // A deleted clip that was playing stops.
        return { ...c, clips, playing: !clip && c.playing === scene ? null : c.playing }
      })
    }
  }
  // Clips as a block: each one's place relative to the block's top-left slot.
  interface Block {
    dc: number
    ds: number
    clip: Clip
  }
  const blockOf = (
    sels: Selected[]
  ): { block: Block[]; ci: number; scene: number; rows: number } => {
    const filled = sels.filter((s) => clipAt(s))
    const ci = Math.min(...filled.map((s) => chIndex(s.channel)))
    const scene = Math.min(...filled.map((s) => s.scene))
    const block = filled.map((s) => ({
      dc: chIndex(s.channel) - ci,
      ds: s.scene - scene,
      clip: clipAt(s)!
    }))
    return { block, ci, scene, rows: Math.max(0, ...block.map((b) => b.ds)) + 1 }
  }
  // Put a block with its top-left at (ci, scene); slots off the grid or on a Bus are skipped.
  const place = (
    base: Song,
    block: Block[],
    ci: number,
    scene: number,
    clone: boolean
  ): { song: Song; at: Selected[] } => {
    let next = base
    const at: Selected[] = []
    for (const b of block) {
      const ch = base.channels[ci + b.dc]
      if (!ch || ch.kind !== 'track' || scene + b.ds < 0) continue
      next = withClip(next, ch.id, scene + b.ds, clone ? cloneClip(b.clip) : b.clip)
      at.push({ channel: ch.id, scene: scene + b.ds })
    }
    return { song: next, at }
  }
  const selectAll = (at: Selected[]): void => {
    setSelected(at[0] ?? null)
    setMulti(at.length > 1 ? at : [])
  }
  const clipboard = useRef<Block[] | null>(null)
  const copyClips = (sels: Selected[]): void => {
    const { block } = blockOf(sels)
    if (block.length) clipboard.current = block
  }
  const pasteClips = (sel: Selected): void => {
    if (!clipboard.current) return
    const r = place(song, clipboard.current, chIndex(sel.channel), sel.scene, true)
    onChange(r.song)
    selectAll(r.at)
  }
  const deleteClips = (sels: Selected[]): void => {
    const next = sels.reduce((s, x) => withClip(s, x.channel, x.scene, null), song)
    if (sels.some((s) => clipAt(s))) onChange(next)
  }
  // One clip: into the next empty slot below. Several: the block again, right below.
  const duplicateClips = (sels: Selected[]): void => {
    const filled = sels.filter((s) => clipAt(s))
    if (!filled.length) return
    if (filled.length === 1) {
      const s = filled[0]
      const ch = channel(s.channel)!
      let to = s.scene + 1
      while (to < song.scenes.length && ch.clips[to]) to++
      onChange(withClip(song, s.channel, to, cloneClip(clipAt(s)!)))
      selectOne({ channel: s.channel, scene: to })
      return
    }
    const { block, ci, scene, rows } = blockOf(filled)
    const r = place(song, block, ci, scene + rows, true)
    onChange(r.song)
    selectAll(r.at)
  }

  // ---- Drag clips to other slots to move them (the whole selection if the clip is in
  // it); hold Ctrl at the drop to copy. Drag from empty space to fence-select. Pointer
  // events, so touch works too. ----
  const dragged = useRef(false) // a drag just ended: the click that follows isn't a tap
  const endDrag = (): void => {
    dragged.current = true
    setTimeout(() => (dragged.current = false), 0)
  }
  const dragClip = (e: React.PointerEvent, from: Selected): void => {
    if ((e.target as HTMLElement).closest('.clip-launch') || e.button !== 0) return
    const { pointerId, clientX: x0, clientY: y0 } = e
    let active = false
    let over: HTMLElement | null = null
    const slotAt = (x: number, y: number): HTMLElement | null =>
      document.elementFromPoint(x, y)?.closest<HTMLElement>('.clip-slot[data-scene]') ?? null
    const mark = (el: HTMLElement | null): void => {
      over?.classList.remove('drop-target')
      over = el
      over?.classList.add('drop-target')
    }
    const move = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId) return
      if (!active && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 8) return
      active = true
      document.body.classList.add('dragging-clip')
      document.body.classList.toggle('dragging-copy', ev.ctrlKey)
      const el = slotAt(ev.clientX, ev.clientY)
      mark(el && !el.classList.contains('bus-slot') ? el : null)
    }
    const up = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId) return
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      document.body.classList.remove('dragging-clip', 'dragging-copy')
      const target = over
      mark(null)
      if (!active) return
      endDrag()
      if (!target || ev.type === 'pointercancel') return
      const to: Selected = { channel: target.dataset.channel!, scene: Number(target.dataset.scene) }
      if (to.channel === from.channel && to.scene === from.scene) return
      const sels = inGroup(from.channel, from.scene) ? group : [from]
      const { block, ci, scene } = blockOf(sels)
      if (!block.length) return
      const dci = chIndex(to.channel) - chIndex(from.channel)
      const ds = to.scene - from.scene
      // Ctrl at the drop copies; otherwise the clips move. A single playing clip moved
      // within its channel keeps playing.
      const wasPlaying = sels.length === 1 && channel(from.channel)?.playing === from.scene
      const base = ev.ctrlKey
        ? song
        : sels.reduce((s, x) => withClip(s, x.channel, x.scene, null), song)
      const r = place(base, block, ci + dci, scene + ds, ev.ctrlKey)
      let next = r.song
      if (wasPlaying && !ev.ctrlKey && to.channel === from.channel)
        next = {
          ...next,
          channels: next.channels.map((c) =>
            c.id === from.channel ? { ...c, playing: to.scene } : c
          )
        }
      onChange(next)
      selectAll(r.at)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  const fenceRef = useRef<HTMLDivElement>(null)
  // A box dragged from empty space (or an empty slot) selects the clips it touches.
  const fence = (e: React.PointerEvent): void => {
    const t = e.target as HTMLElement
    if (e.button !== 0 || t.closest('.clip-slot:not(.empty), .ch-head, button.scene-launch')) return
    const { pointerId, clientX: x0, clientY: y0 } = e
    const box = fenceRef.current
    let active = false
    const move = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId) return
      if (!active && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 8) return
      active = true
      const l = Math.min(x0, ev.clientX)
      const r = Math.max(x0, ev.clientX)
      const tp = Math.min(y0, ev.clientY)
      const b = Math.max(y0, ev.clientY)
      if (box)
        Object.assign(box.style, {
          display: 'block',
          left: `${l}px`,
          top: `${tp}px`,
          width: `${r - l}px`,
          height: `${b - tp}px`
        })
      const hits: Selected[] = []
      for (const el of document.querySelectorAll<HTMLElement>(
        '.clip-slot[data-scene]:not(.empty)'
      )) {
        const q = el.getBoundingClientRect()
        if (q.right > l && q.left < r && q.bottom > tp && q.top < b)
          hits.push({ channel: el.dataset.channel!, scene: Number(el.dataset.scene) })
      }
      setMulti(hits)
      if (hits[0]) setSelected(hits[0])
    }
    const up = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointerId) return
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      if (box) box.style.display = 'none'
      if (active) endDrag()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  const slotMenu = (sel: Selected, x: number, y: number): void => {
    const sels = inGroup(sel.channel, sel.scene) ? group : [sel]
    if (!inGroup(sel.channel, sel.scene)) selectOne(sel)
    const n = sels.filter((s) => clipAt(s)).length
    const what = n > 1 ? ` ${n} clips` : ''
    setMenu({
      x,
      y,
      sections: [
        {
          items: [
            ...(n ? [{ label: `Copy${what}`, onSelect: () => copyClips(sels) }] : []),
            ...(clipboard.current ? [{ label: 'Paste', onSelect: () => pasteClips(sel) }] : []),
            ...(n
              ? [
                  { label: `Duplicate${what}`, onSelect: () => duplicateClips(sels) },
                  { label: `Delete${what}`, danger: true, onSelect: () => deleteClips(sels) }
                ]
              : [])
          ]
        }
      ]
    })
  }
  const keysRef = useRef<(e: KeyboardEvent) => void>(() => {})
  useEffect(() => {
    keysRef.current = (e) => {
      if ((e.target as HTMLElement).closest?.('input, textarea, select') || !selected) return
      const ctrl = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      // A picked node tile: Delete removes it, Ctrl+D copies it right after itself.
      const ni = pickedNode && selNodes ? selNodes.findIndex((n) => n.id === pickedNode) : -1
      if (ni >= 0 && !ctrl && (e.key === 'Delete' || e.key === 'Backspace')) {
        setNodes(selNodes!.filter((_, j) => j !== ni))
        setPickedNode(null)
      } else if (ni >= 0 && ctrl && k === 'd') {
        const n = selNodes![ni]
        const copy = {
          ...n,
          id: nodeId(n.type ?? 'node'),
          data: structuredClone(n.data)
        } as CanvasNode
        const next = [...selNodes!]
        next.splice(ni + 1, 0, copy)
        setNodes(next)
        setPickedNode(copy.id)
      } else if (ctrl && k === 'c') copyClips(group)
      else if (ctrl && k === 'v') pasteClips(selected)
      else if (ctrl && k === 'd') duplicateClips(group)
      else if (!ctrl && (e.key === 'Delete' || e.key === 'Backspace')) deleteClips(group)
      else return
      e.preventDefault()
    }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => keysRef.current(e)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const launchScene = (scene: number): void =>
    onLaunch(
      Object.fromEntries(
        song.channels
          .filter((c) => c.kind === 'track')
          .map((c) => [c.id, c.clips[scene] ? scene : null])
      )
    )

  // ---- Sounds dragged in from Samples: into the selected clip (at the front), else a
  // new channel with the sound and a sequencer to play it. ----
  const rootRef = useRef<HTMLDivElement>(null)
  const dropRef = useRef<(d: SoundDropDetail) => void>(() => {})
  useEffect(() => {
    dropRef.current = ({ sound, point }) => {
      const r = rootRef.current?.getBoundingClientRect()
      if (!r) return
      if (point && (point.x < r.left || point.x > r.right || point.y < r.top || point.y > r.bottom))
        return
      onSoundDropped(sound)
      const sample: CanvasNode = {
        id: nodeId('sample'),
        type: 'sample',
        position: { x: 0, y: 0 },
        data: {
          s: sound.s,
          pack: sound.pack,
          label: sound.label,
          n: sound.n ?? 0,
          slices: 8,
          files: sound.files
        }
      }
      const overEditor =
        point && document.elementFromPoint(point.x, point.y)?.closest('.clip-editor')
      if (overEditor && selNodes) return setNodes([sample, ...selNodes])
      const id = nodeId('ch')
      const seq: CanvasNode = {
        id: nodeId('seq'),
        type: 'sequencer',
        position: { x: 0, y: 0 },
        data: {
          kind: isBank(sample.data as never) ? 'slice' : 'degree',
          steps: [isBank(sample.data as never) ? 0 : 1],
          resolution: 16,
          octave: 3,
          muted: false
        }
      }
      onChange({
        ...song,
        channels: [
          ...song.channels,
          {
            id,
            name: sound.label ?? sound.s,
            kind: 'track',
            clips: song.scenes.map((_, i) =>
              i === 0 ? { id: nodeId('clip'), nodes: [sample, seq] } : null
            ),
            playing: null
          }
        ]
      })
      setSelected({ channel: id, scene: 0 })
    }
  })
  useEffect(() => {
    const listener = (e: Event): void => dropRef.current((e as CustomEvent<SoundDropDetail>).detail)
    window.addEventListener(SOUND_DROP_EVENT, listener)
    return () => window.removeEventListener(SOUND_DROP_EVENT, listener)
  }, [])

  const buses = song.channels.filter((c) => c.kind === 'bus')
  const columns = `repeat(${tracks.length}, 150px) 64px`
  const stripsRef = useRef<HTMLDivElement>(null)
  const anySolo = song.channels.some((c) => c.solo)

  return (
    <StepLensContext.Provider value={compiled.stepLens}>
      <SoundingContext.Provider value={compiled.sounding}>
        <div className="session" ref={rootRef}>
          <div className="canvas-tools">
            <span className="spacer" />
            <button onClick={() => addChannel('track')}>+ Channel</button>
            <button onClick={() => addChannel('bus')}>+ Bus</button>
            <button onClick={addScene}>+ Scene</button>
            <button className={showCode ? 'on' : ''} onClick={() => setShowCode(!showCode)}>
              {'</>'} Code
            </button>
          </div>
          {/* Clips scroll; the fader strips stay at the bottom edge, columns lined up. */}
          <div
            className="session-scroll"
            // Back in the clip grid: keys act on clips again.
            onPointerDownCapture={() => setPickedNode(null)}
            onPointerDown={fence}
            onScroll={(e) => {
              if (stripsRef.current) stripsRef.current.scrollLeft = e.currentTarget.scrollLeft
            }}
          >
            <div className="fence" ref={fenceRef} />
            <div className="session-grid" style={{ gridTemplateColumns: columns }}>
              {/* Channel headers */}
              {tracks.map((ch, i) => (
                <div
                  key={ch.id}
                  className={`ch-head ${ch.kind}`}
                  style={{ borderTopColor: channelColor(i) }}
                  onClick={() => ch.kind === 'bus' && setSelected({ channel: ch.id, scene: 0 })}
                >
                  {ch.name}
                </div>
              ))}
              <div className="ch-head corner" />
              {/* Scenes: one row each, a clip per channel, and the scene's launch button */}
              {song.scenes.map((sc, s) => (
                <SceneRow key={sc.id}>
                  {tracks.map((ch, i) => {
                    if (ch.kind === 'bus') return <div key={ch.id} className="clip-slot bus-slot" />
                    const clip = ch.clips[s] ?? null
                    const isSel = inGroup(ch.id, s)
                    const playingHere = ch.playing === s
                    // Waiting for the next bar: to start here, or to stop while playing here.
                    const waiting = ch.id in queued && (queued[ch.id] === s || playingHere)
                    if (!clip)
                      return (
                        <button
                          key={ch.id}
                          className={`clip-slot empty ${isSel ? 'selected' : ''}`}
                          data-channel={ch.id}
                          data-scene={s}
                          // First tap selects the slot (to paste into); a second makes a clip.
                          onClick={() =>
                            dragged.current
                              ? undefined
                              : isSel
                                ? newClip(ch.id, s)
                                : selectOne({ channel: ch.id, scene: s })
                          }
                          onContextMenu={(e) => {
                            e.preventDefault()
                            slotMenu({ channel: ch.id, scene: s }, e.clientX, e.clientY)
                          }}
                          title="New clip"
                        >
                          {ch.playing !== null && (
                            <span
                              className="slot-stop"
                              onClick={(e) => {
                                e.stopPropagation()
                                onLaunch({ [ch.id]: null })
                              }}
                            >
                              ■
                            </span>
                          )}
                        </button>
                      )
                    return (
                      <div
                        key={ch.id}
                        className={`clip-slot ${isSel ? 'selected' : ''} ${playingHere ? 'playing' : ''} ${waiting ? 'queued' : ''}`}
                        data-channel={ch.id}
                        data-scene={s}
                        onPointerDown={(e) => dragClip(e, { channel: ch.id, scene: s })}
                        style={{ background: channelColor(i) }}
                        onClick={() => !dragged.current && selectOne({ channel: ch.id, scene: s })}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          slotMenu({ channel: ch.id, scene: s }, e.clientX, e.clientY)
                        }}
                      >
                        <button
                          className="clip-launch"
                          title={playingHere ? 'Stop' : 'Play (on the next bar)'}
                          onClick={(e) => {
                            e.stopPropagation()
                            onLaunch({ [ch.id]: playingHere ? null : s })
                          }}
                        >
                          {playingHere ? '■' : '▶'}
                        </button>
                        <span className="clip-name">{clipTitle(clip)}</span>
                        <span className="clip-shape">
                          {clip.nodes.map((n) => (
                            <i
                              key={n.id}
                              className={n.data.muted ? 'off' : ''}
                              style={{ background: kindColor(nodeKind(n)) }}
                            />
                          ))}
                        </span>
                      </div>
                    )
                  })}
                  <button
                    className="scene-launch"
                    title={`Play scene ${sc.name}`}
                    onClick={() => launchScene(s)}
                  >
                    ▶ {sc.name}
                  </button>
                </SceneRow>
              ))}
            </div>
          </div>
          <div className="session-strips" ref={stripsRef}>
            <div className="session-grid" style={{ gridTemplateColumns: columns }}>
              {/* The fader section */}
              {tracks.map((ch, i) => (
                <Strip
                  key={ch.id}
                  ch={ch}
                  color={channelColor(i)}
                  buses={buses.filter((b) => b.id !== ch.id)}
                  dim={anySolo && !ch.solo && !compiled.sounding.has(ch.id)}
                  onPatch={(p) => update(ch.id, p)}
                  onSolo={(shift) => {
                    const changes = soloChanges(
                      song.channels.map((c) => ({ id: c.id, data: { solo: c.solo } })),
                      [ch.id],
                      shift
                    )
                    onChange({
                      ...song,
                      channels: song.channels.map((c) => {
                        const x = changes.find((y) => y.id === c.id)
                        return x ? { ...c, solo: x.solo } : c
                      })
                    })
                  }}
                  onSelect={() => ch.kind === 'bus' && setSelected({ channel: ch.id, scene: 0 })}
                />
              ))}
              <div className="strip master">
                <span className="strip-name">Master</span>
              </div>
            </div>
          </div>
          {showCode && <pre className="code-view">{compiled.code}</pre>}
          {menu && (
            <ContextMenu
              x={menu.x}
              y={menu.y}
              sections={menu.sections}
              searchable={menu.search}
              onClose={() => setMenu(null)}
            />
          )}
          {/* The selected clip, left to right: one editor per node. */}
          <div className={`panel-dock ${panelOpen ? '' : 'closed'}`}>
            <button
              className="panel-toggle"
              title={panelOpen ? 'Hide panel' : 'Show panel'}
              onClick={togglePanel}
            >
              {panelOpen ? '▾' : '▴'}
            </button>
            {panelOpen &&
              (selNodes ? (
                <div className="clip-editor">
                  <div
                    className="clip-title"
                    style={{
                      borderLeftColor: channelColor(tracks.findIndex((c) => c.id === selCh?.id))
                    }}
                  >
                    {selCh?.name}
                    {selCh?.kind === 'track' && (
                      <small>scene {song.scenes[selected!.scene]?.name}</small>
                    )}
                  </div>
                  {selNodes.map((n, i) => (
                    <div
                      key={n.id}
                      className={`clip-node ${n.data.muted ? 'off' : ''} ${pickedNode === n.id ? 'picked' : ''}`}
                      onPointerDownCapture={() => setPickedNode(n.id)}
                      style={{ borderTopColor: kindColor(nodeKind(n)) }}
                    >
                      <button
                        className="clip-add between"
                        title="Insert a node here"
                        onClick={(e) => insertAt(i, e.clientX, e.clientY)}
                      >
                        +
                      </button>
                      <NodeEditor
                        node={n}
                        nodes={selGraph.nodes}
                        edges={selGraph.edges}
                        onPatch={(patch) =>
                          setNodes(
                            selNodes.map((x) =>
                              x.id === n.id
                                ? ({ ...x, data: { ...x.data, ...patch } } as CanvasNode)
                                : x
                            )
                          )
                        }
                        grip={
                          <span
                            className="node-grip"
                            title="Drag to move; right-click or long-press for more"
                            onPointerDown={(e) => dragNode(e, i)}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              nodeMenu(i, e.clientX, e.clientY)
                            }}
                          >
                            ⠿
                          </span>
                        }
                      />
                    </div>
                  ))}
                  <button
                    className="clip-add end"
                    onClick={(e) => insertAt(selNodes.length, e.clientX, e.clientY)}
                  >
                    + Add
                  </button>
                </div>
              ) : (
                <div className="panel empty" />
              ))}
          </div>
        </div>
      </SoundingContext.Provider>
    </StepLensContext.Provider>
  )
}

// A scene row's cells (rendered straight into the grid).
function SceneRow({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <>{children}</>
}

// A channel strip: name, volume and pan faders (live), M/S, and where it plays out.
function Strip({
  ch,
  color,
  buses,
  dim,
  onPatch,
  onSolo,
  onSelect
}: {
  ch: Channel
  color: string
  buses: Channel[]
  dim: boolean
  onPatch: (p: Partial<Channel>) => void
  onSolo: (shift: boolean) => void
  onSelect: () => void
}): React.JSX.Element {
  const volume = ch.volume ?? 1
  const db = volume > 0 ? `${(20 * Math.log10(volume)).toFixed(1)}` : '−∞'
  return (
    <div
      className={`strip ${ch.kind} ${dim ? 'unheard' : ''}`}
      style={{ borderTopColor: color }}
      onClick={onSelect}
    >
      <div className="strip-ms">
        <button
          className={ch.muted ? 'on mute' : 'mute'}
          onClick={() => onPatch({ muted: !ch.muted })}
        >
          M
        </button>
        <button
          className={ch.solo ? 'on solo' : 'solo'}
          title="Solo (Shift: add)"
          onClick={(e) => onSolo(e.shiftKey)}
        >
          S
        </button>
      </div>
      <div className="strip-faders">
        <ParamFader
          label="vol"
          display={db}
          value={volume}
          min={0}
          max={BUS_MAX_VOLUME}
          onChange={(v) => onPatch({ volume: v })}
        />
        <ParamFader
          label="pan"
          value={ch.pan ?? 0}
          min={-1}
          max={1}
          onChange={(v) => onPatch({ pan: v })}
        />
      </div>
      <span className="strip-db">{db} dB</span>
      {ch.kind === 'track' && (
        <select
          className="strip-out"
          value={ch.output ?? ''}
          onChange={(e) => onPatch({ output: e.target.value || null })}
        >
          <option value="">Master</option>
          {buses.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

export default Session
