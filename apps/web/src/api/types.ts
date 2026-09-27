// The API's shapes come from the shared package; what's here is the web
// app's own: attachments on the draft, and the chat requests it builds
import type { Backend, ChatRole, Issue, PartialCheck } from '@redactlm/shared'

export type * from '@redactlm/shared'
export type { UserRole as Role } from '@redactlm/shared'

// OpenAI-style content parts, for messages with attachments
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } }

export type ChatMessage = { role: ChatRole; content: string | ContentPart[] }

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

export type NewBackend = Omit<Backend, 'id' | 'apiKey'> & { apiKey: string | null }
