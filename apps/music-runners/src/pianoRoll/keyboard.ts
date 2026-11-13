import type { PianoRollState, NoteData } from './state'
import { uid } from './utils'

export interface KeyboardControllerOptions {
  state: PianoRollState
  isInteractive: () => boolean
  undo: () => void
  redo: () => void
  deleteSelected: () => void
  updateCommandStackButtons: () => void
  executeOverlapChanges: (state: PianoRollState, ids: Set<string>) => void
  getContainer: () => HTMLElement | null
}

export interface KeyboardController {
  attach(): void
  detach(): void
  isAttached(): boolean
  /** The raw handler, for hosts that route key events themselves. */
  handleKeyDown(e: KeyboardEvent): void
}

const CLIPBOARD_KEY = 'copiedPianoRollNotes'

export const createKeyboardController = ({
  state,
  isInteractive,
  undo,
  redo,
  deleteSelected,
  updateCommandStackButtons,
  executeOverlapChanges,
  getContainer
}: KeyboardControllerOptions): KeyboardController => {
  let attached = false

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!isInteractive()) return
    // Typing into the metadata editor (or any field inside the wrapper) must not
    // move or delete notes.
    const target = e.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
      return
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault()
      undo()
      return
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && e.shiftKey) {
      e.preventDefault()
      redo()
      return
    }

    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault()
      deleteSelected()
      return
    }

    if (e.key.startsWith('Arrow') && state.selection.selectedIds.size > 0) {
      e.preventDefault()

      // Shift takes the larger step: an octave, or a whole beat.
      const pitchStep = e.shiftKey ? 12 : 1
      const timeStep = e.shiftKey ? 1 : 0.25

      state.command.stack?.executeCommand('Move Selection', () => {
        state.selection.selectedIds.forEach((id) => {
          const note = state.notes.get(id)
          if (!note) return

          switch (e.key) {
            case 'ArrowUp':
              note.pitch = Math.min(127, note.pitch + pitchStep)
              break
            case 'ArrowDown':
              note.pitch = Math.max(0, note.pitch - pitchStep)
              break
            case 'ArrowLeft':
              note.position = Math.max(0, note.position - timeStep)
              break
            case 'ArrowRight':
              note.position += timeStep
              break
          }
        })

        executeOverlapChanges(state, state.selection.selectedIds)
        state.needsRedraw = true
      })

      updateCommandStackButtons()
      return
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c' && state.selection.selectedIds.size > 0) {
      e.preventDefault()
      const copiedNotes = Array.from(state.selection.selectedIds)
        .map((id) => {
          const note = state.notes.get(id)
          return note ? { ...note } : null
        })
        .filter((note): note is NoteData => note !== null)

      if (copiedNotes.length === 0) return

      const minPos = Math.min(...copiedNotes.map((note) => note.position))

      sessionStorage.setItem(
        CLIPBOARD_KEY,
        JSON.stringify({
          notes: copiedNotes.map((note) => ({ ...note, position: note.position - minPos }))
        })
      )
      return
    }

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
      e.preventDefault()
      const stored = sessionStorage.getItem(CLIPBOARD_KEY)
      if (!stored) return

      try {
        const { notes } = JSON.parse(stored) as { notes: NoteData[] }

        state.command.stack?.executeCommand('Paste Notes', () => {
          state.selection.selectedIds.clear()

          notes.forEach((note: NoteData) => {
            const newNote: NoteData = {
              ...note,
              id: uid(),
              position: state.queuePlayhead.position + note.position
            }
            state.notes.set(newNote.id, newNote)
            state.selection.selectedIds.add(newNote.id)
          })

          executeOverlapChanges(state, state.selection.selectedIds)
          state.needsRedraw = true
        })

        updateCommandStackButtons()
      } catch (error) {
        console.error('Failed to paste notes', error)
      }
    }
  }

  const attach = () => {
    if (attached) return
    const container = getContainer()
    if (!container) return

    container.setAttribute('tabindex', '0')
    container.addEventListener('keydown', handleKeyDown)
    attached = true
  }

  const detach = () => {
    if (!attached) return
    const container = getContainer()
    if (container) {
      container.removeEventListener('keydown', handleKeyDown)
    }
    attached = false
  }

  return {
    attach,
    detach,
    isAttached: () => attached,
    handleKeyDown
  }
}
