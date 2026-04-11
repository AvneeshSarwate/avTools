<script setup lang="ts">
import { ref, provide, onMounted, onUnmounted, computed, shallowRef, reactive, watch } from 'vue'
import type { TrackDef, EditorMode, TrackElement, NumberElement, EnumElement, FuncElementData } from '../types'
import { Core } from '../core'
import { RenderScheduler } from '../renderScheduler'
import { NAME_COLUMN_WIDTH } from '../constants'
import TimeRibbon from './TimeRibbon.vue'
import TrackList from './TrackList.vue'
import Playhead from './Playhead.vue'
import EditModeView from './EditModeView.vue'
import ToastContainer from './ToastContainer.vue'
import { AnimationEditorWebSocketController, coreToTrackData, type TrackData } from '../animationEditorWebSocket'

const MIN_SIDEBAR_WIDTH = 120
const MAX_SIDEBAR_WIDTH = 500
const MIN_TIMELINE_WIDTH = 180
const SIDEBAR_WIDTH_STORAGE_KEY = 'animationEditor.sidebarWidth'

function clampSidebarWidth(w: number, availableWidth?: number): number {
  const widthLimit = Number.isFinite(availableWidth)
    ? Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, (availableWidth as number) - MIN_TIMELINE_WIDTH))
    : MAX_SIDEBAR_WIDTH
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(widthLimit, w))
}

function loadStoredSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)
    if (raw !== null) {
      const n = parseInt(raw, 10)
      if (Number.isFinite(n)) return clampSidebarWidth(n)
    }
  } catch {
    // localStorage unavailable (SSR, private mode) — fall through
  }
  return NAME_COLUMN_WIDTH
}

const props = withDefaults(defineProps<{
  duration?: number
  wsAddress?: string
  interactive?: boolean
}>(), {
  interactive: true
})

// WebSocket-overridable config
const wsConfig = reactive({
  interactive: undefined as boolean | undefined,
  duration: undefined as number | undefined
})

// Effective values (WebSocket overrides props)
const effectiveInteractive = computed(() => wsConfig.interactive ?? props.interactive)

// WebSocket controller
const wsController = shallowRef<AnimationEditorWebSocketController | null>(null)
let lastTrackSignature = ''
let lastStateSignature = ''

// Core state
const core = new Core(props.duration)
const scheduler = new RenderScheduler()

// Bumped on every core mutation so Vue recomputes derived state (e.g. hideEmptyTracks filter)
const trackDataVersion = ref(0)

// Wire up invalidation
core.setInvalidateCallback(() => {
  trackDataVersion.value++
  scheduler.invalidate()
})

// Editor mode
const mode = ref<EditorMode>('view')

// Reactive state that shadows core state for Vue reactivity
const currentTime = ref(0)
const trackIds = ref<string[]>([])

// Track selection for edit mode (checkboxes in view mode)
const selectedTrackIdsForEdit = ref<Set<string>>(new Set())

// View window state
const windowStart = ref(0)
const windowEnd = ref(core.duration)

// Live playhead for visualization (separate from scrub playhead)
const livePlayhead = ref(0)

// Search filter
const searchFilter = ref('')

// Toggle: only show tracks that have keyframes
const hideEmptyTracks = ref(false)

// Draggable sidebar / name-column width (shared across view and edit modes)
const sidebarWidth = ref(loadStoredSidebarWidth())
const editorBodyRef = ref<HTMLElement | null>(null)
const editorBodyWidth = ref<number | undefined>(undefined)
const overlayRootRef = ref<HTMLElement | null>(null)

// ResizeObserver reference for cleanup
let resizeObserver: ResizeObserver | null = null

// Track list container ref for playhead positioning
const trackListRef = ref<HTMLElement | null>(null)
const trackListContainerWidth = ref(0)
const canvasAreaWidth = computed(() =>
  Math.max(0, trackListContainerWidth.value - sidebarWidth.value)
)

