import { useState } from 'react'
import { LoadingSpinner } from '~/components/Layout'
import { updateArticleTier } from '~/lib/mutations'
import { formatCents } from '~/lib/payment-calculator'

const TIER_OPTIONS = [
  { value: 'Tier 1 (Basic)', label: 'Tier 1 (Basic)' },
  { value: 'Tier 2 (Standard)', label: 'Tier 2 (Standard)' },
  { value: 'Tier 3 (Advanced)', label: 'Tier 3 (Advanced)' },
]

interface TierSelectorProps {
  articleId: string
  currentTier: string
  baseRate?: number // In cents
  disabled?: boolean
  onTierChange?: (newTier: string) => void
}

export function TierSelector({
  articleId,
  currentTier,
  baseRate,
  disabled = false,
  onTierChange,
}: TierSelectorProps) {
  const [isUpdating, setIsUpdating] = useState(false)
  const [localTier, setLocalTier] = useState(currentTier)

  const handleTierChange = async (newTier: string) => {
    if (disabled || newTier === localTier) return
    const previousTier = localTier
    setLocalTier(newTier) // Optimistic update
    setIsUpdating(true)
    try {
      await updateArticleTier({
        data: {
          articleId,
          tier: newTier,
        },
      })
      onTierChange?.(newTier)
    } catch (error) {
      console.error('Failed to update tier:', error)
      setLocalTier(previousTier) // Revert on error
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <div
      className="flex items-center justify-between p-2 rounded"
      style={{
        background: 'var(--bg-subtle)',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <div>
        <p className="text-sm" style={{ color: 'var(--fg-default)' }}>
          Article Tier
        </p>
        <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>
          Base rate: {baseRate ? formatCents(baseRate) : '—'}
        </p>
      </div>
      <div className="relative">
        <select
          value={localTier}
          onChange={(e) => handleTierChange(e.target.value)}
          disabled={disabled || isUpdating}
          className="text-xs px-2 py-1 rounded appearance-none pr-6"
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            color: 'var(--fg-default)',
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
        >
          {TIER_OPTIONS.map((tier) => (
            <option key={tier.value} value={tier.value}>
              {tier.label}
            </option>
          ))}
        </select>
        {isUpdating && (
          <div className="absolute inset-0 flex items-center justify-center">
            <LoadingSpinner size="sm" />
          </div>
        )}
      </div>
    </div>
  )
}
