import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { isAbsolute, relative, resolve } from 'node:path'
import { createSuperagentClaudeProfile, SUPERAGENT_CLAUDE_KIND } from '../adapters/agent/superagent-claude.ts'
import { createOctokitIssueHost } from '../adapters/github/octokit.ts'
import { getAgentProfile } from '../core/agent.ts'
import type { AgentProfile, AgentRegistry } from '../core/agent.ts'
import { approvalErrorFor, checkApproval, recordApproval } from '../core/approval.ts'
import { findConfigFile, loadConfig, resolveToken } from '../core/config.ts'
import type { Config } from '../core/config.ts'
import { loadCatalog } from '../core/catalog.ts'
import type { Catalog } from '../core/catalog.ts'
import { ApprovalError, ConfigError, GitHubError, IdentityError, PublishError, StateError } from '../core/errors.ts'
import type { IssueHost } from '../core/github/port.ts'
import { planHash } from '../core/hash.ts'
import { planJsonSchema } from '../core/plan/schema.ts'
import { readPlanFile, validatePlan } from '../core/plan/validate.ts'
import { publish } from '../core/publish.ts'
import { renderAll } from '../core/render/render.ts'
import type { RenderedIssue } from '../core/render/render.ts'
import { projectRoot, planStoragePath, writeSessionMarker } from '../core/session.ts'
import { loadState } from '../core/state.ts'
import type { State } from '../core/state.ts'
import { writeJsonAtomic } from '../core/fsutil.ts'

export interface CliIo {
  out(s: string): void
  err(s: string): void
  cwd: string
  env: Readonly<Record<string, string | undefined>>
  readStdin?: () => Promise<string>
}

export const EXIT_OK = 0,
  EXIT_INVALID = 1,
  EXIT_USAGE = 2,
  EXIT_GITHUB = 3

export type HostFactory = (opts: { token: string; baseUrl?: string }) => IssueHost

export const DEFAULT_HOST_FACTORY: HostFactory = o => createOctokitIssueHost(o)

export const DEFAULT_AGENTS: AgentRegistry = { [SUPERAGENT_CLAUDE_KIND]: createSuperagentClaudeProfile }

export const USAGE = `Usage: sac-planner <command> [options]

Commands:
  validate <plan>                              Validate a plan file; prints OK <hash> or one "path: message" per line
  show <plan> [--json]                         Render every issue without contacting GitHub, then print the plan hash
  approve <plan> --hash <h>                    Record approval of the plan hash printed by show
  publish <plan> [--approve-hash <h>] [--dry-run]
                                               Publish one issue per repo to GitHub using the approved plan
  state <plan>                                 Print the publish state saved next to the plan
  schema                                       Print the plan JSON Schema
  catalog [--json]                             Print the configured repo catalog, or "no catalog configured"
  save [--file <path>]                         Read plan JSON from <path> (or stdin), validate it, write .sac-planner/<changesetId>/plan.json
  session start|end                            Mark the plan session active (current UTC time) or done

Options:
  --config <path>          Config file (else $SAC_PLANNER_CONFIG, ./sac-planner.config.json, ~/.config/sac-planner/config.json)
  --json                   JSON output for show and catalog
  --hash <h>               Plan hash to approve (approve)
  --approve-hash <h>       Record approval of this hash, then publish (publish)
  --dry-run                Render the issues without a token or host (publish)  -h, --help               Show this help

Exit codes: 0 ok, 1 invalid or refused, 2 usage or config error, 3 GitHub failure
`

function usage(io: CliIo): number {
  io.err(USAGE)
  return EXIT_USAGE
}

function printIssues(io: CliIo, issues: RenderedIssue[]): void {
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
}

function fail(io: CliIo, e: { message: string; hint: string }, code: number): number {
  io.err('sac-planner: ' + e.message + '\nhint: ' + e.hint + '\n')
  return code
}

