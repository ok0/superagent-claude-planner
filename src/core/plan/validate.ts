import { readFile } from 'node:fs/promises'
import type { Plan } from './schema.ts'
import { PlanSchema } from './schema.ts'
import { topoLayers } from './order.ts'

export type FieldError = { path: string; message: string }
export type ValidationResult = { ok: true; plan: Plan } | { ok: false; errors: FieldError[] }

export const STRATEGY_REQUIRED = 'breaking change requires a recorded choice: staged | at-once'

export function validatePlan(input: unknown): ValidationResult {
  const parsed = PlanSchema.safeParse(input, {
    error: iss => (iss.code === 'invalid_type' && iss.input === undefined ? 'Required' : undefined),
  })
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(issue => ({
        path: issue.path.map(String).join('.') || '(root)',
        message: issue.message,
      })),
    }
  }

  const plan = parsed.data
  const errors: FieldError[] = []

  if (plan.request.text === undefined && plan.request.url === undefined) {
    errors.push({ path: 'request', message: 'request needs text or url' })
  }

  const firstAt = new Map<string, number>()
  plan.repos.forEach((r, i) => {
    const first = firstAt.get(r.repo)
    if (first !== undefined) {
      errors.push({
        path: `repos.${i}.repo`,
        message: `duplicate repo ${r.repo} (first at repos.${first}.repo)`,
      })
    } else {
      firstAt.set(r.repo, i)
    }
    const name = r.repo.slice(r.repo.indexOf('/') + 1).toLowerCase()
    if (name.endsWith('-archived')) {
      errors.push({ path: `repos.${i}.repo`, message: `archived repository is not allowed: ${r.repo}` })
    }
  })

  const repoSet = new Set(plan.repos.map(r => r.repo))
  let unknownEndpoint = false
  plan.dependencies.forEach((d, i) => {
    for (const end of ['before', 'after'] as const) {
      const slug = d[end]
      if (!repoSet.has(slug)) {
        unknownEndpoint = true
        errors.push({ path: `dependencies.${i}.${end}`, message: `unknown repo ${slug}; not in repos` })
      }
    }
  })
  if (!unknownEndpoint) {
    const { cyclic } = topoLayers(
      plan.repos.map(r => r.repo),
      plan.dependencies,
    )
    if (cyclic.length > 0) {
      errors.push({ path: 'dependencies', message: `dependency cycle among ${cyclic.join(', ')}` })
    }
  }

  if (plan.breaking.isBreaking !== true) {
    plan.contract.changes.forEach((c, i) => {
      if (c.kind === 'remove' || c.kind === 'rename') {
        errors.push({
          path: `contract.changes.${i}.kind`,
          message: `a ${c.kind} change requires breaking.isBreaking: true`,
        })
      }
    })
  }

  if (plan.breaking.isBreaking === true && plan.breaking.strategy === undefined) {
    errors.push({ path: 'breaking.strategy', message: STRATEGY_REQUIRED })
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }
  return { ok: true, plan }
}

export async function readPlanFile(path: string): Promise<ValidationResult> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, errors: [{ path: '(root)', message: `cannot read plan file ${path}: ${msg}` }] }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, errors: [{ path: '(root)', message: `invalid JSON: ${msg}` }] }
  }
  return validatePlan(parsed)
}
