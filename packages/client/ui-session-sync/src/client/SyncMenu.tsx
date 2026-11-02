/** Session-header toggle for the Host session archive. */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SyncFace } from './index.ts'

/** Full props for the header toggle. */
export type SyncMenuProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<'sessionSync'>
  & InjectFace<SyncFace>

/**
 * Render the mute toggle for one Session.
 * @param props - settings hook, mute writer, Session id and localized copy.
 * @returns a pressed-state button that flips this Session's mute.
 */
export function SyncMenu({ sessionId, useSettings, setMuted, t }: SyncMenuProps) {
  const settings = useSettings(value => value)
  const ready = settings.status === 'ready' && settings.writable
  const id = String(sessionId)
  const muted = settings.value?.disabledSessions?.includes(id) === true
  return <button type="button" title={t('menu.aria')} aria-label={t('menu.aria')} aria-pressed={!muted}
    disabled={!ready} onClick={() => { void setMuted(id, !muted) }}>
    {muted ? t('menu.paused') : t('menu.synced')}
  </button>
}