// Provide to children
provide('core', core)
provide('scheduler', scheduler)
provide('windowStart', windowStart)
provide('windowEnd', windowEnd)
provide('searchFilter', searchFilter)
provide('selectedTrackIdsForEdit', selectedTrackIdsForEdit)
provide('animationEditorOverlayRoot', overlayRootRef)

// Toggle track selection for edit mode
function toggleTrackSelection(trackId: string) {
  if (selectedTrackIdsForEdit.value.has(trackId)) {
    selectedTrackIdsForEdit.value.delete(trackId)
  } else {
    selectedTrackIdsForEdit.value.add(trackId)
  }
  // Trigger reactivity
  selectedTrackIdsForEdit.value = new Set(selectedTrackIdsForEdit.value)
}

provide('toggleTrackSelection', toggleTrackSelection)

// Computed: filtered track IDs (uses reactive trackIds)
// trackDataVersion dependency ensures recomputation when core data mutates
const filteredTrackIds = computed(() => {
  void trackDataVersion.value
  let ids = trackIds.value

  if (hideEmptyTracks.value) {
    ids = ids.filter(id => {
      const track = core.getTrackById(id)
      return track && track.elementData.length > 0
    })
  }

  const filter = searchFilter.value.toLowerCase().trim()
  if (!filter) return ids

  return ids.filter(id => {
    const track = core.getTrackById(id)
    return track && track.def.name.toLowerCase().includes(filter)
  })
})

// TimeRibbon spacer width follows the draggable sidebar in both modes
const ribbonSpacerWidth = computed(() => sidebarWidth.value)

// Helper: Convert TrackData from WebSocket to TrackDef for Core
function trackDataToCoreTracks(tracks: TrackData[], trackOrder: string[]) {
  // Clear existing tracks
  for (const id of [...core.orderedTrackIds]) {
    core.deleteTrack(id)
  }

  // Add tracks in order
  for (const trackId of trackOrder) {
    const trackData = tracks.find(t => t.id === trackId)
    if (!trackData) continue

    // Create track definition (without callbacks - those are on Deno side)
    const def: TrackDef = {
      id: trackData.id,
      name: trackData.name,
      fieldType: trackData.fieldType,
      data: trackData.elementData.map(elem => {
        if (trackData.fieldType === 'number') {
          const e = elem as { time: number; value: number }
          return { id: e.id, time: e.time, element: e.value }
        } else if (trackData.fieldType === 'enum') {
          const e = elem as { time: number; value: string }
          return { id: e.id, time: e.time, element: e.value }
        } else {
          const e = elem as { time: number; value: { funcName: string; args: unknown[] } }
          return { id: e.id, time: e.time, element: e.value }
        }
      }),
      low: trackData.low,
      high: trackData.high,
      enumOptions: trackData.enumOptions ? [...trackData.enumOptions] : undefined
    }

    core.addTrack(def)
  }

  // Update reactive state
  trackIds.value = [...core.orderedTrackIds]
  applyConfiguredDuration(wsConfig.duration, { suppressWsState: true })
  markTrackSignature()
  markStateSignature()
  scheduler.invalidate()
}

function getTrackExtent(): number {
  let maxTime = 0
  for (const track of core.getOrderedTracks()) {
    const lastTime = track.times[track.times.length - 1]
    if (lastTime !== undefined && lastTime > maxTime) {
      maxTime = lastTime
    }
  }
  return maxTime
}

function applyConfiguredDuration(
  requestedDuration: number | undefined,
  options?: { suppressWsState?: boolean }
) {
  const baseDuration = requestedDuration ?? props.duration ?? core.duration
  const normalizedDuration = Number.isFinite(baseDuration) ? Math.max(0, baseDuration) : core.duration
  const nextDuration = Math.max(normalizedDuration, getTrackExtent())

  core.duration = nextDuration
  currentTime.value = Math.min(currentTime.value, nextDuration)
  livePlayhead.value = Math.min(livePlayhead.value, nextDuration)
  windowStart.value = Math.min(windowStart.value, nextDuration)
  windowEnd.value = nextDuration

  if (options?.suppressWsState) {
    markStateSignature()
  }
}

