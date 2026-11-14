import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { main } from '../src/cli/main.ts'
import * as lib from '../src/core/index.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const EXAMPLE = join(ROOT, 'examples', 'plan.json')
const created: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'issuecrew-'))
  created.push(dir)
  return dir
}

function emptyHome(): string {
  return tempDir()
}

async function run(
  argv: string[],
  opts: { cwd?: string; env?: Record<string, string | undefined> } = {},
): Promise<{ code: number; out: string; err: string }> {
  let out = ''
  let err = ''
  const env = opts.env ?? { HOME: emptyHome() }
  const code = await main(argv, {
    out: s => {
      out += s
    },
    err: s => {
      err += s
    },
    cwd: opts.cwd ?? ROOT,
    env,
  })
  return { code, out, err }
}

function writePlan(mutate: (plan: Record<string, unknown>) => void): string {
  const plan = JSON.parse(readFileSync(EXAMPLE, 'utf8')) as Record<string, unknown>
  mutate(plan)
  const dir = tempDir()
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'plan.json')
  writeFileSync(file, JSON.stringify(plan, null, 2))
  return file
}

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
})

describe('validate', () => {
  it('validate example prints OK with a hash and exits 0', async () => {
    const r = await run(['validate', 'examples/plan.json'])
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/^OK [0-9a-f]{64}\n$/)
  })

  it('validate missing title reports Required', async () => {
    const file = writePlan(plan => {
      delete plan.title
    })
    const r = await run(['validate', file])
    expect(r.code).toBe(1)
    expect(r.out).toContain('title: Required\n')
  })

  it('validate breaking without strategy reports the strategy error', async () => {
    const file = writePlan(plan => {
      plan.breaking = { isBreaking: true }
    })
    const r = await run(['validate', file])
    expect(r.code).toBe(1)
    expect(r.out).toContain('breaking.strategy: breaking change requires a recorded choice: staged | at-once')
  })

  it('validate invalid JSON reports the root path', async () => {
    const dir = tempDir()
    const file = join(dir, 'bad.json')
    writeFileSync(file, '{ not json')
    const r = await run(['validate', file])
    expect(r.code).toBe(1)
    expect(r.out.startsWith('(root): invalid JSON')).toBe(true)
  })
})

describe('show', () => {
  it('show example renders every issue and ends with the plan hash', async () => {
    const validated = await run(['validate', 'examples/plan.json'])
    const hash = validated.out.trim().replace(/^OK /, '')
    const r = await run(['show', 'examples/plan.json', '--config', 'issuecrew-planner.config.example.json'])
    expect(r.code).toBe(0)
    expect(r.out.split('=== Issue ').length - 1).toBe(2)
    expect(r.out).toContain('@<agent-login> please work on this issue.')
    expect(r.out.trimEnd().split('\n').at(-1)).toBe(`Plan hash: ${hash}`)
  })

  it('show --json returns issues and planHash', async () => {
    const r = await run(['show', 'examples/plan.json', '--config', 'issuecrew-planner.config.example.json', '--json'])
    expect(r.code).toBe(0)
    const parsed = JSON.parse(r.out) as { planHash: string; issues: unknown[] }
    expect(parsed.issues.length).toBe(2)
    expect(parsed.planHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('show without config exits 2 with a hint', async () => {
    const r = await run(['show', EXAMPLE], { cwd: tempDir(), env: { HOME: emptyHome() } })
    expect(r.code).toBe(2)
    expect(r.err).toContain('hint: ')
  })

  it('show rejects a config with the old agent kind', async () => {
    const dir = tempDir()
    writeFileSync(
      join(dir, 'old.json'),
      JSON.stringify({ agent: { kind: ['superagent', 'claude'].join('-'), login: 'a' } }),
    )
    const r = await run(['show', EXAMPLE, '--config', join(dir, 'old.json')])
    expect(r.code).toBe(2)
    expect(r.err).toContain('unknown agent.kind')
    expect(r.err).toContain('supported: issuecrew')
  })
})

describe('schema', () => {
  it('schema prints a JSON Schema with repos', async () => {
    const r = await run(['schema'])
    expect(r.code).toBe(0)
    expect((JSON.parse(r.out) as { properties: { repos?: unknown } }).properties.repos).toBeDefined()
  })
})

describe('usage', () => {
  it('no arguments exits 2', async () => {
    expect((await run([])).code).toBe(2)
  })

  it('unknown command exits 2', async () => {
    expect((await run(['nope'])).code).toBe(2)
  })

  it('validate without a plan path exits 2', async () => {
    expect((await run(['validate'])).code).toBe(2)
  })

  it('unknown option exits 2', async () => {
    expect((await run(['validate', 'x', '--bogus'])).code).toBe(2)
  })

  it('--help exits 0 and prints usage', async () => {
    const r = await run(['--help'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('Usage: issuecrew-planner')
    expect(r.out).toMatch(/\(publish\)\n  -h, --help +Show this help\n/)
    expect(r.out).not.toContain(')  -h, --help')
  })
})

describe('library entry', () => {
  it('exposes the public functions', () => {
    expect(typeof lib.validatePlan).toBe('function')
    expect(typeof lib.renderAll).toBe('function')
    expect(typeof lib.planHash).toBe('function')
    expect(typeof lib.loadConfig).toBe('function')
    expect(typeof lib.mergeOrder).toBe('function')
    expect(typeof lib.planJsonSchema).toBe('function')
  })
})
