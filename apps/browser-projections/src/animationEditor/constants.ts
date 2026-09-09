/**
 * Animation Editor Constants
 * All tweakable values are surfaced here for easy adjustment
 */

// Layout dimensions
export const TRACK_ROW_HEIGHT = 48
export const NAME_COLUMN_WIDTH = 180
export const TIME_RIBBON_HEIGHT = 32
export const TIME_TICKS_HEIGHT = 24

// Timeline defaults
export const DEFAULT_TIMELINE_DURATION = 1
export const DEFAULT_NUMBER_LOW = 0
export const DEFAULT_NUMBER_HIGH = 1

// Flat editor palette. Accent denotes selection/action; data colors remain separate.
export const EDITOR_THEME = {
  '--ae-bg': '#252624',
  '--ae-panel': '#30312e',
  '--ae-header': '#3b3c38',
  '--ae-input': '#222320',
  '--ae-control': '#484a44',
  '--ae-hover': '#55574f',
  '--ae-border': '#454740',
  '--ae-text': '#e0e1d9',
  '--ae-muted': '#b0b2a8',
  '--ae-accent': '#e6b65c',
  '--ae-accent-hover': '#f0c77c',
  '--ae-on-accent': '#252624',
} as const

// Colors - Track backgrounds
export const TRACK_BG_COLOR = '#252624'
export const TRACK_BG_COLOR_ALT = '#2a2b28' // If you want alternating later

// Colors - Number tracks
export const NUMBER_LINE_COLOR = '#a8bdb6'
export const NUMBER_POINT_COLOR = '#a8bdb6'
export const NUMBER_POINT_RADIUS = 4

// Colors - Playhead
export const PLAYHEAD_COLOR = '#e6b65c'
export const PLAYHEAD_WIDTH = 2

// Colors - Time ribbon
export const RIBBON_BG_COLOR = '#252624'
export const RIBBON_VIEWPORT_COLOR = '#65695f'
export const RIBBON_HANDLE_COLOR = '#b0b2a8'
export const RIBBON_HANDLE_WIDTH = 8

// Colors - Time ticks
export const TICK_COLOR = '#74776c'
export const TICK_LABEL_COLOR = '#b0b2a8'
export const TICK_HEIGHT = 8

// Colors - Name column
export const NAME_BG_COLOR = '#30312e'
export const NAME_TEXT_COLOR = '#e0e1d9'
export const NAME_FONT_SIZE = 12

// Colors - Enum/Func tracks
export const ENUM_TEXT_COLOR = '#fff'
export const ENUM_FONT_SIZE = 10
export const FUNC_TEXT_COLOR = '#fff'
export const FUNC_FONT_SIZE = 10

// Misc
export const MIN_TICK_SPACING = 50 // Minimum pixels between time ticks

// =============================================================================
// Edit Mode Constants
// =============================================================================

// Edit mode layout
export const EDIT_SIDEBAR_WIDTH = NAME_COLUMN_WIDTH  // Match view mode for consistent alignment
export const LANE_LABEL_WIDTH = 0  // Removed lane labels
export const NUMBER_LANE_HEIGHT = 200
export const ENUM_LANE_HEIGHT = 120
export const FUNC_LANE_HEIGHT = 120

// Edit mode - Number lane
export const EDIT_NUMBER_POINT_RADIUS = 6
export const EDIT_NUMBER_POINT_RADIUS_HOVER = 8
export const EDIT_NUMBER_LINE_WIDTH = 2
export const EDIT_NUMBER_LINE_WIDTH_FRONT = 2
export const EDIT_NUMBER_LINE_SNAP_DISTANCE = 8 // Vertical CSS pixels at the clicked time
export const EDIT_NUMBER_BOUNDS_LINE_COLOR = 'rgba(255, 255, 255, 0.15)'

// Edit mode - Marker (enum/func) styling
export const EDIT_MARKER_WIDTH = 4
export const EDIT_MARKER_NOTCH_SIZE = 8
export const EDIT_MARKER_BAR_WIDTH = 24
export const EDIT_MARKER_BAR_HEIGHT_RATIO = 0.7 // Relative to lane height
export const EDIT_REFERENCE_MARKER_OPACITY = 0.18

// Edit mode - Selection
export const SELECTION_COLOR = '#e6b65c'
export const SELECTION_STROKE_WIDTH = 2

// Edit mode - Front track vs reference track opacity
export const FRONT_TRACK_OPACITY = 1.0
export const REFERENCE_TRACK_OPACITY = 0.3

// Edit mode - Colors
export const EDIT_LANE_BG_COLOR = '#252624'
export const EDIT_LANE_BORDER_COLOR = '#454740'
export const EDIT_SIDEBAR_BG_COLOR = '#30312e'
export const EDIT_SIDEBAR_TRACK_BG = '#252624'
export const EDIT_SIDEBAR_TRACK_BG_HOVER = '#3b3c38'
export const EDIT_SIDEBAR_TRACK_BG_ENABLED = '#484a44'
export const EDIT_SIDEBAR_SECTION_MAX_HEIGHT = 180  // Max height for scrollable sections

// Edit mode - Precision editor
export const PRECISION_MODAL_WIDTH = 340

// Edit mode - Collision epsilon (for enum/func no-duplicate-time rule)
export const TIME_COLLISION_EPS = 0.1

// Toast
export const TOAST_DURATION = 3000
export const TOAST_MAX_VISIBLE = 3
