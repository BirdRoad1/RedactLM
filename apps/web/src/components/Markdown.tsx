import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { PaperclipIcon } from './icons'

// AI replies as Markdown. Raw HTML in them is shown as text, never run.
// Stored replies have sensitive parts masked as "[REDACTED: Phone number]"
// and attachments noted as "[Attached: a.pdf]"; those become the same small
// labels as elsewhere, by passing through as links to a made-up "mask:" URL.
const MASK = /\[(REDACTED|Attached): ([^\]]+)\]/g

const components: Components = {
  a({ href, children }) {
    if (href === 'mask:REDACTED') {
      return <span className="masked" title="Removed before saving because it was sensitive">{children} removed</span>
    }
    if (href === 'mask:Attached') {
      return <span className="attachment-ref" title="Attachments aren't kept in history"><PaperclipIcon size={13} /> {children}</span>
    }
    return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
  },
  // Never load images a model points at: the address itself can carry data
  // out of the company. Show what it is instead.
  img({ alt, src }) {
    return <span className="md-image" title={src}>[image{alt ? `: ${alt}` : ''}]</span>
  },
}

const urlTransform = (url: string) => (url.startsWith('mask:') ? url : defaultUrlTransform(url))

export function Markdown({ text }: { text: string }) {
  const source = text.replace(MASK, (_, kind: string, label: string) => `[${label}](mask:${kind})`)
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} urlTransform={urlTransform}>
        {source}
      </ReactMarkdown>
    </div>
  )
}
