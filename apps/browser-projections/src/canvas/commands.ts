import type { CanvasRuntimeState } from "./canvasState"

// Command helpers rely exclusively on the callbacks stored in CanvasRuntimeState
export const executeCommand = (state: CanvasRuntimeState, name: string, action: () => void) => {
  if (!state.command.executeCommand) {
    console.warn('executeCommand called before setup - falling back to direct execution')
    action()
    return
  }
  state.command.executeCommand(name, action)
}

export const pushCommandWithStates = (
  state: CanvasRuntimeState,
  name: string,
  beforeState: string,
  afterState: string
) => {
  if (!state.command.pushCommand) {
    console.warn('pushCommandWithStates called before setup - ignoring')
    return
  }
  state.command.pushCommand(name, beforeState, afterState)
}

/** The state string the undo stack stores: the whole document as JSON. */
export const captureCommandState = (state: CanvasRuntimeState): string => {
  if (!state.command.captureState) {
    console.warn('captureCommandState called before setup - returning empty state')
    return ''
  }
  return state.command.captureState()
}

// Setup functions for CanvasRoot.vue to call
export const setCommandExecutor = (state: CanvasRuntimeState, fn: (name: string, action: () => void) => void) => {
  state.command.executeCommand = fn
}

export const setCommandPusher = (
  state: CanvasRuntimeState,
  fn: (name: string, beforeState: string, afterState: string) => void
) => {
  state.command.pushCommand = fn
}
