<script setup lang="ts">
import { onBeforeUnmount, shallowRef, watch } from 'vue'
import { PerfPaneClient, type SliderModel } from './perfPaneClient'
import VerticalSlider from './components/VerticalSlider.vue'

const props = defineProps<{
  /** WebSocket URL. If provided, the component creates its own client when set. */
  wsUrl?: string
}>()

const client = shallowRef<PerfPaneClient | null>(null)

/** Dev-harness entry: mount with a pre-built client (e.g. backed by a mock WS). */
function setClient(c: PerfPaneClient) {
  client.value = c
}

function onSliderChange(slider: SliderModel, value: number, last: boolean) {
  client.value?.setSliderValue(slider, value, last)
}

// React to props.wsUrl whenever it first becomes defined. When hosted as a
// custom element, the attribute is often set *after* connection, so a one-shot
// onMounted would miss it.
watch(
  () => props.wsUrl,
  (newUrl) => {
    if (newUrl && !client.value) {
      client.value = new PerfPaneClient(newUrl)
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  client.value?.disconnect()
})

defineExpose({ setClient })
</script>

<template>
  <div class="perf-root">
    <div v-if="!client" class="perf-status">waiting for client…</div>
    <template v-else>
      <div v-if="!client.model.connected" class="perf-status">connecting…</div>
      <div v-if="client.model.mixerSliders.length > 0" class="perf-mixer">
        <div class="perf-mixer-title">Scene Mixer</div>
        <div class="perf-slider-row perf-mixer-row">
          <VerticalSlider
            v-for="mixer in client.model.mixerSliders"
            :key="mixer.id"
            :slider="mixer.slider"
            :label="mixer.label"
            :change-handler="(v, last) => onSliderChange(mixer.slider, v, last)"
          />
        </div>
      </div>
      <div v-for="tab in client.model.tabs" :key="tab.id" class="perf-tab">
        <div class="perf-tab-header">
          <button
            v-for="(page, i) in tab.pages"
            :key="page.id"
            :class="{ active: tab.selectedIndex === i }"
            class="perf-tab-button"
            @click="tab.selectedIndex = i"
          >{{ page.title }}</button>
        </div>
        <div class="perf-tab-body">
          <div
            v-for="(page, i) in tab.pages"
            :key="page.id"
            v-show="tab.selectedIndex === i"
            class="perf-slider-row"
          >
            <VerticalSlider
              v-for="slider in page.sliders"
              :key="slider.id"
              :slider="slider"
              :change-handler="(v, last) => onSliderChange(slider, v, last)"
            />
            <div v-if="page.sliders.length === 0" class="perf-empty">
              no macros on this page
            </div>
          </div>
        </div>
      </div>
      <div v-if="client.model.rootSliders.length > 0" class="perf-slider-row perf-root-row">
        <VerticalSlider
          v-for="slider in client.model.rootSliders"
          :key="slider.id"
          :slider="slider"
          :change-handler="(v, last) => onSliderChange(slider, v, last)"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.perf-root {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  background:
    radial-gradient(circle at top, rgba(103, 148, 208, 0.2), transparent 36%),
    linear-gradient(180deg, #0f1621 0%, #091018 100%);
  min-height: 100vh;
  color: #e2ebf6;
  font-family: system-ui, sans-serif;
  box-sizing: border-box;
}
.perf-status {
  color: #7d8ba6;
  font-size: 12px;
  text-align: center;
  padding: 24px;
}
.perf-tab {
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: rgba(14, 20, 29, 0.4);
  border: 1px solid rgba(148, 170, 196, 0.16);
  border-radius: 10px;
  padding: 12px;
}
.perf-mixer {
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: rgba(14, 20, 29, 0.52);
  border: 1px solid rgba(148, 170, 196, 0.2);
  border-radius: 10px;
  padding: 12px;
}
.perf-mixer-title {
  color: #dce6f4;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.perf-mixer-row {
  padding-top: 2px;
}
.perf-tab-header {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.perf-tab-button {
  appearance: none;
  background: rgba(148, 170, 196, 0.14);
  color: #c8d2e2;
  border: 1px solid transparent;
  border-radius: 999px;
  padding: 6px 14px;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  letter-spacing: 0.02em;
}
.perf-tab-button:hover {
  background: rgba(148, 170, 196, 0.22);
}
.perf-tab-button.active {
  background: linear-gradient(180deg, rgba(220, 228, 239, 0.96), rgba(191, 204, 219, 0.92));
  color: #0f1824;
  border-color: rgba(148, 170, 196, 0.32);
}
.perf-tab-body {
  min-height: 260px;
}
.perf-slider-row {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  justify-content: flex-start;
  padding: 8px 4px 4px;
}
.perf-empty {
  color: #556075;
  font-size: 12px;
  padding: 24px;
}
</style>
