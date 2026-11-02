/** Wire fields accepted by the hub session-trace save endpoint, and the local acceptance event. */

import type {} from '@deepseek-ai/dsh-session/types'

/** One archived message row; `seq` is the canonical Session event sequence it came from. */
export interface SyncMessage {
  seq: number
  role: 'user' | 'assistant' | 'system' | 'developer' | 'tool'
  content?: string
  toolName?: string
  toolInput?: string
  toolResult?: string
  toolResultTruncated?: boolean
  toolResultOriginalLength?: number
  timestamp?: string
}

/** Session-level facts a file-parsing runtime has no source for. */
export interface SyncMeta {
  ownerId?: string
  startedAt?: string
  endedAt?: string
  lastEventAt?: string
  formatVersion?: number
  parentSessionId?: string
  agentPreset?: string
  headerJson?: string
}

/** One save request: a contiguous batch of message rows plus optional session facts. */
export interface SyncPayload {
  runtime: 'dsh'
  sessionId: string
  projectDir?: string
  title?: string
  model?: string
  finalBatch?: boolean
  messageTotal?: number
  messages: SyncMessage[]
  meta?: SyncMeta
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Records that the hub accepted one delivery through `throughSeq`. */
    'session-sync-hub/delivery-accepted': {
      /** Session identity the accepted delivery carried. */
      sessionId: import('@deepseek-ai/dsh-session/types').SessionId
      /** Accepted Session format generation. */
      sessionFormatVersion?: number
      /** Last canonical event included in the accepted request. */
      throughSeq: import('@deepseek-ai/dsh-session/types').SessionSeq
    }
  }
}
