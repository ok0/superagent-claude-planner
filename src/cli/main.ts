import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { createSuperagentClaudeProfile, SUPERAGENT_CLAUDE_KIND } from '../adapters/agent/superagent-claude.ts'
import { getAgentProfile } from '../core/agent.ts'
import type { AgentProfile, AgentRegistry } from '../core/agent.ts'
import { loadConfig } from '../core/config.ts'
import { ConfigError } from '../core/errors.ts'
import { planHash } from '../core/hash.ts'
import { planJsonSchema } from '../core/plan/schema.ts'
import { readPlanFile } from '../core/plan/validate.ts'
import { renderAll } from '../core/render/render.ts'

export interface CliIo {
  out(s: string): void
  err(s: string): void
  cwd: string
  env: Readonly<Record<string, string | undefined>>
}

export const EXIT_OK = 0,
  EXIT_INVALID = 1,
  EXIT_USAGE = 2

export const DEFAULT_AGENTS: AgentRegistry = { [SUPERAGENT_CLAUDE_KIND]: createSuperagentClaudeProfile }

export const USAGE = `Usage: sac-planner <command> [options]

Commands:
  validate <plan>          Validate a plan file; prints OK <hash> or one "path: message" per line
  show <plan> [--json]     Render every issue without contacting GitHub, then print the plan hash
  schema                   Print the plan JSON Schema

Options:
  --config <path>          Config file (else $SAC_PLANNER_CONFIG, ./sac-planner.config.json, ~/.config/sac-planner/config.json)
  --json                   JSON output for show
  -h, --help               Show this help

Exit codes: 0 ok, 1 invalid plan, 2 usage or config error
`

function usage(io: CliIo): number {
  io.err(USAGE)
  return EXIT_USAGE
}

export async function main(
  argv: readonly string[],
  io: CliIo,
  agents: AgentRegistry = DEFAULT_AGENTS,
): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: [...argv],
      options: { json: { type: 'boolean' }, config: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
      allowPositionals: true,
      strict: true,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    io.err('sac-planner: ' + msg + '\n' + USAGE)
    return EXIT_USAGE
  }
  const { values, positionals } = parsed
  if (values.help) {
    io.out(USAGE)
    return EXIT_OK
  }
  const cmd = positionals[0]
  if (cmd === undefined) return usage(io)

  if (cmd === 'validate') {
    const planArg = positionals[1]
    if (positionals.length !== 2 || planArg === undefined) return usage(io)
    const result = await readPlanFile(resolve(io.cwd, planArg))
    if (!result.ok) {
      for (const e of result.errors) io.out(e.path + ': ' + e.message + '\n')
      return EXIT_INVALID
    }
    io.out('OK ' + planHash(result.plan) + '\n')
    return EXIT_OK
  }

  if (cmd === 'show') {
    const planArg = positionals[1]
    if (positionals.length !== 2 || planArg === undefined) return usage(io)
    let agent: AgentProfile
    try {
      const config = loadConfig({ path: values.config, env: io.env, cwd: io.cwd })
      agent = getAgentProfile(config.agent, agents)
    } catch (e) {
      if (!(e instanceof ConfigError)) throw e
      io.err('sac-planner: ' + e.message + '\nhint: ' + e.hint + '\n')
      return EXIT_USAGE
    }
    const result = await readPlanFile(resolve(io.cwd, planArg))
    if (!result.ok) {
      for (const e of result.errors) io.out(e.path + ': ' + e.message + '\n')
      return EXIT_INVALID
    }
    const plan = result.plan
    const issues = renderAll(plan, { agent, links: {} })
    const hash = planHash(plan)
    if (values.json) {
      io.out(JSON.stringify({ planHash: hash, issues }, null, 2) + '\n')
      return EXIT_OK
    }
    for (const [i, issue] of issues.entries()) {
      io.out(
        '=== Issue ' +
          (i + 1) +
          '/' +
          issues.length +
          ': ' +
          issue.repo +
          ' ===\nTitle: ' +
          issue.title +
          '\n\n' +
          issue.body +
          '\n',
      )
    }
    io.out('Plan hash: ' + hash + '\n')
    return EXIT_OK
  }

  if (cmd === 'schema') {
    if (positionals.length !== 1) return usage(io)
    io.out(JSON.stringify(planJsonSchema(), null, 2) + '\n')
    return EXIT_OK
  }

  io.err('sac-planner: unknown command ' + cmd + '\n' + USAGE)
  return EXIT_USAGE
}
