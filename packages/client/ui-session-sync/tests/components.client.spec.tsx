// @vitest-environment jsdom
/** Both controls render accepted state and forward one user gesture. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { SyncMenuItem, type SyncMenuItemProps } from '../src/client/SyncMenuItem.tsx'
import { SyncRow, type SyncRowProps } from '../src/client/SyncRow.tsx'
import { zh } from '../src/client/locales.ts'

const t: SyncRowProps['t'] = makeTranslate(zh)

type Settings = { enabled: boolean; uploadReasoning: boolean; disabledSessions: string[] }

function useSettings<T>(selector: (value: ConfigFormSnapshot<Settings>) => T): T {
  return selector({ status: 'ready', value: { enabled: true, uploadReasoning: false, disabledSessions: [] }, base: undefined, user: undefined, revision: 1, writable: true })
}

function menuProps(disabledSessions: string[], overrides: Partial<SyncMenuItemProps> = {}) {
  return {
    sessionId: SessionId('session-a'),
    onDismiss: vi.fn(),
    useSettings<T>(selector: (value: ConfigFormSnapshot<Settings>) => T): T {
      return selector({ status: 'ready', value: { enabled: true, uploadReasoning: false, disabledSessions }, base: undefined, user: undefined, revision: 1, writable: true })
    },
    setMuted: vi.fn(async () => true),
    t,
    ...overrides,
  } as SyncMenuItemProps
}

describe('session sync controls', () => {
  afterEach(cleanup)

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

  it('toggles the muted state of one session from the more-actions row', () => {
    const props = menuProps([])
    render(<SyncMenuItem {...props} />)
    const row = screen.getByRole('menuitem')
    expect(row.textContent).toBe(zh['menu.synced'])
    expect(row.querySelector('svg')?.getAttribute('data-icon')).toContain('check-circle')
    fireEvent.click(row)
    expect(props.onDismiss).toHaveBeenCalledOnce()
    expect(props.setMuted).toHaveBeenCalledWith('session-a', true)
  })

  it('reports a muted session and resumes it', () => {
    const props = menuProps(['session-a'])
    render(<SyncMenuItem {...props} />)
    const row = screen.getByRole('menuitem')
    expect(row.textContent).toBe(zh['menu.paused'])
    expect(row.querySelector('svg')?.getAttribute('data-icon')).toContain('pause')
    fireEvent.click(row)
    expect(props.setMuted).toHaveBeenCalledWith('session-a', false)
  })

  it('keeps the row unavailable until the configuration form is writable', () => {
    const useUnwritable = <T,>(selector: (value: ConfigFormSnapshot<Settings>) => T): T =>
      selector({ status: 'ready', value: undefined, base: undefined, user: undefined, revision: 0, writable: false })
    render(<SyncMenuItem {...menuProps([], { useSettings: useUnwritable })} />)
    expect(screen.getByRole('menuitem').hasAttribute('disabled')).toBe(true)
  })
})
