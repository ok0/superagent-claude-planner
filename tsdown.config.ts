import { defineConfig } from 'tsdown'
export default defineConfig({
  entry: { cli: 'src/cli/bin.ts', index: 'src/core/index.ts' },
  outDir: 'lib',
  format: 'esm',
  fixedExtension: false,
  platform: 'node',
  target: 'node22',
  dts: false,
  clean: true,
  outputOptions: { banner: '#!/usr/bin/env node' },
  deps: { alwaysBundle: ['@octokit/rest', 'zod'], onlyBundle: false },
})
