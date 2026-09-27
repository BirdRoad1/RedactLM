import type { ReactNode } from 'react'

// Where LLM Thingy sits: between your people and the cloud AI, inside your
// company, with a local model and the audit log beside it. Drawn twice, wide
// and tall; the page shows the one that fits (see .arch-wide / .arch-tall).

type Box = { x: number; y: number; w: number; h: number }
type Tone = 'plain' | 'main' | 'cloud'

function Node({ box, title, lines, icon, tone = 'plain' }: { box: Box; title: string; lines: string[]; icon: ReactNode; tone?: Tone }) {
  const cx = box.x + box.w / 2
  // `top` is the title's baseline; with an icon, everything moves down half
  // the icon's height to stay centred, and the icon sits clear of the title
  // (further for the bigger main title)
  const top = box.y + box.h / 2 - (18 + lines.length * 17) / 2 + 12 + (icon ? 12 : 0)
  const iconGap = tone === 'main' ? 50 : 44
  return (
    <g className={`arch-node ${tone}`}>
      <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={18} />
      <g transform={`translate(${cx - 12}, ${top - iconGap})`} className="arch-icon">{icon}</g>
      <text x={cx} y={top} className="arch-title" textAnchor="middle">{title}</text>
      {lines.map((line, i) => (
        <text key={line} x={cx} y={top + 20 + i * 17} className="arch-sub" textAnchor="middle">{line}</text>
      ))}
    </g>
  )
}

type Kind = 'out' | 'back' | 'blocked' | 'side'

// A labelled arrow along `d`; the label sits at (lx, ly)
function Edge({ id, d, kind, label, lx, ly, anchor = 'middle' }: { id: string; d: string; kind: Kind; label: string; lx: number; ly: number; anchor?: 'start' | 'middle' | 'end' }) {
  return (
    <g className={`arch-edge ${kind}`}>
      <path d={d} markerEnd={`url(#${id}-arrow-${kind})`} />
      <text x={lx} y={ly} textAnchor={anchor} className="arch-label">{label}</text>
    </g>
  )
}

// Arrowheads, with ids unique to each drawing: markers in a hidden <svg>
// don't render, so the visible drawing can't borrow the hidden one's
function Defs({ id }: { id: string }) {
  return (
    <defs>
      {(['out', 'back', 'blocked', 'side'] as Kind[]).map((kind) => (
        <marker key={kind} id={`${id}-arrow-${kind}`} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M1 1.5 L8.5 5 L1 8.5" className={`arch-head ${kind}`} />
        </marker>
      ))}
    </defs>
  )
}

// 24px line icons, drawn in the node's colour
const Laptop = <path d="M5 6.5A1.5 1.5 0 0 1 6.5 5h11A1.5 1.5 0 0 1 19 6.5V15H5zM2.5 18.5h19" />
const Shield = <><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z" /><path d="M9 12l2 2 4-4" /></>
const Chip = <><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" /></>
const Log = <><rect x="5" y="3" width="14" height="18" rx="2.5" /><path d="M9 8h6M9 12h6M9 16h4" /></>
const Cloud = <path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 8.5a4.5 4.5 0 0 1-.5 9.5z" />

const icon = (paths: ReactNode) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">{paths}</svg>
)

