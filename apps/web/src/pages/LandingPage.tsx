import { useEffect, useState, type ReactNode } from 'react'
import { PLACEHOLDER } from '@redactlm/shared'
import { Link } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { ArchitectureDiagram } from '../components/ArchitectureDiagram'
import {
  EyeIcon,
  KeyIcon,
  PaperclipIcon,
  ShieldIcon,
  SwapIcon,
} from '../components/icons'

// The public front page: what RedactLM is and does, with a small animated
// example of a message being checked. The example is an illustration built
// into the page; nothing is sent anywhere.

const MESSAGE =
  "Hi! I'm Jane Cooper, SSN 529-43-1187. Can you summarize the Project Falcon budget and send it to jane.cooper@acme.com?"

// What the example "finds", and the placeholder the AI gets instead
const FINDINGS = [
  { text: 'Jane Cooper', label: "Person's name", by: 'Local AI', placeholder: 'redacted-8c21f04a9b3e' },
  { text: '529-43-1187', label: 'Social Security number', by: 'Rule', placeholder: 'SSN-3f9a1c0b7e2d' },
  { text: 'Project Falcon', label: 'Private company term', by: 'Keyword', placeholder: 'KEYWORD-a17be2c09d44' },
  { text: 'jane.cooper@acme.com', label: 'Email address', by: 'Rule', placeholder: 'EMAIL-5d0e93b17c62' },
].map((f) => ({ ...f, start: MESSAGE.indexOf(f.text), end: MESSAGE.indexOf(f.text) + f.text.length }))

const SENT = FINDINGS.reduce((text, f) => text.replace(f.text, f.placeholder), MESSAGE)

type Phase = 'typing' | 'checking' | 'found' | 'sent'

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Types the message, "checks" it, highlights what's sensitive, shows what the
// AI receives, then starts over
function useDemo() {
  const still = reducedMotion()
  const [typed, setTyped] = useState(still ? MESSAGE.length : 0)
  const [phase, setPhase] = useState<Phase>(still ? 'sent' : 'typing')

  useEffect(() => {
    if (still) return
    const next = (ms: number, then: () => void) => {
      const timer = setTimeout(then, ms)
      return () => clearTimeout(timer)
    }
    if (phase === 'typing') {
      if (typed < MESSAGE.length) return next(24, () => setTyped((n) => n + 1))
      return next(350, () => setPhase('checking'))
    }
    if (phase === 'checking') return next(900, () => setPhase('found'))
    if (phase === 'found') return next(1600, () => setPhase('sent'))
    return next(4200, () => {
      setTyped(0)
      setPhase('typing')
    })
  }, [phase, typed, still])

  return { typed, phase }
}

function Demo() {
  const { typed, phase } = useDemo()
  const found = phase === 'found' || phase === 'sent'

  const parts: ReactNode[] = []
  let cursor = 0
  for (const f of FINDINGS) {
    if (!found || f.start >= typed) break
    parts.push(MESSAGE.slice(cursor, f.start))
    parts.push(
      <mark key={f.start} className="demo-mark">
        {MESSAGE.slice(f.start, f.end)}
      </mark>,
    )
    cursor = f.end
  }
  parts.push(MESSAGE.slice(cursor, typed))

  return (
    <div className="demo" aria-label="Example: a message with sensitive details, and what the AI receives instead">
      <div className="demo-panel">
        <div className="demo-head">
          <span>You write</span>
          <span className={`demo-status ${phase}`}>
            {phase === 'typing' ? '' : phase === 'checking' ? 'Checking…' : `${FINDINGS.length} sensitive values found`}
          </span>
        </div>
        <p className="demo-text">
          {parts}
          {phase === 'typing' && <span className="demo-caret" />}
        </p>
        {/* always laid out, shown once found, so nothing jumps */}
        <ul className={`demo-findings ${found ? 'on' : ''}`} aria-hidden={!found}>
          {FINDINGS.map((f) => (
            <li key={f.start}>{f.label}<span>{f.by}</span></li>
          ))}
        </ul>
      </div>
      <div className={`demo-arrow ${phase === 'sent' ? 'on' : ''}`} aria-hidden="true">↓</div>
      <div className={`demo-panel demo-sent ${phase === 'sent' ? 'on' : ''}`}>
        <div className="demo-head">
          <span>The AI receives</span>
          <span className="demo-status sent">Placeholders only</span>
        </div>
        <p className="demo-text">
          {/* split on a capturing group: the placeholders land at odd indexes */}
          {SENT.split(new RegExp(`(${PLACEHOLDER.source})`)).map((piece, i) =>
            i % 2 ? <code key={i}>{piece}</code> : piece,
          )}
        </p>
      </div>
    </div>
  )
}

const STEPS = [
  {
    title: 'Write as usual',
    text: 'Chat in the app, or point any tool that speaks the OpenAI API at it. Attach PDFs, images and text files.',
  },
  {
    title: 'Checked before it leaves',
    text: 'Rules catch numbers, keys and your own keywords; an optional AI model on your own servers catches names and context. Attachments are read too.',
  },
  {
    title: 'Sent safely, or not at all',
    text: 'Sensitive values become placeholders, or the message is stopped, whichever your policy says. Every step is logged.',
  },
]

