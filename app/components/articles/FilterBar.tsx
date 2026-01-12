import { Search } from 'lucide-react'
import { Input, Button } from '~/components/Layout'
import { FilterSelect } from './FilterSelect'
import { STATUS_OPTIONS, TIER_OPTIONS } from './types'

interface FilterBarProps {
  searchInput: string
  onSearchInputChange: (value: string) => void
  onSearchSubmit: (e: React.FormEvent) => void
  statusFilter: string
  tierFilter: string
  onFilterChange: (key: string, value: string) => void
  hasFilters: boolean
  onClearFilters: () => void
}

export function FilterBar({
  searchInput,
  onSearchInputChange,
  onSearchSubmit,
  statusFilter,
  tierFilter,
  onFilterChange,
  hasFilters,
  onClearFilters,
}: FilterBarProps) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 p-3 rounded-lg"
      style={{
        background: 'var(--bg-surface)',
        border: '0.5px solid var(--border-default)',
      }}
    >
      {/* Search */}
      <form onSubmit={onSearchSubmit} className="flex-1 min-w-48">
        <Input
          placeholder="Search articles..."
          value={searchInput}
          onChange={onSearchInputChange}
          icon={Search}
        />
      </form>

      {/* Status Filter */}
      <FilterSelect
        value={statusFilter}
        onChange={(v) => onFilterChange('status', v)}
        options={STATUS_OPTIONS}
        placeholder="Status"
      />

      {/* Tier Filter */}
      <FilterSelect
        value={tierFilter}
        onChange={(v) => onFilterChange('tier', v)}
        options={TIER_OPTIONS}
        placeholder="Tier"
      />

      {/* Clear Filters */}
      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={onClearFilters}>
          Clear
        </Button>
      )}
    </div>
  )
}
