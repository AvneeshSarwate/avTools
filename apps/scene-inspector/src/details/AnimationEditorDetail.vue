<script setup lang="ts">
import AnimationEditorView from '@browser/animationEditor/components/AnimationEditorView.vue'

defineProps<{
  wsAddress: string
}>()
</script>

<template>
  <div class="animation-editor-detail">
    <AnimationEditorView
      :ws-address="wsAddress"
      :interactive="true"
    />
  </div>
</template>

<style scoped>
.animation-editor-detail {
  height: 100%;
  display: flex;
  flex-direction: column;
}
</style>
