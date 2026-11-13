<script setup lang="ts">
import { computed, ref } from 'vue'
import TrackSettingsPopover from './TrackSettingsPopover.vue'
import type { TrackRuntime, EditorAction } from '../types'
import {
  EDIT_SIDEBAR_BG_COLOR,
  EDIT_SIDEBAR_TRACK_BG,
  EDIT_SIDEBAR_TRACK_BG_HOVER,
  EDIT_SIDEBAR_TRACK_BG_ENABLED,
  NUMBER_LANE_HEIGHT,
  ENUM_LANE_HEIGHT,
  FUNC_LANE_HEIGHT
} from '../constants'

const props = defineProps<{
  tracks: TrackRuntime[]
  editEnabledTrackIds: Set<string>
  frontTrackIdByType: { number?: string; enum?: string; func?: string }
}>()

const emit = defineEmits<{
  action: [action: EditorAction]
}>()

// Filter to only show enabled tracks, grouped by type
const enabledNumberTracks = computed(() =>
  props.tracks.filter((t) => t.def.fieldType === 'number' && props.editEnabledTrackIds.has(t.id))
)
const enabledEnumTracks = computed(() =>
  props.tracks.filter((t) => t.def.fieldType === 'enum' && props.editEnabledTrackIds.has(t.id))
)
const enabledFuncTracks = computed(() =>
  props.tracks.filter((t) => t.def.fieldType === 'func' && props.editEnabledTrackIds.has(t.id))
)

function isFront(track: TrackRuntime): boolean {
  return props.frontTrackIdByType[track.def.fieldType] === track.id
}

function setFront(track: TrackRuntime) {
  emit('action', { type: 'TRACK/SET_FRONT', fieldType: track.def.fieldType, trackId: track.id })
}

function deleteTrack(trackId: string) {
  if (confirm("Are you sure you want to delete this track? You can't undo this.")) {
    emit('action', { type: 'TRACK/DELETE', trackId })
  }
}

const settingsTrackId = ref<string | null>(null)
const settingsAnchor = ref<HTMLElement | null>(null)
const settingsTrack = computed(() =>
  props.tracks.find(
    (t) =>
      t.id === settingsTrackId.value &&
      t.def.fieldType === 'number' &&
      props.editEnabledTrackIds.has(t.id)
  )
)
function openSettings(track: TrackRuntime, event: MouseEvent) {
  settingsAnchor.value = event.currentTarget as HTMLElement
  settingsTrackId.value = track.id
}

const noTracksEnabled = computed(() => props.editEnabledTrackIds.size === 0)
</script>

<template>
  <div class="edit-sidebar" data-component="EditSidebar">
    <!-- Number tracks section -->
    <div
      class="track-section"
      data-region="sidebar-number-section"
      data-track-type="number"
      v-if="enabledNumberTracks.length > 0"
    >
      <div class="section-header">Number Tracks</div>
      <div class="sidebar-track-list">
        <div
          v-for="track in enabledNumberTracks"
          :key="track.id"
          class="track-item"
          :class="{ 'track-front': isFront(track) }"
          :data-track-id="track.id"
          data-track-type="number"
          :data-front="isFront(track) || undefined"
          @click="setFront(track)"
        >
          <div class="sidebar-track-row">
            <span class="sidebar-track-name" :title="track.def.name">{{ track.def.name }}</span>
            <button
              class="settings-btn"
              data-testid="track-settings"
              :aria-label="'Settings for ' + track.def.name"
              aria-haspopup="dialog"
              :aria-expanded="settingsTrackId === track.id"
              @click.stop="openSettings(track, $event)"
              title="Track settings"
            >
              ⋯
            </button>
            <button
              class="delete-btn"
              data-testid="track-delete"
              @click.stop="deleteTrack(track.id)"
              title="Delete track"
            >
              ×
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Enum tracks section -->
    <div
      class="track-section"
      data-region="sidebar-enum-section"
      data-track-type="enum"
      v-if="enabledEnumTracks.length > 0"
    >
      <div class="section-header">Enum Tracks</div>
      <div class="sidebar-track-list">
        <div
          v-for="track in enabledEnumTracks"
          :key="track.id"
          class="track-item"
          :class="{ 'track-front': isFront(track) }"
          :data-track-id="track.id"
          data-track-type="enum"
          :data-front="isFront(track) || undefined"
          @click="setFront(track)"
        >
          <div class="sidebar-track-row">
            <span class="sidebar-track-name" :title="track.def.name">{{ track.def.name }}</span>
            <button
              class="delete-btn"
              data-testid="track-delete"
              @click.stop="deleteTrack(track.id)"
              title="Delete track"
            >
              ×
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Func tracks section -->
    <div
      class="track-section"
      data-region="sidebar-func-section"
      data-track-type="func"
      v-if="enabledFuncTracks.length > 0"
    >
      <div class="section-header">Func Tracks</div>
      <div class="sidebar-track-list">
        <div
          v-for="track in enabledFuncTracks"
          :key="track.id"
          class="track-item"
          :class="{ 'track-front': isFront(track) }"
          :data-track-id="track.id"
          data-track-type="func"
          :data-front="isFront(track) || undefined"
          @click="setFront(track)"
        >
          <div class="sidebar-track-row">
            <span class="sidebar-track-name" :title="track.def.name">{{ track.def.name }}</span>
            <button
              class="delete-btn"
              data-testid="track-delete"
              @click.stop="deleteTrack(track.id)"
              title="Delete track"
            >
              ×
            </button>
          </div>
        </div>
      </div>
    </div>

    <TrackSettingsPopover
      v-if="settingsTrack && settingsAnchor"
      :key="settingsTrack.id"
      :track="settingsTrack"
      :anchor="settingsAnchor"
      @action="emit('action', $event)"
      @close="settingsTrackId = null"
    />

    <div v-if="noTracksEnabled" class="empty-message" data-region="sidebar-empty-state">
      Select tracks in view mode
    </div>
  </div>
