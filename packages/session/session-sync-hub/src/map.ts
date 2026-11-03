/** Translate canonical Session events into hub session-trace message rows. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SyncGoal, SyncMessage } from './types.ts'

/** Options that decide which optional content the archive keeps. */
export interface MapOptions {
  /** Include assistant reasoning as a `【思考】` section. */
  uploadReasoning: boolean
  /** Include system and developer prompts. */
  uploadSystemMessages: boolean
  /** Truncate one tool result beyond this many characters. */
  toolResultCap: number
}

/** Structural view of one message content block; unknown kinds contribute no text. */
interface ContentLike {
  readonly type?: string
  readonly text?: string
  readonly content?: readonly ContentLike[]
}

function blocksOf(value: readonly ContentLike[] | undefined): readonly ContentLike[] {
  return value ?? []
}

/** Join the text of `text` blocks, descending into nested tool-result content. */
function textOf(blocks: readonly ContentLike[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    else if (block.type === 'tool-result') parts.push(textOf(blocksOf(block.content)))
  }
  return parts.filter(part => part.length > 0).join('\n')
}

/** Join reasoning blocks; kept out of the model-facing text by the hub marker. */
function reasoningOf(blocks: readonly ContentLike[]): string {
  return blocks
    .filter(block => block.type === 'reasoning' && typeof block.text === 'string')
    .map(block => block.text ?? '')
    .join('\n')
}

function timestampOf(event: SessionEvent): string {
  return new Date(event.time).toISOString()
}

/**
 * Map one canonical event to one archive row.
 * @param event - canonical Session event.
 * @param options - optional content selection.
 * @returns the row, or undefined for events that carry no archived message.
 */
export function mapEvent(event: SessionEvent, options: MapOptions): SyncMessage | undefined {
  switch (event.type) {
    case 'user/message':
      return { seq: Number(event.seq), role: 'user', content: textOf(blocksOf(event.data.content)), timestamp: timestampOf(event) }
    case 'assistant/message': {
      const blocks = blocksOf(event.data.message.content)
      const text = textOf(blocks)
      const reasoning = options.uploadReasoning ? reasoningOf(blocks) : ''
      const content = reasoning.length === 0
        ? text
        : (text.length === 0 ? `【思考】\n${reasoning}` : `${text}\n\n【思考】\n${reasoning}`)
      return { seq: Number(event.seq), role: 'assistant', content, timestamp: timestampOf(event) }
    }
    case 'system/message':
    case 'developer/message': {
      if (!options.uploadSystemMessages) return undefined
      const role = event.type === 'system/message' ? 'system' : 'developer'
      return { seq: Number(event.seq), role, content: textOf(blocksOf(event.data.message.content)), timestamp: timestampOf(event) }
    }
    case 'tool/call':
      return { seq: Number(event.seq), role: 'tool', toolName: event.data.name, toolInput: event.data.arguments, timestamp: timestampOf(event) }
    case 'tool/result': {
      const text = textOf(blocksOf(event.data.message.content))
      const truncated = text.length > options.toolResultCap
      const content = truncated ? text.slice(0, options.toolResultCap) : text
      return {
        seq: Number(event.seq),
        role: 'tool',
        toolResult: content,
        toolResultTruncated: truncated,
        ...(truncated ? { toolResultOriginalLength: text.length } : {}),
        timestamp: timestampOf(event),
      }
    }
    default:
      return undefined
  }
}

/** Structural view of one durable `goal/change` payload; unknown shapes map to nothing. */
interface GoalChangeLike {
  readonly operation?: unknown
  readonly goal?: {
    readonly id?: unknown
    readonly revision?: unknown
    readonly objective?: unknown
    readonly phase?: unknown
    readonly maxGoalRounds?: unknown
    readonly blockedReason?: { readonly code?: unknown; readonly message?: unknown }
  }
  readonly roundsStarted?: unknown
  readonly createdAt?: unknown
  readonly updatedAt?: unknown
  readonly cleared?: { readonly id?: unknown; readonly revision?: unknown }
}

/** Durable goal phases the hub accepts. */
const GOAL_PHASES: ReadonlySet<string> = new Set(['active', 'paused', 'blocked', 'complete'])
/** Durable goal operations; anything else is never sent, so the hub cannot reject it forever. */
const GOAL_OPERATIONS: ReadonlySet<string> = new Set([
  'create', 'edit', 'pause', 'resume', 'complete', 'block', 'clear',
])

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : undefined
}

function isoOf(value: unknown): string | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? new Date(value).toISOString() : undefined
}

function blockedOf(goal: GoalChangeLike['goal']): { code: string; message: string } | undefined {
  const reason = goal?.blockedReason
  if (typeof reason?.code !== 'string' || typeof reason.message !== 'string') return undefined
  return { code: reason.code, message: reason.message }
}

/**
 * Map one `goal/change` event to a hub goal snapshot.
 * @param event - canonical Session event.
 * @returns the snapshot, or undefined when the event is not a well-formed goal change.
 */
export function mapGoalChange(event: SessionEvent): SyncGoal | undefined {
  const candidate = event as { type: string; data?: GoalChangeLike }
  if (candidate.type !== 'goal/change') return undefined
  const data = candidate.data
  const operation = typeof data?.operation === 'string' && GOAL_OPERATIONS.has(data.operation)
    ? data.operation
    : undefined
  if (operation === undefined) return undefined

  if (operation === 'clear') {
    const goalId = typeof data?.cleared?.id === 'string' ? data.cleared.id : undefined
    const revision = positiveInteger(data?.cleared?.revision)
    if (goalId === undefined || revision === undefined) return undefined
    return { goalId, revision, operation, cleared: true }
  }

  const goal = data?.goal
  const goalId = typeof goal?.id === 'string' ? goal.id : undefined
  const revision = positiveInteger(goal?.revision)
  const objective = typeof goal?.objective === 'string' ? goal.objective : undefined
  const phase = typeof goal?.phase === 'string' && GOAL_PHASES.has(goal.phase) ? goal.phase : undefined
  const maxGoalRounds = positiveInteger(goal?.maxGoalRounds)
  if (goalId === undefined || revision === undefined || objective === undefined
    || phase === undefined || maxGoalRounds === undefined) return undefined

  const rounds = data?.roundsStarted
  const roundsStarted = typeof rounds === 'number' && Number.isSafeInteger(rounds) && rounds >= 0 ? rounds : 0
  const blocked = blockedOf(goal)
  const createdAt = isoOf(data?.createdAt)
  const updatedAt = isoOf(data?.updatedAt)
  return {
    goalId,
    revision,
    operation,
    phase,
    objective,
    maxGoalRounds,
    roundsStarted,
    ...(blocked === undefined ? {} : { blockedReason: blocked }),
    ...(createdAt === undefined ? {} : { goalCreatedAt: createdAt }),
    ...(updatedAt === undefined ? {} : { goalUpdatedAt: updatedAt }),
  }
}
