/**
 * Incremental session upload to the hub session-trace endpoint.
 *
 * <p>Every live Session event that carries an archived message enters a per-session queue. A debounce
 * window bounds request rate; the canonical log's acceptance markers bound re-sending. Nothing here
 * blocks the conversation: uploads run beside the loop, and failures only postpone the next attempt.</p>
 * @module @deepseek-ai/dsh-session-sync-hub
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { SessionSeq, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import { splitBatches } from './batch.ts'
import { mapEvent } from './map.ts'
import type { SyncMeta, SyncMessage, SyncPayload } from './types.ts'

export type * from './types.ts'

/** Cordis plugin name. */
export const name = 'session-sync-hub'
/** The Session service is the only required dependency. */
export const inject = ['sessions']

/** Hub session-trace upload configuration. */
export interface Config {
  /** Hub origin; the endpoint path is appended and the origin also scopes the account token. */
  endpoint: string
  /** Global enablement, live-editable from the settings form. */
  enabled: Volatile<boolean>
  /** Archive assistant reasoning as a `【思考】` section. */
  uploadReasoning: Volatile<boolean>
  /** Archive system and developer prompts. */
  uploadSystemMessages: Volatile<boolean>
  /** Truncate one archived tool result beyond this many characters. */
  toolResultCap: number
  /** Quiet window after the last event before a session's queue drains. */
  debounceMs: number
  /** Largest row count in one save request. */
  maxBatchMessages: number
  /** Largest serialized `messages` array in one save request. */
  maxBatchBytes: number
  /** Sessions whose queues may drain at the same time. */
  maxConcurrentSessions: number
  /** Session ids the user muted; live-editable from the settings form. */
  disabledSessions: Volatile<string[]>
}

/** Validated configuration. */
export const Config = z.object({
  endpoint: z.string().default('https://hub.puresnake.com'),
  enabled: z.boolean().default(true).volatile(),
  uploadReasoning: z.boolean().default(true).volatile(),
  uploadSystemMessages: z.boolean().default(true).volatile(),
  toolResultCap: z.number().step(1).min(1).default(8000),
  debounceMs: z.number().step(1).min(100).max(600_000).default(5_000),
  maxBatchMessages: z.number().step(1).min(1).default(200),
  maxBatchBytes: z.number().step(1).min(1024).default(2 * 1024 * 1024),
  maxConcurrentSessions: z.number().step(1).min(1).max(32).default(2),
  disabledSessions: z.array(z.string()).default([]).volatile(),
})

/** Event types that archive one row each. */
const ARCHIVED_EVENT_TYPES: ReadonlySet<string> = new Set([
  'user/message',
  'assistant/message',
  'system/message',
  'developer/message',
  'tool/call',
  'tool/result',
])

/** First retry delay; later attempts double up to {@link RETRY_MAX_MS}. */
const RETRY_BASE_MS = 1_000
const RETRY_MAX_MS = 60_000
/** Stop buffering when one session's backlog reaches this many events. */
const MAX_QUEUED_EVENTS = 5_000
/** Acceptance markers already seen beyond the scanned prefix, per Session instance. */
const scanned = new WeakMap<Session, { events: number; throughSeq: number }>()

/** Account-token surface this plugin reads; the signed-in OIDC account provides it. */
interface AccountLike {
  resolveToken(url: string): Promise<string | undefined>
  rejectToken(token: string): Promise<void>
  getPlatformSession(): Promise<{ userId?: string | null } | null>
}

interface Queue {
  readonly session: Session
  readonly events: SessionEvent[]
  chain: Promise<void>
  timer: ReturnType<typeof setTimeout> | undefined
  attempts: number
  uploadedMessages: number
  title: string | undefined
  model: string | undefined
  stopped: boolean
  disposed: boolean
}

/**
 * Fold the highest hub-accepted sequence recorded in this Session's own log.
 * @param session - Session whose acceptance markers are folded.
 * @returns highest accepted sequence, or -1 before the first acceptance.
 */
export function acceptedThrough(session: Session): number {
  const previous = scanned.get(session)
  let throughSeq = previous?.throughSeq ?? -1
  const start = previous?.events ?? 0
  const length = session.seq
  for (let index = start; index < length; index++) {
    const event = session.eventAt(SessionSeq(index))
    if (event === undefined) continue
    if (event.type !== 'session-sync-hub/delivery-accepted') continue
    if (event.data.sessionId !== session.id) continue
    const accepted = Number(event.data.throughSeq)
    if (Number.isSafeInteger(accepted) && accepted > throughSeq) throughSeq = accepted
  }
  scanned.set(session, { events: length, throughSeq })
  return throughSeq
}

