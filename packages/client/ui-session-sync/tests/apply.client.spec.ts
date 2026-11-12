/** The controls follow namespace availability, write the shared form and dispose with the plugin. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject, type SyncFace } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'

const NAMESPACE = 'session-sync-hub'

function namespaceRow(revision: number) {
  return { ns: NAMESPACE, schema: {}, value: { enabled: true, uploadReasoning: true, disabledSessions: [] }, applies: 'live', secrets: [], revision }
}

it('registers the settings rows only while the Host serves the namespace', async () => {
  expect(hostApply).not.toThrow()
  const ctx = new Context()
  try {
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    const describe = vi.fn(async () => ({ ok: true as const, value: {
      writable: true, hasDocument: true,
      namespaces: [] as ReturnType<typeof namespaceRow>[],
    } }))
    const remote = new TestRemote(ctx, { settings: { describe } })
    await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
    ctx.provide('contextMenus', { register: vi.fn(() => () => {}) } as never)
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({ name: 'root', children: {
      'settings.general.item': { kind: 'list', scope: 'root' },
    } } as never, () => null)
    const fiber = ctx.plugin({ inject, apply })
    await fiber.await()
    await ctx.configForms.describe().ensure()
    expect(slots.entries('settings.general.item')).toHaveLength(0)
    describe.mockResolvedValue({ ok: true, value: { writable: true, hasDocument: true, namespaces: [namespaceRow(1)] } })
    remote.emit('settings/document-updated', [NAMESPACE, 1])
    await vi.waitFor(() => { expect(slots.entries('settings.general.item')).toHaveLength(1) })
    expect(slots.entries('settings.general.item')[0]!.options).toMatchObject({ id: NAMESPACE, order: 95 })

    const form = ctx.configForms.get(NAMESPACE)
    const ready = form.getSnapshot()
    const set = vi.spyOn(form, 'set').mockResolvedValue(false)
    vi.spyOn(form, 'getSnapshot')
      .mockReturnValueOnce({ ...ready, value: undefined })
      .mockReturnValue({ ...ready, value: { enabled: true, uploadReasoning: true, disabledSessions: ['session-a'] } })
    const face = slots.entries('settings.general.item')[0]!.inject!() as SyncFace & Record<string, unknown>
    await face.setEnabled(false)
    expect(set).toHaveBeenCalledWith('enabled', false)
    await face.setReasoning(true)
    expect(set).toHaveBeenCalledWith('uploadReasoning', true)
    await face.setMuted('session-a', true)
    expect(set).toHaveBeenLastCalledWith('disabledSessions', ['session-a'])
    await face.setMuted('session-b', true)
    expect(set).toHaveBeenLastCalledWith('disabledSessions', ['session-a', 'session-b'])
    await face.setMuted('session-a', false)
    expect(set).toHaveBeenLastCalledWith('disabledSessions', [])

    await fiber.dispose()
    expect(slots.entries('settings.general.item')).toHaveLength(0)
  } finally {
    await ctx.fiber.dispose()
  }
})
