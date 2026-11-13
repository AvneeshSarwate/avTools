// Ported from browser-projections/src/pianoRoll/pianoRollConstants.ts, plus the
// stage defaults the Vue component kept inline.
export const MIN_HORIZONTAL_SPAN = 0.25 // quarter notes
export const MIN_VERTICAL_SPAN = 1 // pitches
export const TOTAL_PITCHES = 128
export const MIN_FIT_HORIZONTAL_BEATS = 4
export const MIN_FIT_VERTICAL_NOTES = 12
export const DEFAULT_FIT_BOTTOM_NOTE = 55

export const BASE_QUARTER_NOTE_WIDTH = 120
export const BASE_NOTE_HEIGHT = 20
export const DEFAULT_SUBDIVISION = 16
export const DEFAULT_TIME_SIGNATURE = 4
export const DEFAULT_STAGE_WIDTH = 640
export const DEFAULT_STAGE_HEIGHT = 360
/** Scrollable room past max(loopLength, last note end), in beats (two bars). */
export const EXTENT_PADDING_BEATS = 8
export const DEFAULT_VELOCITY = 100
export const DEFAULT_LOOP_LENGTH = 16

export const SCROLLBAR_THICKNESS = 12
export const LAYOUT_GAP = 1