function getTrackPayload() {
  return coreToTrackData(core.tracksById, core.orderedTrackIds)
}

function getTrackSignature(payload = getTrackPayload()) {
  return JSON.stringify({
    trackOrder: payload.trackOrder,
    tracks: payload.tracks,
  })
}

function getStateSignature() {
  return JSON.stringify({
    currentTime: currentTime.value,
    duration: core.duration,
    windowStart: windowStart.value,
    windowEnd: windowEnd.value,
  })
}

function markTrackSignature(payload = getTrackPayload()) {
  lastTrackSignature = getTrackSignature(payload)
}

function markStateSignature() {
  lastStateSignature = getStateSignature()
}

// Helper: Send tracks update via WebSocket
function sendTracksUpdate(
  source?: 'tracks' | 'time' | 'window' | 'other',
  payload = getTrackPayload()
) {
  if (!wsController.value?.isConnected) return

  wsController.value.sendTracksUpdate(payload.tracks, payload.trackOrder, source)
}

// Helper: Send state update via WebSocket
function sendStateUpdate(source?: 'tracks' | 'time' | 'window' | 'other') {
  if (!wsController.value?.isConnected) return

  wsController.value.sendStateUpdate(
    currentTime.value,
    core.duration,
    windowStart.value,
    windowEnd.value,
    source
  )
}

// Update track-list container width on resize
onMounted(() => {
  const updateLayoutMetrics = () => {
    if (editorBodyRef.value) {
      editorBodyWidth.value = editorBodyRef.value.clientWidth
      const clampedWidth = clampSidebarWidth(sidebarWidth.value, editorBodyWidth.value)
      if (clampedWidth !== sidebarWidth.value) {
        sidebarWidth.value = clampedWidth
      }
    }
    if (trackListRef.value) {
      trackListContainerWidth.value = trackListRef.value.clientWidth
    }
  }

  updateLayoutMetrics()

  resizeObserver = new ResizeObserver(updateLayoutMetrics)
  if (editorBodyRef.value) {
    resizeObserver.observe(editorBodyRef.value)
  }
  if (trackListRef.value) {
    resizeObserver.observe(trackListRef.value)
  }

  // Initial draw
  scheduler.invalidate()

  // Initialize WebSocket if address provided
  if (props.wsAddress) {
    wsController.value = new AnimationEditorWebSocketController(props.wsAddress)
    wsController.value.setHandlers({
      onSetTracks: (tracks, trackOrder) => {
        trackDataToCoreTracks(tracks, trackOrder)
        // Don't echo back to sender
      },
      onScrubToTime: (time) => {
        scrubToTime(time, { suppressWsState: true })
      },
      onSetLivePlayhead: (position) => {
        livePlayhead.value = position
        scheduler.invalidate()
      },
      onSetConfig: (config) => {
        if (config.interactive !== undefined) wsConfig.interactive = config.interactive
        if (config.duration !== undefined) {
          wsConfig.duration = config.duration
          applyConfiguredDuration(config.duration, { suppressWsState: true })
          scheduler.invalidate()
        }
      },
      onGetState: (requestId) => {
        const { tracks, trackOrder } = coreToTrackData(core.tracksById, core.orderedTrackIds)
        wsController.value?.sendStateResponse(
          currentTime.value,
          core.duration,
          windowStart.value,
          windowEnd.value,
          tracks,
          trackOrder,
          requestId
        )
      }
    })
    wsController.value.connect()
  }
})

watch(trackDataVersion, () => {
  const payload = getTrackPayload()
  const signature = getTrackSignature(payload)
  if (signature === lastTrackSignature) return

  lastTrackSignature = signature
  sendTracksUpdate('tracks', payload)
}, { flush: 'post' })

watch(
  () => [currentTime.value, windowStart.value, windowEnd.value, trackDataVersion.value],
  () => {
    const signature = getStateSignature()
    if (signature === lastStateSignature) return

    lastStateSignature = signature
    sendStateUpdate('other')
  },
  { flush: 'post' }
)

