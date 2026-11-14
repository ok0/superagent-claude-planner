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
const SAVE =
  'issuecrew-planner save <<\'ISSUECREW_PLAN_EOF\'\n{"note": "uses `gh` (x); y | z $(w) > f"}\nISSUECREW_PLAN_EOF'
const created: string[] = []

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
})

function guard(command: string, marker: string | null, opts?: { config?: object; tool?: string }): 'allow' | 'deny' {
  const dir = mkdtempSync(join(tmpdir(), 'issuecrew-guard-'))
  created.push(dir)
  if (marker !== null) {
    mkdirSync(join(dir, '.issuecrew-planner'), { recursive: true })
    writeFileSync(join(dir, '.issuecrew-planner', '.session-active'), marker)
  }
  if (opts?.config !== undefined) {
    writeFileSync(join(dir, 'issuecrew-planner.config.json'), JSON.stringify(opts.config))
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
    expect(guard('echo $ISSUECREW_PLANNER_GITHUB_TOKEN', null)).toBe('deny')
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

  it('allows read-only and issuecrew-planner commands while active', () => {
    const commands = [
      'issuecrew-planner validate .issuecrew-planner/x/plan.json',
      'issuecrew-planner show p.json',
      'issuecrew-planner publish p.json --approve-hash abc',
      'ls -la',
      'grep -rn foo .',
      'cat a.txt | head -5',
      'git clone --depth 1 https://example.com/r.git .issuecrew-planner/repos/r',
      'git -C repos/one log --oneline',
    ]
    for (const command of commands) {
      expect(guard(command, FRESH), command).toBe('allow')
    }
  })

  it('denies non-allowlisted forms while active', () => {
    const commands = [
      'issuecrew-planner approve p.json --hash h',
      'issuecrew-planner publish p.json',
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

  it('allows session start and end while active', () => {
    expect(guard('issuecrew-planner session start', FRESH)).toBe('allow')
    expect(guard('issuecrew-planner session end', FRESH)).toBe('allow')
    expect(
      guard('issuecrew-planner session start --config fixtures/synthetic-shop/config.with-catalog.json', FRESH),
    ).toBe('allow')
    expect(guard('issuecrew-planner session restart', FRESH)).toBe('deny')
  })

  it('allows save with a quoted heredoc', () => {
    expect(guard(SAVE, FRESH)).toBe('allow')
    expect(guard(SAVE, null)).toBe('allow')
    expect(guard(SAVE + '\n', FRESH)).toBe('allow')
  })

  it('allows save --file while active and denies chained commands', () => {
    expect(guard('issuecrew-planner save --file .issuecrew-planner/draft.json', FRESH)).toBe('allow')
    expect(guard('issuecrew-planner save --file x ; gh issue create', FRESH)).toBe('deny')
  })

  it('denies heredoc forms that can run other commands while active', () => {
    const commands = [
      'issuecrew-planner save <<ISSUECREW_PLAN_EOF\n{"a": "$(rm -rf x)"}\nISSUECREW_PLAN_EOF',
      "issuecrew-planner save <<'E'\n{}\nE\nrm -rf x",
      "issuecrew-planner save <<'E'\n{}\nE\nrm -rf x\nE",
      "issuecrew-planner save <<'E' && rm -rf x\n{}\nE",
      "rm -rf x; issuecrew-planner save <<'E'\n{}\nE",
      "cat <<'E' > out.txt\nx\nE",
    ]
    for (const command of commands) {
      expect(guard(command, FRESH), command).toBe('deny')
    }
  })

  it('denies the token variable inside a heredoc body', () => {
    expect(guard('issuecrew-planner save <<\'E\'\n{"a": "$ISSUECREW_PLANNER_GITHUB_TOKEN"}\nE', null)).toBe('deny')
    expect(guard('issuecrew-planner save <<\'E\'\n{"a": "$ISSUECREW_PLANNER_GITHUB_TOKEN"}\nE', FRESH)).toBe('deny')
  })

  it('still denies date and compound commands while active', () => {
    expect(guard('date -u +%Y-%m-%dT%H:%M:%SZ', FRESH)).toBe('deny')
    expect(guard('issuecrew-planner catalog; echo "exit=$?"', FRESH)).toBe('deny')
  })
})
