import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronRight, ChevronDown, FileText, Pencil, Trash2, Plus } from 'lucide-react'
import { VolumeForm } from './VolumeForm'
import { IssueForm } from './IssueForm'
import { IssueRow } from './IssueRow'
import {
  type Volume,
  type Issue,
  type VolumeFormData,
  type IssueFormData,
  emptyVolumeForm,
  emptyIssueForm,
} from './types'
import {
  updateVolume,
  deleteVolume,
  createIssue,
  updateIssue,
  deleteIssue,
} from '~/lib/mutations'

interface VolumeCardProps {
  volume: Volume
  isExpanded: boolean
  onToggle: () => void
}

export function VolumeCard({ volume, isExpanded, onToggle }: VolumeCardProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editingIssueId, setEditingIssueId] = useState<string | null>(null)
  const [showNewIssueForm, setShowNewIssueForm] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [exportingIssueId, setExportingIssueId] = useState<string | null>(null)

  const [volumeForm, setVolumeForm] = useState<VolumeFormData>(emptyVolumeForm)
  const [issueForm, setIssueForm] = useState<IssueFormData>(emptyIssueForm)

  const getVolumeArticleCount = () => {
    return volume.issues.reduce((sum, issue) => sum + (issue.articleCount || 0), 0)
  }

  const startEditVolume = () => {
    setIsEditing(true)
    setVolumeForm({
      volumeNumber: volume.volumeNumber.toString(),
      year: volume.year?.toString() || '',
      startDate: volume.startDate ? new Date(volume.startDate).toISOString().split('T')[0] : '',
      endDate: volume.endDate ? new Date(volume.endDate).toISOString().split('T')[0] : '',
      description: volume.description || '',
    })
  }

  const handleUpdateVolume = async () => {
    setIsLoading(true)
    try {
      await updateVolume({
        data: {
          id: volume.id,
          volumeNumber: parseInt(volumeForm.volumeNumber),
          year: volumeForm.year ? parseInt(volumeForm.year) : undefined,
          startDate: volumeForm.startDate || undefined,
          endDate: volumeForm.endDate || undefined,
          description: volumeForm.description || undefined,
        },
      })
      setIsEditing(false)
      window.location.reload()
    } catch (error) {
      console.error('Failed to update volume:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleDeleteVolume = async () => {
    if (!confirm('Are you sure you want to delete this volume and all its issues?')) return
    setIsLoading(true)
    try {
      await deleteVolume({ data: { id: volume.id } })
      window.location.reload()
    } catch (error) {
      console.error('Failed to delete volume:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const startEditIssue = (issue: Issue) => {
    setEditingIssueId(issue.id)
    setIssueForm({
      issueNumber: issue.issueNumber.toString(),
      title: issue.title || '',
      releaseDate: issue.releaseDate ? new Date(issue.releaseDate).toISOString().split('T')[0] : '',
      description: issue.description || '',
    })
  }

  const handleCreateIssue = async () => {
    if (!issueForm.issueNumber) return
    setIsLoading(true)
    try {
      await createIssue({
        data: {
          volumeId: volume.id,
          issueNumber: parseInt(issueForm.issueNumber),
          title: issueForm.title || undefined,
          releaseDate: issueForm.releaseDate || undefined,
          description: issueForm.description || undefined,
        },
      })
      setShowNewIssueForm(false)
      setIssueForm(emptyIssueForm)
      window.location.reload()
    } catch (error) {
      console.error('Failed to create issue:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleUpdateIssue = async () => {
    if (!editingIssueId) return
    setIsLoading(true)
    try {
      await updateIssue({
        data: {
          id: editingIssueId,
          issueNumber: parseInt(issueForm.issueNumber),
          title: issueForm.title || undefined,
          releaseDate: issueForm.releaseDate || undefined,
          description: issueForm.description || undefined,
        },
      })
      setEditingIssueId(null)
      window.location.reload()
    } catch (error) {
      console.error('Failed to update issue:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleDeleteIssue = async (issueId: string) => {
    if (!confirm('Are you sure you want to delete this issue?')) return
    setIsLoading(true)
    try {
      await deleteIssue({ data: { id: issueId } })
      window.location.reload()
    } catch (error) {
      console.error('Failed to delete issue:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleExportIssue = async (issueId: string, issueNumber: number) => {
    setExportingIssueId(issueId)
    try {
      const response = await fetch(`/api/exportIssue/${issueId}`)
      if (!response.ok) {
        const errorData = await response.json()
        alert(`Export failed: ${errorData.error || 'Unknown error'}`)
        return
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Volume_${volume.volumeNumber}_Issue_${issueNumber}_Export.zip`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
    } catch (error) {
      console.error('Export failed:', error)
      alert('Failed to export issue. Please try again.')
    } finally {
      setExportingIssueId(null)
    }
  }

  // Editing mode
  if (isEditing) {
    return (
      <div
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          borderRadius: '8px',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--fg-muted)', marginBottom: '0.25rem' }}>
                Volume Number
              </label>
              <input
                type="number"
                className="input"
                value={volumeForm.volumeNumber}
                onChange={(e) => setVolumeForm({ ...volumeForm, volumeNumber: e.target.value })}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--fg-muted)', marginBottom: '0.25rem' }}>
                Year
              </label>
              <input
                type="number"
                className="input"
                value={volumeForm.year}
                onChange={(e) => setVolumeForm({ ...volumeForm, year: e.target.value })}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--fg-muted)', marginBottom: '0.25rem' }}>
                Start Date
              </label>
              <input
                type="date"
                className="input"
                value={volumeForm.startDate}
                onChange={(e) => setVolumeForm({ ...volumeForm, startDate: e.target.value })}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--fg-muted)', marginBottom: '0.25rem' }}>
                End Date
              </label>
              <input
                type="date"
                className="input"
                value={volumeForm.endDate}
                onChange={(e) => setVolumeForm({ ...volumeForm, endDate: e.target.value })}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={handleUpdateVolume}
              disabled={isLoading}
            >
              Save
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setIsEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        borderRadius: '8px',
        overflow: 'hidden',
      }}
    >
      {/* Volume Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '0.75rem 1rem',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={onToggle}
      >
        <div style={{ marginRight: '0.5rem', color: 'var(--fg-muted)' }}>
          {isExpanded ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </div>
        <div style={{ flex: 1 }}>
          <span style={{ fontWeight: 600, color: 'var(--fg-default)' }}>
            Volume {volume.volumeNumber}
          </span>
          {volume.year && (
            <span style={{ color: 'var(--fg-muted)', marginLeft: '0.5rem' }}>
              ({volume.year})
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }} onClick={(e) => e.stopPropagation()}>
          <span style={{ fontSize: '0.75rem', color: 'var(--fg-muted)' }}>
            {volume.issues.length} issue{volume.issues.length !== 1 ? 's' : ''}
          </span>
          <Link
            to="/articles"
            search={{ volumeId: volume.id }}
            style={{
              fontSize: '0.75rem',
              color: 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.25rem',
              textDecoration: 'none',
            }}
          >
            <FileText className="w-3 h-3" />
            {getVolumeArticleCount()} article{getVolumeArticleCount() !== 1 ? 's' : ''}
          </Link>
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={startEditVolume}
              title="Edit"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleDeleteVolume}
              title="Delete"
              style={{ color: 'var(--status-error)' }}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Issues List */}
      {isExpanded && (
        <div
          style={{
            borderTop: '1px solid var(--border-default)',
            background: 'var(--bg-subtle)',
          }}
        >
          {volume.issues.length === 0 ? (
            <div style={{ padding: '1rem', paddingLeft: '2.5rem' }}>
              <p style={{ fontSize: '0.875rem', color: 'var(--fg-muted)' }}>
                No issues in this volume yet.
              </p>
            </div>
          ) : (
            <div>
              {volume.issues.map((issue) => (
                <div
                  key={issue.id}
                  style={{
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  {editingIssueId === issue.id ? (
                    <IssueForm
                      form={issueForm}
                      onChange={setIssueForm}
                      onSubmit={handleUpdateIssue}
                      onCancel={() => setEditingIssueId(null)}
                      isLoading={isLoading}
                      submitLabel="Save"
                    />
                  ) : (
                    <IssueRow
                      issue={issue}
                      volumeNumber={volume.volumeNumber}
                      onEdit={() => startEditIssue(issue)}
                      onDelete={() => handleDeleteIssue(issue.id)}
                      onExport={() => handleExportIssue(issue.id, issue.issueNumber)}
                      isExporting={exportingIssueId === issue.id}
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* New Issue Form */}
          {showNewIssueForm ? (
            <IssueForm
              form={issueForm}
              onChange={setIssueForm}
              onSubmit={handleCreateIssue}
              onCancel={() => {
                setShowNewIssueForm(false)
                setIssueForm(emptyIssueForm)
              }}
              isLoading={isLoading}
              submitLabel="Add Issue"
            />
          ) : (
            <div style={{ padding: '0.5rem 1rem', paddingLeft: '2.5rem' }}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setShowNewIssueForm(true)
                  setIssueForm(emptyIssueForm)
                }}
              >
                <Plus className="w-3.5 h-3.5" />
                Add Issue
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
