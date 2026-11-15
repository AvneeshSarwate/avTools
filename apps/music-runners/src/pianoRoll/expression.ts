// Note expression, after Ableton Live's MIDI Note Editor (Notes tab) and Note
// Expression editor (MPE tab):
//
// Notes mode: a Velocity lane under the grid. Each note has a marker, a circle
// at its start at the height of its velocity with a line to its end. Drag a
// marker (the selection moves together), Alt/Cmd-drag a selected note in the
// grid, or paint with draw mode.
//
// MPE mode: notes do not move. The selected notes get a translucent column
// through the grid and the lanes; their pitch envelope is edited on the note
// and their pressure and timbre (CC74) envelopes in lanes. Click a line to add
// a breakpoint, drag to move (selected points move together), click a point
// to delete it, drag in a note's column for a time-range selection, Delete to
// remove the selection, R to toggle rooted on selected pitch points. Shift is
// fine adjustment; Cmd/Ctrl snaps pitch to semitones.
//
// Immediate mode like the rest of the core: everything is drawn from state on
// each redraw and hit-tested geometrically. Point times are 0..1 across the
// note, values are semitones (pitch) or 0..127 (lanes), the shapes
// `mpePitch` / `mpePressure` / `mpeTimbre` use.
import type Konva from 'konva'
import { alternatePitchLabel } from './utils'
import { captureState, mutateSelection } from './core'
import {
  areaAt,
  laneGeometries,
  type LaneGeometry,
  laneValuePerPixel,
  laneValueToY,
  laneYToValue,
  noteAreaHeight
} from './lanes'
import type { EnvelopeArea, ExpressionHover, ExpressionLane, ExpressionMenuTarget, NoteData, PianoRollState, PointSelection } from './state'

interface Point {
  time: number
  value: number
  rooted?: boolean
}

const REST: Record<EnvelopeArea, number> = { pitch: 0, pressure: 0, timbre: 64 }
const MAX_PITCH_OFFSET = 24
const LANE_LABEL: Record<ExpressionLane, string> = { velocity: 'Velocity', pressure: 'Pressure', timbre: 'Timbre' }

const POINT_RADIUS = 4
const POINT_HIT = 7
/** Within this of the line, a ghost point locked to it follows the pointer; a click adds it. */
const LINE_HIT = 4
/** Beyond the line but within this, the segment under the pointer drags its end points together. */
const SEGMENT_HIT = 12
const MARKER_RADIUS = 3.5
const DRAG_SLOP = 2
const FINE = 0.2

const SELECT = '#64b5ff'
const LINE = '#e6e6e6'
const HALO = 'rgba(0, 0, 0, 0.75)'
const DIM_LINE = '#5c5c5c'
const MARKER = '#9a9a9a'
const MARKER_HOVER = '#f2f2f2'
const LANE_FILL = '#1d1d1d'
const LANE_BORDER = '#0b0b0b'
const LANE_LABEL_COLOR = '#6b6b6b'
const LANE_BEAT_LINE = '#2a2a2a'
const LANE_BAR_LINE = '#3a3a3a'
const COLUMN_FILL = 'rgba(100, 181, 255, 0.10)'
const RANGE_FILL = 'rgba(255, 255, 255, 0.13)'
const TOOLTIP_FILL = '#e6e6e6'
const TOOLTIP_TEXT = '#111111'
const TOOLTIP_FONT = 'normal normal 11px Arial'
const TWO_PI = Math.PI * 2

// ================= data access =================

export function readPoints(note: NoteData, area: EnvelopeArea): Point[] {
  if (area === 'pitch') return (note.mpePitch?.points ?? []).map((p) => ({ time: p.time, value: p.pitchOffset, ...(p.rooted ? { rooted: true } : {}) }))
  const curve = area === 'pressure' ? note.mpePressure : note.mpeTimbre
  return (curve?.points ?? []).map((p) => ({ time: p.time, value: p.value }))
}

function withPoints(note: NoteData, area: EnvelopeArea, points: Point[]): NoteData {
  const next: NoteData = { ...note }
  if (area === 'pitch') {
    if (points.length) next.mpePitch = { points: points.map((p) => ({ time: p.time, pitchOffset: p.value, ...(p.rooted ? { rooted: true } : {}) })) }
    else delete next.mpePitch
  } else {
    const key = area === 'pressure' ? 'mpePressure' : 'mpeTimbre'
    if (points.length) next[key] = { points: points.map((p) => ({ time: p.time, value: p.value })) }
    else delete next[key]
  }
  return next
}

