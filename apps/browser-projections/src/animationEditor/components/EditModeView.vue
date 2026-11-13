<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick, onUnmounted } from 'vue'
import type { Core } from '../core'
import type {
  TrackRuntime,
  TrackType,
  EditorAction,
  PrecisionState,
  PrecisionDraft,
  NumberElement,
  EnumElement,
  FuncElementData,
  FuncArg,
  PlayheadMarker
} from '../types'
import { useToast } from '../useToast'
import EditSidebar from './EditSidebar.vue'
import NumberLane from './NumberLane.vue'
import EnumLane from './EnumLane.vue'
import FuncLane from './FuncLane.vue'
import PrecisionEditor from './PrecisionEditor.vue'
import Playhead from './Playhead.vue'
import PlayheadMarkers from './PlayheadMarkers.vue'
import { NUMBER_LANE_HEIGHT, ENUM_LANE_HEIGHT } from '../constants'

const props = defineProps<{
  core: Core
  windowStart: number
  windowEnd: number
  currentTime: number
  playheadMarkers: readonly PlayheadMarker[]
  dataVersion: number
  duration: number
  initialEnabledTrackIds?: Set<string>
}>()

const { warning } = useToast()

// Edit state - initialize from prop if provided
const editEnabledTrackIds = ref<Set<string>>(new Set())
const frontTrackIdByType = ref<{ number?: string; enum?: string; func?: string }>({})
const selectedElementByType = ref<{
  number?: { trackId: string; elementId: string }
  enum?: { trackId: string; elementId: string }
  func?: { trackId: string; elementId: string }
}>({})
const precision = ref<PrecisionState | null>(null)

// Render version (increment to trigger lane rebuilds)
const renderVersion = ref(0)

// Track refs for getting element positions
const numberLaneRef = ref<InstanceType<typeof NumberLane> | null>(null)
const enumLaneRef = ref<InstanceType<typeof EnumLane> | null>(null)
const funcLaneRef = ref<InstanceType<typeof FuncLane> | null>(null)

// Lanes container for playhead width calculation
const lanesContainerRef = ref<HTMLElement | null>(null)
const lanesWidth = ref(0)

// Precision button positions
const precisionBtnPosition = ref<{ x: number; y: number; type: TrackType } | null>(null)

// Computed tracks by type
const allTracks = computed(() => {
  void props.dataVersion
  return props.core.getOrderedTracks()
})

const numberTracks = computed(() => {
  const ids = editEnabledTrackIds.value
  return allTracks.value.filter((t) => t.def.fieldType === 'number' && ids.has(t.id))
})

const enumTracks = computed(() => {
  const ids = editEnabledTrackIds.value
  return allTracks.value.filter((t) => t.def.fieldType === 'enum' && ids.has(t.id))
})

const funcTracks = computed(() => {
  const ids = editEnabledTrackIds.value
  return allTracks.value.filter((t) => t.def.fieldType === 'func' && ids.has(t.id))
})

// Precision editor helpers
const precisionTrackName = computed(() => {
  if (!precision.value) return ''
  const track = props.core.getTrackById(precision.value.trackId)
  return track?.def.name || ''
})

const precisionEnumOptions = computed(() => {
  if (!precision.value || precision.value.fieldType !== 'enum') return []
  return props.core.getEnumOptions(precision.value.trackId)
})

function setExclusiveSelection(fieldType: TrackType, trackId: string, elementId: string) {
  // The editor design calls for a single selected element at a time.
  // Keeping one selection per lane causes the precision button to "stick" to earlier lanes
  // (number > enum > func), often scrolling out of view.
  selectedElementByType.value = {
    number: fieldType === 'number' ? { trackId, elementId } : undefined,
    enum: fieldType === 'enum' ? { trackId, elementId } : undefined,
    func: fieldType === 'func' ? { trackId, elementId } : undefined
  }
}

