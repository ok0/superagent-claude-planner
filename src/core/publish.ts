import type { AgentProfile } from './agent.ts'
import { GitHubError, IdentityError, PublishError, StateError } from './errors.ts'
import { approvalErrorFor, checkApproval } from './approval.ts'
import { planHash, sha256Hex } from './hash.ts'
import type { IssueHost, IssueRef } from './github/port.ts'
import { publishOrder } from './plan/order.ts'
import type { Plan } from './plan/schema.ts'
import { renderAll, renderIssue } from './render/render.ts'
import type { RenderedIssue } from './render/render.ts'
import { loadState, saveState } from './state.ts'
import type { State } from './state.ts'

export type PublishOptions = {
  planPath: string
  plan: Plan
  agent: AgentProfile
  host?: IssueHost
  dryRun?: boolean
  onProgress?: (line: string) => void
}

export type PublishResult = {
  dryRun: boolean
  created: IssueRef[]
  adopted: IssueRef[]
  existing: IssueRef[]
  updated: number
  linksFinalized: boolean
  rendered: RenderedIssue[]
}

export const RESUME_HINT = 're-run publish to resume; progress is saved in state.json next to the plan'

export async function publish(opts: PublishOptions): Promise<PublishResult> {
  const { planPath, plan, agent, host, dryRun, onProgress } = opts
  const hash = planHash(plan)
  const refs = (state: State): Record<string, IssueRef> =>
    Object.fromEntries(
      Object.entries(state.issues).map(([repo, e]) => [repo, { repo: e.repo, number: e.number, url: e.url }]),
    )

  if (dryRun) {
    const st = loadState(planPath)
    const links = st && st.planHash === hash ? refs(st) : {}
    return {
      dryRun: true,
      created: [],
      adopted: [],
      existing: [],
      updated: 0,
      linksFinalized: st?.linksFinalized ?? false,
      rendered: renderAll(plan, { agent, links }),
    }
  }

  const check = checkApproval(planPath, plan)
  if (!check.ok) {
    throw approvalErrorFor(check.reason, plan)
  }

  if (host === undefined) {
    throw new Error('publish requires a host unless dryRun is set')
  }

  const call = async <T>(p: () => Promise<T>): Promise<T> => {
    try {
      return await p()
    } catch (e) {
      if (e instanceof GitHubError) {
        throw new PublishError(
          `GitHub request failed${e.status ? ' (' + e.status + ')' : ''}: ${e.message}`,
          RESUME_HINT,
          e,
        )
      }
      throw e
    }
  }

  const me = await call(() => host.whoami())
  if (me.type !== 'User' || me.login.toLowerCase() === agent.login.toLowerCase()) {
    throw new IdentityError(
      `the token belongs to ${me.login} (type ${me.type}); the planner account must be a User account that differs from the agent login ${agent.login}`,
      agent.setupDoc,
    )
  }

  const existingState = loadState(planPath)
  if (existingState !== null && (existingState.planHash !== hash || existingState.changesetId !== plan.changesetId)) {
    throw new StateError(
      `state.json belongs to a different version of this plan (state ${existingState.planHash}, current ${hash})`,
      'editing a plan after its issues were published is not supported; restore the published plan or start a new changeset in a new directory',
    )
  }
  const state: State = existingState ?? {
    changesetId: plan.changesetId,
    planHash: hash,
    issues: {},
    linksFinalized: false,
  }

  const created: IssueRef[] = []
  const adopted: IssueRef[] = []
  const existing: IssueRef[] = []
  for (const repo of publishOrder(plan)) {
    const known = state.issues[repo]
    if (known !== undefined) {
      existing.push({ repo, number: known.number, url: known.url })
      onProgress?.(`existing ${repo}#${known.number} ${known.url}`)
      continue
    }
    const r = renderIssue(plan, repo, { agent, links: refs(state) })
    const found = await call(() => host.findIssueByMarker(repo, r.marker, me.login))
    if (found) {
      state.issues[repo] = { repo, number: found.number, url: found.url, bodyDigest: sha256Hex(found.body) }
      adopted.push({ repo, number: found.number, url: found.url })
      onProgress?.(`adopted ${repo}#${found.number} ${found.url}`)
    } else {
      const ref = await call(() => host.createIssue(repo, { title: r.title, body: r.body }))
      state.issues[repo] = { repo: ref.repo, number: ref.number, url: ref.url, bodyDigest: sha256Hex(r.body) }
      created.push(ref)
      onProgress?.(`created ${repo}#${ref.number} ${ref.url}`)
    }
    saveState(planPath, state)
  }

  let updated = 0
  if (!state.linksFinalized) {
    for (const repo of publishOrder(plan)) {
      const entry = state.issues[repo]
      if (entry === undefined) continue
      const final = renderIssue(plan, repo, { agent, links: refs(state) })
      const digest = sha256Hex(final.body)
      if (digest !== entry.bodyDigest) {
        await call(() => host.updateIssueBody(repo, entry.number, final.body))
        entry.bodyDigest = digest
        updated++
        saveState(planPath, state)
        onProgress?.(`updated ${repo}#${entry.number}`)
      }
    }
    state.linksFinalized = true
    saveState(planPath, state)
  }

  return {
    dryRun: false,
    created,
    adopted,
    existing,
    updated,
    linksFinalized: true,
    rendered: renderAll(plan, { agent, links: refs(state) }),
  }
}
