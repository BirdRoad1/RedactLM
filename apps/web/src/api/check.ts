import { api } from './client'
import type { Issue, PartialCheck } from './types'

// Static checks only (no AI model involved), so it's safe to call while typing
export async function checkText(text: string, signal?: AbortSignal) {
  const { issues } = await api<{ issues: Issue[] }>('/check', 'POST', { text }, signal)
  return issues
}

// Reads the file on the server (locally, with OCR for images and PDF pages;
// no AI model) and checks it
export async function checkFile(filename: string, data: string, signal?: AbortSignal) {
  return api<{ pages: number | null; partial: PartialCheck | null; issues: (Omit<Issue, 'page'> & { page: number | null })[] }>(
    '/check/file', 'POST', { filename, data }, signal,
  )
}
