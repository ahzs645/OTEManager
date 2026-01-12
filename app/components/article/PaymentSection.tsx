import { useState } from 'react'
import {
  DollarSign,
  Check,
  X,
  RefreshCw,
  Calculator,
  Edit2,
} from 'lucide-react'
import { Button, LoadingSpinner } from '~/components/Layout'
import { formatCents, type PaymentCalculation } from '~/lib/payment-calculator'
import {
  calculateArticlePayment,
  setManualPayment,
  markPaymentComplete,
  updateArticle,
} from '~/lib/mutations'
import { BonusToggle } from './BonusToggle'
import { TierSelector } from './TierSelector'
import { formatDate } from '~/components/Layout'

interface PaymentSectionProps {
  article: {
    id: string
    paymentStatus: boolean
    paymentAmount: number | null
    paymentIsManual: boolean
    paymentRateSnapshot: string | null
    paidAt: Date | null
    articleTier: string
    hasResearchBonus: boolean | null
    hasTimeSensitiveBonus: boolean | null
    hasProfessionalPhotos: boolean | null
    hasProfessionalGraphics: boolean | null
  }
}

export function PaymentSection({ article }: PaymentSectionProps) {
  const [isRecalculating, setIsRecalculating] = useState(false)
  const [showManualInput, setShowManualInput] = useState(false)
  const [manualAmount, setManualAmount] = useState('')
  const [isSavingManual, setIsSavingManual] = useState(false)
  const [isMarkingPaid, setIsMarkingPaid] = useState(false)

  // Parse payment snapshot if available
  let breakdown: PaymentCalculation | null = null
  try {
    if (article.paymentRateSnapshot) {
      breakdown = JSON.parse(article.paymentRateSnapshot)
    }
  } catch {
    // Invalid JSON
  }

  const handleRecalculate = async () => {
    setIsRecalculating(true)
    try {
      await calculateArticlePayment({ data: { articleId: article.id, recalculate: true } })
      window.location.reload()
    } catch (error) {
      console.error('Failed to recalculate:', error)
    } finally {
      setIsRecalculating(false)
    }
  }

  const handleSaveManual = async () => {
    const amount = parseFloat(manualAmount)
    if (isNaN(amount) || amount < 0) return

    setIsSavingManual(true)
    try {
      await setManualPayment({
        data: {
          articleId: article.id,
          amount: Math.round(amount * 100), // Convert to cents
        },
      })
      setShowManualInput(false)
      window.location.reload()
    } catch (error) {
      console.error('Failed to set manual payment:', error)
    } finally {
      setIsSavingManual(false)
    }
  }

  const handleMarkAsPaid = async () => {
    if (!article.paymentAmount) return
    setIsMarkingPaid(true)
    try {
      await markPaymentComplete({
        data: {
          articleId: article.id,
          amount: article.paymentAmount,
        },
      })
      window.location.reload()
    } catch (error) {
      console.error('Failed to mark as paid:', error)
    } finally {
      setIsMarkingPaid(false)
    }
  }

  const handleMarkAsUnpaid = async () => {
    setIsMarkingPaid(true)
    try {
      await updateArticle({
        data: {
          articleId: article.id,
          paymentStatus: false,
        },
      })
      window.location.reload()
    } catch (error) {
      console.error('Failed to mark as unpaid:', error)
    } finally {
      setIsMarkingPaid(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Payment Status */}
      <div className="flex items-center gap-3">
        {article.paymentStatus ? (
          <>
            <div
              className="icon-container"
              style={{ background: 'var(--status-success-bg)' }}
            >
              <Check className="w-4 h-4" style={{ color: 'var(--status-success)' }} />
            </div>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--status-success)' }}>
                Paid
                {article.paymentAmount && (
                  <span className="ml-1">{formatCents(article.paymentAmount)}</span>
                )}
              </p>
              {article.paidAt && (
                <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>
                  {formatDate(article.paidAt)}
                </p>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="icon-container">
              <DollarSign className="w-4 h-4" />
            </div>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--fg-default)' }}>
                {article.paymentAmount ? formatCents(article.paymentAmount) : 'Not set'}
              </p>
              <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>
                {article.paymentIsManual ? 'Manual' : 'Calculated'}
              </p>
            </div>
          </>
        )}
      </div>

      {/* Payment Breakdown */}
      {breakdown && !article.paymentIsManual && (
        <div
          className="p-3 rounded-lg text-sm space-y-2"
          style={{ background: 'var(--bg-subtle)' }}
        >
          <div className="flex justify-between">
            <span style={{ color: 'var(--fg-muted)' }}>{breakdown.tierName}</span>
            <span style={{ color: 'var(--fg-default)' }}>{formatCents(breakdown.tierRate)}</span>
          </div>
          {breakdown.bonuses.map((bonus, idx) => (
            <div key={idx} className="flex justify-between">
              <span style={{ color: 'var(--fg-muted)' }}>+ {bonus.type}</span>
              <span style={{ color: 'var(--fg-default)' }}>{formatCents(bonus.amount)}</span>
            </div>
          ))}
          <div
            className="flex justify-between pt-2 mt-2 font-medium"
            style={{ borderTop: '1px solid var(--border-default)' }}
          >
            <span style={{ color: 'var(--fg-default)' }}>Total</span>
            <span style={{ color: 'var(--accent)' }}>{formatCents(breakdown.totalAmount)}</span>
          </div>
        </div>
      )}

      {/* Tier & Bonuses */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium" style={{ color: 'var(--fg-muted)' }}>
            Tier & Bonuses
          </p>
          {article.paymentStatus && (
            <span className="text-xs" style={{ color: 'var(--fg-faint)' }}>
              Locked (paid)
            </span>
          )}
        </div>

        {/* Tier Selector */}
        <TierSelector
          articleId={article.id}
          currentTier={article.articleTier}
          disabled={article.paymentStatus}
        />

        <BonusToggle
          articleId={article.id}
          label="Research Bonus"
          description="Extensive research or interviews (+$10)"
          field="hasResearchBonus"
          isActive={article.hasResearchBonus || false}
          disabled={article.paymentStatus}
        />
        <BonusToggle
          articleId={article.id}
          label="Time-Sensitive"
          description="Short notice or breaking news (+$5)"
          field="hasTimeSensitiveBonus"
          isActive={article.hasTimeSensitiveBonus || false}
          disabled={article.paymentStatus}
        />
        <BonusToggle
          articleId={article.id}
          label="Professional Photos"
          description="High-quality professional photos (+$15)"
          field="hasProfessionalPhotos"
          isActive={article.hasProfessionalPhotos || false}
          disabled={article.paymentStatus}
        />
        <BonusToggle
          articleId={article.id}
          label="Professional Graphics"
          description="Professional graphics/infographics (+$15)"
          field="hasProfessionalGraphics"
          isActive={article.hasProfessionalGraphics || false}
          disabled={article.paymentStatus}
        />
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {!article.paymentStatus ? (
          <>
            {/* Mark as Paid - only show if payment amount is set */}
            {article.paymentAmount && article.paymentAmount > 0 && (
              <Button
                variant="primary"
                size="sm"
                onClick={handleMarkAsPaid}
                disabled={isMarkingPaid}
              >
                {isMarkingPaid ? (
                  <LoadingSpinner size="sm" />
                ) : (
                  <>
                    <Check className="w-3 h-3 mr-1" />
                    Mark as Paid
                  </>
                )}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRecalculate}
              disabled={isRecalculating}
            >
              {isRecalculating ? (
                <LoadingSpinner size="sm" />
              ) : (
                <>
                  <RefreshCw className="w-3 h-3 mr-1" />
                  Recalculate
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowManualInput(!showManualInput)}
            >
              <Calculator className="w-3 h-3 mr-1" />
              {showManualInput ? 'Cancel' : 'Set Manual'}
            </Button>
          </>
        ) : (
          /* When already paid - show Mark as Unpaid and Adjust Payment options */
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleMarkAsUnpaid}
              disabled={isMarkingPaid}
            >
              {isMarkingPaid ? (
                <LoadingSpinner size="sm" />
              ) : (
                <>
                  <X className="w-3 h-3 mr-1" />
                  Mark as Unpaid
                </>
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowManualInput(!showManualInput)}
            >
              <Edit2 className="w-3 h-3 mr-1" />
              {showManualInput ? 'Cancel' : 'Adjust Amount'}
            </Button>
          </>
        )}
      </div>

      {/* Manual Amount Input */}
      {showManualInput && (
        <div className="space-y-2">
          {article.paymentStatus && (
            <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>
              Adjust the paid amount (for corrections only)
            </p>
          )}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <DollarSign
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
                style={{ color: 'var(--fg-faint)' }}
              />
              <input
                type="number"
                step="0.01"
                min="0"
                value={manualAmount}
                onChange={(e) => setManualAmount(e.target.value)}
                placeholder={article.paymentAmount ? (article.paymentAmount / 100).toFixed(2) : '0.00'}
                className="input pl-9 w-full"
              />
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSaveManual}
              disabled={isSavingManual || !manualAmount}
            >
              {isSavingManual ? <LoadingSpinner size="sm" /> : 'Save'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
