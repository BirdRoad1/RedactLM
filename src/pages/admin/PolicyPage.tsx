import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { BlockMode, DetectionPolicy, Threshold } from '../../api/types'
import { ThresholdInput } from '../../components/ThresholdInput'

type Thresholds = { warnAt: Threshold; blockAt: Threshold }
type Defaults = Thresholds & { mode: BlockMode }

export function PolicyPage() {
  const [policy, setPolicy] = useState<DetectionPolicy | null>(null)
  const [defaults, setDefaults] = useState<Defaults>({ warnAt: null, blockAt: null, mode: 'block' })
  const [edits, setEdits] = useState<Record<string, Thresholds>>({})
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const apply = useCallback((p: DetectionPolicy) => {
    setPolicy(p)
    setDefaults({ warnAt: p.warnAt, blockAt: p.blockAt, mode: p.mode })
    setEdits(Object.fromEntries(p.checkers.map((c) => [c.checker, { warnAt: c.warnAt, blockAt: c.blockAt }])))
  }, [])

  useEffect(() => {
    api<DetectionPolicy>('/settings/detection-policy').then(apply).catch((err) => setError(err.message))
  }, [apply])

  async function run(label: string, request: Promise<DetectionPolicy>) {
    setError(null)
    setSaved(null)
    try {
      apply(await request)
      setSaved(label)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (!policy) return <section><h1>Detection policy</h1>{error && <p className="error">{error}</p>}</section>

  return (
    <section>
      <h1>Detection policy</h1>
      <p className="muted">
        Every detection has a confidence from 0 to 1. At or above <strong>block</strong> the message isn't sent, or, if you
        choose to replace, what was found is swapped for a placeholder like <code>redacted-3f9a1c0b7e2d</code> and the
        message is sent. Replacing works in message text and plain-text files; PDFs and images are still stopped. At or
        above <strong>warn</strong> it's sent with a warning. Detected text is masked in storage either way.
      </p>
      {error && <p className="error">{error}</p>}
      {saved && <p className="success">Saved {saved}.</p>}

      <h2>Defaults</h2>
      <div className="card inline-form">
        <label>Warn at <ThresholdInput value={defaults.warnAt} onChange={(warnAt) => setDefaults({ ...defaults, warnAt })} /></label>
        <label>Block at <ThresholdInput value={defaults.blockAt} onChange={(blockAt) => setDefaults({ ...defaults, blockAt })} /></label>
        <label>
          When something reaches “block at”
          <select value={defaults.mode} onChange={(e) => setDefaults({ ...defaults, mode: e.target.value as BlockMode })}>
            <option value="block">Stop the message</option>
            <option value="replace">Replace it with a placeholder where possible</option>
          </select>
        </label>
        <button onClick={() => run('defaults', api('/settings/detection-policy', 'PATCH', defaults))}>Save defaults</button>
      </div>

      <h2>Per checker</h2>
      <table>
        <thead>
          <tr><th>Checker</th><th>Warn at</th><th>Block at</th><th /></tr>
        </thead>
        <tbody>
          {policy.checkers.map(({ checker, overridden }) => {
            const value = edits[checker]!
            const setValue = (v: Thresholds) => setEdits({ ...edits, [checker]: v })
            return (
              <tr key={checker}>
                <td><code>{checker}</code> {overridden ? <span className="badge">custom</span> : <span className="muted">default</span>}</td>
                <td><ThresholdInput value={value.warnAt} onChange={(warnAt) => setValue({ ...value, warnAt })} /></td>
                <td><ThresholdInput value={value.blockAt} onChange={(blockAt) => setValue({ ...value, blockAt })} /></td>
                <td>
                  <button onClick={() => run(checker, api(`/settings/detection-policy/checkers/${checker}`, 'PUT', value))}>Save</button>
                  {overridden && (
                    <button onClick={() => run(`${checker} (back to defaults)`, api(`/settings/detection-policy/checkers/${checker}`, 'DELETE'))}>
                      Use defaults
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
