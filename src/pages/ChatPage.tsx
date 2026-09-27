import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { BlockedError, streamChat } from '../api/chat'
import { checkFile } from '../api/check'
import { api } from '../api/client'
import { deleteConversation, getConversation, listConversations } from '../api/conversations'
import type { Attachment, ChatMessage, ContentPart, ConversationSummary, FlaggedDetection, Issue, Model } from '../api/types'
import { AttachmentChip } from '../components/AttachmentChip'
import { CheckedTextarea } from '../components/CheckedTextarea'
import { ConversationList } from '../components/ConversationList'
import { HighlightedText } from '../components/HighlightedText'
import { outcomeLabel } from '../components/issues'
import { MessageContent } from '../components/MessageContent'
import { useLiveCheck } from '../hooks/useLiveCheck'

// `stored`: loaded from history, so sensitive parts are already masked.
// `warnings` are in the text; `fileWarnings` describe ones in attachments.
type Entry = {
  role: ChatMessage['role']
  content: string
  attachments?: Attachment[]
  warnings?: Issue[]
  fileWarnings?: string[]
  stored?: boolean
}

// Where the draft was blocked; shown until the user edits it
type Blocked = { draft: string; issues: Issue[]; inFiles: FlaggedDetection[] }

const where = (d: FlaggedDetection) =>
  d.source ? `"${d.source.filename}"${d.source.page ? `, page ${d.source.page}` : ''}` : ''

// What the API gets: plain text, or parts when there are attachments
function toMessage({ role, content, attachments }: Entry): ChatMessage {
  if (!attachments?.length) return { role, content }
  const parts: ContentPart[] = content ? [{ type: 'text', text: content }] : []
  for (const a of attachments) {
    parts.push(
      a.mime.startsWith('image/')
        ? { type: 'image_url', image_url: { url: a.dataUri } }
        : { type: 'file', file: { filename: a.filename, file_data: a.dataUri } },
    )
  }
  return { role, content: parts }
}

const readAsDataUri = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })

const asIssues = (detections: FlaggedDetection[], outcome: Issue['outcome']): Issue[] =>
  detections.map(({ start, end, title, reason, explanation, confidence }) => ({
    start, end, outcome, title, reason, explanation, confidence,
  }))

