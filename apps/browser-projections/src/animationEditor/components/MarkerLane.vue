<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue'
import Konva from 'konva'
import type { TrackRuntime, EditorAction, FuncElement } from '../types'
import {
  ENUM_LANE_HEIGHT,
  FUNC_LANE_HEIGHT,
  EDIT_LANE_BG_COLOR,
  EDIT_MARKER_WIDTH,
  EDIT_MARKER_BAR_WIDTH,
  SELECTION_COLOR,
  SELECTION_STROKE_WIDTH,
  FRONT_TRACK_OPACITY,
  EDIT_REFERENCE_MARKER_OPACITY
} from '../constants'
import { timeToX, xToTime, clamp, hashStringToColor } from '../utils'
import { createLaneDrag, bindLaneBackgroundClick } from '../laneDrag'

const props = defineProps<{
  fieldType: 'enum' | 'func'
  tracks: TrackRuntime[]
  frontTrackId: string | undefined
  windowStart: number
  windowEnd: number
  selectedElementId: string | undefined
  selectedTrackId: string | undefined
  renderVersion: number
  duration: number
}>()
const emit = defineEmits<{ action: [action: EditorAction]; geometry: [] }>()
const containerRef = ref<HTMLDivElement | null>(null)
let stage: Konva.Stage | null = null
let layer: Konva.Layer | null = null
let resizeObserver: ResizeObserver | null = null
let cancelBackgroundClick = () => {}
const width = ref(0)
const height = props.fieldType === 'enum' ? ENUM_LANE_HEIGHT : FUNC_LANE_HEIGHT
const frontTrack = computed(() => props.tracks.find((t) => t.id === props.frontTrackId))
const nodes = new Map<
  string,
  { group: Konva.Group; bar: Konva.Rect; line: Konva.Line; text: Konva.Text }
>()
const keyFor = (trackId: string, elementId: string) => JSON.stringify([trackId, elementId])
const drag = createLaneDrag({
  tracks: () => props.tracks,
  frontTrackId: () => props.frontTrackId,
  duration: () => props.duration,
  onCancel: () => emit('action', { type: 'DRAG/CANCEL' })
})
const timeX = (time: number) => timeToX(time, props.windowStart, props.windowEnd, width.value)
const pointerTime = (x: number) =>
  clamp(
    xToTime(x, props.windowStart, props.windowEnd, width.value),
    Math.max(0, props.windowStart),
    Math.min(props.duration, props.windowEnd)
  )

function bindEvents(group: Konva.Group, trackId: string, elementId: string) {
  group.on('mousedown touchstart', () => {
    // A visible marker owns the gesture even when its track is behind another.
    // Promote on press, retaining this group and the original pointer offset.
    drag.prepare(group)
    if (props.frontTrackId !== trackId)
      emit('action', { type: 'TRACK/SET_FRONT', fieldType: props.fieldType, trackId })
  })
  group.on('click tap', (e) => {
    e.cancelBubble = true
    if (e.evt.shiftKey)
      emit('action', {
        type: props.fieldType === 'enum' ? 'ENUM/DELETE' : 'FUNC/DELETE',
        trackId,
        elementId
      })
    else
      emit('action', {
        type: 'ELEMENT/TOGGLE_SELECTION',
        fieldType: props.fieldType,
        trackId,
        elementId
      })
  })
  group.on('dragstart', () => {
    const track = props.tracks.find((t) => t.id === trackId)
    const element = track?.elementData.find((e) => e.id === elementId)
    if (!track || !element) {
      group.stopDrag()
      return
    }
    drag.begin(group, track, element)
    emit('action', { type: 'ELEMENT/SELECT', fieldType: props.fieldType, trackId, elementId })
  })
  group.on('dragmove', () => {
    if (!drag.valid()) {
      cancelDrag()
      return
    }
    const pos = drag.position()
    const active = drag.active
    if (!pos || !active) return
    active.time = pointerTime(pos.x)
    group.position({ x: timeX(active.time), y: 0 })
    emit('action', {
      type: props.fieldType === 'enum' ? 'ENUM/DRAG_PREVIEW' : 'FUNC/DRAG_PREVIEW',
      trackId,
      elementId,
      time: active.time
    })
    emit('geometry')
  })
  group.on('dragend', (event) => {
    const finished = drag.finish(event)
    if (finished)
      emit('action', {
        type: props.fieldType === 'enum' ? 'ENUM/DRAG_END' : 'FUNC/DRAG_END',
        trackId,
        elementId,
        time: finished.time
      })
    syncScene()
  })
}

