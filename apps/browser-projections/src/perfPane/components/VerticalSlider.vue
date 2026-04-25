<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import type { SliderModel } from '../perfPaneClient'

const props = defineProps<{
  slider: SliderModel
  label?: string
  changeHandler: (value: number, last: boolean) => void
}>()

const trackRef = ref<HTMLElement | null>(null)
const valueDraft = ref('')
const editingValue = ref(false)
let dragging = false
let activePointerId: number | null = null

function preventBrowserDrag(e: Event) {
  e.preventDefault()
}

function lockDocumentSelection() {
  document.documentElement.classList.add('perf-dragging')
  document.addEventListener('selectstart', preventBrowserDrag)
  document.addEventListener('dragstart', preventBrowserDrag)
}

function unlockDocumentSelection() {
  document.documentElement.classList.remove('perf-dragging')
  document.removeEventListener('selectstart', preventBrowserDrag)
  document.removeEventListener('dragstart', preventBrowserDrag)
}

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  e.preventDefault()
  dragging = true
  activePointerId = e.pointerId
  ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  lockDocumentSelection()
  dispatch(e, false)
}

function onPointerMove(e: PointerEvent) {
  if (activePointerId !== null && e.pointerId !== activePointerId) return
  if (!dragging) return
  e.preventDefault()
  dispatch(e, false)
}

function onPointerUp(e: PointerEvent) {
  if (activePointerId !== null && e.pointerId !== activePointerId) return
  if (!dragging) return
  e.preventDefault()
  dispatch(e, true)
  endDrag(e)
}

function onPointerCancel(e: PointerEvent) {
  if (activePointerId !== null && e.pointerId !== activePointerId) return
  if (!dragging) return
  endDrag(e)
}

function onLostPointerCapture(e: PointerEvent) {
  if (activePointerId !== null && e.pointerId !== activePointerId) return
  endDrag(e)
}

function endDrag(e?: PointerEvent) {
  if (!dragging && activePointerId === null) return
  const track = trackRef.value
  if (track && e && activePointerId !== null && track.hasPointerCapture(activePointerId)) {
    track.releasePointerCapture(activePointerId)
  }
  dragging = false
  activePointerId = null
  unlockDocumentSelection()
}

function dispatch(e: PointerEvent, last: boolean) {
  const track = trackRef.value
  if (!track) return
  const rect = track.getBoundingClientRect()
  const y = e.clientY - rect.top
  const norm = 1 - Math.max(0, Math.min(1, y / rect.height))
  const v = props.slider.min + norm * (props.slider.max - props.slider.min)
  props.changeHandler(v, last)
}

function fillPct(): number {
  const range = props.slider.max - props.slider.min
  if (range <= 0) return 0
  return ((props.slider.value - props.slider.min) / range) * 100
}

function formatValue(value: number): string {
  const s = props.slider.step
  if (s >= 1) return value.toFixed(0)
  if (s >= 0.01) return value.toFixed(2)
  return value.toFixed(3)
}

function syncDraftFromSlider(): void {
  valueDraft.value = formatValue(props.slider.value)
}

function onValueFocus(): void {
  editingValue.value = true
  valueDraft.value = String(props.slider.value)
}

function onValueInput(e: Event): void {
  valueDraft.value = (e.target as HTMLInputElement).value
}

function commitDraft(): void {
  const parsed = Number(valueDraft.value)
  if (!Number.isFinite(parsed)) {
    syncDraftFromSlider()
    return
  }
  props.changeHandler(parsed, true)
  syncDraftFromSlider()
}

function onValueBlur(): void {
  commitDraft()
  editingValue.value = false
}

function onValueKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter') {
    commitDraft()
    ;(e.target as HTMLInputElement).blur()
    return
  }
  if (e.key === 'Escape') {
    syncDraftFromSlider()
    ;(e.target as HTMLInputElement).blur()
  }
}

function resetToDefault(): void {
  props.changeHandler(props.slider.defaultValue, true)
  if (!editingValue.value) {
    syncDraftFromSlider()
  }
}

onBeforeUnmount(() => {
  endDrag()
})

watch(
  () => [props.slider.value, props.slider.step],
  () => {
    if (!editingValue.value) {
      syncDraftFromSlider()
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="vslider">
    <div
      class="vslider-label"
      title="Double-click to reset"
      @dblclick="resetToDefault"
    >{{ label ?? slider.label }}</div>
    <div
      ref="trackRef"
      class="vslider-track"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
      @lostpointercapture="onLostPointerCapture"
    >
      <div class="vslider-fill" :style="{ height: fillPct() + '%' }"></div>
    </div>
    <input
      class="vslider-value-input"
      type="number"
      inputmode="decimal"
      :min="slider.min"
      :max="slider.max"
      :step="slider.step"
      :value="valueDraft"
      @focus="onValueFocus"
      @input="onValueInput"
      @blur="onValueBlur"
      @keydown="onValueKeydown"
    />
  </div>
</template>

<style scoped>
.vslider {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 56px;
  user-select: none;
}
:global(html.perf-dragging),
:global(html.perf-dragging *) {
  user-select: none !important;
  -webkit-user-select: none !important;
}
.vslider-label {
  color: #b8c4d4;
  font-family: system-ui, sans-serif;
  font-size: 12px;
  text-align: center;
  max-width: 80px;
  word-break: break-word;
  line-height: 1.2;
}
.vslider-track {
  width: 32px;
  height: 220px;
  background: #1a1f28;
  border: 1px solid #2d3547;
  border-radius: 6px;
  position: relative;
  overflow: hidden;
  touch-action: none;
  cursor: ns-resize;
}
.vslider-fill {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(180deg, #8fc3ff 0%, #5a9eff 100%);
}
.vslider-value-input {
  color: #dce6f4;
  background: #0f1621;
  border: 1px solid #2d3547;
  border-radius: 4px;
  font-family: SFMono-Regular, ui-monospace, Menlo, monospace;
  font-size: 11px;
  width: 56px;
  text-align: center;
  padding: 4px 6px;
  box-sizing: border-box;
  appearance: textfield;
  -moz-appearance: textfield;
}
.vslider-value-input:focus {
  outline: none;
  border-color: #8fc3ff;
  box-shadow: 0 0 0 1px rgba(143, 195, 255, 0.35);
}
.vslider-value-input::-webkit-outer-spin-button,
.vslider-value-input::-webkit-inner-spin-button {
  appearance: none;
  -webkit-appearance: none;
  margin: 0;
}
</style>
