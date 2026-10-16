import { defineConfig } from 'tsdown'

/**
 * Build the package root as a self-contained bundle. The generic pi-ai package
 * ships only `lib/`, so its `src/*` modules must be inlined here;
 * externalizing them would make this plugin unresolvable in a packaged app.
 */
export default defineConfig([
  {
    entry: ['lib/types/index.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: { alwaysBundle: [/^@deepseek-ai\/dsh-llm-pi-ai(\/|$)/] },
  },
])
