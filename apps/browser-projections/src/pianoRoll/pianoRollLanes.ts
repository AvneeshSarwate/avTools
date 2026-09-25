import Konva from 'konva'
import {
  EXPRESSION_LANE_FIELD,
  type ExpressionLane,
  type MpeValuePoint,
  type NoteData,
  type PianoRollState
} from './pianoRollState'
import {
  captureState,
  createMpeDragTooltip,
  getMpeSelectedBlocks,
  mutateSelection,
  updateMpeDragTooltip
} from './pianoRollCore'
import {
  getEffectiveLaneHeight,
  getNoteAreaHeight,
  getVisibleLanes,
  LANE_SPLITTER_HEIGHT,
  MIN_LANE_HEIGHT,
  MIN_NOTE_AREA_HEIGHT
} from './pianoRollViewport'

/*
 * Pressure and timbre (CC74) lanes under the note grid, modeled on Ableton's
 * Note Expression lanes. Each note's curve sits directly under the note on the
 * shared time axis. Selected notes get a highlighted column with editable
 * breakpoints; other notes' curves are drawn dimmed and select their note when
 * clicked. Pitch is not a lane: it stays on the notes (renderMpePitchCurve).
 *
 * Point editing mirrors the pitch curve: click a selected note's line to add a
 * point, drag to move (the whole point selection moves together, Shift for
 * fine value steps), double-click or Delete to remove.
 */

const LANE_LABEL = { pressure: 'Pressure', timbre: 'Timbre' } as const
/** Shown (dashed) for a selected note with no points yet: MPE rest values. */
const LANE_DEFAULT_VALUE = { pressure: 0, timbre: 64 } as const
const LANE_PADDING = 4
const HANDLE_RADIUS = 4
const HANDLE_FILL = '#000000'
const HANDLE_FILL_SELECTED = '#ff8c00'
const FINE_DRAG_FACTOR = 0.2
const SELECTED_COLUMN_FILL = 'rgba(46, 238, 238, 0.18)'

type LaneGeometry = {
  lane: ExpressionLane
  top: number
  height: number
}

const plotTop = (geom: LaneGeometry) => geom.top + LANE_PADDING
const plotHeight = (geom: LaneGeometry) => Math.max(1, geom.height - LANE_PADDING * 2)
const valueToY = (geom: LaneGeometry, value: number) =>
  plotTop(geom) + (1 - value / 127) * plotHeight(geom)
const yToValue = (geom: LaneGeometry, y: number) =>
  clamp((1 - (y - plotTop(geom)) / plotHeight(geom)) * 127, 0, 127)

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function getLanePoints(note: NoteData | undefined, lane: ExpressionLane): MpeValuePoint[] {
  return note?.[EXPRESSION_LANE_FIELD[lane]]?.points ?? []
}

function setLanePoints(note: NoteData, lane: ExpressionLane, points: MpeValuePoint[]) {
  note[EXPRESSION_LANE_FIELD[lane]] = { points }
}

function sortPoints(points: MpeValuePoint[]) {
  return [...points].sort((a, b) => a.time - b.time)
}

function setCursor(state: PianoRollState, cursor: string) {
  if (state.konvaContainer) state.konvaContainer.style.cursor = cursor
}

/** The lane point selection, dropped when its note is no longer selected. */
function currentLaneSelection(state: PianoRollState) {
  const selection = state.lanes.selectedHandles
  if (selection && !state.selection.selectedIds.has(selection.noteId)) {
    state.lanes.selectedHandles = null
    return null
  }
  return selection
}

function selectedIndicesFor(state: PianoRollState, lane: ExpressionLane, noteId: string) {
  const selection = currentLaneSelection(state)
  return selection && selection.lane === lane && selection.noteId === noteId
    ? selection.indices
    : new Set<number>()
}

function setLaneSelection(state: PianoRollState, lane: ExpressionLane, noteId: string, indices: Iterable<number>) {
  const next = new Set(indices)
  state.lanes.selectedHandles = next.size > 0 ? { lane, noteId, indices: next } : null
}

