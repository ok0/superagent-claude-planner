import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ConfigError } from '../src/core/errors.ts'
import { LOGIN_HINT, SETUP_HINT, loadConfig } from '../src/core/config.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

function dirs(): { cwd: string; home: string } {
  return { cwd: mkdtempSync(join(tmpdir(), 'sacp-')), home: mkdtempSync(join(tmpdir(), 'sacp-')) }
}

function writeConfig(file: string, login: string): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ agent: { login } }))
}

function thrown(fn: () => unknown): ConfigError {
  try {
    fn()
  } catch (e) {
    if (e instanceof ConfigError) return e
    throw e
  }
  throw new Error('expected ConfigError')
}

describe('config', () => {
  it('resolution order', () => {
    const { cwd, home } = dirs()
    const flag = join(cwd, 'flag.json')
    const envFile = join(cwd, 'env.json')
    const cwdFile = join(cwd, 'sac-planner.config.json')
    const homeFile = join(home, '.config', 'sac-planner', 'config.json')
    writeConfig(flag, 'l-flag')
    writeConfig(envFile, 'l-env')
    writeConfig(cwdFile, 'l-cwd')
    writeConfig(homeFile, 'l-home')
    const env = { HOME: home, SAC_PLANNER_CONFIG: 'env.json' }
    expect(loadConfig({ path: 'flag.json', env, cwd }).agent.login).toBe('l-flag')
    expect(loadConfig({ env, cwd }).agent.login).toBe('l-env')
    expect(loadConfig({ env: { HOME: home }, cwd }).agent.login).toBe('l-cwd')
    rmSync(cwdFile)
    expect(loadConfig({ env: { HOME: home }, cwd }).agent.login).toBe('l-home')
  })

  it('missing config', () => {
    const { cwd, home } = dirs()
    const err = thrown(() => loadConfig({ env: { HOME: home }, cwd }))
    expect(err.message).toMatch(/no config found/)
    expect(err.hint).toBe(SETUP_HINT)
  })

  it('explicit missing', () => {
    const { cwd, home } = dirs()
    const err = thrown(() => loadConfig({ path: 'nope.json', env: { HOME: home }, cwd }))
    expect(err.message).toMatch(/config file not found/)
  })

  it('missing login', () => {
    const { cwd, home } = dirs()
    for (const body of [{ agent: { kind: 'superagent-claude' } }, {}]) {
      writeFileSync(join(cwd, 'missing.json'), JSON.stringify(body))
      const err = thrown(() => loadConfig({ path: 'missing.json', env: { HOME: home }, cwd }))
      expect(err.message).toMatch(/agent\.login is required/)
      expect(err.hint).toBe(LOGIN_HINT)
    }
  })

  it('invalid JSON', () => {
    const { cwd, home } = dirs()
    writeFileSync(join(cwd, 'bad.json'), '{ not json')
    const err = thrown(() => loadConfig({ path: 'bad.json', env: { HOME: home }, cwd }))
    expect(err.message).toMatch(/invalid JSON/)
  })

  it('defaults and catalog resolution', () => {
    const { cwd, home } = dirs()
    const file = join(cwd, 'sac-planner.config.json')
    writeConfig(file, 'x')
    const config = loadConfig({ env: { HOME: home }, cwd })
    expect(config.agent.kind).toBe('superagent-claude')
    expect(config.github.tokenEnv).toBe('PLANNER_GITHUB_TOKEN')
    expect(config.catalog).toBeUndefined()
    writeFileSync(file, JSON.stringify({ agent: { login: 'x' }, catalog: 'cat.json' }))
    expect(loadConfig({ env: { HOME: home }, cwd }).catalog).toBe(join(dirname(file), 'cat.json'))
  })

  it('example config', () => {
    const { cwd, home } = dirs()
    const config = loadConfig({ path: join(ROOT, 'sac-planner.config.example.json'), env: { HOME: home }, cwd })
    expect(config.agent.login).toBe('<agent-login>')
  })
})
