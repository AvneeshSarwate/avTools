<script setup lang="ts">
import { ref } from 'vue'
import type { SliderModel } from '../perfPaneClient'

const props = defineProps<{
  slider: SliderModel
  changeHandler: (value: number, last: boolean) => void
}>()

const trackRef = ref<HTMLElement | null>(null)
let dragging = false

function onPointerDown(e: PointerEvent) {
  dragging = true
  ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  dispatch(e, false)
}

function onPointerMove(e: PointerEvent) {
  if (!dragging) return
  dispatch(e, false)
}

function onPointerUp(e: PointerEvent) {
  if (!dragging) return
  dragging = false
  dispatch(e, true)
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

function displayValue(): string {
  const s = props.slider.step
  if (s >= 1) return props.slider.value.toFixed(0)
  if (s >= 0.01) return props.slider.value.toFixed(2)
  return props.slider.value.toFixed(3)
}
</script>

<template>
  <div class="vslider">
    <div class="vslider-label">{{ slider.label }}</div>
    <div
      ref="trackRef"
      class="vslider-track"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <div class="vslider-fill" :style="{ height: fillPct() + '%' }"></div>
    </div>
    <div class="vslider-value">{{ displayValue() }}</div>
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
.vslider-value {
  color: #dce6f4;
  font-family: SFMono-Regular, ui-monospace, Menlo, monospace;
  font-size: 11px;
  min-width: 50px;
  text-align: center;
}
</style>
