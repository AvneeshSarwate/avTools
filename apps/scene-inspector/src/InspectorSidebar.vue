<script setup lang="ts">
import { computed, ref } from 'vue'
import type { RegistryEntry, ComponentType } from './inspectorClient'

const props = defineProps<{
  entries: RegistryEntry[]
  selectedName: string | null
}>()

const emit = defineEmits<{
  (e: 'select', name: string): void
}>()

const searchFilter = ref('')

const filteredEntries = computed(() => {
  const filter = searchFilter.value.toLowerCase().trim()
  if (!filter) return props.entries
  return props.entries.filter(e =>
    e.name.toLowerCase().includes(filter) ||
    e.componentType.toLowerCase().includes(filter)
  )
})

// Group by type
const groupedEntries = computed(() => {
  const groups: Record<ComponentType, RegistryEntry[]> = {
    'piano-roll': [],
    'animation-editor': [],
    'tweakpane': [],
  }
  for (const entry of filteredEntries.value) {
    groups[entry.componentType]?.push(entry)
  }
  return groups
})

const typeLabels: Record<ComponentType, string> = {
  'piano-roll': 'Piano Rolls',
  'animation-editor': 'Animation Editors',
  'tweakpane': 'Tweakpane Panels',
}

const typeIcons: Record<ComponentType, string> = {
  'piano-roll': 'PR',
  'animation-editor': 'AE',
  'tweakpane': 'TP',
}
</script>

<template>
  <div class="sidebar">
    <div class="sidebar-search">
      <input
        v-model="searchFilter"
        type="text"
        placeholder="Filter..."
        class="search-input"
      />
    </div>
    <div class="sidebar-content">
      <div v-if="entries.length === 0" class="empty-state">
        No objects registered yet.
        Create bound objects in your notebook to see them here.
      </div>
      <template v-for="(typeEntries, type) in groupedEntries" :key="type">
        <div v-if="typeEntries.length > 0" class="type-group">
          <div class="type-header">{{ typeLabels[type as ComponentType] }}</div>
          <div
            v-for="entry in typeEntries"
            :key="entry.name"
            class="entry-item"
            :class="{ selected: entry.name === selectedName }"
            @click="emit('select', entry.name)"
          >
            <span class="entry-badge" :class="type">{{ typeIcons[type as ComponentType] }}</span>
            <span class="entry-name">{{ entry.name }}</span>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.sidebar {
  width: 260px;
  min-width: 260px;
  display: flex;
  flex-direction: column;
  background: #16213e;
  border-right: 1px solid #0f3460;
}

.sidebar-search {
  padding: 8px;
  border-bottom: 1px solid #0f3460;
}

.search-input {
  width: 100%;
  padding: 6px 10px;
  background: #1a1a2e;
  border: 1px solid #0f3460;
  border-radius: 4px;
  color: #e0e0e0;
  font-size: 12px;
}

.search-input:focus {
  outline: none;
  border-color: #533483;
}

.search-input::placeholder {
  color: #555;
}

.sidebar-content {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

.empty-state {
  padding: 20px 16px;
  color: #666;
  font-size: 12px;
  text-align: center;
  line-height: 1.5;
}

.type-group {
  margin-bottom: 4px;
}

.type-header {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #888;
  padding: 8px 12px 4px;
}

.entry-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  cursor: pointer;
  transition: background 0.1s;
}

.entry-item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.entry-item.selected {
  background: #0f3460;
}

.entry-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  font-size: 9px;
  font-weight: 700;
  flex-shrink: 0;
}

.entry-badge.piano-roll { background: #2ecc71; color: #000; }
.entry-badge.animation-editor { background: #3498db; color: #000; }
.entry-badge.tweakpane { background: #e67e22; color: #000; }

.entry-name {
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
