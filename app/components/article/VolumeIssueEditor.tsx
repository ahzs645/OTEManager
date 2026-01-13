import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronDown, Save, Check } from 'lucide-react'
import { Button, LoadingSpinner } from '~/components/Layout'
import { updateArticleIssue } from '~/lib/mutations'
import { useTrackUnsaved } from './UnsavedChangesContext'

type VolumeWithIssues = {
  id: string
  volumeNumber: number
  year: number | null
  issues: Array<{
    id: string
    issueNumber: number
    title: string | null
    releaseDate: Date | null
  }>
}

type CurrentIssue = {
  id: string
  issueNumber: number
  title: string | null
  volume: {
    id: string
    volumeNumber: number
  }
} | null

interface VolumeIssueEditorProps {
  articleId: string
  volumes: VolumeWithIssues[]
  currentIssueId: string | null
  currentIssue: CurrentIssue
  /** 'sidebar' shows stacked dropdowns, 'inline' shows horizontal layout */
  variant?: 'sidebar' | 'inline'
  /** Callback when issue is saved - receives the new issue data */
  onSave?: (newIssue: CurrentIssue) => void
}

export function VolumeIssueEditor({
  articleId,
  volumes,
  currentIssueId,
  currentIssue,
  variant = 'sidebar',
  onSave,
}: VolumeIssueEditorProps) {
  const initialVolumeId = currentIssue?.volume?.id || ''

  const [selectedVolumeId, setSelectedVolumeId] = useState<string>(initialVolumeId)
  const [selectedIssueId, setSelectedIssueId] = useState<string>(currentIssueId || '')
  const [isSaving, setIsSaving] = useState(false)
  const [savedIssueId, setSavedIssueId] = useState<string>(currentIssueId || '')

  const selectedVolume = volumes.find((v) => v.id === selectedVolumeId)
  const availableIssues = selectedVolume?.issues || []
  const hasChanges = selectedIssueId !== savedIssueId

  // Track unsaved changes globally
  useTrackUnsaved('publication', 'Publication', hasChanges)

  const handleVolumeChange = (volumeId: string) => {
    setSelectedVolumeId(volumeId)
    setSelectedIssueId('')
  }

  const handleIssueChange = (issueId: string) => {
    setSelectedIssueId(issueId)
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const result = await updateArticleIssue({
        data: {
          articleId,
          issueId: selectedIssueId || null,
        },
      })
      if (result.success) {
        setSavedIssueId(selectedIssueId)
        // Build the new issue object for the callback
        if (selectedIssueId && selectedVolume) {
          const selectedIssue = availableIssues.find((i) => i.id === selectedIssueId)
          if (selectedIssue) {
            onSave?.({
              id: selectedIssue.id,
              issueNumber: selectedIssue.issueNumber,
              title: selectedIssue.title,
              volume: {
                id: selectedVolume.id,
                volumeNumber: selectedVolume.volumeNumber,
              },
            })
          }
        } else {
          onSave?.(null)
        }
      }
    } catch (error) {
      console.error('Failed to save publication info:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleClear = async () => {
    setIsSaving(true)
    try {
      const result = await updateArticleIssue({
        data: {
          articleId,
          issueId: null,
        },
      })
      if (result.success) {
        setSelectedVolumeId('')
        setSelectedIssueId('')
        setSavedIssueId('')
        onSave?.(null)
      }
    } catch (error) {
      console.error('Failed to clear publication info:', error)
    } finally {
      setIsSaving(false)
    }
  }

  // No volumes message
  if (volumes.length === 0) {
    if (variant === 'inline') {
      return (
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: 'var(--fg-muted)' }}>
            No volumes configured.
          </span>
          <Link
            to="/publications"
            className="text-xs"
            style={{ color: 'var(--accent)' }}
          >
            Create volumes →
          </Link>
        </div>
      )
    }

    return (
      <div className="space-y-3">
        <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
          No publication volumes configured yet.
        </p>
        <Link
          to="/publications"
          className="text-xs"
          style={{ color: 'var(--accent)' }}
        >
          Go to Publications to create volumes →
        </Link>
      </div>
    )
  }

  // Inline variant
  if (variant === 'inline') {
    return (
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs font-medium" style={{ color: 'var(--fg-muted)' }}>
          Publication:
        </span>

        {/* Volume Dropdown */}
        <div className="relative">
          <select
            value={selectedVolumeId}
            onChange={(e) => handleVolumeChange(e.target.value)}
            className="select-trigger pr-7 text-sm"
            style={{ minWidth: '130px', padding: '0.35rem 0.5rem' }}
          >
            <option value="">Select volume...</option>
            {volumes.map((volume) => (
              <option key={volume.id} value={volume.id}>
                Volume {volume.volumeNumber}
                {volume.year ? ` (${volume.year})` : ''}
              </option>
            ))}
          </select>
          <ChevronDown
            className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none"
            style={{ color: 'var(--fg-faint)' }}
          />
        </div>

        {/* Issue Dropdown */}
        {selectedVolumeId && (
          <div className="relative">
            <select
              value={selectedIssueId}
              onChange={(e) => handleIssueChange(e.target.value)}
              className="select-trigger pr-7 text-sm"
              style={{ minWidth: '120px', padding: '0.35rem 0.5rem' }}
              disabled={availableIssues.length === 0}
            >
              <option value="">
                {availableIssues.length === 0 ? 'No issues' : 'Select issue...'}
              </option>
              {availableIssues.map((issue) => (
                <option key={issue.id} value={issue.id}>
                  Issue {issue.issueNumber}
                  {issue.title ? ` - ${issue.title}` : ''}
                </option>
              ))}
            </select>
            <ChevronDown
              className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none"
              style={{ color: 'var(--fg-faint)' }}
            />
          </div>
        )}

        {/* Save Button */}
        {hasChanges && (
          <Button
            onClick={handleSave}
            disabled={isSaving}
            variant="primary"
            size="sm"
          >
            {isSaving ? <LoadingSpinner size="sm" /> : 'Save'}
          </Button>
        )}

        {/* Current assignment + Clear */}
        {currentIssue && !hasChanges && (
          <button
            onClick={handleClear}
            disabled={isSaving}
            className="text-xs"
            style={{ color: 'var(--fg-faint)' }}
            title="Clear publication assignment"
          >
            Clear
          </button>
        )}
      </div>
    )
  }

  // Sidebar variant (default)
  return (
    <div className="space-y-3">
      {/* Volume Dropdown */}
      <div>
        <label
          className="block text-xs mb-1"
          style={{ color: 'var(--fg-muted)' }}
        >
          Volume
        </label>
        <div className="relative">
          <select
            value={selectedVolumeId}
            onChange={(e) => handleVolumeChange(e.target.value)}
            className="select-trigger w-full pr-8"
          >
            <option value="">Select volume...</option>
            {volumes.map((volume) => (
              <option key={volume.id} value={volume.id}>
                Volume {volume.volumeNumber}
                {volume.year ? ` (${volume.year})` : ''}
              </option>
            ))}
          </select>
          <ChevronDown
            className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
            style={{ color: 'var(--fg-faint)' }}
          />
        </div>
      </div>

      {/* Issue Dropdown - only shown when volume is selected */}
      {selectedVolumeId && (
        <div>
          <label
            className="block text-xs mb-1"
            style={{ color: 'var(--fg-muted)' }}
          >
            Issue
          </label>
          <div className="relative">
            <select
              value={selectedIssueId}
              onChange={(e) => handleIssueChange(e.target.value)}
              className="select-trigger w-full pr-8"
              disabled={availableIssues.length === 0}
            >
              <option value="">
                {availableIssues.length === 0 ? 'No issues in this volume' : 'Select issue...'}
              </option>
              {availableIssues.map((issue) => (
                <option key={issue.id} value={issue.id}>
                  Issue {issue.issueNumber}
                  {issue.title ? ` - ${issue.title}` : ''}
                </option>
              ))}
            </select>
            <ChevronDown
              className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
              style={{ color: 'var(--fg-faint)' }}
            />
          </div>
        </div>
      )}

      {/* Save/Clear buttons */}
      {hasChanges && (
        <Button
          onClick={handleSave}
          disabled={isSaving}
          variant="primary"
          size="sm"
          className="w-full"
        >
          {isSaving ? (
            <LoadingSpinner size="sm" />
          ) : (
            <>
              <Save className="w-3 h-3" />
              Save Changes
            </>
          )}
        </Button>
      )}

      {/* Current assignment display */}
      {currentIssue && !hasChanges && (
        <div className="flex items-center justify-between">
          <p className="text-xs" style={{ color: 'var(--fg-muted)' }}>
            Volume {currentIssue.volume.volumeNumber} · Issue {currentIssue.issueNumber}
            {currentIssue.title && ` (${currentIssue.title})`}
          </p>
          <button
            onClick={handleClear}
            disabled={isSaving}
            className="text-xs"
            style={{ color: 'var(--fg-faint)' }}
          >
            Clear
          </button>
        </div>
      )}
    </div>
  )
}