function valueAt(points: Point[], time: number, rest: number): number {
  if (points.length === 0) return rest
  if (time <= points[0]!.time) return points[0]!.value
  for (let i = 1; i < points.length; i++) {
    const b = points[i]!
    if (time > b.time) continue
    const a = points[i - 1]!
    const span = b.time - a.time
    return span > 0 ? a.value + ((time - a.time) / span) * (b.value - a.value) : b.value
  }
  return points[points.length - 1]!.value
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

/** Pitch is fractional semitones; pressure and timbre are whole MIDI values. */
function clampValue(area: EnvelopeArea, value: number) {
  return area === 'pitch' ? clamp(value, -MAX_PITCH_OFFSET, MAX_PITCH_OFFSET) : Math.round(clamp(value, 0, 127))
}

// ================= geometry =================

interface NoteColumn {
  x0: number
  width: number
}

function column(state: PianoRollState, note: NoteData): NoteColumn {
  const { quarterNoteWidth } = state.grid
  return { x0: note.position * quarterNoteWidth - state.viewport.scrollX, width: Math.max(1, note.duration * quarterNoteWidth) }
}

function rowCenterY(state: PianoRollState, note: NoteData) {
  return (127 - note.pitch) * state.grid.noteHeight - state.viewport.scrollY + state.grid.noteHeight / 2
}

function geometryFor(state: PianoRollState, area: EnvelopeArea): LaneGeometry | null {
  return area === 'pitch' ? null : (laneGeometries(state).find((g) => g.lane === area) ?? null)
}

/** Stage y of a value in an area for a note. */
function valueY(state: PianoRollState, area: EnvelopeArea, note: NoteData, value: number, geometry: LaneGeometry | null): number {
  if (area === 'pitch') return rowCenterY(state, note) - value * state.grid.noteHeight
  return laneValueToY(geometry!, value)
}

/** Notes whose envelopes are editable in MPE mode: the selection. */
function editableNotes(state: PianoRollState): Array<[string, NoteData]> {
  const out: Array<[string, NoteData]> = []
  for (const id of state.selection.selectedIds) {
    const note = state.notes.get(id)
    if (note) out.push([id, note])
  }
  return out
}

function isPointSelected(state: PianoRollState, area: EnvelopeArea, noteId: string, index: number) {
  const selection = state.expression.pointSelection
  return !!selection && selection.area === area && !!selection.points.get(noteId)?.has(index)
}

/** Notes overlapping the visible time range (lanes show every pitch). */
function timeVisibleNotes(state: PianoRollState, width: number): Array<[string, NoteData]> {
  const { scrollX } = state.viewport
  const { quarterNoteWidth } = state.grid
  const start = scrollX / quarterNoteWidth
  const end = (scrollX + width) / quarterNoteWidth
  const out: Array<[string, NoteData]> = []
  for (const entry of state.notes) {
    const note = entry[1]
    if (note.position <= end && note.position + note.duration >= start) out.push(entry)
  }
  return out
}

// ================= drawing =================

/** Drawn after the notes, in the notes layer: MPE columns and envelopes, then the lanes. */
export function drawExpression(state: PianoRollState, ctx: CanvasRenderingContext2D) {
  const stage = state.stage
  if (!stage) return
  const width = stage.width()
  const gridHeight = noteAreaHeight(state)
  const { mode } = state.expression
  ctx.save()
  ctx.globalAlpha = 1
  ctx.setLineDash([])

  if (mode === 'mpe') {
    const editable = editableNotes(state)
    // Columns over the selected notes, through the grid and the lanes
    ctx.fillStyle = COLUMN_FILL
    for (const [, note] of editable) {
      const { x0, width: w } = column(state, note)
      ctx.fillRect(x0, 0, w, stage.height())
    }
    // Pitch envelopes, clipped to the grid
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, width, gridHeight)
    ctx.clip()
    drawRange(state, ctx, 'pitch', 0, gridHeight)
    for (const [id, note] of editable) drawEnvelope(state, ctx, 'pitch', id, note, null, width)
    drawHover(state, ctx, 'pitch', null)
    ctx.restore()
  }

  for (const geometry of laneGeometries(state)) drawLane(state, ctx, geometry, width)
  drawTooltip(state, ctx, width, stage.height())
  ctx.restore()
}

/** Hover feedback on an envelope: a ring on a point, a ghost point on the line, a highlighted segment. */
function drawHover(state: PianoRollState, ctx: CanvasRenderingContext2D, area: EnvelopeArea, geometry: LaneGeometry | null) {
  const hover = state.expression.hover
  if (!hover || hover.area !== area) return
  const note = state.notes.get(hover.noteId)
  if (!note) return
  const { x0, width: w } = column(state, note)
  const at = (time: number, value: number) => [x0 + time * w, valueY(state, area, note, value, geometry)] as const
  if (hover.kind === 'point') {
    const p = readPoints(note, area)[hover.index]
    if (!p) return
    const [x, y] = at(p.time, p.value)
    ctx.beginPath()
    ctx.arc(x, y, POINT_RADIUS + 3, 0, TWO_PI)
    ctx.strokeStyle = LINE
    ctx.lineWidth = 1.5
    ctx.stroke()
  } else if (hover.kind === 'line') {
    const [x, y] = at(hover.time, hover.value)
    ctx.beginPath()
    ctx.arc(x, y, POINT_RADIUS, 0, TWO_PI)
    ctx.fillStyle = HALO
    ctx.fill()
    ctx.strokeStyle = SELECT
    ctx.lineWidth = 1.5
    ctx.stroke()
  } else {
    const [ax, ay] = at(hover.from.time, hover.from.value)
    const [bx, by] = at(hover.to.time, hover.to.value)
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.lineTo(bx, by)
    ctx.strokeStyle = SELECT
    ctx.lineWidth = 3
    ctx.stroke()
  }
}

/** The value under the pointer or being dragged, as a small label (Ableton's "+2.73 st"). */
function drawTooltip(state: PianoRollState, ctx: CanvasRenderingContext2D, stageWidth: number, stageHeight: number) {
  const tip = tooltipTarget(state)
  if (!tip) return
  ctx.font = TOOLTIP_FONT
  const width = ctx.measureText(tip.text).width + 10
  const height = 17
  const x = clamp(tip.x + 10, 2, stageWidth - width - 2)
  const y = clamp(tip.y - height - 8, 2, stageHeight - height - 2)
  ctx.globalAlpha = 1
  ctx.fillStyle = TOOLTIP_FILL
  ctx.fillRect(x, y, width, height)
  ctx.strokeStyle = HALO
  ctx.lineWidth = 1
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1)
  ctx.fillStyle = TOOLTIP_TEXT
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText(tip.text, x + 5, y + height / 2 + 0.5)
}

