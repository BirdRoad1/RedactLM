import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../../api/client'
import type { Backend, LlmDetector } from '../../api/types'

export function DetectorPage() {
  const [config, setConfig] = useState<LlmDetector | null>(null)
  const [backends, setBackends] = useState<Backend[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    Promise.all([api<LlmDetector>('/settings/llm-detector'), api<Backend[]>('/backends')])
      .then(([c, b]) => {
        setConfig(c)
        setBackends(b.filter((backend) => backend.trust === 'local'))
      })
      .catch((err) => setError(err.message))
  }, [])

  if (!config) return <section><h1>LLM detector</h1>{error && <p className="error">{error}</p>}</section>

  const set = <K extends keyof LlmDetector>(key: K, value: LlmDetector[K]) => {
    setSaved(false)
    setConfig({ ...config, [key]: value })
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const { enabled, backendId, model, failMode, timeoutMs, maxChars, instructions } = config!
      setConfig(await api<LlmDetector>('/settings/llm-detector', 'PATCH', {
        enabled, backendId, model: model || null, failMode, timeoutMs, maxChars, instructions: instructions || null,
      }))
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <section>
      <h1>LLM detector</h1>
      <p className="muted">
        One local model reads each message the static checks didn't already block, looking for sensitive information
        rules can't catch (names, health details, deal codenames). Its findings follow the <code>local-llm</code> entry of
        the detection policy.
      </p>
      {error && <p className="error">{error}</p>}
      {saved && <p className="success">Saved.</p>}

      <form className="card form-grid" onSubmit={save}>
        <div className="checks">
          <label><input type="checkbox" checked={config.enabled} onChange={(e) => set('enabled', e.target.checked)} /> Enabled</label>
        </div>
        <label>
          Backend (local only)
          <select value={config.backendId ?? ''} onChange={(e) => set('backendId', e.target.value ? Number(e.target.value) : null)}>
            <option value="">—</option>
            {backends.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.slug})</option>)}
          </select>
        </label>
        <label>Model<input value={config.model ?? ''} onChange={(e) => set('model', e.target.value)} placeholder="qwen2.5:3b" /></label>
        <label>
          When the detector can't answer
          <select value={config.failMode} onChange={(e) => set('failMode', e.target.value as LlmDetector['failMode'])}>
            <option value="block">Block the message (safer)</option>
            <option value="allow">Let it through</option>
          </select>
        </label>
        <label>Timeout (ms)<input type="number" min={1000} max={300000} value={config.timeoutMs} onChange={(e) => set('timeoutMs', Number(e.target.value))} /></label>
        <label title="Longer messages and files still pass the rule-based checks in full; they're marked as partly checked and logged.">
          Characters it reads per message or file
          <input type="number" min={500} max={1000000} step={500} value={config.maxChars} onChange={(e) => set('maxChars', Number(e.target.value))} />
        </label>
        <label className="wide">
          Extra instructions
          <textarea rows={4} value={config.instructions ?? ''} onChange={(e) => set('instructions', e.target.value)} placeholder="Also flag the internal codenames Bluebird and Kestrel." />
        </label>
        <button type="submit">Save</button>
      </form>
    </section>
  )
}
