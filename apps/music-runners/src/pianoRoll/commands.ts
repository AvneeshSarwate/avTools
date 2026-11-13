import type { PianoRollState } from './state'

export interface CommandHandlersOptions {
  state: PianoRollState
  /** Refresh the React-side undo/redo button state. */
  onButtonsChange: (canUndo: boolean, canRedo: boolean) => void
}

export interface CommandHandlers {
  undo: () => void
  redo: () => void
  deleteSelected: () => void
  updateCommandStackButtons: () => void
}

export const createCommandHandlers = ({ state, onButtonsChange }: CommandHandlersOptions): CommandHandlers => {
  const updateCommandStackButtons = () => {
    onButtonsChange(state.command.stack?.canUndo() ?? false, state.command.stack?.canRedo() ?? false)
  }

  const undo = () => {
    state.command.stack?.undo()
    updateCommandStackButtons()
  }

  const redo = () => {
    state.command.stack?.redo()
    updateCommandStackButtons()
  }

  const deleteSelected = () => {
    if (state.selection.selectedIds.size === 0) return

    state.command.stack?.executeCommand('Delete Selected', () => {
      state.selection.selectedIds.forEach((id) => state.notes.delete(id))
      state.selection.selectedIds.clear()
      state.needsRedraw = true
    })

    updateCommandStackButtons()
  }

  return {
    undo,
    redo,
    deleteSelected,
    updateCommandStackButtons
  }
}