function tooltipTarget(state: PianoRollState): { x: number; y: number; text: string } | null {
  const drag = state.expression.drag
  const pointTip = (area: EnvelopeArea, noteId: string, index: number) => {
    const note = state.notes.get(noteId)
    const p = note ? readPoints(note, area)[index] : undefined
    if (!note || !p) return null
    const { x0, width: w } = column(state, note)
    return { x: x0 + p.time * w, y: valueY(state, area, note, p.value, geometryFor(state, area)), text: formatExpressionValue(area, p.value) }
  }
  const velocityTip = (noteId: string) => {
    const note = state.notes.get(noteId)
    const geometry = laneGeometries(state).find((g) => g.lane === 'velocity')
    if (!note || !geometry) return null
    return { x: column(state, note).x0, y: laneValueToY(geometry, note.velocity), text: formatExpressionValue('velocity', note.velocity) }
  }
  if (drag?.kind === 'points') return drag.primary ? pointTip(drag.area, drag.primary.noteId, drag.primary.index) : null
  if (drag?.kind === 'velocity') return drag.primary ? velocityTip(drag.primary) : null
  if (drag) return null
  const hover = state.expression.hover
  if (hover?.kind === 'point') return pointTip(hover.area, hover.noteId, hover.index)
  if (hover?.kind === 'line') {
    const note = state.notes.get(hover.noteId)
    if (!note) return null
    const { x0, width: w } = column(state, note)
    return { x: x0 + hover.time * w, y: valueY(state, hover.area, note, hover.value, geometryFor(state, hover.area)), text: formatExpressionValue(hover.area, hover.value) }
  }
  if (state.expression.mode === 'notes' && state.expression.hoverNoteId) return velocityTip(state.expression.hoverNoteId)
  // A note in the grid: its pitch in the other form (MIDI number or name),
  // anchored to the note so it follows a drag
  const gridNote = state.expression.hoverGridNoteId ? state.notes.get(state.expression.hoverGridNoteId) : undefined
  if (gridNote) {
    const x = column(state, gridNote).x0
    const y = (127 - gridNote.pitch) * state.grid.noteHeight - state.viewport.scrollY
    return { x: x - 10, y: y + 6, text: alternatePitchLabel(gridNote.pitch, state.grid.pitchLabels) }
  }
  return null
}

/** The note under the pointer in the grid (core.ts sets it on hover). */
export function setGridNoteHover(state: PianoRollState, noteId: string | null) {
  if (state.expression.hoverGridNoteId === noteId) return
  state.expression.hoverGridNoteId = noteId
  state.dirty.notes = true
}

function drawLane(state: PianoRollState, ctx: CanvasRenderingContext2D, geometry: LaneGeometry, width: number) {
  const { top, height, lane } = geometry
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, top, width, height)
  ctx.clip()
  ctx.fillStyle = LANE_FILL
  ctx.fillRect(0, top, width, height)

  // Beat and bar lines, on the grid's time axis
  const { quarterNoteWidth, timeSignature } = state.grid
  const { scrollX } = state.viewport
  ctx.lineWidth = 1
  const firstBeat = Math.floor(scrollX / quarterNoteWidth)
  const lastBeat = Math.ceil((scrollX + width) / quarterNoteWidth)
  for (let beat = firstBeat; beat <= lastBeat; beat++) {
    const x = Math.round(beat * quarterNoteWidth - scrollX) + 0.5
    ctx.strokeStyle = beat % timeSignature === 0 ? LANE_BAR_LINE : LANE_BEAT_LINE
    ctx.beginPath()
    ctx.moveTo(x, top)
    ctx.lineTo(x, top + height)
    ctx.stroke()
  }
  // Selected-note columns continue through the lane (MPE mode)
  if (state.expression.mode === 'mpe') {
    ctx.fillStyle = COLUMN_FILL
    for (const [, note] of editableNotes(state)) {
      const { x0, width: w } = column(state, note)
      ctx.fillRect(x0, top, w, height)
    }
  }

  ctx.font = 'normal normal 10px Arial'
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillStyle = LANE_LABEL_COLOR
  ctx.fillText(LANE_LABEL[lane], 6, top + 4)

  if (lane === 'velocity') {
    drawVelocityMarkers(state, ctx, geometry, width)
  } else {
    drawRange(state, ctx, lane, top, height)
    // Unselected notes' envelopes dimmed, selected ones editable
    const selected = state.selection.selectedIds
    for (const [id, note] of timeVisibleNotes(state, width)) {
      if (selected.has(id)) continue
      drawDimEnvelope(state, ctx, lane, note, geometry)
    }
    for (const [id, note] of editableNotes(state)) drawEnvelope(state, ctx, lane, id, note, geometry, width)
    drawHover(state, ctx, lane, geometry)
  }

  ctx.restore()
  ctx.fillStyle = LANE_BORDER
  ctx.fillRect(0, top, width, 1)
}

function drawVelocityMarkers(state: PianoRollState, ctx: CanvasRenderingContext2D, geometry: LaneGeometry, width: number) {
  const selected = state.selection.selectedIds
  const hover = state.expression.hoverNoteId
  const entries = timeVisibleNotes(state, width)
  // Unselected first, selected and hovered on top
  const rank = (id: string) => (id === hover ? 2 : selected.has(id) ? 1 : 0)
  entries.sort((a, b) => rank(a[0]) - rank(b[0]))
  ctx.lineWidth = 1.5
  for (const [id, note] of entries) {
    const { x0, width: w } = column(state, note)
    const y = laneValueToY(geometry, clamp(note.velocity, 1, 127))
    const color = id === hover ? MARKER_HOVER : selected.has(id) ? SELECT : MARKER
    ctx.strokeStyle = color
    ctx.beginPath()
    ctx.moveTo(x0 + MARKER_RADIUS, y)
    ctx.lineTo(x0 + w, y)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(x0, y, MARKER_RADIUS, 0, TWO_PI)
    ctx.fillStyle = LANE_FILL
    ctx.fill()
    ctx.stroke()
  }
}

