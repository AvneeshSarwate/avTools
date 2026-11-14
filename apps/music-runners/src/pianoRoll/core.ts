import Konva from 'konva'
import type { PianoRollState, NoteData } from './state'
import { labelColorFor, noteFillColor } from './metadata/rules'
import {
  uid,
  screenToPitchPosition,
  quantizeToGrid,
  isNoteVisible,
  getNotesInRect,
  updateOverlapPreview,
  clearOverlapPreview,
  executeOverlapChanges,
  getNoteDisplayDuration,
  applySnapToNoteStart,
  getGridUnitWidth,
  getGridUnitBeats,
  midiPitchToString
} from './utils'
import { CommandStack, type CommandStackChange } from './commandStack'
import { getMaxLength, getNoteAreaHeight } from './viewport'
import { DEFAULT_VELOCITY } from './constants'
import { collectVisibleNotes, invalidateNoteIndex, type VisibleNote } from './noteIndex'

// Default marker stroke: distinct from the queue (green) playhead, so an
// externally published marker never reads as it.
const PLAYHEAD_MARKER_COLOR = '#2f7fff'
const LOOP_END_COLOR = '#d62839'
const BEYOND_LOOP_FILL = 'rgba(0, 0, 0, 0.16)'
const GHOST_DEFAULT_COLOR = '#555555'
const GHOST_DEFAULT_OPACITY = 0.45
const MIN_NOTE_DURATION = 0.25
const HANDLE_RADIUS = 5
const MARQUEE_STROKE = '#4A90E2'
const MARQUEE_FILL = 'rgba(74, 144, 226, 0.1)'
const QUEUE_PLAYHEAD_COLOR = '#00ff00'
const TWO_PI = Math.PI * 2

// The fonts Konva.Text produced for these nodes (its defaults: Arial, normal
// style and variant). Text sits at y + fontSize / 2 with a middle baseline,
// which is how Konva.Text positions a single top-aligned line.
const LABEL_FONT = 'normal normal 14px Arial'
const LABEL_FONT_SIZE = 14
const BADGE_FONT = 'bold normal 11px Arial'
const BADGE_FONT_SIZE = 11
const MARKER_FONT = 'normal normal 11px Arial'
const MARKER_FONT_SIZE = 11
const ghostFont = (fontSize: number) => `normal normal ${fontSize}px Arial`

// ================= State Serialization =================

export function captureState(state: PianoRollState): string {
  return JSON.stringify({
    notes: Array.from(state.notes.entries()),
    selection: Array.from(state.selection.selectedIds)
  })
}

export function restoreState(state: PianoRollState, snapshot: string) {
  const data = JSON.parse(snapshot) as { notes: Array<[string, NoteData]>; selection: string[] }
  state.notes = new Map(data.notes)
  state.selection.selectedIds = new Set(data.selection)
  invalidateNoteIndex(state)
  state.needsRedraw = true
}

function selectionSetsDiffer(previous: Set<string>, current: Set<string>): boolean {
  if (previous.size !== current.size) return true
  for (const id of previous) {
    if (!current.has(id)) {
      return true
    }
  }
  return false
}

export function mutateSelection(state: PianoRollState, mutate: () => void): boolean {
  const before = new Set(state.selection.selectedIds)
  mutate()
  const changed = selectionSetsDiffer(before, state.selection.selectedIds)
  if (changed) {
    state.notifyExternalChange?.('selection')
  }
  return changed
}

/** The note's fill: host override, then metadata.color, then the default. */
function resolveNoteFill(state: PianoRollState, note: NoteData, fallback: string): string {
  const override = state.hooks.noteColor?.(note)
  if (typeof override === 'string' && override) return override
  return noteFillColor(note.metadata, fallback)
}

function previewNote(state: PianoRollState, note: NoteData) {
  state.hooks.onNotePreview?.({ pitch: note.pitch, velocity: note.velocity })
}

// ================= Text helpers =================

// Text is never measured per note per frame: widths are cached per
// (font, string), measured on an offscreen context the way Konva.Text did.
let measureContext: CanvasRenderingContext2D | null = null
const textWidthCache = new Map<string, number>()
const TEXT_WIDTH_CACHE_LIMIT = 4096

function textWidth(font: string, text: string): number {
  const key = font + '\u0000' + text
  const cached = textWidthCache.get(key)
  if (cached !== undefined) return cached
  if (!measureContext) measureContext = document.createElement('canvas').getContext('2d')
  if (!measureContext) return 0
  measureContext.font = font
  const width = measureContext.measureText(text).width
  if (textWidthCache.size >= TEXT_WIDTH_CACHE_LIMIT) textWidthCache.clear()
  textWidthCache.set(key, width)
  return width
}

// Konva draws a shape that has a fill, a stroke and an opacity below 1 at
// full alpha on a buffer canvas and composites the buffer once at that
// opacity ("perfectDrawEnabled"), so the stroke never double-blends over the
// fill. This does the same for one rect, through just the rect's own region.
let bufferCanvas: HTMLCanvasElement | null = null
let bufferContext: CanvasRenderingContext2D | null = null

function compositeRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  stroke: string,
  lineWidth: number,
  dash: number[] | null,
  opacity: number
) {
  const transform = ctx.getTransform()
  const canvasWidth = ctx.canvas.width
  const canvasHeight = ctx.canvas.height
  if (!bufferCanvas || !bufferContext) {
    bufferCanvas = document.createElement('canvas')
    bufferContext = bufferCanvas.getContext('2d')
    if (!bufferContext) return
  }
  if (bufferCanvas.width !== canvasWidth || bufferCanvas.height !== canvasHeight) {
    bufferCanvas.width = canvasWidth
    bufferCanvas.height = canvasHeight
  }
  // The region the rect and its stroke can touch, in device pixels.
  const margin = lineWidth / 2 + 1
  const corners = [
    transform.transformPoint({ x: x - margin, y: y - margin }),
    transform.transformPoint({ x: x + width + margin, y: y - margin }),
    transform.transformPoint({ x: x - margin, y: y + height + margin }),
    transform.transformPoint({ x: x + width + margin, y: y + height + margin })
  ]
  const dx0 = Math.max(0, Math.floor(Math.min(corners[0]!.x, corners[1]!.x, corners[2]!.x, corners[3]!.x)))
  const dy0 = Math.max(0, Math.floor(Math.min(corners[0]!.y, corners[1]!.y, corners[2]!.y, corners[3]!.y)))
  const dx1 = Math.min(canvasWidth, Math.ceil(Math.max(corners[0]!.x, corners[1]!.x, corners[2]!.x, corners[3]!.x)))
  const dy1 = Math.min(canvasHeight, Math.ceil(Math.max(corners[0]!.y, corners[1]!.y, corners[2]!.y, corners[3]!.y)))
  if (dx1 <= dx0 || dy1 <= dy0) return

  const b = bufferContext
  b.setTransform(1, 0, 0, 1, 0, 0)
  b.clearRect(dx0, dy0, dx1 - dx0, dy1 - dy0)
  b.setTransform(transform)
  b.translate(x, y)
  b.beginPath()
  b.rect(0, 0, width, height)
  b.closePath()
  b.fillStyle = fill
  b.fill()
  b.strokeStyle = stroke
  b.lineWidth = lineWidth
  b.setLineDash(dash ?? [])
  b.stroke()
  b.setLineDash([])

  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = opacity
  ctx.drawImage(bufferCanvas, dx0, dy0, dx1 - dx0, dy1 - dy0, dx0, dy0, dx1 - dx0, dy1 - dy0)
  ctx.restore()
}

