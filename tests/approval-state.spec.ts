import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { checkApproval, recordApproval } from '../src/core/approval.ts'
import { ApprovalError, StateError } from '../src/core/errors.ts'
import { planHash, sha256Hex } from '../src/core/hash.ts'
import type { Plan } from '../src/core/plan/schema.ts'
import { loadState, saveState } from '../src/core/state.ts'
import type { State } from '../src/core/state.ts'
import { samplePlan } from './support/plans.ts'

const created: string[] = []

afterAll(() => {
  for (const dir of created) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function setup(): { dir: string; planPath: string; plan: Plan } {
  const dir = mkdtempSync(join(tmpdir(), 'sacp-'))
  created.push(dir)
  const plan = samplePlan()
  const planPath = join(dir, 'plan.json')
  writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n', 'utf8')
  return { dir, planPath, plan }
}

describe('approval', () => {
  it('recordApproval with matching hash writes approval.json next to the plan', () => {
    const { dir, planPath, plan } = setup()
    recordApproval(planPath, plan, planHash(plan))
    const file = join(dir, 'approval.json')
    expect(existsSync(file)).toBe(true)
    expect(JSON.parse(readFileSync(file, 'utf8')).planHash).toBe(planHash(plan))
    expect(checkApproval(planPath, plan)).toMatchObject({ ok: true })
  })

  it('recordApproval with wrong hash throws ApprovalError and writes nothing', () => {
    const { dir, planPath, plan } = setup()
    expect(() => recordApproval(planPath, plan, 'a'.repeat(64))).toThrow(ApprovalError)
    expect(existsSync(join(dir, 'approval.json'))).toBe(false)
  })

  it('checkApproval missing', () => {
    const { planPath, plan } = setup()
    expect(checkApproval(planPath, plan)).toEqual({ ok: false, reason: 'missing' })
  })

  it('checkApproval changed after any plan edit', () => {
    const { planPath, plan } = setup()
    recordApproval(planPath, plan, planHash(plan))
    const edited: Plan = { ...plan, title: 'A different title' }
    expect(checkApproval(planPath, edited)).toEqual({ ok: false, reason: 'changed' })
  })
})

describe('state', () => {
  const state: State = {
    changesetId: 'sample-change',
    planHash: 'b'.repeat(64),
    issues: {
      'example-org/alpha': {
        repo: 'example-org/alpha',
        number: 1,
        url: 'https://example.test/example-org/alpha/issues/1',
        bodyDigest: sha256Hex('body'),
      },
    },
    linksFinalized: false,
  }

  it('saveState is atomic and round-trips', () => {
    const { dir, planPath } = setup()
    saveState(planPath, state)
    expect(loadState(planPath)).toEqual(state)
    expect(readdirSync(dir).filter(name => name.includes('.tmp-'))).toEqual([])
  })

  it('loadState null when absent; StateError when invalid', () => {
    const { dir, planPath } = setup()
    expect(loadState(planPath)).toBeNull()
    writeFileSync(join(dir, 'state.json'), '{"changesetId": 1}\n', 'utf8')
    expect(() => loadState(planPath)).toThrow(StateError)
  })
})