onUnmounted(() => {
  wsController.value?.disconnect()
  resizeObserver?.disconnect()
  resizeObserver = null
})

function toggleMode() {
  mode.value = mode.value === 'view' ? 'edit' : 'view'
  // Refresh track IDs when switching back to view mode
  if (mode.value === 'view') {
    trackIds.value = [...core.orderedTrackIds]
    scheduler.invalidate()
  }
}

function onWindowChange() {
  scheduler.invalidate()
}

// Exposed API
function addTrack(def: TrackDef, options?: { suppressWsUpdate?: boolean }): boolean {
  const result = core.addTrack(def)
  if (result) {
    // Update reactive trackIds
    trackIds.value = [...core.orderedTrackIds]
    // Update window end if duration changed
    windowEnd.value = core.duration
    if (options?.suppressWsUpdate) {
      markTrackSignature()
      markStateSignature()
    }
  }
  return result
}

function scrubToTime(t: number, options?: { suppressWsState?: boolean }): void {
  core.scrubToTime(t)
  currentTime.value = t
  if (options?.suppressWsState) {
    markStateSignature()
  }
}

function jumpToTime(t: number, options?: { suppressWsState?: boolean }): void {
  core.jumpToTime(t)
  currentTime.value = t
  if (options?.suppressWsState) {
    markStateSignature()
  }
}

function setWindowRange(start: number, end: number): void {
  windowStart.value = start
  windowEnd.value = end
  scheduler.invalidate()
}

// Undo / redo — core's invalidate callback cascades through trackDataVersion,
// so EditModeView's dataVersion watch rebuilds the lanes automatically.
function handleUndo() {
  core.undo()
}

function handleRedo() {
  core.redo()
}

// Sidebar width drag-to-resize
let resizeStartX = 0
let resizeStartWidth = 0

function onResizeStart(e: MouseEvent) {
  e.preventDefault()
  resizeStartX = e.clientX
  resizeStartWidth = sidebarWidth.value
  window.addEventListener('mousemove', onResizeMove)
  window.addEventListener('mouseup', onResizeEnd)
}

function onResizeMove(e: MouseEvent) {
  const delta = e.clientX - resizeStartX
  sidebarWidth.value = clampSidebarWidth(resizeStartWidth + delta, editorBodyWidth.value)
}

function onResizeEnd() {
  window.removeEventListener('mousemove', onResizeMove)
  window.removeEventListener('mouseup', onResizeEnd)
  try {
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth.value))
  } catch {
    // localStorage unavailable — width is still applied for this session
  }
}

defineExpose({
  addTrack,
  scrubToTime,
  jumpToTime,
  setWindowRange,
  core,
  mode,
})
</script>

