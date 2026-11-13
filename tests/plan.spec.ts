import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { planJsonSchema } from '../src/core/plan/schema.ts'
import { readPlanFile, validatePlan } from '../src/core/plan/validate.ts'
import { deletePath, samplePlan, setPath } from './support/plans.ts'

const EXAMPLE = fileURLToPath(new URL('../examples/plan.json', import.meta.url))

const REQUIRED_PATHS = [
  'schemaVersion',
  'changesetId',
  'title',
  'request',
  'contract',
  'contract.summary',
  'contract.format',
  'contract.definition',
  'contract.rules',
  'contract.examples',
  'contract.examples.0.name',
  'contract.examples.0.payload',
  'contract.changes',
  'contract.changes.0.kind',
  'contract.changes.0.target',
  'breaking',
  'breaking.isBreaking',
  'repos',
  'repos.0.repo',
  'repos.0.role',
  'repos.0.task',
  'repos.0.task.summary',
  'repos.0.task.details',
  'dependencies',
  'dependencies.0.before',
  'dependencies.0.after',
  'dependencies.0.reason',
]

const EMPTIED: [string, unknown][] = [
  ['changesetId', ''],
  ['title', ''],
  ['contract.summary', ''],
  ['contract.definition', ''],
  ['repos.0.task.summary', ''],
  ['repos.0.task.details', ''],
  ['dependencies.0.reason', ''],
  ['repos', []],
  ['contract.changes', []],
]

describe('plan validation', () => {
  it.each(REQUIRED_PATHS)('removing each required field names it: %s', p => {
    const plan = samplePlan()
    deletePath(plan, p)
    const result = validatePlan(plan)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some(e => e.path === p)).toBe(true)
  })

  it.each(EMPTIED)('emptying a required field names it: %s', (p, value) => {
    const plan = samplePlan()
    setPath(plan, p, value)
    const result = validatePlan(plan)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some(e => e.path === p)).toBe(true)
  })

  it('emptying request to an empty object names request', () => {
    const plan = samplePlan()
    setPath(plan, 'request', {})
    const result = validatePlan(plan)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors).toContainEqual(expect.objectContaining({ path: 'request' }))
  })

  it('sample plan is valid', () => {
    expect(validatePlan(samplePlan()).ok).toBe(true)
  })

  it('examples/plan.json is valid', async () => {
    const result = await readPlanFile(EXAMPLE)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.repos.length).toBeGreaterThanOrEqual(2)
    expect(result.plan.dependencies.length).toBeGreaterThanOrEqual(1)
  })

  it('breaking without strategy', () => {
    const plan = samplePlan()
    setPath(plan, 'breaking', { isBreaking: true })
    const result = validatePlan(plan)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors).toEqual([
      { path: 'breaking.strategy', message: 'breaking change requires a recorded choice: staged | at-once' },
    ])
  })

  it.each(['rename', 'remove'])('%s change without isBreaking', kind => {
    const plan = samplePlan()
    setPath(plan, 'contract.changes.0.kind', kind)
    const result = validatePlan(plan)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some(e => e.path === 'contract.changes.0.kind')).toBe(true)
  })

  it('archived repo', () => {
    const plan = samplePlan()
    setPath(plan, 'repos.1.repo', 'example-org/old-api-archived')
    const result = validatePlan(plan)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some(e => e.path === 'repos.1.repo' && e.message.includes('archived'))).toBe(true)
  })

  it('duplicate repo', () => {
    const plan = samplePlan()
    setPath(plan, 'repos.2.repo', 'example-org/storefront')
    const result = validatePlan(plan)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some(e => e.path === 'repos.2.repo' && e.message.includes('duplicate'))).toBe(true)
  })

  it('bad slug', () => {
    const plan = samplePlan()
    setPath(plan, 'repos.0.repo', 'storefront')
    const result = validatePlan(plan)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some(e => e.path === 'repos.0.repo')).toBe(true)
  })

  it('unknown dependency endpoint', () => {
    const plan = samplePlan()
    setPath(plan, 'dependencies.0.after', 'example-org/nope')
    const result = validatePlan(plan)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some(e => e.path === 'dependencies.0.after')).toBe(true)
  })

  it('cycle', () => {
    const plan = samplePlan()
    plan.dependencies.push({
      before: 'example-org/orders-api',
      after: 'example-org/catalog-api',
      reason: 'Cycle for test.',
    })
    const result = validatePlan(plan)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some(e => e.path === 'dependencies' && e.message.includes('cycle'))).toBe(true)
  })

  it('invalid JSON', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sacp-'))
    const file = join(dir, 'bad.json')
    writeFileSync(file, '{ not json')
    const result = await readPlanFile(file)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0]?.path).toBe('(root)')
    expect(result.errors[0]?.message.startsWith('invalid JSON')).toBe(true)
  })

  it('unknown key rejected', () => {
    const plan = { ...samplePlan(), extra: 1 }
    expect(validatePlan(plan).ok).toBe(false)
  })

  it('planJsonSchema is serializable and describes the plan', () => {
    const s = planJsonSchema() as { properties: Record<string, unknown>; required: string[] }
    expect(() => JSON.parse(JSON.stringify(s))).not.toThrow()
    expect(s.properties.changesetId).toBeDefined()
    expect(s.required).toContain('contract')
  })
})
