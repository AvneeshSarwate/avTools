<script setup lang="ts">
import type { ToggleModel } from '../perfPaneClient'

const props = defineProps<{
  toggle: ToggleModel
  changeHandler: (value: boolean, last: boolean) => void
}>()

function onClick() {
  props.changeHandler(!props.toggle.value, true)
}
</script>

<template>
  <div class="toggle">
    <div class="toggle-label">{{ toggle.label }}</div>
    <button
      type="button"
      class="toggle-button"
      :class="{ active: toggle.value }"
      @click="onClick"
    >
      {{ toggle.value ? 'ON' : 'OFF' }}
    </button>
  </div>
</template>

<style scoped>
.toggle {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  min-width: 72px;
}
.toggle-label {
  color: #b8c4d4;
  font-family: system-ui, sans-serif;
  font-size: 12px;
  text-align: center;
  max-width: 88px;
  word-break: break-word;
  line-height: 1.2;
}
.toggle-button {
  appearance: none;
  min-width: 64px;
  height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid rgba(148, 170, 196, 0.2);
  background: rgba(23, 31, 44, 0.9);
  color: #9fadc3;
  font-family: SFMono-Regular, ui-monospace, Menlo, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  cursor: pointer;
  transition:
    background-color 120ms ease,
    border-color 120ms ease,
    color 120ms ease,
    transform 120ms ease;
}
.toggle-button:hover {
  border-color: rgba(148, 170, 196, 0.34);
  color: #dce6f4;
}
.toggle-button:active {
  transform: translateY(1px);
}
.toggle-button.active {
  background: linear-gradient(180deg, #8fc3ff 0%, #5a9eff 100%);
  border-color: rgba(143, 195, 255, 0.72);
  color: #08111d;
}
</style>
