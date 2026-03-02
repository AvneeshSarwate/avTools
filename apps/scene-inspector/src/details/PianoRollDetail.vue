<script setup lang="ts">
import PianoRollRoot from '@browser/pianoRoll/PianoRollRoot.vue'

defineProps<{
  wsAddress: string
}>()
</script>

<template>
  <div class="piano-roll-detail">
    <PianoRollRoot
      :ws-address="wsAddress"
      :interactive="true"
      :show-control-panel="true"
      :width="800"
      :height="500"
    />
  </div>
</template>

<style scoped>
.piano-roll-detail {
  padding: 16px;
  display: flex;
  justify-content: center;
}
</style>
