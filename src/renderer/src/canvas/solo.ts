// Solo works like a radio button: soloing a node unsolos every other one. With Shift
// it adds to (or takes out of) the soloed set instead. Pressing the only soloed node
// again unsolos it.

interface Soloable {
  id: string
  data: Record<string, unknown>
}

// The solo value each node should end up with, for the ones that change.
export function soloChanges(
  nodes: Soloable[],
  ids: string[],
  additive: boolean
): { id: string; solo: boolean }[] {
  const isSolo = (n: Soloable): boolean => !!n.data.solo
  const targets = nodes.filter((n) => ids.includes(n.id))
  const allOn = targets.length > 0 && targets.every(isSolo)
  const want = (n: Soloable): boolean => {
    if (ids.includes(n.id)) {
      if (additive) return !allOn
      // Exclusive: pressing what's already the whole solo set turns it off.
      const others = nodes.some((o) => !ids.includes(o.id) && isSolo(o))
      return !(allOn && !others)
    }
    return additive ? isSolo(n) : false
  }
  return nodes.filter((n) => want(n) !== isSolo(n)).map((n) => ({ id: n.id, solo: want(n) }))
}
