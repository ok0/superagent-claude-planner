import type { Plan } from '../../src/core/plan/schema.ts'

export function samplePlan(): Plan {
  return {
    schemaVersion: 1,
    changesetId: 'sample-change',
    title: 'Add SKU code to products',
    request: {
      text: 'Products need a SKU code.\nShow it in orders and the storefront.',
      url: 'https://example.com/requests/7',
    },
    contract: {
      summary: 'Product gains skuCode.',
      format: 'typescript',
      definition: 'interface Product {\n  id: string\n  skuCode: string\n}',
      rules: ['skuCode is never empty.'],
      examples: [{ name: 'Product', payload: '{"id":"p1","skuCode":"SKU-1"}' }],
      changes: [{ kind: 'add', target: 'Product.skuCode', detail: 'New field.' }],
    },
    breaking: { isBreaking: false },
    repos: [
      {
        repo: 'example-org/storefront',
        role: 'consumer',
        task: {
          summary: 'Show the SKU code on product pages',
          details: 'Read skuCode from the catalog product and display it under the product title.',
        },
      },
      {
        repo: 'example-org/catalog-api',
        role: 'producer',
        task: {
          summary: 'Return skuCode for every product',
          details: 'Add a non-empty skuCode field to the product resource and backfill existing products.',
        },
      },
      {
        repo: 'example-org/orders-api',
        role: 'consumer',
        task: {
          summary: 'Copy the SKU code into order lines',
          details: 'Store the product skuCode on each order line so orders show the SKU at purchase time.',
        },
      },
    ],
    dependencies: [
      {
        before: 'example-org/catalog-api',
        after: 'example-org/orders-api',
        reason: 'Orders read skuCode from the catalog product.',
      },
      {
        before: 'example-org/catalog-api',
        after: 'example-org/storefront',
        reason: 'The storefront reads skuCode from the catalog product.',
      },
    ],
    mergeOrderNote: 'Deploy catalog-api first.',
  }
}

function walk(obj: unknown, keys: string[]): Record<string, unknown> {
  let cur: unknown = obj
  for (const k of keys) {
    cur = (cur as Record<string, unknown>)[k]
  }
  return cur as Record<string, unknown>
}

export function deletePath(obj: unknown, path: string): void {
  const keys = path.split('.')
  const last = keys.pop()
  if (last === undefined) return
  delete walk(obj, keys)[last]
}

export function setPath(obj: unknown, path: string, value: unknown): void {
  const keys = path.split('.')
  const last = keys.pop()
  if (last === undefined) return
  walk(obj, keys)[last] = value
}