function refreshHandleFills(state: PianoRollState) {
  const layer = state.layers.lanes
  if (!layer) return
  layer.find('.lane-handle').forEach((node) => {
    const lane = node.getAttr('laneKind') as ExpressionLane
    const noteId = node.getAttr('laneNoteId') as string
    const index = Number(node.getAttr('laneIndex'))
    const selected = selectedIndicesFor(state, lane, noteId).has(index)
    ;(node as Konva.Circle).fill(selected ? HANDLE_FILL_SELECTED : HANDLE_FILL)
  })
  layer.batchDraw()
}

function selectOnlyNote(state: PianoRollState, noteId: string) {
  mutateSelection(state, () => {
    state.selection.selectedIds.clear()
    state.selection.selectedIds.add(noteId)
  })
  state.lanes.selectedHandles = null
  state.needsRedraw = true
}

// ================= Rendering =================

export function renderLanes(state: PianoRollState) {
  const layer = state.layers.lanes
  const stage = state.stage
  if (!layer || !stage) return
  // Rebuilding would destroy the handle being dragged; dragend redraws.
  if (state.interaction.laneDrag) return

  layer.destroyChildren()
  const lanes = getVisibleLanes(state)
  const totalHeight = stage.height()
  const width = stage.width()
  if (lanes.length === 0) {
    layer.batchDraw()
    return
  }

  const noteAreaHeight = getNoteAreaHeight(state, totalHeight)
  const laneHeight = getEffectiveLaneHeight(state, totalHeight)
  layer.clip({ x: 0, y: noteAreaHeight, width, height: totalHeight - noteAreaHeight })

  const splitter = new Konva.Rect({
    x: 0,
    y: noteAreaHeight,
    width,
    height: LANE_SPLITTER_HEIGHT,
    fill: '#9a9a9a',
    name: 'lane-splitter'
  })
  splitter.on('mouseenter', () => setCursor(state, 'ns-resize'))
  splitter.on('mouseleave', () => {
    if (!state.interaction.laneResize) setCursor(state, '')
  })
  splitter.on('mousedown touchstart', () => startLaneResize(state))
  layer.add(splitter)

  // Unselected notes first so selected curves draw on top.
  const unselected: Array<[string, NoteData]> = []
  const selected: Array<[string, NoteData]> = []
  state.notes.forEach((note, id) => {
    if (!isNoteInTimeView(state, note, width)) return
    ;(state.selection.selectedIds.has(id) ? selected : unselected).push([id, note])
  })

  lanes.forEach((lane, index) => {
    const geom: LaneGeometry = {
      lane,
      top: noteAreaHeight + LANE_SPLITTER_HEIGHT + index * laneHeight,
      height: laneHeight
    }
    drawLaneBackground(state, layer, geom, width)
    unselected.forEach(([id, note]) => drawEnvelope(state, layer, geom, id, note, false))
    selected.forEach(([id, note]) => drawEnvelope(state, layer, geom, id, note, true))
    drawLaneLabel(layer, geom)
  })

  layer.batchDraw()
}

function isNoteInTimeView(state: PianoRollState, note: NoteData, width: number) {
  const { scrollX } = state.viewport
  const qnw = state.grid.quarterNoteWidth
  const start = note.position * qnw - scrollX
  const end = (note.position + note.duration) * qnw - scrollX
  return end >= 0 && start <= width
}

function drawLaneBackground(state: PianoRollState, layer: Konva.Layer, geom: LaneGeometry, width: number) {
  const background = new Konva.Rect({
    x: 0,
    y: geom.top,
    width,
    height: geom.height,
    fill: '#f3f3f3',
    stroke: '#c8c8c8',
    strokeWidth: 1,
    name: 'lane-bg'
  })
  // Clicking empty lane space clears the point selection, not the notes.
  background.on('mousedown touchstart', () => {
    if (state.lanes.selectedHandles) {
      state.lanes.selectedHandles = null
      refreshHandleFills(state)
    }
  })
  layer.add(background)

  // Beat lines keep curves visually aligned with the notes above.
  const { scrollX } = state.viewport
  const qnw = state.grid.quarterNoteWidth
  if (qnw > 4) {
    const first = Math.floor(scrollX / qnw)
    const last = Math.ceil((scrollX + width) / qnw)
    for (let beat = first; beat <= last; beat++) {
      const x = beat * qnw - scrollX
      layer.add(new Konva.Line({
        points: [x, geom.top, x, geom.top + geom.height],
        stroke: beat % state.grid.timeSignature === 0 ? '#bdbdbd' : '#dedede',
        strokeWidth: 1,
        listening: false
      }))
    }
  }
}

