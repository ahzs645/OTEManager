import { ChevronUp, ChevronDown, ArrowUpDown } from 'lucide-react'
import type { SortField, SortOrder } from './types'

interface SortableHeaderProps {
  field: SortField
  label: string
  sortBy?: SortField
  sortOrder: SortOrder
  onSort: (field: SortField) => void
}

export function SortableHeader({
  field,
  label,
  sortBy,
  sortOrder,
  onSort,
}: SortableHeaderProps) {
  const isActive = sortBy === field

  return (
    <button
      onClick={() => onSort(field)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.25rem',
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        fontSize: '11px',
        fontWeight: 500,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: isActive ? 'var(--fg-default)' : 'var(--fg-muted)',
        transition: 'color 150ms ease',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--fg-default)')}
      onMouseLeave={(e) => (e.currentTarget.style.color = isActive ? 'var(--fg-default)' : 'var(--fg-muted)')}
    >
      {label}
      {isActive ? (
        sortOrder === 'asc' ? (
          <ChevronUp className="w-3 h-3" />
        ) : (
          <ChevronDown className="w-3 h-3" />
        )
      ) : (
        <ArrowUpDown className="w-3 h-3" style={{ opacity: 0.5 }} />
      )}
    </button>
  )
}
