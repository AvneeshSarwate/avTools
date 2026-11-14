import type Konva from 'konva'
import type { CommandStack } from './commandStack'
import type { GhostNote, JsonObject, LiveInput, PianoRollNote, PlayheadMarker } from './types'
import type { NoteIndex } from './noteIndex'
import {
  BASE_NOTE_HEIGHT,
  BASE_QUARTER_NOTE_WIDTH,
  DEFAULT_LOOP_LENGTH,
  DEFAULT_SUBDIVISION,
  DEFAULT_TIME_SIGNATURE
} from './constants'

// Pure data - NO Konva references
export type NoteData = PianoRollNote
export type { PlayheadMarker, GhostNote, JsonObject }

export type ExternalChangeSource = 'notes' | 'selection' | 'playhead' | 'viewport' | 'grid' | 'other'

/** Host hooks the core calls directly; set by the React wrapper. */
export interface PianoRollHooks {
  onNotePreview?: (note: { pitch: number; velocity: number }) => void
  noteBadge?: (note: NoteData) => string | null
  noteColor?: (note: NoteData) => string | undefined
}

export interface PianoRollState {
  stage?: Konva.Stage
  konvaContainer?: HTMLDivElement

  // Note data (pure, no Konva refs)
  notes: Map<string, NoteData>

  // Selection
  selection: {
    selectedIds: Set<string>
  }

  // Viewport
  viewport: {
    scrollX: number // horizontal scroll in px
    scrollY: number // vertical scroll in px
    zoomX: number
    zoomY: number
  }

  // Grid configuration
  grid: {
    quarterNoteWidth: number // px (derived from base * zoom)
    noteHeight: number // px (derived from base * zoom)
    baseQuarterNoteWidth: number // px at zoom 1
    baseNoteHeight: number // px at zoom 1
    subdivision: number // 16 for 16th notes
    timeSignature: number
    /** Loop length in beats: the end line. The scrollable extent is derived (see viewport.getMaxLength). */
    loopLength: number
    snapToGrid: boolean
    /** Click-drag on the background draws a note instead of a marquee. */
    drawMode: boolean
    backgroundColor1: string
    backgroundColor2: string
    noteColor: string
    selectedNoteColor: string
  }

  // Interaction state (no explicit "mode")
  interaction: {
    // Drag state
    isDragging: boolean
    dragStartPos?: { x: number; y: number }
    draggedNoteInitialStates: Map<string, { position: number; pitch: number }>
    quantDragActivated: boolean
    dragBeforeState?: string
    /** The note under the pointer when the drag started; its pitch changes are auditioned. */
    dragPrimaryId?: string
    dragPreviewPitch?: number

    // Resize state
    isResizing: boolean
    resizeTargetId?: string
    resizeIsEnd: boolean // true = resize end, false = resize start
    resizeInitialStates: Map<string, { position: number; duration: number }>
    quantResizeActivated: boolean
    resizeBeforeState?: string

    // Marquee selection
    isMarqueeSelecting: boolean
    marqueeStart?: { x: number; y: number }
    marqueeCurrent?: { x: number; y: number }
    marqueeIsShift: boolean
    marqueeInitialSelection?: Set<string>

    // Draw gesture (draw mode): the note being drawn grows with the pointer
    isDrawing: boolean
    drawNoteId?: string
    drawStartPosition?: number
    drawBeforeState?: string

    // Overlap preview tracking
    hiddenNoteIds: Set<string> // notes hidden due to drag/resize overlap
    truncatedNotes: Map<string, number> // noteId -> truncated duration for display
    createEmptyOverlapAdjustments: () => { toDelete: Set<string>; toTruncate: Map<string, number> }
  }

  // Undo/redo (simple snapshot-based)
  command: {
    stack?: CommandStack
  }

  // Layers (Konva references for rendering)
  layers: {
    grid?: Konva.Layer
    ghosts?: Konva.Layer
    notes?: Konva.Layer
    overlay?: Konva.Layer
  }

  // One immediate-mode shape per layer (its sceneFunc draws from this state),
  // plus the transparent full-stage hit target that receives pointer events.
  shapes: {
    grid?: Konva.Shape
    ghosts?: Konva.Shape
    notes?: Konva.Shape
    hitTarget?: Konva.Shape
    overlay?: Konva.Shape
  }

