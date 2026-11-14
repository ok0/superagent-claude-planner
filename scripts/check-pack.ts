import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadAllowedNames, loadForbiddenNames, scanForbiddenNames } from './check-hygiene.ts'

export const REQUIRED_PACK_FILES = [
  'package.json',
  'README.md',
  'LICENSE',
  'lib/cli.js',
  'lib/index.js',
  'lib/index.d.ts',
]
export const DENIED_SEGMENTS = [
  'src',
  'tests',
  'fixtures',
  'scripts',
  'examples',
  'skills',
  'hooks',
  'docs',
  'coverage',
  'node_modules',
  '.claude-plugin',
  '.github',
  '.ensemble',
  '.issuecrew-planner',
  '.r',
  '.doc',
]
export const STATE_FILES = ['plan.json', 'state.json', 'approval.json', 'draft.json', '.session-active']
export const TOKEN_ENVS = ['ISSUECREW_PLANNER_GITHUB_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN', 'NPM_TOKEN', 'NODE_AUTH_TOKEN']
export const TOKEN_PATTERNS = [/gh[pousr]_[A-Za-z0-9]{30,}/, /github_pat_[A-Za-z0-9_]{20,}/, /npm_[A-Za-z0-9]{30,}/]

export function deniedReason(path: string): string | null {
  const segments = path.split('/')
  const denied = segments.find(segment => DENIED_SEGMENTS.includes(segment))
  if (denied !== undefined) return `denied directory ${denied}/`
  const name = basename(path)
  if (name === '.forbidden-names') return 'forbidden-names file'
  if (name === '.env' || name.startsWith('.env.')) return 'env file'
  if (/\.(spec|test)\.[cm]?[jt]sx?$/.test(name)) return 'test file'
  if (/\.[cm]?ts$/.test(name) && !/\.d\.[cm]?ts$/.test(name)) return 'source file'
  if (name === 'issuecrew.json' || (/config\.json$/.test(name) && !name.includes('.example.'))) {
    return 'local config'
  }
  if (STATE_FILES.includes(name)) return 'plan/state/approval file'
  if (name.endsWith('.tgz')) return 'tarball'
  return null
}

export function checkPackList(files: readonly string[]): string[] {
  const violations: string[] = []
  for (const required of REQUIRED_PACK_FILES) {
    if (!files.includes(required)) violations.push(`missing required file ${required} (run pnpm build first)`)
  }
  for (const file of files) {
    const reason = deniedReason(file)
    if (reason !== null) violations.push(`${file}: ${reason}`)
  }
  return violations
}

export function scanTokens(
  files: readonly { rel: string; abs: string }[],
  env: Readonly<Record<string, string | undefined>>,
): string[] {
  const values = TOKEN_ENVS.flatMap(name => {
    const value = env[name]
    return value !== undefined && value.length >= 8 ? [{ name, value }] : []
  })
  const violations: string[] = []
  for (const file of files) {
    const text = readFileSync(file.abs, 'utf8')
    for (const { name, value } of values) {
      if (text.includes(value)) violations.push(`${file.rel}: value of $${name}`)
    }
    if (TOKEN_PATTERNS.some(pattern => pattern.test(text))) violations.push(`${file.rel}: token-like string`)
  }
  return violations
}

export type PackResult = { files: string[]; dir: string }
export type PackFn = (root: string, dest: string) => PackResult

type NpmPackEntry = { filename: string; files: { path: string }[] }

export function npmPack(root: string, dest: string): PackResult {
  const out = execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', dest], {
    cwd: root,
    encoding: 'utf8',
  })
  const entry = (JSON.parse(out) as NpmPackEntry[])[0]
  if (entry === undefined) throw new Error('npm pack produced no entry')
  const files = entry.files.map(f => f.path)
  const extractDir = join(dest, 'x')
  mkdirSync(extractDir)
  execFileSync('tar', ['-xzf', join(dest, entry.filename), '-C', extractDir])
  return { files, dir: join(extractDir, 'package') }
}

export function runCheckPack(opts: {
  root: string
  env: Readonly<Record<string, string | undefined>>
  out: (s: string) => void
  err: (s: string) => void
  pack?: PackFn
}): number {
  const dest = mkdtempSync(join(tmpdir(), 'issuecrew-pack-'))
  const violations: string[] = []
  try {
    const { files, dir } = (opts.pack ?? npmPack)(opts.root, dest)
    for (const file of [...files].sort()) opts.out(`check-pack: file ${file}\n`)
    opts.out(`check-pack: ${files.length} files\n`)
    violations.push(...checkPackList(files))
    const loaded = loadForbiddenNames({ env: opts.env, root: opts.root })
    if (loaded === null) {
      opts.out(
        'check-pack: forbidden-name check skipped: set ISSUECREW_PLANNER_FORBIDDEN_NAMES or create .forbidden-names (gitignored)\n',
      )
    } else {
      opts.out(`check-pack: checked ${loaded.names.length} names from ${loaded.source}\n`)
      const prefix = dir + sep
      const nameViolations = scanForbiddenNames(
        files.map(f => join(dir, f)),
        loaded.names,
        { packageJson: join(dir, 'package.json'), allowed: loadAllowedNames(opts.root) },
      )
      violations.push(...nameViolations.map(v => (v.startsWith(prefix) ? v.slice(prefix.length) : v)))
    }
    violations.push(
      ...scanTokens(
        files.map(f => ({ rel: f, abs: join(dir, f) })),
        opts.env,
      ),
    )
  } finally {
    rmSync(dest, { recursive: true, force: true })
  }
  for (const v of violations) opts.err(`check-pack: ${v}\n`)
  if (violations.length > 0) return 1
  opts.out('check-pack: OK\n')
  return 0
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runCheckPack({
    root: fileURLToPath(new URL('..', import.meta.url)),
    env: process.env,
    out: s => process.stdout.write(s),
    err: s => process.stderr.write(s),
  })
}
