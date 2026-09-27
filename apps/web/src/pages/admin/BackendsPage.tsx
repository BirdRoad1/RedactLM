import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
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

// Starting points for the form. Nothing is added until the form is sent,
// with a key where one is needed.
type Preset = { label: string; fields: Partial<NewBackend>; headers?: string; needsKey: boolean; hint: ReactNode }

const PRESETS: Preset[] = [
  {
    label: 'Google Gemini',
    fields: { name: 'Google Gemini', slug: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', trust: 'cloud' },
    needsKey: true,
    hint: <>Get a key in <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Google AI Studio</a>. Uses Gemini's OpenAI-compatible API.</>,
  },
  {
    label: 'Anthropic Claude',
    fields: { name: 'Claude', slug: 'claude', baseUrl: 'https://api.anthropic.com/v1', trust: 'cloud' },
    headers: 'anthropic-version: 2023-06-01',
    needsKey: true,
    hint: <>Get a key in the <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">Anthropic Console</a>.</>,
  },
  {
    label: 'OpenAI',
    fields: { name: 'OpenAI', slug: 'openai', baseUrl: 'https://api.openai.com/v1', trust: 'cloud' },
    needsKey: true,
    hint: <>Get a key on the <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">OpenAI platform</a>.</>,
  },
  {
    label: 'Ollama (local)',
    fields: { name: 'Ollama', slug: 'ollama', baseUrl: 'http://localhost:11434/v1', trust: 'local', timeoutMs: 120_000 },
    needsKey: false,
    hint: <>Runs models on your own machine, no key needed. Local, so it can be the LLM detector: try <code>ollama pull gemma3</code>.</>,
  },
  { label: 'Custom', fields: {}, needsKey: false, hint: 'Any server with an OpenAI-compatible API.' },
]

export function BackendsPage() {
  const [backends, setBackends] = useState<Backend[]>([])
  const [form, setForm] = useState(empty)
  const [headers, setHeaders] = useState('') // "Name: value" per line
  const [preset, setPreset] = useState<Preset | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api<Backend[]>('/backends').then(setBackends).catch((err) => setError(err.message))
  }, [])
  useEffect(load, [load])

  // a preset's slug, or the next free one ("claude-2") if it's taken
  function applyPreset(p: Preset) {
    let slug = p.fields.slug ?? ''
    for (let n = 2; slug && backends.some((b) => b.slug === slug); n++) slug = `${p.fields.slug}-${n}`
    setPreset(p)
    setForm({ ...empty, ...p.fields, slug })
    setHeaders(p.headers ?? '')
  }

  const set = <K extends keyof NewBackend>(key: K, value: NewBackend[K]) => setForm((f) => ({ ...f, [key]: value }))

  async function create(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const extraHeaders = Object.fromEntries(
        headers.split('\n').filter((line) => line.includes(':')).map((line) => {
          const at = line.indexOf(':')
          return [line.slice(0, at).trim(), line.slice(at + 1).trim()]
        }),
      )
      await api('/backends', 'POST', {
        ...form,
        apiKey: form.apiKey || null,
        extraHeaders: Object.keys(extraHeaders).length ? extraHeaders : null,
      })
      setForm(empty)
      setHeaders('')
      setPreset(null)
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
      <div className="presets" role="group" aria-label="Start from">
        <span className="muted small">Start from</span>
        {PRESETS.map((p) => (
          <button key={p.label} type="button" className={preset === p ? 'chosen' : undefined} aria-pressed={preset === p} onClick={() => applyPreset(p)}>
            {p.label}
          </button>
        ))}
      </div>
      <form className="card form-grid" onSubmit={create}>
        {preset && <p className="wide small muted preset-hint">{preset.hint}</p>}
        <label>Name<input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Local vLLM" required /></label>
        <label>
          Slug
          <input value={form.slug} onChange={(e) => set('slug', e.target.value)} placeholder="local-vllm" pattern="[a-z0-9]+(-[a-z0-9]+)*" title="lowercase letters and digits, separated by single hyphens" required />
        </label>
        <label>Base URL<input type="url" value={form.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} placeholder="http://vllm:8000/v1" required /></label>
        <label>
          API key
          <input
            type="password"
            value={form.apiKey ?? ''}
            onChange={(e) => set('apiKey', e.target.value)}
            autoComplete="off"
            required={preset?.needsKey}
            placeholder={preset?.needsKey ? 'Required' : 'Optional'}
          />
        </label>
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
        <label className="wide">
          Extra headers (one per line)
          <textarea rows={2} value={headers} onChange={(e) => setHeaders(e.target.value)} placeholder="Header-Name: value" />
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
