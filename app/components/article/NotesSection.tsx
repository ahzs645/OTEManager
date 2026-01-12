import { useState } from 'react'
import { Send, Edit2, Trash2 } from 'lucide-react'
import { Button, LoadingSpinner, formatDate, Section } from '~/components/Layout'
import { addArticleNote, updateArticleNote, deleteArticleNote } from '~/lib/mutations'

interface Note {
  id: string
  content: string
  createdBy: string | null
  createdAt: Date
}

interface NotesSectionProps {
  articleId: string
  notes: Note[]
}

export function NotesSection({ articleId, notes }: NotesSectionProps) {
  const [newNote, setNewNote] = useState('')
  const [isAddingNote, setIsAddingNote] = useState(false)
  const [editingNote, setEditingNote] = useState<{ id: string; content: string } | null>(null)
  const [editNoteContent, setEditNoteContent] = useState('')
  const [isSavingNote, setIsSavingNote] = useState(false)
  const [isDeletingNote, setIsDeletingNote] = useState<string | null>(null)

  const handleAddNote = async () => {
    if (!newNote.trim()) return
    setIsAddingNote(true)
    try {
      await addArticleNote({
        data: {
          articleId,
          content: newNote,
        },
      })
      setNewNote('')
      window.location.reload()
    } catch (error) {
      console.error('Failed to add note:', error)
    } finally {
      setIsAddingNote(false)
    }
  }

  const handleEditNote = (note: { id: string; content: string }) => {
    setEditingNote(note)
    setEditNoteContent(note.content)
  }

  const handleSaveEditedNote = async () => {
    if (!editingNote || !editNoteContent.trim()) return
    setIsSavingNote(true)
    try {
      await updateArticleNote({
        data: {
          noteId: editingNote.id,
          content: editNoteContent,
        },
      })
      setEditingNote(null)
      setEditNoteContent('')
      window.location.reload()
    } catch (error) {
      console.error('Failed to update note:', error)
    } finally {
      setIsSavingNote(false)
    }
  }

  const handleCancelEditNote = () => {
    setEditingNote(null)
    setEditNoteContent('')
  }

  const handleDeleteNote = async (noteId: string) => {
    if (!confirm('Are you sure you want to delete this note?')) return
    setIsDeletingNote(noteId)
    try {
      await deleteArticleNote({ data: { noteId } })
      window.location.reload()
    } catch (error) {
      console.error('Failed to delete note:', error)
    } finally {
      setIsDeletingNote(null)
    }
  }

  return (
    <Section title="Editorial Notes" noPadding>
      <div className="px-4 py-3">
        {notes.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--fg-muted)' }}>
            No notes yet
          </p>
        ) : (
          <div className="space-y-3 mb-4">
            {notes.map((note) => (
              <div
                key={note.id}
                className="p-3 rounded-md"
                style={{
                  background: 'var(--bg-subtle)',
                  borderLeft: '2px solid var(--accent)',
                }}
              >
                {editingNote?.id === note.id ? (
                  // Edit mode
                  <div className="space-y-2">
                    <textarea
                      value={editNoteContent}
                      onChange={(e) => setEditNoteContent(e.target.value)}
                      className="w-full p-2 text-sm rounded"
                      style={{
                        background: 'var(--bg-surface)',
                        border: '1px solid var(--border-default)',
                        color: 'var(--fg-default)',
                        minHeight: '80px',
                      }}
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <Button
                        onClick={handleSaveEditedNote}
                        disabled={isSavingNote || !editNoteContent.trim()}
                        variant="primary"
                        size="sm"
                      >
                        {isSavingNote ? <LoadingSpinner size="sm" /> : 'Save'}
                      </Button>
                      <Button
                        onClick={handleCancelEditNote}
                        variant="ghost"
                        size="sm"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  // View mode
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <p
                        className="text-sm flex-1"
                        style={{ color: 'var(--fg-default)' }}
                      >
                        {note.content}
                      </p>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => handleEditNote(note)}
                          className="btn btn-ghost !p-1"
                          title="Edit note"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => handleDeleteNote(note.id)}
                          disabled={isDeletingNote === note.id}
                          className="btn btn-ghost !p-1"
                          title="Delete note"
                          style={{ color: 'var(--status-error)' }}
                        >
                          {isDeletingNote === note.id ? (
                            <LoadingSpinner size="sm" />
                          ) : (
                            <Trash2 className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                    </div>
                    <p
                      className="text-xs mt-2"
                      style={{ color: 'var(--fg-muted)' }}
                    >
                      {note.createdBy || 'Unknown'} ·{' '}
                      {formatDate(note.createdAt)}
                    </p>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Add Note Form */}
        <div className="flex gap-2 mt-3">
          <input
            type="text"
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Add a note..."
            className="input flex-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleAddNote()
              }
            }}
          />
          <Button
            onClick={handleAddNote}
            disabled={isAddingNote || !newNote.trim()}
            variant="primary"
          >
            {isAddingNote ? (
              <LoadingSpinner size="sm" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>
    </Section>
  )
}
