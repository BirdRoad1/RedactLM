// What the API returns, as JSON: dates are ISO strings. The server checks
// its responses against these (apps/server/src/api-contract.ts), so the two
// can't drift apart unnoticed.
import type { UserRole as Role } from "./roles";

export type ChatRole = "system" | "user" | "assistant"

export type Me = {
  id: number
  email: string
  username: string
  roles: Role[]
  createdAt: string
  deletedAt: string | null // set once deleted
}

export type User = Me

export type Session = { token: string; expiresAt: string }

// `id` is what"s sent; `name` is readable when the backend gives one, else
// the model"s own id; `backend` is the backend"s name
export type Model = { id: string; owned_by: string; name: string; backend: string }

// A problem in some text, in plain language. `start`/`end` locate it; the
// flagged text itself is never sent back.
export type Issue = {
  start: number
  end: number
  outcome: "warned" | "redacted" | "blocked" // redacted: swapped for a placeholder before sending
  title: string // "Phone number"
  reason: string // "This looks like a phone number."
  explanation: string // why it matters and what to do instead
  confidence: number
  page?: number | null // for issues in a PDF attachment
  placeholder?: string // what was sent instead, once replaced
}

// An issue in a sent message, as reported by the chat endpoint
export type FlaggedDetection = Omit<Issue, "outcome" | "page"> & {
  messageIndex: number
  checker: string // internal name; not for display
  source?: { filename: string; page?: number } // found in this attachment
}

// Passed, but only the first `checkedChars` were read by the AI detector
// (the rule-based checks read everything)
export type PartialCheck = { checkedChars: number; totalChars: number }

export type Trust = "local" | "cloud"

// OpenAI-compatible chat completions, or Anthropic's Messages API
export type BackendApi = "openai" | "anthropic"

export type Backend = {
  id: number
  name: string
  slug: string
  baseUrl: string
  api: BackendApi
  apiKey: string | null // masked, e.g. "****abcd"
  trust: Trust
  enabled: boolean
  isDefault: boolean
  timeoutMs: number
  supportsStreaming: boolean
  stripParams: string[]
  extraHeaders: Record<string, string> | null
}

export type Threshold = number | null // null = never

export type BlockMode = "block" | "replace"

export type DetectionPolicy = {
  mode: BlockMode
  warnAt: Threshold
  blockAt: Threshold
  checkers: { checker: string; warnAt: Threshold; blockAt: Threshold; overridden: boolean }[]
}

export type FailMode = "block" | "allow"

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
export type MessageAction = "allowed" | "warned" | "redacted" | "blocked" | "overridden" | "unchecked"

// Everyone"s conversations, for reviewers. Counts are of messages.
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
    role: ChatRole | "developer" | "tool"
    content: string
    action: MessageAction
    model: string | null
    createdAt: string
    // "intact": unchanged since it was saved. "unsealed": saved before
    // messages were sealed, so it can't be checked. "broken": changed since,
    // or a message before it was.
    seal: MessageSeal
    position: number
    editOf: number | null // an edit of the message at this position
    replaced: boolean // sent, then replaced by a later edit
    detections: { reason: string; location: string | null; confidence: number; outcome: string }[]
  }[]
}

export type MessageSeal = "intact" | "unsealed" | "broken"

// Stored messages have sensitive parts masked as "[REDACTED: Phone number]"
export type Conversation = {
  id: string
  title: string | null
  updatedAt: string
  model: string | null
  // as it stands: messages replaced by an edit aren't included.
  // `position` is what an edit names (X-Edit-Of); `edited`: this is an edit
  messages: { position: number; role: ChatRole | "developer" | "tool"; content: string; action: MessageAction; edited: boolean }[]
}
