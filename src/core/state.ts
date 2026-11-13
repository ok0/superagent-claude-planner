import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import { StateError } from './errors.ts'
import { readJsonIfExists, writeJsonAtomic } from './fsutil.ts'

export const STATE_FILE = 'state.json'

export const StateIssueSchema = z.strictObject({
  repo: z.string(),
  number: z.number().int().positive(),
  url: z.string(),
  bodyDigest: z.string().regex(/^[0-9a-f]{64}$/),
})

export const StateSchema = z.strictObject({
  changesetId: z.string(),
  planHash: z.string(),
  issues: z.record(z.string(), StateIssueSchema),
  linksFinalized: z.boolean(),
})

export type State = z.infer<typeof StateSchema>
export type StateIssue = z.infer<typeof StateIssueSchema>

const STATE_HINT = 'restore or remove the state file; removing it makes publish adopt existing issues by marker'

export function statePath(planPath: string): string {
  return join(dirname(resolve(planPath)), STATE_FILE)
}

export function loadState(planPath: string): State | null {
  const path = statePath(planPath)
  const read = readJsonIfExists(path)
  if (!read.found) {
    return null
  }
  if ('error' in read) {
    throw new StateError(`${path}: invalid state file: ${read.error}`, STATE_HINT)
  }
  const parsed = StateSchema.safeParse(read.value)
  if (!parsed.success) {
    throw new StateError(
      `${path}: invalid state file: ` + parsed.error.issues.map(i => i.path.join('.') + ': ' + i.message).join('; '),
      STATE_HINT,
    )
  }
  return parsed.data
}

export function saveState(planPath: string, state: State): void {
  writeJsonAtomic(statePath(planPath), state)
}
