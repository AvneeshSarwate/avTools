import type Konva from 'konva'
import type { CommandStack } from './commandStack'
import type { GhostNote, JsonObject, LiveInput, PianoRollNote, PianoRollScale, PlayheadMarker } from './types'
import { DEFAULT_SCALE } from './scale'
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

/** Expression lanes under the grid (pitch is drawn on the notes, not a lane). */
export type ExpressionLane = 'velocity' | 'pressure' | 'timbre'
/** Where an MPE breakpoint lives: the note's pitch envelope or a lane. */
export type ExpressionArea = 'pitch' | ExpressionLane
/** Breakpoint areas in MPE mode (velocity has one value per note, no points). */
export type EnvelopeArea = 'pitch' | 'pressure' | 'timbre'

/** Selected breakpoints: note id -> indices into that note's points, per area. */
export type PointSelection = { area: EnvelopeArea; points: Map<string, Set<number>> }

/**
 * What an MPE-mode pointer is over (Ableton's hover zones, nearest first): a
 * breakpoint; the line itself, where a click adds a point (shown as a ghost
 * point locked to the line); or, a little further out, a segment, which drags
 * its end points together.
 */
export type ExpressionHover =
  | { kind: 'point'; area: EnvelopeArea; noteId: string; index: number }
  | { kind: 'line'; area: EnvelopeArea; noteId: string; time: number; value: number }
  | {
      kind: 'segment'
      area: EnvelopeArea
      noteId: string
      indices: number[]
      /** The segment's ends (time 0..1 across the note, value), for drawing it highlighted. */
      from: { time: number; value: number }
      to: { time: number; value: number }
    }

/** A right-click target (expression.ts); the host renders the menu. */
export type ExpressionMenuTarget =
  | { kind: 'point'; area: EnvelopeArea; noteId: string; index: number; value: number; rooted: boolean }
  | { kind: 'velocity'; noteId: string; value: number }

/** An expression gesture in progress (see expression.ts). */
export type ExpressionDrag =
  | { kind: 'velocity'; startY: number; before: string; base: Map<string, number>; perPixel: number; moved: boolean; primary: string | null }
  | { kind: 'velocityDraw'; before: string; lane: 'velocity' }
  | {
      kind: 'points'
      area: EnvelopeArea
      startX: number
      startY: number
      before: string
      /** Point copies at drag start, per note: index -> {time, value}. */
      base: Map<string, Array<{ time: number; value: number }>>
      moved: boolean
      /** Click on a point without moving deletes it (Ableton); a new point is never deleted that way. */
      clickDeletes: { noteId: string; index: number } | null
      /** The point whose value the tooltip shows while dragging. */
      primary: { noteId: string; index: number } | null
    }
  | { kind: 'range'; area: EnvelopeArea; startX: number; currentX: number; shift: boolean; initial: PointSelection | null }

export type ExternalChangeSource = 'notes' | 'selection' | 'playhead' | 'viewport' | 'grid' | 'other'

/** Host hooks the core calls directly; set by the React wrapper. */
export interface PianoRollHooks {
  onNotePreview?: (note: { pitch: number; velocity: number }) => void
  /** Right-click on a breakpoint or velocity marker (client coordinates). */
  onExpressionMenu?: (menu: { x: number; y: number; target: ExpressionMenuTarget }) => void
  noteBadge?: (note: NoteData) => string | null
  noteColor?: (note: NoteData) => string | undefined
  /** A click on the empty grid moved the cursor (the queue playhead). */
  onCursorChange?: (position: number) => void
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
    /** Row shading: root rows lighter, out-of-scale rows darker. */
    scale: PianoRollScale
    /** Note and keyboard labels: note names or MIDI numbers. */
    pitchLabels: 'name' | 'midi'
    snapToGrid: boolean
    /** Click-drag on the background draws a note instead of a marquee. */
    drawMode: boolean
    /** Sound notes through onNotePreview when they are added, clicked, moved or marqueed (the keyboard column always sounds). */
    previewSound: boolean
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
      lastScale: PianoRollScale | null
    }
  }

  /** Coalesce changes into a frame. Omitting the layer refreshes the whole viewport. */
  requestRedraw: (layer?: RedrawLayer) => void

  // Queue playhead: the cursor, set by clicking the empty grid. Pasted
  // notes land here; hosts can read it (onCursorChange) and set it.
  queuePlayhead: {
    position: number // in quarter notes
    /** Drawn even at 0 (a host that uses the cursor); otherwise only once moved. */
    alwaysShow: boolean
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

  /**
   * Note expression, after Ableton: Notes mode edits notes and shows the
   * velocity lane; MPE mode edits the selected notes' pitch envelopes (on the
   * notes) and the pressure/timbre lanes, and does not move notes.
   */
  expression: {
    /** Lanes are drawn at all (interactive rolls with a control panel). */
    enabled: boolean
    mode: 'notes' | 'mpe'
    lanesVisible: Record<ExpressionLane, boolean>
    pointSelection: PointSelection | null
    /** A time range being dragged out in MPE mode, in stage px. */
    range: { area: EnvelopeArea; x0: number; x1: number } | null
    drag: ExpressionDrag | null
    /** Velocity marker under the pointer (Ableton highlights it). */
    hoverNoteId: string | null
    /** MPE-mode hover target (point, line or segment). */
    hover: ExpressionHover | null
    /** The note under the pointer in the grid: its label shows the other pitch form. */
    hoverGridNoteId: string | null
    /**
     * The envelope last worked on in MPE mode (a point, the line, a segment or
     * a range in it); Cmd-A then selects its breakpoints. Null after clicking
     * a note or the background, so Cmd-A selects notes.
     */
    activeArea: EnvelopeArea | null
  }

  /** The keyboard column beside the grid (gutter.ts). */
  keyboard: {
    pressedPitch: number | null
    hoverPitch: number | null
  }

  hooks: PianoRollHooks

  // Optional callback to notify external listeners when state changes outside command stack
  notifyExternalChange?: (source?: ExternalChangeSource) => void
}

export type RedrawLayer = 'all' | 'notes' | 'ghosts' | 'overlay' | 'gutter'

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
      scale: DEFAULT_SCALE,
      pitchLabels: 'name',
      snapToGrid: true,
      drawMode: false,
      previewSound: true,
      backgroundColor1: '#262626',
      backgroundColor2: '#222222',
      noteColor: '#f23',
      selectedNoteColor: '#64b5ff'
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
        lastMaxLength: -1,
        lastScale: null
      }
    },

    requestRedraw: () => {},

    queuePlayhead: {
      position: 0,
      alwaysShow: false
    },

    playheadMarkers: {
      markers: []
    },

    ghostNotes: [],

    liveInput: { keys: [], notes: [] },

    expression: {
      enabled: false,
      mode: 'notes',
      lanesVisible: { velocity: true, pressure: true, timbre: true },
      pointSelection: null,
      range: null,
      drag: null,
      hoverNoteId: null,
      hover: null,
      hoverGridNoteId: null,
      activeArea: null
    },

    keyboard: { pressedPitch: null, hoverPitch: null },

    hooks: {},

    notifyExternalChange: undefined
  }
}
