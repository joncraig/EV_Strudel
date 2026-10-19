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

// Fit every open group's frame around its contents: PAD around the nodes, the title
// bar on top. A node moved past the left or top edge moves the frame instead (its
// contents stay where they are on screen). Returns the same state when nothing changes.
export function fitGroups(state: CanvasState): CanvasState {
  let nodes = state.nodes
  for (const g of state.nodes) {
    if (g.type !== 'group' || g.data.collapsed) continue
    const kids = nodes.filter((n) => n.parentId === g.id)
    if (!kids.length) continue
    const minX = Math.min(...kids.map((n) => n.position.x))
    const minY = Math.min(...kids.map((n) => n.position.y))
    const dx = minX - PAD
    const dy = minY - PAD - HEADER
    const width = Math.round(Math.max(...kids.map((n) => n.position.x + size(n).width)) - dx + PAD)
    const height = Math.round(
      Math.max(...kids.map((n) => n.position.y + size(n).height)) - dy + PAD
    )
    if (
      Math.abs(dx) < 0.5 &&
      Math.abs(dy) < 0.5 &&
      width === g.data.width &&
      height === g.data.height
    )
      continue
    nodes = nodes.map((n) => {
      if (n.id === g.id)
        return {
          ...n,
          position: { x: n.position.x + dx, y: n.position.y + dy },
          style: { ...n.style, width, height },
          data: { ...n.data, width, height }
        } as CanvasNode
      if (n.parentId === g.id)
        return { ...n, position: { x: n.position.x - dx, y: n.position.y - dy } } as CanvasNode
      return n
    })
  }
  return nodes === state.nodes ? state : { nodes, edges: state.edges }
}

// Open group frames as they were when a drag started (canvas coordinates).
export type GroupRect = { id: string; x: number; y: number; width: number; height: number }
export const groupRects = (state: CanvasState): GroupRect[] =>
  state.nodes
    .filter((n): n is GroupNode => n.type === 'group' && !n.data.collapsed)
    .map((n) => ({
      id: n.id,
      x: n.position.x,
      y: n.position.y,
      width: n.data.width,
      height: n.data.height
    }))

// Dropping nodes: over a group's frame they join it, outside their own group they
// leave it (keeping where they are on screen). `at` is the drop point on the canvas.
export function dropIntoGroups(
  state: CanvasState,
  ids: string[],
  at: { x: number; y: number },
  rects: GroupRect[]
): CanvasState {
  const hit = rects.find(
    (r) => at.x >= r.x && at.x <= r.x + r.width && at.y >= r.y && at.y <= r.y + r.height
  )
  const byId = new Map(state.nodes.map((n) => [n.id, n]))
  let changed = false
  const nodes = state.nodes.map((n) => {
    if (!ids.includes(n.id) || n.type === 'group' || (n.parentId ?? null) === (hit?.id ?? null))
      return n
    const parent = n.parentId ? byId.get(n.parentId) : undefined
    const abs = {
      x: n.position.x + (parent?.position.x ?? 0),
      y: n.position.y + (parent?.position.y ?? 0)
    }
    const into = hit ? byId.get(hit.id) : undefined
    changed = true
    return {
      ...n,
      parentId: into?.id,
      position: { x: abs.x - (into?.position.x ?? 0), y: abs.y - (into?.position.y ?? 0) }
    } as CanvasNode
  })
  if (!changed) return state
  // React Flow needs parents before their children.
  return {
    nodes: [...nodes.filter((n) => n.type === 'group'), ...nodes.filter((n) => n.type !== 'group')],
    edges: state.edges
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
    .map((e) => ({
      ...e,
      id: `${e.id}-copy-${map.get(e.source)}`,
      source: map.get(e.source)!,
      target: map.get(e.target)!
    }))
  return {
    nodes: [...state.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), ...copies],
    edges: [...state.edges, ...wires]
  }
}

// Delete a node without breaking the chain (Blender's dissolve): whatever was wired
// into it is wired straight to whatever it fed.
export function dissolveNode(state: CanvasState, id: string): CanvasState {
  const ins = state.edges.filter((e) => e.target === id && e.sourceHandle === 'pattern')
  const outs = state.edges.filter((e) => e.source === id && e.sourceHandle === 'pattern')
  const removed = removeNode(state, id)
  const gone = new Set(removed.nodes.map((n) => n.id))
  const bridges = ins.flatMap((i) =>
    outs
      .filter((o) => gone.has(i.source) && gone.has(o.target) && i.source !== o.target)
      .filter((o) => !removed.edges.some((e) => e.source === i.source && e.target === o.target))
      .map((o) => ({
        id: `e-${i.source}-${o.target}-pattern`,
        source: i.source,
        target: o.target,
        sourceHandle: 'pattern',
        targetHandle: 'pattern'
      }))
  )
  return { nodes: removed.nodes, edges: [...removed.edges, ...bridges] }
}