function drawDimEnvelope(state: PianoRollState, ctx: CanvasRenderingContext2D, area: EnvelopeArea, note: NoteData, geometry: LaneGeometry | null) {
  const points = readPoints(note, area)
  if (points.length === 0) return
  const { x0, width: w } = column(state, note)
  ctx.strokeStyle = DIM_LINE
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x0, valueY(state, area, note, points[0]!.value, geometry))
  for (const p of points) ctx.lineTo(x0 + p.time * w, valueY(state, area, note, p.value, geometry))
  ctx.lineTo(x0 + w, valueY(state, area, note, points[points.length - 1]!.value, geometry))
  ctx.stroke()
}

function drawEnvelope(
  state: PianoRollState,
  ctx: CanvasRenderingContext2D,
  area: EnvelopeArea,
  noteId: string,
  note: NoteData,
  geometry: LaneGeometry | null,
  stageWidth: number
) {
  const points = readPoints(note, area)
  const { x0, width: w } = column(state, note)
  const y = (value: number) => valueY(state, area, note, value, geometry)

  if (points.length === 0) {
    // No envelope yet: a dashed line at the rest value, across the view for
    // pitch (Ableton) and across the note for a lane.
    const restY = y(REST[area])
    ctx.strokeStyle = LINE
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(area === 'pitch' ? 0 : x0, restY)
    ctx.lineTo(area === 'pitch' ? stageWidth : x0 + w, restY)
    ctx.stroke()
    ctx.setLineDash([])
    return
  }

  const trace = () => {
    ctx.beginPath()
    ctx.moveTo(x0, y(points[0]!.value))
    for (const p of points) ctx.lineTo(x0 + p.time * w, y(p.value))
    ctx.lineTo(x0 + w, y(points[points.length - 1]!.value))
  }
  trace()
  ctx.strokeStyle = HALO
  ctx.lineWidth = 3.5
  ctx.stroke()
  trace()
  ctx.strokeStyle = LINE
  ctx.lineWidth = 1.5
  ctx.stroke()

  points.forEach((p, index) => {
    const px = x0 + p.time * w
    const py = y(p.value)
    const selected = isPointSelected(state, area, noteId, index)
    if (selected) {
      ctx.beginPath()
      ctx.arc(px, py, POINT_RADIUS + 3, 0, TWO_PI)
      ctx.fillStyle = SELECT
      ctx.fill()
    }
    ctx.beginPath()
    ctx.arc(px, py, POINT_RADIUS, 0, TWO_PI)
    // Filled: rooted pitch points and every lane point; hollow: unrooted pitch points
    ctx.fillStyle = area !== 'pitch' || p.rooted ? LINE : HALO
    ctx.fill()
    ctx.lineWidth = 1.5
    ctx.strokeStyle = area !== 'pitch' || p.rooted ? HALO : LINE
    ctx.stroke()
  })
}

function drawRange(state: PianoRollState, ctx: CanvasRenderingContext2D, area: EnvelopeArea, top: number, height: number) {
  const range = state.expression.range
  if (!range || range.area !== area) return
  ctx.fillStyle = RANGE_FILL
  ctx.fillRect(Math.min(range.x0, range.x1), top, Math.abs(range.x1 - range.x0), height)
}

// ================= hit testing =================

type PointHit = { noteId: string; index: number }

function hitPoint(state: PianoRollState, area: EnvelopeArea, pos: { x: number; y: number }): PointHit | null {
  const geometry = geometryFor(state, area)
  let best: PointHit | null = null
  let bestDist = POINT_HIT * POINT_HIT
  for (const [id, note] of editableNotes(state)) {
    const { x0, width: w } = column(state, note)
    readPoints(note, area).forEach((p, index) => {
      const dx = pos.x - (x0 + p.time * w)
      const dy = pos.y - valueY(state, area, note, p.value, geometry)
      const dist = dx * dx + dy * dy
      if (dist <= bestDist) {
        bestDist = dist
        best = { noteId: id, index }
      }
    })
  }
  return best
}

/** The closest spot on a selected note's envelope to the pointer. */
interface Nearest {
  noteId: string
  dist: number
  /** The spot itself, locked to the line: where a click adds a point. */
  time: number
  value: number
  /** The breakpoints bounding the segment it lies on (one for the flat runs before the first / after the last). */
  indices: number[]
  from: { time: number; value: number }
  to: { time: number; value: number }
}

function nearestOnEnvelope(state: PianoRollState, area: EnvelopeArea, pos: { x: number; y: number }): Nearest | null {
  const geometry = geometryFor(state, area)
  let best: Nearest | null = null
  for (const [id, note] of editableNotes(state)) {
    const points = readPoints(note, area)
    const { x0, width: w } = column(state, note)
    // The drawn envelope: flat from the note start to the first point, through
    // the points, flat from the last point to the note end.
    const nodes =
      points.length === 0
        ? [{ time: 0, value: REST[area], index: -1 }, { time: 1, value: REST[area], index: -1 }]
        : [
            { time: 0, value: points[0]!.value, index: -1 },
            ...points.map((p, index) => ({ time: p.time, value: p.value, index })),
            { time: 1, value: points[points.length - 1]!.value, index: -1 }
          ]
    for (let k = 0; k < nodes.length - 1; k++) {
      const a = nodes[k]!
      const b = nodes[k + 1]!
      const ax = x0 + a.time * w
      const ay = valueY(state, area, note, a.value, geometry)
      const dx = x0 + b.time * w - ax
      const dy = valueY(state, area, note, b.value, geometry) - ay
      const length2 = dx * dx + dy * dy
      const u = length2 > 0 ? clamp(((pos.x - ax) * dx + (pos.y - ay) * dy) / length2, 0, 1) : 0
      const dist = Math.hypot(pos.x - (ax + u * dx), pos.y - (ay + u * dy))
      if (best && dist >= best.dist) continue
      best = {
        noteId: id,
        dist,
        time: clamp(a.time + u * (b.time - a.time), 0, 1),
        value: a.value + u * (b.value - a.value),
        indices: [a.index, b.index].filter((index) => index >= 0),
        from: { time: a.time, value: a.value },
        to: { time: b.time, value: b.value }
      }
    }
  }
  return best
}

