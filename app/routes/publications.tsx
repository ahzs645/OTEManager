import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { Plus } from 'lucide-react'
import { getVolumes } from '../lib/queries'
import { createVolume } from '../lib/mutations'
import {
  VolumeForm,
  VolumeCard,
  MigrateLegacyButton,
  type Volume,
  type VolumeFormData,
  emptyVolumeForm,
} from '~/components/publications'

export const Route = createFileRoute('/publications')({
  loader: async () => {
    const { volumes } = await getVolumes()
    return { volumes }
  },
  component: PublicationsPage,
})

function PublicationsPage() {
  const { volumes } = Route.useLoaderData()
  const [expandedVolumes, setExpandedVolumes] = useState<Set<string>>(
    new Set(volumes.map((v: Volume) => v.id))
  )
  const [showNewVolumeForm, setShowNewVolumeForm] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [volumeForm, setVolumeForm] = useState<VolumeFormData>(emptyVolumeForm)

  const toggleVolume = (volumeId: string) => {
    const newExpanded = new Set(expandedVolumes)
    if (newExpanded.has(volumeId)) {
      newExpanded.delete(volumeId)
    } else {
      newExpanded.add(volumeId)
    }
    setExpandedVolumes(newExpanded)
  }

  const handleCreateVolume = async () => {
    if (!volumeForm.volumeNumber) return
    setIsLoading(true)
    try {
      await createVolume({
        data: {
          volumeNumber: parseInt(volumeForm.volumeNumber),
          year: volumeForm.year ? parseInt(volumeForm.year) : undefined,
          startDate: volumeForm.startDate || undefined,
          endDate: volumeForm.endDate || undefined,
          description: volumeForm.description || undefined,
        },
      })
      setShowNewVolumeForm(false)
      setVolumeForm(emptyVolumeForm)
      window.location.reload()
    } catch (error) {
      console.error('Failed to create volume:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="page-container">
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '1.5rem',
        }}
      >
        <div>
          <h1
            style={{
              fontSize: '1.25rem',
              fontWeight: 600,
              color: 'var(--fg-default)',
              margin: 0,
              letterSpacing: '-0.02em',
            }}
          >
            Publications
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--fg-muted)', margin: '0.25rem 0 0 0' }}>
            Manage volumes and issues
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => {
            setShowNewVolumeForm(true)
            setVolumeForm(emptyVolumeForm)
          }}
        >
          <Plus className="w-4 h-4" />
          New Volume
        </button>
      </div>

      {/* New Volume Form */}
      {showNewVolumeForm && (
        <div style={{ marginBottom: '1rem' }}>
          <VolumeForm
            form={volumeForm}
            onChange={setVolumeForm}
            onSubmit={handleCreateVolume}
            onCancel={() => setShowNewVolumeForm(false)}
            isLoading={isLoading}
            submitLabel="Create Volume"
            title="Create New Volume"
          />
        </div>
      )}

      {/* Volumes List */}
      {volumes.length === 0 ? (
        <div
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            borderRadius: '8px',
            padding: '3rem',
            textAlign: 'center',
          }}
        >
          <p style={{ color: 'var(--fg-muted)', marginBottom: '1rem' }}>
            No volumes yet. Create your first volume or import from existing article data.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
            <button className="btn btn-primary" onClick={() => setShowNewVolumeForm(true)}>
              <Plus className="w-4 h-4" />
              Create Volume
            </button>
            <MigrateLegacyButton />
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {volumes.map((volume: Volume) => (
            <VolumeCard
              key={volume.id}
              volume={volume}
              isExpanded={expandedVolumes.has(volume.id)}
              onToggle={() => toggleVolume(volume.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
