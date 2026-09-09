<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue'
import Konva from 'konva'
import type { TrackRuntime, EditorAction, NumberElement } from '../types'
import {
  NUMBER_LANE_HEIGHT,
  EDIT_LANE_BG_COLOR,
  NUMBER_LINE_COLOR,
  NUMBER_POINT_COLOR,
  EDIT_NUMBER_POINT_RADIUS,
  EDIT_NUMBER_LINE_WIDTH,
  EDIT_NUMBER_LINE_WIDTH_FRONT,
  EDIT_NUMBER_LINE_SNAP_DISTANCE,
  EDIT_NUMBER_BOUNDS_LINE_COLOR,
  SELECTION_COLOR,
  SELECTION_STROKE_WIDTH,
  FRONT_TRACK_OPACITY,
  REFERENCE_TRACK_OPACITY
} from '../constants'
import { createLaneDrag, bindLaneBackgroundClick } from '../laneDrag'
import { timeToX, xToTime, clamp } from '../utils'

const props = defineProps<{
  tracks: TrackRuntime[]
  frontTrackId: string | undefined
  windowStart: number
  windowEnd: number
  selectedElementId: string | undefined
  selectedTrackId: string | undefined
  renderVersion: number
  duration: number
}>()

const emit = defineEmits<{
  action: [action: EditorAction]
  geometry: []
}>()

const containerRef = ref<HTMLDivElement | null>(null)
let stage: Konva.Stage | null = null
let layer: Konva.Layer | null = null
let resizeObserver: ResizeObserver | null = null
let cancelBackgroundClick = () => {}

// Map of element ID to Konva node (for front track only)
const elementNodes = new Map<string, Konva.Circle>()

// Reference to the front track line for live updates during drag
let frontTrackLine: Konva.Line | null = null

const trackLines = new Map<string, Konva.Line>()
let boundsLines: Konva.Line[] = []
const drag = createLaneDrag({
  tracks: () => props.tracks,
  frontTrackId: () => props.frontTrackId,
  duration: () => props.duration,
  onCancel: () => emit('action', { type: 'DRAG/CANCEL' })
})

function cancelDrag() {
  cancelBackgroundClick()
  drag.cancel()
  syncScene()
}

const width = ref(0)
const height = NUMBER_LANE_HEIGHT

const frontTrack = computed(() => {
  if (!props.frontTrackId) return undefined
  return props.tracks.find((t) => t.id === props.frontTrackId)
})

function timeToXLocal(t: number): number {
  return timeToX(t, props.windowStart, props.windowEnd, width.value)
}

function xToTimeLocal(x: number): number {
  return xToTime(x, props.windowStart, props.windowEnd, width.value)
}

function valueToY(value: number, low: number, high: number): number {
  const padding = 20
  const drawHeight = height - padding * 2
  const normalized = (value - low) / (high - low)
  return padding + drawHeight * (1 - normalized)
}

function yToValue(y: number, low: number, high: number): number {
  const padding = 20
  const drawHeight = height - padding * 2
  const normalized = 1 - (y - padding) / drawHeight
  return low + normalized * (high - low)
}

function syncScene() {
  if (!layer || !stage) return
  if (drag.active && !drag.valid()) drag.cancel()
  const ids = new Set(props.tracks.map((t) => t.id))
  for (const [id, line] of trackLines) {
    if (!ids.has(id)) {
      line.destroy()
      trackLines.delete(id)
    }
  }
  const ordered = [...props.tracks].sort(
    (a, b) => Number(a.id === props.frontTrackId) - Number(b.id === props.frontTrackId)
  )
  for (const track of ordered) drawTrackLine(track, track.id === props.frontTrackId)
  frontTrackLine = props.frontTrackId ? (trackLines.get(props.frontTrackId) ?? null) : null

  if (boundsLines.length === 0) {
    boundsLines = [20, height - 20].map((y) => {
      const line = new Konva.Line({
        points: [0, y, width.value, y],
        stroke: EDIT_NUMBER_BOUNDS_LINE_COLOR,
        strokeWidth: 1,
        dash: [4, 4],
        listening: false
      })
      layer!.add(line)
      return line
    })
  }
  boundsLines.forEach((line, i) => {
    const y = i === 0 ? 20 : height - 20
    line.points([0, y, width.value, y])
    line.visible(!!frontTrack.value?.elementData.length)
    line.moveToTop()
  })

  const visibleIds = new Set(
    frontTrack.value?.elementData
      .filter(
        (e) =>
          (e.time >= props.windowStart && e.time <= props.windowEnd) ||
          e.id === drag.active?.elementId
      )
      .map((e) => e.id)
  )
  for (const [id, node] of elementNodes) {
    if (!visibleIds.has(id) || node.getAttr('trackId') !== props.frontTrackId) {
      node.destroy()
      elementNodes.delete(id)
    }
  }
  if (frontTrack.value) drawFrontTrackPoints(frontTrack.value)
  if (drag.active && frontTrack.value) {
    const node = drag.active.node
    updateLinePreview(
      frontTrack.value,
      frontTrack.value.elementData.findIndex((e) => e.id === drag.active!.elementId),
      node.x(),
      node.y()
    )
  }
  layer.batchDraw()
  emit('geometry')
}

