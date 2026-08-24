<script setup lang="ts">
import { computed } from 'vue'
import type { PlayheadMarker } from '../types'
import { timeToX } from '../utils'

const props = defineProps<{
  markers: readonly PlayheadMarker[]
  windowStart: number
  windowEnd: number
  canvasWidth: number
  leftOffset: number
}>()

const visibleMarkers = computed(() =>
  props.markers
    .filter((marker) => marker.position >= props.windowStart && marker.position <= props.windowEnd)
    .map((marker) => ({
      ...marker,
      x:
        props.leftOffset +
        timeToX(marker.position, props.windowStart, props.windowEnd, props.canvasWidth)
    }))
)
</script>

<template>
  <div
    v-for="marker in visibleMarkers"
    :key="marker.id"
    class="playhead-marker"
    data-component="PlayheadMarker"
    :data-marker-id="marker.id"
    :style="{
      left: marker.x + 'px',
      '--marker-color': marker.color ?? '#4cc9f0'
    }"
  >
    <span class="playhead-marker-label">{{ marker.id }}</span>
  </div>
</template>

<style scoped>
.playhead-marker {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--marker-color);
  pointer-events: none;
  z-index: 9;
  transform: translateX(-50%);
}

.playhead-marker-label {
  position: absolute;
  top: 4px;
  left: 0;
  max-width: 140px;
  padding: 2px 5px;
  overflow: hidden;
  color: #091018;
  background: var(--marker-color);
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  line-height: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
  transform: translateX(-50%);
}
</style>
