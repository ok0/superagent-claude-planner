import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(ROOT, 'src')
const CORE = join(SRC, 'core')
const CLI_DIR = join(SRC, 'cli') + sep
const ADAPTERS_DIR = join(SRC, 'adapters') + sep
const EXAMPLE_CONFIG = join(ROOT, 'sac-planner.config.example.json')
const EXAMPLE_PLAN = join(ROOT, 'examples', 'plan.json')

export function importSpecifiers(source: string): string[] {
  const pattern =
    /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g
  return [...source.matchAll(pattern)].map(m => m[1] ?? m[2] ?? m[3] ?? '')
}

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
    const violations: string[] = []
    for (const file of listFiles(CORE, name => name.endsWith('.ts'))) {
      for (const spec of importSpecifiers(readFileSync(file, 'utf8'))) {
        if (spec.startsWith('.')) {
          const resolved = resolve(dirname(file), spec)
          if (resolved.startsWith(CLI_DIR) || resolved.startsWith(ADAPTERS_DIR)) {
            violations.push(`${file}: ${spec}`)
          }
        } else if (spec !== 'zod' && !spec.startsWith('node:')) {
          violations.push(`${file}: ${spec}`)
        }
      }
    }
    expect(violations).toEqual([])
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

    const forbidden = (process.env.SAC_PLANNER_FORBIDDEN_NAMES ?? '')
      .split(',')
      .map(name => name.trim().toLowerCase())
      .filter(name => name.length > 0)
    if (forbidden.length > 0) {
      for (const file of [...files, EXAMPLE_PLAN]) {
        const lower = readFileSync(file, 'utf8').toLowerCase()
        for (const name of forbidden) {
          if (lower.includes(name)) violations.push(`${file}: ${name}`)
        }
      }
    }
    expect(violations).toEqual([])
  })
})
