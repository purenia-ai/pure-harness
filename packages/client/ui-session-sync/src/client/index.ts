/** Session-sync controls: General settings switches and the Session more-actions row. */
import type { Context } from '@deepseek-ai/cordis'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-session-log-export/client'
import { SyncRow } from './SyncRow.tsx'
import { SyncMenuItem } from './SyncMenuItem.tsx'
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

/** Data and callbacks injected into both contributions. */
export interface SyncFace {
  hooks: { settings: ObservableSnapshot<ConfigFormSnapshot<SyncSettings>> }
  setEnabled(value: boolean): Promise<boolean>
  setReasoning(value: boolean): Promise<boolean>
  setMuted(sessionId: string, muted: boolean): Promise<boolean>
}

/** Services used by the browser companion. */
export const inject = ['slots', 'locale', 'configForms']

/**
 * Register the settings rows and the Session more-actions row.
 * @param ctx - browser plugin context.
 */
export function apply(ctx: Context): void {
  const namespace = 'session-sync-hub'
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-session-sync: dictionaries')
  const form = ctx.configForms.get<SyncSettings>(namespace)
  const face = (): SyncFace => ({
    hooks: { settings: form },
    setEnabled: value => form.set('enabled', value),
    setReasoning: value => form.set('uploadReasoning', value),
    setMuted: async (sessionId, muted) => {
      const current = form.getSnapshot().value?.disabledSessions ?? []
      const next = muted ? [...new Set([...current, sessionId])] : current.filter(id => id !== sessionId)
      return form.set('disabledSessions', next)
    },
  })
  ctx.effect(() => ctx.configForms.whileServed([namespace], () => ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register({ name: 'settings.general.item', id: 'session-sync-hub', order: 95, locale: NS, inject: face }, SyncRow))),
  'ui-session-sync: settings rows')
  ctx.effect(() => ctx.configForms.whileServed([namespace], () =>
    ctx.slots.inject('conversation.session.header.utilities.actions', () => ctx.slots.register({
      name: 'conversation.session.header.utilities.actions', id: 'session-sync', order: 30, locale: NS, inject: face,
    }, SyncMenuItem))),
  'ui-session-sync: session menu row')
}
