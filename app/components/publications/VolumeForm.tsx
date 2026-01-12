import type { VolumeFormData } from './types'

interface VolumeFormProps {
  form: VolumeFormData
  onChange: (form: VolumeFormData) => void
  onSubmit: () => void
  onCancel: () => void
  isLoading: boolean
  submitLabel: string
  title?: string
}

export function VolumeForm({
  form,
  onChange,
  onSubmit,
  onCancel,
  isLoading,
  submitLabel,
  title,
}: VolumeFormProps) {
  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-default)',
        borderRadius: '8px',
        padding: '1rem',
      }}
    >
      {title && (
        <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '1rem' }}>
          {title}
        </h3>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--fg-muted)', marginBottom: '0.25rem' }}>
            Volume Number *
          </label>
          <input
            type="number"
            className="input"
            value={form.volumeNumber}
            onChange={(e) => onChange({ ...form, volumeNumber: e.target.value })}
            placeholder="31"
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--fg-muted)', marginBottom: '0.25rem' }}>
            Year
          </label>
          <input
            type="number"
            className="input"
            value={form.year}
            onChange={(e) => onChange({ ...form, year: e.target.value })}
            placeholder="2025"
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--fg-muted)', marginBottom: '0.25rem' }}>
            Start Date
          </label>
          <input
            type="date"
            className="input"
            value={form.startDate}
            onChange={(e) => onChange({ ...form, startDate: e.target.value })}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--fg-muted)', marginBottom: '0.25rem' }}>
            End Date
          </label>
          <input
            type="date"
            className="input"
            value={form.endDate}
            onChange={(e) => onChange({ ...form, endDate: e.target.value })}
          />
        </div>
      </div>
      <div style={{ marginTop: '0.75rem' }}>
        <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--fg-muted)', marginBottom: '0.25rem' }}>
          Description
        </label>
        <input
          type="text"
          className="input"
          style={{ width: '100%' }}
          value={form.description}
          onChange={(e) => onChange({ ...form, description: e.target.value })}
          placeholder="Optional description"
        />
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
        <button
          className="btn btn-primary"
          onClick={onSubmit}
          disabled={isLoading || !form.volumeNumber}
        >
          {isLoading ? 'Saving...' : submitLabel}
        </button>
        <button className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
