import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { checkMessage, runCheckCommits } from '../scripts/check-commits.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const created: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sacp-commits-'))
  created.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
})

describe('check-commits', () => {
  it('accepts conventional subjects', () => {
    expect(checkMessage('feat: add catalog command')).toEqual([])
    expect(checkMessage('fix(cli): print catalog path\n\nLonger body.')).toEqual([])
    expect(checkMessage('feat!: drop legacy flag')).toEqual([])
  })

  it('rejects a non-conventional subject', () => {
    for (const message of ['Add catalog', 'update stuff']) {
      const reasons = checkMessage(message)
      expect(reasons).toHaveLength(1)
      expect(reasons[0]).toMatch(/^subject is not a Conventional Commit/)
    }
  })

  it('rejects AI attribution lines', () => {
    const coAuthored = checkMessage('feat: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>')
    expect(coAuthored.some(reason => reason.startsWith('AI attribution line'))).toBe(true)
    const generated = checkMessage('feat: x\n\n\u{1F916} Generated with Claude Code')
    expect(generated.some(reason => reason.startsWith('AI attribution line'))).toBe(true)
  })

  it('rejects milestone IDs', () => {
    for (const message of ['feat: finish M3 skill', 'feat(m2): x', 'chore: milestone 3 wrap-up']) {
      const reasons = checkMessage(message)
      expect(reasons.some(reason => reason.startsWith('milestone ID in message'))).toBe(true)
    }
  })

  it('does not flag a plain mention of the plugin host', () => {
    expect(checkMessage('feat: add Claude Code plugin and skill')).toEqual([])
  })

  it('repository history passes', () => {
    const out: string[] = []
    const err: string[] = []
    const code = runCheckCommits({ root: ROOT, argv: [], out: s => out.push(s), err: s => err.push(s) })
    expect(err).toEqual([])
    expect(code).toBe(0)
  })

  it('checks a message file', () => {
    const dir = tempDir()
    const bad = join(dir, 'bad.txt')
    const good = join(dir, 'good.txt')
    writeFileSync(bad, 'Bad subject\n')
    writeFileSync(good, 'docs: add setup guide\n')
    const noop = (): void => {}
    expect(runCheckCommits({ root: ROOT, argv: ['--message-file', bad], out: noop, err: noop })).toBe(1)
    expect(runCheckCommits({ root: ROOT, argv: ['--message-file', good], out: noop, err: noop })).toBe(0)
  })
})
