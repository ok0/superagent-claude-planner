export { PlanSchema, planJsonSchema, REPO_SLUG, CONTRACT_FORMATS } from './plan/schema.ts'
export type { Plan } from './plan/schema.ts'
export { validatePlan, readPlanFile, STRATEGY_REQUIRED } from './plan/validate.ts'
export type { FieldError, ValidationResult } from './plan/validate.ts'
export { topoLayers, mergeOrder, publishOrder } from './plan/order.ts'
export type { Edge } from './plan/order.ts'
export { canonicalJson, sha256Hex, planHash } from './hash.ts'
export { getAgentProfile } from './agent.ts'
export type { AgentProfile, AgentProfileFactory, AgentRegistry } from './agent.ts'
export {
  ConfigSchema,
  loadConfig,
  findConfigFile,
  DEFAULT_TOKEN_ENV,
  SETUP_HINT,
  LOGIN_HINT,
  resolveToken,
  TOKEN_HINT,
} from './config.ts'
export type { Config } from './config.ts'
export { CatalogSchema, CATALOG_HINT, loadCatalog } from './catalog.ts'
export type { Catalog } from './catalog.ts'
export { ConfigError, ApprovalError, IdentityError, StateError, GitHubError, PublishError } from './errors.ts'
export {
  renderContract,
  contractDigest,
  issueMarker,
  renderIssue,
  renderAll,
  AT_ONCE_SENTENCE,
  STAGED_SENTENCE,
  CONTRACT_BEGIN,
  CONTRACT_END,
} from './render/render.ts'
export type { RenderContext, RenderedIssue } from './render/render.ts'
export type { IssueRef } from './github/port.ts'
export type { IssueHost, HostIdentity, FoundIssue } from './github/port.ts'
export {
  APPROVAL_FILE,
  ApprovalSchema,
  APPROVE_HINT,
  approvalPath,
  recordApproval,
  checkApproval,
  approvalErrorFor,
} from './approval.ts'
export type { Approval, ApprovalCheck } from './approval.ts'
export { STATE_FILE, StateSchema, statePath, loadState, saveState } from './state.ts'
export type { State, StateIssue } from './state.ts'
export { publish, RESUME_HINT } from './publish.ts'
export type { PublishOptions, PublishResult } from './publish.ts'
