import { StatusBadge, formatDate, Section } from '~/components/Layout'

interface HistoryEntry {
  id: string
  fromStatus: string | null
  toStatus: string
  changedAt: Date
  changedBy: string | null
}

interface StatusHistoryProps {
  history: HistoryEntry[]
}

export function StatusHistory({ history }: StatusHistoryProps) {
  return (
    <Section title="Status History" noPadding>
      {history.length === 0 ? (
        <div className="px-4 py-3">
          <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
            No status changes yet
          </p>
        </div>
      ) : (
        <div className="px-4 py-3">
          <div className="space-y-3">
            {history.map((entry) => (
              <div key={entry.id} className="flex items-start gap-3">
                <div
                  className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                  style={{ background: 'var(--fg-faint)' }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {entry.fromStatus && (
                      <>
                        <StatusBadge status={entry.fromStatus} />
                        <span style={{ color: 'var(--fg-faint)' }}>
                          →
                        </span>
                      </>
                    )}
                    <StatusBadge status={entry.toStatus} />
                  </div>
                  <p
                    className="text-xs mt-1"
                    style={{ color: 'var(--fg-muted)' }}
                  >
                    {formatDate(entry.changedAt)}
                    {entry.changedBy && ` · ${entry.changedBy}`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Section>
  )
}
