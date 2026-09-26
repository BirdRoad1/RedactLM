import { api } from './client'
import type { Issue } from './types'

// Static checks only (no AI model involved), so it's safe to call while typing
export async function checkText(text: string, signal?: AbortSignal) {
  const { issues } = await api<{ issues: Issue[] }>('/check', 'POST', { text }, signal)
  return issues
}