const labelColorCache = new Map<string, string>()
function labelColor(fill: string): string {
  let color = labelColorCache.get(fill)
  if (color === undefined) {
    color = labelColorFor(fill)
    if (labelColorCache.size >= 1024) labelColorCache.clear()
    labelColorCache.set(fill, color)
  }
  return color
}

// ================= Layer Initialization =================

export function initializeLayers(
  state: PianoRollState,
  stage: Konva.Stage,
  onCommandStackChange?: (change: CommandStackChange, name: string) => void
) {
  // Each layer holds one immediate-mode shape whose sceneFunc draws straight
  // from `state` with raw canvas calls: no per-note nodes.

  // Grid layer (bottom, non-interactive)
  const gridLayer = new Konva.Layer({
    listening: false,
    name: 'grid-layer'
  })
  stage.add(gridLayer)
  state.layers.grid = gridLayer
  const gridShape = new Konva.Shape({
    listening: false,
    name: 'grid',
    sceneFunc: (context) => drawGrid(state, context._context)
  })
  gridLayer.add(gridShape)

  // Ghost notes (read-only, non-interactive) above the grid, below the notes
  const ghostLayer = new Konva.Layer({
    listening: false,
    name: 'ghost-layer'
  })
  stage.add(ghostLayer)
  state.layers.ghosts = ghostLayer
  const ghostShape = new Konva.Shape({
    listening: false,
    name: 'ghosts',
    sceneFunc: (context) => drawGhosts(state, context._context)
  })
  ghostLayer.add(ghostShape)

  // Notes layer: the one transparent full-stage hit target (so pointer events
  // reach the stage handlers, which hit-test geometrically) plus the notes.
  const notesLayer = new Konva.Layer({
    name: 'notes-layer'
  })
  stage.add(notesLayer)
  state.layers.notes = notesLayer
  const hitTarget = new Konva.Shape({
    listening: true,
    name: 'hit-target',
    sceneFunc: () => {},
    hitFunc: (context, shape) => {
      const owner = shape.getStage()
      if (!owner) return
      context.beginPath()
      context.rect(0, 0, owner.width(), owner.height())
      context.closePath()
      context.fillStrokeShape(shape)
    }
  })
  notesLayer.add(hitTarget)
  const notesShape = new Konva.Shape({
    listening: false,
    name: 'notes',
    sceneFunc: (context) => drawNotes(state, context._context)
  })
  notesLayer.add(notesShape)

  // Overlay layer (marquee, queue playhead, playhead markers)
  const overlayLayer = new Konva.Layer({
    listening: false,
    name: 'overlay-layer'
  })
  stage.add(overlayLayer)
  state.layers.overlay = overlayLayer
  const overlayShape = new Konva.Shape({
    listening: false,
    name: 'overlay',
    sceneFunc: (context) => drawOverlay(state, context._context)
  })
  overlayLayer.add(overlayShape)

  state.shapes = { grid: gridShape, ghosts: ghostShape, notes: notesShape, hitTarget, overlay: overlayShape }

  // Initialize command stack (only once; a remount keeps the history)
  if (!state.command.stack) {
    state.command.stack = new CommandStack(
      () => captureState(state),
      (snapshot) => restoreState(state, snapshot),
      (change, name) => {
        invalidateNoteIndex(state)
        state.needsRedraw = true
        onCommandStackChange?.(change, name)
      }
    )
  }
}

// ================= Scene functions =================

