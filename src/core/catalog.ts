import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { z } from 'zod'
import { ConfigError } from './errors.ts'
import { REPO_SLUG } from './plan/schema.ts'

export const CATALOG_HINT =
  'fix the catalog file or remove "catalog" from the config; the catalog format is described in docs/setup.md'

export const CatalogSchema = z.strictObject({
  repos: z
    .array(
      z.strictObject({
        repo: z.string().regex(REPO_SLUG, 'must be owner/name'),
        description: z.string().min(1),
        localPath: z.string().min(1).optional(),
        contracts: z.array(z.string().min(1)).optional(),
      }),
    )
    .min(1),
})

export type Catalog = z.infer<typeof CatalogSchema>

export function loadCatalog(config: { catalog?: string }): Catalog | null {
  if (config.catalog === undefined) return null
  const file = resolve(config.catalog)
  if (!existsSync(file)) {
    throw new ConfigError(`catalog file not found: ${file}`, CATALOG_HINT)
  }

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch (e) {
    throw new ConfigError(`${file}: invalid JSON: ${e instanceof Error ? e.message : String(e)}`, CATALOG_HINT)
  }

  const result = CatalogSchema.safeParse(raw)
  if (!result.success) {
    throw new ConfigError(
      `${file}: ` + result.error.issues.map(i => i.path.join('.') + ': ' + i.message).join('; '),
      CATALOG_HINT,
    )
  }

  const seen = new Set<string>()
  result.data.repos.forEach((r, i) => {
    const key = r.repo.toLowerCase()
    if (seen.has(key)) {
      throw new ConfigError(`${file}: repos.${i}.repo: duplicate ${r.repo}`, CATALOG_HINT)
    }
    seen.add(key)
  })

  return {
    repos: result.data.repos.map(r =>
      r.localPath === undefined ? r : { ...r, localPath: resolve(dirname(file), r.localPath) },
    ),
  }
}