function drawTrackLine(track: TrackRuntime, isFront: boolean) {
  const elements = track.elementData as NumberElement[]
  if (elements.length === 0) {
    trackLines.get(track.id)?.destroy()
    trackLines.delete(track.id)
    return
  }

  const points: number[] = []

  // Start from left edge (evaluate at windowStart)
  const startValue = evaluateAtTime(track, props.windowStart)
  points.push(0, valueToY(startValue, track.low, track.high))

  // Add visible points
  for (const elem of elements) {
    if (elem.time < props.windowStart) continue
    if (elem.time > props.windowEnd) break
    points.push(timeToXLocal(elem.time), valueToY(elem.value, track.low, track.high))
  }

  // End at right edge
  const endValue = evaluateAtTime(track, props.windowEnd)
  points.push(width.value, valueToY(endValue, track.low, track.high))

  let line = trackLines.get(track.id)
  if (!line) {
    line = new Konva.Line({ listening: false, lineCap: 'round', lineJoin: 'round' })
    layer!.add(line)
    trackLines.set(track.id, line)
  }
  line.setAttrs({
    points,
    stroke: NUMBER_LINE_COLOR,
    strokeWidth: isFront ? EDIT_NUMBER_LINE_WIDTH_FRONT : EDIT_NUMBER_LINE_WIDTH,
    opacity: isFront ? FRONT_TRACK_OPACITY : REFERENCE_TRACK_OPACITY
  })
  line.moveToTop()
}

function drawFrontTrackPoints(track: TrackRuntime) {
  for (const elem of track.elementData as NumberElement[]) {
    const active =
      drag.active?.elementId === elem.id && drag.active.trackId === track.id ? drag.active : null
    if (!active && (elem.time < props.windowStart || elem.time > props.windowEnd)) continue
    let circle = elementNodes.get(elem.id)
    if (!circle) {
      circle = new Konva.Circle({
        radius: EDIT_NUMBER_POINT_RADIUS,
        fill: NUMBER_POINT_COLOR,
        hitStrokeWidth: 4,
        draggable: true
      })
      circle.setAttr('trackId', track.id)
      circle.setAttr('elementId', elem.id)
      bindPointEvents(circle, track.id, elem.id)
      layer!.add(circle)
      elementNodes.set(elem.id, circle)
    }
    const selected = elem.id === props.selectedElementId && track.id === props.selectedTrackId
    circle.setAttrs({
      x: timeToXLocal(active?.time ?? elem.time),
      y: valueToY(active?.value ?? elem.value, track.low, track.high),
      stroke: selected ? SELECTION_COLOR : undefined,
      strokeWidth: selected ? SELECTION_STROKE_WIDTH : 0
    })
    circle.moveToTop()
  }
}

