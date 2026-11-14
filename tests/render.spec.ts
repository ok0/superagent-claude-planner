import { describe, expect, it } from 'vitest'
import { createIssuecrewProfile } from '../src/adapters/agent/issuecrew.ts'
import { getAgentProfile } from '../src/core/agent.ts'
import { ConfigError } from '../src/core/errors.ts'
import { publishOrder } from '../src/core/plan/order.ts'
import type { Plan } from '../src/core/plan/schema.ts'
import {
  AT_ONCE_SENTENCE,
  CONTRACT_BEGIN,
  CONTRACT_END,
  STAGED_SENTENCE,
  renderAll,
  renderContract,
  renderIssue,
} from '../src/core/render/render.ts'
import { samplePlan } from './support/plans.ts'

const agent = createIssuecrewProfile({ login: 'agent-login-x' })
const noLinks = {}

function contractSlice(body: string): string {
  const start = body.indexOf(CONTRACT_BEGIN)
  const end = body.indexOf(CONTRACT_END) + CONTRACT_END.length
  return body.slice(start, end)
}

function linksFor(plan: Plan): Record<string, { repo: string; number: number; url: string }> {
  return Object.fromEntries(
    publishOrder(plan).map((repo, i) => [repo, { repo, number: 10 + i, url: 'https://example.invalid/' + i }]),
  )
}

