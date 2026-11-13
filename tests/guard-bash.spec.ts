import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const HOOK = join(ROOT, 'hooks', 'guard-bash.mjs')
const FRESH = 'active ' + new Date().toISOString()
const STALE = 'active ' + new Date(Date.now() - 5 * 3600_000).toISOString()
const DONE = 'done'
const created: string[] = []

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
})

function guard(command: string, marker: string | null, opts?: { config?: object; tool?: string }): 'allow' | 'deny' {
  const dir = mkdtempSync(join(tmpdir(), 'sacp-guard-'))
  created.push(dir)
  if (marker !== null) {
    mkdirSync(join(dir, '.sac-planner'), { recursive: true })
    writeFileSync(join(dir, '.sac-planner', '.session-active'), marker)
  }
  if (opts?.config !== undefined) {
    writeFileSync(join(dir, 'sac-planner.config.json'), JSON.stringify(opts.config))
  }
  const result = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: opts?.tool ?? 'Bash',
      tool_input: { command },
      cwd: dir,
    }),
    env: { PATH: process.env.PATH, HOME: dir, CLAUDE_PROJECT_DIR: dir },
    encoding: 'utf8',
  })
  expect(result.status).toBe(0)
  if (result.stdout === '') return 'allow'
  const parsed = JSON.parse(result.stdout)
  return parsed.hookSpecificOutput.permissionDecision === 'deny' ? 'deny' : 'allow'
}

describe('guard-bash hook', () => {
  it('denies gh issue create with marker active, done and absent', () => {
    const command = 'gh issue create --repo example-org/one --title t --body b'
    expect(guard(command, FRESH)).toBe('deny')
    expect(guard(command, DONE)).toBe('deny')
    expect(guard(command, null)).toBe('deny')
  })

  it('denies commands referencing the token variable', () => {
    expect(guard('echo $PLANNER_GITHUB_TOKEN', null)).toBe('deny')
    expect(
      guard('printenv MY_PLANNER_TOKEN', null, {
        config: { agent: { login: 'a' }, github: { tokenEnv: 'MY_PLANNER_TOKEN' } },
      }),
    ).toBe('deny')
  })

  it('denies curl to the GitHub API', () => {
    expect(guard('curl -X POST https://api.github.com/repos/example-org/one/issues', null)).toBe('deny')
  })

  it('denies rm only while the session is active and fresh', () => {
    expect(guard('rm -rf build', FRESH)).toBe('deny')
    expect(guard('rm -rf build', DONE)).toBe('allow')
    expect(guard('rm -rf build', STALE)).toBe('allow')
    expect(guard('rm -rf build', null)).toBe('allow')
  })

  it('allows read-only and sac-planner commands while active', () => {
    const commands = [
      'sac-planner validate .sac-planner/x/plan.json',
      'sac-planner show p.json',
      'sac-planner publish p.json --approve-hash abc',
      'ls -la',
      'grep -rn foo .',
      'cat a.txt | head -5',
      'git clone --depth 1 https://example.com/r.git .sac-planner/repos/r',
      'git -C repos/one log --oneline',
    ]
    for (const command of commands) {
      expect(guard(command, FRESH), command).toBe('allow')
    }
  })

  it('denies non-allowlisted forms while active', () => {
    const commands = [
      'sac-planner approve p.json --hash h',
      'sac-planner publish p.json',
      'ls > out.txt',
      'git push',
      'find . -delete',
      'echo $(whoami)',
    ]
    for (const command of commands) {
      expect(guard(command, FRESH), command).toBe('deny')
    }
  })

  it('ignores non-Bash tools', () => {
    expect(guard('gh issue create', null, { tool: 'Read' })).toBe('allow')
  })
})
