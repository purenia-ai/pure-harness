import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import * as SessionSync from '../src/index.ts'
import type { SyncPayload } from '../src/types.ts'

const contexts: Context[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

interface Call {
  readonly url: string
  readonly payload: SyncPayload
  readonly authorization: string
}

function stubFetch(answer: (call: Call) => Response = () => new Response('{"ok":true}', { status: 200 })): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>
    const call = { url, payload: JSON.parse(String(init.body)) as SyncPayload, authorization: headers.authorization ?? '' }
    calls.push(call)
    return answer(call)
  }))
  return calls
}

type SyncConfigInput = {
  endpoint?: string
  enabled?: boolean
  uploadReasoning?: boolean
  uploadSystemMessages?: boolean
  toolResultCap?: number
  debounceMs?: number
  maxBatchMessages?: number
  maxBatchBytes?: number
  maxConcurrentSessions?: number
  disabledSessions?: string[]
}

/** Signed-in account stand-in: a token the plugin may resolve, reject and refresh. */
function createAccount(initial: string | null = 'token-1') {
  const account = {
    nextToken: initial,
    rejected: [] as string[],
    resolveToken: async (): Promise<string | undefined> => account.nextToken ?? undefined,
    rejectToken: async (token: string): Promise<void> => { account.rejected.push(token) },
    getPlatformSession: async (): Promise<{ userId: string } | null> => ({ userId: '42' }),
  }
  return account
}

async function harness(
  overrides: SyncConfigInput = {},
  account = createAccount(),
): Promise<{ session: ReturnType<Context['sessions']['create']>; account: ReturnType<typeof createAccount>; ctx: Context }> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  ctx.provide('deepseekAccount', account as never)
  await ctx.plugin(SessionSync, { debounceMs: 100, ...overrides })
  return { session: ctx.sessions.create(SessionId('session-sync-1')), account, ctx }
}

function settle(ms = 250): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

function appendUser(session: ReturnType<Context['sessions']['create']>, text: string): void {
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }), { surfaceOp: 'append' })
}

function appendAssistant(session: ReturnType<Context['sessions']['create']>, text: string, reasoning?: string): void {
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createAssistantMessage({
      content: [
        { type: 'text', text },
        ...(reasoning === undefined ? [] : [{ type: 'reasoning' as const, text: reasoning }]),
      ] as never,
      source: { provider: 'test', model: 'test-model' },
    }),
    stream: [],
  }, { surfaceOp: 'append' })
}

