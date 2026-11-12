// @vitest-environment jsdom
/** The settings row renders accepted state and forwards each user gesture. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { SyncRow, type SyncRowProps } from '../src/client/SyncRow.tsx'
import { zh } from '../src/client/locales.ts'

const t: SyncRowProps['t'] = makeTranslate(zh)

type Settings = { enabled: boolean; uploadReasoning: boolean; disabledSessions: string[] }

function useSettings<T>(selector: (value: ConfigFormSnapshot<Settings>) => T): T {
  return selector({ status: 'ready', value: { enabled: true, uploadReasoning: false, disabledSessions: [] }, base: undefined, user: undefined, revision: 1, writable: true })
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
})
