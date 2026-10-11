import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { migrateLegacyVolumeIssues } from '~/lib/mutations'

interface MigrationResult {
  success: boolean
  message?: string
  created?: { volumes: number; issues: number }
  linked?: number
  error?: string
}

export function MigrateLegacyButton({ label = 'Import from Articles' }: { label?: string }) {
  const router = useRouter()
  const [isMigrating, setIsMigrating] = useState(false)
  const [result, setResult] = useState<MigrationResult | null>(null)

  const handleMigrate = async () => {
    setIsMigrating(true)
    setResult(null)
    try {
      const res = await migrateLegacyVolumeIssues()
      setResult(res)
      if (res.success && res.linked) {
        // Show the success message briefly, then refresh route data in place
        setTimeout(() => router.invalidate(), 1500)
      }
    } catch (error) {
      setResult({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      setIsMigrating(false)
    }
  }

  return (
    <div style={{ display: 'inline-block' }}>
      <button className="btn btn-secondary" onClick={handleMigrate} disabled={isMigrating}>
        {isMigrating ? 'Linking...' : label}
      </button>
      {result && (
        <p
          style={{
            marginTop: '0.5rem',
            fontSize: '0.75rem',
            color: result.success ? 'var(--status-success)' : 'var(--status-error)',
          }}
        >
          {result.success
            ? !result.linked
              ? 'No legacy data found'
              : `Linked ${result.linked} article${result.linked === 1 ? '' : 's'}` +
                (result.created?.volumes || result.created?.issues
                  ? ` (created ${result.created.volumes} volumes and ${result.created.issues} issues)`
                  : '')
            : result.error}
        </p>
      )}
    </div>
  )
}
