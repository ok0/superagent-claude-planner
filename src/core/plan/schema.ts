import { z } from 'zod'

export const REPO_SLUG = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/

const text = z.string().min(1)
const slug = z.string().regex(REPO_SLUG, 'must be owner/name')

export const CONTRACT_FORMATS = ['openapi', 'protobuf', 'json-schema', 'typescript', 'text'] as const

export const PlanSchema = z.strictObject({
  schemaVersion: z.literal(1),
  changesetId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/, 'must match ^[a-z0-9][a-z0-9-]{2,63}$'),
  title: z.string().min(1).max(120),
  request: z.strictObject({ text: text.optional(), url: z.url().optional() }),
  contract: z.strictObject({
    summary: text,
    format: z.enum(CONTRACT_FORMATS),
    definition: text,
    rules: z.array(text),
    examples: z.array(z.strictObject({ name: text, payload: text })),
    changes: z
      .array(
        z.strictObject({
          kind: z.enum(['add', 'change', 'remove', 'rename']),
          target: text,
          detail: text.optional(),
        }),
      )
      .min(1),
  }),
  breaking: z.strictObject({
    isBreaking: z.boolean(),
    strategy: z.enum(['staged', 'at-once']).optional(),
    note: text.optional(),
  }),
  repos: z
    .array(
      z.strictObject({
        repo: slug,
        role: z.enum(['producer', 'consumer', 'both', 'other']),
        task: z.strictObject({ summary: text, details: text }),
      }),
    )
    .min(1),
  dependencies: z.array(z.strictObject({ before: slug, after: slug, reason: text })),
  mergeOrderNote: text.optional(),
})

export type Plan = z.infer<typeof PlanSchema>

export function planJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(PlanSchema) as Record<string, unknown>
}
