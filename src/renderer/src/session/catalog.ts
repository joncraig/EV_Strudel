// What can go in a clip: the add menu's sections (colour-coded like the nodes) and the
// factory that makes each kind of node.

import type { MenuSection } from '../canvas/ContextMenu'
import {
  EFFECTS,
  newEffect,
  newKey,
  newLength,
  newLfo,
  newMode,
  newOctave,
  newPerform,
  newSequencer,
  newVelocity,
  newVoicing,
  newDuck,
  nodeId,
  SYNTHS,
  type CanvasNode,
  type EffectKind,
  type SequencerKind,
  type VoicingParam
} from '../canvas/model'

export type NewKind =
  | SequencerKind
  | 'lfo'
  | 'duck'
  | 'perform'
  | `voicing:${VoicingParam}`
  | 'octave'
  | 'key'
  | 'mode'
  | 'velocity'
  | 'length'
  | `fx:${EffectKind}`
  | `synth:${string}`

// The card colour of each node type (also the add menu's stripes).
export const NODE_COLORS: Record<string, string> = {
  sequencer: '#2c4c80',
  velocity: '#7d5a26',
  length: '#276a86',
  effect: '#276b6b',
  key: '#6b3a90',
  mode: '#8e3a6c',
  octave: '#4c3a90',
  sample: '#2e5e3c',
  lfo: '#5f5f18',
  duck: '#7a3626',
  perform: '#4f4296',
  voicing: '#7a3f68'
}

export function kindColor(kind: string): string {
  if (kind.startsWith('fx:')) return NODE_COLORS.effect
  if (kind.startsWith('voicing:')) return NODE_COLORS.voicing
  if (kind.startsWith('synth:')) return NODE_COLORS.sample
  if (kind === 'degree' || kind === 'slice' || kind === 'chord') return NODE_COLORS.sequencer
  return NODE_COLORS[kind] ?? '#555'
}

const at = { x: 0, y: 0 }

export function makeNode(kind: NewKind): CanvasNode {
  if (kind === 'lfo') return { id: nodeId('lfo'), type: 'lfo', position: at, data: newLfo() }
  if (kind === 'duck') return { id: nodeId('duck'), type: 'duck', position: at, data: newDuck() }
  if (kind.startsWith('voicing:'))
    return {
      id: nodeId('voicing'),
      type: 'voicing',
      position: at,
      data: newVoicing(kind.slice(8) as VoicingParam)
    }
  if (kind === 'perform')
    return { id: nodeId('perform'), type: 'perform', position: at, data: newPerform() }
  if (kind === 'octave')
    return { id: nodeId('oct'), type: 'octave', position: at, data: newOctave() }
  if (kind === 'key') return { id: nodeId('key'), type: 'key', position: at, data: newKey() }
  if (kind === 'mode') return { id: nodeId('mode'), type: 'mode', position: at, data: newMode() }
  if (kind.startsWith('fx:'))
    return {
      id: nodeId('fx'),
      type: 'effect',
      position: at,
      data: newEffect(kind.slice(3) as EffectKind)
    }
  if (kind === 'length')
    return { id: nodeId('len'), type: 'length', position: at, data: newLength() }
  if (kind === 'velocity')
    return { id: nodeId('vel'), type: 'velocity', position: at, data: newVelocity() }
  if (kind.startsWith('synth:'))
    return {
      id: nodeId('sample'),
      type: 'sample',
      position: at,
      data: { s: kind.slice(6), n: 0, slices: 8 }
    }
  return {
    id: nodeId('seq'),
    type: 'sequencer',
    position: at,
    data: newSequencer(kind as SequencerKind)
  }
}

// The add menu: every kind of node, grouped; picking one calls onPick.
export function addSections(onPick: (node: CanvasNode) => void): MenuSection[] {
  const groups: { title: string; kinds: [NewKind, string][] }[] = [
    {
      title: 'Sequencers',
      kinds: [
        ['degree', 'Notes sequencer'],
        ['slice', 'Slices sequencer'],
        ['chord', 'Chords sequencer']
      ]
    },
    {
      title: 'Shape',
      kinds: [
        ['velocity', 'Velocity sequencer'],
        ['length', 'Length sequencer'],
        ['perform', 'Strum / Arp']
      ]
    },
    {
      title: 'Harmony',
      kinds: [
        ['key', 'Key sequencer'],
        ['mode', 'Mode sequencer'],
        ['octave', 'Octave sequencer']
      ]
    },
    {
      title: 'Voicing',
      kinds: [
        ['voicing:inversion', 'Inversion sequencer'],
        ['voicing:spread', 'Spread sequencer'],
        ['voicing:bass', 'Bass sequencer']
      ]
    },
    {
      title: 'Effects',
      kinds: (Object.keys(EFFECTS) as EffectKind[]).map((k) => [`fx:${k}`, EFFECTS[k].label])
    },
    { title: 'Sound', kinds: SYNTHS.map((s) => [`synth:${s}`, s] as [NewKind, string]) },
    {
      title: 'Modulate',
      kinds: [
        ['lfo', 'LFO (channel volume / pan)'],
        ['duck', 'Duck (sidechain)']
      ]
    }
  ]
  return groups.map((g) => ({
    title: g.title,
    items: g.kinds.map(([kind, label]) => ({
      label,
      color: kindColor(kind),
      onSelect: () => onPick(makeNode(kind))
    }))
  }))
}
