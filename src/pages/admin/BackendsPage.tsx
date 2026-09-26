import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api } from '../../api/client'
import type { Backend, NewBackend } from '../../api/types'

const empty: NewBackend = {
  name: '',
  slug: '',
  baseUrl: '',
  apiKey: null,
  trust: 'cloud',
  enabled: true,
  isDefault: false,
  timeoutMs: 60_000,
  supportsStreaming: true,
  stripParams: [],
  extraHeaders: null,
}

export function BackendsPage() {
  const [backends, setBackends] = useState<Backend[]>([])
  const [form, setForm] = useState(empty)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api<Backend[]>('/backends').then(setBackends).catch((err) => setError(err.message))
  }, [])
  useEffect(load, [load])

  const set = <K extends keyof NewBackend>(key: K, value: NewBackend[K]) => setForm((f) => ({ ...f, [key]: value }))

  async function create(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await api('/backends', 'POST', { ...form, apiKey: form.apiKey || null })
      setForm(empty)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function remove(backend: Backend) {
    if (!confirm(`Delete backend "${backend.name}"?`)) return
    try {
      await api(`/backends/${backend.id}`, 'DELETE')
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section>
      <h1>Backends</h1>
      <p className="muted">
        Where chats are forwarded. Users pick a model as <code>slug/model</code>; a bare model name goes to the default
        backend. Only <em>local</em> backends can run the LLM detector.
      </p>
      {error && <p className="error">{error}</p>}

      <table>
        <thead>
          <tr><th>Name</th><th>Slug</th><th>URL</th><th>Trust</th><th>API key</th><th>Flags</th><th /></tr>
        </thead>
        <tbody>
          {backends.map((b) => (
            <tr key={b.id}>
              <td>{b.name}</td>
              <td><code>{b.slug}</code></td>
              <td>{b.baseUrl}</td>
              <td>{b.trust}</td>
              <td>{b.apiKey ?? '—'}</td>
              <td>{[b.isDefault && 'default', !b.enabled && 'disabled', !b.supportsStreaming && 'no streaming'].filter(Boolean).join(', ')}</td>
              <td><button onClick={() => remove(b)}>Delete</button></td>
            </tr>
          ))}
          {!backends.length && <tr><td colSpan={7} className="muted">No backends yet.</td></tr>}
        </tbody>
      </table>

      <h2>Add a backend</h2>
      <form className="card form-grid" onSubmit={create}>
        <label>Name<input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Local vLLM" required /></label>
        <label>
          Slug
          <input value={form.slug} onChange={(e) => set('slug', e.target.value)} placeholder="local-vllm" pattern="[a-z0-9]+(-[a-z0-9]+)*" title="lowercase letters and digits, separated by single hyphens" required />
        </label>
        <label>Base URL<input type="url" value={form.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} placeholder="http://vllm:8000/v1" required /></label>
        <label>API key<input type="password" value={form.apiKey ?? ''} onChange={(e) => set('apiKey', e.target.value)} autoComplete="off" /></label>
        <label>
          Trust
          <select value={form.trust} onChange={(e) => set('trust', e.target.value as NewBackend['trust'])}>
            <option value="cloud">cloud</option>
            <option value="local">local</option>
          </select>
        </label>
        <label>Timeout (ms)<input type="number" min={1} value={form.timeoutMs} onChange={(e) => set('timeoutMs', Number(e.target.value))} /></label>
        <label>
          Strip params
          <input value={form.stripParams.join(', ')} onChange={(e) => set('stripParams', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} placeholder="seed, response_format" />
        </label>
        <div className="checks">
          <label><input type="checkbox" checked={form.isDefault} onChange={(e) => set('isDefault', e.target.checked)} /> Default</label>
          <label><input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} /> Enabled</label>
          <label><input type="checkbox" checked={form.supportsStreaming} onChange={(e) => set('supportsStreaming', e.target.checked)} /> Supports streaming</label>
        </div>
        <button type="submit">Add backend</button>
      </form>
    </section>
  )
}
