import { defineConfig, type UserConfig } from 'tsdown'
const shared: UserConfig = {
  outDir: 'lib',
  format: 'esm',
  fixedExtension: false,
  platform: 'node',
  target: 'node22',
  clean: false,
  deps: { alwaysBundle: ['@octokit/rest', 'zod'], onlyBundle: false },
}
export default defineConfig([
  { ...shared, entry: { cli: 'src/cli/bin.ts' }, dts: false, outputOptions: { banner: '#!/usr/bin/env node' } },
  { ...shared, entry: { index: 'src/core/index.ts' }, dts: true, deps: { ...shared.deps, dts: { alwaysBundle: [] } } },
])