function drawGrid(state: PianoRollState, ctx: CanvasRenderingContext2D) {
  const stage = state.stage
  if (!stage) return

  const viewportWidth = stage.width()
  const viewportHeight = getNoteAreaHeight(state, stage.height())
  const maxLength = getMaxLength(state)

  const { scrollX, scrollY } = state.viewport
  const { quarterNoteWidth, noteHeight, timeSignature } = state.grid

  const pianoRollHeight = 128 * noteHeight
  const pulsesPerMeasure = timeSignature * 4
  const measureWidth = quarterNoteWidth * pulsesPerMeasure
  const numMeasures = Math.ceil(maxLength / pulsesPerMeasure)
  const contentWidth = maxLength * quarterNoteWidth

  // Measure backgrounds
  const firstVisibleMeasure = Math.floor(scrollX / measureWidth)
  const lastVisibleMeasure = Math.ceil((scrollX + viewportWidth) / measureWidth)

  for (let i = firstVisibleMeasure; i <= lastVisibleMeasure && i < numMeasures; i++) {
    ctx.fillStyle = i % 2 === 0 ? state.grid.backgroundColor1 : state.grid.backgroundColor2
    ctx.fillRect(i * measureWidth - scrollX, -scrollY, measureWidth, pianoRollHeight)
  }

  // Vertical lines (time grid). Each line is its own stroke: Skia rasterizes
  // a many-segment path differently from single segments, so batching them
  // would not be pixel-identical to the Konva.Line nodes this replaces.
  const numVertLines = Math.ceil(maxLength * (state.grid.subdivision / 4))
  const vertLineSpace = quarterNoteWidth * (4 / state.grid.subdivision)

  const firstVisibleLine = Math.floor(scrollX / vertLineSpace)
  const lastVisibleLine = Math.ceil((scrollX + viewportWidth) / vertLineSpace)

  ctx.strokeStyle = '#000'
  let lineWidth = 0
  for (let i = firstVisibleLine; i <= lastVisibleLine && i <= numVertLines; i++) {
    const xPos = i * vertLineSpace - scrollX
    const isQuarterNote = (i * vertLineSpace) % quarterNoteWidth === 0
    const strokeWidth = isQuarterNote ? 1.8 : 1
    if (strokeWidth !== lineWidth) {
      lineWidth = strokeWidth
      ctx.lineWidth = strokeWidth
    }
    ctx.beginPath()
    ctx.moveTo(xPos, -scrollY)
    ctx.lineTo(xPos, pianoRollHeight - scrollY)
    ctx.stroke()
  }

  // Horizontal lines (pitch boundaries)
  const firstVisiblePitch = Math.floor(scrollY / noteHeight)
  const lastVisiblePitch = Math.ceil((scrollY + viewportHeight) / noteHeight)

  ctx.lineWidth = 1
  for (let i = firstVisiblePitch; i <= lastVisiblePitch && i < 128; i++) {
    const yPos = i * noteHeight - scrollY
    ctx.beginPath()
    ctx.moveTo(0 - scrollX, yPos)
    ctx.lineTo(contentWidth - scrollX, yPos)
    ctx.stroke()
  }

  // Loop end: shade everything past it, then the end line itself
  const loopEndX = state.grid.loopLength * quarterNoteWidth - scrollX
  if (loopEndX < viewportWidth) {
    const x = Math.max(loopEndX, 0)
    ctx.fillStyle = BEYOND_LOOP_FILL
    ctx.fillRect(x, 0, Math.max(0, viewportWidth - x), viewportHeight)
  }
  if (loopEndX >= -2 && loopEndX <= viewportWidth + 2) {
    ctx.strokeStyle = LOOP_END_COLOR
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(loopEndX, 0)
    ctx.lineTo(loopEndX, viewportHeight)
    ctx.stroke()
  }
}

function drawGhosts(state: PianoRollState, ctx: CanvasRenderingContext2D) {
  if (!state.stage || state.ghostNotes.length === 0) return

  const { scrollX, scrollY } = state.viewport
  const { quarterNoteWidth, noteHeight } = state.grid
  let alpha = 1
  const setAlpha = (value: number) => {
    if (value !== alpha) {
      alpha = value
      ctx.globalAlpha = value
    }
  }
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'

  for (const ghost of state.ghostNotes) {
    const visible = isNoteVisible(ghost, state)
    const x = ghost.position * quarterNoteWidth - scrollX
    const y = (127 - ghost.pitch) * noteHeight - scrollY
    const width = ghost.duration * quarterNoteWidth
    const color = ghost.color ?? GHOST_DEFAULT_COLOR
    const opacity = ghost.opacity ?? GHOST_DEFAULT_OPACITY

    // Connector to the source note, drawn even when only one end is on screen
    if (ghost.linkTo) {
      const source = state.notes.get(ghost.linkTo)
      if (source) {
        const sourceX = source.position * quarterNoteWidth - scrollX
        const sourceY = (127 - source.pitch) * noteHeight - scrollY
        setAlpha(Math.min(1, opacity + 0.4))
        ctx.strokeStyle = color
        ctx.lineWidth = 1.5
        ctx.setLineDash([4, 3])
        ctx.beginPath()
        ctx.moveTo(sourceX + 2, sourceY + noteHeight / 2)
        ctx.lineTo(x + 2, y + noteHeight / 2)
        ctx.stroke()
      }
    }

    if (!visible) continue

    if (opacity !== 1) {
      compositeRect(ctx, x, y, width, noteHeight, color, '#000', 1, [3, 2], opacity)
    } else {
      setAlpha(1)
      ctx.save()
      ctx.translate(x, y)
      ctx.beginPath()
      ctx.rect(0, 0, width, noteHeight)
      ctx.closePath()
      ctx.fillStyle = color
      ctx.fill()
      ctx.strokeStyle = '#000'
      ctx.lineWidth = 1
      ctx.setLineDash([3, 2])
      ctx.stroke()
      ctx.restore()
    }

    if (ghost.label && noteHeight >= 8) {
      const fontSize = Math.min(12, Math.max(8, noteHeight - 6))
      setAlpha(Math.min(1, opacity + 0.3))
      ctx.save()
      ctx.translate(x + 4, y + 2)
      ctx.font = ghostFont(fontSize)
      ctx.fillStyle = labelColor(color)
      ctx.fillText(ghost.label, 0, fontSize / 2)
      ctx.restore()
    }
  }
}

const drawScratch: VisibleNote[] = []

