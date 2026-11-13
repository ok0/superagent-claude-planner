import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { main } from '../src/cli/main.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const EXAMPLE = join(ROOT, 'examples', 'plan.json')
const EXAMPLE_TEXT = readFileSync(EXAMPLE, 'utf8')
const ID = (JSON.parse(EXAMPLE_TEXT) as { changesetId: string }).changesetId
const created: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sacp-sess-'))
  created.push(dir)
  return dir
}

async function run(
  argv: string[],
  opts: { cwd?: string; env?: Record<string, string | undefined>; stdin?: string } = {},
): Promise<{ code: number; out: string; err: string }> {
  let out = ''
  let err = ''
  const code = await main(argv, {
    out: s => {
      out += s
    },
    err: s => {
      err += s
    },
    cwd: opts.cwd ?? ROOT,
    env: opts.env ?? { HOME: tempDir() },
    readStdin: async () => opts.stdin ?? '',
  })
  return { code, out, err }
}

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
})

describe('save', () => {
  it('writes a valid plan under .sac-planner and prints its hash', async () => {
    const d = tempDir()
    const r = await run(['save'], { cwd: d, stdin: EXAMPLE_TEXT })
    expect(r.code).toBe(0)
    const m = new RegExp('^saved \\.sac-planner/' + ID + '/plan\\.json\\nOK (\\S+)\\n$').exec(r.out)
    expect(m).not.toBeNull()
    expect(existsSync(join(d, '.sac-planner', ID, 'plan.json'))).toBe(true)
    const v = await run(['validate', '.sac-planner/' + ID + '/plan.json'], { cwd: d })
    expect(v.out).toBe('OK ' + m![1] + '\n')
  })

  it('uses CLAUDE_PROJECT_DIR as the root', async () => {
    const a = tempDir()
    const b = tempDir()
    const r = await run(['save'], { cwd: b, env: { HOME: tempDir(), CLAUDE_PROJECT_DIR: a }, stdin: EXAMPLE_TEXT })
    expect(r.code).toBe(0)
    expect(existsSync(join(a, '.sac-planner', ID, 'plan.json'))).toBe(true)
    expect(existsSync(join(b, '.sac-planner'))).toBe(false)
  })

  it('rejects invalid JSON and writes nothing', async () => {
    const d = tempDir()
    const r = await run(['save'], { cwd: d, stdin: '{' })
    expect(r.code).toBe(1)
    expect(r.out.startsWith('(root): invalid JSON')).toBe(true)
    expect(existsSync(join(d, '.sac-planner'))).toBe(false)
  })

  it('rejects an invalid plan and writes nothing', async () => {
    const d = tempDir()
    const plan = JSON.parse(EXAMPLE_TEXT) as Record<string, unknown>
    plan.changesetId = 'X'
    const r = await run(['save'], { cwd: d, stdin: JSON.stringify(plan) })
    expect(r.code).toBe(1)
    expect(r.out).toContain('changesetId')
    expect(existsSync(join(d, '.sac-planner'))).toBe(false)
  })

  it('records no approval or state', async () => {
    const d = tempDir()
    const r = await run(['save'], { cwd: d, stdin: EXAMPLE_TEXT })
    expect(r.code).toBe(0)
    expect(readdirSync(join(d, '.sac-planner', ID))).toEqual(['plan.json'])
  })

  it('takes no positional argument', async () => {
    const d = tempDir()
    const r = await run(['save', 'p.json'], { cwd: d, stdin: EXAMPLE_TEXT })
    expect(r.code).toBe(2)
  })
})

describe('session', () => {
  it('start writes a fresh active marker', async () => {
    const d = tempDir()
    const before = Date.now()
    const r = await run(['session', 'start'], { cwd: d })
    expect(r.code).toBe(0)
    const content = readFileSync(join(d, '.sac-planner', '.session-active'), 'utf8').trim()
    const m = /^active (\S+)$/.exec(content)
    expect(m).not.toBeNull()
    const t = Date.parse(m![1]!)
    expect(t >= before && t <= Date.now()).toBe(true)
    expect(r.out.startsWith('session active ')).toBe(true)
  })

  it('start refreshes a stale marker', async () => {
    const d = tempDir()
    mkdirSync(join(d, '.sac-planner'), { recursive: true })
    writeFileSync(join(d, '.sac-planner', '.session-active'), 'active 2000-01-01T00:00:00.000Z\n')
    const before = Date.now()
    const r = await run(['session', 'start'], { cwd: d })
    expect(r.code).toBe(0)
    const content = readFileSync(join(d, '.sac-planner', '.session-active'), 'utf8').trim()
    const m = /^active (\S+)$/.exec(content)
    expect(m).not.toBeNull()
    expect(Date.parse(m![1]!) >= before).toBe(true)
  })

  it('end writes done', async () => {
    const d = tempDir()
    const r = await run(['session', 'end'], { cwd: d })
    expect(r.code).toBe(0)
    const content = readFileSync(join(d, '.sac-planner', '.session-active'), 'utf8').trim()
    expect(content).toBe('done')
    expect(r.out).toBe('session done\n')
  })

  it('needs start or end', async () => {
    const d1 = tempDir()
    const r1 = await run(['session'], { cwd: d1 })
    expect(r1.code).toBe(2)
    expect(existsSync(join(d1, '.sac-planner', '.session-active'))).toBe(false)
    const d2 = tempDir()
    const r2 = await run(['session', 'x'], { cwd: d2 })
    expect(r2.code).toBe(2)
    expect(existsSync(join(d2, '.sac-planner', '.session-active'))).toBe(false)
  })
})
