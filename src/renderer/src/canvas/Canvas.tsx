import { useCallback, useMemo, useState } from 'react'
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
  ReactFlow,
  useReactFlow
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ModeNode, SampleNode, SequencerNode } from './nodes'
import { compile } from './codegen'
import {
  CanvasNode,
  CanvasState,
  DraggedSound,
  newMode,
  newSequencer,
  nodeId,
  SequencerKind,
  SOUND_MIME,
  SYNTHS
} from './model'


interface Props {
  state: CanvasState
  onChange: (state: CanvasState) => void
  // Called before a dropped sound is used, so its pack is registered with Strudel.
  onSoundDropped: (sound: DraggedSound) => void
}

// Handles only connect to the same-named handle: sound→sound, mode→mode.
const nodeTypes = { sample: SampleNode, sequencer: SequencerNode, mode: ModeNode }

const isValidConnection: IsValidConnection = (c) => c.sourceHandle === c.targetHandle && c.source !== c.target

function Canvas({ state, onChange, onSoundDropped }: Props): React.JSX.Element {
  const { screenToFlowPosition } = useReactFlow()
  const [showCode, setShowCode] = useState(false)
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

  const add = (node: CanvasNode): void => onChange({ nodes: [...nodes, node], edges })

  // New nodes go near the middle of the visible canvas, staggered so they don't stack.
  const spawnPosition = (): { x: number; y: number } => {
    const p = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
    return { x: p.x + (nodes.length % 5) * 30, y: p.y + (nodes.length % 5) * 30 }
  }

  const addSequencer = (kind: SequencerKind): void =>
    add({ id: nodeId('seq'), type: 'sequencer', position: spawnPosition(), data: newSequencer(kind) })

  const onDrop = (e: React.DragEvent): void => {
    const raw = e.dataTransfer.getData(SOUND_MIME)
    if (!raw) return
    e.preventDefault()
    const sound = JSON.parse(raw) as DraggedSound
    onSoundDropped(sound)
    add({
      id: nodeId('sample'),
      type: 'sample',
      position: screenToFlowPosition({ x: e.clientX, y: e.clientY }),
      data: { s: sound.s, pack: sound.pack, n: 0, slices: 8 }
    })
  }

  const compiled = useMemo(() => compile(nodes, edges), [nodes, edges])

  return (
    <div className="canvas" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <div className="canvas-tools">
        <button onClick={() => addSequencer('degree')}>+ Notes</button>
        <button onClick={() => addSequencer('trigger')}>+ Rhythm</button>
        <button onClick={() => addSequencer('slice')}>+ Slices</button>
        <button onClick={() => add({ id: nodeId('mode'), type: 'mode', position: spawnPosition(), data: newMode() })}>
          + Mode sequence
        </button>
        <select
          value=""
          onChange={(e) => {
            if (!e.target.value) return
            add({
              id: nodeId('sample'),
              type: 'sample',
              position: spawnPosition(),
              data: { s: e.target.value, n: 0, slices: 8 }
            })
          }}
        >
          <option value="">+ Synth…</option>
          {SYNTHS.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <span className="spacer" />
        <button className={showCode ? 'on' : ''} onClick={() => setShowCode(!showCode)}>
          {'</>'} Code
        </button>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges as Edge[]}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
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
        <div className="canvas-empty">
          Drag a sound from the Samples tab onto the canvas, add a sequencer, and wire the sample into it.
        </div>
      )}
      {showCode && <pre className="code-view">{compiled.code}</pre>}
    </div>
  )
}

export default Canvas