/** The MPE hover zone under the pointer: point, then line, then segment. */
function hoverAt(state: PianoRollState, area: EnvelopeArea, pos: { x: number; y: number }): ExpressionHover | null {
  const point = hitPoint(state, area, pos)
  if (point) return { kind: 'point', area, noteId: point.noteId, index: point.index }
  const near = nearestOnEnvelope(state, area, pos)
  if (!near) return null
  if (near.dist <= LINE_HIT) return { kind: 'line', area, noteId: near.noteId, time: near.time, value: near.value }
  if (near.dist <= SEGMENT_HIT && near.indices.length > 0) {
    return { kind: 'segment', area, noteId: near.noteId, indices: near.indices, from: near.from, to: near.to }
  }
  return null
}

function inEditableColumn(state: PianoRollState, x: number): boolean {
  return editableNotes(state).some(([, note]) => {
    const { x0, width } = column(state, note)
    return x >= x0 && x <= x0 + width
  })
}

function hitVelocityMarker(state: PianoRollState, geometry: LaneGeometry, pos: { x: number; y: number }): string | null {
  const selected = state.selection.selectedIds
  let best: string | null = null
  let bestScore = Infinity
  for (const [id, note] of timeVisibleNotes(state, state.stage?.width() ?? 0)) {
    const { x0, width: w } = column(state, note)
    const y = laneValueToY(geometry, clamp(note.velocity, 1, 127))
    const dy = Math.abs(pos.y - y)
    const dxCircle = pos.x - x0
    const onCircle = dxCircle * dxCircle + dy * dy <= (MARKER_RADIUS + 4) ** 2
    const onLine = dy <= 4 && pos.x >= x0 && pos.x <= x0 + w
    if (!onCircle && !onLine) continue
    // Prefer the circle, then selected markers, then the nearest line
    const score = (onCircle ? 0 : 100) + (selected.has(id) ? 0 : 10) + dy
    if (score < bestScore) {
      bestScore = score
      best = id
    }
  }
  return best
}

// ================= gestures =================

type HitNote = (pos: { x: number; y: number }) => string | null

function selectNotes(state: PianoRollState, noteId: string, shift: boolean) {
  mutateSelection(state, () => {
    const ids = state.selection.selectedIds
    if (shift) {
      if (ids.has(noteId)) ids.delete(noteId)
      else ids.add(noteId)
    } else if (!ids.has(noteId)) {
      ids.clear()
      ids.add(noteId)
    }
  })
}

/** A new point selection; the shaded range stays only for a range selection. */
function setPointSelection(state: PianoRollState, selection: PointSelection | null, keepRange = false) {
  state.expression.pointSelection = selection
  if (!keepRange) state.expression.range = null
  state.dirty.notes = true
}

function startVelocityDrag(state: PianoRollState, y: number, perPixel: number, primary: string | null) {
  const base = new Map<string, number>()
  for (const id of state.selection.selectedIds) {
    const note = state.notes.get(id)
    if (note) base.set(id, note.velocity)
  }
  state.expression.drag = { kind: 'velocity', startY: y, before: captureState(state), base, perPixel, moved: false, primary }
}

/** Alt/Cmd-drag on a selected note in Notes mode changes the selection's velocity (Ableton). */
export function startVelocityDragFromNote(state: PianoRollState, stage: Konva.Stage, noteId: string) {
  const pos = stage.getPointerPosition()
  if (!pos) return
  startVelocityDrag(state, pos.y, 1, noteId)
}

/**
 * Pointer down. Returns true when the expression layer took the gesture (the
 * core's note editing then does nothing). In MPE mode it takes every press.
 */
