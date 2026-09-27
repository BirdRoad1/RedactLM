import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { api, apiFetch } from '../../api/client'
import type { AddKeywordsResult, Keyword } from '../../api/types'

// Same rule as the server: lowercase, letters and numbers only, single spaces
const normalize = (keyword: string) =>
  keyword
    .split(/\s+/u)
    .map((word) => word.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
    .join(' ')

// long lists: draw the first matches, search narrows it down
const SHOWN = 500

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`

export function KeywordsPage() {
  const [keywords, setKeywords] = useState<Keyword[] | null>(null)
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    api<Keyword[]>('/keywords').then(setKeywords).catch((err) => setError(err.message))
  }, [])
  useEffect(load, [load])

  const lines = draft.split('\n').filter((line) => line.trim())
  const preview = [...new Set(lines.map(normalize).filter(Boolean))]

  async function add(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setResult(null)
    try {
      const r = await api<AddKeywordsResult>('/keywords', 'POST', { keywords: lines })
      setResult(
        [
          `Added ${plural(r.added.length, 'keyword', 'keywords')}.`,
          r.alreadyListed.length > 0 && `${plural(r.alreadyListed.length, 'was', 'were')} already on the list.`,
          r.empty.length > 0 && `${plural(r.empty.length, 'line', 'lines')} had no letters or numbers, so ${r.empty.length === 1 ? 'it was' : 'they were'} skipped.`,
        ]
          .filter(Boolean)
          .join(' '),
      )
      setDraft('')
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function remove(keyword: Keyword) {
    setError(null)
    try {
      await apiFetch(`/keywords/${keyword.id}`, { method: 'DELETE' })
      setKeywords((list) => list?.filter((k) => k.id !== keyword.id) ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const query = normalize(search)
  const matching = useMemo(
    () => (keywords ?? []).filter((k) => !query || k.keyword.includes(query)),
    [keywords, query],
  )

  return (
    <section>
      <h1>Keywords</h1>
      <p className="muted">
        Private terms like project codenames or client names. Messages that mention them are caught, whatever the
        capitalization or punctuation.
      </p>

      <form className="card keyword-form" onSubmit={add}>
        <label>
          Add keywords, one per line
          <textarea rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={'Project Falcon\nAcme Corp'} />
        </label>
        {preview.length > 0 && (
          <p className="small muted">
            Saved as: {preview.slice(0, 8).map((k) => <code key={k}>{k}</code>).reduce<ReactNode[]>((all, k, i) => (i ? [...all, ', ', k] : [k]), [])}
            {preview.length > 8 && `, and ${(preview.length - 8).toLocaleString()} more`}
          </p>
        )}
        <div>
          <button type="submit" disabled={!preview.length}>Add</button>
        </div>
      </form>
      {result && <p className="success">{result}</p>}
      {error && <p className="error">{error}</p>}

      {keywords && (
        <>
          <div className="keyword-list-head">
            <h2>{plural(keywords.length, 'keyword', 'keywords')}</h2>
            {keywords.length > 0 && (
              <input type="search" placeholder="Search" aria-label="Search keywords" value={search} onChange={(e) => setSearch(e.target.value)} />
            )}
          </div>
          {!keywords.length && <p className="muted">No keywords yet.</p>}
          {keywords.length > 0 && (
            <table>
              <thead>
                <tr><th>Keyword</th><th>Added by</th><th>Added</th><th /></tr>
              </thead>
              <tbody>
                {matching.slice(0, SHOWN).map((k) => (
                  <tr key={k.id}>
                    <td><code>{k.keyword}</code></td>
                    <td>{k.createdBy ?? <span className="muted">deleted user</span>}</td>
                    <td className="nowrap">{new Date(k.createdAt).toLocaleDateString()}</td>
                    <td className="nowrap"><button onClick={() => remove(k)}>Remove</button></td>
                  </tr>
                ))}
                {!matching.length && <tr><td colSpan={4} className="muted">No keywords match.</td></tr>}
              </tbody>
            </table>
          )}
          {matching.length > SHOWN && (
            <p className="small muted">Showing the first {SHOWN} of {matching.length.toLocaleString()}; search to narrow it down.</p>
          )}
        </>
      )}
    </section>
  )
}