export async function main(
  argv: readonly string[],
  io: CliIo,
  agents: AgentRegistry = DEFAULT_AGENTS,
  hostFactory: HostFactory = DEFAULT_HOST_FACTORY,
): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: [...argv],
      options: {
        json: { type: 'boolean' },
        config: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
        hash: { type: 'string' },
        'approve-hash': { type: 'string' },
        'dry-run': { type: 'boolean' },
        file: { type: 'string' },
      },
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
    printIssues(io, issues)
    io.out('Plan hash: ' + hash + '\n')
    return EXIT_OK
  }

  if (cmd === 'approve') {
    const planArg = positionals[1]
    const hash = values.hash
    if (positionals.length !== 2 || planArg === undefined || hash === undefined) return usage(io)
    const planPath = resolve(io.cwd, planArg)
    const result = await readPlanFile(planPath)
    if (!result.ok) {
      for (const e of result.errors) io.out(e.path + ': ' + e.message + '\n')
      return EXIT_INVALID
    }
    try {
      const approval = recordApproval(planPath, result.plan, hash)
      io.out('approved ' + approval.changesetId + ' ' + approval.planHash + '\n')
      return EXIT_OK
    } catch (e) {
      if (!(e instanceof ApprovalError)) throw e
      return fail(io, e, EXIT_INVALID)
    }
  }

  if (cmd === 'publish') {
    const planArg = positionals[1]
    const approveHash = values['approve-hash']
    const dryRun = values['dry-run'] === true
    if (positionals.length !== 2 || planArg === undefined) return usage(io)
    if (dryRun && approveHash !== undefined) {
      io.err('sac-planner: --dry-run cannot be combined with --approve-hash\n')
      return EXIT_USAGE
    }
    let config: Config
    let agent: AgentProfile
    try {
      config = loadConfig({ path: values.config, env: io.env, cwd: io.cwd })
      agent = getAgentProfile(config.agent, agents)
    } catch (e) {
      if (!(e instanceof ConfigError)) throw e
      return fail(io, e, EXIT_USAGE)
    }
    const planPath = resolve(io.cwd, planArg)
    const result = await readPlanFile(planPath)
    if (!result.ok) {
      for (const e of result.errors) io.out(e.path + ': ' + e.message + '\n')
      return EXIT_INVALID
    }
    const plan = result.plan

    if (dryRun) {
      const r = await publish({ planPath, plan, agent, dryRun: true })
      printIssues(io, r.rendered)
      io.out('Plan hash: ' + planHash(plan) + '\n')
      io.out('dry run: no issues created\n')
      return EXIT_OK
    }

    if (approveHash !== undefined) {
      try {
        recordApproval(planPath, plan, approveHash)
      } catch (e) {
        if (!(e instanceof ApprovalError)) throw e
        return fail(io, e, EXIT_INVALID)
      }
    }
    const check = checkApproval(planPath, plan)
    if (!check.ok) return fail(io, approvalErrorFor(check.reason, plan), EXIT_INVALID)

    let token: string
    try {
      token = resolveToken(config, io.env)
    } catch (e) {
      if (!(e instanceof ConfigError)) throw e
      return fail(io, e, EXIT_USAGE)
    }
    const host = hostFactory({ token, baseUrl: config.github.apiBaseUrl })

    try {
      const r = await publish({ planPath, plan, agent, host, onProgress: line => io.out(line + '\n') })
      io.out(
        `published ${plan.changesetId}: ${r.created.length} created, ${r.adopted.length} adopted, ${r.existing.length} existing, ${r.updated} updated\n`,
      )
      return EXIT_OK
    } catch (e) {
      if (e instanceof ApprovalError || e instanceof IdentityError || e instanceof StateError) {
        return fail(io, e, EXIT_INVALID)
      }
      if (e instanceof PublishError) return fail(io, e, EXIT_GITHUB)
      if (e instanceof GitHubError) {
        io.err('sac-planner: GitHub request failed: ' + e.message + '\nhint: re-run publish to resume\n')
        return EXIT_GITHUB
      }
      throw e
    }
  }

  if (cmd === 'state') {
    const planArg = positionals[1]
    if (positionals.length !== 2 || planArg === undefined) return usage(io)
    let st: State | null
    try {
      st = loadState(resolve(io.cwd, planArg))
    } catch (e) {
      if (!(e instanceof StateError)) throw e
      return fail(io, e, EXIT_INVALID)
    }
    if (st === null) {
      io.out(`no state for ${planArg}: nothing has been published yet\n`)
      return EXIT_OK
    }
    io.out(
      `changeset: ${st.changesetId}\nplan hash: ${st.planHash}\nlinks finalized: ${st.linksFinalized ? 'yes' : 'no'}\n`,
    )
    for (const entry of Object.values(st.issues)) {
      io.out(`${entry.repo}\t#${entry.number}\t${entry.url}\n`)
    }
    return EXIT_OK
  }

  if (cmd === 'schema') {
    if (positionals.length !== 1) return usage(io)
    io.out(JSON.stringify(planJsonSchema(), null, 2) + '\n')
    return EXIT_OK
  }

  if (cmd === 'catalog') {
    if (positionals.length !== 1) return usage(io)
    const file = findConfigFile({ path: values.config, env: io.env, cwd: io.cwd })
    if (file === undefined) {
      io.out('no catalog configured\n')
      return EXIT_OK
    }
    let config: Config
    let catalog: Catalog | null
    try {
      config = loadConfig({ path: values.config, env: io.env, cwd: io.cwd })
      catalog = loadCatalog(config)
    } catch (e) {
      if (!(e instanceof ConfigError)) throw e
      return fail(io, e, EXIT_USAGE)
    }
    if (catalog === null) {
      io.out('no catalog configured\n')
      return EXIT_OK
    }
    if (values.json) {
      io.out(JSON.stringify(catalog, null, 2) + '\n')
      return EXIT_OK
    }
    io.out(`catalog: ${config.catalog} (${catalog.repos.length} repos)\n`)
    for (const r of catalog.repos) {
      io.out(`${r.repo}\t${r.description}\n`)
      if (r.localPath !== undefined) io.out(`  localPath: ${r.localPath}\n`)
      if (r.contracts !== undefined && r.contracts.length > 0) io.out(`  contracts: ${r.contracts.join(', ')}\n`)
    }
    return EXIT_OK
  }

  if (cmd === 'save') {
    if (positionals.length !== 1) return usage(io)
    let text: string
    if (values.file !== undefined) {
      try {
        text = readFileSync(resolve(io.cwd, values.file), 'utf8')
      } catch {
        io.out('(root): cannot read ' + values.file + '\n')
        return EXIT_INVALID
      }
    } else {
      text = io.readStdin ? await io.readStdin() : ''
    }
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      io.out('(root): invalid JSON: ' + msg + '\n')
      return EXIT_INVALID
    }
    const result = validatePlan(json)
    if (!result.ok) {
      for (const e of result.errors) io.out(e.path + ': ' + e.message + '\n')
      return EXIT_INVALID
    }
    const path = planStoragePath(projectRoot(io.env, io.cwd), result.plan.changesetId)
    writeJsonAtomic(path, result.plan)
    const rel = relative(io.cwd, path)
    const display = rel.startsWith('..') || isAbsolute(rel) ? path : rel
    io.out('saved ' + display + '\nOK ' + planHash(result.plan) + '\n')
    return EXIT_OK
  }

  if (cmd === 'session') {
    const action = positionals[1]
    if (positionals.length !== 2 || (action !== 'start' && action !== 'end')) return usage(io)
    const content = writeSessionMarker(projectRoot(io.env, io.cwd), action)
    io.out(action === 'start' ? 'session ' + content + '\n' : 'session done\n')
    return EXIT_OK
  }

  io.err('sac-planner: unknown command ' + cmd + '\n' + USAGE)
  return EXIT_USAGE
}
