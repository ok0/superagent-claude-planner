import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const STRIPPED_ENVS = [
  'PLANNER_GITHUB_TOKEN',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'NPM_TOKEN',
  'NODE_AUTH_TOKEN',
  'SAC_PLANNER_CONFIG',
]

export function smokeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const copy: NodeJS.ProcessEnv = { ...env }
  for (const name of STRIPPED_ENVS) delete copy[name]
  return copy
}

export function runSmokePack(opts: { root: string; out: (s: string) => void; err: (s: string) => void }): number {
  const tmp = mkdtempSync(join(tmpdir(), 'sacp-smoke-'))
  const env = smokeEnv(process.env)
  const proj = join(tmp, 'proj')
  const bin = join(proj, 'node_modules', '.bin', 'sac-planner')

  const run = (cmd: string, args: string[], cwd: string): SpawnSyncReturns<string> =>
    spawnSync(cmd, args, { cwd, env, encoding: 'utf8' })

  const fail = (step: string, status: number | null, detail: string): number => {
    opts.err(`smoke-pack: ${step} failed: ${status} ${detail}\n`)
    return 1
  }

  const detailOf = (r: SpawnSyncReturns<string>): string => r.stderr || (r.error ? String(r.error) : '')

  try {
    const pack = run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', tmp], opts.root)
    if (pack.status !== 0) return fail('pack', pack.status, detailOf(pack))
    const tgz = join(tmp, JSON.parse(pack.stdout)[0].filename)
    opts.out('smoke-pack: pack ok\n')

    mkdirSync(proj, { recursive: true })
    writeFileSync(join(proj, 'package.json'), '{"name":"sacp-smoke","version":"0.0.0","private":true,"type":"module"}')
    const install = run('npm', ['install', '--no-audit', '--no-fund', '--no-package-lock', tgz], proj)
    if (install.status !== 0) return fail('install', install.status, detailOf(install))
    opts.out('smoke-pack: install ok\n')

    const help = run(bin, ['--help'], proj)
    if (help.status !== 0) return fail('help', help.status, detailOf(help))
    if (!help.stdout.includes('Usage: sac-planner')) return fail('help', help.status, 'usage text missing')
    opts.out('smoke-pack: help ok\n')

    copyFileSync(join(opts.root, 'examples', 'plan.json'), join(proj, 'plan.json'))
    const validate = run(bin, ['validate', 'plan.json'], proj)
    if (validate.status !== 0) return fail('validate', validate.status, detailOf(validate))
    if (!validate.stdout.startsWith('OK ')) return fail('validate', validate.status, 'output does not start with OK')
    opts.out('smoke-pack: validate ok\n')

    const importCode =
      "const m = await import('superagent-claude-planner'); if (typeof m.validatePlan !== 'function') { console.error('validatePlan missing'); process.exit(1) }"
    const imported = run(process.execPath, ['--input-type=module', '-e', importCode], proj)
    if (imported.status !== 0) return fail('import', imported.status, detailOf(imported))
    opts.out('smoke-pack: import ok\n')

    const dts = join(proj, 'node_modules', 'superagent-claude-planner', 'lib', 'index.d.ts')
    if (!existsSync(dts) || !readFileSync(dts, 'utf8').includes('validatePlan')) {
      return fail('types', null, 'lib/index.d.ts missing or has no validatePlan')
    }
    opts.out('smoke-pack: types ok\n')

    opts.out('smoke-pack: OK\n')
    return 0
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runSmokePack({
    root: fileURLToPath(new URL('..', import.meta.url)),
    out: s => process.stdout.write(s),
    err: s => process.stderr.write(s),
  })
}
