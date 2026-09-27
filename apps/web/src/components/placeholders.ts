import { PLACEHOLDER } from '@llm-thingy/shared'
import type { Attachment } from '../api/types'
import type { Replaced } from '../api/chat'

// In replace mode the server swaps sensitive values for placeholders like
// "SSN-3f9a1c0b7e2d" before the AI sees them, and tells us where (never
// the values themselves). This page still has what was typed, so it can put
// the real values back into the AI's replies. The map lives only in memory
// for this conversation: values are never stored, so after a reload the
// placeholders stay as they are.
export type Swaps = ReadonlyMap<string, string> // placeholder -> real value

// A text attachment's contents, as the server read them (a byte-order mark
// counts, so offsets line up)
function fileText(attachment: Attachment) {
  const base64 = attachment.dataUri.slice(attachment.dataUri.indexOf(',') + 1)
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
}

// Which value each placeholder stands for, from the messages that were sent
export function swapsFrom(replaced: Replaced[], sent: { content: string; attachments?: Attachment[] }[]) {
  const found = new Map<string, string>()
  for (const r of replaced) {
    const message = sent[r.messageIndex]
    if (!message) continue
    let text = message.content
    if (r.source) {
      const file = message.attachments?.find((a) => a.filename === r.source!.filename)
      if (!file) continue
      text = fileText(file)
    }
    const value = text.slice(r.start, r.end)
    if (value) found.set(r.placeholder, value)
  }
  return found
}

// ---------- In Markdown replies ----------

// Just enough of the Markdown syntax tree for this
type MdNode = { type: string; value?: string; url?: string; children?: MdNode[] }

export const SWAP_URL = 'swap:'

// A remark plugin: placeholders in plain text become links to "swap:<placeholder>",
// which the Markdown component draws with SwappedValue. In code and link text,
// where links can't go, known placeholders are simply replaced (or left, in
// the AI's view).
export function remarkPlaceholders(swaps: Swaps, aiView: boolean) {
  // the ones we know by their exact text first: they can end up glued to a
  // word ("xSSN-…"), where the general pattern wouldn't see them
  const known = [...swaps.keys()].map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const find = new RegExp([...known, PLACEHOLDER.source].join('|'), 'g')
  const inCode = (text: string) => (aiView ? text : text.replace(find, (p) => swaps.get(p) ?? p))

  function split(value: string): MdNode[] {
    const out: MdNode[] = []
    let cursor = 0
    for (const match of value.matchAll(find)) {
      if (match.index > cursor) out.push({ type: 'text', value: value.slice(cursor, match.index) })
      out.push({ type: 'link', url: SWAP_URL + match[0], children: [{ type: 'text', value: match[0] }] })
      cursor = match.index + match[0].length
    }
    if (cursor < value.length) out.push({ type: 'text', value: value.slice(cursor) })
    return out
  }

  // inside a link: no links within links, so plain replacement as in code
  function walkPlain(node: MdNode) {
    if (node.value) node.value = inCode(node.value)
    node.children?.forEach(walkPlain)
  }

  function walk(node: MdNode) {
    if (!node.children) return
    node.children = node.children.flatMap((child) => {
      if (child.type === 'text' && child.value) return split(child.value)
      if ((child.type === 'inlineCode' || child.type === 'code') && child.value) return [{ ...child, value: inCode(child.value) }]
      if (child.type === 'link' || child.type === 'linkReference') walkPlain(child)
      else walk(child)
      return [child]
    })
  }

  return () => (tree: MdNode) => walk(tree)
}
