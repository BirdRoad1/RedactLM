import { ApiError, apiFetch } from './client'
import type { ChatMessage, FlaggedDetection, PartialCheck } from './types'

export type PartialNotice = PartialCheck & { messageIndex: number; source?: { filename: string } }

// The proxy refused the request because something reached the block threshold
export class BlockedError extends Error {
  readonly detections: FlaggedDetection[]

  constructor(message: string, detections: FlaggedDetection[]) {
    super(message)
    this.detections = detections
  }
}

type ChatOptions = {
  conversationId?: string // continue this conversation; omit to start a new one
  onConversationId?: (id: string) => void // as soon as the server says which conversation it is
  model: string
  messages: ChatMessage[]
  signal?: AbortSignal
  onDelta: (text: string) => void // called with each streamed piece of the reply
}

// Streams a chat completion. Resolves with any warnings the proxy attached;
// throws BlockedError when blocked, ApiError for other failures.
export async function streamChat({ conversationId, onConversationId, model, messages, signal, onDelta }: ChatOptions) {
  let res: Response
  try {
    res = await apiFetch('/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model, messages, stream: true }),
      headers: conversationId ? { 'X-Conversation-Id': conversationId } : undefined,
      signal,
    })
  } catch (err) {
    const body = err instanceof ApiError ? (err.body as { error?: { type?: string; detections?: FlaggedDetection[] } }) : undefined
    if (err instanceof ApiError && body?.error?.type === 'pii_detected') {
      throw new BlockedError(err.message, body.error.detections ?? [])
    }
    throw err
  }

  const warnings = JSON.parse(res.headers.get('X-PII-Warnings') ?? '[]') as FlaggedDetection[]
  const partial = JSON.parse(res.headers.get('X-Partially-Checked') ?? '[]') as PartialNotice[]
  const savedAs = res.headers.get('X-Conversation-Id') ?? conversationId
  if (savedAs) onConversationId?.(savedAs)

  // Server-Sent Events: "data: {chunk}" lines, ending with "data: [DONE]"
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += value
    const lines = buffer.split('\n')
    buffer = lines.pop()!
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content
        if (delta) onDelta(delta)
      } catch {
        // ignore keep-alives and partial junk
      }
    }
  }

  return { warnings, partial, conversationId: savedAs }
}
