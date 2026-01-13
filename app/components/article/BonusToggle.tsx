import { useState } from 'react'
import { LoadingSpinner } from '~/components/Layout'
import { updateArticleBonusFlags } from '~/lib/mutations'

type BonusField = 'hasResearchBonus' | 'hasTimeSensitiveBonus' | 'hasMultimediaBonus' | 'hasProfessionalPhotos' | 'hasProfessionalGraphics'

interface BonusToggleProps {
  articleId: string
  label: string
  description: string
  field: BonusField
  isActive: boolean
  disabled?: boolean
}

export function BonusToggle({
  articleId,
  label,
  description,
  field,
  isActive,
  disabled = false,
}: BonusToggleProps) {
  const [isToggling, setIsToggling] = useState(false)

  const handleToggle = async () => {
    if (disabled) return
    setIsToggling(true)
    try {
      await updateArticleBonusFlags({
        data: {
          articleId,
          [field]: !isActive,
        },
      })
      window.location.reload()
    } catch (error) {
      console.error('Failed to toggle bonus:', error)
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
        onClick={handleToggle}
        disabled={isToggling || disabled}
        className="text-xs px-2 py-1 rounded transition-colors"
        style={{
          background: isActive ? 'var(--status-success-bg)' : 'var(--bg-muted)',
          color: isActive ? 'var(--status-success)' : 'var(--fg-muted)',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
        title={disabled ? 'Cannot modify bonuses after payment' : undefined}
      >
        {isToggling ? '...' : isActive ? 'Yes' : 'No'}
      </button>
    </div>
  )
}