</template>

<style scoped>
.edit-sidebar {
  flex: 1;
  background: v-bind('EDIT_SIDEBAR_BG_COLOR');
  display: flex;
  flex-direction: column;
}

.track-section {
  border-bottom: 1px solid var(--ae-border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  box-sizing: border-box;
}

/* Each section is pinned to the height of its corresponding lane so sidebar rows
   line up with lane rows. Overflow scrolls inside .sidebar-track-list. */
.track-section[data-track-type='number'] {
  height: v-bind('NUMBER_LANE_HEIGHT + "px"');
}

.track-section[data-track-type='enum'] {
  height: v-bind('ENUM_LANE_HEIGHT + "px"');
}

.track-section[data-track-type='func'] {
  height: v-bind('FUNC_LANE_HEIGHT + "px"');
}

.section-header {
  padding: 8px 12px;
  background: var(--ae-header);
  font-size: 10px;
  font-weight: 600;
  color: var(--ae-muted);
  text-transform: none;
  letter-spacing: 1px;
  flex-shrink: 0;
}

.sidebar-track-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.track-item {
  padding: 5px 4px 5px 7px;
  background: v-bind('EDIT_SIDEBAR_TRACK_BG');
  cursor: pointer;
  border-left: 3px solid transparent;
}

.track-item:hover {
  background: v-bind('EDIT_SIDEBAR_TRACK_BG_HOVER');
}

.track-item.track-front {
  background: v-bind('EDIT_SIDEBAR_TRACK_BG_ENABLED');
  border-left-color: var(--ae-accent);
}

.sidebar-track-row {
  display: flex;
  align-items: center;
  gap: 2px;
}

.sidebar-track-name {
  flex: 1;
  font-size: 12px;
  color: var(--ae-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.track-front .sidebar-track-name {
  color: var(--ae-text);
}

.delete-btn {
  flex-shrink: 0;
  width: 14px;
  height: 18px;
  padding: 0;
  background: transparent;
  border: none;
  color: var(--ae-muted);
  font-size: 14px;
  cursor: pointer;
  border-radius: 0;
  opacity: 0;
}

.track-item:hover .delete-btn,
.track-item:focus-within .delete-btn {
  opacity: 1;
}

.delete-btn:hover {
  background: #dc2626;
  color: #fff;
}

.settings-btn {
  flex-shrink: 0;
  width: 16px;
  height: 18px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--ae-muted);
  font-size: 16px;
  line-height: 14px;
  cursor: pointer;
}
.settings-btn:hover,
.settings-btn[aria-expanded='true'] {
  color: var(--ae-text);
  background: var(--ae-hover);
}
.settings-btn:focus-visible {
  outline: 1px solid var(--ae-accent);
}

.empty-message {
  padding: 24px 16px;
  text-align: center;
  color: var(--ae-muted);
  font-size: 12px;
}
</style>
