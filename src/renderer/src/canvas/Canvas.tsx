import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Connection,
  Controls,
  Edge,
  EdgeChange,
  IsValidConnection,
  NodeChange,
  OnConnectEnd,
  OnConnectStart,
  ReactFlow,
  SelectionMode,
  useReactFlow
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  EffectNode,
  GroupNode,
  KeyNode,
  LengthNode,
  LfoNode,
  DuckNode,
  MixNode,
  ModeNode,
  OctaveNode,
  SampleNode,
  SequencerNode,
  VelocityNode
} from './nodes'
import {
  dissolveNode,
  duplicateNodes,
  GROUP_TOGGLE_EVENT,
  fitGroups,
  groupNodes,
  setCollapsed,
  ungroup
} from './groups'
import { compile } from './codegen'
import { SOUND_DROP_EVENT, SoundDropDetail } from './soundDrag'
import ContextMenu, { MenuItem, MenuSection } from './ContextMenu'
import Panel from './Panel'
import { SoundingContext, StepLensContext } from './stepLens'
import { TOGGLE_CODE_EVENT, TOGGLE_PANEL_EVENT } from '../events'
import {
  CanvasNode,
  CanvasState,
  DraggedSound,
  newKey,
  newMode,
  newOctave,
  newLfo,
  newDuck,
  MOD_PREFIX,
  newSequencer,
  newEffect,
  newLength,
  newVelocity,
  EFFECTS,
  EffectKind,
  nodeId,
  SequencerKind,
  SYNTHS
} from './model'

interface Props {
  state: CanvasState
  onChange: (state: CanvasState) => void
  // Called before a dropped sound is used, so its pack is registered with Strudel.
  onSoundDropped: (sound: DraggedSound) => void
}

const PANEL_KEY = 'ev-strudel:panel'

// Same colours as the node title bars (main.css), so the add menu reads like the canvas.
const NODE_COLORS = {
  sequencer: '#3a5a8a',
  velocity: '#8a6a3a',
  length: '#3a6a8a',
  effect: '#3a7a7a',
  key: '#7a4a9a',
  mode: '#9a4a7a',
  octave: '#5a4a9a',
  sample: '#3a7a4a',
  mix: '#777777',
  lfo: '#8a8a2a',
  duck: '#8a4a3a'
}
function kindColor(kind: string): string {
  if (kind.startsWith('fx:')) return NODE_COLORS.effect
  if (kind.startsWith('synth:')) return NODE_COLORS.sample
  if (kind === 'degree' || kind === 'slice') return NODE_COLORS.sequencer
  return NODE_COLORS[kind as keyof typeof NODE_COLORS] ?? '#555'
}

// Hold this long without moving to open a node's menu.
const LONG_PRESS_MS = 500

const nodeTypes = {
  sample: SampleNode,
  sequencer: SequencerNode,
  mix: MixNode,
  lfo: LfoNode,
  duck: DuckNode,
  key: KeyNode,
  mode: ModeNode,
  octave: OctaveNode,
  velocity: VelocityNode,
  length: LengthNode,
  effect: EffectNode,
  group: GroupNode
}

// Pattern outputs connect to pattern inputs; an LFO's mod output connects to any
// modulation input (Bus Volume/Pan, LFO Rate/Depth).
const isValidConnection: IsValidConnection = (c) =>
  c.source !== c.target &&
  (c.sourceHandle === 'mod'
    ? !!c.targetHandle?.startsWith(MOD_PREFIX)
    : c.sourceHandle === c.targetHandle)

// What the add menu can create: a sequencer kind, a mode node, or a synth sound.
type NewKind =
  | SequencerKind
  | 'mix'
  | 'lfo'
  | 'duck'
  | 'octave'
  | 'key'
  | 'mode'
  | 'velocity'
  | 'length'
  | `fx:${EffectKind}`
  | `synth:${string}`

// A wire dragged out of a handle and dropped on empty canvas.
interface Pending {
  nodeId: string
  // 'mod' (an LFO output) or 'mod:<param>' (a modulation input) for mod wires.
  handle: string
  handleType: 'source' | 'target'
}

type Menu =
  | { type: 'add'; x: number; y: number; flow: { x: number; y: number }; pending?: Pending }
  | { type: 'node'; x: number; y: number; nodeId: string }