<template>
  <div
    class="animation-editor"
    data-component="AnimationEditorView"
    :data-mode="mode"
    :style="{ '--sidebar-width': sidebarWidth + 'px' }"
  >
    <!-- Control header: mode toggle + mode-specific controls -->
    <div class="control-header" data-region="control-header">
      <button class="mode-toggle" data-testid="mode-toggle" @click="toggleMode">
        {{ mode === 'view' ? 'Switch to Edit Mode' : 'Switch to View Mode' }}
      </button>
      <span class="mode-label">{{ mode === 'view' ? 'View Mode' : 'Edit Mode' }}</span>

      <!-- View-mode controls -->
      <div class="view-controls" data-region="view-controls" v-if="mode === 'view'">
        <input
          v-model="searchFilter"
          type="text"
          placeholder="Search tracks..."
          class="search-input"
          data-testid="search-input"
        />
        <label class="hide-empty-toggle">
          <input type="checkbox" v-model="hideEmptyTracks" data-testid="hide-empty-toggle" />
          <span>Hide empty</span>
        </label>
      </div>

      <!-- Edit-mode controls -->
      <div class="edit-controls" data-region="edit-controls" v-else>
        <button class="header-btn" data-testid="undo" @click="handleUndo" title="Undo">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
          </svg>
        </button>
        <button class="header-btn" data-testid="redo" @click="handleRedo" title="Redo">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- Body: ribbon + content + resize handle (handle is scoped here so it spans from ribbon to bottom, not over the control header) -->
    <div class="editor-body" data-region="editor-body" ref="editorBodyRef">
      <!-- Time ribbon (always visible, controls zoom/pan) -->
      <TimeRibbon
        :duration="core.duration"
        v-model:window-start="windowStart"
        v-model:window-end="windowEnd"
        :spacer-width="ribbonSpacerWidth"
        @update:window-start="onWindowChange"
        @update:window-end="onWindowChange"
      />

      <!-- View Mode -->
      <template v-if="mode === 'view'">
        <div class="track-list-container" data-region="track-list-container" ref="trackListRef">
          <TrackList :track-ids="filteredTrackIds" />
          <Playhead
            :current-time="currentTime"
            :window-start="windowStart"
            :window-end="windowEnd"
            :canvas-width="canvasAreaWidth"
            :left-offset="sidebarWidth"
          />
        </div>
      </template>

      <!-- Edit Mode -->
      <EditModeView
        v-else
        :core="core"
        :window-start="windowStart"
        :window-end="windowEnd"
        :current-time="currentTime"
        :data-version="trackDataVersion"
        :initial-enabled-track-ids="selectedTrackIdsForEdit"
      />

      <!-- Column resize handle (both modes) -->
      <div
        class="sidebar-resize-handle"
        data-testid="sidebar-resize-handle"
        :style="{ left: (sidebarWidth - 2) + 'px' }"
        @mousedown="onResizeStart"
      ></div>
    </div>

    <!-- Local overlay target for teleported UI so it stays inside the editor shadow root -->
    <div ref="overlayRootRef" class="overlay-root" data-region="overlay-root"></div>

    <!-- Toast notifications -->
    <ToastContainer />
  </div>
</template>

<style scoped>
.animation-editor {
  display: flex;
  flex-direction: column;
  position: relative;
  background: #121416;
  color: #c8c8c8;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  height: 100%;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
}

.control-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: #0e1012;
  border-bottom: 1px solid #2a2d30;
  flex-shrink: 0;
}

.mode-toggle {
  padding: 6px 14px;
  background: #3a7ca5;
  border: none;
  border-radius: 4px;
  color: #fff;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease;
}

.mode-toggle:hover {
  background: #4a8cb5;
}

.mode-label {
  font-size: 11px;
  color: #666;
  text-transform: uppercase;
  letter-spacing: 1px;
  font-weight: 500;
}

.view-controls,
.edit-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.search-input {
  width: 200px;
  padding: 6px 10px;
  background: #1a1c20;
  border: 1px solid #2a2d30;
  border-radius: 4px;
  color: #c8c8c8;
  font-size: 12px;
  transition: border-color 0.15s ease;
}

.search-input:focus {
  outline: none;
  border-color: #3a7ca5;
}

.search-input::placeholder {
  color: #555;
}

.hide-empty-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #888;
  cursor: pointer;
  user-select: none;
}

.hide-empty-toggle input[type="checkbox"] {
  margin: 0;
  cursor: pointer;
}

.hide-empty-toggle:hover {
  color: #aaa;
}

.header-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1e2024;
  border: 1px solid #2a2d30;
  border-radius: 4px;
  color: #888;
  cursor: pointer;
  transition: all 0.15s ease;
}

.header-btn:hover {
  background: #282c32;
  color: #c8c8c8;
}

.editor-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  width: 100%;
  min-width: 0;
  overflow: hidden;
}

.overlay-root {
  position: relative;
  z-index: 200;
}

.track-list-container {
  flex: 1;
  position: relative;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.sidebar-resize-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 5px;
  cursor: col-resize;
  z-index: 50;
  background: transparent;
  transition: background 0.15s ease;
}

.sidebar-resize-handle:hover,
.sidebar-resize-handle:active {
  background: rgba(58, 124, 165, 0.5);
}
</style>