function drawLaneLabel(layer: Konva.Layer, geom: LaneGeometry) {
  const text = new Konva.Text({
    x: 4,
    y: geom.top + 3,
    text: LANE_LABEL[geom.lane],
    fontSize: 10,
    fill: '#555',
    listening: false
  })
  const background = new Konva.Rect({
    x: 2,
    y: geom.top + 1,
    width: text.width() + 4,
    height: text.height() + 4,
    fill: 'rgba(243, 243, 243, 0.85)',
    listening: false
  })
  layer.add(background)
  layer.add(text)
}

function buildLinePoints(points: MpeValuePoint[], x0: number, width: number, geom: LaneGeometry): number[] {
  if (points.length === 0) {
    const y = valueToY(geom, LANE_DEFAULT_VALUE[geom.lane])
    return [x0, y, x0 + width, y]
  }
  // Hold the first and last values out to the note's edges, like pitch curves.
  const screen = points.map((point) => ({ x: x0 + point.time * width, y: valueToY(geom, point.value) }))
  const withAnchors = [{ x: x0, y: screen[0].y }, ...screen, { x: x0 + width, y: screen[screen.length - 1].y }]
  return withAnchors.flatMap((point) => [point.x, point.y])
}

function drawEnvelope(
  state: PianoRollState,
  layer: Konva.Layer,
  geom: LaneGeometry,
  noteId: string,
  note: NoteData,
  isSelected: boolean
) {
  const points = getLanePoints(note, geom.lane)
  if (!isSelected && points.length === 0) return

  const { scrollX } = state.viewport
  const qnw = state.grid.quarterNoteWidth
  const x0 = note.position * qnw - scrollX
  const width = note.duration * qnw

  if (isSelected) {
    layer.add(new Konva.Rect({
      x: x0,
      y: geom.top,
      width,
      height: geom.height,
      fill: SELECTED_COLUMN_FILL,
      listening: false
    }))
  }

  const line = new Konva.Line({
    points: buildLinePoints(points, x0, width, geom),
    stroke: isSelected ? '#000000' : '#8a8a8a',
    strokeWidth: isSelected ? 2 : 1.5,
    hitStrokeWidth: 10,
    lineCap: 'round',
    lineJoin: 'round',
    dash: points.length > 0 ? [] : [6, 4],
    name: 'lane-line'
  })
  line.setAttr('laneNoteId', noteId)
  layer.add(line)

  if (!isSelected) {
    line.on('mousedown touchstart', () => selectOnlyNote(state, noteId))
    return
  }

  line.on('mousedown touchstart', () => {
    const pos = state.stage?.getPointerPosition()
    if (!pos || width <= 0) return
    const nextPoint: MpeValuePoint = {
      time: clamp((pos.x - x0) / width, 0, 1),
      value: yToValue(geom, pos.y)
    }
    state.command.stack?.executeCommand(`Add ${LANE_LABEL[geom.lane]} Point`, () => {
      const target = state.notes.get(noteId)
      if (!target) return
      const sorted = sortPoints([...getLanePoints(target, geom.lane), nextPoint])
      setLanePoints(target, geom.lane, sorted)
      setLaneSelection(state, geom.lane, noteId, [sorted.indexOf(nextPoint)])
      state.needsRedraw = true
    })
  })

  const selectedIndices = selectedIndicesFor(state, geom.lane, noteId)
  const handles: Konva.Circle[] = []
  points.forEach((point, index) => {
    const handle = new Konva.Circle({
      x: x0 + point.time * width,
      y: valueToY(geom, point.value),
      radius: HANDLE_RADIUS,
      fill: selectedIndices.has(index) ? HANDLE_FILL_SELECTED : HANDLE_FILL,
      draggable: true,
      name: 'lane-handle'
    })
    handle.setAttr('laneKind', geom.lane)
    handle.setAttr('laneNoteId', noteId)
    handle.setAttr('laneIndex', index)
    handle.dragBoundFunc((pos) => ({
      x: clamp(pos.x, x0, x0 + width),
      y: clamp(pos.y, plotTop(geom), plotTop(geom) + plotHeight(geom))
    }))
    handles.push(handle)
    attachHandleEvents({ state, handle, handles, line, geom, noteId, index, x0, width })
    layer.add(handle)
  })
}

