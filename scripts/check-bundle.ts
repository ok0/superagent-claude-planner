import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { builtinModules } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { importSpecifiers } from './check-hygiene.ts'

const REQUIRE_PATTERN = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g

export function externalImports(libDir: string): string[] {
  const violations: string[] = []
  const files = readdirSync(libDir, { withFileTypes: true }).filter(e => e.isFile() && e.name.endsWith('.js'))
  for (const entry of files) {
    const text = readFileSync(join(libDir, entry.name), 'utf8')
    const specs = [...importSpecifiers(text), ...[...text.matchAll(REQUIRE_PATTERN)].map(m => m[1] ?? '')]
    for (const spec of specs) {
      if (spec.startsWith('.') || spec.startsWith('node:')) continue
      if (builtinModules.includes(spec)) continue
      violations.push(`${entry.name}: ${spec}`)
    }
  }
  return violations
}

export function runCheckBundle(opts: { root: string; out: (s: string) => void; err: (s: string) => void }): number {
  const libDir = join(opts.root, 'lib')
  if (!existsSync(join(libDir, 'cli.js'))) {
    opts.err('check-bundle: lib/cli.js not found; run pnpm build first\n')
    return 1
  }
  const violations = externalImports(libDir)
  if (violations.length > 0) {
    for (const v of violations) opts.err(`check-bundle: external import ${v}\n`)
    return 1
  }
  const tmp = mkdtempSync(join(tmpdir(), 'issuecrew-bundle-'))
  try {
    cpSync(libDir, join(tmp, 'lib'), { recursive: true })
    cpSync(join(opts.root, 'bin'), join(tmp, 'bin'), { recursive: true })
    chmodSync(join(tmp, 'bin', 'issuecrew-planner'), 0o755)
    const launcher = join(tmp, 'bin', 'issuecrew-planner')
    const env = { PATH: process.env.PATH, HOME: tmp }
    for (const args of [['schema'], ['catalog']]) {
      const result = spawnSync(launcher, args, { cwd: tmp, env, encoding: 'utf8' })
      const stdout = result.stdout ?? ''
      const ok =
        args[0] === 'schema'
          ? result.status === 0 && stdout.includes('"changesetId"')
          : result.status === 0 && stdout === 'no catalog configured\n'
      if (!ok) {
        opts.err(`check-bundle: smoke ${args.join(' ')} failed: ${result.status} ${result.stderr ?? ''}\n`)
        return 1
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  opts.out('check-bundle: OK\n')
  return 0
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runCheckBundle({
    root: fileURLToPath(new URL('..', import.meta.url)),
    out: s => process.stdout.write(s),
    err: s => process.stderr.write(s),
  })
}
