<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { GroupNode, Path } from './metadataGroupEdit'
import { pathKey } from './metadataGroupEdit'
import { validateMetadataValue } from './noteMetadataRules'

interface Props {
  node: GroupNode
  count: number
  depth: number
  pending: Set<string>
  warned: Set<string>
  errors: Map<string, string>
}

const props = defineProps<Props>()

const emit = defineEmits<{
  set: [path: Path, value: unknown]
  remove: [path: Path]
}>()

const collapsed = ref(false)
const adding = ref(false)
const newKey = ref('')
const newValue = ref('')
const newKeyInput = ref<HTMLInputElement>()
const draft = ref<string | null>(null)

const key = computed(() => pathKey(props.node.path))
const isRoot = computed(() => props.node.path.length === 0)
const isObject = computed(() => props.node.state.kind === 'object')
const isPending = computed(() => props.pending.has(key.value))
const isWarned = computed(() => props.warned.has(key.value))
const error = computed(() => props.errors.get(key.value) ?? null)
const isColor = computed(() => props.node.path.length === 1 && props.node.key === 'color')

const state = computed(() => props.node.state)

const leafValue = computed<unknown>(() => {
  const s = state.value
  if (s.kind === 'shared') return s.value
  if (s.kind === 'partial') return s.value
  return undefined
})

const badge = computed(() => {
  const s = state.value
  switch (s.kind) {
    case 'object':
      return s.have < props.count ? `${s.have} of ${props.count}` : ''
    case 'mixed':
      return `${s.distinct} values`
    case 'partial':
      return `${s.have} of ${props.count}`
    case 'conflict':
      return 'mixed types'
    default:
      return ''
  }
})

const placeholder = computed(() => {
  const s = state.value
  if (s.kind === 'mixed') return 'mixed'
  if (s.kind === 'partial' && s.value === undefined) return 'mixed'
  if (s.kind === 'conflict') return 'object / value'
  return ''
})

const isBoolean = computed(() => typeof leafValue.value === 'boolean')

const formatValue = (value: unknown): string => {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

const inputText = computed(() => draft.value ?? formatValue(leafValue.value))

// Text is read as JSON when it parses and as a string otherwise, except that
// a string leaf stays a string so editing "12" to "123" does not retype it.
const parseInput = (text: string, current: unknown): unknown => {
  if (typeof current === 'string' && !(isColor.value)) return text
  const trimmed = text.trim()
  if (trimmed === '') return ''
  try {
    return JSON.parse(trimmed)
  } catch {
    return text
  }
}

const commitText = () => {
  if (draft.value === null) return
  const text = draft.value
  draft.value = null
  if (text === formatValue(leafValue.value) && state.value.kind === 'shared') return
  emit('set', props.node.path, parseInput(text, leafValue.value))
}

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter') {
    commitText()
    ;(event.target as HTMLInputElement).blur()
  } else if (event.key === 'Escape') {
    draft.value = null
    ;(event.target as HTMLInputElement).blur()
  }
}

const startAdd = async () => {
  adding.value = true
  newKey.value = ''
  newValue.value = ''
  collapsed.value = false
  await nextTick()
  newKeyInput.value?.focus()
}

const commitAdd = () => {
  const name = newKey.value.trim()
  if (!name) {
    adding.value = false
    return
  }
  emit('set', [...props.node.path, name], parseInput(newValue.value, undefined))
  adding.value = false
}

const onAddKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter') commitAdd()
  else if (event.key === 'Escape') adding.value = false
}

const colorValue = computed(() =>
  typeof leafValue.value === 'string' && /^#[0-9a-f]{6}$/i.test(leafValue.value)
    ? leafValue.value
    : '#000000'
)

const onColorPick = (event: Event) => {
  emit('set', props.node.path, (event.target as HTMLInputElement).value)
}

const validation = computed(() => {
  if (error.value) return error.value
  if (isPending.value || state.value.kind === 'shared') {
    return validateMetadataValue(props.node.path, leafValue.value)
  }
  return null
})

defineExpose({ startAdd })
</script>

