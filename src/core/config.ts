import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import { ConfigError } from './errors.ts'

export const DEFAULT_TOKEN_ENV = 'PLANNER_GITHUB_TOKEN'

export const ConfigSchema = z.object({
  agent: z.object({ kind: z.string().min(1).default('superagent-claude'), login: z.string().min(1) }),
  github: z
    .object({
      tokenEnv: z
        .string()
        .regex(/^[A-Za-z_][A-Za-z0-9_]*$/)
        .default(DEFAULT_TOKEN_ENV),
      apiBaseUrl: z.url().optional(),
    })
    .default({ tokenEnv: DEFAULT_TOKEN_ENV }),
  catalog: z.string().min(1).optional(),
})

export type Config = z.infer<typeof ConfigSchema>

export const SETUP_HINT =
  'create ./sac-planner.config.json (or ~/.config/sac-planner/config.json) and set agent.login to the GitHub login of the agent account; see docs/setup.md (Config file) in the superagent-claude-planner repository'
export const LOGIN_HINT =
  'set agent.login in the config to the GitHub login of the agent account to mention in issues; there is no default; see docs/setup.md'
export const TOKEN_HINT =
  'set it to a GitHub token of the planner account: a User-type account that differs from agent.login and is in the agent allowed author list; see docs/setup.md'

export function findConfigFile(opts: {
  path?: string
  env: Readonly<Record<string, string | undefined>>
  cwd: string
}): string | undefined {
  const cwdFile = resolve(opts.cwd, 'sac-planner.config.json')
  const homeFile = join(opts.env.HOME ?? homedir(), '.config', 'sac-planner', 'config.json')
  if (opts.path) {
    return resolve(opts.cwd, opts.path)
  }
  if (opts.env.SAC_PLANNER_CONFIG) {
    return resolve(opts.cwd, opts.env.SAC_PLANNER_CONFIG)
  }
  return [cwdFile, homeFile].find(f => existsSync(f))
}

export function loadConfig(opts: {
  path?: string
  env: Readonly<Record<string, string | undefined>>
  cwd: string
}): Config {
  const file = findConfigFile(opts)
  if (file === undefined) {
    throw new ConfigError(
      'no config found; looked for --config, $SAC_PLANNER_CONFIG, ./sac-planner.config.json, ~/.config/sac-planner/config.json',
      SETUP_HINT,
    )
  }
  if (!existsSync(file)) {
    throw new ConfigError(`config file not found: ${file}`, SETUP_HINT)
  }

  const text = readFileSync(file, 'utf8')
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    throw new ConfigError(`${file}: invalid JSON: ${e instanceof Error ? e.message : String(e)}`, SETUP_HINT)
  }

  const login = (raw as { agent?: { login?: unknown } } | null | undefined)?.agent?.login
  if (typeof login !== 'string' || login.length === 0) {
    throw new ConfigError(`${file}: agent.login is required`, LOGIN_HINT)
  }

  const result = ConfigSchema.safeParse(raw)
  if (!result.success) {
    throw new ConfigError(
      `${file}: ` + result.error.issues.map(i => i.path.join('.') + ': ' + i.message).join('; '),
      SETUP_HINT,
    )
  }

  const config = result.data
  if (config.catalog !== undefined) {
    return { ...config, catalog: resolve(dirname(file), config.catalog) }
  }
  return config
}

export function resolveToken(config: Config, env: Readonly<Record<string, string | undefined>>): string {
  const value = (env[config.github.tokenEnv] ?? '').trim()
  if (value.length === 0) {
    throw new ConfigError(`environment variable ${config.github.tokenEnv} is not set (github.tokenEnv)`, TOKEN_HINT)
  }
  return value
}