function bindPointEvents(circle: Konva.Circle, trackId: string, elementId: string) {
  circle.on('mousedown touchstart', () => drag.prepare(circle))
  circle.on('click tap', (e) => {
    e.cancelBubble = true
    if (e.evt.shiftKey) emit('action', { type: 'NUMBER/DELETE', trackId, elementId })
    else
      emit('action', { type: 'ELEMENT/TOGGLE_SELECTION', fieldType: 'number', trackId, elementId })
  })
  circle.on('dragstart', () => {
    const track = frontTrack.value
    const elem = track?.elementData.find((e) => e.id === elementId)
    if (!track || !elem) {
      circle.stopDrag()
      return
    }
    drag.begin(circle, track, elem)
    emit('action', { type: 'ELEMENT/SELECT', fieldType: 'number', trackId, elementId })
    emit('action', { type: 'NUMBER/DRAG_START', trackId, elementId })
  })
  circle.on('dragmove', () => {
    if (!drag.valid()) {
      cancelDrag()
      return
    }
    const pos = drag.position()
    const active = drag.active
    const track = frontTrack.value
    if (!pos || !active || !track) return
    const elems = track.elementData
    const index = elems.findIndex((e) => e.id === elementId)
    const lowTime = Math.max(0, props.windowStart, elems[index - 1]?.time ?? 0)
    const highTime = Math.min(
      props.duration,
      props.windowEnd,
      elems[index + 1]?.time ?? props.duration
    )
    active.time = clamp(xToTimeLocal(pos.x), lowTime, highTime)
    active.value = clamp(yToValue(pos.y, track.low, track.high), track.low, track.high)
    circle.position({
      x: timeToXLocal(active.time),
      y: valueToY(active.value, track.low, track.high)
    })
    updateLinePreview(track, index, circle.x(), circle.y())
    emit('action', {
      type: 'NUMBER/DRAG_PREVIEW',
      trackId,
      elementId,
      time: active.time,
      value: active.value
    })
    emit('geometry')
  })
  circle.on('dragend', (event) => {
    const finished = drag.finish(event)
    if (finished) {
      emit('action', {
        type: 'NUMBER/DRAG_END',
        trackId,
        elementId,
        time: finished.time,
        value: finished.value!
      })
    }
    syncScene()
  })
}

function updateLinePreview(track: TrackRuntime, dragIndex: number, newX: number, newY: number) {
  if (!frontTrackLine || !layer) return

  // Get all circle positions from the layer to build updated line points
  const elements = track.elementData as NumberElement[]
  const points: number[] = []

  // Start from left edge
  const startValue = evaluateAtTimeWithOverride(track, props.windowStart, dragIndex, newX, newY)
  points.push(0, valueToY(startValue, track.low, track.high))

  // Add points, using the dragged position for the drag index
  for (let i = 0; i < elements.length; i++) {
    const elem = elements[i]

    // Use the dragged position for the element being dragged
    if (i === dragIndex) {
      // Only add if within view window
      const dragTime = xToTimeLocal(newX)
      if (dragTime >= props.windowStart && dragTime <= props.windowEnd) {
        points.push(newX, newY)
      }
    } else {
      if (elem.time < props.windowStart) continue
      if (elem.time > props.windowEnd) break
      points.push(timeToXLocal(elem.time), valueToY(elem.value, track.low, track.high))
    }
  }

  // End at right edge
  const endValue = evaluateAtTimeWithOverride(track, props.windowEnd, dragIndex, newX, newY)
  points.push(width.value, valueToY(endValue, track.low, track.high))

  // Update line points
  frontTrackLine.points(points)
  layer.batchDraw()
}

function evaluateAtTime(track: TrackRuntime, t: number): number {
  const elements = track.elementData as NumberElement[]
  if (elements.length === 0) return track.low

  // Find surrounding elements
  let i1 = -1
  let i2 = 0
  for (let i = 0; i < elements.length; i++) {
    if (elements[i].time <= t) {
      i1 = i
    } else {
      i2 = i
      break
    }
    i2 = i + 1
  }

  if (i1 < 0) return elements[0].value
  if (i2 >= elements.length) return elements[i1].value

  const t1 = elements[i1].time
  const t2 = elements[i2].time
  const v1 = elements[i1].value
  const v2 = elements[i2].value
  const alpha = (t - t1) / (t2 - t1)
  return v1 + (v2 - v1) * alpha
}

