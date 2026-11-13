import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { checkCoreImports, importSpecifiers } from '../scripts/check-hygiene.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(ROOT, 'src')
const EXAMPLE_CONFIG = join(ROOT, 'sac-planner.config.example.json')

function listFiles(dir: string, filter: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return listFiles(full, filter)
    return filter(entry.name) ? [full] : []
  })
}

describe('architecture', () => {
  it('helper detects CLI import', () => {
    expect(importSpecifiers("import { x } from '../cli/main.ts'")).toEqual(['../cli/main.ts'])
  })

  it('core imports no CLI or adapter code', () => {
    expect(checkCoreImports(SRC)).toEqual([])
  })

  it('no hardcoded names', () => {
    const files = [...listFiles(SRC, () => true), EXAMPLE_CONFIG]
    const violations: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      if (text.includes('github.com/')) violations.push(`${file}: github.com/`)
    }

    const config = JSON.parse(readFileSync(EXAMPLE_CONFIG, 'utf8')) as { agent: { login: string } }
    expect(config.agent.login).toBe('<agent-login>')
    expect(violations).toEqual([])
  })
})
