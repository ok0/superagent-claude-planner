import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import { planHash } from './hash.ts'
import { ApprovalError } from './errors.ts'
import { readJsonIfExists, writeJsonAtomic } from './fsutil.ts'
import type { Plan } from './plan/schema.ts'

export const APPROVAL_FILE = 'approval.json'

export const ApprovalSchema = z.strictObject({
  changesetId: z.string().min(1),
  planHash: z.string().regex(/^[0-9a-f]{64}$/),
  approvedAt: z.string().min(1),
})

export type Approval = z.infer<typeof ApprovalSchema>

export type ApprovalCheck = { ok: true; approval: Approval } | { ok: false; reason: 'missing' | 'changed' }

export const APPROVE_HINT =
  'run issuecrew-planner show <plan>, review the issues, then approve the printed hash with issuecrew-planner publish <plan> --approve-hash <hash> or issuecrew-planner approve <plan> --hash <hash>'

export function approvalPath(planPath: string): string {
  return join(dirname(resolve(planPath)), APPROVAL_FILE)
}

export function recordApproval(
  planPath: string,
  plan: Plan,
  expectedHash: string,
  now: () => Date = () => new Date(),
): Approval {
  const h = planHash(plan)
  const given = expectedHash.trim()
  if (given.toLowerCase() !== h) {
    throw new ApprovalError(`hash does not match the current plan (given ${given}, current ${h})`, APPROVE_HINT)
  }
  const approval: Approval = { changesetId: plan.changesetId, planHash: h, approvedAt: now().toISOString() }
  writeJsonAtomic(approvalPath(planPath), approval)
  return approval
}

export function checkApproval(planPath: string, plan: Plan): ApprovalCheck {
  const read = readJsonIfExists(approvalPath(planPath))
  if (!read.found || 'error' in read) {
    return { ok: false, reason: 'missing' }
  }
  const parsed = ApprovalSchema.safeParse(read.value)
  if (!parsed.success) {
    return { ok: false, reason: 'missing' }
  }
  const approval = parsed.data
  if (approval.planHash !== planHash(plan) || approval.changesetId !== plan.changesetId) {
    return { ok: false, reason: 'changed' }
  }
  return { ok: true, approval }
}

export function approvalErrorFor(reason: 'missing' | 'changed', plan: Plan): ApprovalError {
  const message =
    reason === 'missing'
      ? `plan ${plan.changesetId} is not approved`
      : `plan ${plan.changesetId} changed after approval; the approved hash no longer matches`
  return new ApprovalError(message, APPROVE_HINT)
}
