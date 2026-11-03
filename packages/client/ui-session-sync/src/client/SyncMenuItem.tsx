/** Session-header more-actions row that mutes or resumes this Session's archive. */
import { IconCheckCircleOutlineRegular, IconPauseOutlineRegular, MenuItemButton } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SyncFace } from './index.ts'

/** Full props for the more-actions row. */
export type SyncMenuItemProps =
  PropsRuntime<'conversation.session.header.utilities.actions'>
  & PropsLocale<'sessionSync'>
  & InjectFace<SyncFace>

/**
 * Render the mute row and its current state for one Session.
 * @param props - settings hook, mute writer, Session id, menu dismissal, and localized copy.
 * @returns the menu row that flips this Session's mute after closing the menu.
 */
export function SyncMenuItem({ sessionId, onDismiss, useSettings, setMuted, t }: SyncMenuItemProps) {
  const settings = useSettings(value => value)
  const ready = settings.status === 'ready' && settings.writable
  const id = String(sessionId)
  const muted = settings.value?.disabledSessions.includes(id) === true
  return (
    <MenuItemButton
      icon={muted ? <IconPauseOutlineRegular /> : <IconCheckCircleOutlineRegular />}
      disabled={!ready}
      onSelect={() => {
        onDismiss()
        void setMuted(id, !muted)
      }}
    >
      {muted ? t('menu.paused') : t('menu.synced')}
    </MenuItemButton>
  )
}
