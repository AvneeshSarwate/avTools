<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { InspectorClient, type RegistryEntry } from './inspectorClient'
import InspectorSidebar from './InspectorSidebar.vue'
import InspectorDetail from './InspectorDetail.vue'

// The inspector connects to the same server that served it,
// or to a custom server URL passed as a query parameter (for dev mode)
const params = new URLSearchParams(window.location.search)
const serverUrl = params.get('server') ?? window.location.origin

const client = new InspectorClient(serverUrl)
const entries = ref<RegistryEntry[]>([])
const connected = ref(false)
const selectedName = ref<string | null>(null)

client.onRegistryUpdate = (newEntries) => {
  entries.value = newEntries
  // If selected entry was removed, deselect
  if (selectedName.value && !newEntries.find(e => e.name === selectedName.value)) {
    selectedName.value = null
  }
}

client.onConnectionChange = (isConnected) => {
  connected.value = isConnected
}

const selectedEntry = computed(() =>
  entries.value.find(e => e.name === selectedName.value) ?? null
)

function selectEntry(name: string) {
  selectedName.value = name
}

onMounted(() => {
  client.connect()
})

onUnmounted(() => {
  client.disconnect()
})
</script>

<template>
  <div class="inspector-app">
    <div class="inspector-header">
      <h1>Scene Inspector</h1>
      <span class="connection-status" :class="{ connected }">
        {{ connected ? 'Connected' : 'Disconnected' }}
      </span>
    </div>
    <div class="inspector-body">
      <InspectorSidebar
        :entries="entries"
        :selected-name="selectedName"
        @select="selectEntry"
      />
      <InspectorDetail
        :entry="selectedEntry"
        :client="client"
      />
    </div>
  </div>
</template>

<style>
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  background: #1a1a2e;
  color: #e0e0e0;
  overflow: hidden;
  height: 100vh;
}
</style>

<style scoped>
.inspector-app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.inspector-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: #16213e;
  border-bottom: 1px solid #0f3460;
}

.inspector-header h1 {
  font-size: 16px;
  font-weight: 600;
  color: #e0e0e0;
}

.connection-status {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 10px;
  background: #e74c3c;
  color: white;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.connection-status.connected {
  background: #27ae60;
}

.inspector-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}
</style>
