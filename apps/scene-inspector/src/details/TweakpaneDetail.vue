<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { TweakpaneClient } from '../../../../webcomponents/tweakpane/src/tweakpane-client'

const props = defineProps<{
  wsAddress: string
}>()

const containerRef = ref<HTMLElement | null>(null)
let client: TweakpaneClient | null = null

onMounted(() => {
  if (containerRef.value) {
    client = new TweakpaneClient(props.wsAddress, containerRef.value)
  }
})

onUnmounted(() => {
  client?.dispose()
  client = null
})
</script>

<template>
  <div class="tweakpane-detail">
    <div ref="containerRef" class="tweakpane-container"></div>
  </div>
</template>

<style scoped>
.tweakpane-detail {
  padding: 16px;
}

.tweakpane-container {
  display: inline-block;
}
</style>