  // Rendering cache to avoid unnecessary redraws
  renderCache: {
    /** Sorted-by-position index for visible-note culling; see noteIndex.ts. */
    noteIndex?: NoteIndex
    grid: {
      lastScrollX: number
      lastScrollY: number
      lastSubdivision: number
      lastQuarterNoteWidth: number
      lastNoteHeight: number
      lastStageWidth: number
      lastStageHeight: number
      lastLoopLength: number
      lastMaxLength: number
    }
  }

  // RAF control. `needsRedraw` rebuilds every layer (scroll, zoom, note
  // edits); the per-layer flags redraw just one layer and are what the
  // high-frequency paths (playhead markers, ghost overlays, selection) use.
  needsRedraw: boolean
  dirty: {
    ghosts: boolean
    notes: boolean
    overlay: boolean
  }
  rafHandle?: number

  // Queue playhead (green) - where playback will start from
  queuePlayhead: {
    position: number // in quarter notes
  }

  // Named playhead markers (any number) - set from outside, drawn by the
  // overlay shape on every overlay redraw.
  playheadMarkers: {
    markers: PlayheadMarker[]
  }

  // Read-only notes drawn on their own layer between the grid and the notes.
  ghostNotes: GhostNote[]

  /** Live MIDI input overlay, drawn on the overlay layer. */
  liveInput: LiveInput

  hooks: PianoRollHooks

  // Optional callback to notify external listeners when state changes outside command stack
  notifyExternalChange?: (source?: ExternalChangeSource) => void
}

export const createPianoRollState = (): PianoRollState => {
  const baseQuarterNoteWidth = BASE_QUARTER_NOTE_WIDTH
  const baseNoteHeight = BASE_NOTE_HEIGHT

  return {
    stage: undefined,
    konvaContainer: undefined,

    notes: new Map(),

    selection: {
      selectedIds: new Set()
    },

    viewport: {
      scrollX: 0,
      scrollY: 55 * baseNoteHeight, // Start at middle C
      zoomX: 1,
      zoomY: 1
    },

    grid: {
      quarterNoteWidth: baseQuarterNoteWidth,
      noteHeight: baseNoteHeight,
      baseQuarterNoteWidth,
      baseNoteHeight,
      subdivision: DEFAULT_SUBDIVISION,
      timeSignature: DEFAULT_TIME_SIGNATURE,
      loopLength: DEFAULT_LOOP_LENGTH,
      snapToGrid: true,
      drawMode: false,
      backgroundColor1: '#ddd',
      backgroundColor2: '#bbb',
      noteColor: '#f23',
      selectedNoteColor: '#2ee'
    },

    interaction: {
      isDragging: false,
      dragStartPos: undefined,
      draggedNoteInitialStates: new Map(),
      quantDragActivated: false,
      dragBeforeState: undefined,
      dragPrimaryId: undefined,
      dragPreviewPitch: undefined,

      isResizing: false,
      resizeTargetId: undefined,
      resizeIsEnd: false,
      resizeInitialStates: new Map(),
      quantResizeActivated: false,
      resizeBeforeState: undefined,

      isMarqueeSelecting: false,
      marqueeStart: undefined,
      marqueeCurrent: undefined,
      marqueeIsShift: false,
      marqueeInitialSelection: undefined,

      isDrawing: false,
      drawNoteId: undefined,
      drawStartPosition: undefined,
      drawBeforeState: undefined,

      hiddenNoteIds: new Set(),
      truncatedNotes: new Map(),
      createEmptyOverlapAdjustments: () => ({
        toDelete: new Set<string>(),
        toTruncate: new Map<string, number>()
      })
    },

    command: {
      stack: undefined
    },

    layers: {
      grid: undefined,
      ghosts: undefined,
      notes: undefined,
      overlay: undefined
    },

    shapes: {},

    renderCache: {
      noteIndex: undefined,
      grid: {
        lastScrollX: -1,
        lastScrollY: -1,
        lastSubdivision: -1,
        lastQuarterNoteWidth: -1,
        lastNoteHeight: -1,
        lastStageWidth: -1,
        lastStageHeight: -1,
        lastLoopLength: -1,
        lastMaxLength: -1
      }
    },

    needsRedraw: false,
    dirty: { ghosts: false, notes: false, overlay: false },
    rafHandle: undefined,

    queuePlayhead: {
      position: 0
    },

    playheadMarkers: {
      markers: []
    },

    ghostNotes: [],

    liveInput: { keys: [], notes: [] },

    hooks: {},

    notifyExternalChange: undefined
  }
}
