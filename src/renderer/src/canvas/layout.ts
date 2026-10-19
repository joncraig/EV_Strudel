// Automatic layout (Jon: always consistent, so the shape and colour of a patch can be
// read at a glance). Signal flows left to right: what feeds a node sits in a column to
// its left, chains stack in rows, and the same wiring always gives the same picture.
// Nodes in a group are laid out with everything else and the group frame is fitted
// around them; a collapsed group is placed as one block.

import dagre from '@dagrejs/dagre'
import type { CanvasNode, CanvasState } from './model'

const GAP_X = 70 // between columns
const GAP_Y = 28 // between nodes in a column
const PAD = 20 // group frame around its nodes
const HEADER = 34 // group title bar
const COLLAPSED = { width: 180, height: HEADER }

const sizeOf = (n: CanvasNode): { width: number; height: number } => ({
  width: n.measured?.width ?? 150,
  height: n.measured?.height ?? 64
})

// What decides the layout: which nodes, how they're wired and sized, and grouping.
// Positions aren't part of it, so a moved node is put back where it belongs.
export function layoutKey(state: CanvasState): string {
  return JSON.stringify([
    state.nodes.map((n) => {
      const s = sizeOf(n)
      const collapsed = n.type === 'group' ? !!n.data.collapsed : undefined
      return [n.id, n.parentId ?? '', Math.round(s.width), Math.round(s.height), collapsed]
    }),
    state.edges.map((e) => [e.source, e.target])
  ])
}

export function autoLayout(state: CanvasState): CanvasState {
  const byId = new Map(state.nodes.map((n) => [n.id, n]))
  const collapsed = new Set(
    state.nodes.filter((n) => n.type === 'group' && n.data.collapsed).map((n) => n.id)
  )
  // A node inside a collapsed group is represented by the group.
  const stand = (id: string): string => {
    const p = byId.get(id)?.parentId
    return p && collapsed.has(p) ? p : id
  }

  const g = new dagre.graphlib.Graph({ multigraph: false })
  g.setGraph({ rankdir: 'LR', nodesep: GAP_Y, ranksep: GAP_X, marginx: 0, marginy: 0 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of state.nodes) {
    if (n.type === 'group') {
      if (collapsed.has(n.id)) g.setNode(n.id, { ...COLLAPSED })
      continue
    }
    if (stand(n.id) !== n.id) continue
    // A node in an open group also takes the room its frame needs (padding and the
    // title bar), so frames don't overlap the rows around them.
    const s = sizeOf(n)
    const framed = !!n.parentId && byId.get(n.parentId)?.type === 'group'
    g.setNode(n.id, framed ? { width: s.width, height: s.height + HEADER + PAD * 2 } : s)
  }
  for (const e of state.edges) {
    const s = stand(e.source)
    const t = stand(e.target)
    if (s !== t && g.hasNode(s) && g.hasNode(t)) g.setEdge(s, t)
  }
  dagre.layout(g)

  // dagre gives centres; React Flow wants top-left corners.
  const abs = new Map<string, { x: number; y: number }>()
  for (const id of g.nodes()) {
    const p = g.node(id)
    const n = byId.get(id)
    const framed = !!n?.parentId && byId.get(n.parentId)?.type === 'group'
    // Framed nodes sit below their reserved title bar.
    abs.set(id, {
      x: Math.round(p.x - p.width / 2),
      y: Math.round(p.y - p.height / 2 + (framed ? HEADER + PAD : 0))
    })
  }

  // Open groups: a frame around their nodes; children are stored relative to it.
  const frames = new Map<string, { x: number; y: number; width: number; height: number }>()
  for (const grp of state.nodes) {
    if (grp.type !== 'group' || collapsed.has(grp.id)) continue
    const kids = state.nodes.filter((n) => n.parentId === grp.id && abs.has(n.id))
    if (!kids.length) continue
    const x0 = Math.min(...kids.map((k) => abs.get(k.id)!.x)) - PAD
    const y0 = Math.min(...kids.map((k) => abs.get(k.id)!.y)) - PAD - HEADER
    const x1 = Math.max(...kids.map((k) => abs.get(k.id)!.x + sizeOf(k).width)) + PAD
    const y1 = Math.max(...kids.map((k) => abs.get(k.id)!.y + sizeOf(k).height)) + PAD
    frames.set(grp.id, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 })
  }

  const nodes = state.nodes.map((n) => {
    if (n.type === 'group') {
      const f = frames.get(n.id)
      if (f)
        return {
          ...n,
          position: { x: f.x, y: f.y },
          style: { ...n.style, width: f.width, height: f.height },
          data: { ...n.data, width: f.width, height: f.height }
        } as CanvasNode
      const p = abs.get(n.id)
      return p ? ({ ...n, position: p } as CanvasNode) : n
    }
    const p = abs.get(n.id)
    if (!p) return n
    const f = n.parentId ? frames.get(n.parentId) : undefined
    return { ...n, position: f ? { x: p.x - f.x, y: p.y - f.y } : p } as CanvasNode
  })
  return { nodes, edges: state.edges }
}
