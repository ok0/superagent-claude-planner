import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { deniedReason, runCheckPack, type PackFn } from '../scripts/check-pack.ts'

const NAME = 'zz-forbidden-' + 'gamma'
const made: string[] = []

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true })
})

function emptyRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'sacp-root-'))
  made.push(root)
  return root
}

function makePack(entries: Record<string, string>): PackFn {
  const base = mkdtempSync(join(tmpdir(), 'sacp-pk-'))
  made.push(base)
  const dir = join(base, 'package')
  for (const [rel, text] of Object.entries(entries)) {
    const full = join(dir, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, text)
  }
  return () => ({ files: Object.keys(entries), dir })
}

function capture() {
  const out: string[] = []
  const err: string[] = []
  return {
    out: (s: string) => out.push(s),
    err: (s: string) => err.push(s),
    outText: () => out.join(''),
    errText: () => err.join(''),
  }
}

const env: Record<string, string | undefined> = { SAC_PLANNER_FORBIDDEN_NAMES: NAME }

const BASE: Record<string, string> = {
  'package.json': JSON.stringify({
    name: 'x',
    repository: { url: 'https://h.example/' + NAME + '/x.git' },
    homepage: 'https://h.example/' + NAME,
    bugs: { url: 'https://h.example/' + NAME },
  }),
  'README.md': '# x\n',
  LICENSE: 'MIT License\n',
  'lib/cli.js': '#!/usr/bin/env node\n',
  'lib/index.js': 'export {}\n',
  'lib/index.d.ts': 'export {}\n',
}

function run(entries: Record<string, string>, runEnv: Readonly<Record<string, string | undefined>> = env) {
  const io = capture()
  const code = runCheckPack({ root: emptyRoot(), env: runEnv, pack: makePack(entries), out: io.out, err: io.err })
  return { code, io }
}

describe('check-pack', () => {
  it('passes with required files and repo-meta exemption', () => {
    const { code, io } = run(BASE)
    expect(code).toBe(0)
    expect(io.outText()).toContain('check-pack: file lib/index.d.ts')
    expect(io.outText()).toContain('check-pack: OK')
  })

  it.each([
    'tests/a.spec.ts',
    'src/core/index.ts',
    'fixtures/x/README.md',
    '.ensemble/plan.md',
    '.sac-planner/x/plan.json',
    'sac-planner.config.json',
    'superagent-claude.json',
    '.forbidden-names',
    '.env.local',
    'lib/state.json',
    'lib/approval.json',
  ])('denied file %s fails', p => {
    const { code, io } = run({ ...BASE, [p]: 'x' })
    expect(code).toBe(1)
    expect(io.errText()).toContain(p)
  })

  it('example config is allowed', () => {
    const { code } = run({ ...BASE, 'sac-planner.config.example.json': '{}\n' })
    expect(code).toBe(0)
  })

  it('missing declarations fail', () => {
    const entries = Object.fromEntries(Object.entries(BASE).filter(([k]) => k !== 'lib/index.d.ts'))
    const { code, io } = run(entries)
    expect(code).toBe(1)
    expect(io.errText()).toContain('missing required file lib/index.d.ts')
  })

  it('forbidden name in README fails', () => {
    const { code, io } = run({ ...BASE, 'README.md': '# ' + NAME })
    expect(code).toBe(1)
    expect(io.errText()).toContain('README.md: forbidden name #1')
  })

  it('token value fails without being printed', () => {
    const token = 'sentinel-token-123456'
    const { code, io } = run(
      { ...BASE, 'lib/index.js': 'const t = "sentinel-token-123456"\n' },
      { SAC_PLANNER_FORBIDDEN_NAMES: NAME, PLANNER_GITHUB_TOKEN: token },
    )
    expect(code).toBe(1)
    expect(io.errText()).toContain('lib/index.js: value of $PLANNER_GITHUB_TOKEN')
    expect(io.outText()).not.toContain(token)
    expect(io.errText()).not.toContain(token)
  })

  it('deniedReason allows built output', () => {
    expect(deniedReason('lib/index.d.ts')).toBeNull()
    expect(deniedReason('lib/cli.js')).toBeNull()
    expect(deniedReason('README.md')).toBeNull()
    expect(deniedReason('lib/x.ts')).toBe('source file')
  })
})