export function expressionPointerDown(state: PianoRollState, stage: Konva.Stage, evt: MouseEvent | undefined, hitNote: HitNote): boolean {
  const pos = stage.getPointerPosition()
  if (!pos) return false
  const area = areaAt(state, pos.y)
  const shift = !!evt?.shiftKey
  const { mode } = state.expression

  if (mode === 'notes') {
    if (area !== 'velocity') return false
    const geometry = laneGeometries(state).find((g) => g.lane === 'velocity')!
    const markerId = hitVelocityMarker(state, geometry, pos)
    if (markerId) {
      selectNotes(state, markerId, shift)
      if (state.selection.selectedIds.has(markerId)) startVelocityDrag(state, pos.y, laneValuePerPixel(geometry), markerId)
      state.dirty.notes = true
      return true
    }
    if (state.grid.drawMode) {
      state.expression.drag = { kind: 'velocityDraw', before: captureState(state), lane: 'velocity' }
      paintVelocity(state, pos, geometry)
      return true
    }
    if (!shift) mutateSelection(state, () => state.selection.selectedIds.clear())
    state.dirty.notes = true
    return true
  }

  // MPE mode
  if (!area || area === 'velocity') return true
  const envelopeArea = area as EnvelopeArea
  const point = hitPoint(state, envelopeArea, pos)
  state.expression.activeArea = envelopeArea
  if (point) {
    const already = isPointSelected(state, envelopeArea, point.noteId, point.index)
    if (shift) {
      const selection = state.expression.pointSelection?.area === envelopeArea ? state.expression.pointSelection : { area: envelopeArea, points: new Map() }
      const set = selection.points.get(point.noteId) ?? new Set<number>()
      if (set.has(point.index)) set.delete(point.index)
      else set.add(point.index)
      selection.points.set(point.noteId, set)
      setPointSelection(state, selection)
      if (!set.has(point.index)) return true
    } else if (!already) {
      setPointSelection(state, { area: envelopeArea, points: new Map([[point.noteId, new Set([point.index])]]) })
    }
    startPointsDrag(state, envelopeArea, pos, shift ? null : point, point)
    return true
  }

  const near = nearestOnEnvelope(state, envelopeArea, pos)
  if (near && near.dist <= LINE_HIT) {
    // Add a point where the ghost point sits (locked to the line), and drag it
    const note = state.notes.get(near.noteId)!
    const points = readPoints(note, envelopeArea)
    const before = captureState(state)
    let index = points.findIndex((p) => p.time > near.time)
    if (index < 0) index = points.length
    points.splice(index, 0, { time: near.time, value: clampValue(envelopeArea, near.value) })
    state.notes.set(near.noteId, withPoints(note, envelopeArea, points))
    setPointSelection(state, { area: envelopeArea, points: new Map([[near.noteId, new Set([index])]]) })
    startPointsDrag(state, envelopeArea, pos, null, { noteId: near.noteId, index }, before)
    return true
  }
  if (near && near.dist <= SEGMENT_HIT && near.indices.length > 0) {
    // Grab the segment: its end points move together by the same delta
    const selection: PointSelection =
      shift && state.expression.pointSelection?.area === envelopeArea
        ? clonePointSelection(state.expression.pointSelection)
        : { area: envelopeArea, points: new Map() }
    const set = selection.points.get(near.noteId) ?? new Set<number>()
    for (const index of near.indices) set.add(index)
    selection.points.set(near.noteId, set)
    setPointSelection(state, selection)
    startPointsDrag(state, envelopeArea, pos, null, { noteId: near.noteId, index: near.indices[0]! })
    return true
  }

  if (inEditableColumn(state, pos.x)) {
    const initial = shift && state.expression.pointSelection?.area === envelopeArea ? clonePointSelection(state.expression.pointSelection) : null
    state.expression.drag = { kind: 'range', area: envelopeArea, startX: pos.x, currentX: pos.x, shift, initial }
    if (!shift) setPointSelection(state, null)
    return true
  }

  // Not on an envelope: Cmd-A goes back to selecting notes
  state.expression.activeArea = null
  if (envelopeArea === 'pitch') {
    // Selecting notes works in the grid; notes do not move in MPE mode.
    const noteId = hitNote(pos)
    if (noteId) selectNotes(state, noteId, shift)
    else if (!shift) mutateSelection(state, () => state.selection.selectedIds.clear())
  }
  setPointSelection(state, null)
  return true
}

function clonePointSelection(selection: PointSelection): PointSelection {
  return { area: selection.area, points: new Map([...selection.points].map(([id, set]) => [id, new Set(set)])) }
}

function startPointsDrag(
  state: PianoRollState,
  area: EnvelopeArea,
  pos: { x: number; y: number },
  clicked: PointHit | null,
  primary: PointHit | null,
  before?: string
) {
  state.expression.hover = null
  const base = new Map<string, Array<{ time: number; value: number }>>()
  for (const [id] of state.expression.pointSelection?.points ?? []) {
    const note = state.notes.get(id)
    if (note) base.set(id, readPoints(note, area).map((p) => ({ time: p.time, value: p.value })))
  }
  state.expression.drag = {
    kind: 'points',
    area,
    startX: pos.x,
    startY: pos.y,
    before: before ?? captureState(state),
    base,
    moved: false,
    clickDeletes: clicked,
    primary
  }
}

function paintVelocity(state: PianoRollState, pos: { x: number; y: number }, geometry: LaneGeometry) {
  const value = Math.round(laneYToValue(geometry, pos.y))
  const onlySelected = state.selection.selectedIds.size > 0
  for (const [id, note] of timeVisibleNotes(state, state.stage?.width() ?? 0)) {
    if (onlySelected && !state.selection.selectedIds.has(id)) continue
    const { x0, width } = column(state, note)
    if (pos.x < x0 - MARKER_RADIUS || pos.x > x0 + Math.max(width, MARKER_RADIUS * 2)) continue
    if (note.velocity !== value) state.notes.set(id, { ...note, velocity: value })
  }
  state.dirty.notes = true
}

/** Pointer move during an expression gesture; false when none is running. */
export function expressionPointerMove(state: PianoRollState, stage: Konva.Stage, evt: MouseEvent | undefined): boolean {
  const drag = state.expression.drag
  const pos = stage.getPointerPosition()
  if (!drag || !pos) return false
  const fine = evt?.shiftKey ? FINE : 1

  if (drag.kind === 'velocity') {
    const dy = drag.startY - pos.y
    if (Math.abs(dy) > DRAG_SLOP) drag.moved = true
    if (!drag.moved) return true
    for (const [id, base] of drag.base) {
      const note = state.notes.get(id)
      if (!note) continue
      const velocity = clamp(Math.round(base + dy * drag.perPixel * fine), 1, 127)
      if (velocity !== note.velocity) state.notes.set(id, { ...note, velocity })
    }
    state.dirty.notes = true
    return true
  }

  if (drag.kind === 'velocityDraw') {
    const geometry = laneGeometries(state).find((g) => g.lane === 'velocity')
    if (geometry) paintVelocity(state, pos, geometry)
    return true
  }

  if (drag.kind === 'range') {
    drag.currentX = pos.x
    state.expression.range = { area: drag.area, x0: drag.startX, x1: pos.x }
    const lo = Math.min(drag.startX, pos.x)
    const hi = Math.max(drag.startX, pos.x)
    const selection: PointSelection = drag.initial ? clonePointSelection(drag.initial) : { area: drag.area, points: new Map() }
    for (const [id, note] of editableNotes(state)) {
      const { x0, width: w } = column(state, note)
      readPoints(note, drag.area).forEach((p, index) => {
        const x = x0 + p.time * w
        if (x < lo || x > hi) return
        const set = selection.points.get(id) ?? new Set<number>()
        set.add(index)
        selection.points.set(id, set)
      })
    }
    setPointSelection(state, selection, true)
    return true
  }

  // Moving points
  const dx = pos.x - drag.startX
  const dy = pos.y - drag.startY
  if (!drag.moved && Math.abs(dx) <= DRAG_SLOP && Math.abs(dy) <= DRAG_SLOP) return true
  drag.moved = true
  // The shaded range marks where the points were; it goes once they move.
  state.expression.range = null
  const geometry = geometryFor(state, drag.area)
  const snap = drag.area === 'pitch' && !!(evt?.metaKey || evt?.ctrlKey)
  const selection = state.expression.pointSelection
  for (const [id, base] of drag.base) {
    const note = state.notes.get(id)
    const selected = selection?.points.get(id)
    if (!note || !selected) continue
    const { width: w } = column(state, note)
    const dt = (dx * fine) / w
    const dv = drag.area === 'pitch' ? (-dy * fine) / state.grid.noteHeight : -dy * fine * laneValuePerPixel(geometry!)
    const points = readPoints(note, drag.area)
    if (points.length !== base.length) continue
    base.forEach((origin, index) => {
      if (!selected.has(index)) return
      // Stay between the nearest unselected neighbours (selected ones move together)
      let lo = 0
      let hi = 1
      for (let i = index - 1; i >= 0; i--) if (!selected.has(i)) { lo = base[i]!.time; break }
      for (let i = index + 1; i < base.length; i++) if (!selected.has(i)) { hi = base[i]!.time; break }
      let value = clampValue(drag.area, origin.value + dv)
      if (snap) value = Math.round(value)
      points[index] = { ...points[index]!, time: clamp(origin.time + dt, lo, hi), value }
    })
    state.notes.set(id, withPoints(note, drag.area, points))
  }
  state.dirty.notes = true
  return true
}