describe('session sync to the hub session-trace endpoint', () => {
  it('uploads archived rows with the signed-in account token', async () => {
    const calls = stubFetch()
    const { session } = await harness()
    appendUser(session, 'hello')
    appendAssistant(session, 'hi', 'because')

    await settle()

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://hub.puresnake.com/api/session-trace/save')
    expect(calls[0]?.authorization).toBe('Bearer token-1')
    const payload = calls[0]?.payload
    expect(payload?.runtime).toBe('dsh')
    expect(payload?.sessionId).toBe('session-sync-1')
    expect(payload?.messages.map(row => row.role)).toEqual(['user', 'assistant'])
    expect(payload?.messages[0]?.content).toBe('hello')
    expect(payload?.messages[1]?.content).toContain('【思考】\nbecause')
    expect(payload?.meta?.ownerId).toBe('42')
    expect(payload?.meta?.formatVersion).toBe(session.header.version)
    expect(payload?.meta?.startedAt).toBe(new Date(session.header.createdAt).toISOString())
    const markers = session.snapshotEvents().filter(event => event.type === 'session-sync-hub/delivery-accepted')
    expect(markers.map(event => event.data.throughSeq)).toEqual([1])
  })

  it('keeps rows local while signed out and uploads them after sign-in', async () => {
    const calls = stubFetch()
    const { session, account } = await harness({}, createAccount(null))
    appendUser(session, 'before sign-in')
    await settle()
    expect(calls).toHaveLength(0)

    account.nextToken = 'token-2'
    appendUser(session, 'after sign-in')
    await settle()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.authorization).toBe('Bearer token-2')
    expect(calls[0]?.payload.messages.map(row => row.content)).toEqual(['before sign-in', 'after sign-in'])
  })

  it('keeps rows local while the global switch is off', async () => {
    const calls = stubFetch()
    const { session } = await harness({ enabled: false })
    appendUser(session, 'hello')
    await settle()
    expect(calls).toHaveLength(0)
  })

  it('keeps rows local for a muted session', async () => {
    const calls = stubFetch()
    const { session } = await harness({ disabledSessions: ['session-sync-1'] })
    appendUser(session, 'hello')
    await settle()
    expect(calls).toHaveLength(0)
  })

  it('omits reasoning when its switch is off', async () => {
    const calls = stubFetch()
    const { session } = await harness({ uploadReasoning: false })
    appendAssistant(session, 'answer', 'private thought')
    await settle()
    expect(calls[0]?.payload.messages[0]?.content).toBe('answer')
  })

  it('truncates an oversized tool result and records its original length', async () => {
    const calls = stubFetch()
    const { session } = await harness({ toolResultCap: 10 })
    session.append('tool/result', {
      turn: 1,
      step: 1,
      message: createToolResultMessage({ callId: 'call-1' as never, content: [{ type: 'text', text: 'x'.repeat(50) }], isError: false }),
    }, { surfaceOp: 'append' })
    await settle()
    const row = calls[0]?.payload.messages[0]
    expect(row?.role).toBe('tool')
    expect(row?.toolResult).toBe('x'.repeat(10))
    expect(row?.toolResultTruncated).toBe(true)
    expect(row?.toolResultOriginalLength).toBe(50)
  })

  it('resends only the unaccepted tail after an acceptance marker', async () => {
    const calls = stubFetch()
    const { session } = await harness()
    appendUser(session, 'first')
    await settle()
    appendUser(session, 'second')
    await settle()
    expect(calls).toHaveLength(2)
    expect(calls[0]?.payload.messages).toHaveLength(1)
    expect(calls[1]?.payload.messages).toHaveLength(1)
    expect(calls[1]?.payload.messages[0]?.content).toBe('second')
  })

  it('rejects the token and retries with a refreshed one after a 401', async () => {
    const account = createAccount()
    let first = true
    const calls = stubFetch(() => {
      if (first) {
        first = false
        account.nextToken = 'token-2'
        return new Response('{"ok":false}', { status: 401 })
      }
      return new Response('{"ok":true}', { status: 200 })
    })
    const { session } = await harness({}, account)
    appendUser(session, 'hello')

    await settle(2_600)

    expect(calls).toHaveLength(2)
    expect(account.rejected).toEqual(['token-1'])
    expect(calls[0]?.authorization).toBe('Bearer token-1')
    expect(calls[1]?.authorization).toBe('Bearer token-2')
  })

  it('does not treat a sign-in redirect as an acknowledgement', async () => {
    let first = true
    const calls = stubFetch(() => {
      if (first) {
        first = false
        return new Response('', { status: 302, headers: { location: 'https://hub.puresnake.com/login' } })
      }
      return new Response('{"ok":true}', { status: 200 })
    })
    const { session } = await harness()
    appendUser(session, 'first')
    await settle()
    expect(calls).toHaveLength(1)
    expect(session.snapshotEvents().filter(event => event.type === 'session-sync-hub/delivery-accepted')).toHaveLength(0)

    appendUser(session, 'second')
    await settle(600)
    const last = calls[calls.length - 1]
    expect(calls.length).toBeGreaterThanOrEqual(2)
    expect(last?.payload.messages.map(row => row.content)).toEqual(['first', 'second'])
    expect(session.snapshotEvents().filter(event => event.type === 'session-sync-hub/delivery-accepted')).not.toHaveLength(0)
  })
  it('drains at most the configured number of sessions at once', async () => {
    let inFlight = 0
    let peak = 0
    const gates: (() => void)[] = []
    vi.stubGlobal('fetch', vi.fn(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise<void>(resolve => gates.push(resolve))
      inFlight--
      return new Response('{"ok":true}', { status: 200 })
    }))
    const { session, ctx } = await harness({ maxConcurrentSessions: 1 })
    const second = ctx.sessions.create(SessionId('session-sync-2'))
    appendUser(session, 'first session')
    appendUser(second, 'second session')

    await settle(300)
    expect(inFlight).toBe(1)
    gates.shift()?.()
    await settle(300)
    expect(inFlight).toBe(1)
    gates.shift()?.()
    await settle(300)
    expect(inFlight).toBe(0)
    expect(peak).toBe(1)
  })
  it('stops a session when the endpoint is missing', async () => {
    const calls = stubFetch(() => new Response('{"ok":false}', { status: 404 }))
    const { session } = await harness()
    appendUser(session, 'first')
    await settle()
    appendUser(session, 'second')
    await settle()
    expect(calls).toHaveLength(1)
  })
})
