import type { AgentProfile } from '../agent.ts'
import { sha256Hex } from '../hash.ts'
import type { IssueRef } from '../github/port.ts'
import { mergeOrder, publishOrder } from '../plan/order.ts'
import { CONTRACT_FORMATS } from '../plan/schema.ts'
import type { Plan } from '../plan/schema.ts'

export type RenderContext = { agent: AgentProfile; links: Readonly<Record<string, IssueRef | undefined>> }
export type RenderedIssue = { repo: string; title: string; body: string; marker: string }

export const AT_ONCE_SENTENCE =
  'Temporary breakage risk: the old form is replaced in this same set; merge in the order above, until all are merged the system may be broken.'
export const STAGED_SENTENCE =
  'Staged change: the producer keeps the old form. Removing the old form is not part of this changeset and will be a separate later request.'
export const CONTRACT_BEGIN = '<!-- sac-planner:contract:begin -->'
export const CONTRACT_END = '<!-- sac-planner:contract:end -->'

const LANG: Record<(typeof CONTRACT_FORMATS)[number], string> = {
  openapi: 'yaml',
  protobuf: 'protobuf',
  'json-schema': 'json',
  typescript: 'typescript',
  text: 'text',
}

export function issueMarker(changesetId: string, repo: string): string {
  return `<!-- sac-planner:${changesetId}:${repo} -->`
}

function fence(content: string): string {
  const runs = content.match(/`+/g) ?? []
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0)
  return '`'.repeat(Math.max(3, longest + 1))
}

function trimNl(s: string): string {
  return s.replace(/\n+$/, '')
}

export function renderContract(plan: Plan): string {
  const c = plan.contract
  const definition = trimNl(c.definition)
  const f = fence(definition)
  const rules = c.rules.length > 0 ? c.rules.map(rule => `- ${rule}`) : ['- None']
  const examples =
    c.examples.length > 0
      ? c.examples
          .map(ex => {
            const payload = trimNl(ex.payload)
            const g = fence(payload)
            return [`#### ${ex.name}`, g, payload, g].join('\n')
          })
          .join('\n\n')
      : 'None'
  const changes = c.changes.map(
    ch => `- ${ch.kind}: \`${ch.target}\`` + (ch.detail !== undefined ? ` - ${ch.detail}` : ''),
  )
  return [
    CONTRACT_BEGIN,
    c.summary,
    '',
    `Format: \`${c.format}\``,
    '',
    [f + LANG[c.format], definition, f].join('\n'),
    '',
    '### Rules',
    ...rules,
    '',
    '### Examples',
    examples,
    '',
    '### Changes',
    ...changes,
    CONTRACT_END,
  ].join('\n')
}

export function contractDigest(plan: Plan): string {
  return sha256Hex(renderContract(plan)).slice(0, 12)
}

export function renderIssue(plan: Plan, repo: string, ctx: RenderContext): RenderedIssue {
  const entry = plan.repos.find(r => r.repo === repo)
  if (entry === undefined) {
    throw new Error(`repo not in plan: ${repo}`)
  }
  const { agent, links } = ctx
  const marker = issueMarker(plan.changesetId, repo)
  const title = `[${plan.changesetId}] ${entry.task.summary}`
  const ref = (r: string): string => {
    const link = links[r]
    return link ? `${r}#${link.number}` : r
  }

  const layerLines = mergeOrder(plan).map(
    (layer, i) => `${i + 1}. ${layer.map(r => ref(r) + (r === repo ? ' (this issue)' : '')).join(', ')}`,
  )
  const notes: string[] = []
  if (plan.mergeOrderNote !== undefined) notes.push(plan.mergeOrderNote)
  if (plan.breaking.isBreaking && plan.breaking.strategy === 'at-once') notes.push(AT_ONCE_SENTENCE)
  if (plan.breaking.isBreaking && plan.breaking.strategy === 'staged') notes.push(STAGED_SENTENCE)
  if (plan.breaking.note !== undefined) notes.push(`Breaking change note: ${plan.breaking.note}`)

  const related = publishOrder(plan)
    .filter(r => r !== repo)
    .map(r => {
      const link = links[r]
      return link ? `- ${r}#${link.number}` : `- ${r} (issue pending, changeset ${plan.changesetId})`
    })

  const requestParts: string[] = []
  if (plan.request.url !== undefined) requestParts.push(`URL: ${plan.request.url}`)
  if (plan.request.text !== undefined) {
    requestParts.push(
      trimNl(plan.request.text)
        .split('\n')
        .map(l => (l ? '> ' + l : '>'))
        .join('\n'),
    )
  }

  const sections = [
    marker,
    agent.mentionLine(),
    `## Changeset\n- ID: \`${plan.changesetId}\`\n- Plan: ${plan.title}\n- Contract digest: \`${contractDigest(plan)}\``,
    `## Shared contract\n${renderContract(plan)}`,
    `## Your task (${repo}, ${entry.role})\n**Summary:** ${entry.task.summary}\n\n${entry.task.details}`,
    `## Merge order\n${[layerLines.join('\n'), ...notes].join('\n\n')}`,
    `## Related issues\n${related.length > 0 ? related.join('\n') : '- None'}`,
    `## Original request\n${requestParts.join('\n\n')}`,
    `## Notes for the agent\n${agent
      .instructions({ plan, repo })
      .map(s => '- ' + s)
      .join('\n')}`,
  ]

  return { repo, title, body: sections.join('\n\n') + '\n', marker }
}

export function renderAll(plan: Plan, ctx: RenderContext): RenderedIssue[] {
  return publishOrder(plan).map(r => renderIssue(plan, r, ctx))
}
