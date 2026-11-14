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
  const dir = mkdtempSync(join(tmpdir(), 'issuecrew-sess-'))
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
  it('writes a valid plan under .issuecrew-planner and prints its hash', async () => {
    const d = tempDir()
    const r = await run(['save'], { cwd: d, stdin: EXAMPLE_TEXT })
    expect(r.code).toBe(0)
    const m = new RegExp('^saved \\.issuecrew-planner/' + ID + '/plan\\.json\\nOK (\\S+)\\n$').exec(r.out)
    expect(m).not.toBeNull()
    expect(existsSync(join(d, '.issuecrew-planner', ID, 'plan.json'))).toBe(true)
    const v = await run(['validate', '.issuecrew-planner/' + ID + '/plan.json'], { cwd: d })
    expect(v.out).toBe('OK ' + m![1] + '\n')
  })

  it('uses CLAUDE_PROJECT_DIR as the root', async () => {
    const a = tempDir()
    const b = tempDir()
    const r = await run(['save'], { cwd: b, env: { HOME: tempDir(), CLAUDE_PROJECT_DIR: a }, stdin: EXAMPLE_TEXT })
    expect(r.code).toBe(0)
    expect(existsSync(join(a, '.issuecrew-planner', ID, 'plan.json'))).toBe(true)
    expect(existsSync(join(b, '.issuecrew-planner'))).toBe(false)
  })

  it('rejects invalid JSON and writes nothing', async () => {
    const d = tempDir()
    const r = await run(['save'], { cwd: d, stdin: '{' })
    expect(r.code).toBe(1)
    expect(r.out.startsWith('(root): invalid JSON')).toBe(true)
    expect(existsSync(join(d, '.issuecrew-planner'))).toBe(false)
  })

  it('rejects an invalid plan and writes nothing', async () => {
    const d = tempDir()
    const plan = JSON.parse(EXAMPLE_TEXT) as Record<string, unknown>
    plan.changesetId = 'X'
    const r = await run(['save'], { cwd: d, stdin: JSON.stringify(plan) })
    expect(r.code).toBe(1)
    expect(r.out).toContain('changesetId')
    expect(existsSync(join(d, '.issuecrew-planner'))).toBe(false)
  })

  it('records no approval or state', async () => {
    const d = tempDir()
    const r = await run(['save'], { cwd: d, stdin: EXAMPLE_TEXT })
    expect(r.code).toBe(0)
    expect(readdirSync(join(d, '.issuecrew-planner', ID))).toEqual(['plan.json'])
  })

  it('takes no positional argument', async () => {
    const d = tempDir()
    const r = await run(['save', 'p.json'], { cwd: d, stdin: EXAMPLE_TEXT })
    expect(r.code).toBe(2)
  })

  it('saves a draft file given by --file with the same hash as stdin', async () => {
    const d = tempDir()
    mkdirSync(join(d, '.issuecrew-planner'), { recursive: true })
    writeFileSync(join(d, '.issuecrew-planner', 'draft.json'), EXAMPLE_TEXT)
    const r = await run(['save', '--file', '.issuecrew-planner/draft.json'], { cwd: d })
    expect(r.code).toBe(0)
    const m = new RegExp('^saved \\.issuecrew-planner/' + ID + '/plan\\.json\\nOK (\\S+)\\n$').exec(r.out)
    expect(m).not.toBeNull()
    expect(existsSync(join(d, '.issuecrew-planner', ID, 'plan.json'))).toBe(true)
    expect(existsSync(join(d, '.issuecrew-planner', 'draft.json'))).toBe(false)
    const s = tempDir()
    const viaStdin = await run(['save'], { cwd: s, stdin: EXAMPLE_TEXT })
    expect(viaStdin.out).toBe('saved .issuecrew-planner/' + ID + '/plan.json\nOK ' + m![1] + '\n')
  })

  it('rejects a missing --file and writes nothing', async () => {
    const d = tempDir()
    const r = await run(['save', '--file', '.issuecrew-planner/draft.json'], { cwd: d })
    expect(r.code).toBe(1)
    expect(r.out).toBe('(root): cannot read .issuecrew-planner/draft.json\n')
    expect(existsSync(join(d, '.issuecrew-planner'))).toBe(false)
  })

  it('rejects an invalid --file draft and writes no plan', async () => {
    const d = tempDir()
    mkdirSync(join(d, '.issuecrew-planner'), { recursive: true })
    writeFileSync(join(d, '.issuecrew-planner', 'draft.json'), '{')
    const bad = await run(['save', '--file', '.issuecrew-planner/draft.json'], { cwd: d })
    expect(bad.code).toBe(1)
    expect(bad.out.startsWith('(root): invalid JSON')).toBe(true)
    expect(existsSync(join(d, '.issuecrew-planner', ID, 'plan.json'))).toBe(false)
    expect(existsSync(join(d, '.issuecrew-planner', 'draft.json'))).toBe(true)
    const plan = JSON.parse(EXAMPLE_TEXT) as Record<string, unknown>
    plan.changesetId = 'X'
    writeFileSync(join(d, '.issuecrew-planner', 'draft.json'), JSON.stringify(plan))
    const invalid = await run(['save', '--file', '.issuecrew-planner/draft.json'], { cwd: d })
    expect(invalid.code).toBe(1)
    expect(invalid.out).toContain('changesetId')
    expect(existsSync(join(d, '.issuecrew-planner', ID, 'plan.json'))).toBe(false)
    expect(existsSync(join(d, '.issuecrew-planner', 'X', 'plan.json'))).toBe(false)
    expect(existsSync(join(d, '.issuecrew-planner', 'draft.json'))).toBe(true)
  })

  it('keeps a --file input that is not the session draft', async () => {
    const d = tempDir()
    writeFileSync(join(d, 'input.json'), EXAMPLE_TEXT)
    const r = await run(['save', '--file', 'input.json'], { cwd: d })
    expect(r.code).toBe(0)
    expect(existsSync(join(d, 'input.json'))).toBe(true)
  })

  it('removes the draft under CLAUDE_PROJECT_DIR', async () => {
    const a = tempDir()
    mkdirSync(join(a, '.issuecrew-planner'), { recursive: true })
    writeFileSync(join(a, '.issuecrew-planner', 'draft.json'), EXAMPLE_TEXT)
    const r = await run(['save', '--file', '.issuecrew-planner/draft.json'], {
      cwd: a,
      env: { HOME: tempDir(), CLAUDE_PROJECT_DIR: a },
    })
    expect(r.code).toBe(0)
    expect(existsSync(join(a, '.issuecrew-planner', 'draft.json'))).toBe(false)
    expect(existsSync(join(a, '.issuecrew-planner', ID, 'plan.json'))).toBe(true)
  })
})

