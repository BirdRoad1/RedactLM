import { useMemo } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { PaperclipIcon } from './icons'
import { remarkPlaceholders, SWAP_URL, type Swaps } from './placeholders'
import { SwappedValue } from './SwappedText'

// AI replies as Markdown. Raw HTML in them is shown as text, never run.
// Stored replies have sensitive parts masked as "[REDACTED: Phone number]"
// and attachments noted as "[Attached: a.pdf]"; those become the same small
// labels as elsewhere, by passing through as links to a made-up "mask:" URL.
// Placeholders the AI was given instead of sensitive values show the real
// value again, or the placeholder in "what the AI saw" (`aiView`).
const MASK = /\[(REDACTED|Attached): ([^\]]+)\]/g

const noSwaps: Swaps = new Map()

const componentsFor = (swaps: Swaps, aiView: boolean): Components => ({
  a({ href, children }) {
    if (href?.startsWith(SWAP_URL)) {
      return <SwappedValue placeholder={href.slice(SWAP_URL.length)} swaps={swaps} aiView={aiView} />
    }
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
})

const urlTransform = (url: string) => (url.startsWith('mask:') || url.startsWith(SWAP_URL) ? url : defaultUrlTransform(url))

export function Markdown({ text, swaps = noSwaps, aiView = false }: { text: string; swaps?: Swaps; aiView?: boolean }) {
  const source = text.replace(MASK, (_, kind: string, label: string) => `[${label}](mask:${kind})`)
  const components = useMemo(() => componentsFor(swaps, aiView), [swaps, aiView])
  const plugins = useMemo(() => [remarkGfm, remarkPlaceholders(swaps, aiView)], [swaps, aiView])
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={plugins} components={components} urlTransform={urlTransform}>
        {source}
      </ReactMarkdown>
    </div>
  )
}
