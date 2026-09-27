import type { Threshold } from '../api/types'

// A 0-1 confidence threshold, or "never"
export function ThresholdInput({ value, onChange }: { value: Threshold; onChange: (value: Threshold) => void }) {
  return (
    <span className="threshold">
      <input
        type="number"
        min={0}
        max={1}
        step={0.05}
        value={value ?? ''}
        disabled={value === null}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
      />
      <label>
        <input type="checkbox" checked={value === null} onChange={(e) => onChange(e.target.checked ? null : 0.5)} />
        never
      </label>
    </span>
  )
}
