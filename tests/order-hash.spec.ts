import { describe, expect, it } from 'vitest'
import { canonicalJson, planHash } from '../src/core/hash.ts'
import { mergeOrder, publishOrder, topoLayers } from '../src/core/plan/order.ts'
import type { Plan } from '../src/core/plan/schema.ts'
import { samplePlan } from './support/plans.ts'

function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value).reverse()) {
      out[k] = reverseKeys((value as Record<string, unknown>)[k])
    }
    return out
  }
  return value
}

describe('topological layers', () => {
  it('groups independent nodes into layers in plan order', () => {
    const result = topoLayers(
      ['a', 'b', 'c', 'd', 'e'],
      [
        { before: 'a', after: 'c' },
        { before: 'b', after: 'c' },
        { before: 'c', after: 'd' },
      ],
    )
    expect(result.layers).toEqual([['a', 'b', 'e'], ['c'], ['d']])
    expect(result.cyclic).toEqual([])
  })

  it('ties keep plan order', () => {
    expect(topoLayers(['x', 'w'], []).layers).toEqual([['x', 'w']])
  })

  it('reports cyclic nodes', () => {
    const result = topoLayers(
      ['a', 'b'],
      [
        { before: 'a', after: 'b' },
        { before: 'b', after: 'a' },
      ],
    )
    expect(result.cyclic).toEqual(['a', 'b'])
  })
})

describe('merge order', () => {
  it('orders the sample plan into layers', () => {
    expect(mergeOrder(samplePlan())).toEqual([
      ['example-org/catalog-api'],
      ['example-org/storefront', 'example-org/orders-api'],
    ])
  })

  it('publish order flattens the merge order', () => {
    expect(publishOrder(samplePlan())).toEqual([
      'example-org/catalog-api',
      'example-org/storefront',
      'example-org/orders-api',
    ])
  })
})

describe('canonical JSON and plan hash', () => {
  it('sorts keys, drops undefined and has no whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null }, u: undefined })).toBe(
      '{"a":{"c":null,"d":[1,{"y":2,"z":1}]},"b":1}',
    )
  })

  it('plan hash is 64 lowercase hex characters', () => {
    expect(planHash(samplePlan())).toMatch(/^[0-9a-f]{64}$/)
  })

  it('key insertion order does not change the hash', () => {
    const plan = samplePlan()
    const reversed = reverseKeys(plan) as Plan
    expect(planHash(reversed)).toBe(planHash(plan))
  })

  it('changing the title changes the hash', () => {
    const plan = samplePlan()
    const changed = { ...plan, title: plan.title + '!' }
    expect(planHash(changed)).not.toBe(planHash(plan))
  })

  it('appending a character to a task detail changes the hash', () => {
    const plan = samplePlan()
    const changed = structuredClone(plan)
    const repo = changed.repos[1]
    if (repo === undefined) throw new Error('missing repos[1]')
    repo.task.details += 'x'
    expect(planHash(changed)).not.toBe(planHash(plan))
  })
})
