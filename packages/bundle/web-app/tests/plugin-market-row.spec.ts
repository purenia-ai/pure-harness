/** The shipped Web composition mounts the plugin market Discover tab row. */
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'

it('declares the plugin market Discover tab row with its package dependency', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
  const rows = loadOverlayPatches('plugin-market-row', fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)))
    .flatMap(patch => patch.insert ?? []).filter(row => row.id === 'ui-plugin-market')
  expect(rows).toHaveLength(1)
  expect(rows[0]!.name).toBe('@deepseek-ai/dsh-client-ui-plugin-market')
  expect(manifest.dependencies).toHaveProperty('@deepseek-ai/dsh-client-ui-plugin-market')
})