/** Pointer up: commit the gesture as one undo step. False when none was running. */
export function expressionPointerUp(state: PianoRollState): boolean {
  const drag = state.expression.drag
  if (!drag) return false
  state.expression.drag = null

  if (drag.kind === 'range') {
    // The range stays shaded with its selection (Ableton); a click clears both.
    if (Math.abs(drag.currentX - drag.startX) <= DRAG_SLOP && !drag.shift) setPointSelection(state, null)
    state.dirty.notes = true
    return true
  }

  if (drag.kind === 'points' && !drag.moved && drag.clickDeletes) {
    // Click on a breakpoint deletes it (Ableton)
    const { noteId, index } = drag.clickDeletes
    const note = state.notes.get(noteId)
    if (note) {
      const points = readPoints(note, drag.area)
      points.splice(index, 1)
      state.notes.set(noteId, withPoints(note, drag.area, points))
    }
    setPointSelection(state, null)
  }

  const after = captureState(state)
  if (after !== drag.before) {
    const label = drag.kind === 'points' ? 'Edit Expression' : 'Change Velocity'
    state.command.stack?.pushCommand(label, drag.before, after)
  }
  state.dirty.notes = true
  return true
}

export function cancelExpressionGesture(state: PianoRollState): boolean {
  if (!state.expression.drag) return false
  return expressionPointerUp(state)
}

/** Hover feedback (velocity marker highlight, keyboard label). */
export function expressionHover(state: PianoRollState, pos: { x: number; y: number } | null) {
  let hoverNote: string | null = null
  let hoverPitch: number | null = null
  if (pos) {
    const area = areaAt(state, pos.y)
    if (area === 'pitch') hoverPitch = 127 - Math.floor((pos.y + state.viewport.scrollY) / state.grid.noteHeight)
    if (area === 'velocity' && state.expression.mode === 'notes') {
      const geometry = laneGeometries(state).find((g) => g.lane === 'velocity')
      if (geometry) hoverNote = hitVelocityMarker(state, geometry, pos)
    }
  }
  if (hoverNote !== state.expression.hoverNoteId) {
    state.expression.hoverNoteId = hoverNote
    state.dirty.notes = true
  }
  let hover: ExpressionHover | null = null
  if (pos && state.expression.mode === 'mpe' && !state.expression.drag) {
    const area = areaAt(state, pos.y)
    if (area && area !== 'velocity') hover = hoverAt(state, area, pos)
  }
  if (JSON.stringify(hover) !== JSON.stringify(state.expression.hover)) {
    state.expression.hover = hover
    state.dirty.notes = true
    setCursor(state, hover ? HOVER_CURSOR[hover.kind] : hoverNote ? 'ns-resize' : '')
  } else if (!hover) {
    setCursor(state, hoverNote ? 'ns-resize' : '')
  }
  if (hoverPitch !== state.keyboard.hoverPitch) {
    state.keyboard.hoverPitch = hoverPitch
    state.dirty.gutter = true
  }
}

const HOVER_CURSOR: Record<ExpressionHover['kind'], string> = { point: 'move', line: 'copy', segment: 'grab' }

/** Cursor on the stage's content element, so the container keeps its own (draw mode). */
function setCursor(state: PianoRollState, cursor: string) {
  const content = state.stage?.container().querySelector<HTMLElement>('.konvajs-content')
  if (content && content.style.cursor !== cursor) content.style.cursor = cursor
}

// ================= right-click: Edit Value and friends =================

/** Right-click on a breakpoint (MPE) or a velocity marker (Notes): ask the host for a menu. */
export function expressionContextMenu(state: PianoRollState, stage: Konva.Stage, evt: MouseEvent): boolean {
  const pos = stage.getPointerPosition()
  if (!pos) return false
  const area = areaAt(state, pos.y)
  let target: ExpressionMenuTarget | null = null
  if (state.expression.mode === 'mpe' && area && area !== 'velocity') {
    const point = hitPoint(state, area, pos)
    const note = point ? state.notes.get(point.noteId) : undefined
    const p = note && point ? readPoints(note, area)[point.index] : undefined
    if (point && p) target = { kind: 'point', area, noteId: point.noteId, index: point.index, value: p.value, rooted: !!p.rooted }
  } else if (state.expression.mode === 'notes' && area === 'velocity') {
    const geometry = laneGeometries(state).find((g) => g.lane === 'velocity')
    const noteId = geometry ? hitVelocityMarker(state, geometry, pos) : null
    const note = noteId ? state.notes.get(noteId) : undefined
    if (noteId && note) target = { kind: 'velocity', noteId, value: note.velocity }
  }
  if (!target) return false
  state.hooks.onExpressionMenu?.({ x: evt.clientX, y: evt.clientY, target })
  return true
}

