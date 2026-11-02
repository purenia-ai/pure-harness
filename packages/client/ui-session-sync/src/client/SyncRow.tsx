/** General settings rows for the Host session archive. */
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SyncFace } from './index.ts'

/** Full props for the settings rows. */
export type SyncRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'sessionSync'>
  & InjectFace<SyncFace>

/**
 * Render the global switch and the reasoning switch.
 * @param props - settings hook, writers and localized copy.
 * @returns two preference rows.
 */
export function SyncRow({ useSettings, setEnabled, setReasoning, t }: SyncRowProps) {
  const settings = useSettings(value => value)
  const ready = settings.status === 'ready' && settings.writable
  return <div>
    <div>
      <div>{t('settings.title')}</div>
      <div>{t('settings.description')}</div>
    </div>
    <Switch checked={settings.value?.enabled === true} label={t('settings.title')}
      disabled={!ready} onChange={(enabled) => { void setEnabled(enabled) }} />
    <div>
      <div>{t('settings.reasoningTitle')}</div>
      <div>{t('settings.reasoningDescription')}</div>
    </div>
    <Switch checked={settings.value?.uploadReasoning === true} label={t('settings.reasoningTitle')}
      disabled={!ready} onChange={(enabled) => { void setReasoning(enabled) }} />
  </div>
}
