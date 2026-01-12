import type { IssueFormData } from './types'

interface IssueFormProps {
  form: IssueFormData
  onChange: (form: IssueFormData) => void
  onSubmit: () => void
  onCancel: () => void
  isLoading: boolean
  submitLabel: string
}

export function IssueForm({
  form,
  onChange,
  onSubmit,
  onCancel,
  isLoading,
  submitLabel,
}: IssueFormProps) {
  return (
    <div style={{ padding: '0.75rem 1rem', paddingLeft: '2.5rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--fg-muted)', marginBottom: '0.25rem' }}>
            Issue Number *
          </label>
          <input
            type="number"
            className="input"
            value={form.issueNumber}
            onChange={(e) => onChange({ ...form, issueNumber: e.target.value })}
            placeholder="1"
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--fg-muted)', marginBottom: '0.25rem' }}>
            Title
          </label>
          <input
            type="text"
            className="input"
            value={form.title}
            onChange={(e) => onChange({ ...form, title: e.target.value })}
            placeholder="Fall Edition"
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--fg-muted)', marginBottom: '0.25rem' }}>
            Release Date
          </label>
          <input
            type="date"
            className="input"
            value={form.releaseDate}
            onChange={(e) => onChange({ ...form, releaseDate: e.target.value })}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--fg-muted)', marginBottom: '0.25rem' }}>
            Description
          </label>
          <input
            type="text"
            className="input"
            value={form.description}
            onChange={(e) => onChange({ ...form, description: e.target.value })}
          />
        </div>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
        <button
          className="btn btn-primary btn-sm"
          onClick={onSubmit}
          disabled={isLoading || !form.issueNumber}
        >
          {isLoading ? 'Saving...' : submitLabel}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
