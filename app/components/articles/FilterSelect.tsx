import { ChevronDown } from 'lucide-react'

interface FilterSelectProps {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  placeholder: string
}

export function FilterSelect({
  value,
  onChange,
  options,
  placeholder,
}: FilterSelectProps) {
  const selectedOption = options.find((o) => o.value === value)
  const displayLabel = selectedOption?.value ? selectedOption.label : placeholder

  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="select-trigger pr-7"
        style={{
          appearance: 'none',
          minWidth: '100px',
        }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
        style={{ color: 'var(--fg-faint)' }}
      />
    </div>
  )
}
