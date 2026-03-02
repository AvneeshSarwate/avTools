<script setup lang="ts">
import { ref, watch, onUnmounted, markRaw, type Component } from 'vue'
import type { RegistryEntry } from './inspectorClient'
import type { InspectorClient } from './inspectorClient'
import PianoRollDetail from './details/PianoRollDetail.vue'
import AnimationEditorDetail from './details/AnimationEditorDetail.vue'
import TweakpaneDetail from './details/TweakpaneDetail.vue'

const props = defineProps<{
  entry: RegistryEntry | null
  client: InspectorClient
}>()

// Active session state
const activeWsUrl = ref<string | null>(null)
const activeSessionId = ref<string | null>(null)
const activeName = ref<string | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)

// Map component types to Vue components
const componentMap: Record<string, Component> = {
  'piano-roll': markRaw(PianoRollDetail),
  'animation-editor': markRaw(AnimationEditorDetail),
  'tweakpane': markRaw(TweakpaneDetail),
}

async function connectToEntry(entry: RegistryEntry) {
  // Destroy previous session if any
  disconnectCurrent()

  loading.value = true
  error.value = null

  try {
    const result = await props.client.createSession(entry.name)
    activeWsUrl.value = result.wsUrl
    activeSessionId.value = result.sessionId
    activeName.value = entry.name
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to create session'
  } finally {
    loading.value = false
  }
}

function disconnectCurrent() {
  if (activeName.value && activeSessionId.value) {
    props.client.destroySession(activeName.value, activeSessionId.value)
  }
  activeWsUrl.value = null
  activeSessionId.value = null
  activeName.value = null
  error.value = null
}

// Watch for entry changes
watch(() => props.entry, (newEntry, oldEntry) => {
  if (newEntry && newEntry.name !== oldEntry?.name) {
    connectToEntry(newEntry)
  } else if (!newEntry) {
    disconnectCurrent()
  }
})

onUnmounted(() => {
  disconnectCurrent()
})
</script>

<template>
  <div class="detail-panel">
    <!-- Empty state -->
    <div v-if="!entry" class="detail-empty">
      <p>Select an object from the sidebar to inspect it.</p>
    </div>

    <!-- Loading state -->
    <div v-else-if="loading" class="detail-loading">
      <p>Connecting to {{ entry.name }}...</p>
    </div>

    <!-- Error state -->
    <div v-else-if="error" class="detail-error">
      <p>Error: {{ error }}</p>
      <button @click="connectToEntry(entry!)">Retry</button>
    </div>

    <!-- Active component -->
    <template v-else-if="activeWsUrl && entry">
      <div class="detail-header">
        <span class="detail-name">{{ entry.name }}</span>
        <span class="detail-type">{{ entry.componentType }}</span>
      </div>
      <div class="detail-content">
        <component
          :is="componentMap[entry.componentType]"
          :ws-address="activeWsUrl"
          :key="activeWsUrl"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.detail-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.detail-empty,
.detail-loading,
.detail-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: #666;
  font-size: 14px;
}

.detail-error {
  color: #e74c3c;
}

.detail-error button {
  margin-top: 12px;
  padding: 6px 16px;
  background: #533483;
  border: none;
  border-radius: 4px;
  color: white;
  cursor: pointer;
}

.detail-error button:hover {
  background: #6a45a0;
}

.detail-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: #1a1a2e;
  border-bottom: 1px solid #0f3460;
}

.detail-name {
  font-size: 14px;
  font-weight: 600;
}

.detail-type {
  font-size: 11px;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.detail-content {
  flex: 1;
  overflow: auto;
  padding: 0;
}
</style>
