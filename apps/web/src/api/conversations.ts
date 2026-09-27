import { api, apiFetch } from './client'
import type { Conversation, ConversationSummary } from './types'

export const listConversations = () => api<ConversationSummary[]>('/conversations')

export const getConversation = (id: string) => api<Conversation>(`/conversations/${id}`)

export async function deleteConversation(id: string) {
  await apiFetch(`/conversations/${id}`, { method: 'DELETE' })
}