describe('render', () => {
  it('contract block byte-identical', () => {
    const plan = samplePlan()
    const issues = renderAll(plan, { agent, links: noLinks })
    expect(issues).toHaveLength(3)
    const contract = renderContract(plan)
    for (const issue of issues) {
      expect(contractSlice(issue.body)).toBe(contract)
    }
    const linked = renderAll(plan, { agent, links: linksFor(plan) })
    for (const issue of linked) {
      expect(contractSlice(issue.body)).toBe(contract)
    }
  })

  it('section order', () => {
    const plan = samplePlan()
    const body = renderIssue(plan, 'example-org/storefront', { agent, links: noLinks }).body
    const lines = body.split('\n')
    expect(lines[0]).toBe('<!-- issuecrew-planner:sample-change:example-org/storefront -->')
    expect(lines[2]).toBe('@agent-login-x please work on this issue.')
    const headings = [
      '## Changeset',
      '## Shared contract',
      '## Your task (',
      '## Merge order',
      '## Related issues',
      '## Original request',
      '## Notes for the agent',
    ]
    const idx = headings.map(h => body.indexOf(h))
    expect(idx.every(i => i >= 0)).toBe(true)
    for (let i = 1; i < idx.length; i++) {
      expect(idx[i]).toBeGreaterThan(idx[i - 1] as number)
    }
  })

  it('title', () => {
    const plan = samplePlan()
    const issue = renderAll(plan, { agent, links: noLinks }).find(i => i.repo === 'example-org/orders-api')
    const summary = plan.repos.find(r => r.repo === 'example-org/orders-api')?.task.summary
    expect(issue?.title).toBe(`[sample-change] ${summary}`)
  })

  it('renderAll order equals publishOrder', () => {
    const plan = samplePlan()
    const repos = renderAll(plan, { agent, links: noLinks }).map(i => i.repo)
    expect(repos).toEqual(publishOrder(plan))
  })

  it('merge order', () => {
    const plan = samplePlan()
    const body = renderIssue(plan, 'example-org/catalog-api', { agent, links: noLinks }).body
    expect(body).toContain('1. example-org/catalog-api')
    expect(body).toContain('2. example-org/storefront, example-org/orders-api')
    expect(body.split('(this issue)').length - 1).toBe(1)
    expect(body).toContain('Deploy catalog-api first.')
    const linked = renderIssue(plan, 'example-org/catalog-api', { agent, links: linksFor(plan) }).body
    expect(linked).toContain('example-org/catalog-api#10')
  })

  it('related', () => {
    const plan = samplePlan()
    const pending = renderIssue(plan, 'example-org/storefront', { agent, links: noLinks }).body
    expect(pending).toContain('- example-org/catalog-api (issue pending, changeset sample-change)')
    expect(pending).toContain('- example-org/orders-api (issue pending, changeset sample-change)')
    expect(pending).not.toContain('- example-org/storefront')
    const linked = renderIssue(plan, 'example-org/storefront', { agent, links: linksFor(plan) }).body
    expect(linked).toContain('- example-org/orders-api#12')
  })

  it('at-once', () => {
    const plan = samplePlan()
    plan.breaking = { isBreaking: true, strategy: 'at-once' }
    plan.contract.changes = [{ kind: 'rename', target: 'Product.skuCode' }]
    for (const issue of renderAll(plan, { agent, links: noLinks })) {
      expect(issue.body).toContain(AT_ONCE_SENTENCE)
      expect(issue.body).not.toContain(STAGED_SENTENCE)
    }
  })

  it('staged', () => {
    const plan = samplePlan()
    plan.breaking = { isBreaking: true, strategy: 'staged' }
    plan.contract.changes = [{ kind: 'rename', target: 'Product.skuCode' }]
    for (const issue of renderAll(plan, { agent, links: noLinks })) {
      expect(issue.body).toContain(STAGED_SENTENCE)
      expect(issue.body).not.toContain(AT_ONCE_SENTENCE)
    }
  })

  it('non-breaking has neither sentence', () => {
    for (const issue of renderAll(samplePlan(), { agent, links: noLinks })) {
      expect(issue.body).not.toContain(AT_ONCE_SENTENCE)
      expect(issue.body).not.toContain(STAGED_SENTENCE)
    }
  })

  it('request', () => {
    const body = renderIssue(samplePlan(), 'example-org/storefront', { agent, links: noLinks }).body
    expect(body).toContain('URL: https://example.com/requests/7')
    expect(body).toContain('> Products need a SKU code.')
    expect(body).toContain('> Show it in orders and the storefront.')
  })

  it('agent notes', () => {
    const body = renderIssue(samplePlan(), 'example-org/storefront', { agent, links: noLinks }).body
    expect(body).toContain('- The shared contract above is fixed.')
    expect(body).toContain('stop and report')
    expect(body).toContain('pull request description')
    expect(body).toContain('`sample-change`')
  })

  it('fence', () => {
    const plan = samplePlan()
    plan.contract.definition = 'const fence = "```"'
    expect(renderContract(plan)).toContain('````typescript\n' + plan.contract.definition + '\n````')
  })

  it('deterministic, no attribution', () => {
    const plan = samplePlan()
    const first = renderAll(plan, { agent, links: noLinks })
    const second = renderAll(plan, { agent, links: noLinks })
    expect(first).toEqual(second)
    const forbidden = /co-authored-by|generated (with|by)|\bclaude\b|\bAI\b|\bM\d+\b|\d{4}-\d{2}-\d{2}T\d{2}/i
    for (const issue of first) {
      expect(issue.title).not.toMatch(forbidden)
      expect(issue.body).not.toMatch(forbidden)
    }
  })

  it('profile', () => {
    const profile = createIssuecrewProfile({ login: 'agent-login-x' })
    expect(profile.mentionLine()).toBe('@agent-login-x please work on this issue.')
    expect(profile.setupDoc).toContain('policy.allowed')
    expect(profile.setupDoc).toContain('agent-login-x')
    const resolved = getAgentProfile({ kind: 'issuecrew', login: 'a' }, { issuecrew: createIssuecrewProfile })
    expect(resolved.login).toBe('a')
    expect(() => getAgentProfile({ kind: 'nope', login: 'a' }, { issuecrew: createIssuecrewProfile })).toThrow(
      ConfigError,
    )
    expect(() => getAgentProfile({ kind: 'nope', login: 'a' }, { issuecrew: createIssuecrewProfile })).toThrow(
      /unknown agent\.kind/,
    )
  })
})
