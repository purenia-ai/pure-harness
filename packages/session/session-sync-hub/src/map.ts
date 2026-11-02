/** Translate canonical Session events into hub session-trace message rows. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SyncMessage } from './types.ts'

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
