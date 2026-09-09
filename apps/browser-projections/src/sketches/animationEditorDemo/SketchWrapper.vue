<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { AnimationEditorView } from '@/animationEditor'
import type { TrackDef } from '@/animationEditor'
import { EDITOR_THEME } from '@/animationEditor/constants'

const editorRef = ref<InstanceType<typeof AnimationEditorView> | null>(null)
const currentTime = ref(0)

// Demo state - controlled by track callbacks
const numberSliderValue = ref(0)
const numberSliderValue2 = ref(0)
const numberSliderValue3 = ref(0)
const enumDisplayValue = ref('')
const funcTriggerLog = ref('')

// Mock data for testing
const mockNumberTrack: TrackDef = {
  name: 'object1.position.x',
  fieldType: 'number',
  data: [
    { time: 0, element: 0.2 },
    { time: 2, element: 0.8 },
    { time: 4, element: 0.3 },
    { time: 6, element: 0.9 },
    { time: 8, element: 0.5 },
  ],
  low: 0,
  high: 1,
  updateNumber: (v) => {
    numberSliderValue.value = v
  },
}

const mockNumberTrack2: TrackDef = {
  name: 'object1.position.y',
  fieldType: 'number',
  data: [
    { time: 0, element: 0.5 },
    { time: 2, element: 0.1 },
    { time: 4, element: 0.7 },
    { time: 6, element: 0.4 },
    { time: 8, element: 0.9 },
  ],
  low: 0,
  high: 1,
  updateNumber: (v) => {
    numberSliderValue2.value = v
  },
}

const mockNumberTrack3: TrackDef = {
  name: 'object1.rotation',
  fieldType: 'number',
  data: [
    { time: 0, element: 0 },
    { time: 2.5, element: 0.25 },
    { time: 5, element: 0.75 },
    { time: 7.5, element: 1 },
  ],
  low: 0,
  high: 1,
  updateNumber: (v) => {
    numberSliderValue3.value = v
  },
}

const mockEnumTrack: TrackDef = {
  name: 'object1.state',
  fieldType: 'enum',
  data: [
    { time: 0, element: 'idle' },
    { time: 2.5, element: 'walking' },
    { time: 5, element: 'running' },
    { time: 7.5, element: 'jumping' },
  ],
  updateEnum: (v) => {
    enumDisplayValue.value = v
  },
}

const mockFuncTrack: TrackDef = {
  name: 'events.triggers',
  fieldType: 'func',
  data: [
    { time: 1, element: { funcName: 'playSound', args: ['beep'] } },
    { time: 3, element: { funcName: 'spawnParticle', args: [100, 200] } },
    { time: 5.5, element: { funcName: 'flash', args: [] } },
    { time: 8, element: { funcName: 'playSound', args: ['boom'] } },
  ],
  updateFunc: (funcName, ...args) => {
    const argsStr = args.map(a => JSON.stringify(a)).join(', ')
    funcTriggerLog.value = `${funcName}(${argsStr}) @ ${Date.now()}`
  },
}

onMounted(() => {
  if (editorRef.value) {
    editorRef.value.addTrack(mockNumberTrack)
    editorRef.value.addTrack(mockNumberTrack2)
    editorRef.value.addTrack(mockNumberTrack3)
    editorRef.value.addTrack(mockEnumTrack)
    editorRef.value.addTrack(mockFuncTrack)
    editorRef.value.addTrack({
      name: 'postprocessing.feedback.amount', fieldType: 'number', low: 0, high: 1,
      data: Array.from({ length: 21 }, (_, i) => ({ time: i * 0.5, element: 0.45 + Math.sin(i * 0.7) * 0.35 })),
    })
    editorRef.value.addTrack({
      name: 'lighting.palette', fieldType: 'enum',
      data: ['warm', 'cool', 'neutral', 'warm', 'cool', 'neutral'].map((element, i) => ({ time: i * 1.5, element })),
    })
    editorRef.value.addTrack({ name: 'camera.position.z', fieldType: 'number', low: -10, high: 10, data: [] })
    editorRef.value.addTrack({ name: 'events.sceneTransitions', fieldType: 'func', data: [] })
  }
})

