// The song: Ableton-style session (Jon, 2026-10-18). Columns are channels, rows are
// scenes, and each cell is a clip: an ordered chain of nodes (sort order, no wires),
// read top to bottom like the old chains. A Bus is a channel other channels can route
// into (their Output selector); its own nodes (effects) process what comes in.
//
// The music side is unchanged: a song is turned into the graph the compiler already
// understands (songGraph) — each playing clip a straight chain into its channel's
// strip node ('mix', which gives the channel its own orbit, live fader and pan).

import type { Edge } from '../canvas/model'
import { compile, type Compiled } from '../canvas/codegen'
import type { CanvasNode, CanvasState } from '../canvas/model'
import { MOD_PREFIX, nodeId } from '../canvas/model'

export interface Clip {
  id: string
  name?: string
  // Top to bottom: what plays, then what shapes it (every node holds until a later
  // one changes it, as before).
  nodes: CanvasNode[]
}

export interface Channel {
  id: string // also the id of its strip node in the compiled graph
  name: string
  kind: 'track' | 'bus'
  volume?: number
  pan?: number
  muted?: boolean
  solo?: boolean
  // A Bus channel id to play through, or none for the master.
  output?: string | null
  // One slot per scene (tracks only).
  clips: (Clip | null)[]
  // The scene whose clip is playing (null: stopped).
  playing: number | null
  // A Bus's own chain (effects, LFOs), always on.
  nodes?: CanvasNode[]
}

export interface Scene {
  id: string
  name: string
}

export interface Song {
  version: 'song-1'
  channels: Channel[]
  scenes: Scene[]
}

export const isSong = (x: unknown): x is Song => (x as Song)?.version === 'song-1'

export const emptySong = (): Song => ({
  version: 'song-1',
  channels: [],
  scenes: [{ id: nodeId('scene'), name: '1' }]
})

const at = { x: 0, y: 0 }
const link = (source: string, target: string, handle = 'pattern'): Edge => ({
  id: `e-${source}-${target}-${handle}`,
  source,
  target,
  sourceHandle: handle === 'pattern' ? 'pattern' : 'mod',
  targetHandle: handle
})

// The graph the compiler reads: every playing clip as a chain into its channel strip.
export function songGraph(song: Song): CanvasState {
  const nodes: CanvasNode[] = []
  const edges: Edge[] = []
  const byId = new Map(song.channels.map((c) => [c.id, c]))
  for (const ch of song.channels) {
    // Routed into a Bus, a channel's fader goes into the code (its audio plays on the
    // Bus's orbit, so the live fader there is the Bus's).
    const routed = !!ch.output && byId.get(ch.output)?.kind === 'bus'
    nodes.push({
      id: ch.id,
      type: 'mix',
      position: at,
      data: {
        label: ch.name,
        volume: ch.volume ?? 1,
        pan: ch.pan ?? 0,
        muted: ch.muted,
        solo: ch.solo,
        ...(routed ? { codeGain: ch.volume ?? 1 } : {})
      }
    } as CanvasNode)
    const chain = (list: CanvasNode[], first: string | null, last: string | null): void => {
      let prev = first
      for (const n of list) {
        nodes.push({ ...n, position: at } as CanvasNode)
        // LFOs modulate the channel strip (volume or pan); they aren't in the chain.
        if (n.type === 'lfo') {
          edges.push(link(n.id, ch.id, MOD_PREFIX + ((n.data.target as string) ?? 'volume')))
          continue
        }
        if (prev) edges.push(link(prev, n.id))
        prev = n.id
      }
      if (prev && last && prev !== last) edges.push(link(prev, last))
    }
    if (ch.kind === 'bus') chain(ch.nodes ?? [], ch.id, null)
    else {
      const clip = ch.playing === null ? null : ch.clips[ch.playing]
      if (clip) chain(clip.nodes, null, ch.id)
    }
    if (routed) edges.push(link(ch.id, ch.output as string))
  }
  return { nodes, edges }
}

export const compileSong = (song: Song): Compiled & { graph: CanvasState } => {
  const graph = songGraph(song)
  return { ...compile(graph.nodes, graph.edges), graph }
}

// ---- From the old wired canvas ----

