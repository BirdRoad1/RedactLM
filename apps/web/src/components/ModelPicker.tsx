import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import type { Model } from '../api/types'
import { CheckIcon, ChevronDownIcon } from './icons'

type Props = { models: Model[]; value: string; onChange: (id: string) => void }

// The model menu: models grouped under their backend, the chosen one ticked.
// Works from the keyboard like a native select: arrows, Home/End, Enter,
// Escape, and typing to jump to a model by name.
export function ModelPicker({ models, value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const typed = useRef({ text: '', at: 0 })
  const id = useId()
  const current = models.find((m) => m.id === value)

  // backends in the order their models came, each with its models
  const groups = [...new Set(models.map((m) => m.backend))].map((backend) => ({
    backend,
    models: models.filter((m) => m.backend === backend),
  }))
  const ordered = groups.flatMap((g) => g.models)

  function show() {
    setActive(Math.max(0, ordered.findIndex((m) => m.id === value)))
    setOpen(true)
  }

  function close(refocus = true) {
    setOpen(false)
    if (refocus) button.current?.focus()
  }

  function choose(model: Model) {
    onChange(model.id)
    close()
  }

  useEffect(() => {
    if (!open) return
    list.current?.focus()
    const outside = (e: MouseEvent) => !root.current?.contains(e.target as Node) && close(false)
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [open])

  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active, id])

  function onKeyDown(e: KeyboardEvent) {
    const last = ordered.length - 1
    const moves: Record<string, () => number> = {
      ArrowDown: () => Math.min(last, active + 1),
      ArrowUp: () => Math.max(0, active - 1),
      Home: () => 0,
      End: () => last,
      PageDown: () => Math.min(last, active + 8),
      PageUp: () => Math.max(0, active - 8),
    }
    if (moves[e.key]) {
      e.preventDefault()
      setActive(moves[e.key]!())
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (ordered[active]) choose(ordered[active])
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      if (e.key === 'Escape') e.preventDefault()
      close(e.key === 'Escape')
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // type-ahead: letters typed in quick succession spell the start of a name
      const now = e.timeStamp
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLowerCase(), at: now }
      const match = ordered.findIndex((m) => m.name.toLowerCase().startsWith(typed.current.text))
      if (match >= 0) setActive(match)
    }
  }

  let index = 0
  return (
    <div className="model-picker" ref={root}>
      <button
        ref={button}
        type="button"
        className="model-picker-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        disabled={!models.length}
        onClick={() => (open ? close() : show())}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault()
            show()
          }
        }}
      >
        <span className="model-name">{current?.name ?? (value || 'No models')}</span>
        {current && <span className="model-backend">{current.backend}</span>}
        <ChevronDownIcon size={16} />
      </button>
      {open && (
        <ul
          ref={list}
          id={`${id}-list`}
          className="model-picker-list"
          role="listbox"
          tabIndex={-1}
          aria-label="Model"
          aria-activedescendant={`${id}-${active}`}
          onKeyDown={onKeyDown}
        >
          {groups.map((group) => (
            <li key={group.backend} role="presentation">
              <div className="model-group" aria-hidden="true">{group.backend}</div>
              <ul role="group" aria-label={group.backend}>
                {group.models.map((m) => {
                  const i = index++
                  return (
                    <li
                      key={m.id}
                      id={`${id}-${i}`}
                      role="option"
                      aria-selected={m.id === value}
                      className={`model-option${i === active ? ' active' : ''}`}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => choose(m)}
                    >
                      <span className="model-name">{m.name}</span>
                      {m.id === value && <CheckIcon size={16} />}
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
