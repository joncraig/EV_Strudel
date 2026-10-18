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
  ReactFlow,
  useReactFlow
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { EffectNode, GroupNode, ModeNode, SampleNode, SequencerNode, VelocityNode } from './nodes'
import { GROUP_TOGGLE_EVENT, groupNodes, removeNode, setCollapsed, ungroup } from './groups'
import { compile } from './codegen'
import { SOUND_DROP_EVENT, SoundDropDetail } from './soundDrag'
import ContextMenu, { MenuItem, MenuSection } from './ContextMenu'
import Panel from './Panel'
import { useLongPressFence } from './useLongPressFence'
import {
  CanvasNode,
  CanvasState,
  DraggedSound,
  newMode,
  newSequencer,
  newEffect,
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

const nodeTypes = { sample: SampleNode, sequencer: SequencerNode, mode: ModeNode, velocity: VelocityNode, effect: EffectNode, group: GroupNode }

// Handles only connect to the same-named handle: sound→sound, mode→mode.
const isValidConnection: IsValidConnection = (c) => c.sourceHandle === c.targetHandle && c.source !== c.target

// What the add menu can create: a sequencer kind, a mode node, or a synth sound.
type NewKind = SequencerKind | 'mode' | 'velocity' | `fx:${EffectKind}` | `synth:${string}`

// A wire dragged out of a handle and dropped on empty canvas.
interface Pending {
  nodeId: string
  handle: 'sound' | 'mode' | 'pattern'
  handleType: 'source' | 'target'
}

type Menu =
  | { type: 'add'; x: number; y: number; flow: { x: number; y: number }; pending?: Pending }
  | { type: 'node'; x: number; y: number; nodeId: string }

function Canvas({ state, onChange, onSoundDropped }: Props): React.JSX.Element {
  const { screenToFlowPosition, getIntersectingNodes, updateNodeData } = useReactFlow()
  const [showCode, setShowCode] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const { nodes, edges } = state
  // For window event handlers that outlive a render.
  const stateRef = useRef(state)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    stateRef.current = state
    onChangeRef.current = onChange
  })

  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => onChange({ nodes: applyNodeChanges(changes, nodes), edges }),
    [nodes, edges, onChange]
  )
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => onChange({ nodes, edges: applyEdgeChanges(changes, edges) }),
    [nodes, edges, onChange]
  )
  // Each input takes one connection: a new one replaces the old.
  const onConnect = useCallback(
    (c: Connection) => {
      const kept = edges.filter((e) => !(e.target === c.target && e.targetHandle === c.targetHandle))
      onChange({ nodes, edges: addEdge({ ...c, animated: c.sourceHandle === 'mode' }, kept) })
    },
    [nodes, edges, onChange]
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
    if (kind === 'mode') return { id: nodeId('mode'), type: 'mode', position, data: newMode() }
    if (kind.startsWith('fx:'))
      return { id: nodeId('fx'), type: 'effect', position, data: newEffect(kind.slice(3) as EffectKind) }
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
    const mode: [NewKind, string] = ['mode', 'Mode sequence']
    const velocity: [NewKind, string] = ['velocity', 'Velocity sequencer']
    const effects: [NewKind, string][] = (Object.keys(EFFECTS) as EffectKind[]).map((k) => [`fx:${k}`, EFFECTS[k].label])
    const synths: [NewKind, string][] = SYNTHS.map((s) => [`synth:${s}`, s])
    const { pending } = m

    let groups: { title: string; kinds: [NewKind, string][] }[]
    if (!pending)
      groups = [
        { title: 'Sequencers', kinds: sequencers },
        { title: 'Shape', kinds: [velocity] },
        { title: 'Effects', kinds: effects },
        { title: 'Harmony', kinds: [mode] },
        { title: 'Synths', kinds: synths }
      ]
    else if (pending.handleType === 'source')
      groups = {
        sound: [{ title: 'Play it with', kinds: sequencers }],
        mode: [{ title: 'Apply to', kinds: [sequencers[0]] }],
        pattern: [
          { title: 'Shape', kinds: [velocity] },
          { title: 'Effects', kinds: effects }
        ]
      }[pending.handle]
    else
      groups = {
        sound: [{ title: 'Sound from', kinds: synths }],
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
            targetHandle: pending.handle,
            animated: pending.handle === 'mode'
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

  // Long-press empty canvas, then drag: select every node the fence touches.
  const { fence, suppressClick } = useLongPressFence(rootRef, (f) => {
    const a = screenToFlowPosition({ x: Math.min(f.x0, f.x1), y: Math.min(f.y0, f.y1) })
    const b = screenToFlowPosition({ x: Math.max(f.x0, f.x1), y: Math.max(f.y0, f.y1) })
    const hit = new Set(
      getIntersectingNodes({ x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y }, true).map((n) => n.id)
    )
    onChange({ nodes: nodes.map((n) => ({ ...n, selected: hit.has(n.id) })), edges })
  })

  const onPaneClick = (e: React.MouseEvent): void => {
    if (suppressClick()) return
    // With something selected, a tap on empty canvas just clears the selection.
    if (nodes.some((n) => n.selected)) return onChange({ nodes: nodes.map((n) => ({ ...n, selected: false })), edges })
    openAdd(e.clientX, e.clientY)
  }

  // With several nodes selected, a tap on a selected node acts on the selection:
  // its controls (grid, faders) don't edit, and the node menu opens instead.
  // Tap a node to select it; long-press (or right-click) opens its menu.
  // Long-press works on the node's own surface (title bar, chip), not on controls
  // like the grid or faders, which use the press themselves.
  const onPointerDownCapture = (e: React.PointerEvent): void => {
    const target = e.target as HTMLElement
    const id = target.closest<HTMLElement>('.react-flow__node')?.dataset.id
    if (!id) return
    const onControl = !!target.closest('.nodrag')

    // With several nodes selected, presses on a selected node's controls don't edit it.
    const selected = nodes.filter((n) => n.selected)
    if (onControl && selected.length > 1 && selected.some((n) => n.id === id)) {
      e.stopPropagation()
      e.preventDefault()
    } else if (onControl) return

    const { pointerId, clientX: x, clientY: y } = e
    const timer = setTimeout(() => {
      cleanup()
      setMenu({ type: 'node', x, y, nodeId: id })
    }, LONG_PRESS_MS)
    const move = (ev: PointerEvent): void => {
      // Moving means a drag, not a long-press.
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

  const onConnectEnd: OnConnectEnd = (e, conn) => {
    if (conn.isValid || !conn.fromNode || !conn.fromHandle?.id) return
    const p = 'changedTouches' in e ? e.changedTouches[0] : e
    openAdd(p.clientX, p.clientY, {
      nodeId: conn.fromNode.id,
      handle: conn.fromHandle.id as Pending['handle'],
      handleType: conn.fromHandle.type
    })
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
        onConnectEnd={onConnectEnd}
        onPaneClick={onPaneClick}
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
      {fence && (
        <div
          className="fence"
          style={{
            left: Math.min(fence.x0, fence.x1) - fence.ox,
            top: Math.min(fence.y0, fence.y1) - fence.oy,
            width: Math.abs(fence.x1 - fence.x0),
            height: Math.abs(fence.y1 - fence.y0)
          }}
        />
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
