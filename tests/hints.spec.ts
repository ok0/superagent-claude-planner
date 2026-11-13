import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createSuperagentClaudeProfile } from '../src/adapters/agent/superagent-claude.ts'
import { CATALOG_HINT } from '../src/core/catalog.ts'
import { ConfigSchema, LOGIN_HINT, SETUP_HINT, TOKEN_HINT, resolveToken } from '../src/core/config.ts'
import { ConfigError } from '../src/core/errors.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

describe('setup hints', () => {
  it('config, login and token hints reference docs/setup.md', () => {
    for (const hint of [SETUP_HINT, LOGIN_HINT, TOKEN_HINT, CATALOG_HINT]) {
      expect(hint).toContain('docs/setup.md')
    }
  })

  it('missing token error references docs/setup.md', () => {
    const config = ConfigSchema.parse({ agent: { login: 'x' } })
    let caught: unknown
    try {
      resolveToken(config, {})
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ConfigError)
    expect((caught as ConfigError).hint).toContain('docs/setup.md')
  })

  it('identity setup doc references docs/setup.md', () => {
    const { setupDoc } = createSuperagentClaudeProfile({ login: 'x' })
    expect(setupDoc).toContain('docs/setup.md')
    expect(setupDoc).toContain('policy.allowed')
  })

  it('docs/setup.md exists', () => {
    expect(existsSync(join(ROOT, 'docs', 'setup.md'))).toBe(true)
  })
})
