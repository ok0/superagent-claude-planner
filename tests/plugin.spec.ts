import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

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
      'Write',
      'Edit',
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
      'active <',
      'done',
      'sac-planner catalog',
      'sac-planner validate',
      'sac-planner show',
      '--approve-hash',
      '(A) staged',
      '(B) at-once',
      'never choose for the user',
      're-run `show`',
    ]
    for (const needle of required) {
      expect(text).toContain(needle)
    }
    expect(text).not.toContain('gh issue')
    expect(text).not.toContain('api.github.com')
  })
})
