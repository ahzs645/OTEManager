import { useState, useEffect, useRef } from 'react'
import { Bookmark, ChevronDown, Star, Trash2, Plus, Check } from 'lucide-react'
import { Button } from '~/components/Layout'
import {
  getSavedViews,
  createSavedView,
  deleteSavedView,
  setDefaultView,
  clearDefaultView,
  type SavedView,
  type SavedViewConfig,
} from '~/lib/mutations'

interface SavedViewSelectorProps {
  currentConfig: SavedViewConfig
  onSelectView: (config: SavedViewConfig, viewId: string) => void
  activeViewId?: string
  onActiveViewChange: (id: string | undefined) => void
}

export function SavedViewSelector({
  currentConfig,
  onSelectView,
  activeViewId,
  onActiveViewChange,
}: SavedViewSelectorProps) {
  const [views, setViews] = useState<SavedView[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [newViewName, setNewViewName] = useState('')
  const [setAsDefault, setSetAsDefault] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const menuRef = useRef<HTMLDivElement>(null)

  // Fetch saved views on mount
  useEffect(() => {
    loadViews()
  }, [])

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        setIsCreating(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const loadViews = async () => {
    setIsLoading(true)
    const result = await getSavedViews()
    if (result.success) {
      setViews(result.views as SavedView[])
    }
    setIsLoading(false)
  }

  const handleSelectView = (view: SavedView) => {
    onSelectView({
      status: view.status || undefined,
      tier: view.tier || undefined,
      search: view.search || undefined,
      sortBy: view.sortBy || undefined,
      sortOrder: view.sortOrder || undefined,
      viewMode: view.viewMode || 'list',
    }, view.id)
    setIsOpen(false)
  }

  const handleSaveView = async () => {
    if (!newViewName.trim()) return

    const result = await createSavedView({
      data: {
        name: newViewName.trim(),
        config: currentConfig,
        setAsDefault,
      },
    })

    if (result.success && result.view) {
      await loadViews()
      setIsCreating(false)
      setNewViewName('')
      setSetAsDefault(false)
      onActiveViewChange(result.view.id)
    }
  }

  const handleDeleteView = async (e: React.MouseEvent, viewId: string) => {
    e.stopPropagation()
    const result = await deleteSavedView({ data: { id: viewId } })
    if (result.success) {
      await loadViews()
      if (activeViewId === viewId) {
        onActiveViewChange(undefined)
      }
    }
  }

  const handleToggleDefault = async (e: React.MouseEvent, view: SavedView) => {
    e.stopPropagation()
    if (view.isDefault) {
      await clearDefaultView()
    } else {
      await setDefaultView({ data: { id: view.id } })
    }
    await loadViews()
  }

  const activeView = views.find((v) => v.id === activeViewId)

  return (
    <div className="relative" ref={menuRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors hover:opacity-80"
        style={{
          background: activeView ? 'var(--accent-subtle)' : 'var(--bg-subtle)',
          color: activeView ? 'var(--accent)' : 'var(--fg-muted)',
          border: '0.5px solid var(--border-default)',
        }}
      >
        <Bookmark className="w-3.5 h-3.5" />
        <span>{activeView?.name || 'Views'}</span>
        <ChevronDown className="w-3 h-3" />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div
          className="absolute top-full left-0 mt-1 z-50 min-w-64 rounded-lg shadow-lg overflow-hidden"
          style={{
            background: 'var(--bg-surface)',
            border: '0.5px solid var(--border-default)',
          }}
        >
          {/* Saved Views List */}
          {isLoading ? (
            <div className="py-4 text-center text-sm" style={{ color: 'var(--fg-muted)' }}>
              Loading...
            </div>
          ) : views.length > 0 ? (
            <div className="py-1">
              {views.map((view) => (
                <button
                  key={view.id}
                  onClick={() => handleSelectView(view)}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm transition-colors"
                  style={{
                    color: 'var(--fg-default)',
                    background: activeViewId === view.id ? 'var(--bg-subtle)' : 'transparent',
                  }}
                  onMouseEnter={(e) => {
                    if (activeViewId !== view.id) {
                      e.currentTarget.style.background = 'var(--bg-subtle)'
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (activeViewId !== view.id) {
                      e.currentTarget.style.background = 'transparent'
                    }
                  }}
                >
                  <div className="flex items-center gap-2">
                    {activeViewId === view.id ? (
                      <Check className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                    ) : (
                      <div className="w-3.5" />
                    )}
                    <span>{view.name}</span>
                    {view.isDefault && (
                      <span
                        className="text-xs px-1.5 py-0.5 rounded"
                        style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}
                      >
                        default
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => handleToggleDefault(e, view)}
                      className="p-1 rounded transition-colors"
                      title={view.isDefault ? 'Remove default' : 'Set as default'}
                      style={{ background: 'transparent' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-muted)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <Star
                        className="w-3.5 h-3.5"
                        style={{
                          color: view.isDefault ? 'var(--status-warning)' : 'var(--fg-faint)',
                          fill: view.isDefault ? 'var(--status-warning)' : 'none',
                        }}
                      />
                    </button>
                    <button
                      onClick={(e) => handleDeleteView(e, view.id)}
                      className="p-1 rounded transition-colors"
                      title="Delete view"
                      style={{ background: 'transparent' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-muted)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <Trash2 className="w-3.5 h-3.5" style={{ color: 'var(--fg-faint)' }} />
                    </button>
                  </div>
                </button>
              ))}
            </div>
          ) : null}

          {/* Divider */}
          {views.length > 0 && (
            <div style={{ borderTop: '0.5px solid var(--border-default)' }} />
          )}

          {/* Save Current View */}
          <div className="p-2">
            {isCreating ? (
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="View name..."
                  value={newViewName}
                  onChange={(e) => setNewViewName(e.target.value)}
                  className="input w-full text-sm"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveView()
                    if (e.key === 'Escape') {
                      setIsCreating(false)
                      setNewViewName('')
                    }
                  }}
                />
                <label
                  className="flex items-center gap-2 text-xs cursor-pointer"
                  style={{ color: 'var(--fg-muted)' }}
                >
                  <input
                    type="checkbox"
                    checked={setAsDefault}
                    onChange={(e) => setSetAsDefault(e.target.checked)}
                    className="rounded"
                  />
                  Set as default view
                </label>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setIsCreating(false)
                      setNewViewName('')
                    }}
                  >
                    Cancel
                  </Button>
                  <Button size="sm" variant="primary" onClick={handleSaveView}>
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setIsCreating(true)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded transition-colors"
                style={{ color: 'var(--fg-muted)', background: 'transparent' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-subtle)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <Plus className="w-3.5 h-3.5" />
                Save current view
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