/** Read a log-only `session/title` snapshot without importing the title plugin's event augmentation. */
function titleOf(event: SessionEvent): string | undefined {
  const candidate = event as { type: string; data?: { title?: unknown } }
  return candidate.type === 'session/title' && typeof candidate.data?.title === 'string'
    ? candidate.data.title
    : undefined
}

function appendAccepted(session: Session, throughSeq: number): void {
  try {
    session.append('session-sync-hub/delivery-accepted', {
      sessionId: session.id,
      sessionFormatVersion: session.header.version,
      throughSeq: throughSeq as SessionSeq,
    })
  } catch {
    // A disposed Session rejects appends; the acceptance already happened remotely, so the
    // watermark stays in memory and a restarted process re-sends the tail harmlessly.
  }
}

function lastSeq(events: readonly SessionEvent[]): number {
  return events.length === 0 ? -1 : Number(events[events.length - 1]?.seq ?? -1)
}

/**
 * Register the upload pipeline.
 * @param ctx - plugin context carrying the Session service.
 * @param config - validated configuration; volatile fields are read per attempt.
 */
export function apply(ctx: Context, config: Config): void {
  const queues = new Map<string, Queue>()

  const queueOf = (session: Session): Queue => {
    const key = String(session.id)
    const existing = queues.get(key)
    if (existing !== undefined) return existing
    const created: Queue = {
      session, events: [], chain: Promise.resolve(), attempts: 0, uploadedMessages: 0,
      title: undefined, model: undefined, stopped: false, disposed: false, timer: undefined,
    }
    queues.set(key, created)
    return created
  }

  const muted = (session: Session): boolean => config.disabledSessions.get().includes(String(session.id))
  const active = (session: Session): boolean => config.enabled.get() && !muted(session)

  const account = (): AccountLike | undefined => ctx.get('deepseekAccount') as AccountLike | undefined

  const post = async (payload: SyncPayload, token: string): Promise<void> => {
    const url = `${config.endpoint.replace(/\/+$/u, '')}/api/session-trace/save`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
      // The hub protects this endpoint with its sign-in filter; an unauthenticated call answers with a
      // redirect to the login page. Following it would turn an HTML page into a false acknowledgement.
      redirect: 'manual',
    })
    if (response.status >= 300 && response.status < 400) {
      throw new Error(`session sync was redirected to sign in (HTTP ${String(response.status)})`)
    }
    if (response.status === 401) {
      // The token may have expired or been revoked; drop it so the next attempt refreshes.
      await account()?.rejectToken(token).catch(() => undefined)
      throw new Error('session sync rejected the account token (401)')
    }
    if (response.status === 404) {
      const failure = new Error('session sync endpoint not found (404); check the configured hub origin')
      ;(failure as Error & { permanent?: boolean }).permanent = true
      throw failure
    }
    if (!response.ok) throw new Error(`session sync failed: HTTP ${String(response.status)}`)
    const result = await response.json().catch(() => undefined) as { ok?: boolean } | undefined
    if (result?.ok !== true) throw new Error('session sync: the hub did not acknowledge the batch')
  }

  const metaOf = async (session: Session, events: readonly SessionEvent[]): Promise<SyncMeta> => {
    let ownerId: string | undefined
    try {
      const platform = await account()?.getPlatformSession()
      ownerId = platform?.userId ?? undefined
    } catch (error) {
      // Identity enrichment never blocks the archive.
      void error
    }
    const header = session.header
    return {
      ...(ownerId === undefined ? {} : { ownerId }),
      startedAt: new Date(header.createdAt).toISOString(),
      lastEventAt: new Date(events[events.length - 1]?.time ?? header.createdAt).toISOString(),
      formatVersion: header.version,
      ...(header.parentSession === undefined ? {} : { parentSessionId: String(header.parentSession) }),
      ...(header.agentPreset === undefined ? {} : { agentPreset: header.agentPreset }),
      headerJson: JSON.stringify(header),
    }
  }

  const waiting: (() => void)[] = []
  let activeUploads = 0
  const uploadLimit = (): number => Math.max(1, config.maxConcurrentSessions)
  const acquireUpload = async (): Promise<void> => {
    while (activeUploads >= uploadLimit()) await new Promise<void>((resolve) => { waiting.push(resolve) })
    activeUploads++
  }
  const releaseUpload = (): void => {
    activeUploads = Math.max(0, activeUploads - 1)
    waiting.shift()?.()
  }

  const maintain = (state: Queue, final: boolean): void => {
    state.chain = state.chain.then(async () => {
      const session = state.session
      if (state.stopped && !final) return
      const pending = state.events.splice(0)
      if (pending.length === 0) return
      if (!active(session)) {
        // Keep the backlog for a later unmute, bounded so a long mute cannot grow without limit.
        state.events.unshift(...pending.slice(-MAX_QUEUED_EVENTS))
        if (state.events.length >= MAX_QUEUED_EVENTS) ctx.logger.warn(`session-sync-hub: ${String(session.id)} backlog dropped at ${String(MAX_QUEUED_EVENTS)} events`)
        return
      }
      const options = {
        uploadReasoning: config.uploadReasoning.get(),
        uploadSystemMessages: config.uploadSystemMessages.get(),
        toolResultCap: config.toolResultCap,
      }
      const rows: { message: SyncMessage; seq: number }[] = []
      for (const event of pending) {
        const message = mapEvent(event, options)
        if (message !== undefined) rows.push({ message, seq: Number(event.seq) })
      }
      const tailSeq = Math.max(lastSeq(pending), acceptedThrough(session))
      if (rows.length === 0) {
        appendAccepted(session, tailSeq)
        return
      }
      const token = await account()?.resolveToken(config.endpoint)
      if (token === undefined) {
        // No signed-in account for the hub origin: keep the backlog; the next event retries.
        state.events.unshift(...pending)
        return
      }
      const meta = await metaOf(session, pending)
      const base: Omit<SyncPayload, 'messages'> = {
        runtime: 'dsh',
        sessionId: String(session.id),
        ...(session.header.cwd === undefined ? {} : { projectDir: session.header.cwd }),
        ...(state.title === undefined ? {} : { title: state.title }),
        ...(state.model === undefined ? {} : { model: state.model }),
        meta,
      }
      let sent = 0
      /** Last sequence this attempt recorded; a trailing marker is only needed past it. */
      let recordedSeq = -1
      await acquireUpload()
      try {
        for (const batch of splitBatches(rows.map(row => row.message), config.maxBatchMessages, config.maxBatchBytes)) {
          const batchSeqs = rows.slice(sent, sent + batch.length)
          const last = batchSeqs[batchSeqs.length - 1]
          const isFinal = final && sent + batch.length >= rows.length
          const payload: SyncPayload = {
            ...base,
            messages: batch,
            ...(isFinal ? { finalBatch: true, messageTotal: state.uploadedMessages + batch.length } : {}),
          }
          await post(payload, token)
          state.uploadedMessages += batch.length
          sent += batch.length
          if (last !== undefined) {
            appendAccepted(session, last.seq)
            recordedSeq = Number(last.seq)
          }
          state.attempts = 0
        }
        // Trailing events that map to no row advance the watermark past the last batch.
        if (tailSeq > recordedSeq) appendAccepted(session, tailSeq)
      } catch (error) {
        // Restore the unsent part of this attempt so the next window retries it.
        state.events.unshift(...pending)
        const permanent = (error as { permanent?: boolean }).permanent === true
        if (permanent) {
          state.stopped = true
          ctx.logger.error(`session-sync-hub: ${String(session.id)} stopped: ${error instanceof Error ? error.message : String(error)}`)
          return
        }
        state.attempts++
        const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(state.attempts, 6))
        ctx.logger.warn(`session-sync-hub: ${String(session.id)} retry ${String(state.attempts)} in ${String(delay)}ms: ${error instanceof Error ? error.message : String(error)}`)
        state.timer = setTimeout(() => { state.timer = undefined; maintain(state, false) }, delay)
      } finally {
        releaseUpload()
      }
    }).catch((error: unknown) => {
      ctx.logger.error(`session-sync-hub: unexpected failure ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  const schedule = (state: Queue): void => {
    if (state.stopped || state.disposed) return
    if (state.timer !== undefined) clearTimeout(state.timer)
    state.timer = setTimeout(() => {
      state.timer = undefined
      maintain(state, false)
    }, config.debounceMs)
  }

  ctx.on('session/event', (session, event) => {
    const state = queueOf(session)
    const title = titleOf(event)
    if (title !== undefined) {
      state.title = title
      return
    }
    if (event.type === 'assistant/message') {
      const model = (event.data.message as { source?: { model?: string } }).source?.model
      if (typeof model === 'string' && model.length > 0) state.model = model
    }
    if (!ARCHIVED_EVENT_TYPES.has(event.type)) return
    state.events.push(event)
    if (state.events.length >= MAX_QUEUED_EVENTS) {
      state.events.splice(0, state.events.length - MAX_QUEUED_EVENTS)
      ctx.logger.warn(`session-sync-hub: ${String(session.id)} backlog trimmed to ${String(MAX_QUEUED_EVENTS)} events`)
    }
    if (state.events.length >= config.maxBatchMessages) maintain(state, false)
    else schedule(state)
  })

  ctx.on('session/disposed', (session) => {
    const key = String(session.id)
    const state = queues.get(key)
    if (state === undefined) return
    state.disposed = true
    if (state.timer !== undefined) clearTimeout(state.timer)
    state.timer = undefined
    maintain(state, true)
    void state.chain.then(() => { queues.delete(key) })
  })
}
