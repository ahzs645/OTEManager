import { useState } from 'react'
import { migrateLegacyVolumeIssues } from '~/lib/mutations'

interface MigrationResult {
  success: boolean
  message?: string
  created?: { volumes: number; issues: number }
  error?: string
}

export function MigrateLegacyButton() {
  const [isMigrating, setIsMigrating] = useState(false)
  const [result, setResult] = useState<MigrationResult | null>(null)

  const handleMigrate = async () => {
    setIsMigrating(true)
    setResult(null)
    try {
      const res = await migrateLegacyVolumeIssues()
      setResult(res)
      if (res.success && res.created && (res.created.volumes > 0 || res.created.issues > 0)) {
        setTimeout(() => window.location.reload(), 1500)
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
        {isMigrating ? 'Importing...' : 'Import from Articles'}
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
            ? result.created?.volumes === 0 && result.created?.issues === 0
              ? 'No legacy data found'
              : `Created ${result.created?.volumes} volumes and ${result.created?.issues} issues`
            : result.error}
        </p>
      )}
    </div>
  )
}
