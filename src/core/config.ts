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
  'copy sac-planner.config.example.json to ./sac-planner.config.json (or ~/.config/sac-planner/config.json) and set agent.login to the GitHub login of the agent account'
export const LOGIN_HINT =
  'set agent.login in the config to the GitHub login of the agent account to mention in issues; there is no default'

export function loadConfig(opts: {
  path?: string
  env: Readonly<Record<string, string | undefined>>
  cwd: string
}): Config {
  const cwdFile = resolve(opts.cwd, 'sac-planner.config.json')
  const homeFile = join(opts.env.HOME ?? homedir(), '.config', 'sac-planner', 'config.json')
  let file: string | undefined
  if (opts.path) {
    file = resolve(opts.cwd, opts.path)
  } else if (opts.env.SAC_PLANNER_CONFIG) {
    file = resolve(opts.cwd, opts.env.SAC_PLANNER_CONFIG)
  } else {
    file = [cwdFile, homeFile].find(f => existsSync(f))
  }
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