export function ChatPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  // set when this page started the conversation, so it isn't reloaded from the
  // server (which only has the masked text) when the URL switches to it
  const startedHere = useRef<string | null>(null)
  const [models, setModels] = useState<Model[]>([])
  const [model, setModel] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  const [blocked, setBlocked] = useState<Blocked | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const liveIssues = useLiveCheck(draft)

  useEffect(() => {
    api<{ data: Model[] }>('/v1/models')
      .then(({ data }) => {
        setModels(data)
        setModel((current) => current || data[0]?.id || '')
      })
      .catch((err) => setError(`Couldn't load models: ${err.message}`))
  }, [])

  const refreshList = useCallback(() => {
    listConversations().then(setConversations).catch(() => {})
  }, [])
  useEffect(refreshList, [refreshList])

  // Open the conversation in the URL, or start fresh on "/"
  useEffect(() => {
    setBlocked(null)
    setError(null)
    if (!id) {
      setEntries([])
      return
    }
    if (id === startedHere.current) return
    abort.current?.abort()

    let cancelled = false
    getConversation(id)
      .then((convo) => {
        if (cancelled) return
        setEntries(
          convo.messages
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => ({ role: m.role as ChatMessage['role'], content: m.content, stored: true })),
        )
        if (convo.model) setModel(convo.model)
      })
      .catch((err) => !cancelled && setError(`Couldn't open this conversation: ${err.message}`))
    return () => {
      cancelled = true
    }
  }, [id])

  async function remove(conversation: ConversationSummary) {
    if (!confirm(`Delete "${conversation.title}"?`)) return
    try {
      await deleteConversation(conversation.id)
      if (conversation.id === id) navigate('/')
      refreshList()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  // Each file is checked as soon as it's attached (read locally on the
  // server with OCR; no AI model), so problems show up before sending
  async function attach(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])]
    e.target.value = ''
    for (const file of files) {
      const attachment: Attachment = {
        id: crypto.randomUUID(),
        filename: file.name,
        mime: file.type || 'application/octet-stream',
        dataUri: await readAsDataUri(file),
        status: 'checking',
        issues: [],
      }
      setAttachments((current) => [...current, attachment])
      const update = (changes: Partial<Attachment>) =>
        setAttachments((current) => current.map((a) => (a.id === attachment.id ? { ...a, ...changes } : a)))
      checkFile(file.name, attachment.dataUri)
        .then(({ pages, issues }) => update({ status: 'checked', pages, issues }))
        .catch((err) => update({ status: 'error', error: err instanceof Error ? err.message : String(err) }))
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    const files = attachments
    if ((!text && !files.length) || !model || busy) return

    const history: Entry[] = [...entries, { role: 'user', content: text, attachments: files }]
    setEntries([...history, { role: 'assistant', content: '' }])
    setDraft('')
    setAttachments([])
    setBlocked(null)
    setError(null)
    setBusy(true)
    abort.current = new AbortController()

    const appendToReply = (delta: string) =>
      setEntries((current) => {
        const next = [...current]
        const last = next[next.length - 1]!
        next[next.length - 1] = { ...last, content: last.content + delta }
        return next
      })

    try {
      const { warnings } = await streamChat({
        conversationId: id,
        onConversationId: (newId) => {
          if (newId === id) return
          startedHere.current = newId
          navigate(`/c/${newId}`)
        },
        model,
        messages: history.map(toMessage),
        signal: abort.current.signal,
        onDelta: appendToReply,
      })
      if (warnings.length) {
        // attach each warning to the message it's about
        setEntries((current) =>
          current.map((entry, i) => {
            const mine = warnings.filter((w) => w.messageIndex === i)
            if (!mine.length) return entry
            const inText = mine.filter((w) => !w.source)
            const inFiles = [...new Set(mine.filter((w) => w.source).map((w) => `${w.title} in ${where(w)}`))]
            return {
              ...entry,
              warnings: inText.length ? asIssues(inText, 'warned') : undefined,
              fileWarnings: inFiles.length ? inFiles : undefined,
            }
          }),
        )
      }
    } catch (err) {
      // Stopped by the user: the message was sent, keep what arrived of the reply
      if (err instanceof DOMException && err.name === 'AbortError') return

      // nothing was sent: take the message back out and return it to the input
      setEntries(entries)
      setDraft(text)
      setAttachments(files)
      if (err instanceof BlockedError) {
        const mine = err.detections.filter((d) => d.messageIndex === history.length - 1)
        setBlocked({
          draft: text,
          issues: asIssues(mine.filter((d) => !d.source), 'blocked'),
          inFiles: mine.filter((d) => d.source),
        })
      } else {
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      setBusy(false)
      abort.current = null
      refreshList()
    }
  }

  return (
    <div className="chat-page">
      <ConversationList conversations={conversations} onNew={() => navigate('/')} onDelete={remove} />
      <div className="chat">
        <div className="chat-toolbar">
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.id}</option>
            ))}
          </select>
        </div>

        <div className="messages">
          {!entries.length && <p className="muted">Messages are checked for sensitive information before they leave the company.</p>}
          {entries.map((entry, i) => (
            <div key={i} className={`message ${entry.role}`}>
              <div className="bubble">
                {entry.attachments && entry.attachments.length > 0 && (
                  <span className="attachments">
                    {entry.attachments.map((a) => <span key={a.id} className="attachment-ref">📎 {a.filename}</span>)}
                  </span>
                )}
                {entry.stored ? (
                  <MessageContent text={entry.content} />
                ) : entry.warnings ? (
                  <HighlightedText text={entry.content} issues={entry.warnings} />
                ) : (
                  entry.content
                )}
                {entry.role === 'assistant' && busy && i === entries.length - 1 && <span className="cursor">▍</span>}
              </div>
              {entry.warnings && (
                <p className="warning">
                  Sent with a warning: {[...new Set(entry.warnings.map((w) => w.title))].join(', ')}. Hover the highlight for details.
                </p>
              )}
              {entry.fileWarnings && <p className="warning">Sent with a warning: {entry.fileWarnings.join('; ')}.</p>}
            </div>
          ))}
        </div>

        {blocked && draft === blocked.draft && (
          <div className="blocked-panel">
            <p><strong>Not sent.</strong> Your message contains information that can't leave the company:</p>
            <ul>
              {[...new Map(blocked.issues.map((i) => [i.title, i])).values()].map((issue) => (
                <li key={issue.title}><strong>{issue.title}.</strong> {issue.reason}</li>
              ))}
              {[...new Set(blocked.inFiles.map((d) => `${d.title}|${where(d)}`))].map((key) => {
                const [title, place] = key.split('|')
                return <li key={key}><strong>{title}</strong> in {place}.</li>
              })}
            </ul>
            {blocked.issues.length > 0 && (
              <p className="preview">
                <HighlightedText text={blocked.draft} issues={blocked.issues} />
              </p>
            )}
            <p className="muted">{fixHint(blocked)}</p>
          </div>
        )}
        {error && <p className="error">{error}</p>}

        {attachments.length > 0 && (
          <div className="attachments">
            {attachments.map((a) => (
              <AttachmentChip key={a.id} attachment={a} onRemove={() => setAttachments((c) => c.filter((x) => x.id !== a.id))} />
            ))}
          </div>
        )}
        <form className="composer" onSubmit={send}>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            accept="application/pdf,image/png,image/jpeg,image/webp,image/gif,image/bmp,text/*,.csv,.md,.json"
            onChange={attach}
          />
          <button type="button" className="attach" title="Attach PDFs, images or text files" aria-label="Attach files" onClick={() => fileInput.current?.click()}>
            📎
          </button>
          <CheckedTextarea
            value={draft}
            issues={liveIssues}
            placeholder="Message"
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                e.currentTarget.form?.requestSubmit()
              }
            }}
          />
          {busy ? (
            <button type="button" onClick={() => abort.current?.abort()}>Stop</button>
          ) : (
            <button type="submit" disabled={(!draft.trim() && !attachments.length) || !model}>Send</button>
          )}
        </form>
        <LiveSummary issues={liveIssues} />
      </div>
    </div>
  )
}

// One line under the input saying what the highlights mean
function LiveSummary({ issues }: { issues: Issue[] }) {
  if (!issues.length) return null
  const kinds = [...new Map(issues.map((i) => [i.title, i])).values()]
  const blocking = kinds.some((i) => i.outcome === 'blocked')
  return (
    <p className={`live-summary ${blocking ? 'blocked' : 'warned'}`}>
      {kinds.map((i) => `${i.title} (${outcomeLabel(i.outcome).toLowerCase()})`).join(', ')}
      {blocking ? ". This message won't be sent as it is." : '.'} Hover the highlights for details.
    </p>
  )
}

function fixHint(blocked: Blocked) {
  const steps = [
    blocked.inFiles.length && 'remove the file or attach a version without that information',
    blocked.issues.length && 'remove or replace the highlighted parts',
  ].filter(Boolean)
  const text = `${steps.join(', and ')}, then send again.`
  return text[0]!.toUpperCase() + text.slice(1)
}
