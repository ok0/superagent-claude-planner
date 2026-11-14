import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const NAMES_ENV = 'ISSUECREW_PLANNER_FORBIDDEN_NAMES'
export const NAMES_FILE = '.forbidden-names'
export const ALLOW_FILE = '.hygiene-allow'

export function importSpecifiers(source: string): string[] {
  const pattern =
    /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g
  return [...source.matchAll(pattern)].map(m => m[1] ?? m[2] ?? m[3] ?? '')
}

function listFiles(dir: string, filter: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return listFiles(full, filter)
    return filter(entry.name) ? [full] : []
  })
}

export function checkCoreImports(srcDir: string): string[] {
  const cliDir = join(srcDir, 'cli') + sep
  const adaptersDir = join(srcDir, 'adapters') + sep
  const violations: string[] = []
  for (const file of listFiles(join(srcDir, 'core'), name => name.endsWith('.ts'))) {
    for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
      if (spec.startsWith('.')) {
        const resolved = resolve(dirname(file), spec)
        if (resolved.startsWith(cliDir) || resolved.startsWith(adaptersDir)) {
          violations.push(`${file}: ${spec}`)
        }
      } else if (spec !== 'zod' && !spec.startsWith('node:')) {
        violations.push(`${file}: ${spec}`)
      }
    }
  }
  return violations
}

export function loadForbiddenNames(opts: {
  env: Readonly<Record<string, string | undefined>>
  root: string
}): { names: string[]; source: string } | null {
  const fromEnv = (opts.env[NAMES_ENV] ?? '')
    .split(',')
    .map(name => name.trim().toLowerCase())
    .filter(name => name.length > 0)
  if (fromEnv.length > 0) return { names: fromEnv, source: 'env ISSUECREW_PLANNER_FORBIDDEN_NAMES' }

  const file = join(opts.root, NAMES_FILE)
  if (!existsSync(file)) return null
  const fromFile = readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'))
    .map(line => line.toLowerCase())
  if (fromFile.length > 0) return { names: fromFile, source: 'file .forbidden-names' }
  return null
}

export function loadAllowedNames(root: string): string[] {
  const file = join(root, ALLOW_FILE)
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'))
    .map(line => line.toLowerCase())
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function stripAllowed(lower: string, allowed: readonly string[]): string {
  const entries = [...allowed].sort((a, b) => b.length - a.length)
  let result = lower
  for (const entry of entries) {
    result = result.replace(new RegExp(escapeRegExp(entry) + '(?![a-z0-9_-])', 'g'), '')
  }
  return result
}

export function listRepoFiles(root: string): string[] {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
  }).toString('utf8')
  return out
    .split('\0')
    .filter(entry => entry.length > 0)
    .map(entry => join(root, entry))
    .filter(path => existsSync(path) && statSync(path).isFile())
}

export const REPO_META_FIELDS = ['repository', 'homepage', 'bugs'] as const

export function stripRepoMeta(text: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return text
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return text
  const obj = parsed as Record<string, unknown>
  for (const field of REPO_META_FIELDS) delete obj[field]
  return JSON.stringify(obj)
}

export function scanForbiddenNames(
  files: readonly string[],
  names: readonly string[],
  opts: { packageJson?: string; allowed?: readonly string[] } = {},
): string[] {
  const violations: string[] = []
  for (const file of files) {
    if (basename(file) === NAMES_FILE) continue
    const text = readFileSync(file, 'utf8')
    const isRootPackageJson = opts.packageJson !== undefined && resolve(file) === resolve(opts.packageJson)
    const lower = stripAllowed((isRootPackageJson ? stripRepoMeta(text) : text).toLowerCase(), opts.allowed ?? [])
    names.forEach((name, index) => {
      if (lower.includes(name)) violations.push(`${file}: forbidden name #${index + 1}`)
    })
  }
  return violations
}

export function runHygiene(opts: {
  root: string
  env: Readonly<Record<string, string | undefined>>
  files?: readonly string[]
  out: (s: string) => void
  err: (s: string) => void
}): number {
  const violations = checkCoreImports(join(opts.root, 'src'))
  const loaded = loadForbiddenNames({ env: opts.env, root: opts.root })
  if (loaded === null) {
    opts.out(
      'hygiene: forbidden-name check skipped: set ISSUECREW_PLANNER_FORBIDDEN_NAMES or create .forbidden-names (gitignored)\n',
    )
  } else {
    const files = opts.files ?? listRepoFiles(opts.root)
    opts.out(`hygiene: checked ${loaded.names.length} names from ${loaded.source} in ${files.length} files\n`)
    violations.push(
      ...scanForbiddenNames(files, loaded.names, {
        packageJson: join(opts.root, 'package.json'),
        allowed: loadAllowedNames(opts.root),
      }),
    )
  }
  for (const v of violations) opts.err('hygiene: ' + v + '\n')
  if (violations.length > 0) return 1
  opts.out('hygiene: OK\n')
  return 0
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runHygiene({
    root: fileURLToPath(new URL('..', import.meta.url)),
    env: process.env,
    out: s => process.stdout.write(s),
    err: s => process.stderr.write(s),
  })
}
