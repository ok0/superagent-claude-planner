import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createOctokitIssueHost } from '../src/adapters/github/octokit.ts'
import { DEFAULT_AGENTS, main } from '../src/cli/main.ts'
import type { HostFactory } from '../src/cli/main.ts'
import * as lib from '../src/core/index.ts'
import type { IssueHost } from '../src/core/github/port.ts'
import type { Plan } from '../src/core/plan/schema.ts'
import { FakeIssueHost } from './support/fake-host.ts'
import { createGitHubStub } from './support/github-stub.ts'
import { samplePlan } from './support/plans.ts'

const SENTINEL = 'sentinel-token-7f3a9c'
const created: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sacp-'))
  created.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
})

type Ctx = { dir: string; plan: Plan; env: Record<string, string | undefined> }

function setup(): Ctx {
  const dir = tempDir()
  const home = tempDir()
  const plan = samplePlan()
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan, null, 2))
  writeFileSync(
    join(dir, 'sac-planner.config.json'),
    JSON.stringify(
      { agent: { kind: 'superagent-claude', login: 'agent-bot' }, github: { tokenEnv: 'TEST_PLANNER_TOKEN' } },
      null,
      2,
    ),
  )
  return { dir, plan, env: { HOME: home, TEST_PLANNER_TOKEN: SENTINEL } }
}

const noFactory: HostFactory = () => {
  throw new Error('host factory must not be called')
}

async function run(
  argv: string[],
  ctx: Ctx,
  hostFactory: HostFactory = noFactory,
  env: Record<string, string | undefined> = ctx.env,
): Promise<{ code: number; out: string; err: string }> {
  let out = ''
  let err = ''
  const code = await main(
    argv,
    {
      out: s => {
        out += s
      },
      err: s => {
        err += s
      },
      cwd: ctx.dir,
      env,
    },
    DEFAULT_AGENTS,
    hostFactory,
  )
  return { code, out, err }
}

function fakeFactory(host: IssueHost): { factory: HostFactory; tokens: string[] } {
  const tokens: string[] = []
  const factory: HostFactory = ({ token }) => {
    tokens.push(token)
    return host
  }
  return { factory, tokens }
}

function allFileText(dir: string): string {
  return readdirSync(dir)
    .map(name => readFileSync(join(dir, name), 'utf8'))
    .join('\n')
}

function linesStartingWith(text: string, prefix: string): string[] {
  return text.split('\n').filter(line => line.startsWith(prefix))
}

function writeEditedPlan(ctx: Ctx, title: string): void {
  writeFileSync(join(ctx.dir, 'plan.json'), JSON.stringify({ ...ctx.plan, title }, null, 2))
}