function evaluateAtTimeWithOverride(
  track: TrackRuntime,
  t: number,
  overrideIndex: number,
  overrideX: number,
  overrideY: number
): number {
  const elements = track.elementData as NumberElement[]
  if (elements.length === 0) return track.low

  // Create virtual element list with override
  const overrideTime = xToTimeLocal(overrideX)
  const overrideValue = yToValue(overrideY, track.low, track.high)

  // Build sorted list of (time, value) pairs with override
  const pairs: { time: number; value: number }[] = []
  for (let i = 0; i < elements.length; i++) {
    if (i === overrideIndex) {
      pairs.push({ time: overrideTime, value: overrideValue })
    } else {
      pairs.push({ time: elements[i].time, value: elements[i].value })
    }
  }
  pairs.sort((a, b) => a.time - b.time)

  // Find surrounding elements
  let i1 = -1
  let i2 = 0
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i].time <= t) {
      i1 = i
    } else {
      i2 = i
      break
    }
    i2 = i + 1
  }

  if (i1 < 0) return pairs[0].value
  if (i2 >= pairs.length) return pairs[i1].value

  const t1 = pairs[i1].time
  const t2 = pairs[i2].time
  const v1 = pairs[i1].value
  const v2 = pairs[i2].value
  const alpha = (t - t1) / (t2 - t1)
  return v1 + (v2 - v1) * alpha
}

function handleStageClick() {
  if (!frontTrack.value) return

  const pos = stage!.getPointerPosition()
  if (!pos) return

  const t = clamp(
    xToTimeLocal(pos.x),
    Math.max(0, props.windowStart),
    Math.min(props.duration, props.windowEnd)
  )
  let v = clamp(
    yToValue(pos.y, frontTrack.value.low, frontTrack.value.high),
    frontTrack.value.low,
    frontTrack.value.high
  )

  // Insert on the existing curve near it, preserving both click time and curve shape.
  const track = frontTrack.value
  if (track.elementData.length) {
    const curveValue = evaluateAtTime(track, t)
    const curveY = valueToY(curveValue, track.low, track.high)
    if (Math.abs(pos.y - curveY) <= EDIT_NUMBER_LINE_SNAP_DISTANCE)
      v = clamp(curveValue, track.low, track.high)
  }

  emit('action', {
    type: 'NUMBER/ADD',
    trackId: frontTrack.value.id,
    time: t,
    value: v
  })
}

function getSelectedElementPosition(): { x: number; y: number } | null {
  if (!props.selectedElementId || !props.selectedTrackId) return null
  if (props.selectedTrackId !== props.frontTrackId) return null
  const node = elementNodes.get(props.selectedElementId)
  if (!node) return null
  return { x: node.x(), y: node.y() }
}

onMounted(() => {
  if (!containerRef.value) return

  stage = new Konva.Stage({
    container: containerRef.value,
    width: containerRef.value.clientWidth,
    height: height
  })

  layer = new Konva.Layer()
  stage.add(layer)

  cancelBackgroundClick = bindLaneBackgroundClick(stage, handleStageClick)
  window.addEventListener('blur', cancelDrag)
  window.addEventListener('pointercancel', cancelDrag)
  window.addEventListener('touchcancel', cancelDrag)

  resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      width.value = entry.contentRect.width
      if (stage) {
        stage.width(width.value)
        syncScene()
      }
    }
  })
  resizeObserver.observe(containerRef.value)

  width.value = containerRef.value.clientWidth
  syncScene()
})

onUnmounted(() => {
  window.removeEventListener('blur', cancelDrag)
  window.removeEventListener('pointercancel', cancelDrag)
  window.removeEventListener('touchcancel', cancelDrag)
  drag.cancel()
  resizeObserver?.disconnect()
  stage?.destroy()
})

// Watch for changes that require rebuild
watch(
  () => [
    props.renderVersion,
    props.windowStart,
    props.windowEnd,
    props.frontTrackId,
    props.tracks.length,
    props.duration
  ],
  () => syncScene(),
  { flush: 'post' }
)

// Selection only changes attributes; point identity survives every update.
watch(() => [props.selectedElementId, props.selectedTrackId], syncScene, { flush: 'post' })

defineExpose({
  getSelectedElementPosition
})
</script>

<template>
  <div
    class="number-lane"
    data-component="NumberLane"
    data-lane-type="number"
    :data-front-track-id="frontTrackId"
  >
    <div ref="containerRef" class="lane-canvas" data-region="lane-canvas"></div>
  </div>
</template>

<style scoped>
.number-lane {
  height: v-bind('NUMBER_LANE_HEIGHT + "px"');
  background: v-bind('EDIT_LANE_BG_COLOR');
  border-bottom: 1px solid var(--ae-border);
  box-sizing: border-box;
  overflow: hidden;
  display: flex;
  width: 100%;
  min-width: 0;
}

.lane-canvas {
  flex: 1;
  position: relative;
  width: 100%;
  min-width: 0;
}
</style>
