import { createHash } from 'node:crypto'
import type { Plan } from './plan/schema.ts'

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return '[' + value.map(i => (i === undefined ? 'null' : canonicalJson(i))).join(',') + ']'
  }
  const obj = value as Record<string, unknown>
  const entries = Object.keys(obj)
    .sort()
    .filter(k => obj[k] !== undefined)
    .map(k => JSON.stringify(k) + ':' + canonicalJson(obj[k]))
  return '{' + entries.join(',') + '}'
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function planHash(plan: Plan): string {
  return sha256Hex(canonicalJson(plan))
}
