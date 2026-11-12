/** Session-sync controls: the General settings switches and the Session-header menu row. */
import type { Context } from '@deepseek-ai/cordis'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-context-menu/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-session-log-export/client'
import { IconCheckCircleOutlineRegular, IconPauseOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { SyncRow } from './SyncRow.tsx'
import { en, ja, es, fr, de, ru, pt, NS, zh, type SyncKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Session-sync copy. */
    'sessionSync': SyncKey
  }
}

/** Host configuration fields this plugin edits, shared with the Host plugin's schema. */
export interface SyncSettings {
  enabled: boolean
  uploadReasoning: boolean
  disabledSessions: string[]
}

/** Data and callbacks injected into the settings row. */
export interface SyncFace {
  hooks: { settings: ObservableSnapshot<ConfigFormSnapshot<SyncSettings>> }
  setEnabled(value: boolean): Promise<boolean>
  setReasoning(value: boolean): Promise<boolean>
  setMuted(sessionId: string, muted: boolean): Promise<boolean>
}

/** Icon keys the Session-header row renders; the menu resolves each through `contextMenu.icon`. */
const SYNCED_ICON = 'session-sync.synced'
const PAUSED_ICON = 'session-sync.paused'

/** Services used by the browser companion. */
export const inject = ['slots', 'locale', 'configForms', 'contextMenus']

/**
 * Register the settings rows and the Session-header menu row.
 * @param ctx - browser plugin context.
 */
export function apply(ctx: Context): void {
  const namespace = 'session-sync-hub'
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-session-sync: dictionaries')
  const form = ctx.configForms.get<SyncSettings>(namespace)
  const t = ctx.locale.bind(NS)
  const setMuted = async (sessionId: string, muted: boolean): Promise<boolean> => {
    const current = form.getSnapshot().value?.disabledSessions ?? []
    const next = muted ? [...new Set([...current, sessionId])] : current.filter(id => id !== sessionId)
    return form.set('disabledSessions', next)
  }
  const face = (): SyncFace => ({
    hooks: { settings: form },
    setEnabled: value => form.set('enabled', value),
    setReasoning: value => form.set('uploadReasoning', value),
    setMuted,
  })
  ctx.effect(() => ctx.configForms.whileServed([namespace], () => ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register({ name: 'settings.general.item', id: 'session-sync-hub', order: 95, locale: NS, inject: face }, SyncRow))),
  'ui-session-sync: settings rows')
  ctx.slots.inject('contextMenu.icon', function* () {
    yield ctx.slots.register({ name: 'contextMenu.icon', key: SYNCED_ICON }, IconCheckCircleOutlineRegular)
    yield ctx.slots.register({ name: 'contextMenu.icon', key: PAUSED_ICON }, IconPauseOutlineRegular)
  })
  ctx.effect(() => ctx.contextMenus.register({
    id: 'session-sync.mute', target: 'sessionHeader', order: 30,
    observe: () => [form, ctx.locale],
    resolve: ({ sessionId }) => {
      const snapshot = form.getSnapshot()
      const ready = snapshot.status === 'ready' && snapshot.writable
      const id = String(sessionId)
      const muted = snapshot.value?.disabledSessions.includes(id) === true
      return [{
        id: 'mute',
        label: muted ? t('menu.paused') : t('menu.synced'),
        icon: { key: muted ? PAUSED_ICON : SYNCED_ICON },
        disabled: !ready,
        run: () => { void setMuted(id, !muted) },
      }]
    },
  }), 'ui-session-sync: session menu row')
}
