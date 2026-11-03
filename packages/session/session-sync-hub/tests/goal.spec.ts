import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as SessionSync from '../src/index.ts'
import type { SyncGoalPayload, SyncPayload } from '../src/types.ts'

const contexts: Context[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

interface Call {
  readonly url: string
  readonly payload: SyncPayload | SyncGoalPayload
  readonly authorization: string
}

function stubFetch(answer: (call: Call) => Response = () => new Response('{"ok":true}', { status: 200 })): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>
    const call = {
      url,
      payload: JSON.parse(init.body as string) as SyncPayload | SyncGoalPayload,
      authorization: headers.authorization ?? '',
    }
    calls.push(call)
    return answer(call)
  }))
  return calls
}

type SyncConfigInput = {
  endpoint?: string
  enabled?: boolean
  uploadGoals?: boolean
  debounceMs?: number
  maxBatchGoals?: number
  disabledSessions?: string[]
}

function createAccount(initial = 'token-1') {
  const account = {
    nextToken: initial as string | null,
    resolveToken: async (): Promise<string | undefined> => account.nextToken ?? undefined,
    rejectToken: async (): Promise<void> => undefined,
    getPlatformSession: async (): Promise<{ userId: string } | null> => ({ userId: '42' }),
  }
  return account
}

async function harness(overrides: SyncConfigInput = {}): Promise<{ session: Session; ctx: Context }> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  ctx.provide('deepseekAccount', createAccount() as never)
  await ctx.plugin(SessionSync, { debounceMs: 100, ...overrides })
  return { session: ctx.sessions.create(SessionId('session-goal-1')), ctx }
}

function settle(ms = 250): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

function appendUser(session: Session, text: string): void {
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }), { surfaceOp: 'append' })
}

/**
 * Append a durable goal change.
 *
 * <p>The goal package augments `SessionEventMap`, but it is not part of this package's program, so the
 * typed `append` rejects the key here. The canonical log accepts the event unchanged.</p>
 */
function appendGoalChange(session: Session, data: Record<string, unknown>): void {
  const appender = session as unknown as { append(type: string, data: Record<string, unknown>): unknown }
  appender.append('goal/change', data)
}

function snapshot(operation = 'create', revision = 1, phase = 'active'): Record<string, unknown> {
  return {
    kind: 'goal/change',
    version: 1,
    operation,
    goal: {
      id: 'goal-1',
      revision,
      objective: '把 goal 持久化到 hub',
      phase,
      maxGoalRounds: 256,
    },
    roundsStarted: 1,
    createdAt: Date.parse('2026-11-03T06:00:00.000Z'),
    updatedAt: Date.parse('2026-11-03T06:05:00.000Z'),
  }
}

function goalCalls(calls: readonly Call[]): SyncGoalPayload[] {
  return calls
    .filter(call => call.url.endsWith('/api/session-goal/save'))
    .map(call => call.payload as SyncGoalPayload)
}

describe('goal snapshots to the hub goal archive', () => {
  it('uploads a goal change with the snapshot fields the hub mirrors', async () => {
    const calls = stubFetch()
    const { session } = await harness()
    appendGoalChange(session, snapshot())

    await settle()

    const payloads = goalCalls(calls)
    expect(payloads).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://hub.puresnake.com/api/session-goal/save')
    expect(calls[0]?.authorization).toBe('Bearer token-1')
    const payload = payloads[0]!
    expect(payload.runtime).toBe('dsh')
    expect(payload.sessionId).toBe('session-goal-1')
    expect(payload.goals).toHaveLength(1)
    expect(payload.goals[0]).toMatchObject({
      goalId: 'goal-1',
      revision: 1,
      operation: 'create',
      phase: 'active',
      objective: '把 goal 持久化到 hub',
      maxGoalRounds: 256,
      roundsStarted: 1,
      ownerId: '42',
      goalCreatedAt: '2026-11-03T06:00:00.000Z',
      goalUpdatedAt: '2026-11-03T06:05:00.000Z',
    })
  })

  it('carries a block reason and a clear tombstone', async () => {
    const calls = stubFetch()
    const { session } = await harness()
    appendGoalChange(session, {
      ...snapshot('block', 2, 'blocked'),
      goal: {
        id: 'goal-1',
        revision: 2,
        objective: '把 goal 持久化到 hub',
        phase: 'blocked',
        maxGoalRounds: 256,
        blockedReason: { code: 'round-limit', message: '轮次用尽' },
      },
    })
    await settle()
    expect(goalCalls(calls)[0]?.goals[0]?.blockedReason).toEqual({ code: 'round-limit', message: '轮次用尽' })

    appendGoalChange(session, {
      kind: 'goal/change',
      version: 1,
      operation: 'clear',
      cleared: { id: 'goal-1', revision: 3 },
      clearedAt: Date.parse('2026-11-03T06:10:00.000Z'),
    })
    await settle()

    const cleared = goalCalls(calls).at(-1)?.goals[0]
    expect(cleared).toMatchObject({ goalId: 'goal-1', revision: 3, operation: 'clear', cleared: true })
  })

  it('holds snapshots while the hub has no goal archive and sends them together later', async () => {
    let deployed = false
    const calls = stubFetch(call => call.url.endsWith('/api/session-goal/save') && !deployed
      ? new Response('{"ok":false}', { status: 404 })
      : new Response('{"ok":true}', { status: 200 }))
    const { session } = await harness()
    appendGoalChange(session, snapshot())
    await settle()
    expect(goalCalls(calls)).toHaveLength(1)

    deployed = true
    appendGoalChange(session, snapshot('pause', 2, 'paused'))
    await settle()

    const last = goalCalls(calls).at(-1)
    expect(last?.goals.map(goal => goal.revision)).toEqual([1, 2])
    expect(last?.goals.map(goal => goal.operation)).toEqual(['create', 'pause'])
  })

  it('keeps the session archive independent from a failing goal archive', async () => {
    const calls = stubFetch(call => call.url.endsWith('/api/session-goal/save')
      ? new Response('{"ok":false}', { status: 500 })
      : new Response('{"ok":true}', { status: 200 }))
    const { session } = await harness()
    appendGoalChange(session, snapshot())
    appendUser(session, 'hello')

    await settle(400)

    expect(calls.filter(call => call.url.endsWith('/api/session-trace/save'))).toHaveLength(1)
    const trace = calls.find(call => call.url.endsWith('/api/session-trace/save'))
    expect((trace?.payload as SyncPayload).messages.map(row => row.content)).toEqual(['hello'])
  })

  it('leaves goal snapshots local when their switch is off', async () => {
    const calls = stubFetch()
    const { session } = await harness({ uploadGoals: false })
    appendGoalChange(session, snapshot())
    appendUser(session, 'hello')

    await settle()

    expect(goalCalls(calls)).toHaveLength(0)
    expect(calls.filter(call => call.url.endsWith('/api/session-trace/save'))).toHaveLength(1)
  })

  it('splits snapshots into requests of at most maxBatchGoals', async () => {
    const calls = stubFetch()
    const { session } = await harness({ maxBatchGoals: 2 })
    appendGoalChange(session, snapshot())
    appendGoalChange(session, snapshot('edit', 2))
    appendGoalChange(session, snapshot('pause', 3, 'paused'))

    await settle(400)

    const batches = goalCalls(calls)
    expect(batches.flatMap(payload => payload.goals.map(goal => goal.revision))).toEqual([1, 2, 3])
    expect(batches.every(payload => payload.goals.length <= 2)).toBe(true)
  })
})