describe('session', () => {
  it('start writes a fresh active marker', async () => {
    const d = tempDir()
    const before = Date.now()
    const r = await run(['session', 'start'], { cwd: d })
    expect(r.code).toBe(0)
    const content = readFileSync(join(d, '.issuecrew-planner', '.session-active'), 'utf8').trim()
    const m = /^active (\S+)$/.exec(content)
    expect(m).not.toBeNull()
    const t = Date.parse(m![1]!)
    expect(t >= before && t <= Date.now()).toBe(true)
    expect(r.out.startsWith('session active ')).toBe(true)
  })

  it('start refreshes a stale marker', async () => {
    const d = tempDir()
    mkdirSync(join(d, '.issuecrew-planner'), { recursive: true })
    writeFileSync(join(d, '.issuecrew-planner', '.session-active'), 'active 2000-01-01T00:00:00.000Z\n')
    const before = Date.now()
    const r = await run(['session', 'start'], { cwd: d })
    expect(r.code).toBe(0)
    const content = readFileSync(join(d, '.issuecrew-planner', '.session-active'), 'utf8').trim()
    const m = /^active (\S+)$/.exec(content)
    expect(m).not.toBeNull()
    expect(Date.parse(m![1]!) >= before).toBe(true)
  })

  it('end writes done', async () => {
    const d = tempDir()
    const r = await run(['session', 'end'], { cwd: d })
    expect(r.code).toBe(0)
    const content = readFileSync(join(d, '.issuecrew-planner', '.session-active'), 'utf8').trim()
    expect(content).toBe('done')
    expect(r.out).toBe('session done\n')
  })

  it('end removes a leftover draft', async () => {
    const d = tempDir()
    mkdirSync(join(d, '.issuecrew-planner'), { recursive: true })
    writeFileSync(join(d, '.issuecrew-planner', 'draft.json'), '{')
    const r = await run(['session', 'end'], { cwd: d })
    expect(r.code).toBe(0)
    expect(r.out).toBe('session done\n')
    expect(existsSync(join(d, '.issuecrew-planner', 'draft.json'))).toBe(false)
    const content = readFileSync(join(d, '.issuecrew-planner', '.session-active'), 'utf8').trim()
    expect(content).toBe('done')
  })

  it('needs start or end', async () => {
    const d1 = tempDir()
    const r1 = await run(['session'], { cwd: d1 })
    expect(r1.code).toBe(2)
    expect(existsSync(join(d1, '.issuecrew-planner', '.session-active'))).toBe(false)
    const d2 = tempDir()
    const r2 = await run(['session', 'x'], { cwd: d2 })
    expect(r2.code).toBe(2)
    expect(existsSync(join(d2, '.issuecrew-planner', '.session-active'))).toBe(false)
  })
})
