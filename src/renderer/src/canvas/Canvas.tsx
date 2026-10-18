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
import { EffectNode, GroupNode, KeyNode, LengthNode, ModeNode, SampleNode, SequencerNode, VelocityNode } from './nodes'
import { GROUP_TOGGLE_EVENT, groupNodes, removeNode, setCollapsed, ungroup } from './groups'
import { compile } from './codegen'
import { SOUND_DROP_EVENT, SoundDropDetail } from './soundDrag'
import ContextMenu, { MenuItem, MenuSection } from './ContextMenu'
import Panel from './Panel'
import { TOGGLE_CODE_EVENT } from '../events'
import {
  CanvasNode,
  CanvasState,
  DraggedSound,
  newKey,
  newMode,
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

// Hold this long without moving to open a node's menu.
const LONG_PRESS_MS = 500

const nodeTypes = { sample: SampleNode, sequencer: SequencerNode, key: KeyNode, mode: ModeNode, velocity: VelocityNode, length: LengthNode, effect: EffectNode, group: GroupNode }

// Handles only connect to the same-named handle: sound→sound, mode→mode.
const isValidConnection: IsValidConnection = (c) => c.sourceHandle === c.targetHandle && c.source !== c.target

// What the add menu can create: a sequencer kind, a mode node, or a synth sound.
type NewKind = SequencerKind | 'key' | 'mode' | 'velocity' | 'length' | `fx:${EffectKind}` | `synth:${string}`

// A wire dragged out of a handle and dropped on empty canvas.
interface Pending {
  nodeId: string
  handle: 'sound' | 'key' | 'mode' | 'pattern'
  handleType: 'source' | 'target'
}

type Menu =
  | { type: 'add'; x: number; y: number; flow: { x: number; y: number }; pending?: Pending }
  | { type: 'node'; x: number; y: number; nodeId: string }

function Canvas({ state, onChange, onSoundDropped }: Props): React.JSX.Element {
  const { screenToFlowPosition, updateNodeData } = useReactFlow()
  const [showCode, setShowCode] = useState(false)
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
    (changes: NodeChange<CanvasNode>[]) =>
      commit({ nodes: applyNodeChanges(changes, stateRef.current.nodes), edges: stateRef.current.edges }),
    [commit]
  )
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) =>
      commit({ nodes: stateRef.current.nodes, edges: applyEdgeChanges(changes, stateRef.current.edges) }),
    [commit]
  )
  // Each input takes one connection: a new one replaces the old.
  const onConnect = useCallback(
    (c: Connection) => {
      const { nodes: ns, edges: es } = stateRef.current
      const kept = es.filter((e) => !(e.target === c.target && e.targetHandle === c.targetHandle))
      commit({ nodes: ns, edges: addEdge(c, kept) })
    },
    [commit]
  )

  const add = (node: CanvasNode, edge?: Edge): void => {
    // A new wire into an input replaces whatever was wired there.
    const kept = edge ? edges.filter((e) => !(e.target === edge.target && e.targetHandle === edge.targetHandle)) : edges
    onChange({ nodes: [...nodes, node], edges: edge ? [...kept, edge] : edges })
  }

  const remove = (id: string): void => onChange(removeNode(state, id))

  // ---- Menus: tap empty canvas = add, tap a node = node menu, drop a wire on empty = add + connect ----
  const [menu, setMenu] = useState<Menu | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  const makeNode = (kind: NewKind, position: { x: number; y: number }): CanvasNode => {
    if (kind === 'key') return { id: nodeId('key'), type: 'key', position, data: newKey() }
    if (kind === 'mode') return { id: nodeId('mode'), type: 'mode', position, data: newMode() }
    if (kind.startsWith('fx:'))
      return { id: nodeId('fx'), type: 'effect', position, data: newEffect(kind.slice(3) as EffectKind) }
    if (kind === 'length') return { id: nodeId('len'), type: 'length', position, data: newLength() }
    if (kind === 'velocity') return { id: nodeId('vel'), type: 'velocity', position, data: newVelocity() }
    if (kind.startsWith('synth:'))
      return { id: nodeId('sample'), type: 'sample', position, data: { s: kind.slice(6), n: 0, slices: 8 } }
    return { id: nodeId('seq'), type: 'sequencer', position, data: newSequencer(kind as SequencerKind) }
  }

  // What can be added, given the wire (if any) being dropped.
  const addSections = (m: Extract<Menu, { type: 'add' }>): MenuSection[] => {
    const sequencers: [NewKind, string][] = [
      ['degree', 'Notes sequencer'],
      ['trigger', 'Rhythm sequencer'],
      ['slice', 'Slices sequencer']
    ]
    const key: [NewKind, string] = ['key', 'Key sequencer']
    const mode: [NewKind, string] = ['mode', 'Mode sequencer']
    const velocity: [NewKind, string] = ['velocity', 'Velocity sequencer']
    const length: [NewKind, string] = ['length', 'Length sequencer']
    const effects: [NewKind, string][] = (Object.keys(EFFECTS) as EffectKind[]).map((k) => [`fx:${k}`, EFFECTS[k].label])
    const synths: [NewKind, string][] = SYNTHS.map((s) => [`synth:${s}`, s])
    const { pending } = m

    let groups: { title: string; kinds: [NewKind, string][] }[]
    if (!pending)
      groups = [
        { title: 'Sequencers', kinds: sequencers },
        { title: 'Shape', kinds: [velocity, length] },
        { title: 'Effects', kinds: effects },
        { title: 'Harmony', kinds: [key, mode] },
        { title: 'Synths', kinds: synths }
      ]
    else if (pending.handleType === 'source')
      groups = {
        sound: [{ title: 'Play it with', kinds: sequencers }],
        key: [{ title: 'Apply to', kinds: [sequencers[0]] }],
        mode: [{ title: 'Apply to', kinds: [sequencers[0]] }],
        pattern: [
          { title: 'Shape', kinds: [velocity, length] },
          { title: 'Harmony', kinds: [key, mode] },
          { title: 'Effects', kinds: effects }
        ]
      }[pending.handle]
    else
      groups = {
        sound: [{ title: 'Sound from', kinds: synths }],
        key: [{ title: 'Key from', kinds: [key] }],
        mode: [{ title: 'Mode from', kinds: [mode] }],
        pattern: [{ title: 'Pattern from', kinds: sequencers }]
      }[pending.handle]

    return groups.map((g) => ({
      title: g.title,
      items: g.kinds.map(([kind, label]) => ({
        label,
        onSelect: () => {
          const node = makeNode(kind, m.flow)
          if (!pending) return add(node)
          const [source, target] =
            pending.handleType === 'source' ? [pending.nodeId, node.id] : [node.id, pending.nodeId]
          add(node, {
            id: `e-${source}-${target}-${pending.handle}`,
            source,
            target,
            sourceHandle: pending.handle,
            targetHandle: pending.handle
          })
        }
      }))
    }))
  }

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
            { label: 'Group', onSelect: () => onChange(groupNodes(state, [id])) },
            { label: 'Delete', danger: true, onSelect: () => remove(id) }
          ]
        }
      ]
    // Tapping one of several selected nodes acts on the whole selection.
    const selected = nodes.filter((n) => n.selected && !n.parentId && n.type !== 'group').map((n) => n.id)
    const targets = node.selected && selected.length > 1 ? selected : [id]
    const items: MenuItem[] = []
    if (!node.parentId)
      items.push({
        label: targets.length > 1 ? `Group ${targets.length} nodes` : 'Group',
        onSelect: () => onChange(groupNodes(state, targets))
      })
    items.push({
      label: targets.length > 1 ? `Delete ${targets.length} nodes` : 'Delete',
      danger: true,
      onSelect: () => onChange(targets.reduce((s, t) => removeNode(s, t), state))
    })
    return [{ items }]
  }

  // A group's collapse arrow.
  useEffect(() => {
    const listener = (e: Event): void => {
      const id = (e as CustomEvent<string>).detail
      const group = stateRef.current.nodes.find((n) => n.id === id)
      if (group?.type === 'group') onChangeRef.current(setCollapsed(stateRef.current, id, !group.data.collapsed))
    }
    window.addEventListener(GROUP_TOGGLE_EVENT, listener)
    return () => window.removeEventListener(GROUP_TOGGLE_EVENT, listener)
  }, [])

  const openAdd = (x: number, y: number, pending?: Pending): void =>
    setMenu({ type: 'add', x, y, flow: screenToFlowPosition({ x, y }), pending })

  // Empty canvas: tap clears the selection, long-press (or right-click) opens the add
  // menu, drag fences a selection (React Flow), two fingers / trackpad scroll pan.
  const onPaneClick = (): void => {
    if (nodes.some((n) => n.selected)) onChange({ nodes: nodes.map((n) => ({ ...n, selected: false })), edges })
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

  // Dragging from an input that already has a wire picks the wire up: it's removed at
  // once, so letting go on empty canvas just disconnects (no add menu), and letting go
  // on another output reconnects the input there.
  const detachedRef = useRef(false)
  const onConnectStart: OnConnectStart = (_e, { nodeId, handleId, handleType }) => {
    detachedRef.current = false
    if (handleType !== 'target' || !nodeId) return
    const { nodes: ns, edges: es } = stateRef.current
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
  const CHAIN_TYPES = new Set(['velocity', 'length', 'key', 'mode', 'effect'])
  const insertRef = useRef<{ edgeId: string; el: Element } | null>(null)

  const clearInsert = (): void => {
    insertRef.current?.el.classList.remove('insert-target')
    insertRef.current = null
  }

  // A pattern wire under the pointer, for a free chain node (no pattern wires yet).
  const wireUnder = (e: MouseEvent | TouchEvent, node: CanvasNode): { edgeId: string; el: Element } | null => {
    if (!CHAIN_TYPES.has(node.type ?? '')) return null
    const es = stateRef.current.edges
    if (es.some((x) => (x.source === node.id || x.target === node.id) && x.sourceHandle === 'pattern')) return null
    const p = 'changedTouches' in e ? e.changedTouches[0] : e
    for (const el of document.elementsFromPoint(p.clientX, p.clientY)) {
      const g = el.closest('.react-flow__edge')
      const id = g?.getAttribute('data-id')
      const edge = id ? es.find((x) => x.id === id) : undefined
      if (g && edge?.sourceHandle === 'pattern') return { edgeId: edge.id, el: g }
    }
    return null
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
    commit({ nodes: ns, edges: [...es.filter((x) => x !== wire), link(wire.source, node.id), link(node.id, wire.target)] })
  }

  // ---- Sounds dragged in from the Samples tab (window events, see soundDrag.ts) ----
  const dropRef = useRef<(d: SoundDropDetail) => void>(() => {})
  useEffect(() => {
    dropRef.current = ({ sound, point }) => {
      const r = rootRef.current?.getBoundingClientRect()
      if (!r) return
      if (point && (point.x < r.left || point.x > r.right || point.y < r.top || point.y > r.bottom)) return
      onSoundDropped(sound)
      const at = point ?? { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      add({
        id: nodeId('sample'),
        type: 'sample',
        position: screenToFlowPosition(at),
        data: { s: sound.s, pack: sound.pack, label: sound.label, n: sound.n ?? 0, slices: 8, files: sound.files }
      })
    }
  })
  useEffect(() => {
    const listener = (e: Event): void => dropRef.current((e as CustomEvent<SoundDropDetail>).detail)
    window.addEventListener(SOUND_DROP_EVENT, listener)
    return () => window.removeEventListener(SOUND_DROP_EVENT, listener)
  }, [])

  const compiled = useMemo(() => compile(nodes, edges), [nodes, edges])

  return (
    <div className="canvas" ref={rootRef} onPointerDownCapture={onPointerDownCapture}>
      <div className="canvas-tools">
        <span className="spacer" />
        <button className={showCode ? 'on' : ''} onClick={() => setShowCode(!showCode)}>
          {'</>'} Code
        </button>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
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
        panOnDrag={[1, 2]}
        panOnScroll
        onNodeClick={onNodeClick}
        onNodeContextMenu={onNodeContextMenu}
        isValidConnection={isValidConnection}
        // How near a dropped wire must land to snap to an input, in screen px (default 20).
        connectionRadius={44}
        colorMode="dark"
        fitView
        minZoom={0.2}
        deleteKeyCode={['Delete', 'Backspace']}
      >
        <Background gap={24} />
        <Controls />
      </ReactFlow>
      {nodes.length === 0 && (
        <div className="canvas-empty">Drag a sound in from Samples, or tap the canvas to add a node.</div>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          sections={menu.type === 'add' ? addSections(menu) : nodeSections(menu.nodeId)}
          onClose={closeMenu}
        />
      )}
      {showCode && <pre className="code-view">{compiled.code}</pre>}
      <Panel nodes={nodes} edges={edges} />
    </div>
  )
}

export default Canvas
