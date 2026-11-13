import { ConfigError } from './errors.ts'
import type { Plan } from './plan/schema.ts'

export interface AgentProfile {
  readonly kind: string
  readonly login: string
  mentionLine(): string
  instructions(ctx: { plan: Plan; repo: string }): string[]
  readonly setupDoc: string
}

export type AgentProfileFactory = (opts: { login: string }) => AgentProfile

export type AgentRegistry = Readonly<Record<string, AgentProfileFactory>>

export function getAgentProfile(agent: { kind: string; login: string }, registry: AgentRegistry): AgentProfile {
  const factory = registry[agent.kind]
  if (!Object.hasOwn(registry, agent.kind) || factory === undefined) {
    throw new ConfigError(
      `unknown agent.kind "${agent.kind}"; supported: ${Object.keys(registry).sort().join(', ')}`,
      'set agent.kind in the config to a supported value',
    )
  }
  return factory({ login: agent.login })
}