function Wide() {
  return (
    <svg className="arch arch-wide" viewBox="0 0 1100 560" role="img" aria-labelledby="arch-wide-title">
      <title id="arch-wide-title">
        Your people send messages to LLM Thingy inside your company. It checks them with its own rules and a local AI
        model, logs every step, sends the cloud AI only a cleaned message, and passes the answer back, or says why a
        message was blocked.
      </title>
      <Defs id="wide" />
      <rect x="16" y="16" width="760" height="528" rx="26" className="arch-boundary" />
      <text x="44" y="50" className="arch-boundary-label">Inside your company</text>

      <Node box={{ x: 36, y: 200, w: 172, h: 150 }} icon={icon(Laptop)} title="Your people" lines={['The web app, or any', 'OpenAI-compatible tool']} />
      <Node box={{ x: 356, y: 175, w: 240, h: 200 }} icon={icon(Shield)} tone="main" title="LLM Thingy" lines={['Rules and your keywords', 'Reads attachments (OCR)', 'Placeholders or blocks']} />
      <Node box={{ x: 381, y: 62, w: 190, h: 64 }} icon={null} title="Audit log" lines={['every step, never the text']} />
      <Node box={{ x: 381, y: 440, w: 190, h: 76 }} icon={null} title="Local AI model" lines={['on your own servers']} />
      <Node box={{ x: 862, y: 190, w: 210, h: 170 }} icon={icon(Cloud)} tone="cloud" title="Cloud AI" lines={['OpenAI · Anthropic', 'Google']} />

      <Edge id="wide" kind="out" d="M210 250 H352" label="Message" lx={281} ly={240} />
      <Edge id="wide" kind="back" d="M352 300 H210" label="Answer" lx={281} ly={290} />
      <Edge id="wide" kind="blocked" d="M352 330 H210" label="or why it's blocked" lx={281} ly={352} />

      <Edge id="wide" kind="out" d="M598 250 H858" label="Cleaned message: placeholders only" lx={728} ly={240} />
      <Edge id="wide" kind="back" d="M858 300 H598" label="Answer" lx={728} ly={290} />

      <Edge id="wide" kind="side" d="M476 173 V130" label="Logs every check" lx={487} ly={156} anchor="start" />
      <Edge id="wide" kind="side" d="M455 377 V436" label="Anything sensitive?" lx={445} ly={412} anchor="end" />
      <Edge id="wide" kind="back" d="M497 436 V377" label="What it found" lx={507} ly={412} anchor="start" />

      <text x="967" y="392" textAnchor="middle" className="arch-note">Never sees the</text>
      <text x="967" y="410" textAnchor="middle" className="arch-note">sensitive values</text>
    </svg>
  )
}

function Tall() {
  return (
    <svg className="arch arch-tall" viewBox="0 0 400 900" role="img" aria-labelledby="arch-tall-title">
      <title id="arch-tall-title">
        Your people send messages to LLM Thingy inside your company. It checks them with its own rules and a local AI
        model, logs every step, sends the cloud AI only a cleaned message, and passes the answer back.
      </title>
      <Defs id="tall" />
      <rect x="8" y="8" width="384" height="640" rx="24" className="arch-boundary" />
      <text x="28" y="38" className="arch-boundary-label">Inside your company</text>

      <Node box={{ x: 90, y: 56, w: 220, h: 120 }} icon={icon(Laptop)} title="Your people" lines={['The web app, or any', 'OpenAI-compatible tool']} />
      <Node box={{ x: 60, y: 262, w: 280, h: 170 }} icon={icon(Shield)} tone="main" title="LLM Thingy" lines={['Rules and your keywords', 'Reads attachments (OCR)', 'Placeholders or blocks']} />
      <Node box={{ x: 22, y: 528, w: 150, h: 96 }} icon={icon(Chip)} title="Local AI" lines={['your servers']} />
      <Node box={{ x: 228, y: 528, w: 150, h: 96 }} icon={icon(Log)} title="Audit log" lines={['never the text']} />
      <Node box={{ x: 90, y: 730, w: 220, h: 140 }} icon={icon(Cloud)} tone="cloud" title="Cloud AI" lines={['OpenAI · Anthropic', 'Google']} />

      <Edge id="tall" kind="out" d="M170 178 V258" label="Message" lx={160} ly={222} anchor="end" />
      <Edge id="tall" kind="back" d="M230 258 V178" label="Answer or" lx={240} ly={214} anchor="start" />
      <text x={240} y={231} className="arch-label blocked-text">why it's blocked</text>

      <Edge id="tall" kind="side" d="M110 434 V524" label="Sensitive?" lx={100} ly={484} anchor="end" />
      <Edge id="tall" kind="side" d="M300 434 V524" label="Logs" lx={310} ly={484} anchor="start" />

      <Edge id="tall" kind="out" d="M186 434 V726" label="Placeholders" lx={176} ly={690} anchor="end" />
      <Edge id="tall" kind="back" d="M214 726 V434" label="Answer" lx={224} ly={690} anchor="start" />
    </svg>
  )
}

export function ArchitectureDiagram() {
  return (
    <figure className="arch-figure">
      <Wide />
      <Tall />
    </figure>
  )
}
