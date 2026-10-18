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
import { ModeNode, SampleNode, SequencerNode } from './nodes'
import { compile } from './codegen'
import { SOUND_DROP_EVENT, SoundDropDetail } from './soundDrag'
import ContextMenu, { MenuSection } from './ContextMenu'
import { CanvasNode, CanvasState, DraggedSound, newMode, newSequencer, nodeId, SequencerKind, SYNTHS } from './model'

interface Props {
  state: CanvasState
  onChange: (state: CanvasState) => void
  // Called before a dropped sound is used, so its pack is registered with Strudel.
  onSoundDropped: (sound: DraggedSound) => void
}

const nodeTypes = { sample: SampleNode, sequencer: SequencerNode, mode: ModeNode }

// Handles only connect to the same-named handle: sound→sound, mode→mode.
const isValidConnection: IsValidConnection = (c) => c.sourceHandle === c.targetHandle && c.source !== c.target

// What the add menu can create: a sequencer kind, a mode node, or a synth sound.
type NewKind = SequencerKind | 'mode' | `synth:${string}`

// A wire dragged out of a handle and dropped on empty canvas.
interface Pending {
  nodeId: string
  handle: 'sound' | 'mode'
  handleType: 'source' | 'target'
}

type Menu =
  | { type: 'add'; x: number; y: number; flow: { x: number; y: number }; pending?: Pending }
  | { type: 'node'; x: number; y: number; nodeId: string }

function Canvas({ state, onChange, onSoundDropped }: Props): React.JSX.Element {
  const { screenToFlowPosition } = useReactFlow()
  const [showCode, setShowCode] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const { nodes, edges } = state

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

  const remove = (id: string): void =>
    onChange({
      nodes: nodes.filter((n) => n.id !== id),
      edges: edges.filter((e) => e.source !== id && e.target !== id)
    })

  // ---- Menus: tap empty canvas = add, tap a node = node menu, drop a wire on empty = add + connect ----
  const [menu, setMenu] = useState<Menu | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  const makeNode = (kind: NewKind, position: { x: number; y: number }): CanvasNode => {
    if (kind === 'mode') return { id: nodeId('mode'), type: 'mode', position, data: newMode() }
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
    const synths: [NewKind, string][] = SYNTHS.map((s) => [`synth:${s}`, s])
    const { pending } = m

    let groups: { title: string; kinds: [NewKind, string][] }[]
    if (!pending)
      groups = [
        { title: 'Sequencers', kinds: sequencers },
        { title: 'Harmony', kinds: [mode] },
        { title: 'Synths', kinds: synths }
      ]
    else if (pending.handleType === 'source')
      groups =
        pending.handle === 'sound'
          ? [{ title: 'Play it with', kinds: sequencers }]
          : [{ title: 'Apply to', kinds: [sequencers[0]] }]
    else
      groups =
        pending.handle === 'sound'
          ? [{ title: 'Sound from', kinds: synths }]
          : [{ title: 'Mode from', kinds: [mode] }]

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

  const nodeSections = (id: string): MenuSection[] => [
    { items: [{ label: 'Delete', danger: true, onSelect: () => remove(id) }] }
  ]

  const openAdd = (x: number, y: number, pending?: Pending): void =>
    setMenu({ type: 'add', x, y, flow: screenToFlowPosition({ x, y }), pending })

  const onPaneClick = (e: React.MouseEvent): void => openAdd(e.clientX, e.clientY)

  const onNodeClick = (e: React.MouseEvent, node: CanvasNode): void => {
    // Taps on a node's own controls (grid cells, buttons, selects) aren't node taps.
    if ((e.target as HTMLElement).closest('button, select, input, label')) return
    if (e.ctrlKey || e.metaKey) return remove(node.id)
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
        data: { s: sound.s, pack: sound.pack, label: sound.label, n: sound.n ?? 0, slices: 8 }
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
    <div className="canvas" ref={rootRef}>
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
        isValidConnection={isValidConnection}
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
    </div>
  )
}

export default Canvas