describe('publish with approval', () => {
  it('publish --approve-hash records approval and publishes in one invocation', async () => {
    const ctx = setup()
    const host = new FakeIssueHost({ login: 'planner-user' })
    const { factory, tokens } = fakeFactory(host)
    const hash = lib.planHash(ctx.plan)
    const r = await run(['publish', 'plan.json', '--approve-hash', hash], ctx, factory)
    expect(r.code).toBe(0)
    const createdLines = linesStartingWith(r.out, 'created ')
    expect(createdLines.length).toBe(3)
    for (const line of createdLines) expect(line).toContain('https://example.test/')
    expect(existsSync(join(ctx.dir, 'approval.json'))).toBe(true)
    expect(existsSync(join(ctx.dir, 'state.json'))).toBe(true)
    expect(tokens).toEqual([SENTINEL])
  })

  it('stale --approve-hash refuses with exit 1 and creates nothing', async () => {
    const ctx = setup()
    const host = new FakeIssueHost({ login: 'planner-user' })
    const { factory, tokens } = fakeFactory(host)
    const r = await run(['publish', 'plan.json', '--approve-hash', 'a'.repeat(64)], ctx, factory)
    expect(r.code).toBe(1)
    expect(host.calls).toBe(0)
    expect(existsSync(join(ctx.dir, 'approval.json'))).toBe(false)
    expect(tokens.length).toBe(0)
  })

  it('publish without approval exits 1 with message, 0 host calls', async () => {
    const ctx = setup()
    const host = new FakeIssueHost({ login: 'planner-user' })
    const { factory } = fakeFactory(host)
    const r = await run(['publish', 'plan.json'], ctx, factory)
    expect(r.code).toBe(1)
    expect(r.err).toContain('not approved')
    expect(host.calls).toBe(0)
    expect(existsSync(join(ctx.dir, 'state.json'))).toBe(false)
  })

  it('publish after edit exits 1', async () => {
    const ctx = setup()
    const host = new FakeIssueHost({ login: 'planner-user' })
    const { factory } = fakeFactory(host)
    const approved = await run(['approve', 'plan.json', '--hash', lib.planHash(ctx.plan)], ctx)
    expect(approved.code).toBe(0)
    writeEditedPlan(ctx, 'Edited title after approval')
    const r = await run(['publish', 'plan.json'], ctx, factory)
    expect(r.code).toBe(1)
    expect(r.err).toContain('changed after approval')
    expect(host.calls).toBe(0)
  })

  it('approve with wrong hash exits 1 and records nothing', async () => {
    const ctx = setup()
    const r = await run(['approve', 'plan.json', '--hash', '0'.repeat(64)], ctx)
    expect(r.code).toBe(1)
    expect(existsSync(join(ctx.dir, 'approval.json'))).toBe(false)
  })

  it('approve with right hash exits 0', async () => {
    const ctx = setup()
    const hash = lib.planHash(ctx.plan)
    const r = await run(['approve', 'plan.json', '--hash', hash], ctx)
    expect(r.code).toBe(0)
    expect(r.out).toContain('approved sample-change ' + hash)
    expect(existsSync(join(ctx.dir, 'approval.json'))).toBe(true)
  })

  it('host failure exits 3 with resume hint, re-run creates only missing', async () => {
    const ctx = setup()
    const host = new FakeIssueHost({ login: 'planner-user', failOnCreate: 2 })
    const { factory } = fakeFactory(host)
    const first = await run(['publish', 'plan.json', '--approve-hash', lib.planHash(ctx.plan)], ctx, factory)
    expect(first.code).toBe(3)
    expect(first.err).toContain('re-run publish')

    host.failOnCreate = undefined
    const second = await run(['publish', 'plan.json'], ctx, factory)
    expect(second.code).toBe(0)
    expect(linesStartingWith(second.out, 'created ').length).toBe(2)
    expect(linesStartingWith(second.out, 'existing ').length).toBe(1)

    const third = await run(['publish', 'plan.json'], ctx, factory)
    expect(third.code).toBe(0)
    expect(linesStartingWith(third.out, 'created ').length).toBe(0)
  })
})

describe('publish dry run', () => {
  it('publish --dry-run: no token, no host, prints issues', async () => {
    const ctx = setup()
    const r = await run(['publish', 'plan.json', '--dry-run'], ctx, noFactory, { HOME: ctx.env.HOME })
    expect(r.code).toBe(0)
    expect(r.out).toContain('=== Issue 1/3')
    expect(r.out).toContain('dry run: no issues created')
    expect(readdirSync(ctx.dir).sort()).toEqual(['plan.json', 'sac-planner.config.json'])
  })

  it('--dry-run combined with --approve-hash exits 2', async () => {
    const ctx = setup()
    const r = await run(['publish', 'plan.json', '--dry-run', '--approve-hash', lib.planHash(ctx.plan)], ctx)
    expect(r.code).toBe(2)
    expect(r.err).toContain('--dry-run cannot be combined with --approve-hash')
    expect(existsSync(join(ctx.dir, 'approval.json'))).toBe(false)
  })
})

