import type { Plan } from './schema.ts'

export type Edge = { before: string; after: string }

export function topoLayers(nodes: readonly string[], edges: readonly Edge[]): { layers: string[][]; cyclic: string[] } {
  const known = new Set(nodes)
  const seen = new Set<string>()
  const unique: Edge[] = []
  for (const e of edges) {
    if (!known.has(e.before) || !known.has(e.after)) continue
    const key = e.before + '\u0000' + e.after
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(e)
  }

  const inDegree = new Map<string, number>(nodes.map(n => [n, 0]))
  const successors = new Map<string, string[]>(nodes.map(n => [n, []]))
  for (const e of unique) {
    inDegree.set(e.after, (inDegree.get(e.after) ?? 0) + 1)
    successors.get(e.before)?.push(e.after)
  }

  let remaining = [...nodes]
  const layers: string[][] = []
  while (remaining.length > 0) {
    const layer = remaining.filter(n => (inDegree.get(n) ?? 0) === 0)
    if (layer.length === 0) {
      return { layers, cyclic: remaining }
    }
    layers.push(layer)
    const done = new Set(layer)
    remaining = remaining.filter(n => !done.has(n))
    for (const n of layer) {
      for (const s of successors.get(n) ?? []) {
        inDegree.set(s, (inDegree.get(s) ?? 0) - 1)
      }
    }
  }
  return { layers, cyclic: [] }
}

export function mergeOrder(plan: Plan): string[][] {
  const { layers, cyclic } = topoLayers(
    plan.repos.map(r => r.repo),
    plan.dependencies,
  )
  if (cyclic.length > 0) {
    throw new Error('dependency cycle among ' + cyclic.join(', '))
  }
  return layers
}

export function publishOrder(plan: Plan): string[] {
  return mergeOrder(plan).flat()
}
