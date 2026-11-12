/** The Session-header row toggles one Session's mute through the shared context-menu registry. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { MenuRegistry } from '@deepseek-ai/dsh-client-ui-context-menu/src/client/registry.ts'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply, inject } from '../src/client/index.ts'
import { zh } from '../src/client/locales.ts'

const NAMESPACE = 'session-sync-hub'

it('offers one mute row per Session and writes the shared form', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(SlotRegistry).await()
    const locale = new LocaleRuntime(ctx)
    ctx.provide('locale', locale)
    locale.setLocale('zh')
    const menu = new MenuRegistry(vi.fn())
    ctx.provide('contextMenus', { register: menu.register.bind(menu) } as never)
    const describe = vi.fn(async () => ({ ok: true as const, value: {
      writable: true, hasDocument: true,
      namespaces: [{ ns: NAMESPACE, schema: {}, value: { enabled: true, uploadReasoning: true, disabledSessions: [] }, applies: 'live', secrets: [], revision: 1 }],
    } }))
    const remote = new TestRemote(ctx, { settings: { describe } })
    await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({ name: 'root', children: {
      'settings.general.item': { kind: 'list', scope: 'root' },
      'contextMenu.icon': { kind: 'keyed', scope: 'root' },
    } } as never, () => null)

    const fiber = ctx.plugin({ inject, apply })
    await fiber.await()
    remote.emit('settings/document-updated', [NAMESPACE, 1])
    await vi.waitFor(() => { expect(slots.entries('settings.general.item')).toHaveLength(1) })

    const form = ctx.configForms.get(NAMESPACE)
    const set = vi.spyOn(form, 'set').mockResolvedValue(true)
    vi.spyOn(form, 'getSnapshot').mockReturnValue({
      status: 'ready', value: { enabled: true, uploadReasoning: true, disabledSessions: [] },
      base: undefined, user: undefined, revision: 1, writable: true,
    })

    const sessionId = SessionId('session-a')
    const resolve = () => menu.resolve({ kind: 'sessionHeader', value: { sessionId } }).source.getSnapshot()
    await vi.waitFor(() => { expect(resolve()).toHaveLength(1) })
    const resolved = menu.resolve({ kind: 'sessionHeader', value: { sessionId } })
    const row = resolved.source.getSnapshot()[0]!
    expect(row.label).toBe(zh['menu.synced'])
    expect(row.disabled).toBe(false)
    expect(row.icon).toMatchObject({ key: 'session-sync.synced' })

    resolved.select(row.id)
    await vi.waitFor(() => { expect(set).toHaveBeenCalledWith('disabledSessions', ['session-a']) })

    await fiber.dispose()
    expect(resolve()).toHaveLength(0)
  } finally {
    await ctx.fiber.dispose()
  }
})
