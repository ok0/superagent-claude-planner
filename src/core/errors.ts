export class ConfigError extends Error {
  readonly hint: string
  constructor(message: string, hint: string) {
    super(message)
    this.name = 'ConfigError'
    this.hint = hint
  }
}

export class ApprovalError extends Error {
  readonly hint: string
  constructor(message: string, hint: string) {
    super(message)
    this.name = 'ApprovalError'
    this.hint = hint
  }
}

export class IdentityError extends Error {
  readonly hint: string
  constructor(message: string, hint: string) {
    super(message)
    this.name = 'IdentityError'
    this.hint = hint
  }
}

export class StateError extends Error {
  readonly hint: string
  constructor(message: string, hint: string) {
    super(message)
    this.name = 'StateError'
    this.hint = hint
  }
}

export class GitHubError extends Error {
  readonly status: number | undefined
  constructor(status: number | undefined, message: string) {
    super(message)
    this.name = 'GitHubError'
    this.status = status
  }
}

export class PublishError extends Error {
  readonly hint: string
  readonly status: number | undefined
  constructor(message: string, hint: string, cause: GitHubError) {
    super(message)
    this.name = 'PublishError'
    this.hint = hint
    this.status = cause.status
  }
}
