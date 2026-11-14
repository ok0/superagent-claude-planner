import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createIssuecrewProfile } from '../src/adapters/agent/issuecrew.ts'
import { recordApproval } from '../src/core/approval.ts'
import { ApprovalError, GitHubError, IdentityError, PublishError, StateError } from '../src/core/errors.ts'
import { planHash } from '../src/core/hash.ts'
import type { IssueHost } from '../src/core/github/port.ts'
import { publishOrder } from '../src/core/plan/order.ts'
import type { Plan } from '../src/core/plan/schema.ts'
import { publish } from '../src/core/publish.ts'
import { CONTRACT_BEGIN, CONTRACT_END, renderContract, renderIssue } from '../src/core/render/render.ts'
import { loadState } from '../src/core/state.ts'
import { FakeIssueHost } from './support/fake-host.ts'
import { samplePlan } from './support/plans.ts'

const created: string[] = []

afterAll(() => {
  for (const dir of created) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'issuecrew-'))
  created.push(dir)
  const plan = samplePlan()
  const planPath = join(dir, 'plan.json')
  writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n', 'utf8')
  const agent = createIssuecrewProfile({ login: 'agent-bot' })
  return { dir, planPath, plan, agent }
}

type Ctx = ReturnType<typeof setup>

function approve(ctx: Ctx, plan: Plan = ctx.plan): void {
  recordApproval(ctx.planPath, plan, planHash(plan))
}

async function rejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p
  } catch (e) {
    return e
  }
  throw new Error('expected the promise to reject')
}

function contractSpan(body: string): string {
  return body.slice(body.indexOf(CONTRACT_BEGIN), body.indexOf(CONTRACT_END) + CONTRACT_END.length)
}

function firstRepo(plan: Plan): string {
  const repo = publishOrder(plan)[0]
  if (repo === undefined) {
    throw new Error('plan has no repos')
  }
  return repo
}