// ================= Point editing =================

type HandleContext = {
  state: PianoRollState
  handle: Konva.Circle
  handles: Konva.Circle[]
  line: Konva.Line
  geom: LaneGeometry
  noteId: string
  index: number
  x0: number
  width: number
}

function attachHandleEvents({ state, handle, handles, line, geom, noteId, index, x0, width }: HandleContext) {
  const { lane } = geom

  handle.on('mousedown touchstart', (event) => {
    const isShift = !!(event.evt as MouseEvent | undefined)?.shiftKey
    const current = new Set(selectedIndicesFor(state, lane, noteId))
    if (isShift) {
      if (current.has(index)) current.delete(index)
      else current.add(index)
      setLaneSelection(state, lane, noteId, current)
    } else if (!current.has(index)) {
      setLaneSelection(state, lane, noteId, [index])
    }
    refreshHandleFills(state)
  })

  handle.on('dragstart', () => {
    const indices = selectedIndicesFor(state, lane, noteId)
    if (!indices.has(index)) setLaneSelection(state, lane, noteId, [index])
    const pointer = state.stage?.getPointerPosition() ?? { x: handle.x(), y: handle.y() }
    const points = getLanePoints(state.notes.get(noteId), lane)
    state.interaction.laneDrag = {
      lane,
      noteId,
      pointIndex: index,
      beforeState: captureState(state),
      selectedIndices: Array.from(selectedIndicesFor(state, lane, noteId)).sort((a, b) => a - b),
      startPointer: { x: pointer.x, y: pointer.y },
      startPoints: points.map((point) => ({ ...point })),
      tooltip: createMpeDragTooltip(state)
    }
    showValueTooltip(state, handle.x(), handle.y(), points[index]?.value ?? 0)
  })

  handle.on('dragmove', (event) => {
    const drag = state.interaction.laneDrag
    const note = state.notes.get(noteId)
    const pointer = state.stage?.getPointerPosition()
    if (!drag || !note || !pointer) return

    // Entering or leaving fine mode rebases the drag on the current values.
    const fine = !!(event.evt as MouseEvent | undefined)?.shiftKey
    if (!!drag.fineMode !== fine) {
      drag.fineMode = fine
      drag.startPointer = { x: pointer.x, y: pointer.y }
      drag.startPoints = getLanePoints(note, lane).map((point) => ({ ...point }))
    }

    const dx = pointer.x - drag.startPointer.x
    const dy = (pointer.y - drag.startPointer.y) * (drag.fineMode ? FINE_DRAG_FACTOR : 1)
    let deltaTime = width > 0 ? dx / width : 0
    let deltaValue = -(dy / plotHeight(geom)) * 127

    // A moved block cannot cross its unselected neighbours or leave the note.
    const start = drag.startPoints
    let minTime = -Infinity
    let maxTime = Infinity
    getMpeSelectedBlocks(drag.selectedIndices).forEach(({ start: first, end: last }) => {
      const firstTime = start[first]?.time ?? 0
      const lastTime = start[last]?.time ?? 0
      const prev = first > 0 ? start[first - 1]?.time ?? 0 : 0
      const next = last < start.length - 1 ? start[last + 1]?.time ?? 1 : 1
      minTime = Math.max(minTime, prev - firstTime)
      maxTime = Math.min(maxTime, next - lastTime)
    })
    deltaTime = clamp(deltaTime, minTime, maxTime)
    let minValue = -Infinity
    let maxValue = Infinity
    drag.selectedIndices.forEach((idx) => {
      const value = start[idx]?.value ?? 0
      minValue = Math.max(minValue, -value)
      maxValue = Math.min(maxValue, 127 - value)
    })
    deltaValue = clamp(deltaValue, minValue, maxValue)

    const updated = start.map((point, idx) =>
      drag.selectedIndices.includes(idx)
        ? { ...point, time: point.time + deltaTime, value: point.value + deltaValue }
        : point
    )
    setLanePoints(note, lane, updated)
    line.points(buildLinePoints(updated, x0, width, geom))
    drag.selectedIndices.forEach((idx) => {
      const point = updated[idx]
      handles[idx]?.position({ x: x0 + point.time * width, y: valueToY(geom, point.value) })
    })
    const primary = updated[index]
    if (primary) {
      showValueTooltip(state, x0 + primary.time * width, valueToY(geom, primary.value), primary.value)
    }
  })

  handle.on('dragend', () => {
    const drag = state.interaction.laneDrag
    const note = state.notes.get(noteId)
    if (note) {
      // Keep the moved points selected across the re-sort.
      const points = getLanePoints(note, lane)
      const moved = new Set((drag?.selectedIndices ?? []).map((idx) => points[idx]))
      const sorted = sortPoints(points)
      setLanePoints(note, lane, sorted)
      setLaneSelection(state, lane, noteId, sorted.flatMap((point, idx) => (moved.has(point) ? [idx] : [])))
    }
    const after = captureState(state)
    if (drag && drag.beforeState !== after) {
      state.command.stack?.pushCommand(`Edit ${LANE_LABEL[lane]} Curve`, drag.beforeState, after)
    }
    drag?.tooltip?.group.destroy()
    state.layers.overlay?.batchDraw()
    state.interaction.laneDrag = undefined
    state.needsRedraw = true
  })

  handle.on('dblclick dbltap', () => {
    state.command.stack?.executeCommand(`Delete ${LANE_LABEL[lane]} Point`, () => {
      const target = state.notes.get(noteId)
      if (!target) return
      const points = [...getLanePoints(target, lane)]
      if (index < 0 || index >= points.length) return
      points.splice(index, 1)
      setLanePoints(target, lane, points)
      state.lanes.selectedHandles = null
      state.needsRedraw = true
    })
  })
}

