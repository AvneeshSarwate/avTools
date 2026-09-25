import { EXPRESSION_LANES, type ExpressionLane, type PianoRollState } from './pianoRollState'
import {
  DEFAULT_FIT_BOTTOM_NOTE,
  MIN_FIT_HORIZONTAL_BEATS,
  MIN_FIT_VERTICAL_NOTES,
  MIN_HORIZONTAL_SPAN,
  MIN_VERTICAL_SPAN,
  TOTAL_PITCHES
} from './pianoRollConstants'

export const clamp = (value: number, min: number, max: number) => {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

export const getStageWidth = (state: PianoRollState, fallbackWidth: number) => {
  return state.stage?.width() ?? fallbackWidth
}

/** Height of the draggable bar between the notes and the expression lanes. */
export const LANE_SPLITTER_HEIGHT = 6
export const MIN_LANE_HEIGHT = 24
/** The notes keep at least this much height however tall the lanes are dragged. */
export const MIN_NOTE_AREA_HEIGHT = 60

export const isLaneVisible = (state: PianoRollState, lane: ExpressionLane) =>
  lane === 'pressure' ? state.lanes.showPressure : state.lanes.showTimbre

export const getVisibleLanes = (state: PianoRollState): ExpressionLane[] =>
  EXPRESSION_LANES.filter((lane) => isLaneVisible(state, lane))

/** Per-lane height after fitting the requested height into the stage. */
export const getEffectiveLaneHeight = (state: PianoRollState, totalHeight: number) => {
  const count = getVisibleLanes(state).length
  if (count === 0) return 0
  const maxPerLane = (totalHeight - MIN_NOTE_AREA_HEIGHT - LANE_SPLITTER_HEIGHT) / count
  const floor = Math.max(12, Math.min(MIN_LANE_HEIGHT, maxPerLane))
  return Math.max(floor, Math.min(state.lanes.laneHeight, maxPerLane))
}

export const getLaneAreaHeight = (state: PianoRollState, totalHeight: number) => {
  const count = getVisibleLanes(state).length
  if (count === 0) return 0
  return LANE_SPLITTER_HEIGHT + count * getEffectiveLaneHeight(state, totalHeight)
}

/**
 * Height of the note grid: the stage minus the expression lanes below it. All
 * vertical scrolling, zooming and visibility math uses this, never the raw
 * stage height, so the lanes never hide notes.
 */
export const getNoteAreaHeight = (state: PianoRollState, fallbackHeight: number) => {
  const total = state.stage?.height() ?? fallbackHeight
  return Math.max(0, total - getLaneAreaHeight(state, total))
}

export const getHorizontalContentWidth = (state: PianoRollState) => {
  return state.grid.maxLength * state.grid.quarterNoteWidth
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
  const endQuarter = startQuarter + (stageWidth / (quarterNoteWidth || 1))
  return { startQuarter, endQuarter }
}

export const getVerticalViewportRange = (state: PianoRollState, fallbackHeight: number) => {
  const noteHeight = state.grid.noteHeight
  const stageHeight = getNoteAreaHeight(state, fallbackHeight)
  const topIndex = noteHeight === 0 ? 0 : state.viewport.scrollY / noteHeight
  const bottomIndex = topIndex + (stageHeight / (noteHeight || 1))
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
  const maxStartQuarter = Math.max(0, state.grid.maxLength - visibleSpanQuarter)
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

  const maxStartQuarter = Math.max(0, state.grid.maxLength - targetSpanQuarter)
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
