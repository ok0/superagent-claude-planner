import type { AgentProfile } from '../../core/agent.ts'
import type { Plan } from '../../core/plan/schema.ts'

export const SUPERAGENT_CLAUDE_KIND = 'superagent-claude'

export function createSuperagentClaudeProfile(opts: { login: string }): AgentProfile {
  const { login } = opts
  return {
    kind: SUPERAGENT_CLAUDE_KIND,
    login,
    mentionLine(): string {
      return `@${login} please work on this issue.`
    },
    instructions({ plan }: { plan: Plan }): string[] {
      return [
        'The shared contract above is fixed. Implement it exactly as written and do not change its names, types, endpoints or messages.',
        'If inspecting the code shows the contract cannot be implemented as stated, stop and report the problem in this issue instead of changing the contract.',
        'Copy the "Merge order" section of this issue into your pull request description.',
        `Sibling issues in the other repositories carry the changeset ID \`${plan.changesetId}\`.`,
      ]
    },
    setupDoc: `The issue author must be listed in the agent's policy.allowed, must be a GitHub User account, and must differ from the agent login (${login}).`,
  }
}