// Each chain end becomes a channel with one clip (its nodes in wiring order). A Bus
// fed by one chain becomes that chain's channel strip (its effects go on the end of
// the clip); a Bus fed by several becomes a Bus channel they route into. Parallel
// branches are flattened into one ordered chain.
export function songFromCanvas(canvas: CanvasState): Song {
  const nodes = canvas.nodes.filter((n) => n.type !== 'group')
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const pattern = canvas.edges.filter(
    (e) => e.sourceHandle === 'pattern' && byId.has(e.source) && byId.has(e.target)
  )
  const ins = (id: string): string[] => pattern.filter((e) => e.target === id).map((e) => e.source)
  const outs = (id: string): string[] => pattern.filter((e) => e.source === id).map((e) => e.target)
  const isMix = (id: string): boolean => byId.get(id)?.type === 'mix'

  // Everything upstream of id (not through a Mix), in wiring order.
  const upstreamOrdered = (id: string): CanvasNode[] => {
    const seen = new Set<string>()
    const order: CanvasNode[] = []
    const visit = (x: string): void => {
      if (seen.has(x) || isMix(x)) return
      seen.add(x)
      for (const s of ins(x)) visit(s)
      order.push(byId.get(x)!)
    }
    visit(id)
    return order
  }
  // Downstream of a Mix up to the next Mix or the end, in order.
  const after = (mixId: string): CanvasNode[] => {
    const list: CanvasNode[] = []
    let cur = outs(mixId).find((t) => !isMix(t))
    const seen = new Set<string>()
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      list.push(byId.get(cur)!)
      cur = outs(cur).find((t) => !isMix(t))
    }
    return list
  }
  const lfosFor = (target: string): CanvasNode[] =>
    canvas.edges
      .filter(
        (e) => e.sourceHandle === 'mod' && e.target === target && byId.get(e.source)?.type === 'lfo'
      )
      .map((e) => {
        const l = byId.get(e.source)!
        return {
          ...l,
          data: { ...l.data, target: e.targetHandle?.slice(MOD_PREFIX.length) ?? 'volume' }
        } as CanvasNode
      })

  const channels: Channel[] = []
  const used = new Set<string>()
  const track = (
    id: string,
    name: string,
    list: CanvasNode[],
    extra: Partial<Channel> = {}
  ): void => {
    list.forEach((n) => used.add(n.id))
    channels.push({
      id,
      name,
      kind: 'track',
      clips: [{ id: nodeId('clip'), nodes: list }],
      playing: 0,
      ...extra
    })
  }
  const label = (list: CanvasNode[]): string => {
    const s = list.find((n) => n.type === 'sample')
    return (s?.data.s as string) ?? (list.find((n) => n.type === 'sequencer') ? 'Notes' : 'Channel')
  }

  for (const mix of nodes.filter((n) => n.type === 'mix')) {
    const feeds = ins(mix.id).filter((s) => !isMix(s))
    const strip = {
      volume: mix.data.volume as number,
      pan: mix.data.pan as number,
      muted: mix.data.muted as boolean,
      solo: mix.data.solo as boolean
    }
    const post = after(mix.id)
    if (feeds.length === 1) {
      const list = [...upstreamOrdered(feeds[0]), ...post, ...lfosFor(mix.id)]
      track(mix.id, label(list), list, strip)
    } else {
      const busNodes = [...post, ...lfosFor(mix.id)]
      busNodes.forEach((n) => used.add(n.id))
      channels.push({
        id: mix.id,
        name: `Bus`,
        kind: 'bus',
        clips: [],
        playing: null,
        nodes: busNodes,
        ...strip
      })
      for (const f of feeds) {
        const list = upstreamOrdered(f)
        track(nodeId('ch'), label(list), list, { output: mix.id })
      }
    }
  }
  // Chains that end without a Bus play to the master.
  for (const n of nodes) {
    if (used.has(n.id) || isMix(n.id) || n.type === 'lfo') continue
    if (outs(n.id).length) continue
    const full = upstreamOrdered(n.id)
    const list = full.filter((x) => !used.has(x.id))
    if (!list.length) continue
    // A branch off a chain that's already a channel (a Duck after its Delay, say)
    // goes on the end of that channel's clip.
    const home = channels.find((c) =>
      c.clips[0]?.nodes.some((x) => full.some((f) => f.id === x.id))
    )
    if (home?.clips[0]) {
      home.clips[0].nodes.push(...list)
      list.forEach((x) => used.add(x.id))
    } else track(nodeId('ch'), label(list), list)
  }
  // Duck targets were Bus (Mix) ids; channels keep those ids, so they still match.
  return { version: 'song-1', channels, scenes: [{ id: nodeId('scene'), name: '1' }] }
}