// Initialize with initial enabled track IDs if provided, otherwise enable all
onMounted(() => {
  if (props.initialEnabledTrackIds && props.initialEnabledTrackIds.size > 0) {
    editEnabledTrackIds.value = new Set(props.initialEnabledTrackIds)
  } else {
    // Enable all tracks by default
    for (const track of allTracks.value) {
      editEnabledTrackIds.value.add(track.id)
    }
  }
  // Set first track of each type as front
  for (const track of allTracks.value) {
    if (editEnabledTrackIds.value.has(track.id) && !frontTrackIdByType.value[track.def.fieldType]) {
      frontTrackIdByType.value[track.def.fieldType] = track.id
    }
  }
})

// Update lanes width on resize
watch(
  lanesContainerRef,
  (el, _old, onCleanup) => {
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        lanesWidth.value = entry.contentRect.width
        queuePrecisionPosition()
      }
    })
    observer.observe(el)
    onCleanup(() => observer.disconnect())
  },
  { immediate: true }
)

// Watch for window changes to trigger lane rebuilds
watch(
  () => [props.windowStart, props.windowEnd],
  () => incrementRenderVersion()
)

// Rebind edit-mode views when the parent replaces core track/runtime objects.
watch(
  () => props.dataVersion,
  () => incrementRenderVersion()
)

// Watch for selection changes to update precision button position
watch(
  () => [
    selectedElementByType.value.number,
    selectedElementByType.value.enum,
    selectedElementByType.value.func
  ],
  () => queuePrecisionPosition(),
  { deep: true, flush: 'post' }
)

function updatePrecisionBtnPosition() {
  // Check each type and get position from appropriate lane
  if (selectedElementByType.value.number && numberLaneRef.value) {
    const pos = numberLaneRef.value.getSelectedElementPosition()
    if (pos) {
      precisionBtnPosition.value = { x: pos.x, y: pos.y, type: 'number' }
      return
    }
  }

  if (selectedElementByType.value.enum && enumLaneRef.value) {
    const pos = enumLaneRef.value.getSelectedElementPosition()
    if (pos) {
      const yOffset = numberTracks.value.length > 0 ? NUMBER_LANE_HEIGHT : 0
      precisionBtnPosition.value = { x: pos.x, y: pos.y + yOffset, type: 'enum' }
      return
    }
  }

  if (selectedElementByType.value.func && funcLaneRef.value) {
    const pos = funcLaneRef.value.getSelectedElementPosition()
    if (pos) {
      const yOffset =
        (numberTracks.value.length > 0 ? NUMBER_LANE_HEIGHT : 0) +
        (enumTracks.value.length > 0 ? ENUM_LANE_HEIGHT : 0)
      precisionBtnPosition.value = { x: pos.x, y: pos.y + yOffset, type: 'func' }
      return
    }
  }

  precisionBtnPosition.value = null
}

let precisionPositionPending = false
let disposed = false
onUnmounted(() => {
  disposed = true
})
function queuePrecisionPosition() {
  if (precisionPositionPending || disposed) return
  precisionPositionPending = true
  nextTick(() => {
    precisionPositionPending = false
    if (!disposed) updatePrecisionBtnPosition()
  })
}

function incrementRenderVersion() {
  renderVersion.value++
  queuePrecisionPosition()
}

// Incoming data can remove a selected point or change a track's kind.
watch(
  () => props.dataVersion,
  () => {
    for (const type of ['number', 'enum', 'func'] as TrackType[]) {
      const front = props.core.getTrackById(frontTrackIdByType.value[type] ?? '')
      if (!front || front.def.fieldType !== type) {
        frontTrackIdByType.value[type] = allTracks.value.find(
          (t) => t.def.fieldType === type && editEnabledTrackIds.value.has(t.id)
        )?.id
      }
      const selection = selectedElementByType.value[type]
      if (
        selection &&
        (props.core.getTrackById(selection.trackId)?.def.fieldType !== type ||
          !props.core.getElement(selection.trackId, selection.elementId))
      ) {
        selectedElementByType.value[type] = undefined
      }
    }
    if (
      precision.value &&
      (props.core.getTrackById(precision.value.trackId)?.def.fieldType !==
        precision.value.fieldType ||
        !props.core.getElement(precision.value.trackId, precision.value.elementId))
    )
      precision.value = null
    queuePrecisionPosition()
  },
  { flush: 'post' }
)

