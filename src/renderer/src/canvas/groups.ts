// Grouping nodes into collapsible frames. Children use React Flow's parentId, so they
// move with the group; collapsing hides them and shrinks the frame to its title bar.
// Groups are layout only: the music ignores them.

import type { CanvasNode, CanvasState, GroupNode } from './model'
import { nodeId } from './model'

const PAD = 20
const HEADER = 34
const COLLAPSED = { width: 180, height: HEADER }

const size = (n: CanvasNode): { width: number; height: number } => ({
  width: n.measured?.width ?? 180,
  height: n.measured?.height ?? 60
})

export function groupNodes(state: CanvasState, ids: string[]): CanvasState {
  // Only top-level nodes; nested groups can come later.
  const members = state.nodes.filter((n) => ids.includes(n.id) && !n.parentId && n.type !== 'group')
  if (!members.length) return state

  const minX = Math.min(...members.map((n) => n.position.x))
  const minY = Math.min(...members.map((n) => n.position.y))
  const maxX = Math.max(...members.map((n) => n.position.x + size(n).width))
  const maxY = Math.max(...members.map((n) => n.position.y + size(n).height))
  const position = { x: minX - PAD, y: minY - PAD - HEADER }
  const width = maxX - minX + PAD * 2
  const height = maxY - minY + PAD * 2 + HEADER

  const group: GroupNode = {
    id: nodeId('group'),
    type: 'group',
    position,
    data: { label: 'Group', collapsed: false, width, height },
    style: { width, height }
  }
  const memberIds = new Set(members.map((n) => n.id))
  const nodes = state.nodes.map((n) =>
    memberIds.has(n.id)
      ? ({
          ...n,
          parentId: group.id,
          selected: false,
          position: { x: n.position.x - position.x, y: n.position.y - position.y }
        } as CanvasNode)
      : n
  )
  // React Flow needs parents before their children.
  return { nodes: [group, ...nodes], edges: state.edges }
}

export function ungroup(state: CanvasState, groupId: string): CanvasState {
  const group = state.nodes.find((n) => n.id === groupId)
  if (!group) return state
  const nodes = state.nodes
    .filter((n) => n.id !== groupId)
    .map((n) =>
      n.parentId === groupId
        ? ({
            ...n,
            parentId: undefined,
            hidden: false,
            position: { x: n.position.x + group.position.x, y: n.position.y + group.position.y }
          } as CanvasNode)
        : n
    )
  return { nodes, edges: state.edges }
}

export function setCollapsed(state: CanvasState, groupId: string, collapsed: boolean): CanvasState {
  const nodes = state.nodes.map((n) => {
    if (n.id === groupId && n.type === 'group') {
      const style = collapsed ? COLLAPSED : { width: n.data.width, height: n.data.height }
      return { ...n, style, data: { ...n.data, collapsed } }
    }
    return n.parentId === groupId ? ({ ...n, hidden: collapsed } as CanvasNode) : n
  })
  return { nodes, edges: state.edges }
}

// Deleting a node also deletes anything inside it.
export function removeNode(state: CanvasState, id: string): CanvasState {
  const gone = new Set([id, ...state.nodes.filter((n) => n.parentId === id).map((n) => n.id)])
  return {
    nodes: state.nodes.filter((n) => !gone.has(n.id)),
    edges: state.edges.filter((e) => !gone.has(e.source) && !gone.has(e.target))
  }
}

// Fired by a group's collapse arrow; the canvas owns the state and handles it.
export const GROUP_TOGGLE_EVENT = 'ev-group-toggle'

// Copy nodes (and the wires between them), offset so they're visible, and select
// the copies. Groups aren't copied yet.
export function duplicateNodes(state: CanvasState, ids: string[]): CanvasState {
  const picked = state.nodes.filter((n) => ids.includes(n.id) && n.type !== 'group')
  if (!picked.length) return state
  const map = new Map(picked.map((n) => [n.id, nodeId(n.type ?? 'node')]))
  const copies = picked.map(
    (n) =>
      ({
        ...n,
        id: map.get(n.id),
        position: { x: n.position.x + 40, y: n.position.y + 40 },
        data: structuredClone(n.data),
        selected: true
      }) as CanvasNode
  )
  const wires = state.edges
    .filter((e) => map.has(e.source) && map.has(e.target))
    .map((e) => ({ ...e, id: `${e.id}-copy-${map.get(e.source)}`, source: map.get(e.source)!, target: map.get(e.target)! }))
  return {
    nodes: [...state.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), ...copies],
    edges: [...state.edges, ...wires]
  }
}
