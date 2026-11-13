<script setup lang="ts">
import { ref } from 'vue'
import MarkerLane from './MarkerLane.vue'
import type { TrackRuntime, EditorAction } from '../types'
defineProps<{
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
const lane = ref<InstanceType<typeof MarkerLane> | null>(null)
defineExpose({ getSelectedElementPosition: () => lane.value?.getSelectedElementPosition() ?? null })
</script>

<template>
  <MarkerLane
    ref="lane"
    v-bind="$props"
    field-type="func"
    @action="emit('action', $event)"
    @geometry="emit('geometry')"
  />
</template>
