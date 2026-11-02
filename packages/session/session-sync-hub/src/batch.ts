/** Split archived rows into save requests bounded by count and serialized bytes. */

import { Buffer } from 'node:buffer'
import type { SyncMessage } from './types.ts'

/** UTF-8 bytes of one row inside the request array, including its separator. */
function rowBytes(message: SyncMessage): number {
  return Buffer.byteLength(JSON.stringify(message)) + 1
}

/**
 * Split rows into request-sized batches.
 * @param messages - rows in canonical sequence order.
 * @param maxMessages - largest row count per batch.
 * @param maxBytes - largest serialized `messages` array per batch.
 * @returns contiguous batches; a single oversized row travels alone so the endpoint can reject it visibly.
 */
export function splitBatches(
  messages: readonly SyncMessage[],
  maxMessages: number,
  maxBytes: number,
): SyncMessage[][] {
  const batches: SyncMessage[][] = []
  let current: SyncMessage[] = []
  // `[]` framing bytes.
  let bytes = 2
  for (const message of messages) {
    const size = rowBytes(message)
    if (current.length > 0 && (current.length >= maxMessages || bytes + size > maxBytes)) {
      batches.push(current)
      current = []
      bytes = 2
    }
    current.push(message)
    bytes += size
  }
  if (current.length > 0) batches.push(current)
  return batches
}