function showValueTooltip(state: PianoRollState, x: number, y: number, value: number) {
  const tooltip = state.interaction.laneDrag?.tooltip
  updateMpeDragTooltip(tooltip, x, y, 0, String(Math.round(value)))
}

/** Delete-key handler: removes the selected lane points. False when none are selected. */
export function deleteSelectedLanePoints(state: PianoRollState): boolean {
  const selection = currentLaneSelection(state)
  if (!selection || selection.indices.size === 0) return false
  const { lane, noteId, indices } = selection
  state.command.stack?.executeCommand(`Delete ${LANE_LABEL[lane]} Points`, () => {
    const target = state.notes.get(noteId)
    if (!target) return
    setLanePoints(target, lane, getLanePoints(target, lane).filter((_, idx) => !indices.has(idx)))
    state.lanes.selectedHandles = null
    state.needsRedraw = true
  })
  return true
}

// ================= Splitter =================

function startLaneResize(state: PianoRollState) {
  const stage = state.stage
  const pointer = stage?.getPointerPosition()
  if (!stage || !pointer) return
  state.interaction.laneResize = {
    startY: pointer.y,
    startLaneHeight: getEffectiveLaneHeight(state, stage.height())
  }

  // Window listeners keep the drag alive when the pointer leaves the canvas.
  const onMove = (event: MouseEvent | TouchEvent) => {
    const resize = state.interaction.laneResize
    if (!resize || !state.stage) return
    state.stage.setPointersPositions(event)
    const current = state.stage.getPointerPosition()
    if (!current) return
    const count = getVisibleLanes(state).length || 1
    const maxPerLane = (state.stage.height() - MIN_NOTE_AREA_HEIGHT - LANE_SPLITTER_HEIGHT) / count
    const next = resize.startLaneHeight - (current.y - resize.startY) / count
    state.lanes.laneHeight = clamp(next, Math.min(MIN_LANE_HEIGHT, maxPerLane), maxPerLane)
    state.needsRedraw = true
  }
  const onUp = () => {
    state.interaction.laneResize = undefined
    setCursor(state, '')
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('touchmove', onMove)
    window.removeEventListener('mouseup', onUp)
    window.removeEventListener('touchend', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('touchmove', onMove)
  window.addEventListener('mouseup', onUp)
  window.addEventListener('touchend', onUp)
}
