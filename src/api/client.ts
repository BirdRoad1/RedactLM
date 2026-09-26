import type { Session } from './types'

const BASE: string = import.meta.env.VITE_API_URL ?? '/api'
const SESSION_KEY = 'llm-thingy.session'

// Fired when the server rejects our token, so the app can go back to login
export const SESSION_EXPIRED = 'llm-thingy:session-expired'

export class ApiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, body: unknown) {
    super(errorMessage(body) ?? `Request failed (HTTP ${status})`)
    this.status = status
    this.body = body
  }
}

// The API answers errors as {error: "..."} or {error: {message: "..."}}
function errorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || !('error' in body)) return undefined
  const error = (body as { error: unknown }).error
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error) return String(error.message)
  return undefined
}

export function getSession(): Session | null {
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as Session | null
    return session && new Date(session.expiresAt) > new Date() ? session : null
  } catch {
    return null
  }
}

export function setSession(session: Session | null) {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  else localStorage.removeItem(SESSION_KEY)
}

// fetch() against the API with the session token; throws ApiError on failure
export async function apiFetch(path: string, init: RequestInit = {}) {
  const session = getSession()
  const headers = new Headers(init.headers)
  if (init.body !== undefined) headers.set('Content-Type', 'application/json')
  if (session) headers.set('Authorization', `Bearer ${session.token}`)

  const res = await fetch(BASE + path, { ...init, headers })
  if (res.ok) return res

  const text = await res.text()
  let body: unknown = text
  try {
    body = JSON.parse(text)
  } catch {
    // not JSON; keep the text
  }
  if (res.status === 401 && session) {
    setSession(null)
    window.dispatchEvent(new Event(SESSION_EXPIRED))
  }
  throw new ApiError(res.status, body)
}

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return (await res.json()) as T
}