/** Set one breakpoint's value exactly (one undo step). */
export function setPointValue(state: PianoRollState, area: EnvelopeArea, noteId: string, index: number, value: number) {
  const note = state.notes.get(noteId)
  if (!note) return
  const points = readPoints(note, area)
  if (!points[index]) return
  points[index] = { ...points[index]!, value: clampValue(area, value) }
  state.command.stack?.executeCommand('Set Value', () => {
    state.notes.set(noteId, withPoints(note, area, points))
  })
  state.dirty.notes = true
}

export function deletePoint(state: PianoRollState, area: EnvelopeArea, noteId: string, index: number) {
  const note = state.notes.get(noteId)
  if (!note) return
  const points = readPoints(note, area)
  points.splice(index, 1)
  state.command.stack?.executeCommand('Delete Point', () => {
    state.notes.set(noteId, withPoints(note, area, points))
  })
  setPointSelection(state, null)
}

export function togglePointRooted(state: PianoRollState, noteId: string, index: number) {
  const note = state.notes.get(noteId)
  if (!note) return
  const points = readPoints(note, 'pitch')
  const p = points[index]
  if (!p) return
  const { rooted, ...rest } = p
  points[index] = rooted ? rest : { ...rest, rooted: true }
  state.command.stack?.executeCommand(rooted ? 'Unroot Point' : 'Root Point', () => {
    state.notes.set(noteId, withPoints(note, 'pitch', points))
  })
  state.dirty.notes = true
}

export function setNoteVelocity(state: PianoRollState, noteId: string, velocity: number) {
  const note = state.notes.get(noteId)
  if (!note) return
  const value = clamp(Math.round(velocity), 1, 127)
  state.command.stack?.executeCommand('Set Velocity', () => {
    state.notes.set(noteId, { ...note, velocity: value })
  })
  state.dirty.notes = true
}

/** Value text as Ableton shows it: "+2.73 st" for pitch, whole numbers otherwise. */
export function formatExpressionValue(area: EnvelopeArea | 'velocity', value: number): string {
  if (area === 'pitch') return `${value >= 0 ? '+' : ''}${value.toFixed(2)} st`
  return String(Math.round(value))
}

/** Parse an edited value: "2.5", "+2.5 st", "-1"; null when not a number. */
export function parseExpressionValue(text: string): number | null {
  const value = Number(text.trim().replace(/\s*st$/i, ''))
  return text.trim() !== '' && Number.isFinite(value) ? value : null
}

// ================= keyboard commands (MPE mode) =================

/** Delete the selected breakpoints; false when there are none. */
export function deleteSelectedPoints(state: PianoRollState): boolean {
  const selection = state.expression.pointSelection
  if (!selection || selection.points.size === 0) return false
  state.command.stack?.executeCommand('Delete Points', () => {
    for (const [id, indices] of selection.points) {
      const note = state.notes.get(id)
      if (!note) continue
      const points = readPoints(note, selection.area).filter((_, index) => !indices.has(index))
      state.notes.set(id, withPoints(note, selection.area, points))
    }
  })
  setPointSelection(state, null)
  return true
}

/** Toggle rooted on the selected pitch points (all on unless all already are). */
export function toggleRootedSelected(state: PianoRollState): boolean {
  const selection = state.expression.pointSelection
  if (!selection || selection.area !== 'pitch' || selection.points.size === 0) return false
  let allRooted = true
  for (const [id, indices] of selection.points) {
    const note = state.notes.get(id)
    if (!note) continue
    readPoints(note, 'pitch').forEach((p, index) => {
      if (indices.has(index) && !p.rooted) allRooted = false
    })
  }
  state.command.stack?.executeCommand(allRooted ? 'Unroot Points' : 'Root Points', () => {
    for (const [id, indices] of selection.points) {
      const note = state.notes.get(id)
      if (!note) continue
      const points = readPoints(note, 'pitch').map((p, index) => {
        if (!indices.has(index)) return p
        const { rooted: _r, ...rest } = p
        return allRooted ? rest : { ...rest, rooted: true }
      })
      state.notes.set(id, withPoints(note, 'pitch', points))
    }
  })
  state.dirty.notes = true
  return true
}

export function clearPointSelection(state: PianoRollState): boolean {
  state.expression.activeArea = null
  if (!state.expression.pointSelection) return false
  setPointSelection(state, null)
  return true
}

/**
 * Cmd/Ctrl-A in an editable roll. MPE mode, with notes selected and an
 * envelope last worked on: every breakpoint of the selected notes in that
 * envelope. Otherwise: every note (in MPE mode that makes all envelopes
 * editable).
 */
export function selectAllInContext(state: PianoRollState) {
  const area = state.expression.activeArea
  if (state.expression.mode === 'mpe' && area && state.selection.selectedIds.size > 0) {
    const points = new Map<string, Set<number>>()
    for (const [id, note] of editableNotes(state)) {
      const count = readPoints(note, area).length
      if (count > 0) points.set(id, new Set(Array.from({ length: count }, (_, index) => index)))
    }
    setPointSelection(state, { area, points })
    return
  }
  mutateSelection(state, () => {
    state.selection.selectedIds = new Set(state.notes.keys())
  })
  setPointSelection(state, null)
}
