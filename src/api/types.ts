// Shapes returned by the llm-thingy API (see its /openapi.json)

// What a user may do; "admin" includes every other role
export type Role =
  | 'admin'
  | 'override'
  | 'no_check'
  | 'review_chats'
  | 'view_audit'
  | 'manage_users'
  | 'manage_backends'
  | 'manage_settings'
  | 'manage_keywords'

export type Me = {
  id: number
  email: string
  username: string
  roles: Role[]
  createdAt: string
}

export type User = Me

export type Session = { token: string; expiresAt: string }

// `id` is what's sent; `name` is readable when the backend gives one, else
// the model's own id; `backend` is the backend's name
export type Model = { id: string; owned_by: string; name: string; backend: string }

export type ChatRole = 'system' | 'user' | 'assistant'

// OpenAI-style content parts, for messages with attachments
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } }

export type ChatMessage = { role: ChatRole; content: string | ContentPart[] }

// A problem in some text, in plain language. `start`/`end` locate it; the
// flagged text itself is never sent back.
export type Issue = {
  start: number
  end: number
  outcome: 'warned' | 'redacted' | 'blocked' // redacted: swapped for a placeholder before sending
  title: string // "Phone number"
  reason: string // "This looks like a phone number."
  explanation: string // why it matters and what to do instead
  confidence: number
  page?: number | null // for issues in a PDF attachment
  placeholder?: string // what was sent instead, once replaced
}

// An issue in a sent message, as reported by the chat endpoint
export type FlaggedDetection = Omit<Issue, 'outcome' | 'page'> & {
  messageIndex: number
  checker: string // internal name; not for display
  source?: { filename: string; page?: number } // found in this attachment
}

// A file attached to the draft, checked as soon as it's added
export type Attachment = {
  id: string
  filename: string
  mime: string
  dataUri: string
  status: 'checking' | 'checked' | 'error' | 'unchecked' // unchecked: the user's files aren't checked
  issues: Issue[]
  pages?: number | null
  partial?: PartialCheck | null // longer than the AI detector reads
  error?: string
}

// Passed, but only the first `checkedChars` were read by the AI detector
// (the rule-based checks read everything)
export type PartialCheck = { checkedChars: number; totalChars: number }

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

export type BlockMode = 'block' | 'replace'

export type DetectionPolicy = {
  mode: BlockMode
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
  maxChars: number
  instructions: string | null
}

export type AuditEntry = {
  id: number
  createdAt: string
  user: string | null
  conversationId: string | null
  event: string
  summary: string // plain-language description
}

// A custom keyword, as saved (lowercase, letters and numbers only)
export type Keyword = { id: number; keyword: string; createdAt: string; createdBy: string | null }

export type AddKeywordsResult = { added: string[]; alreadyListed: string[]; empty: string[] }

export type ConversationSummary = { id: string; title: string; updatedAt: string }

// What happened to a stored message
export type MessageAction = 'allowed' | 'warned' | 'redacted' | 'blocked' | 'overridden' | 'unchecked'

// Everyone's conversations, for reviewers. Counts are of messages.
export type ReviewSummary = {
  id: string
  title: string | null // null: nothing was ever sent
  updatedAt: string
  user: string
  blocked: number
  overridden: number
  unchecked: number
}

export type ReviewConversation = {
  id: string
  title: string | null
  updatedAt: string
  client: string | null
  user: string
  messages: {
    role: ChatRole | 'developer' | 'tool'
    content: string
    action: MessageAction
    model: string | null
    createdAt: string
    detections: { reason: string; location: string | null; confidence: number; outcome: string }[]
  }[]
}

// Stored messages have sensitive parts masked as "[REDACTED: Phone number]"
export type Conversation = {
  id: string
  title: string | null
  updatedAt: string
  model: string | null
  messages: { role: ChatRole | 'developer' | 'tool'; content: string; action: MessageAction }[]
}
