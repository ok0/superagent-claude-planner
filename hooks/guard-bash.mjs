import { readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const WRAPPERS = new Set(['sudo', 'env', 'command', 'exec', 'nohup', 'time', 'xargs'])
const READ_ONLY = new Set(['ls', 'cat', 'head', 'tail', 'wc', 'rg', 'grep', 'pwd'])
const PLANNER_SUBCOMMANDS = new Set(['validate', 'show', 'state', 'schema', 'catalog', '--help', '-h'])
const FIND_FORBIDDEN = ['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprintf', '-fls']
const GIT_READ = new Set(['log', 'show', 'ls-files', 'grep', 'status', 'diff', 'rev-parse'])
const SESSION_MAX_AGE_MS = 4 * 3600 * 1000
const SESSION_SUFFIX =
  'while the plan session is active (.issuecrew-planner/.session-active); finish or abort the session to lift this'

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

function tokenNames(projectDir) {
  const names = ['ISSUECREW_PLANNER_GITHUB_TOKEN']
  const candidates = []
  if (process.env.ISSUECREW_PLANNER_CONFIG) candidates.push(resolve(projectDir, process.env.ISSUECREW_PLANNER_CONFIG))
  candidates.push(join(projectDir, 'issuecrew-planner.config.json'))
  if (process.env.HOME) candidates.push(join(process.env.HOME, '.config', 'issuecrew-planner', 'config.json'))
  for (const path of candidates) {
    const data = readJson(path)
    if (data === undefined) continue
    const name = data?.github?.tokenEnv
    if (typeof name === 'string' && name.length > 0) names.push(name)
    break
  }
  return names
}

function segmentsOf(command) {
  return command
    .split(/\|\||&&|[;|&\n]|\$\(|`|[()]/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
}

function startsSubstitution(command, i) {
  const c = command[i]
  if (c === '`') return true
  if (c !== '$') return false
  const next = command[i + 1]
  return next === '(' || (next === '{' && /^[ \t\n|]$/.test(command[i + 2] ?? ''))
}

// Splits on unquoted, unescaped operators. Returns [{ text, bare }] where bare has every quoted or escaped
// character (and the quote/backslash characters) replaced by '_', or null when the naive fallback must be used.
function lexSegments(command) {
  let state = 'U'
  let bare = ''
  const cuts = []
  let i = 0
  while (i < command.length) {
    const c = command[i]
    if (state === 'S') {
      bare += '_'
      if (c === "'") state = 'U'
      i++
      continue
    }
    if (startsSubstitution(command, i)) return null
    if (c === '\\') {
      if (startsSubstitution(command, i + 1)) return null
      const len = Math.min(2, command.length - i)
      bare += '_'.repeat(len)
      i += len
      continue
    }
    if (state === 'D') {
      bare += '_'
      if (c === '"') state = 'U'
      i++
      continue
    }
    if (c === "'" || c === '"') {
      state = c === "'" ? 'S' : 'D'
      bare += '_'
      i++
      continue
    }
    const two = command.slice(i, i + 2)
    if (two === "$'" || two === '<<' || c === '#') return null
    if (two === '||' || two === '&&') {
      cuts.push([i, i + 2])
      bare += two
      i += 2
      continue
    }
    if (';|&\n()'.includes(c)) cuts.push([i, i + 1])
    bare += c
    i++
  }
  if (state !== 'U') return null
  const segments = []
  let start = 0
  for (const [from, to] of [...cuts, [command.length, command.length]]) {
    const text = command.slice(start, from).trim()
    if (text.length > 0) segments.push({ text, bare: command.length === bare.length ? bare.slice(start, from) : text })
    start = to
  }
  return segments
}

function commandTokens(segment) {
  const tokens = segment
    .split(/\s+/)
    .filter(t => t.length > 0)
    .map(t => t.replace(/^['"]+|['"]+$/g, ''))
  let i = 0
  while (i < tokens.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]) || WRAPPERS.has(tokens[i]))) i++
  return tokens.slice(i)
}

function commandWord(segment) {
  const tokens = commandTokens(segment)
  return tokens.length > 0 ? basename(tokens[0]) : ''
}

function stripSaveHeredoc(command) {
  const lines = command.split('\n')
  const m = /^(.*?)<<'([A-Za-z_][A-Za-z0-9_]*)'[ \t]*$/.exec(lines[0])
  if (!m) return command
  const head = m[1]
  const tokens = commandTokens(head)
  if (basename(tokens[0] ?? '') !== 'issuecrew-planner' || tokens[1] !== 'save') return command
  if (/[;|&<>()`]/.test(head)) return command
  const end = lines.findIndex((l, i) => i > 0 && l === m[2])
  if (end < 0) return command
  if (lines.slice(end + 1).some(l => l.trim() !== '')) return command
  return head
}

function alwaysDeny(command, segments, names) {
  for (const seg of segments) {
    if (commandWord(seg.text) === 'gh') {
      return 'GitHub CLI is not allowed; issues are created only by issuecrew-planner publish after approval'
    }
  }
  if (/\b(curl|wget)\b/.test(command) && /(api|uploads)\.github\.com/i.test(command)) {
    return 'direct GitHub API calls are not allowed'
  }
  for (const name of names) {
    if (command.includes(name)) return `commands must not reference the planner token variable ${name}`
  }
  return null
}

function sessionActive(markerPath) {
  let text
  try {
    text = readFileSync(markerPath, 'utf8').trim()
  } catch {
    return false
  }
  const match = /^active\s+(\S+)/.exec(text)
  if (!match) return false
  const started = Date.parse(match[1])
  if (!Number.isFinite(started)) return false
  const age = Date.now() - started
  return age >= 0 && age < SESSION_MAX_AGE_MS
}

function gitAllowed(tokens) {
  if (tokens[1] === 'clone') {
    const i = tokens.indexOf('--depth')
    return tokens.includes('--depth=1') || (i >= 0 && tokens[i + 1] === '1')
  }
  const rest = tokens[1] === '-C' ? tokens.slice(3) : tokens.slice(1)
  return GIT_READ.has(rest[0])
}

function segmentAllowed(seg) {
  const cleaned = seg.bare.replace(/\d?>&\d/g, '').replace(/\d?>\s*\/dev\/null/g, '')
  if (cleaned.includes('>')) return false
  const tokens = commandTokens(seg.text)
  if (tokens.length === 0) return false
  const word = basename(tokens[0])
  if (word === 'issuecrew-planner') {
    return (
      PLANNER_SUBCOMMANDS.has(tokens[1]) ||
      tokens[1] === 'save' ||
      (tokens[1] === 'session' && (tokens[2] === 'start' || tokens[2] === 'end')) ||
      (tokens[1] === 'publish' && tokens.includes('--approve-hash'))
    )
  }
  if (READ_ONLY.has(word)) return true
  if (word === 'find') return !tokens.some(t => FIND_FORBIDDEN.includes(t))
  if (word === 'git') return gitAllowed(tokens)
  return false
}

function decide(input) {
  if (input?.tool_name !== 'Bash') return null
  const command = input.tool_input?.command
  if (typeof command !== 'string') return null
  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()
  const checked = stripSaveHeredoc(command)
  const lexed = lexSegments(checked)
  const segments = lexed ?? segmentsOf(checked).map(text => ({ text, bare: text }))
  const substitution = lexed === null && (checked.includes('$(') || checked.includes('`'))
  const denied = alwaysDeny(command, segments, tokenNames(projectDir))
  if (denied !== null) return denied
  if (!sessionActive(join(projectDir, '.issuecrew-planner', '.session-active'))) return null
  if (substitution) {
    return `command substitution is not allowed ${SESSION_SUFFIX}`
  }
  for (const seg of segments) {
    if (!segmentAllowed(seg)) return `${commandWord(seg.text)} is not allowed ${SESSION_SUFFIX}`
  }
  return null
}

let raw = ''
for await (const chunk of process.stdin) raw += chunk

let input
try {
  input = JSON.parse(raw)
} catch {
  input = undefined
}

const reason = input === undefined ? null : decide(input)
if (reason !== null) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'issuecrew-planner guard: ' + reason,
      },
    }) + '\n',
  )
}