function drawNotes(state: PianoRollState, ctx: CanvasRenderingContext2D) {
  if (!state.stage) return

  const visible = collectVisibleNotes(state, drawScratch)
  const { scrollX, scrollY } = state.viewport
  const { quarterNoteWidth, noteHeight, noteColor, selectedNoteColor } = state.grid
  const selectedIds = state.selection.selectedIds
  const hiddenNoteIds = state.interaction.hiddenNoteIds
  const truncatedNotes = state.interaction.truncatedNotes
  // Overlap preview state is empty outside gestures: skip the lookups then.
  const anyHidden = hiddenNoteIds.size > 0
  const anyTruncated = truncatedNotes.size > 0
  const showText = noteHeight >= 8
  const badgeHook = state.hooks.noteBadge

  let alpha = 1
  let lineWidth = 0
  let font = ''
  const setAlpha = (value: number) => {
    if (value !== alpha) {
      alpha = value
      ctx.globalAlpha = value
    }
  }
  const setLineWidth = (value: number) => {
    if (value !== lineWidth) {
      lineWidth = value
      ctx.lineWidth = value
    }
  }
  const setFont = (value: string) => {
    if (value !== font) {
      font = value
      ctx.font = value
    }
  }
  if (showText) {
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
  }

  const drawNote = (id: string, note: NoteData, selected: boolean) => {
    const x = note.position * quarterNoteWidth - scrollX
    const y = (127 - note.pitch) * noteHeight - scrollY
    let width: number
    let fill: string
    let stroke: string
    let strokeWidth: number
    if (selected) {
      // Selected notes use their actual duration (not truncated). A note with
      // its own color keeps it while selected and shows selection through a
      // heavy stroke instead; the default swaps the fill as before.
      width = note.duration * quarterNoteWidth
      const ownColor = resolveNoteFill(state, note, '')
      fill = ownColor || selectedNoteColor
      stroke = ownColor ? selectedNoteColor : '#000'
      strokeWidth = ownColor ? 3 : 1
    } else {
      // Use display duration (may be truncated)
      width = (anyTruncated ? (truncatedNotes.get(id) ?? note.duration) : note.duration) * quarterNoteWidth
      fill = resolveNoteFill(state, note, noteColor)
      stroke = '#000'
      strokeWidth = 1
    }
    const opacity = anyHidden && hiddenNoteIds.has(id) ? 0.3 : 1
    if (opacity !== 1) {
      // Hidden (overlap preview) notes composite as one translucent shape
      compositeRect(ctx, x, y, width, noteHeight, fill, stroke, strokeWidth, null, opacity)
    } else {
      setAlpha(1)
      ctx.fillStyle = fill
      ctx.fillRect(x, y, width, noteHeight)
      setLineWidth(strokeWidth)
      ctx.strokeStyle = stroke
      ctx.strokeRect(x, y, width, noteHeight)
    }

    const bendPoints = note.mpePitch?.points
    if (bendPoints && bendPoints.length > 0) {
      setAlpha(opacity)
      drawPitchCurve(ctx, x, y + noteHeight / 2, width, noteHeight, bendPoints, labelColor(fill))
      lineWidth = -1
    }

    if (!showText) return
    setAlpha(opacity)
    const textFill = labelColor(fill)
    const label = midiPitchToString(note.pitch)
    setFont(LABEL_FONT)
    ctx.fillStyle = textFill
    ctx.fillText(label, x + 4, y + 2 + LABEL_FONT_SIZE / 2)

    // Host badge on the right side, only when the note has room for it
    const badgeText = badgeHook?.(note)
    if (badgeText) {
      const badgeWidth = textWidth(BADGE_FONT, badgeText)
      if (textWidth(LABEL_FONT, label) + badgeWidth + 14 <= width) {
        setFont(BADGE_FONT)
        ctx.fillText(badgeText, x + width - badgeWidth - 4, y + 3 + BADGE_FONT_SIZE / 2)
      }
    }
  }

  // Unselected notes first (back), selected notes last (front)
  for (let i = 0; i < visible.length; i++) {
    const entry = visible[i]!
    if (!selectedIds.has(entry.id)) drawNote(entry.id, entry.note, false)
  }
  for (let i = 0; i < visible.length; i++) {
    const entry = visible[i]!
    if (selectedIds.has(entry.id)) drawNote(entry.id, entry.note, true)
  }

  // Resize handles on the selected, visible notes (on top of everything)
  if (selectedIds.size > 0) {
    setAlpha(1)
    ctx.fillStyle = '#000'
    for (let i = 0; i < visible.length; i++) {
      const entry = visible[i]!
      if (!selectedIds.has(entry.id)) continue
      const note = entry.note
      const x = note.position * quarterNoteWidth - scrollX
      const cy = (127 - note.pitch) * noteHeight - scrollY + noteHeight / 2
      ctx.beginPath()
      ctx.arc(x, cy, HANDLE_RADIUS, 0, TWO_PI, false)
      ctx.closePath()
      ctx.fill()
      ctx.beginPath()
      ctx.arc(x + note.duration * quarterNoteWidth, cy, HANDLE_RADIUS, 0, TWO_PI, false)
      ctx.closePath()
      ctx.fill()
    }
  }
}