function onAction(action: EditorAction) {
  switch (action.type) {
    // Track management
    case 'TRACK/TOGGLE_EDIT_ENABLED':
      if (action.enabled) {
        editEnabledTrackIds.value.add(action.trackId)
      } else {
        editEnabledTrackIds.value.delete(action.trackId)
      }
      incrementRenderVersion()
      break

    case 'TRACK/SET_FRONT': {
      frontTrackIdByType.value[action.fieldType] = action.trackId
      incrementRenderVersion()
      break
    }

    case 'TRACK/DELETE': {
      props.core.deleteTrack(action.trackId)
      editEnabledTrackIds.value.delete(action.trackId)
      // Clear front if deleted
      for (const type of ['number', 'enum', 'func'] as TrackType[]) {
        if (frontTrackIdByType.value[type] === action.trackId) {
          frontTrackIdByType.value[type] = undefined
        }
      }
      // Clear selection if deleted
      for (const type of ['number', 'enum', 'func'] as TrackType[]) {
        if (selectedElementByType.value[type]?.trackId === action.trackId) {
          selectedElementByType.value[type] = undefined
        }
      }
      incrementRenderVersion()
      break
    }

    case 'TRACK/SET_BOUNDS': {
      props.core.commitEdit(() =>
        props.core.setTrackBounds(action.trackId, action.low, action.high)
      )
      incrementRenderVersion()
      break
    }

    // History
    case 'EDIT/UNDO':
      if (props.core.undo()) {
        incrementRenderVersion()
      }
      break

    case 'EDIT/REDO':
      if (props.core.redo()) {
        incrementRenderVersion()
      }
      break

    // Selection
    case 'ELEMENT/TOGGLE_SELECTION': {
      const selected = selectedElementByType.value[action.fieldType]
      if (selected?.trackId === action.trackId && selected.elementId === action.elementId)
        selectedElementByType.value[action.fieldType] = undefined
      else setExclusiveSelection(action.fieldType, action.trackId, action.elementId)
      queuePrecisionPosition()
      break
    }

    case 'ELEMENT/SELECT':
      setExclusiveSelection(action.fieldType, action.trackId, action.elementId)
      queuePrecisionPosition()
      break

    case 'ELEMENT/DESELECT':
      selectedElementByType.value[action.fieldType] = undefined
      break

    // Precision editor
    case 'PRECISION/OPEN': {
      const track = props.core.getTrackById(action.trackId)
      const element = props.core.getElement(action.trackId, action.elementId)
      if (!track || !element) break

      const draft = createDraftFromElement(track, element)
      precision.value = {
        open: true,
        fieldType: action.fieldType,
        trackId: action.trackId,
        elementId: action.elementId,
        saved: { ...draft },
        draft,
        dirty: false
      }
      break
    }

    case 'PRECISION/CHANGE_DRAFT':
      if (precision.value) {
        Object.assign(precision.value.draft, action.draft)
        precision.value.dirty = true
      }
      break

    case 'PRECISION/SAVE':
      if (precision.value) {
        savePrecisionEdit()
      }
      break

    case 'PRECISION/REVERT':
      if (precision.value) {
        precision.value.draft = { ...precision.value.saved }
        precision.value.dirty = false
      }
      break

    case 'PRECISION/CLOSE':
      precision.value = null
      break

    case 'DRAG/CANCEL':
      props.core.setDragPreview(null)
      props.core.evaluateAtCurrentTime()
      queuePrecisionPosition()
      break

    // Number lane
    case 'NUMBER/ADD': {
      let elementId: string | null = null
      props.core.commitEdit(
        () => !!(elementId = props.core.addNumberElement(action.trackId, action.time, action.value))
      )
      if (elementId) {
        setExclusiveSelection('number', action.trackId, elementId)
      }
      incrementRenderVersion()
      break
    }

    case 'NUMBER/DELETE': {
      props.core.commitEdit(() => props.core.deleteElement(action.trackId, action.elementId))
      if (selectedElementByType.value.number?.elementId === action.elementId) {
        selectedElementByType.value.number = undefined
      }
      incrementRenderVersion()
      break
    }

    case 'NUMBER/DRAG_START':
      // The lane owns the gesture baseline; history is written only on release.
      break

    case 'NUMBER/DRAG_PREVIEW':
      props.core.setDragPreview({
        fieldType: 'number',
        trackId: action.trackId,
        elementId: action.elementId,
        time: action.time,
        value: action.value
      })
      props.core.evaluateAtCurrentTime()
      // Update precision button position during drag
      queuePrecisionPosition()
      break

    case 'NUMBER/DRAG_END': {
      props.core.setDragPreview(null)
      props.core.commitEdit(() =>
        props.core.updateNumberElement(action.trackId, action.elementId, action.time, action.value)
      )
      incrementRenderVersion()
      break
    }

    // Enum lane
    case 'ENUM/ADD': {
      let elementId: string | null = null
      props.core.commitEdit(
        () => !!(elementId = props.core.addEnumElement(action.trackId, action.time))
      )
      if (elementId) {
        setExclusiveSelection('enum', action.trackId, elementId)
      }
      incrementRenderVersion()
      break
    }

    case 'ENUM/DELETE': {
      props.core.commitEdit(() => props.core.deleteElement(action.trackId, action.elementId))
      if (selectedElementByType.value.enum?.elementId === action.elementId) {
        selectedElementByType.value.enum = undefined
      }
      incrementRenderVersion()
      break
    }

    case 'ENUM/DRAG_PREVIEW':
      props.core.setDragPreview({
        fieldType: 'enum',
        trackId: action.trackId,
        elementId: action.elementId,
        time: action.time
      })
      props.core.evaluateAtCurrentTime()
      // Update precision button position during drag
      queuePrecisionPosition()
      break

    case 'ENUM/DRAG_END': {
      props.core.setDragPreview(null)
      let result = { success: false, collision: false }
      props.core.commitEdit(() => {
        result = props.core.updateEnumElement(action.trackId, action.elementId, action.time)
        return result.success
      })
      if (result.collision) {
        warning(
          result.success
            ? 'Time adjusted to avoid another element'
            : 'No room for another element within the timeline'
        )
      }
      incrementRenderVersion()
      break
    }

    // Func lane
    case 'FUNC/ADD': {
      let elementId: string | null = null
      props.core.commitEdit(
        () => !!(elementId = props.core.addFuncElement(action.trackId, action.time))
      )
      if (elementId) {
        setExclusiveSelection('func', action.trackId, elementId)
      }
      incrementRenderVersion()
      break
    }

    case 'FUNC/DELETE': {
      props.core.commitEdit(() => props.core.deleteElement(action.trackId, action.elementId))
      if (selectedElementByType.value.func?.elementId === action.elementId) {
        selectedElementByType.value.func = undefined
      }
      incrementRenderVersion()
      break
    }

    case 'FUNC/DRAG_PREVIEW':
      // Func tracks don't update callbacks during drag (per plan)
      // But we still update the precision button position
      queuePrecisionPosition()
      break

    case 'FUNC/DRAG_END': {
      let result = { success: false, collision: false }
      props.core.commitEdit(() => {
        result = props.core.updateFuncElement(action.trackId, action.elementId, action.time)
        return result.success
      })
      if (result.collision) {
        warning(
          result.success
            ? 'Time adjusted to avoid another element'
            : 'No room for another element within the timeline'
        )
      }
      incrementRenderVersion()
      break
    }
  }
}

