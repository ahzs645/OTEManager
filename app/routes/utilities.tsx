import { createFileRoute, Link } from '@tanstack/react-router'
import {
  FolderArchive,
  Upload,
  Database,
  ChevronRight,
} from 'lucide-react'

export const Route = createFileRoute('/utilities')({
  component: UtilitiesPage,
})

const utilities = [
  {
    id: 'wp-export',
    path: '/utilities/wp-export',
    title: 'WP Export Bundler',
    description: 'Export articles as JSON with optional photos for WordPress import',
    icon: FolderArchive,
  },
  {
    id: 'import',
    path: '/utilities/import',
    title: 'Import from SharePoint',
    description: 'Migrate existing article data from SharePoint JSON export',
    icon: Upload,
  },
  {
    id: 'backup',
    path: '/utilities/backup',
    title: 'Backup & Restore',
    description: 'Export or restore your entire database including all files',
    icon: Database,
  },
]

function UtilitiesPage() {
  return (
    <div className="page-container">
      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1
          style={{
            fontSize: '1.25rem',
            fontWeight: 600,
            color: 'var(--fg-default)',
            margin: 0,
            letterSpacing: '-0.02em',
          }}
        >
          Utilities
        </h1>
        <p style={{ fontSize: '0.875rem', color: 'var(--fg-muted)', margin: '0.25rem 0 0 0' }}>
          Import and export tools for managing your publication data
        </p>
      </div>

      {/* Utility Cards Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: '1rem',
        }}
      >
        {utilities.map((utility) => (
          <UtilityCard key={utility.id} utility={utility} />
        ))}
      </div>
    </div>
  )
}

function UtilityCard({
  utility,
}: {
  utility: (typeof utilities)[number]
}) {
  const Icon = utility.icon

  return (
    <Link
      to={utility.path}
      style={{
        display: 'block',
        background: 'var(--bg-surface)',
        border: '0.5px solid var(--border-default)',
        borderRadius: '8px',
        padding: '1.25rem',
        textDecoration: 'none',
        transition: 'all 0.15s ease',
      }}
      className="utility-card"
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
        <div
          style={{
            width: '44px',
            height: '44px',
            borderRadius: '10px',
            background: 'var(--bg-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Icon className="w-5 h-5" style={{ color: 'var(--fg-muted)' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: '0.9375rem',
              fontWeight: 600,
              color: 'var(--fg-default)',
              marginBottom: '0.25rem',
            }}
          >
            {utility.title}
          </div>
          <div
            style={{
              fontSize: '0.8125rem',
              color: 'var(--fg-muted)',
              lineHeight: 1.4,
            }}
          >
            {utility.description}
          </div>
        </div>
        <ChevronRight
          className="w-5 h-5"
          style={{ color: 'var(--fg-faint)', flexShrink: 0, marginTop: '2px' }}
        />
      </div>
    </Link>
  )
}
