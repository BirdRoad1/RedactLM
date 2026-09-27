import { ApiError, apiFetch } from './client'
import type { ChatMessage, FlaggedDetection, PartialCheck } from './types'

export type PartialNotice = PartialCheck & { messageIndex: number; source?: { filename: string } }

// Swapped for a placeholder before sending (replace mode)
export type Replaced = { messageIndex: number; start: number; end: number; title: string; placeholder: string; source?: { filename: string } }

// The proxy refused the request because something reached the block threshold
export class BlockedError extends Error {
  readonly detections: FlaggedDetection[]
  readonly overridable: boolean // this user may send it anyway

  constructor(message: string, detections: FlaggedDetection[], overridable: boolean) {
    super(message)
    this.detections = detections
    this.overridable = overridable
  }
}

type ChatOptions = {
  conversationId?: string // continue this conversation; omit to start a new one
  onConversationId?: (id: string) => void // as soon as the server says which conversation it is
  model: string
  messages: ChatMessage[]
  override?: boolean // send even if blocked (needs the override role)
  signal?: AbortSignal
  onDelta: (text: string) => void // called with each streamed piece of the reply
  onReplaced?: (replaced: Replaced[]) => void // before the reply streams: what was swapped for placeholders
}

// Streams a chat completion. Resolves with any warnings the proxy attached;
// throws BlockedError when blocked, ApiError for other failures.
export async function streamChat({ conversationId, onConversationId, model, messages, override, signal, onDelta, onReplaced }: ChatOptions) {
  let res: Response
  try {
    res = await apiFetch('/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model, messages, stream: true }),
      headers: {
        ...(conversationId && { 'X-Conversation-Id': conversationId }),
        ...(override && { 'X-Override-Block': 'true' }),
      },
      signal,
    })
  } catch (err) {
    const body = err instanceof ApiError
      ? (err.body as { error?: { type?: string; detections?: FlaggedDetection[]; overridable?: boolean } })
      : undefined
    if (err instanceof ApiError && body?.error?.type === 'pii_detected') {
      throw new BlockedError(err.message, body.error.detections ?? [], body.error.overridable ?? false)
    }
    throw err
  }

  const warnings = JSON.parse(res.headers.get('X-PII-Warnings') ?? '[]') as FlaggedDetection[]
  const partial = JSON.parse(res.headers.get('X-Partially-Checked') ?? '[]') as PartialNotice[]
  const replaced = JSON.parse(res.headers.get('X-PII-Replaced') ?? '[]') as Replaced[]
  const overridden = JSON.parse(res.headers.get('X-PII-Overridden') ?? '[]') as FlaggedDetection[]
  const savedAs = res.headers.get('X-Conversation-Id') ?? conversationId
  if (savedAs) onConversationId?.(savedAs)
  if (replaced.length) onReplaced?.(replaced)

  // Server-Sent Events: "data: {chunk}" lines, ending with "data: [DONE]".
  // Why the reply ended ("stop", "length", "content_filter"...) comes in the
  // last chunk; a failure partway arrives as an { error } event instead.
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  let finishReason: string | null = null
  let streamError: string | null = null
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
        const chunk = JSON.parse(data)
        if (chunk.error) streamError = chunk.error.message ?? 'Unknown error'
        const choice = chunk.choices?.[0]
        if (choice?.finish_reason) finishReason = choice.finish_reason
        if (choice?.delta?.content) onDelta(choice.delta.content)
      } catch {
        // ignore keep-alives and partial junk
      }
    }
  }

  return { warnings, partial, replaced, overridden, conversationId: savedAs, finishReason, streamError }
}