function createDraftFromElement(
  track: TrackRuntime,
  element: NumberElement | EnumElement | FuncElementData
): PrecisionDraft {
  const draft: PrecisionDraft = { time: element.time }

  if (track.def.fieldType === 'number') {
    draft.value = (element as NumberElement).value
  } else if (track.def.fieldType === 'enum') {
    draft.enumValue = (element as EnumElement).value
  } else if (track.def.fieldType === 'func') {
    const func = (element as FuncElementData).value
    draft.funcName = func.funcName
    draft.funcArgs = func.args.map((arg) => ({
      type: typeof arg === 'number' ? 'number' : 'text',
      value: String(arg)
    })) as FuncArg[]
  }

  return draft
}

function savePrecisionEdit() {
  if (!precision.value) return

  const { fieldType, trackId, elementId, draft } = precision.value

  if (fieldType === 'number') {
    props.core.commitEdit(() =>
      props.core.updateNumberElement(trackId, elementId, draft.time, draft.value ?? 0)
    )
  } else if (fieldType === 'enum') {
    let result = { success: false, collision: false }
    props.core.commitEdit(() => {
      result = props.core.updateEnumElement(trackId, elementId, draft.time, draft.enumValue)
      return result.success
    })
    if (result.collision) {
      warning(
        result.success
          ? 'Time adjusted to avoid another element'
          : 'No room for another element within the timeline'
      )
    }
  } else if (fieldType === 'func') {
    // Parse func args
    const args: unknown[] = (draft.funcArgs || []).map((arg) => {
      if (arg.type === 'number') {
        const num = Number(arg.value)
        return isFinite(num) ? num : 0
      }
      return arg.value
    })
    let result = { success: false, collision: false }
    props.core.commitEdit(() => {
      result = props.core.updateFuncElement(trackId, elementId, draft.time, draft.funcName, args)
      return result.success
    })
    if (result.collision) {
      warning(
        result.success
          ? 'Time adjusted to avoid another element'
          : 'No room for another element within the timeline'
      )
    }
  }

  // Reflect clamping/collision resolution from the actual stored element.
  const track = props.core.getTrackById(trackId)
  const element = props.core.getElement(trackId, elementId)
  if (!track || !element) {
    precision.value = null
    return
  }
  const saved = createDraftFromElement(track, element)
  precision.value.draft = structuredClone(saved)
  precision.value.saved = structuredClone(saved)
  precision.value.dirty = false
  incrementRenderVersion()
}