function Canvas({ state, onChange, onSoundDropped }: Props): React.JSX.Element {
  const { screenToFlowPosition, updateNodeData } = useReactFlow()
  const [showCode, setShowCode] = useState(false)
  const [panelOpen, setPanelOpen] = useState(() => {
    try {
      return localStorage.getItem(PANEL_KEY) !== 'closed'
    } catch {
      return true
    }
  })
  const togglePanel = useCallback(() => {
    setPanelOpen((open) => {
      try {
        localStorage.setItem(PANEL_KEY, open ? 'closed' : 'open')
      } catch {
        // Convenience only.
      }
      return !open
    })
  }, [])
  useEffect(() => {
    window.addEventListener(TOGGLE_PANEL_EVENT, togglePanel)
    return () => window.removeEventListener(TOGGLE_PANEL_EVENT, togglePanel)
  }, [togglePanel])
  useEffect(() => {
    const toggle = (): void => setShowCode((s) => !s)
    window.addEventListener(TOGGLE_CODE_EVENT, toggle)
    return () => window.removeEventListener(TOGGLE_CODE_EVENT, toggle)
  }, [])
  const rootRef = useRef<HTMLDivElement>(null)
  const { nodes, edges } = state
  // The latest state, including changes not rendered yet. One tap can produce
  // several changes in the same tick (React Flow selecting the node, plus the grid
  // painting a cell); each must build on the one before, or the later one wipes
  // out the earlier (the first tap on an unselected node used to lose its edit).
  const stateRef = useRef(state)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    stateRef.current = state
    onChangeRef.current = onChange
  })
  const commit = useCallback((next: CanvasState) => {
    stateRef.current = next
    onChangeRef.current(next)
  }, [])

  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      const next = {
        nodes: applyNodeChanges(changes, stateRef.current.nodes),
        edges: stateRef.current.edges
      }
      // Group frames fit their contents, except mid-drag (moving the frame under a node
      // being dragged would fight the drag): they catch up when it's dropped.
      const dragging = changes.some((ch) => ch.type === 'position' && ch.dragging)
      commit(dragging ? next : fitGroups(next))
    },
    [commit]
  )
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) =>
      commit({
        nodes: stateRef.current.nodes,
        edges: applyEdgeChanges(changes, stateRef.current.edges)
      }),
    [commit]
  )
  // Each input takes one connection: a new one replaces the old.
  const onConnect = useCallback(
    (c: Connection) => {
      const { nodes: ns, edges: es } = stateRef.current
      // Inputs take several wires: parameter chains and playing chains combine there.
      commit({ nodes: ns, edges: addEdge(c, es) })
    },
    [commit]
  )

  const add = (node: CanvasNode, edge?: Edge): void => {
    // Inputs take several wires; a new one is added alongside.
    onChange({ nodes: [...nodes, node], edges: edge ? [...edges, edge] : edges })
  }

  // Deleting dissolves: the chain is reconnected through the removed node.
  const remove = (id: string): void => onChange(dissolveNode(state, id))

  // ---- Menus: tap empty canvas = add, tap a node = node menu, drop a wire on empty = add + connect ----
  const [menu, setMenu] = useState<Menu | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  const makeNode = (kind: NewKind, position: { x: number; y: number }): CanvasNode => {
    if (kind === 'mix')
      return { id: nodeId('mix'), type: 'mix', position, data: { volume: 1, pan: 0 } }
    if (kind === 'lfo') return { id: nodeId('lfo'), type: 'lfo', position, data: newLfo() }
    if (kind === 'duck') return { id: nodeId('duck'), type: 'duck', position, data: newDuck() }
    if (kind === 'octave') return { id: nodeId('oct'), type: 'octave', position, data: newOctave() }
    if (kind === 'key') return { id: nodeId('key'), type: 'key', position, data: newKey() }
    if (kind === 'mode') return { id: nodeId('mode'), type: 'mode', position, data: newMode() }
    if (kind.startsWith('fx:'))
      return {
        id: nodeId('fx'),
        type: 'effect',
        position,
        data: newEffect(kind.slice(3) as EffectKind)
      }
    if (kind === 'length') return { id: nodeId('len'), type: 'length', position, data: newLength() }
    if (kind === 'velocity')
      return { id: nodeId('vel'), type: 'velocity', position, data: newVelocity() }
    if (kind.startsWith('synth:'))
      return {
        id: nodeId('sample'),
        type: 'sample',
        position,
        data: { s: kind.slice(6), n: 0, slices: 8 }
      }
    return {
      id: nodeId('seq'),
      type: 'sequencer',
      position,
      data: newSequencer(kind as SequencerKind)
    }
  }

  // What can be added, given the wire (if any) being dropped.
  const addSections = (m: Extract<Menu, { type: 'add' }>): MenuSection[] => {
    const sequencers: [NewKind, string][] = [
      ['degree', 'Notes sequencer'],
      ['slice', 'Slices sequencer']
    ]
    const mix: [NewKind, string] = ['mix', 'Bus']
    const lfo: [NewKind, string] = ['lfo', 'LFO']
    const duck: [NewKind, string] = ['duck', 'Duck (sidechain)']
    const key: [NewKind, string] = ['key', 'Key sequencer']
    const mode: [NewKind, string] = ['mode', 'Mode sequencer']
    const octave: [NewKind, string] = ['octave', 'Octave sequencer']
    const velocity: [NewKind, string] = ['velocity', 'Velocity sequencer']
    const length: [NewKind, string] = ['length', 'Length sequencer']
    const effects: [NewKind, string][] = (Object.keys(EFFECTS) as EffectKind[]).map((k) => [
      `fx:${k}`,
      EFFECTS[k].label
    ])
    const synths: [NewKind, string][] = SYNTHS.map((s) => [`synth:${s}`, s])
    const { pending } = m

    let groups: { title: string; kinds: [NewKind, string][] }[] | undefined
    if (!pending)
      groups = [
        { title: 'Sequencers', kinds: sequencers },
        { title: 'Shape', kinds: [velocity, length] },
        { title: 'Effects', kinds: effects },
        { title: 'Harmony', kinds: [key, mode, octave] },
        { title: 'Sound', kinds: synths },
        { title: 'Route', kinds: [mix, duck] },
        { title: 'Modulate', kinds: [lfo] }
      ]
    // A duck wire: from a Duck, a Bus to dip; into a Bus's duck input, a Duck.
    else if (pending.handle === 'duck')
      groups =
        pending.handleType === 'source'
          ? [{ title: 'Duck', kinds: [mix] }]
          : [{ title: 'Ducked by', kinds: [duck] }]
    // A mod wire: from an LFO output, offer what it can drive; into a mod input, an LFO.
    else if (pending.handle.startsWith('mod'))
      groups =
        pending.handleType === 'source'
          ? [{ title: 'Modulate', kinds: [mix, lfo] }]
          : [{ title: 'Modulate with', kinds: [lfo] }]
    else if (pending.handleType === 'source')
      groups = {
        sound: [{ title: 'Play it with', kinds: sequencers }],
        key: [{ title: 'Apply to', kinds: [sequencers[0]] }],
        mode: [{ title: 'Apply to', kinds: [sequencers[0]] }],
        pattern: [
          { title: 'Sound', kinds: synths },
          { title: 'Shape', kinds: [velocity, length] },
          { title: 'Harmony', kinds: [key, mode, octave] },
          { title: 'Effects', kinds: effects },
          { title: 'Route', kinds: [mix, duck] }
        ]
      }[pending.handle]
    else
      groups = {
        sound: [{ title: 'Sound from', kinds: synths }],
        key: [{ title: 'Key from', kinds: [key] }],
        mode: [{ title: 'Mode from', kinds: [mode] }],
        pattern: [
          { title: 'Pattern from', kinds: sequencers },
          { title: 'Shape', kinds: [velocity, length] },
          { title: 'Harmony', kinds: [key, mode, octave] },
          { title: 'Route', kinds: [mix, duck] }
        ]
      }[pending.handle]

    // Mod wires land on the new node's first modulation input (Bus Volume, LFO Rate).
    const handles = (kind: NewKind): [string, string] => {
      if (!pending?.handle.startsWith('mod')) return [pending?.handle ?? '', pending?.handle ?? '']
      if (pending.handleType === 'target') return ['mod', pending.handle]
      return ['mod', MOD_PREFIX + (kind === 'mix' ? 'volume' : 'rate')]
    }

    return (groups ?? []).map((g) => ({
      title: g.title,
      items: g.kinds.map(([kind, label]) => ({
        label,
        color: kindColor(kind),
        onSelect: () => {
          const node = makeNode(kind, m.flow)
          if (!pending) return add(node)
          const [source, target] =
            pending.handleType === 'source' ? [pending.nodeId, node.id] : [node.id, pending.nodeId]
          const [sourceHandle, targetHandle] = handles(kind)
          add(node, {
            id: `e-${source}-${target}-${targetHandle}`,
            source,
            target,
            sourceHandle,
            targetHandle
          })
        }
      }))
    }))
  }

  // Mute / Solo for the chains through these nodes (see compile). All targets follow
  // the tapped node: if it's off, they all turn on.
  const muteSoloItems = (node: CanvasNode, targets: string[]): MenuItem[] =>
    (['muted', 'solo'] as const).map((key) => {
      const on = !!(node.data as { muted?: boolean; solo?: boolean })[key]
      return {
        label: key === 'muted' ? (on ? 'Unmute' : 'Mute') : on ? 'Unsolo' : 'Solo',
        onSelect: () =>
          onChange({
            nodes: nodes.map((n) =>
              targets.includes(n.id) ? ({ ...n, data: { ...n.data, [key]: !on } } as CanvasNode) : n
            ),
            edges
          })
      }
    })

  const nodeSections = (id: string): MenuSection[] => {
    const node = nodes.find((n) => n.id === id)
    if (!node) return []
    if (node.type === 'group')
      return [
        {
          items: [
            {
              label: node.data.collapsed ? 'Expand' : 'Collapse',
              onSelect: () => onChange(setCollapsed(state, id, !node.data.collapsed))
            },
            { label: 'Ungroup', onSelect: () => onChange(ungroup(state, id)) },
            { label: 'Delete group and contents', danger: true, onSelect: () => remove(id) }
          ]
        }
      ]
    if (node.type === 'effect')
      return [
        {
          items: [
            {
              label: node.data.bypass ? 'Turn on' : 'Bypass',
              onSelect: () => updateNodeData(id, { bypass: !node.data.bypass })
            },
            ...muteSoloItems(node, [id]),
            { label: 'Group', onSelect: () => onChange(groupNodes(state, [id])) },
            { label: 'Delete', danger: true, onSelect: () => remove(id) }
          ]
        }
      ]
    // Tapping one of several selected nodes acts on the whole selection.
    const selected = nodes
      .filter((n) => n.selected && !n.parentId && n.type !== 'group')
      .map((n) => n.id)
    const targets = node.selected && selected.length > 1 ? selected : [id]
    const items: MenuItem[] = [...muteSoloItems(node, targets)]
    if (!node.parentId)
      items.push({
        label: targets.length > 1 ? `Group ${targets.length} nodes` : 'Group',
        onSelect: () => onChange(groupNodes(state, targets))
      })
    items.push({
      label: targets.length > 1 ? `Duplicate ${targets.length} nodes` : 'Duplicate',
      onSelect: () => onChange(duplicateNodes(state, targets))
    })
    items.push({
      label: targets.length > 1 ? `Delete ${targets.length} nodes` : 'Delete',
      danger: true,
      onSelect: () => onChange(targets.reduce((s, t) => dissolveNode(s, t), state))
    })
    return [{ items }]
  }

  // Ctrl+D duplicates the selected nodes, Ctrl+G groups them (not while typing in a field).
  // Delete/Backspace dissolves the selected nodes (and removes selected wires).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement).closest?.('input, textarea, select')) return
      const { nodes: ns, edges: es } = stateRef.current
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        const ids = ns.filter((n) => n.selected).map((n) => n.id)
        if (ids.length) commit(duplicateNodes(stateRef.current, ids))
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
        e.preventDefault()
        const ids = ns.filter((n) => n.selected && n.type !== 'group').map((n) => n.id)
        if (ids.length) commit(groupNodes(stateRef.current, ids))
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const ids = ns.filter((n) => n.selected).map((n) => n.id)
        const wires = es.filter((x) => x.selected)
        if (!ids.length && !wires.length) return
        e.preventDefault()
        const kept = { nodes: ns, edges: es.filter((x) => !wires.includes(x)) }
        commit(ids.reduce((s, id) => dissolveNode(s, id), kept))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [commit])

  // A group's collapse arrow.
  useEffect(() => {
    const listener = (e: Event): void => {
      const id = (e as CustomEvent<string>).detail
      const group = stateRef.current.nodes.find((n) => n.id === id)
      if (group?.type === 'group')
        onChangeRef.current(setCollapsed(stateRef.current, id, !group.data.collapsed))
    }
    window.addEventListener(GROUP_TOGGLE_EVENT, listener)
    return () => window.removeEventListener(GROUP_TOGGLE_EVENT, listener)
  }, [])

  const openAdd = (x: number, y: number, pending?: Pending): void =>
    setMenu({ type: 'add', x, y, flow: screenToFlowPosition({ x, y }), pending })

  // Empty canvas: tap clears the selection, long-press (or right-click) opens the add
  // menu, drag fences a selection (React Flow), two fingers / trackpad scroll pan.
  const onPaneClick = (): void => {
    if (nodes.some((n) => n.selected))
      onChange({ nodes: nodes.map((n) => ({ ...n, selected: false })), edges })
  }
  const onPaneContextMenu = (e: React.MouseEvent | MouseEvent): void => {
    e.preventDefault()
    openAdd(e.clientX, e.clientY)
  }

  // With several nodes selected, a tap on a selected node acts on the selection:
  // its controls (grid, faders) don't edit, and the node menu opens instead.
  // Tap a node to select it; long-press (or right-click) opens its menu.
  // Long-press works on the node's own surface (title bar, chip), not on controls
  // like the grid or faders, which use the press themselves.
  const onPointerDownCapture = (e: React.PointerEvent): void => {
    const target = e.target as HTMLElement
    if (target.classList.contains('react-flow__pane')) return longPress(e, (x, y) => openAdd(x, y))
    const id = target.closest<HTMLElement>('.react-flow__node')?.dataset.id
    if (!id) return
    const onControl = !!target.closest('.nodrag')

    // With several nodes selected, presses on a selected node's controls don't edit it.
    const selected = nodes.filter((n) => n.selected)
    if (onControl && selected.length > 1 && selected.some((n) => n.id === id)) {
      e.stopPropagation()
      e.preventDefault()
    } else if (onControl) return

    longPress(e, (x, y) => setMenu({ type: 'node', x, y, nodeId: id }))
  }

  // Call onHold if the press stays put for LONG_PRESS_MS; any real movement (a drag,
  // a fence, a pan) cancels it.
  function longPress(e: React.PointerEvent, onHold: (x: number, y: number) => void): void {
    const { pointerId, clientX: x, clientY: y } = e
    const timer = setTimeout(() => {
      cleanup()
      onHold(x, y)
    }, LONG_PRESS_MS)
    const move = (ev: PointerEvent): void => {
      if (ev.pointerId === pointerId && Math.hypot(ev.clientX - x, ev.clientY - y) > 8) cleanup()
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', cleanup)
      window.removeEventListener('pointercancel', cleanup)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', cleanup)
    window.addEventListener('pointercancel', cleanup)
  }

  const onNodeClick = (e: React.MouseEvent, node: CanvasNode): void => {
    // A plain tap just selects (React Flow does that); Ctrl+click deletes.
    if ((e.target as HTMLElement).closest('.nodrag, button, select, input, label')) return
    if (e.ctrlKey || e.metaKey) remove(node.id)
  }

  const onNodeContextMenu = (e: React.MouseEvent, node: CanvasNode): void => {
    e.preventDefault()
    setMenu({ type: 'node', x: e.clientX, y: e.clientY, nodeId: node.id })
  }

  // Dragging from a connected input disconnects all its wires at once: letting go on
  // empty canvas leaves it disconnected (no add menu), letting go on an output wires
  // the input to that output.
  const detachedRef = useRef(false)
  const onConnectStart: OnConnectStart = (_e, { nodeId, handleId, handleType }) => {
    detachedRef.current = false
    if (handleType !== 'target' || !nodeId) return
    const { nodes: ns, edges: es } = stateRef.current
    // Dragging off an input disconnects everything wired into it.
    const wired = es.filter((e) => e.target === nodeId && e.targetHandle === handleId)
    if (!wired.length) return
    detachedRef.current = true
    commit({ nodes: ns, edges: es.filter((e) => !wired.includes(e)) })
  }

  const onConnectEnd: OnConnectEnd = (e, conn) => {
    if (detachedRef.current) {
      detachedRef.current = false
      return
    }
    if (conn.isValid || !conn.fromNode || !conn.fromHandle?.id) return
    const p = 'changedTouches' in e ? e.changedTouches[0] : e
    openAdd(p.clientX, p.clientY, {
      nodeId: conn.fromNode.id,
      handle: conn.fromHandle.id as Pending['handle'],
      handleType: conn.fromHandle.type
    })
  }

  // ---- Blender-style insert: drag a chain node over a pattern wire to splice it in ----
  const CHAIN_TYPES = new Set([
    'sample',
    'velocity',
    'length',
    'key',
    'mode',
    'effect',
    'mix',
    'duck'
  ])
  const insertRef = useRef<{ edgeId: string; el: Element } | null>(null)

  const clearInsert = (): void => {
    insertRef.current?.el.classList.remove('insert-target')
    insertRef.current = null
  }

  // A pattern wire under the pointer, for a free chain node (no pattern wires yet).
  const wireUnder = (
    e: MouseEvent | TouchEvent,
    node: CanvasNode
  ): { edgeId: string; el: Element } | null => {
    if (!CHAIN_TYPES.has(node.type ?? '')) return null
    const es = stateRef.current.edges
    if (
      es.some((x) => (x.source === node.id || x.target === node.id) && x.sourceHandle === 'pattern')
    )
      return null
    // Like Blender: a wire counts if it passes under any part of the dragged node (a
    // little margin around it), not just the point under the finger. Nearest to the
    // node's centre wins.
    void e
    const box = document
      .querySelector(`.react-flow__node[data-id="${node.id}"]`)
      ?.getBoundingClientRect()
    if (!box) return null
    const pad = 12
    const cx = box.left + box.width / 2
    const cy = box.top + box.height / 2
    let best: { edgeId: string; el: Element; d: number } | null = null
    for (const g of document.querySelectorAll('.react-flow__edge')) {
      const edge = es.find((x) => x.id === g.getAttribute('data-id'))
      if (edge?.sourceHandle !== 'pattern') continue
      const path = g.querySelector<SVGPathElement>('.react-flow__edge-path')
      const ctm = path?.getScreenCTM()
      if (!path || !ctm) continue
      const total = path.getTotalLength()
      const samples = Math.max(8, Math.ceil(total / 12))
      for (let k = 0; k <= samples; k++) {
        const q = path.getPointAtLength((total * k) / samples)
        const s = new DOMPoint(q.x, q.y).matrixTransform(ctm)
        if (
          s.x < box.left - pad ||
          s.x > box.right + pad ||
          s.y < box.top - pad ||
          s.y > box.bottom + pad
        )
          continue
        const d = Math.hypot(s.x - cx, s.y - cy)
        if (!best || d < best.d) best = { edgeId: edge.id, el: g, d }
      }
    }
    return best && { edgeId: best.edgeId, el: best.el }
  }

  const onNodeDrag = (e: MouseEvent | TouchEvent, node: CanvasNode): void => {
    const hit = wireUnder(e, node)
    if (hit?.edgeId === insertRef.current?.edgeId) return
    clearInsert()
    if (hit) {
      hit.el.classList.add('insert-target')
      insertRef.current = hit
    }
  }

  const onNodeDragStop = (_e: MouseEvent | TouchEvent, node: CanvasNode): void => {
    const target = insertRef.current
    clearInsert()
    if (!target) return
    const { nodes: ns, edges: es } = stateRef.current
    const wire = es.find((x) => x.id === target.edgeId)
    if (!wire) return
    const link = (source: string, to: string): Edge => ({
      id: `e-${source}-${to}-pattern`,
      source,
      target: to,
      sourceHandle: 'pattern',
      targetHandle: 'pattern'
    })
    commit({
      nodes: ns,
      edges: [
        ...es.filter((x) => x !== wire),
        link(wire.source, node.id),
        link(node.id, wire.target)
      ]
    })
  }

  // ---- Sounds dragged in from the Samples tab (window events, see soundDrag.ts) ----
  const dropRef = useRef<(d: SoundDropDetail) => void>(() => {})
  useEffect(() => {
    dropRef.current = ({ sound, point }) => {
      const r = rootRef.current?.getBoundingClientRect()
      if (!r) return
      if (point && (point.x < r.left || point.x > r.right || point.y < r.top || point.y > r.bottom))
        return
      onSoundDropped(sound)
      const at = point ?? { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      add({
        id: nodeId('sample'),
        type: 'sample',
        position: screenToFlowPosition(at),
        data: {
          s: sound.s,
          pack: sound.pack,
          label: sound.label,
          n: sound.n ?? 0,
          slices: 8,
          files: sound.files
        }
      })
    }
  })
  useEffect(() => {
    const listener = (e: Event): void => dropRef.current((e as CustomEvent<SoundDropDetail>).detail)
    window.addEventListener(SOUND_DROP_EVENT, listener)
    return () => window.removeEventListener(SOUND_DROP_EVENT, listener)
  }, [])

  const compiled = useMemo(() => compile(nodes, edges), [nodes, edges])
  // Mod wires (LFO -> a modulation input) are drawn differently from pattern wires.
  const shownEdges = useMemo(
    () =>
      edges.map((e) =>
        (e.sourceHandle === 'mod' || e.sourceHandle === 'duck') && e.className !== 'mod-edge'
          ? { ...e, className: 'mod-edge' }
          : e
      ),
    [edges]
  )
  // Muted nodes dim, soloed ones get a ring.
  const shownNodes = useMemo(
    () =>
      nodes.map((n) => {
        const d = n.data as { muted?: boolean; solo?: boolean }
        const className =
          [d.muted && 'muted-node', d.solo && 'solo-node'].filter(Boolean).join(' ') || undefined
        return className === n.className ? n : { ...n, className }
      }),
    [nodes]
  )

  return (
    <StepLensContext.Provider value={compiled.stepLens}>
      <SoundingContext.Provider value={compiled.sounding}>
        <div className="canvas" ref={rootRef} onPointerDownCapture={onPointerDownCapture}>
          <div className="canvas-tools">
            <span className="spacer" />
            <button className={showCode ? 'on' : ''} onClick={() => setShowCode(!showCode)}>
              {'</>'} Code
            </button>
          </div>
          <ReactFlow
            nodes={shownNodes}
            edges={shownEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={onNodeDragStop}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            onPaneClick={onPaneClick}
            onPaneContextMenu={onPaneContextMenu}
            // Drag on empty canvas draws a selection box; pan with two fingers, trackpad
            // scroll or the middle/right mouse button; pinch or Ctrl+scroll zooms.
            selectionOnDrag
            selectionMode={SelectionMode.Partial}
            panOnDrag={[1]}
            panOnScroll
            onNodeClick={onNodeClick}
            onNodeContextMenu={onNodeContextMenu}
            isValidConnection={isValidConnection}
            // How near a dropped wire must land to snap to an input, in screen px (default 20).
            connectionRadius={44}
            colorMode="dark"
            fitView
            minZoom={0.2}
            // Our own Delete handler dissolves instead of breaking the chain.
            deleteKeyCode={null}
          >
            <Background gap={24} />
            <Controls />
          </ReactFlow>
          {nodes.length === 0 && (
            <div className="canvas-empty">
              Drag a sound in from Samples, or tap the canvas to add a node.
            </div>
          )}
          {menu && (
            <ContextMenu
              x={menu.x}
              y={menu.y}
              sections={menu.type === 'add' ? addSections(menu) : nodeSections(menu.nodeId)}
              searchable={menu.type === 'add'}
              onClose={closeMenu}
            />
          )}
          {showCode && <pre className="code-view">{compiled.code}</pre>}
          {/* Fixed-height dock (like Ableton's detail view); hidden only when the user hides it. */}
          <div className={`panel-dock ${panelOpen ? '' : 'closed'}`}>
            <button
              className="panel-toggle"
              title={panelOpen ? 'Hide panel' : 'Show panel'}
              onClick={togglePanel}
            >
              {panelOpen ? '▾' : '▴'}
            </button>
            {panelOpen && <Panel nodes={nodes} edges={edges} />}
          </div>
        </div>
      </SoundingContext.Provider>
    </StepLensContext.Provider>
  )
}

export default Canvas