describe('publish token and identity', () => {
  it('missing token exits 2 with clear message', async () => {
    const ctx = setup()
    const host = new FakeIssueHost({ login: 'planner-user' })
    const { factory } = fakeFactory(host)
    const approved = await run(['approve', 'plan.json', '--hash', lib.planHash(ctx.plan)], ctx)
    expect(approved.code).toBe(0)
    const r = await run(['publish', 'plan.json'], ctx, factory, { HOME: ctx.env.HOME })
    expect(r.code).toBe(2)
    expect(r.err).toContain('TEST_PLANNER_TOKEN is not set')
    expect(host.calls).toBe(0)
  })

  it('bot identity exits 1 with setup hint', async () => {
    const ctx = setup()
    const host = new FakeIssueHost({ login: 'planner-user', type: 'Bot' })
    const { factory } = fakeFactory(host)
    const r = await run(['publish', 'plan.json', '--approve-hash', lib.planHash(ctx.plan)], ctx, factory)
    expect(r.code).toBe(1)
    expect(r.err).toContain('policy.allowed')
    expect(host.createCalls).toBe(0)
  })

  it('agent login (other case) exits 1', async () => {
    const ctx = setup()
    const host = new FakeIssueHost({ login: 'AGENT-Bot' })
    const { factory } = fakeFactory(host)
    const r = await run(['publish', 'plan.json', '--approve-hash', lib.planHash(ctx.plan)], ctx, factory)
    expect(r.code).toBe(1)
    expect(host.createCalls).toBe(0)
  })
})

describe('publish token secrecy', () => {
  it('sentinel token absent on success path', async () => {
    const ctx = setup()
    const host = new FakeIssueHost({ login: 'planner-user' })
    const { factory } = fakeFactory(host)
    const r = await run(['publish', 'plan.json', '--approve-hash', lib.planHash(ctx.plan)], ctx, factory)
    expect(r.code).toBe(0)
    expect(r.out).not.toContain(SENTINEL)
    expect(r.err).not.toContain(SENTINEL)
    expect(allFileText(ctx.dir)).not.toContain(SENTINEL)
    for (const body of host.bodies()) expect(body).not.toContain(SENTINEL)
  })

  it('sentinel token absent on adapter error path', async () => {
    const ctx = setup()
    const stub = createGitHubStub({
      'GET /user': () => ({ status: 401, body: { message: 'Bad credentials ' + SENTINEL } }),
    })
    const factory: HostFactory = ({ token }) =>
      createOctokitIssueHost({ token, baseUrl: stub.baseUrl, fetch: stub.fetch })
    const r = await run(['publish', 'plan.json', '--approve-hash', lib.planHash(ctx.plan)], ctx, factory)
    expect(r.code).toBe(3)
    expect(r.out).not.toContain(SENTINEL)
    expect(r.err).not.toContain(SENTINEL)
    expect(allFileText(ctx.dir)).not.toContain(SENTINEL)
  })
})

describe('state command', () => {
  it('state prints summary or a clear none message', async () => {
    const ctx = setup()
    const before = await run(['state', 'plan.json'], ctx)
    expect(before.code).toBe(0)
    expect(before.out).toContain('nothing has been published yet')

    const host = new FakeIssueHost({ login: 'planner-user' })
    const { factory } = fakeFactory(host)
    const published = await run(['publish', 'plan.json', '--approve-hash', lib.planHash(ctx.plan)], ctx, factory)
    expect(published.code).toBe(0)

    const after = await run(['state', 'plan.json'], ctx)
    expect(after.code).toBe(0)
    expect(after.out).toContain('links finalized: yes')
    expect(after.out.split('\n').filter(line => line.includes('#')).length).toBe(3)
  })
})

describe('library entry (approval, state, publish)', () => {
  it('exposes approval, state and publish', () => {
    expect(typeof lib.publish).toBe('function')
    expect(typeof lib.recordApproval).toBe('function')
    expect(typeof lib.checkApproval).toBe('function')
    expect(typeof lib.loadState).toBe('function')
    expect(typeof lib.saveState).toBe('function')
    expect(typeof lib.resolveToken).toBe('function')
  })
})
