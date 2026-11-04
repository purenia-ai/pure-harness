/** Real HTTP round trips against a stub hub: the plugin talks the wire format, not a stubbed fetch. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as SessionSync from '../src/index.ts'

const contexts: Context[] = []
const servers: Server[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => { server.close(() => { resolve() }) })))
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

interface Received {
  readonly method: string
  readonly url: string
  readonly authorization: string
  readonly body: { runtime?: string; sessionId?: string; messages?: { role?: string; content?: string }[] }
}

/** Stub hub: records every request and answers through `respond`, which may change between calls. */
interface HubReply {
  readonly status: number
  readonly body: string
  readonly location?: string
}

async function startHub(respond: () => HubReply): Promise<{ url: string; received: Received[] }> {
  const received: Received[] = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    request.on('end', () => {
      received.push({
        method: request.method ?? '',
        url: request.url ?? '',
        authorization: request.headers.authorization ?? '',
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Received['body'],
      })
      const answer = respond()
      response.writeHead(answer.status, {
        'content-type': 'application/json',
        ...(answer.location === undefined ? {} : { location: answer.location }),
      })
      response.end(answer.body)
    })
  })
  servers.push(server)
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('stub hub did not bind a TCP port')
  return { url: `http://127.0.0.1:${String(address.port)}`, received }
}

function account(token = 'wire-token') {
  return {
    resolveToken: async (): Promise<string | undefined> => token,
    rejectToken: async (): Promise<void> => undefined,
    getPlatformSession: async (): Promise<{ userId: string }> => ({ userId: '7' }),
  }
}

async function harness(endpoint: string): Promise<{ session: ReturnType<Context['sessions']['create']> }> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  ctx.provide('deepseekAccount', account() as never)
  await ctx.plugin(SessionSync, { endpoint, debounceMs: 100 })
  return { session: ctx.sessions.create(SessionId('wire-session')) }
}

function settle(ms = 350): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

function appendUser(session: ReturnType<Context['sessions']['create']>, text: string): void {
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }), { surfaceOp: 'append' })
}

describe('session sync over HTTP', () => {
  it('posts the archived batch to /api/session-trace/save with the account token', async () => {
    const hub = await startHub(() => ({ status: 200, body: '{"ok":true,"traceId":1,"accepted":1}' }))
    const { session } = await harness(hub.url)
    appendUser(session, 'over the wire')

    await settle()

    expect(hub.received).toHaveLength(1)
    const request = hub.received[0]!
    expect(request.method).toBe('POST')
    expect(request.url).toBe('/api/session-trace/save')
    expect(request.authorization).toBe('Bearer wire-token')
    expect(request.body.runtime).toBe('dsh')
    expect(request.body.sessionId).toBe('wire-session')
    expect(request.body.messages?.map(row => row.content)).toEqual(['over the wire'])
  })

  it('keeps the batch queued when the hub answers with a sign-in redirect', async () => {
    let signedIn = false
    const hub = await startHub(() => signedIn
      ? { status: 200, body: '{"ok":true}' }
      : { status: 302, body: '', location: 'http://127.0.0.1/login' })
    const { session } = await harness(hub.url)
    appendUser(session, 'before sign-in')
    await settle()
    expect(hub.received).toHaveLength(1)
    expect(session.snapshotEvents().filter(event => event.type === 'session-sync-hub/delivery-accepted')).toHaveLength(0)

    signedIn = true
    appendUser(session, 'after sign-in')
    await settle()
    const last = hub.received[hub.received.length - 1]
    expect(hub.received.length).toBeGreaterThanOrEqual(2)
    expect(last?.body.messages?.map(row => row.content)).toEqual(['before sign-in', 'after sign-in'])
  })
})
