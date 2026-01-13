import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'

interface UnsavedField {
  id: string
  label: string
}

interface UnsavedChangesContextType {
  unsavedFields: UnsavedField[]
  hasUnsavedChanges: boolean
  registerUnsaved: (id: string, label: string) => void
  unregisterUnsaved: (id: string) => void
}

const UnsavedChangesContext = createContext<UnsavedChangesContextType | null>(null)

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const [unsavedFields, setUnsavedFields] = useState<UnsavedField[]>([])

  const registerUnsaved = useCallback((id: string, label: string) => {
    setUnsavedFields((prev) => {
      if (prev.some((f) => f.id === id)) return prev
      return [...prev, { id, label }]
    })
  }, [])

  const unregisterUnsaved = useCallback((id: string) => {
    setUnsavedFields((prev) => prev.filter((f) => f.id !== id))
  }, [])

  const hasUnsavedChanges = unsavedFields.length > 0

  // Warn before leaving the page if there are unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault()
        e.returnValue = ''
        return ''
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUnsavedChanges])

  return (
    <UnsavedChangesContext.Provider
      value={{ unsavedFields, hasUnsavedChanges, registerUnsaved, unregisterUnsaved }}
    >
      {children}
    </UnsavedChangesContext.Provider>
  )
}

export function useUnsavedChanges() {
  const context = useContext(UnsavedChangesContext)
  if (!context) {
    // Return a no-op version if not wrapped in provider (for backwards compatibility)
    return {
      unsavedFields: [],
      hasUnsavedChanges: false,
      registerUnsaved: () => {},
      unregisterUnsaved: () => {},
    }
  }
  return context
}

// Hook for components to easily track their unsaved state
export function useTrackUnsaved(id: string, label: string, hasChanges: boolean) {
  const { registerUnsaved, unregisterUnsaved } = useUnsavedChanges()

  useEffect(() => {
    if (hasChanges) {
      registerUnsaved(id, label)
    } else {
      unregisterUnsaved(id)
    }

    return () => unregisterUnsaved(id)
  }, [id, label, hasChanges, registerUnsaved, unregisterUnsaved])
}

// Visual indicator component
export function UnsavedChangesIndicator() {
  const { unsavedFields, hasUnsavedChanges } = useUnsavedChanges()

  if (!hasUnsavedChanges) return null

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.5rem 0.75rem',
        background: 'rgba(245, 158, 11, 0.1)',
        border: '0.5px solid rgba(245, 158, 11, 0.3)',
        borderRadius: '6px',
        fontSize: '0.75rem',
        color: 'var(--status-warning)',
      }}
    >
      <div
        style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: 'var(--status-warning)',
          animation: 'pulse 2s infinite',
        }}
      />
      <span>
        Unsaved changes
        {unsavedFields.length > 0 && (
          <span style={{ color: 'var(--fg-muted)', marginLeft: '4px' }}>
            ({unsavedFields.map((f) => f.label).join(', ')})
          </span>
        )}
      </span>
    </div>
  )
}
