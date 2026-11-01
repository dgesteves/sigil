import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'core/index': 'src/core/index.ts',
    cli: 'src/cli/main.ts',
  },
  format: 'esm',
  platform: 'node',
  target: 'node22',
  dts: true,
  clean: true,
  shims: false,
  fixedExtension: false,
})