function onSliderInput(e: Event) {
  const value = parseFloat((e.target as HTMLInputElement).value)
  currentTime.value = value
  editorRef.value?.scrubToTime(value)
}
</script>

<template>
  <div class="app" :style="EDITOR_THEME">
    <!-- Demo display panel -->
    <div class="demo-panel">
      <div class="demo-item">
        <label>Position X:</label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.001"
          :value="numberSliderValue"
          disabled
          class="demo-slider"
        />
        <span class="demo-value">{{ numberSliderValue.toFixed(3) }}</span>
      </div>
      <div class="demo-item">
        <label>Position Y:</label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.001"
          :value="numberSliderValue2"
          disabled
          class="demo-slider"
        />
        <span class="demo-value">{{ numberSliderValue2.toFixed(3) }}</span>
      </div>
      <div class="demo-item">
        <label>Rotation:</label>
        <input
          type="range"
          min="0"
          max="1"
          step="0.001"
          :value="numberSliderValue3"
          disabled
          class="demo-slider"
        />
        <span class="demo-value">{{ numberSliderValue3.toFixed(3) }}</span>
      </div>
      <div class="demo-item">
        <label>Enum Track Output:</label>
        <div class="enum-display">{{ enumDisplayValue || '(none)' }}</div>
      </div>
      <div class="demo-item">
        <label>Func Track Trigger:</label>
        <div class="func-display">{{ funcTriggerLog || '(no trigger yet)' }}</div>
      </div>
    </div>

    <!-- Scrub controls -->
    <div class="controls">
      <label class="time-label">
        Time: {{ currentTime.toFixed(2) }}
      </label>
      <input
        type="range"
        min="0"
        max="10"
        step="0.01"
        :value="currentTime"
        @input="onSliderInput"
        class="time-slider"
      />
    </div>

    <!-- Animation editor -->
    <div class="editor-container">
      <AnimationEditorView
        ref="editorRef"
        :duration="10"
      />
    </div>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--ae-bg);
  color: var(--ae-text);
  font: 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-variant-numeric: tabular-nums;
  color-scheme: dark;
}

.demo-panel {
  display: flex;
  gap: 12px 24px;
  padding: 12px;
  background: var(--ae-panel);
  border-bottom: 1px solid var(--ae-border);
  flex-wrap: wrap;
}

.demo-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.demo-item label {
  color: var(--ae-muted);
  font-size: 11px;
  white-space: nowrap;
}

.demo-slider,
.time-slider {
  appearance: none;
  height: 4px;
  margin: 0;
  background: var(--ae-input);
  border-radius: 0;
}

.demo-slider {
  width: 80px;
}

.demo-slider::-webkit-slider-thumb,
.time-slider::-webkit-slider-thumb {
  appearance: none;
  width: 6px;
  height: 14px;
  background: var(--ae-muted);
  border: none;
  border-radius: 0;
}

.demo-slider::-moz-range-thumb,
.time-slider::-moz-range-thumb {
  width: 6px;
  height: 14px;
  background: var(--ae-muted);
  border: none;
  border-radius: 0;
}

.demo-value {
  min-width: 40px;
}

.enum-display,
.func-display {
  padding: 4px 0;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.controls {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px;
  background: var(--ae-panel);
  border-bottom: 1px solid var(--ae-border);
}

.time-label {
  min-width: 88px;
}

.time-slider {
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.time-slider::-webkit-slider-thumb {
  background: var(--ae-accent);
}

.time-slider::-moz-range-thumb {
  background: var(--ae-accent);
}

.time-slider:focus-visible {
  outline: 2px solid var(--ae-accent);
  outline-offset: 4px;
}

.editor-container {
  width: 100%;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}
</style>
