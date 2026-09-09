<script setup lang="ts">
import { useToast } from '../useToast'

const { toasts, removeToast } = useToast()

function getToastClass(type: string): string {
  return `toast toast-${type}`
}
</script>

<template>
  <div class="toast-container" data-component="ToastContainer" data-region="toast-container">
    <div
      v-for="toast in toasts"
      :key="toast.id"
      :class="getToastClass(toast.type)"
      :data-toast-type="toast.type"
      @click="removeToast(toast.id)"
    >
      {{ toast.message }}
    </div>
  </div>
</template>

<style scoped>
.toast-container {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}

.toast {
  padding: 12px 20px;
  border-radius: 0;
  font-size: 13px;
  font-family: system-ui, sans-serif;
  color: var(--ae-text);
  background: var(--ae-panel);
  border-left: 3px solid var(--ae-muted);
  cursor: pointer;
  pointer-events: auto;
  max-width: 300px;
}

.toast-info {
  border-left-color: var(--ae-muted);
}

.toast-warning {
  border-left-color: var(--ae-accent);
}

.toast-error {
  border-left-color: #d98a7b;
}

.toast-success {
  border-left-color: #9eb48c;
}
</style>
