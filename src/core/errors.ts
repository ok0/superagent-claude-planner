export class ConfigError extends Error {
  readonly hint: string
  constructor(message: string, hint: string) {
    super(message)
    this.name = 'ConfigError'
    this.hint = hint
  }
}
