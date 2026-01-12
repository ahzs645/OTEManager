import { useState } from 'react'
import { LoadingSpinner } from '~/components/Layout'
import { updateArticleTier } from '~/lib/mutations'

const TIER_OPTIONS = [
  { value: 'Tier 1 (Basic)', label: 'Tier 1 (Basic)', rate: '$25' },
  { value: 'Tier 2 (Standard)', label: 'Tier 2 (Standard)', rate: '$40' },
  { value: 'Tier 3 (Advanced)', label: 'Tier 3 (Advanced)', rate: '$60' },
]

interface TierSelectorProps {
  articleId: string
  currentTier: string
  disabled?: boolean
}

export function TierSelector({
  articleId,
  currentTier,
  disabled = false,
}: TierSelectorProps) {
  const [isUpdating, setIsUpdating] = useState(false)

  const handleTierChange = async (newTier: string) => {
    if (disabled || newTier === currentTier) return
    setIsUpdating(true)
    try {
      await updateArticleTier({
        data: {
          articleId,
          tier: newTier,
        },
      })
      window.location.reload()
    } catch (error) {
      console.error('Failed to update tier:', error)
    } finally {
      setIsUpdating(false)
    }
  }

  const currentOption = TIER_OPTIONS.find(t => t.value === currentTier)

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
          Base rate: {currentOption?.rate || '$25'}
        </p>
      </div>
      <div className="relative">
        <select
          value={currentTier}
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
