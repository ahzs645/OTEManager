import { useState } from 'react'
import { updateArticleBonusFlags } from '~/lib/mutations'

type BonusField = 'hasResearchBonus' | 'hasTimeSensitiveBonus' | 'hasMultimediaBonus' | 'hasProfessionalPhotos' | 'hasProfessionalGraphics'

interface BonusToggleProps {
  articleId: string
  label: string
  description: string
  field: BonusField
  isActive: boolean
  disabled?: boolean
  onToggle?: (field: BonusField, newValue: boolean) => void
}

export function BonusToggle({
  articleId,
  label,
  description,
  field,
  isActive,
  disabled = false,
  onToggle,
}: BonusToggleProps) {
  const [isToggling, setIsToggling] = useState(false)
  const [localActive, setLocalActive] = useState(isActive)

  const handleToggle = async () => {
    if (disabled || isToggling) return
    const newValue = !localActive
    setLocalActive(newValue) // Optimistic update
    setIsToggling(true)
    try {
      await updateArticleBonusFlags({
        data: {
          articleId,
          [field]: newValue,
        },
      })
      onToggle?.(field, newValue)
    } catch (error) {
      console.error('Failed to toggle bonus:', error)
      setLocalActive(!newValue) // Revert on error
    } finally {
      setIsToggling(false)
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
          {label}
        </p>
        <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>
          {description}
        </p>
      </div>
      <button
        type="button"
        onClick={handleToggle}
        disabled={isToggling || disabled}
        className="text-xs px-2 py-1 rounded transition-colors"
        style={{
          background: localActive ? 'var(--status-success-bg)' : 'var(--bg-muted)',
          color: localActive ? 'var(--status-success)' : 'var(--fg-muted)',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
        title={disabled ? 'Cannot modify bonuses after payment' : undefined}
      >
        {isToggling ? '...' : localActive ? 'Yes' : 'No'}
      </button>
    </div>
  )
}
