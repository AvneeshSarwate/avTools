<script setup lang="ts">
import { computed, inject, nextTick, onMounted, onUnmounted, ref } from 'vue'
import type { Ref } from 'vue'
import type { TrackRuntime, EditorAction } from '../types'

const props = defineProps<{ track: TrackRuntime; anchor: HTMLElement }>()
const emit = defineEmits<{ action: [action: EditorAction]; close: [] }>()
const overlayRoot = inject<Ref<HTMLElement | null> | null>('animationEditorOverlayRoot', null)
const teleportTarget = computed(() => overlayRoot?.value ?? 'body')
const panel = ref<HTMLElement | null>(null)
const lowInput = ref<HTMLInputElement | null>(null)
const low = ref(String(props.track.low))
const high = ref(String(props.track.high))
const valid = computed(
  () =>
    String(low.value).trim() !== '' &&
    String(high.value).trim() !== '' &&
    Number.isFinite(Number(low.value)) &&
    Number.isFinite(Number(high.value)) &&
    Number(low.value) < Number(high.value)
)
const position = ref({ left: '0px', top: '0px' })
let disposed = false
function close() {
  panel.value?.hidePopover()
  emit('close')
}
function onToggle(event: Event) {
  if ((event as ToggleEvent).newState === 'closed') emit('close')
}
function save() {
  if (!valid.value) return
  emit('action', {
    type: 'TRACK/SET_BOUNDS',
    trackId: props.track.id,
    low: Number(low.value),
    high: Number(high.value)
  })
  close()
}
function onScroll(event: Event) {
  if (
    event.target === document ||
    (event.target instanceof Element && event.target.contains(props.anchor))
  )
    close()
}
onMounted(async () => {
  await nextTick()
  if (disposed || !panel.value) return
  panel.value.showPopover()
  const anchor = props.anchor.getBoundingClientRect()
  const rect = panel.value.getBoundingClientRect()
  position.value = {
    left: `${Math.max(8, Math.min(anchor.right + 8, window.innerWidth - rect.width - 8))}px`,
    top: `${Math.max(8, Math.min(anchor.top, window.innerHeight - rect.height - 8))}px`
  }
  lowInput.value?.focus()
  window.addEventListener('resize', close)
  window.addEventListener('scroll', onScroll, true)
})
onUnmounted(() => {
  disposed = true
  window.removeEventListener('resize', close)
  window.removeEventListener('scroll', onScroll, true)
})
</script>

<template>
  <Teleport :to="teleportTarget">
    <div
      ref="panel"
      popover="auto"
      role="dialog"
      aria-label="Track settings"
      class="track-settings"
      data-testid="track-settings-popover"
      :style="position"
      @toggle="onToggle"
    >
      <form @submit.prevent="save">
        <div class="settings-heading">Track settings</div>
        <div class="settings-name" :title="track.def.name">{{ track.def.name }}</div>
        <div class="settings-bounds">
          <label
            >Low<input
              ref="lowInput"
              v-model="low"
              type="number"
              step="any"
              data-testid="bounds-low"
          /></label>
          <label
            >High<input v-model="high" type="number" step="any" data-testid="bounds-high"
          /></label>
        </div>
        <p v-if="!valid" class="settings-error" role="status">
          Enter finite values with Low below High.
        </p>
        <div class="settings-actions">
          <button type="button" @click="close">Cancel</button>
          <button type="submit" class="apply" :disabled="!valid" data-testid="track-settings-apply">
            Apply
          </button>
        </div>
      </form>
    </div>
  </Teleport>
</template>

<style scoped>
.track-settings {
  position: fixed;
  inset: auto;
  margin: 0;
  width: 210px;
  max-width: calc(100vw - 16px);
  box-sizing: border-box;
  padding: 9px;
  border: 1px solid var(--ae-border);
  border-radius: 0;
  background: var(--ae-header);
  color: var(--ae-text);
  font: 11px sans-serif;
}
.settings-heading {
  font-weight: 600;
  margin-bottom: 3px;
}
.settings-name {
  color: var(--ae-muted);
  overflow-wrap: anywhere;
  margin-bottom: 9px;
}
.settings-bounds {
  display: flex;
  gap: 8px;
}
label {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
  color: var(--ae-muted);
}
input {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 4px;
  border: 1px solid var(--ae-border);
  border-radius: 0;
  background: var(--ae-input);
  color: var(--ae-text);
  font: inherit;
}
input:focus,
button:focus-visible {
  outline: 1px solid var(--ae-accent);
  outline-offset: -1px;
}
.settings-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 9px;
}
button {
  padding: 4px 8px;
  border: 1px solid var(--ae-border);
  border-radius: 0;
  background: var(--ae-control);
  color: var(--ae-text);
  cursor: pointer;
  font: inherit;
}
button.apply {
  background: var(--ae-accent);
  color: var(--ae-on-accent);
  border-color: var(--ae-accent);
}
button:disabled {
  opacity: 0.4;
  cursor: default;
}
.settings-error {
  font-size: 11px;
  color: var(--ae-text);
  margin: 10px 0 0;
}
</style>