function openPrecisionForSelected() {
  if (!precisionBtnPosition.value) return
  const type = precisionBtnPosition.value.type
  const sel = selectedElementByType.value[type]
  if (!sel) return
  onAction({
    type: 'PRECISION/OPEN',
    fieldType: type,
    trackId: sel.trackId,
    elementId: sel.elementId
  })
}

// Compute precision button style based on position
const precisionBtnStyle = computed(() => {
  if (!precisionBtnPosition.value) return {}
  const { x, y } = precisionBtnPosition.value
  // Position button to the right of the element, clamped to container bounds
  const btnX = Math.min(Math.max(x + 12, 4), lanesWidth.value - 24)
  const btnY = Math.max(y - 9, 4)
  return {
    left: `${btnX}px`,
    top: `${btnY}px`
  }
})
</script>

<template>
  <div class="edit-mode-view" data-component="EditModeView">
    <div class="sidebar-column" data-region="sidebar-column">
      <!-- Track list sidebar -->
      <EditSidebar
        :tracks="allTracks"
        :edit-enabled-track-ids="editEnabledTrackIds"
        :front-track-id-by-type="frontTrackIdByType"
        @action="onAction"
      />
    </div>

    <div class="lanes-area" data-region="lanes-area">
      <!-- Lanes container -->
      <div class="lanes-container" data-region="lanes-container" ref="lanesContainerRef">
        <NumberLane
          v-if="numberTracks.length > 0"
          ref="numberLaneRef"
          :tracks="numberTracks"
          :front-track-id="frontTrackIdByType.number"
          :window-start="windowStart"
          :window-end="windowEnd"
          :selected-element-id="selectedElementByType.number?.elementId"
          :selected-track-id="selectedElementByType.number?.trackId"
          :render-version="renderVersion"
          :duration="duration"
          @geometry="queuePrecisionPosition"
          @action="onAction"
        />

        <EnumLane
          v-if="enumTracks.length > 0"
          ref="enumLaneRef"
          :tracks="enumTracks"
          :front-track-id="frontTrackIdByType.enum"
          :window-start="windowStart"
          :window-end="windowEnd"
          :selected-element-id="selectedElementByType.enum?.elementId"
          :selected-track-id="selectedElementByType.enum?.trackId"
          :render-version="renderVersion"
          :duration="duration"
          @geometry="queuePrecisionPosition"
          @action="onAction"
        />

        <FuncLane
          v-if="funcTracks.length > 0"
          ref="funcLaneRef"
          :tracks="funcTracks"
          :front-track-id="frontTrackIdByType.func"
          :window-start="windowStart"
          :window-end="windowEnd"
          :selected-element-id="selectedElementByType.func?.elementId"
          :selected-track-id="selectedElementByType.func?.trackId"
          :render-version="renderVersion"
          :duration="duration"
          @geometry="queuePrecisionPosition"
          @action="onAction"
        />

        <div
          v-if="numberTracks.length === 0 && enumTracks.length === 0 && funcTracks.length === 0"
          class="empty-lanes"
          data-region="lanes-empty-state"
        >
          Select tracks in view mode to edit
        </div>

        <!-- Playhead overlay -->
        <Playhead
          :current-time="currentTime"
          :window-start="windowStart"
          :window-end="windowEnd"
          :canvas-width="lanesWidth"
          :left-offset="0"
        />
        <PlayheadMarkers
          :markers="playheadMarkers"
          :window-start="windowStart"
          :window-end="windowEnd"
          :canvas-width="lanesWidth"
          :left-offset="0"
        />

        <!-- Precision edit button - positioned near selected element -->
        <button
          v-if="precisionBtnPosition"
          class="precision-btn"
          data-testid="precision-open"
          :data-selected-type="precisionBtnPosition.type"
          :style="precisionBtnStyle"
          @click="openPrecisionForSelected"
          title="Edit element"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
          >
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Precision Editor Modal -->
    <PrecisionEditor
      v-if="precision"
      :open="precision.open"
      :field-type="precision.fieldType"
      :track-name="precisionTrackName"
      :saved="precision.saved"
      :draft="precision.draft"
      :dirty="precision.dirty"
      :enum-options="precisionEnumOptions"
      @action="onAction"
    />
  </div>
</template>

<style scoped>
.edit-mode-view {
  display: flex;
  flex: 1;
  background: var(--ae-bg);
  align-items: flex-start;
  width: 100%;
  max-width: 100%;
  min-height: 0;
  min-width: 0;
  overflow-x: hidden;
  overflow-y: auto;
}

.sidebar-column {
  flex: 0 0 var(--sidebar-width);
  width: var(--sidebar-width);
  max-width: var(--sidebar-width);
  min-width: var(--sidebar-width);
  display: flex;
  flex-direction: column;
  background: var(--ae-panel);
  border-right: 1px solid var(--ae-border);
  box-sizing: border-box;
}

.lanes-area {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.lanes-container {
  position: relative;
  width: 100%;
  min-width: 0;
}

.empty-lanes {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--ae-muted);
  font-size: 13px;
}

.precision-btn {
  position: absolute;
  width: 18px;
  height: 18px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ae-accent);
  border: none;
  border-radius: 0;
  color: var(--ae-on-accent);
  cursor: pointer;
  z-index: 100;
}

.precision-btn:hover {
  background: var(--ae-accent-hover);
}
</style>