const FEATURES: { icon: ReactNode; title: string; text: string }[] = [
  { icon: <ShieldIcon />, title: 'Built-in detection', text: 'Social Security numbers, card numbers (checksum-verified), bank accounts, emails, phone numbers, dates of birth and API keys.' },
  { icon: <EyeIcon />, title: 'A local AI second opinion', text: 'A small model on your own hardware finds what rules miss, like names. Only local models are allowed for this job.' },
  { icon: <KeyIcon />, title: 'Your own keywords', text: 'Codenames, clients, trade secrets. Thousands of them, matched instantly, and never shown to any model.' },
  { icon: <PaperclipIcon />, title: 'Attachments too', text: 'PDFs, images and text files are read locally with OCR, including text hidden inside PDFs.' },
  { icon: <SwapIcon />, title: 'Placeholders, not dead ends', text: 'Replace mode swaps each value for a placeholder that stays the same through the conversation, so answers still make sense.' },
  { icon: <HighlightIcon />, title: 'Warnings as you type', text: 'Sensitive parts are highlighted before you hit send, with a plain explanation of why.' },
  { icon: <PeopleIcon />, title: 'Roles and overrides', text: 'Reviewers, auditors and admins get what they need. Trusted people can send anyway with Ctrl+Enter, on the record.' },
  { icon: <LogIcon />, title: 'An audit log you can hand over', text: 'Every check, override and admin change, filterable and exportable as CSV. It never contains the sensitive text itself.' },
  { icon: <DoorIcon />, title: 'Single sign-on', text: 'Google, Microsoft Entra ID or any OpenID Connect provider, alongside passwords.' },
]

export function LandingPage() {
  const { user } = useAuth()
  const cta = user ? { to: '/chat', label: 'Open the app' } : { to: '/login', label: 'Sign in' }

  return (
    <div className="landing">
      <header className="landing-nav">
        <Link to="/" className="brand">RedactLM</Link>
        <nav>
          <a href="#how">How it works</a>
          <a href="#features">Features</a>
          <a href="#developers">Developers</a>
        </nav>
        <Link to={cta.to} className="landing-button small">{cta.label}</Link>
      </header>

      <section className="landing-hero">
        <div className="hero-copy">
          <p className="eyebrow">A privacy layer for AI chat</p>
          <h1>Use AI without leaking what matters.</h1>
          <p className="hero-lede">
            RedactLM sits between your people and ChatGPT, Claude or Gemini. It catches personal data and company
            secrets before a message leaves, and swaps them for placeholders so the answer still helps.
          </p>
          <div className="hero-actions">
            <Link to={cta.to} className="landing-button">{cta.label}</Link>
            <a href="#how" className="landing-button ghost">See how it works</a>
          </div>
        </div>
        <Demo />
      </section>

      <section className="landing-facts" aria-label="At a glance">
        <div><strong>7</strong><span>built-in rule checks, plus your keywords</span></div>
        <div><strong>0</strong><span>detected values kept in chat history, which is saved masked</span></div>
        <div><strong>1</strong><span>URL to change in any OpenAI-compatible tool</span></div>
      </section>

      <section id="how" className="landing-section">
        <h2>How it works</h2>
        <ArchitectureDiagram />
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="step-number">{i + 1}</span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="features" className="landing-section">
        <h2>Everything a careful company needs</h2>
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <article key={f.title} className="feature">
              <span className="feature-icon">{f.icon}</span>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="developers" className="landing-section developers">
        <div>
          <h2>A drop-in for OpenAI clients</h2>
          <p>
            Every tool that talks to the OpenAI API works through RedactLM: change the base URL, use your sign-in
            token as the key, and pick any model your admins set up. The same checks, the same audit log.
          </p>
        </div>
        <pre className="code-sample"><code>{`from openai import OpenAI

client = OpenAI(
    base_url="https://redactlm.yourcompany.com/v1",
    api_key="<your RedactLM token>",
)

reply = client.chat.completions.create(
    model="claude/claude-opus-5-5",
    messages=[{"role": "user", "content": "Draft the Q3 update"}],
)`}</code></pre>
      </section>

      <section className="landing-cta">
        <h2>Ready when your team is.</h2>
        <p>Self-hosted, open about what it does, and quiet until it matters.</p>
        <Link to={cta.to} className="landing-button">{cta.label}</Link>
      </section>

      <footer className="landing-footer">
        <span className="brand">RedactLM</span>
        <span>Built by Jose &amp; Tyler</span>
      </footer>
    </div>
  )
}

// Icons only this page uses

function LineIcon({ children }: { children: ReactNode }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="icon">
      {children}
    </svg>
  )
}

function HighlightIcon() {
  return <LineIcon><path d="M4 20h16" /><path d="M14.5 4.5l5 5L10 19H5v-5z" /></LineIcon>
}

function PeopleIcon() {
  return <LineIcon><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.4 3.3-5.5 6.5-5.5s5.9 2.1 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.9.8 3.2 2.7 3.5 5.2" /></LineIcon>
}

function LogIcon() {
  return <LineIcon><rect x="4" y="3" width="16" height="18" rx="2.5" /><path d="M8 8h8M8 12h8M8 16h5" /></LineIcon>
}

function DoorIcon() {
  return <LineIcon><path d="M14 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><path d="M10 17l5-5-5-5M15 12H3" /></LineIcon>
}
