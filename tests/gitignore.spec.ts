import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const ignored = (path: string): boolean => spawnSync('git', ['check-ignore', '-q', path], { cwd: ROOT }).status === 0

describe('local config files', () => {
  it('local planner config is ignored', () => {
    expect(ignored('issuecrew-planner.config.json')).toBe(true)
  })

  it('local worker config is ignored', () => {
    expect(ignored('issuecrew.json')).toBe(true)
  })

  it('example config is not ignored', () => {
    expect(ignored('issuecrew-planner.config.example.json')).toBe(false)
  })

  it('no local config is tracked', () => {
    const tracked = execFileSync('git', ['ls-files', '--', 'issuecrew-planner.config.json', 'issuecrew.json'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
    expect(tracked).toBe('')
  })
})
