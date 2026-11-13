import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const CONVENTIONAL_SUBJECT =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9][a-z0-9._/-]*\))?!?: \S.*$/
export const ATTRIBUTION_PATTERNS: RegExp[] = [
  /^\s*co-authored-by:.*\b(claude|anthropic|openai|chatgpt|gpt-?\d|copilot|gemini|codex|cursor|devin|aider)\b/i,
  /noreply@anthropic\.com/i,
  /generated (with|by)\b.*\b(claude|ai|llm|gpt|chatgpt|copilot|codex|gemini)\b/i,
  /\u{1F916}/u,
]
export const MILESTONE_PATTERNS: RegExp[] = [/\b[mM]\d{1,3}\b/, /\bmilestone[\s-]*#?\d+\b/i]

export function checkMessage(message: string): string[] {
  const lines = message
    .split(/\r?\n/)
    .filter(line => !line.startsWith('#'))
    .map(line => line.trimEnd())
  const subject = lines.find(line => line.trim().length > 0)
  if (subject === undefined) return ['empty commit message']
  const reasons: string[] = []
  if (!CONVENTIONAL_SUBJECT.test(subject)) reasons.push(`subject is not a Conventional Commit: "${subject}"`)
  if (subject.length > 100) reasons.push('subject longer than 100 characters')
  for (const line of lines) {
    if (ATTRIBUTION_PATTERNS.some(pattern => pattern.test(line))) reasons.push(`AI attribution line: "${line}"`)
  }
  const text = lines.join('\n')
  for (const pattern of MILESTONE_PATTERNS) {
    const match = pattern.exec(text)
    if (match !== null) reasons.push(`milestone ID in message: "${match[0]}"`)
  }
  return reasons
}

export function runCheckCommits(opts: {
  root: string
  argv: readonly string[]
  out: (s: string) => void
  err: (s: string) => void
}): number {
  const fileIndex = opts.argv.indexOf('--message-file')
  if (fileIndex !== -1) {
    const file = resolve(opts.argv[fileIndex + 1] ?? '')
    const reasons = checkMessage(readFileSync(file, 'utf8'))
    for (const reason of reasons) opts.err(`check-commits: ${reason}\n`)
    if (reasons.length > 0) return 1
    opts.out('check-commits: OK\n')
    return 0
  }

  const positionals = opts.argv.filter((arg, i) => !arg.startsWith('--') && i !== fileIndex + 1)
  const range = positionals[0] ?? 'HEAD'
  try {
    execFileSync('git', ['rev-parse', '--verify', '-q', 'HEAD'], { cwd: opts.root, stdio: 'ignore' })
  } catch {
    opts.out('check-commits: no commits\n')
    return 0
  }

  const log = execFileSync('git', ['log', '--no-merges', '--format=%H%x1f%B%x1e', range], {
    cwd: opts.root,
    encoding: 'utf8',
  })
  const records = log
    .split('\x1e')
    .map(record => record.trimStart())
    .filter(record => record.length > 0)
  let failed = false
  for (const record of records) {
    const separator = record.indexOf('\x1f')
    const sha = record.slice(0, separator).slice(0, 7)
    for (const reason of checkMessage(record.slice(separator + 1))) {
      opts.err(`check-commits: ${sha}: ${reason}\n`)
      failed = true
    }
  }
  if (failed) return 1
  opts.out(`check-commits: OK (${records.length} commits)\n`)
  return 0
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runCheckCommits({
    root: fileURLToPath(new URL('..', import.meta.url)),
    argv: process.argv.slice(2),
    out: s => process.stdout.write(s),
    err: s => process.stderr.write(s),
  })
}
