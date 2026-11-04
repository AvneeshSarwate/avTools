import type { PianoRollState } from './state'
import {
  DEFAULT_FIT_BOTTOM_NOTE,
  EXTENT_PADDING_BEATS,
  MIN_FIT_HORIZONTAL_BEATS,
  MIN_FIT_VERTICAL_NOTES,
  MIN_HORIZONTAL_SPAN,
  MIN_VERTICAL_SPAN,
  TOTAL_PITCHES
} from './constants'
import type { PianoRollView } from './types'
import { getNoteIndex, hasInFlightNotes } from './noteIndex'

export type { PianoRollView }

export const clamp = (value: number, min: number, max: number) => {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

export const getStageWidth = (state: PianoRollState, fallbackWidth: number) => {
  return state.stage?.width() ?? fallbackWidth
}

/**
 * Height of the note grid. The expression lanes of the Vue version are gone,
 * so this is the stage height; kept as a function so the callers read the same.
 */
export const getNoteAreaHeight = (state: PianoRollState, fallbackHeight: number) => {
  return Math.max(0, state.stage?.height() ?? fallbackHeight)
}

/**
 * End of the last note, in beats (0 with no notes). Read from the note index
 * (built once per change) except while a gesture is moving notes in place,
 * when the notes are scanned.
 */
export const getLastNoteEnd = (state: PianoRollState) => {
  if (!hasInFlightNotes(state)) return getNoteIndex(state).maxEnd
  let end = 0
  state.notes.forEach((note) => {
    end = Math.max(end, note.position + note.duration)
  })
  return end
}

/**
 * The scrollable extent in beats: whichever of the loop and the notes reaches
 * further, plus a couple of bars. Replaces the Vue component's grid.maxLength.
 */
export const getMaxLength = (state: PianoRollState) => {
  return Math.max(state.grid.loopLength, getLastNoteEnd(state)) + EXTENT_PADDING_BEATS
}

export const getHorizontalContentWidth = (state: PianoRollState) => {
  return getMaxLength(state) * state.grid.quarterNoteWidth
}

export const getVerticalContentHeight = (state: PianoRollState) => {
  return TOTAL_PITCHES * state.grid.noteHeight
}

export const setHorizontalZoom = (state: PianoRollState, newQuarterNoteWidth: number) => {
  state.grid.quarterNoteWidth = newQuarterNoteWidth
  state.viewport.zoomX = newQuarterNoteWidth / state.grid.baseQuarterNoteWidth
}

export const setVerticalZoom = (state: PianoRollState, newNoteHeight: number) => {
  state.grid.noteHeight = newNoteHeight
  state.viewport.zoomY = newNoteHeight / state.grid.baseNoteHeight
}

export const getHorizontalViewportRange = (state: PianoRollState, fallbackWidth: number) => {
  const quarterNoteWidth = state.grid.quarterNoteWidth
  const stageWidth = getStageWidth(state, fallbackWidth)
  const startQuarter = quarterNoteWidth === 0 ? 0 : state.viewport.scrollX / quarterNoteWidth
  const endQuarter = startQuarter + stageWidth / (quarterNoteWidth || 1)
  return { startQuarter, endQuarter }
}

export const getVerticalViewportRange = (state: PianoRollState, fallbackHeight: number) => {
  const noteHeight = state.grid.noteHeight
  const stageHeight = getNoteAreaHeight(state, fallbackHeight)
  const topIndex = noteHeight === 0 ? 0 : state.viewport.scrollY / noteHeight
  const bottomIndex = topIndex + stageHeight / (noteHeight || 1)
  return { topIndex, bottomIndex }
}

export const updateScrollBounds = (
  state: PianoRollState,
  fallbackWidth: number,
  fallbackHeight: number,
  notifyViewportChange: () => void
) => {
  const stageWidth = getStageWidth(state, fallbackWidth)
  const stageHeight = getNoteAreaHeight(state, fallbackHeight)

  const maxScrollX = Math.max(0, getHorizontalContentWidth(state) - stageWidth)
  const clampedScrollX = clamp(state.viewport.scrollX, 0, maxScrollX)
  if (clampedScrollX !== state.viewport.scrollX) {
    state.viewport.scrollX = clampedScrollX
    state.needsRedraw = true
    notifyViewportChange()
  }

  const maxScrollY = Math.max(0, getVerticalContentHeight(state) - stageHeight)
  const clampedScrollY = clamp(state.viewport.scrollY, 0, maxScrollY)
  if (clampedScrollY !== state.viewport.scrollY) {
    state.viewport.scrollY = clampedScrollY
    state.needsRedraw = true
    notifyViewportChange()
  }
}

export const applyHorizontalZoom = (
  state: PianoRollState,
  newQuarterNoteWidth: number,
  newStartQuarter: number,
  fallbackWidth: number,
  fallbackHeight: number,
  notifyViewportChange: () => void
) => {
  if (!Number.isFinite(newQuarterNoteWidth) || newQuarterNoteWidth <= 0) return
  setHorizontalZoom(state, newQuarterNoteWidth)

  const stageWidth = getStageWidth(state, fallbackWidth)
  const visibleSpanQuarter = stageWidth / state.grid.quarterNoteWidth
  const maxStartQuarter = Math.max(0, getMaxLength(state) - visibleSpanQuarter)
  const clampedStartQuarter = clamp(newStartQuarter, 0, maxStartQuarter)
  state.viewport.scrollX = clampedStartQuarter * state.grid.quarterNoteWidth

  updateScrollBounds(state, fallbackWidth, fallbackHeight, notifyViewportChange)
  state.needsRedraw = true
  notifyViewportChange()
}

export const applyVerticalZoom = (
  state: PianoRollState,
  newNoteHeight: number,
  newTopIndex: number,
  fallbackWidth: number,
  fallbackHeight: number,
  notifyViewportChange: () => void
) => {
  if (!Number.isFinite(newNoteHeight) || newNoteHeight <= 0) return
  setVerticalZoom(state, newNoteHeight)

  const stageHeight = getNoteAreaHeight(state, fallbackHeight)
  const visibleSpan = stageHeight / state.grid.noteHeight
  const maxTopIndex = Math.max(0, TOTAL_PITCHES - visibleSpan)
  const clampedTopIndex = clamp(newTopIndex, 0, maxTopIndex)
  state.viewport.scrollY = clampedTopIndex * state.grid.noteHeight

  updateScrollBounds(state, fallbackWidth, fallbackHeight, notifyViewportChange)
  state.needsRedraw = true
  notifyViewportChange()
}

/** Zoom limits: the whole extent fills the stage at the low end, MIN_*_SPAN at the high end. */
export const getHorizontalZoomLimits = (state: PianoRollState, fallbackWidth: number) => {
  const stageWidth = Math.max(1, getStageWidth(state, fallbackWidth))
  return {
    min: stageWidth / Math.max(getMaxLength(state), MIN_HORIZONTAL_SPAN),
    max: stageWidth / MIN_HORIZONTAL_SPAN
  }
}

export const getVerticalZoomLimits = (state: PianoRollState, fallbackHeight: number) => {
  const stageHeight = Math.max(1, getNoteAreaHeight(state, fallbackHeight))
  return {
    min: stageHeight / TOTAL_PITCHES,
    max: stageHeight / MIN_VERTICAL_SPAN
  }
}

/** Zoom horizontally by a factor, keeping the beat at `anchorX` (stage px) under the pointer. */
export const zoomHorizontalBy = (
  state: PianoRollState,
  factor: number,
  anchorX: number,
  fallbackWidth: number,
  fallbackHeight: number,
  notifyViewportChange: () => void
) => {
  const limits = getHorizontalZoomLimits(state, fallbackWidth)
  const current = state.grid.quarterNoteWidth
  const next = clamp(current * factor, limits.min, limits.max)
  if (next === current) return
  const anchorBeat = (state.viewport.scrollX + anchorX) / current
  const newStartQuarter = anchorBeat - anchorX / next
  applyHorizontalZoom(state, next, newStartQuarter, fallbackWidth, fallbackHeight, notifyViewportChange)
}

/** Zoom vertically by a factor, keeping the row at `anchorY` (stage px) under the pointer. */
export const zoomVerticalBy = (
  state: PianoRollState,
  factor: number,
  anchorY: number,
  fallbackWidth: number,
  fallbackHeight: number,
  notifyViewportChange: () => void
) => {
  const limits = getVerticalZoomLimits(state, fallbackHeight)
  const current = state.grid.noteHeight
  const next = clamp(current * factor, limits.min, limits.max)
  if (next === current) return
  const anchorRow = (state.viewport.scrollY + anchorY) / current
  const newTopIndex = anchorRow - anchorY / next
  applyVerticalZoom(state, next, newTopIndex, fallbackWidth, fallbackHeight, notifyViewportChange)
}

export const fitZoomToNotes = (
  state: PianoRollState,
  fallbackWidth: number,
  fallbackHeight: number,
  notifyViewportChange: () => void
) => {
  const stageWidth = getStageWidth(state, fallbackWidth)
  const stageHeight = getNoteAreaHeight(state, fallbackHeight)
  if (stageWidth <= 0 || stageHeight <= 0) return

  const notes = Array.from(state.notes.values())

  if (notes.length === 0) {
    const targetSpanQuarter = MIN_FIT_HORIZONTAL_BEATS
    const newQuarterNoteWidth = stageWidth / targetSpanQuarter
    applyHorizontalZoom(state, newQuarterNoteWidth, 0, fallbackWidth, fallbackHeight, notifyViewportChange)

    const targetSpanNotes = MIN_FIT_VERTICAL_NOTES
    const newNoteHeight = stageHeight / targetSpanNotes
    const bottomIndex = 127 - DEFAULT_FIT_BOTTOM_NOTE
    const maxTopIndex = Math.max(0, TOTAL_PITCHES - targetSpanNotes)
    const topIndex = clamp(bottomIndex - (targetSpanNotes - 1), 0, maxTopIndex)
    applyVerticalZoom(state, newNoteHeight, topIndex, fallbackWidth, fallbackHeight, notifyViewportChange)
    return
  }

  const minPos = notes.reduce((min, note) => Math.min(min, note.position), Number.POSITIVE_INFINITY)
  const maxPos = notes.reduce((max, note) => Math.max(max, note.position + note.duration), Number.NEGATIVE_INFINITY)
  const actualSpanQuarter = Math.max(maxPos - minPos, 0)
  const targetSpanQuarter = Math.max(actualSpanQuarter, MIN_FIT_HORIZONTAL_BEATS)
  const newQuarterNoteWidth = stageWidth / targetSpanQuarter

  const maxStartQuarter = Math.max(0, getMaxLength(state) - targetSpanQuarter)
  const spanPadding = Math.max(targetSpanQuarter - actualSpanQuarter, 0)
  const startQuarterRaw = minPos - spanPadding / 2
  const startQuarter = clamp(startQuarterRaw, 0, maxStartQuarter)
  applyHorizontalZoom(state, newQuarterNoteWidth, startQuarter, fallbackWidth, fallbackHeight, notifyViewportChange)

  const highestPitch = notes.reduce((max, note) => Math.max(max, note.pitch), Number.NEGATIVE_INFINITY)
  const lowestPitch = notes.reduce((min, note) => Math.min(min, note.pitch), Number.POSITIVE_INFINITY)
  const topIndexForHighest = 127 - highestPitch
  const bottomIndexForLowest = 127 - lowestPitch
  const actualSpanNotes = Math.max(bottomIndexForLowest - topIndexForHighest + 1, 1)
  const targetSpanNotes = Math.max(actualSpanNotes, MIN_FIT_VERTICAL_NOTES)
  const newNoteHeight = stageHeight / targetSpanNotes

  const extraSpace = Math.max(targetSpanNotes - actualSpanNotes, 0)
  const topIndexRaw = topIndexForHighest - extraSpace / 2
  const maxTopIndex = Math.max(0, TOTAL_PITCHES - targetSpanNotes)
  const topIndex = clamp(topIndexRaw, 0, maxTopIndex)
  applyVerticalZoom(state, newNoteHeight, topIndex, fallbackWidth, fallbackHeight, notifyViewportChange)
}

export const getView = (state: PianoRollState): PianoRollView => ({
  quarterNoteWidth: state.grid.quarterNoteWidth,
  noteHeight: state.grid.noteHeight,
  startBeat: state.grid.quarterNoteWidth > 0 ? state.viewport.scrollX / state.grid.quarterNoteWidth : 0,
  topRow: state.grid.noteHeight > 0 ? state.viewport.scrollY / state.grid.noteHeight : 0
})

/** Apply a stored view; the zoom helpers clamp it to the current stage. */
export const setView = (
  state: PianoRollState,
  view: PianoRollView,
  fallbackWidth: number,
  fallbackHeight: number,
  notifyViewportChange: () => void
) => {
  applyHorizontalZoom(state, view.quarterNoteWidth, view.startBeat, fallbackWidth, fallbackHeight, notifyViewportChange)
  applyVerticalZoom(state, view.noteHeight, view.topRow, fallbackWidth, fallbackHeight, notifyViewportChange)
}
