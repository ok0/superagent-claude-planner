import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { main } from '../src/cli/main.ts'
import { loadCatalog } from '../src/core/catalog.ts'
import { loadConfig } from '../src/core/config.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const created: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sacp-catalog-'))
  created.push(dir)
  return dir
}

async function run(
  argv: string[],
  opts: { cwd?: string; env?: Record<string, string | undefined> } = {},
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
  })
  return { code, out, err }
}

function writeFile(dir: string, name: string, text: string): string {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, name)
  writeFileSync(file, text)
  return file
}

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
})

describe('catalog', () => {
  it('loadCatalog returns null when none is configured', () => {
    expect(loadCatalog({})).toBeNull()
  })

  it('catalog command without any config prints no catalog configured', async () => {
    const dir = tempDir()
    const r = await run(['catalog'], { cwd: dir, env: { HOME: tempDir() } })
    expect(r.code).toBe(0)
    expect(r.out).toBe('no catalog configured\n')
    expect(r.err).toBe('')
  })

  it('catalog command with a config without catalog prints no catalog configured', async () => {
    const dir = tempDir()
    writeFile(dir, 'sac-planner.config.json', JSON.stringify({ agent: { login: '<agent-login>' } }))
    const r = await run(['catalog'], { cwd: dir, env: { HOME: tempDir() } })
    expect(r.code).toBe(0)
    expect(r.out).toBe('no catalog configured\n')
    expect(r.err).toBe('')
  })

  it('valid catalog prints its repos', async () => {
    const dir = tempDir()
    writeFile(dir, 'sac-planner.config.json', JSON.stringify({ agent: { login: 'a' }, catalog: 'cat.json' }))
    writeFile(
      dir,
      'cat.json',
      JSON.stringify({
        repos: [
          {
            repo: 'example-org/one',
            description: 'first repo',
            localPath: 'repos/one',
            contracts: ['api/spec.yaml'],
          },
          { repo: 'example-org/two', description: 'second repo' },
        ],
      }),
    )
    const r = await run(['catalog'], { cwd: dir, env: { HOME: tempDir() } })
    expect(r.code).toBe(0)
    expect(r.err).toBe('')
    expect(r.out).toContain('example-org/one')
    expect(r.out).toContain('example-org/two')
    expect(r.out).toContain(`localPath: ${join(dir, 'repos', 'one')}`)
    expect(r.out).toContain('contracts: api/spec.yaml')
  })

  it('catalog --json prints the catalog with absolute localPath', async () => {
    const dir = tempDir()
    writeFile(dir, 'sac-planner.config.json', JSON.stringify({ agent: { login: 'a' }, catalog: 'cat.json' }))
    writeFile(
      dir,
      'cat.json',
      JSON.stringify({
        repos: [
          { repo: 'example-org/one', description: 'first repo', localPath: 'repos/one' },
          { repo: 'example-org/two', description: 'second repo' },
        ],
      }),
    )
    const r = await run(['catalog', '--json'], { cwd: dir, env: { HOME: tempDir() } })
    expect(r.code).toBe(0)
    const parsed = JSON.parse(r.out) as { repos: { localPath?: string }[] }
    expect(parsed.repos.length).toBe(2)
    expect(isAbsolute(parsed.repos[0]?.localPath ?? '')).toBe(true)
  })

  it('missing configured catalog fails naming the file', async () => {
    const dir = tempDir()
    writeFile(dir, 'sac-planner.config.json', JSON.stringify({ agent: { login: 'a' }, catalog: 'nope.json' }))
    const r = await run(['catalog'], { cwd: dir, env: { HOME: tempDir() } })
    expect(r.code).toBe(2)
    expect(r.err).toContain(join(dir, 'nope.json'))
    expect(r.err).toContain('docs/setup.md')
  })

  it('invalid catalog fails naming the file', async () => {
    const cases: string[] = [
      '{',
      JSON.stringify({ repos: [{ repo: 'bad', description: 'x' }] }),
      JSON.stringify({
        repos: [
          { repo: 'example-org/One', description: 'x' },
          { repo: 'example-org/one', description: 'y' },
        ],
      }),
    ]
    for (const text of cases) {
      const dir = tempDir()
      writeFile(dir, 'sac-planner.config.json', JSON.stringify({ agent: { login: 'a' }, catalog: 'cat.json' }))
      writeFile(dir, 'cat.json', text)
      const r = await run(['catalog'], { cwd: dir, env: { HOME: tempDir() } })
      expect(r.code).toBe(2)
      expect(r.err).toContain(join(dir, 'cat.json'))
    }
  })

  it('example fixture catalog loads', () => {
    const config = loadConfig({
      path: 'fixtures/synthetic-shop/config.with-catalog.json',
      env: { HOME: tempDir() },
      cwd: ROOT,
    })
    const catalog = loadCatalog(config)
    expect(catalog).not.toBeNull()
    expect(catalog?.repos.length).toBe(3)
    for (const r of catalog?.repos ?? []) {
      expect(r.localPath).toBeDefined()
      expect(existsSync(r.localPath ?? '')).toBe(true)
    }
  })

  it('usage lists catalog', async () => {
    const r = await run(['--help'])
    expect(r.code).toBe(0)
    expect(r.out).toContain('catalog [--json]')
  })
})
