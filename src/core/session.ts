import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const SESSION_DIR = '.sac-planner'
export const MARKER_FILE = '.session-active'

export function projectRoot(env: Readonly<Record<string, string | undefined>>, cwd: string): string {
  const dir = env.CLAUDE_PROJECT_DIR
  return typeof dir === 'string' && dir !== '' ? resolve(dir) : cwd
}

export function markerPath(root: string): string {
  return join(root, SESSION_DIR, MARKER_FILE)
}

export function planStoragePath(root: string, changesetId: string): string {
  return join(root, SESSION_DIR, changesetId, 'plan.json')
}

export function writeSessionMarker(root: string, action: 'start' | 'end', now: Date = new Date()): string {
  const content = action === 'start' ? 'active ' + now.toISOString() : 'done'
  mkdirSync(join(root, SESSION_DIR), { recursive: true })
  writeFileSync(markerPath(root), content + '\n', 'utf8')
  return content
}