<template>
  <div class="node" :class="{ pending: isPending, warned: isWarned, invalid: !!validation }">
    <div v-if="!isRoot" class="row" :style="{ paddingLeft: depth * 12 + 'px' }">
      <button
        v-if="isObject || state.kind === 'conflict'"
        type="button"
        class="twisty"
        :class="{ collapsed }"
        @click="collapsed = !collapsed"
      >{{ collapsed ? '▸' : '▾' }}</button>
      <span v-else class="twisty-space"></span>

      <span class="key" :title="node.path.join('.')">{{ node.key }}</span>

      <template v-if="isObject">
        <span class="obj">{ {{ node.children.length }} }</span>
      </template>
      <template v-else>
        <input
          v-if="isColor"
          type="color"
          class="swatch"
          :value="colorValue"
          @input="onColorPick"
        />
        <input
          v-if="isBoolean && state.kind === 'shared'"
          type="checkbox"
          class="check"
          :checked="leafValue === true"
          @change="emit('set', node.path, ($event.target as HTMLInputElement).checked)"
        />
        <input
          v-else
          class="value"
          :class="{ empty: inputText === '' }"
          :value="inputText"
          :placeholder="placeholder"
          spellcheck="false"
          @input="draft = ($event.target as HTMLInputElement).value"
          @blur="commitText"
          @keydown="onKeydown"
        />
      </template>

      <span v-if="badge" class="badge">{{ badge }}</span>
      <span v-if="validation" class="err" :title="validation">{{ validation }}</span>
      <span v-else-if="isWarned" class="warn" title="Some selected notes hold a different value here">overwrites</span>

      <button
        v-if="isObject || state.kind === 'conflict'"
        type="button"
        class="act"
        title="Add field"
        @click="startAdd"
      >+</button>
      <button type="button" class="act" title="Remove from all selected" @click="emit('remove', node.path)">×</button>
    </div>

    <template v-if="!collapsed">
      <MetadataNode
        v-for="child in node.children"
        :key="child.key"
        :node="child"
        :count="count"
        :depth="isRoot ? depth : depth + 1"
        :pending="pending"
        :warned="warned"
        :errors="errors"
        @set="(path, value) => emit('set', path, value)"
        @remove="(path) => emit('remove', path)"
      />
      <div v-if="adding" class="row add" :style="{ paddingLeft: (isRoot ? depth : depth + 1) * 12 + 'px' }">
        <span class="twisty-space"></span>
        <input
          ref="newKeyInput"
          class="key-input"
          v-model="newKey"
          placeholder="key"
          spellcheck="false"
          @keydown="onAddKeydown"
        />
        <input
          class="value"
          v-model="newValue"
          placeholder='value ({} for object)'
          spellcheck="false"
          @keydown="onAddKeydown"
        />
        <button type="button" class="act" title="Add" @click="commitAdd">✓</button>
        <button type="button" class="act" title="Cancel" @click="adding = false">×</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  font-size: 12px;
  line-height: 1;
}

.row:hover {
  background: #f4f4f4;
}

.pending > .row {
  background: #eef4ff;
}

.warned > .row {
  background: #fff4dc;
}

.invalid > .row {
  background: #ffe9e9;
}

.twisty,
.twisty-space {
  width: 12px;
  flex: none;
  padding: 0;
  border: 0;
  background: none;
  color: #888;
  font-size: 10px;
  cursor: pointer;
  text-align: center;
}

.key {
  flex: none;
  min-width: 60px;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: Menlo, Consolas, monospace;
  color: #333;
}

.obj {
  color: #999;
  font-family: Menlo, Consolas, monospace;
}

.value,
.key-input {
  flex: 1 1 80px;
  min-width: 0;
  height: 16px;
  padding: 0 3px;
  border: 1px solid #ddd;
  border-radius: 2px;
  font: 12px Menlo, Consolas, monospace;
  background: #fff;
}

.key-input {
  flex: 0 1 120px;
}

.value:focus,
.key-input:focus {
  outline: none;
  border-color: #6aa8ff;
}

.value.empty {
  font-style: italic;
}

.swatch {
  width: 18px;
  height: 16px;
  padding: 0;
  border: 1px solid #ccc;
  border-radius: 2px;
  background: none;
  cursor: pointer;
  flex: none;
}

.check {
  margin: 0;
}

.badge,
.warn,
.err {
  flex: none;
  padding: 0 4px;
  border-radius: 2px;
  font-size: 10px;
  line-height: 14px;
  white-space: nowrap;
}

.badge {
  color: #777;
  background: #ececec;
}

.warn {
  color: #7a4b00;
  background: #ffd98a;
}

.err {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #8a1212;
  background: #ffc4c4;
}

.act {
  flex: none;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 2px;
  background: none;
  color: #999;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
}

.row:hover .act,
.row.add .act {
  opacity: 1;
}

.act:hover {
  border-color: #ccc;
  color: #222;
}
</style>
