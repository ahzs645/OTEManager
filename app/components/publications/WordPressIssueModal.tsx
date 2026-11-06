import { useState } from 'react'
import { Send, X } from 'lucide-react'
import { sendIssueToWordPress } from '~/lib/mutations'
import { WordPressResults, type WordPressSendResult } from '~/components/article/WordPressResults'

interface Summary {
  created: number
  updated: number
  unchanged: number
  skipped: number
  failed: number
  warned: number
}

/** Confirms and runs "send this issue's approved articles to WordPress". */
export function WordPressIssueModal({
  issueId,
  label,
  onClose,
}: {
  issueId: string
  label: string
  onClose: () => void
}) {
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<WordPressSendResult[] | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)

  const send = async () => {
    setSending(true)
    setError(null)
    try {
      const response = await sendIssueToWordPress({ data: { issueId } })
      if (!response.success) setError(response.error)
      else {
        setResults(response.results)
        setSummary(response.summary)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sending failed.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="wp-issue-title" style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0, 0, 0, 0.5)', backdropFilter: 'blur(4px)' }} onClick={sending ? undefined : onClose} />
      <div className="section" style={{ position: 'relative', width: '100%', maxWidth: '40rem', maxHeight: '85vh', overflowY: 'auto', background: 'var(--bg-surface)', padding: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h2 id="wp-issue-title" className="section-title">Send {label} to WordPress</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={sending} aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        {!results && (
          <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
            Every approved article in this issue is sent as a WordPress draft with its byline and selected photos.
            Articles that are not approved yet are skipped, and posts already published in WordPress are not changed.
            Sending again updates the same drafts instead of creating new ones.
          </p>
        )}
        {summary && (
          <p className="text-sm mb-3" role="status" style={{ color: 'var(--fg-default)' }}>
            {summary.created} created, {summary.updated} updated, {summary.unchanged} unchanged, {summary.skipped} skipped, {summary.failed} failed
            {summary.warned ? `, ${summary.warned} with warnings` : ''}.
          </p>
        )}
        {results && <WordPressResults results={results} />}
        {error && <p className="text-sm mt-3" role="alert" style={{ color: 'var(--status-error)' }}>{error}</p>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={sending}>{results ? 'Done' : 'Cancel'}</button>
          {!results && (
            <button className="btn btn-primary" onClick={send} disabled={sending}>
              <Send className="w-4 h-4" /> {sending ? 'Sending…' : 'Send drafts'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
