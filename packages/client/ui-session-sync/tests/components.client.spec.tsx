// @vitest-environment jsdom
/** Both controls render accepted state and forward one user gesture. */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { SyncMenu, type SyncMenuProps } from '../src/client/SyncMenu.tsx'
import { SyncRow, type SyncRowProps } from '../src/client/SyncRow.tsx'
import { zh } from '../src/client/locales.ts'

const t: SyncRowProps['t'] = makeTranslate(zh)

type Settings = { enabled: boolean; uploadReasoning: boolean; disabledSessions: string[] }

function useSettings<T>(selector: (value: ConfigFormSnapshot<Settings>) => T): T {
  return selector({ status: 'ready', value: { enabled: true, uploadReasoning: false, disabledSessions: [] }, base: undefined, user: undefined, revision: 1, writable: true })
}

describe('session sync controls', () => {
  it('renders accepted settings and writes both switches', () => {
    const setEnabled = vi.fn(async () => true)
    const setReasoning = vi.fn(async () => true)
    const props = { useSettings, setEnabled, setReasoning, setMuted: async () => true, t } as SyncRowProps
    render(<SyncRow {...props} />)
    expect(screen.getByText(zh['settings.title'])).toBeTruthy()
    const switches = screen.getAllByRole('switch')
    expect(switches[0]?.getAttribute('aria-checked')).toBe('true')
    expect(switches[1]?.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(switches[0]!)
    fireEvent.click(switches[1]!)
    expect(setEnabled).toHaveBeenCalledWith(false)
    expect(setReasoning).toHaveBeenCalledWith(true)
  })

  it('toggles the muted state of one session from the header', () => {
    const setMuted = vi.fn(async () => true)
    const props = {
      sessionId: SessionId('session-a'), useSettings, setEnabled: async () => true,
      setReasoning: async () => true, setMuted, t,
    } as SyncMenuProps
    render(<SyncMenu {...props} />)
    const button = screen.getByRole('button') as HTMLButtonElement
    expect(button.textContent).toBe(zh['menu.synced'])
    expect(button.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(button)
    expect(setMuted).toHaveBeenCalledWith('session-a', true)
  })
})