/** A note's MPE pitch curve: a line from its row centre, one row per semitone. */
function drawPitchCurve(
  ctx: CanvasRenderingContext2D,
  x: number,
  centerY: number,
  width: number,
  noteHeight: number,
  points: ReadonlyArray<{ time: number; pitchOffset: number }>,
  color: string
) {
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.beginPath()
  if (points[0]!.time > 0) ctx.moveTo(x, centerY - points[0]!.pitchOffset * noteHeight)
  for (let i = 0; i < points.length; i++) {
    const point = points[i]!
    const px = x + point.time * width
    const py = centerY - point.pitchOffset * noteHeight
    if (i === 0 && point.time <= 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  const last = points[points.length - 1]!
  if (last.time < 1) ctx.lineTo(x + width, centerY - last.pitchOffset * noteHeight)
  ctx.stroke()
}

const LIVE_KEY_COLOR = '255, 82, 82'
const LIVE_NOTE_FILL = '#ff5252'
const LIVE_BEND_TICK = 28

/** Held input keys (row highlights) and notes being recorded (growing notes). */
function drawLiveInput(state: PianoRollState, ctx: CanvasRenderingContext2D, stageWidth: number) {
  const { keys, notes } = state.liveInput
  if (keys.length === 0 && notes.length === 0) return
  const { scrollX, scrollY } = state.viewport
  const { quarterNoteWidth, noteHeight } = state.grid

  for (const key of keys) {
    const y = (127 - key.pitch) * noteHeight - scrollY
    const strength = 0.12 + 0.25 * (key.velocity / 127)
    ctx.fillStyle = `rgba(${LIVE_KEY_COLOR}, ${strength})`
    ctx.fillRect(0, y, stageWidth, noteHeight)
    ctx.fillStyle = `rgb(${LIVE_KEY_COLOR})`
    ctx.fillRect(0, y, 6, noteHeight)
    if (Math.abs(key.pitchOffset) > 0.02) {
      // The bend as a short tick from the key's edge marker to where it sounds.
      const bentY = y + noteHeight / 2 - key.pitchOffset * noteHeight
      ctx.strokeStyle = `rgb(${LIVE_KEY_COLOR})`
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(3, y + noteHeight / 2)
      ctx.lineTo(3, bentY)
      ctx.lineTo(LIVE_BEND_TICK, bentY)
      ctx.stroke()
    }
  }

  for (const note of notes) {
    const x = note.position * quarterNoteWidth - scrollX
    const y = (127 - note.pitch) * noteHeight - scrollY
    const width = Math.max(2, note.duration * quarterNoteWidth)
    ctx.globalAlpha = 0.55 + 0.45 * (note.velocity / 127)
    ctx.fillStyle = LIVE_NOTE_FILL
    ctx.fillRect(x, y, width, noteHeight)
    ctx.globalAlpha = 1
    ctx.strokeStyle = '#000'
    ctx.lineWidth = 1
    ctx.strokeRect(x, y, width, noteHeight)
    const curve = note.curve
    if (curve && curve.length > 1) {
      const centerY = y + noteHeight / 2
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      for (let i = 0; i < curve.length; i++) {
        const px = curve[i]!.position * quarterNoteWidth - scrollX
        const py = centerY - curve[i]!.pitchOffset * noteHeight
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.stroke()
    }
  }
}

function drawOverlay(state: PianoRollState, ctx: CanvasRenderingContext2D) {
  const stage = state.stage
  if (!stage) return

  const { scrollX } = state.viewport
  const { quarterNoteWidth } = state.grid
  const stageHeight = stage.height()

  drawLiveInput(state, ctx, stage.width())

  // Marquee selection rectangle
  const { marqueeStart, marqueeCurrent, isMarqueeSelecting } = state.interaction
  if (isMarqueeSelecting && marqueeStart && marqueeCurrent) {
    const x = Math.min(marqueeStart.x, marqueeCurrent.x)
    const y = Math.min(marqueeStart.y, marqueeCurrent.y)
    const width = Math.abs(marqueeCurrent.x - marqueeStart.x)
    const height = Math.abs(marqueeCurrent.y - marqueeStart.y)
    if (width > 5 || height > 5) {
      ctx.save()
      ctx.translate(x, y)
      ctx.beginPath()
      ctx.rect(0, 0, width, height)
      ctx.closePath()
      ctx.fillStyle = MARQUEE_FILL
      ctx.fill()
      ctx.strokeStyle = MARQUEE_STROKE
      ctx.lineWidth = 1
      ctx.setLineDash([3, 3])
      ctx.stroke()
      ctx.restore()
    }
  }

  // Queue playhead (green)
  const queueX = state.queuePlayhead.position * quarterNoteWidth - scrollX
  ctx.strokeStyle = QUEUE_PLAYHEAD_COLOR
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(queueX, 0)
  ctx.lineTo(queueX, stageHeight)
  ctx.stroke()

  // One labeled line per marker
  const { markers } = state.playheadMarkers
  if (markers.length > 0) {
    ctx.font = MARKER_FONT
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    for (const marker of markers) {
      const color = marker.color ?? PLAYHEAD_MARKER_COLOR
      const x = marker.position * quarterNoteWidth - scrollX
      ctx.strokeStyle = color
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, stageHeight)
      ctx.stroke()
      ctx.fillStyle = color
      ctx.fillText(marker.id, x + 3, 2 + MARKER_FONT_SIZE / 2)
    }
  }
}

// ================= Rendering Functions =================
// A redraw of a layer is a batchDraw(): its shape draws from the live state.

export function renderGrid(state: PianoRollState) {
  const gridLayer = state.layers.grid
  if (!gridLayer || !state.stage) return

  const gridCache = state.renderCache.grid

  const stage = state.stage
  const viewportWidth = stage.width()
  const viewportHeight = getNoteAreaHeight(state, stage.height())
  const maxLength = getMaxLength(state)

  // Only redraw if viewport, subdivision or extent changed
  if (
    gridCache.lastScrollX === state.viewport.scrollX &&
    gridCache.lastScrollY === state.viewport.scrollY &&
    gridCache.lastSubdivision === state.grid.subdivision &&
    gridCache.lastQuarterNoteWidth === state.grid.quarterNoteWidth &&
    gridCache.lastNoteHeight === state.grid.noteHeight &&
    gridCache.lastStageWidth === viewportWidth &&
    gridCache.lastStageHeight === viewportHeight &&
    gridCache.lastLoopLength === state.grid.loopLength &&
    gridCache.lastMaxLength === maxLength
  ) {
    return
  }

  gridCache.lastScrollX = state.viewport.scrollX
  gridCache.lastScrollY = state.viewport.scrollY
  gridCache.lastSubdivision = state.grid.subdivision
  gridCache.lastQuarterNoteWidth = state.grid.quarterNoteWidth
  gridCache.lastNoteHeight = state.grid.noteHeight
  gridCache.lastStageWidth = viewportWidth
  gridCache.lastStageHeight = viewportHeight
  gridCache.lastLoopLength = state.grid.loopLength
  gridCache.lastMaxLength = maxLength

  gridLayer.batchDraw()
}

export function renderGhostNotes(state: PianoRollState) {
  const ghostLayer = state.layers.ghosts
  if (!ghostLayer || !state.stage) return
  ghostLayer.batchDraw()
}

export function renderVisibleNotes(state: PianoRollState) {
  const notesLayer = state.layers.notes
  if (!notesLayer || !state.stage) return
  notesLayer.batchDraw()
}

/** Handles are drawn by the notes shape; this redraws that layer. */
export function renderResizeHandles(state: PianoRollState) {
  const notesLayer = state.layers.notes
  if (!notesLayer) return
  notesLayer.batchDraw()
}

export function renderMarqueeRect(state: PianoRollState) {
  if (!state.interaction.marqueeStart || !state.interaction.marqueeCurrent) return
  state.layers.overlay?.batchDraw()
}

export function updateQueuePlayheadPosition(state: PianoRollState) {
  state.layers.overlay?.batchDraw()
}

/** Markers are drawn from `state.playheadMarkers.markers` on every overlay redraw. */
export function updatePlayheadMarkers(state: PianoRollState) {
  state.layers.overlay?.batchDraw()
}

// ================= Hit testing =================

export type HitResult =
  | { kind: 'handle'; noteId: string; isEnd: boolean }
  | { kind: 'note'; noteId: string }
  | { kind: 'background' }

const BACKGROUND_HIT: HitResult = { kind: 'background' }
const hitScratch: VisibleNote[] = []

/**
 * What is under a stage point, using the geometry the notes shape draws:
 * resize handles (drawn last) win over notes, selected notes (drawn after
 * the unselected ones) win over unselected, and later-drawn notes win over
 * earlier ones. Rect hits include half the stroke width, as Konva's hit
 * canvas did.
 */
export function hitTest(state: PianoRollState, pos: { x: number; y: number }): HitResult {
  if (!state.stage) return BACKGROUND_HIT

  const { scrollX, scrollY } = state.viewport
  const { quarterNoteWidth, noteHeight } = state.grid
  const selectedIds = state.selection.selectedIds

  // Handles: start and end circles of each selected, visible note
  if (selectedIds.size > 0) {
    const ids = Array.from(selectedIds)
    const r2 = HANDLE_RADIUS * HANDLE_RADIUS
    for (let i = ids.length - 1; i >= 0; i--) {
      const id = ids[i]!
      const note = state.notes.get(id)
      if (!note || !isNoteVisible(note, state)) continue
      const x = note.position * quarterNoteWidth - scrollX
      const dy = pos.y - ((127 - note.pitch) * noteHeight - scrollY + noteHeight / 2)
      const dxEnd = pos.x - (x + note.duration * quarterNoteWidth)
      if (dxEnd * dxEnd + dy * dy <= r2) return { kind: 'handle', noteId: id, isEnd: true }
      const dxStart = pos.x - x
      if (dxStart * dxStart + dy * dy <= r2) return { kind: 'handle', noteId: id, isEnd: false }
    }
  }

  const visible = collectVisibleNotes(state, hitScratch)

  const hitsRect = (note: NoteData, width: number, strokeWidth: number) => {
    const half = strokeWidth / 2
    const x = note.position * quarterNoteWidth - scrollX
    const y = (127 - note.pitch) * noteHeight - scrollY
    return pos.x >= x - half && pos.x <= x + width + half && pos.y >= y - half && pos.y <= y + noteHeight + half
  }

  // Selected notes (front), last drawn first
  for (let i = visible.length - 1; i >= 0; i--) {
    const entry = visible[i]!
    if (!selectedIds.has(entry.id)) continue
    const ownColor = resolveNoteFill(state, entry.note, '')
    if (hitsRect(entry.note, entry.note.duration * quarterNoteWidth, ownColor ? 3 : 1)) {
      return { kind: 'note', noteId: entry.id }
    }
  }

  // Unselected notes (back), last drawn first
  for (let i = visible.length - 1; i >= 0; i--) {
    const entry = visible[i]!
    if (selectedIds.has(entry.id)) continue
    const width = getNoteDisplayDuration(state, entry.id, entry.note.duration) * quarterNoteWidth
    if (hitsRect(entry.note, width, 1)) {
      return { kind: 'note', noteId: entry.id }
    }
  }

  return BACKGROUND_HIT
}

// ================= Interaction Handlers =================

type PointerLikeEvent = MouseEvent | PointerEvent | TouchEvent | undefined

export function setupEventHandlers(state: PianoRollState, stage: Konva.Stage): () => void {
  // Konva routed events to whatever its hit canvas found; everything now
  // reaches the stage and is resolved geometrically. A stage that is not
  // listening hits nothing, as before.
  const hitAt = (): HitResult => {
    const pos = stage.getPointerPosition()
    if (!pos || !stage.isListening()) return BACKGROUND_HIT
    return hitTest(state, pos)
  }

  // Konva counts any two mouseups within its dblClickWindow as a double click,
  // even with a drag in between, so a real double click is recognised here:
  // two presses at the same spot with no movement.
  let lastDownPos: { x: number; y: number } | undefined
  let prevDownPos: { x: number; y: number } | undefined
  let movedSinceDown = false
  const DBLCLICK_SLOP = 5
  const isStationaryDoubleClick = () =>
    !!lastDownPos &&
    !!prevDownPos &&
    !movedSinceDown &&
    Math.abs(lastDownPos.x - prevDownPos.x) <= DBLCLICK_SLOP &&
    Math.abs(lastDownPos.y - prevDownPos.y) <= DBLCLICK_SLOP

  // Double-click on background → Add note (select mode; draw mode already drew one on mousedown)
  stage.on('dblclick dbltap', () => {
    if (state.grid.drawMode) return
    if (!isStationaryDoubleClick()) return
    if (hitAt().kind === 'background') {
      const pos = stage.getPointerPosition()
      if (!pos) return

      const { pitch, position } = screenToPitchPosition(pos, state)
      const quantizedPos = state.grid.snapToGrid ? quantizeToGrid(position, state.grid.subdivision) : position
      const quantizedPitch = Math.round(pitch)

      let created: NoteData | undefined
      state.command.stack?.executeCommand('Add Note', () => {
        const note: NoteData = {
          id: uid(),
          pitch: quantizedPitch,
          position: quantizedPos,
          duration: getGridUnitBeats(state),
          velocity: DEFAULT_VELOCITY
        }
        state.notes.set(note.id, note)
        created = note
        state.needsRedraw = true
      })
      if (created) previewNote(state, created)
    }
  })

  // Click on note or handle
  stage.on('mousedown touchstart', (e) => {
    const isShift = !!(e.evt as PointerLikeEvent)?.shiftKey
    const downPos = stage.getPointerPosition()
    prevDownPos = movedSinceDown ? undefined : lastDownPos
    lastDownPos = downPos ? { x: downPos.x, y: downPos.y } : undefined
    movedSinceDown = false

    const hit = hitAt()

    // Clicking on resize handle
    if (hit.kind === 'handle') {
      startResize(state, stage, hit.noteId, hit.isEnd)
      return
    }

    // Clicking on note
    if (hit.kind === 'note') {
      const noteId = hit.noteId
      const isSelected = state.selection.selectedIds.has(noteId)

      mutateSelection(state, () => {
        if (isShift) {
          if (isSelected) {
            state.selection.selectedIds.delete(noteId)
          } else {
            state.selection.selectedIds.add(noteId)
          }
          return
        }
        if (!isSelected) {
          state.selection.selectedIds.clear()
          state.selection.selectedIds.add(noteId)
        }
      })

      const clicked = state.notes.get(noteId)
      if (clicked && state.selection.selectedIds.has(noteId)) previewNote(state, clicked)

      // Start drag for selected notes
      startNoteDrag(state, stage, noteId)
      state.dirty.notes = true
      return
    }

    // Clicking on background → draw a note (draw mode) or start marquee selection
    const pos = stage.getPointerPosition()
    if (!pos) return

    if (state.grid.drawMode && !isShift) {
      startDraw(state, pos)
      return
    }

    state.interaction.isMarqueeSelecting = true
    state.interaction.marqueeStart = pos
    state.interaction.marqueeCurrent = pos
    state.interaction.marqueeIsShift = isShift
    state.interaction.marqueeInitialSelection = isShift ? new Set(state.selection.selectedIds) : new Set()

    if (!isShift) {
      mutateSelection(state, () => {
        state.selection.selectedIds.clear()
      })
    }

    state.dirty.notes = true
  })

  // Mouse move
  stage.on('mousemove touchmove', () => {
    const pos = stage.getPointerPosition()
    if (!pos) return
    if (
      lastDownPos &&
      (state.interaction.isDragging || state.interaction.isResizing || state.interaction.isDrawing || state.interaction.isMarqueeSelecting) &&
      (Math.abs(pos.x - lastDownPos.x) > DBLCLICK_SLOP || Math.abs(pos.y - lastDownPos.y) > DBLCLICK_SLOP)
    ) {
      movedSinceDown = true
    }

    // Handle drag
    if (state.interaction.isDragging) {
      updateNoteDrag(state, stage)
      return
    }

    // Handle resize
    if (state.interaction.isResizing) {
      updateNoteResize(state, stage)
      return
    }

    // Handle draw
    if (state.interaction.isDrawing) {
      updateDraw(state, pos)
      return
    }

    // Handle marquee selection
    if (state.interaction.isMarqueeSelecting) {
      state.interaction.marqueeCurrent = pos

      renderMarqueeRect(state)

      // Update selection based on intersection
      const rect = {
        x: Math.min(state.interaction.marqueeStart!.x, pos.x),
        y: Math.min(state.interaction.marqueeStart!.y, pos.y),
        width: Math.abs(pos.x - state.interaction.marqueeStart!.x),
        height: Math.abs(pos.y - state.interaction.marqueeStart!.y)
      }

      const intersecting = getNotesInRect(state, rect)

      mutateSelection(state, () => {
        if (state.interaction.marqueeIsShift) {
          const base = state.interaction.marqueeInitialSelection ?? new Set<string>()
          state.selection.selectedIds = new Set(base)
        } else {
          state.selection.selectedIds.clear()
        }
        intersecting.forEach((id) => state.selection.selectedIds.add(id))
      })

      state.dirty.notes = true
    }
  })

  // Mouse up
  stage.on('mouseup touchend', () => {
    if (state.interaction.isDragging) {
      finishNoteDrag(state)
      return
    }

    if (state.interaction.isResizing) {
      finishNoteResize(state)
      return
    }

    if (state.interaction.isDrawing) {
      finishDraw(state)
      return
    }

    if (state.interaction.isMarqueeSelecting) {
      const wasClick =
        state.interaction.marqueeStart &&
        state.interaction.marqueeCurrent &&
        Math.abs(state.interaction.marqueeStart.x - state.interaction.marqueeCurrent.x) < 5 &&
        Math.abs(state.interaction.marqueeStart.y - state.interaction.marqueeCurrent.y) < 5

      state.interaction.isMarqueeSelecting = false
      state.interaction.marqueeInitialSelection = undefined
      // The overlay no longer draws the marquee once the gesture is over
      state.layers.overlay?.batchDraw()

      // If it was a click (not a drag), move queue playhead to clicked position
      if (wasClick && hitAt().kind === 'background') {
        const pos = stage.getPointerPosition()
        if (pos) {
          const { position } = screenToPitchPosition(pos, state)
          const quantizedPos = quantizeToGrid(position, state.grid.subdivision)
          state.queuePlayhead.position = Math.max(0, Math.min(quantizedPos, getMaxLength(state)))
          state.dirty.overlay = true
          state.notifyExternalChange?.('playhead') // for queue playhead update
        }
      }
    }
  })

  // A pointer released outside the stage ends the gesture (the Vue version
  // left it hanging; see notes.md there). Registered in the CAPTURE phase so a
  // host that stops propagation inside its own wrapper (tldraw shields do)
  // cannot swallow it; a cancelled pointer or a lost window focus ends the
  // gesture the same way.
  const container = stage.container()
  const endGesture = () => {
    if (!state.stage) return
    if (state.interaction.isDragging) finishNoteDrag(state)
    else if (state.interaction.isResizing) finishNoteResize(state)
    else if (state.interaction.isDrawing) finishDraw(state)
    else if (state.interaction.isMarqueeSelecting) {
      state.interaction.isMarqueeSelecting = false
      state.interaction.marqueeInitialSelection = undefined
      state.layers.overlay?.batchDraw()
    }
  }
  const onWindowPointerUp = (event: PointerEvent) => {
    if (event.target instanceof Node && container.contains(event.target)) return
    endGesture()
  }
  window.addEventListener('pointerup', onWindowPointerUp, true)
  window.addEventListener('pointercancel', endGesture, true)
  window.addEventListener('blur', endGesture)
  return () => {
    window.removeEventListener('pointerup', onWindowPointerUp, true)
    window.removeEventListener('pointercancel', endGesture, true)
    window.removeEventListener('blur', endGesture)
    stage.off('dblclick dbltap mousedown touchstart mousemove touchmove mouseup touchend')
  }
}

// ================= Drag Handlers =================

function startNoteDrag(state: PianoRollState, stage: Konva.Stage, primaryId: string) {
  const pos = stage.getPointerPosition()
  if (!pos) return

  state.interaction.isDragging = true
  state.interaction.dragStartPos = pos
  state.interaction.quantDragActivated = false
  state.interaction.dragBeforeState = captureState(state)
  state.interaction.dragPrimaryId = primaryId
  state.interaction.dragPreviewPitch = state.notes.get(primaryId)?.pitch

  // Store initial states for all selected notes
  state.interaction.draggedNoteInitialStates.clear()
  state.selection.selectedIds.forEach((id) => {
    const note = state.notes.get(id)
    if (note) {
      state.interaction.draggedNoteInitialStates.set(id, {
        position: note.position,
        pitch: note.pitch
      })
    }
  })
}

function updateNoteDrag(state: PianoRollState, stage: Konva.Stage) {
  const pos = stage.getPointerPosition()
  if (!pos || !state.interaction.dragStartPos) return

  const dx = pos.x - state.interaction.dragStartPos.x
  const dy = pos.y - state.interaction.dragStartPos.y

  // Quantization logic
  const quantWidth = getGridUnitWidth(state)
  let xMove
  if (!state.grid.snapToGrid) {
    xMove = dx
  } else if (Math.abs(dx) < quantWidth * 0.9 && !state.interaction.quantDragActivated) {
    xMove = dx
  } else {
    xMove = Math.round(dx / quantWidth) * quantWidth
    state.interaction.quantDragActivated = true
  }

  // Pitch quantization (always snapped)
  const pitchDelta = Math.round(dy / state.grid.noteHeight)

  // Update all selected notes
  state.interaction.draggedNoteInitialStates.forEach((initial, id) => {
    const note = state.notes.get(id)
    if (note) {
      note.position = Math.max(0, initial.position + xMove / state.grid.quarterNoteWidth)
      note.pitch = Math.max(0, Math.min(127, initial.pitch - pitchDelta))
    }
  })

  // Apply snap-to-note-start
  if (state.grid.snapToGrid) applySnapToNoteStart(state)

  // Audition the primary note once per pitch row it crosses
  const primary = state.interaction.dragPrimaryId ? state.notes.get(state.interaction.dragPrimaryId) : undefined
  if (primary && primary.pitch !== state.interaction.dragPreviewPitch) {
    state.interaction.dragPreviewPitch = primary.pitch
    previewNote(state, primary)
  }

  // Overlap detection & preview
  updateOverlapPreview(state)

  state.needsRedraw = true
}

function finishNoteDrag(state: PianoRollState) {
  // Execute overlap changes (truncate/delete notes)
  executeOverlapChanges(state)

  const after = captureState(state)
  if (state.interaction.dragBeforeState && state.interaction.dragBeforeState !== after) {
    state.command.stack?.pushCommand('Move Notes', state.interaction.dragBeforeState, after)
  }

  state.interaction.isDragging = false
  state.interaction.dragPrimaryId = undefined
  state.interaction.dragPreviewPitch = undefined
  clearOverlapPreview(state)
  invalidateNoteIndex(state)
  state.needsRedraw = true
}

// ================= Resize Handlers =================

function startResize(state: PianoRollState, stage: Konva.Stage, noteId: string, isEnd: boolean) {
  const pos = stage.getPointerPosition()
  if (!pos) return

  state.interaction.isResizing = true
  state.interaction.resizeTargetId = noteId
  state.interaction.resizeIsEnd = isEnd
  state.interaction.quantResizeActivated = false
  state.interaction.dragStartPos = pos
  state.interaction.resizeBeforeState = captureState(state)

  // Store initial states for ALL selected notes
  state.interaction.resizeInitialStates.clear()
  state.selection.selectedIds.forEach((id) => {
    const note = state.notes.get(id)
    if (note) {
      state.interaction.resizeInitialStates.set(id, {
        position: note.position,
        duration: note.duration
      })
    }
  })
}

function updateNoteResize(state: PianoRollState, stage: Konva.Stage) {
  const pos = stage.getPointerPosition()
  if (!pos || !state.interaction.dragStartPos) return

  const dx = pos.x - state.interaction.dragStartPos.x

  // Apply same quantization as drag
  const quantWidth = getGridUnitWidth(state)
  let xMove
  if (!state.grid.snapToGrid) {
    xMove = dx
  } else if (Math.abs(dx) < quantWidth * 0.9 && !state.interaction.quantResizeActivated) {
    xMove = dx
  } else {
    xMove = Math.round(dx / quantWidth) * quantWidth
    state.interaction.quantResizeActivated = true
  }

  const positionDelta = xMove / state.grid.quarterNoteWidth

  // Update all selected notes
  state.interaction.resizeInitialStates.forEach((initial, id) => {
    const note = state.notes.get(id)
    if (!note) return

    if (state.interaction.resizeIsEnd) {
      // Resize end: change duration
      note.duration = Math.max(MIN_NOTE_DURATION, initial.duration + positionDelta)
    } else {
      // Resize start: change position AND duration
      note.position = initial.position + positionDelta
      note.duration = Math.max(MIN_NOTE_DURATION, initial.duration - positionDelta)
    }
  })

  updateOverlapPreview(state)
  state.needsRedraw = true
}

function finishNoteResize(state: PianoRollState) {
  // Execute overlap changes (truncate/delete notes)
  executeOverlapChanges(state)

  const after = captureState(state)
  if (state.interaction.resizeBeforeState && state.interaction.resizeBeforeState !== after) {
    state.command.stack?.pushCommand('Resize Notes', state.interaction.resizeBeforeState, after)
  }

  state.interaction.isResizing = false
  clearOverlapPreview(state)
  invalidateNoteIndex(state)
  state.needsRedraw = true
}

// ================= Draw Handlers (draw mode) =================

function startDraw(state: PianoRollState, pos: { x: number; y: number }) {
  const { pitch, position } = screenToPitchPosition(pos, state)
  const start = state.grid.snapToGrid ? quantizeToGrid(position, state.grid.subdivision) : Math.max(0, position)
  const note: NoteData = {
    id: uid(),
    pitch: Math.max(0, Math.min(127, Math.round(pitch))),
    position: start,
    duration: state.grid.snapToGrid ? getGridUnitBeats(state) : MIN_NOTE_DURATION,
    velocity: DEFAULT_VELOCITY
  }

  state.interaction.isDrawing = true
  state.interaction.drawBeforeState = captureState(state)
  state.interaction.drawNoteId = note.id
  state.interaction.drawStartPosition = start

  state.notes.set(note.id, note)
  mutateSelection(state, () => {
    state.selection.selectedIds.clear()
    state.selection.selectedIds.add(note.id)
  })
  previewNote(state, note)
  updateOverlapPreview(state)
  state.needsRedraw = true
}

function updateDraw(state: PianoRollState, pos: { x: number; y: number }) {
  const id = state.interaction.drawNoteId
  const start = state.interaction.drawStartPosition
  if (!id || start === undefined) return
  const note = state.notes.get(id)
  if (!note) return

  const { position } = screenToPitchPosition(pos, state)
  let end: number
  if (state.grid.snapToGrid) {
    const unit = getGridUnitBeats(state)
    end = Math.max(start + unit, quantizeToGrid(position, state.grid.subdivision) + unit)
  } else {
    end = Math.max(start + MIN_NOTE_DURATION, position)
  }
  note.duration = end - start

  updateOverlapPreview(state)
  state.needsRedraw = true
}

function finishDraw(state: PianoRollState) {
  executeOverlapChanges(state)

  const after = captureState(state)
  if (state.interaction.drawBeforeState && state.interaction.drawBeforeState !== after) {
    state.command.stack?.pushCommand('Draw Note', state.interaction.drawBeforeState, after)
  }

  state.interaction.isDrawing = false
  state.interaction.drawNoteId = undefined
  state.interaction.drawStartPosition = undefined
  state.interaction.drawBeforeState = undefined
  clearOverlapPreview(state)
  invalidateNoteIndex(state)
  state.needsRedraw = true
}
