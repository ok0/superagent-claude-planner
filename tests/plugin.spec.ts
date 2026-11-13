import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SKILL_PATH = join(ROOT, 'skills', 'plan', 'SKILL.md')

function readText(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

function frontmatter(text: string): string {
  const lines = text.split('\n')
  const first = lines.indexOf('---')
  const second = lines.indexOf('---', first + 1)
  return lines.slice(first + 1, second).join('\n')
}

function body(text: string): string {
  const lines = text.split('\n')
  const second = lines.indexOf('---', lines.indexOf('---') + 1)
  return lines.slice(second + 1).join('\n')
}

function allowedToolEntries(fm: string): string[] {
  const lines = fm.split('\n')
  const start = lines.indexOf('allowed-tools:')
  const entries: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break
    const trimmed = line.trim()
    if (trimmed.startsWith('- ')) entries.push(trimmed.slice(2).trim())
  }
  return entries
}

describe('plugin packaging', () => {
  it('plugin manifest is named superagent-claude-planner', () => {
    const plugin = JSON.parse(readText('.claude-plugin/plugin.json'))
    expect(plugin.name).toBe('superagent-claude-planner')
    const marketplace = JSON.parse(readText('.claude-plugin/marketplace.json'))
    expect(marketplace.plugins[0].name).toBe('superagent-claude-planner')
    expect(marketplace.plugins[0].source).toBe('./')
  })

  it('launcher is executable', () => {
    const mode = statSync(join(ROOT, 'bin', 'sac-planner')).mode
    expect(mode & 0o111).not.toBe(0)
    expect(readText('bin/sac-planner')).toContain('lib/cli.js')
  })

  it('skill is user-invoked only', () => {
    const fm = frontmatter(readText('skills/plan/SKILL.md'))
    expect(fm).toContain('disable-model-invocation: true')
    expect(fm).toContain('name: plan')
  })

  it('skill grants only the allowed tools', () => {
    const fm = frontmatter(readText('skills/plan/SKILL.md'))
    const entries = allowedToolEntries(fm)
    expect(entries).toEqual([
      'Read',
      'Grep',
      'Glob',
      'Write(./.sac-planner/draft.json)',
      'Bash(sac-planner session *)',
      'Bash(sac-planner save *)',
      'Bash(sac-planner validate *)',
      'Bash(sac-planner show *)',
      'Bash(sac-planner state *)',
      'Bash(sac-planner schema*)',
      'Bash(sac-planner catalog*)',
      'Bash(sac-planner publish * --approve-hash *)',
      'Bash(git clone --depth 1 *)',
    ])
    for (const entry of entries) {
      expect(entry).not.toMatch(/\bgh\b|curl|wget|git push/)
    }
    expect(entries).toContain('Write(./.sac-planner/draft.json)')
    const publishEntries = entries.filter(e => e.includes('publish'))
    expect(publishEntries).toHaveLength(1)
    expect(publishEntries[0]).toContain('--approve-hash')
  })

  it('guard hook is declared in frontmatter', () => {
    const fm = frontmatter(readText('skills/plan/SKILL.md'))
    expect(fm).toContain('PreToolUse')
    expect(fm).toContain('matcher: "Bash"')
    expect(fm).toContain('hooks/guard-bash.mjs')
    expect(existsSync(join(ROOT, 'hooks', 'guard-bash.mjs'))).toBe(true)
  })

  it('skill body covers the approval flow', () => {
    const text = body(readText('skills/plan/SKILL.md'))
    const required = [
      '.sac-planner/.session-active',
      'sac-planner session start',
      'sac-planner session end',
      'sac-planner save --file',
      '.sac-planner/draft.json',
      'one command per Bash call',
      'done',
      'sac-planner catalog',
      'sac-planner validate',
      'sac-planner show',
      '--approve-hash',
      '(A) staged',
      '(B) at-once',
      'never choose for the user',
      're-run `show`',
      'never skip',
      'Ask the user to confirm or correct the list, roles, and slugs',
      'only a guess',
    ]
    for (const needle of required) {
      expect(text).toContain(needle)
    }
    expect(text).not.toContain('Use the Write tool')
    expect(text).not.toContain('SAC_PLAN_EOF')
    expect(text).not.toContain('gh issue')
    expect(text).not.toContain('api.github.com')
  })

  it('skill confirms the repositories before it saves a plan', () => {
    const text = body(readText('skills/plan/SKILL.md'))
    const confirm = text.indexOf('Ask the user to confirm or correct the list, roles, and slugs')
    const save = text.indexOf('sac-planner save --file')
    const approve = text.indexOf('--approve-hash')
    expect(confirm).toBeGreaterThan(-1)
    expect(confirm).toBeLessThan(save)
    expect(save).toBeLessThan(approve)
    expect(text).toContain('separate from the approval in step 9')
  })
})

describe('launcher fallback', () => {
  const SYS = '/usr/bin:/bin'
  const NODE_DIR = dirname(process.execPath)
  const temps: string[] = []

  afterEach(() => {
    for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true })
  })

  function plugin(withLib: boolean): string {
    const d = mkdtempSync(join(tmpdir(), 'sac-launcher-'))
    temps.push(d)
    mkdirSync(join(d, 'bin'))
    copyFileSync(join(ROOT, 'bin', 'sac-planner'), join(d, 'bin', 'sac-planner'))
    chmodSync(join(d, 'bin', 'sac-planner'), 0o755)
    if (withLib) {
      mkdirSync(join(d, 'lib'))
      writeFileSync(join(d, 'lib', 'cli.js'), "console.log('local ' + process.argv.slice(2).join(' '))\n")
    }
    return d
  }

  function fakeGlobal(): string {
    const g = mkdtempSync(join(tmpdir(), 'sac-global-'))
    temps.push(g)
    const bin = join(g, 'sac-planner')
    writeFileSync(bin, '#!/bin/sh\necho "global $*"\n')
    chmodSync(bin, 0o755)
    return g
  }

  function launch(dir: string, path: string) {
    return spawnSync(join(dir, 'bin', 'sac-planner'), ['--help'], {
      encoding: 'utf8',
      timeout: 5000,
      env: { PATH: path, HOME: tmpdir() },
    })
  }

  it('uses the local build when lib/cli.js exists', () => {
    const d = plugin(true)
    const g = fakeGlobal()
    const r = launch(d, `${d}/bin:${g}:${NODE_DIR}:${SYS}`)
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('local --help')
  })

  it('falls back to another sac-planner on PATH when lib/ is missing', () => {
    const d = plugin(false)
    const g = fakeGlobal()
    const r = launch(d, `${d}/bin:${g}:${SYS}`)
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('global --help')
  })

  it('prints an install hint when no other CLI exists', () => {
    const d = plugin(false)
    const r = launch(d, `${d}/bin:${SYS}`)
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('npm i -g superagent-claude-planner')
    expect(r.stderr).toContain('docs/setup.md')
  })

  it('does not loop through another launcher copy without lib/', () => {
    const a = plugin(false)
    const b = plugin(false)
    const r = launch(a, `${a}/bin:${b}/bin:${SYS}`)
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('npm i -g superagent-claude-planner')
  })
})
