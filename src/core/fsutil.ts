import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  renameSync(tmp, path)
}

export function readJsonIfExists(
  path: string,
): { found: false } | { found: true; value: unknown } | { found: true; error: string } {
  if (!existsSync(path)) {
    return { found: false }
  }
  try {
    return { found: true, value: JSON.parse(readFileSync(path, 'utf8')) }
  } catch (e) {
    return { found: true, error: e instanceof Error ? e.message : String(e) }
  }
}