function syncScene() {
  if (!layer || !stage) return
  if (drag.active && !drag.valid()) drag.cancel()
  const seen = new Set<string>()
  // Draw reference markers behind the foreground, but retain their hit targets.
  const tracks = [...props.tracks].sort(
    (a, b) => Number(a.id === props.frontTrackId) - Number(b.id === props.frontTrackId)
  )
  for (const track of tracks) {
    const isFront = track.id === props.frontTrackId
    for (const element of track.elementData) {
      const active =
        drag.active?.trackId === track.id && drag.active.elementId === element.id
          ? drag.active
          : null
      if (!active && (element.time < props.windowStart || element.time > props.windowEnd)) continue
      const key = keyFor(track.id, element.id)
      seen.add(key)
      let marker = nodes.get(key)
      if (!marker) {
        const group = new Konva.Group()
        const bar = new Konva.Rect({
          x: -EDIT_MARKER_BAR_WIDTH / 2,
          y: height * 0.15,
          width: EDIT_MARKER_BAR_WIDTH,
          height: height * 0.7
        })
        const line = new Konva.Line({
          points: [0, 0, 0, height],
          stroke: 'rgba(255,255,255,0.5)',
          strokeWidth: EDIT_MARKER_WIDTH,
          hitStrokeWidth: EDIT_MARKER_BAR_WIDTH
        })
        const text = new Konva.Text({
          x: 0,
          y: height / 2,
          fontSize: 10,
          fill: '#fff',
          rotation: -90
        })
        group.add(bar, line, text)
        bindEvents(group, track.id, element.id)
        layer.add(group)
        marker = { group, bar, line, text }
        nodes.set(key, marker)
      }
      const label =
        props.fieldType === 'enum'
          ? (element.value as string)
          : (element.value as FuncElement).funcName || 'func'
      const selected =
        isFront && props.selectedTrackId === track.id && props.selectedElementId === element.id
      marker.group.setAttrs({
        x: timeX(active?.time ?? element.time),
        y: 0,
        opacity: isFront ? FRONT_TRACK_OPACITY : EDIT_REFERENCE_MARKER_OPACITY,
        draggable: true,
        listening: true
      })
      marker.bar.setAttrs({
        fill: hashStringToColor(label),
        stroke: selected ? SELECTION_COLOR : undefined,
        strokeWidth: selected ? SELECTION_STROKE_WIDTH : 0
      })
      marker.line.opacity(0.7)
      marker.text.text(label)
      marker.text.offsetX(marker.text.width() / 2)
      marker.text.offsetY(-3)
      marker.group.moveToTop()
    }
  }
  for (const [key, marker] of nodes) {
    if (!seen.has(key)) {
      marker.group.destroy()
      nodes.delete(key)
    }
  }
  layer.batchDraw()
  emit('geometry')
}

function cancelDrag() {
  cancelBackgroundClick()
  drag.cancel()
  syncScene()
}
function getSelectedElementPosition() {
  if (
    !props.selectedTrackId ||
    !props.selectedElementId ||
    props.selectedTrackId !== props.frontTrackId
  )
    return null
  const marker = nodes.get(keyFor(props.selectedTrackId, props.selectedElementId))
  return marker ? { x: marker.group.x(), y: height / 2 } : null
}
onMounted(() => {
  if (!containerRef.value) return
  width.value = containerRef.value.clientWidth
  stage = new Konva.Stage({ container: containerRef.value, width: width.value, height })
  layer = new Konva.Layer()
  stage.add(layer)
  cancelBackgroundClick = bindLaneBackgroundClick(stage, () => {
    const pos = stage?.getPointerPosition()
    if (pos && frontTrack.value)
      emit('action', {
        type: props.fieldType === 'enum' ? 'ENUM/ADD' : 'FUNC/ADD',
        trackId: frontTrack.value.id,
        time: pointerTime(pos.x)
      })
  })
  resizeObserver = new ResizeObserver((entries) => {
    width.value = entries[0].contentRect.width
    stage?.width(width.value)
    syncScene()
  })
  resizeObserver.observe(containerRef.value)
  window.addEventListener('blur', cancelDrag)
  window.addEventListener('pointercancel', cancelDrag)
  window.addEventListener('touchcancel', cancelDrag)
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
watch(
  () => [
    props.renderVersion,
    props.windowStart,
    props.windowEnd,
    props.frontTrackId,
    props.tracks.length,
    props.duration,
    props.selectedElementId,
    props.selectedTrackId
  ],
  syncScene,
  { flush: 'post' }
)
defineExpose({ getSelectedElementPosition })
</script>

<template>
  <div
    class="marker-lane"
    :data-component="fieldType === 'enum' ? 'EnumLane' : 'FuncLane'"
    :data-lane-type="fieldType"
    :data-front-track-id="frontTrackId"
  >
    <div ref="containerRef" class="lane-canvas" data-region="lane-canvas"></div>
  </div>
</template>

<style scoped>
.marker-lane {
  height: v-bind('height + "px"');
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
