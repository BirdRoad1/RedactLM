// Shapes returned by the llm-thingy API (see its /openapi.json)

export type Me = {
  id: number
  email: string
  username: string
  isAdmin: boolean
  createdAt: string
}

export type Session = { token: string; expiresAt: string }

export type Model = { id: string; owned_by: string }

export type ChatRole = 'system' | 'user' | 'assistant'
export type ChatMessage = { role: ChatRole; content: string }

// Where and why something was flagged; never the flagged text itself
export type FlaggedDetection = {
  messageIndex: number
  checker: string
  reason: string
  confidence: number
  start: number
  end: number
}

export type Trust = 'local' | 'cloud'

export type Backend = {
  id: number
  name: string
  slug: string
  baseUrl: string
  apiKey: string | null // masked, e.g. "****abcd"
  trust: Trust
  enabled: boolean
  isDefault: boolean
  timeoutMs: number
  supportsStreaming: boolean
  stripParams: string[]
  extraHeaders: Record<string, string> | null
}

export type NewBackend = Omit<Backend, 'id' | 'apiKey'> & { apiKey: string | null }

export type Threshold = number | null // null = never

export type DetectionPolicy = {
  warnAt: Threshold
  blockAt: Threshold
  checkers: { checker: string; warnAt: Threshold; blockAt: Threshold; overridden: boolean }[]
}

export type FailMode = 'block' | 'allow'

export type LlmDetector = {
  enabled: boolean
  backendId: number | null
  model: string | null
  failMode: FailMode
  timeoutMs: number
  instructions: string | null
}