describe('publish', () => {
  it('publishes N issues with contract, links, mention and merge order', async () => {
    const ctx = setup()
    approve(ctx)
    const host = new FakeIssueHost({ login: 'planner-user' })
    const result = await publish({ planPath: ctx.planPath, plan: ctx.plan, agent: ctx.agent, host })

    expect(result.created).toHaveLength(3)
    expect(host.createCalls).toBe(3)

    const contract = renderContract(ctx.plan)
    const bodies = host.bodies()
    expect(bodies).toHaveLength(3)
    expect(new Set(bodies.map(contractSpan)).size).toBe(1)
    for (const body of bodies) {
      expect(body.split(contract).length - 1).toBe(1)
      expect(body).toContain(ctx.plan.changesetId)
      expect(body).toContain(ctx.plan.request.url)
      expect(body).toContain('@agent-bot please work on this issue.')
      expect(body).toContain('## Merge order')
    }
    for (const [repo, issues] of host.issues) {
      const body = issues[0]?.body ?? ''
      expect(body).not.toContain('issue pending')
      for (const other of publishOrder(ctx.plan).filter(r => r !== repo)) {
        const number = host.issues.get(other)?.[0]?.number
        expect(body).toContain(`${other}#${number}`)
      }
    }

    expect(result.linksFinalized).toBe(true)
    expect(result.updated).toBe(3)
    expect(loadState(ctx.planPath)?.linksFinalized).toBe(true)
  })

  it('unapproved plan: 0 host calls', async () => {
    const ctx = setup()
    const host = new FakeIssueHost({ login: 'planner-user' })
    const err = await rejection(publish({ planPath: ctx.planPath, plan: ctx.plan, agent: ctx.agent, host }))
    expect(err).toBeInstanceOf(ApprovalError)
    expect(host.calls).toBe(0)
    expect(existsSync(join(ctx.dir, 'state.json'))).toBe(false)
  })

  it('edited after approval: 0 host calls', async () => {
    const ctx = setup()
    approve(ctx)
    const edited: Plan = { ...ctx.plan, title: 'A different title' }
    const host = new FakeIssueHost({ login: 'planner-user' })
    const err = await rejection(publish({ planPath: ctx.planPath, plan: edited, agent: ctx.agent, host }))
    expect(err).toBeInstanceOf(ApprovalError)
    expect(host.calls).toBe(0)
  })

  it('fail on 2nd create, resume, re-run', async () => {
    const ctx = setup()
    approve(ctx)
    const host = new FakeIssueHost({ login: 'planner-user', failOnCreate: 2 })
    const err = await rejection(publish({ planPath: ctx.planPath, plan: ctx.plan, agent: ctx.agent, host }))
    expect(err).toBeInstanceOf(PublishError)
    expect((err as PublishError).hint).toContain('re-run publish')
    expect(Object.keys(loadState(ctx.planPath)?.issues ?? {})).toHaveLength(1)
    expect(host.bodies()).toHaveLength(1)

    host.failOnCreate = undefined
    const resumed = await publish({ planPath: ctx.planPath, plan: ctx.plan, agent: ctx.agent, host })
    expect(resumed.created).toHaveLength(2)
    expect(resumed.existing).toHaveLength(1)
    expect(host.bodies()).toHaveLength(3)

    const before = host.createCalls
    const again = await publish({ planPath: ctx.planPath, plan: ctx.plan, agent: ctx.agent, host })
    expect(again.created).toHaveLength(0)
    expect(host.createCalls).toBe(before)
    expect(again.updated).toBe(0)
    expect(host.bodies()).toHaveLength(3)
  })

  it('adopts a pre-existing marker issue', async () => {
    const ctx = setup()
    approve(ctx)
    const host = new FakeIssueHost({ login: 'planner-user' })
    const first = firstRepo(ctx.plan)
    const pre = renderIssue(ctx.plan, first, { agent: ctx.agent, links: {} })
    host.seed(first, { title: pre.title, body: pre.body, creator: 'planner-user' })

    const result = await publish({ planPath: ctx.planPath, plan: ctx.plan, agent: ctx.agent, host })
    expect(result.adopted).toHaveLength(1)
    expect(result.created).toHaveLength(2)
    expect(host.bodies()).toHaveLength(3)
  })

  it('issue by another creator is not adopted', async () => {
    const ctx = setup()
    approve(ctx)
    const host = new FakeIssueHost({ login: 'planner-user' })
    const first = firstRepo(ctx.plan)
    const pre = renderIssue(ctx.plan, first, { agent: ctx.agent, links: {} })
    host.seed(first, { title: pre.title, body: pre.body, creator: 'someone-else' })

    const result = await publish({ planPath: ctx.planPath, plan: ctx.plan, agent: ctx.agent, host })
    expect(result.created).toHaveLength(3)
  })

  it('state with different plan hash refuses', async () => {
    const ctx = setup()
    approve(ctx)
    const host = new FakeIssueHost({ login: 'planner-user' })
    await publish({ planPath: ctx.planPath, plan: ctx.plan, agent: ctx.agent, host })

    const edited: Plan = { ...ctx.plan, title: 'A different title' }
    approve(ctx, edited)
    const before = host.createCalls
    const err = await rejection(publish({ planPath: ctx.planPath, plan: edited, agent: ctx.agent, host }))
    expect(err).toBeInstanceOf(StateError)
    expect(host.createCalls).toBe(before)
  })

  it('dryRun: no host, no writes', async () => {
    const ctx = setup()
    const host = new FakeIssueHost({ login: 'planner-user' })
    const result = await publish({ planPath: ctx.planPath, plan: ctx.plan, agent: ctx.agent, host, dryRun: true })
    expect(host.calls).toBe(0)
    expect(result.rendered).toHaveLength(3)
    expect(readdirSync(ctx.dir)).toEqual(['plan.json'])
  })

  it('Bot identity refused before create', async () => {
    const ctx = setup()
    approve(ctx)
    const host = new FakeIssueHost({ login: 'planner-user', type: 'Bot' })
    const err = await rejection(publish({ planPath: ctx.planPath, plan: ctx.plan, agent: ctx.agent, host }))
    expect(err).toBeInstanceOf(IdentityError)
    expect((err as IdentityError).hint).toBe(ctx.agent.setupDoc)
    expect((err as IdentityError).hint).toContain('policy.allowed')
    expect(host.createCalls).toBe(0)
    expect(host.calls).toBe(1)
  })

  it('agent login in any case refused', async () => {
    const ctx = setup()
    approve(ctx)
    const host = new FakeIssueHost({ login: 'AGENT-Bot' })
    const err = await rejection(publish({ planPath: ctx.planPath, plan: ctx.plan, agent: ctx.agent, host }))
    expect(err).toBeInstanceOf(IdentityError)
    expect(host.calls).toBe(1)
  })

  it('update failure keeps pending form and resumes finalization', async () => {
    const ctx = setup()
    approve(ctx)
    const inner = new FakeIssueHost({ login: 'planner-user' })
    let failed = false
    const flaky: IssueHost = {
      whoami: () => inner.whoami(),
      createIssue: (repo, input) => inner.createIssue(repo, input),
      findIssueByMarker: (repo, marker, creator) => inner.findIssueByMarker(repo, marker, creator),
      updateIssueBody: async (repo, number, body) => {
        if (!failed) {
          failed = true
          throw new GitHubError(500, 'x')
        }
        return inner.updateIssueBody(repo, number, body)
      },
    }
    const err = await rejection(publish({ planPath: ctx.planPath, plan: ctx.plan, agent: ctx.agent, host: flaky }))
    expect(err).toBeInstanceOf(PublishError)
    expect(loadState(ctx.planPath)?.linksFinalized).toBe(false)

    const resumed = await publish({ planPath: ctx.planPath, plan: ctx.plan, agent: ctx.agent, host: inner })
    expect(loadState(ctx.planPath)?.linksFinalized).toBe(true)
    expect(resumed.linksFinalized).toBe(true)
    expect(resumed.created).toHaveLength(0)
  })
})
