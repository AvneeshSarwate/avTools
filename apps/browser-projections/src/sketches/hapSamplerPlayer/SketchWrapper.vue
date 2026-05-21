<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { CSSProperties } from 'vue'
import PopoutWindow from '@/components/PopoutWindow.vue'
import { createHapDevice, HapWebGpuRenderer } from '@/hapSampler/gpu/renderer'
import { HapPackReader } from '@/hapSampler/happack/reader'
import type { FrameIndexEntry, HapPackMetadata } from '@/hapSampler/happack/types'
import {
  cleanupStaleOpfsCacheEntries,
  importFileToOpfs,
  isOpfsAvailable,
  removeOpfsCacheEntry,
  type OpfsCacheEntry
} from '@/hapSampler/io/opfsCache'
import { MIDI_READY, midiInputs } from '@/io/midi'
import { PlaybackClock } from '@/hapSampler/playback/clock'
import type { NoteMessage } from '@midival/core'

type WorkerReadyMessage = { type: 'ready' }
type WorkerDisposedMessage = { type: 'disposed' }
type WorkerDecodedMessage = {
  type: 'decodedFrame'
  requestId: number
  generation: number
  frameNumber: number
  buffer: ArrayBuffer
  readMs: number
  decodeMs: number
}
type WorkerErrorMessage = {
  type: 'error'
  requestId?: number
  error: string
}
type WorkerOutput =
  | WorkerReadyMessage
  | WorkerDisposedMessage
  | WorkerDecodedMessage
  | WorkerErrorMessage

type WorkerSourceMessage = { kind: 'file'; file: File } | OpfsCacheEntry

type MidiMapping = {
  id: number
  note: number
  frame: number
}

const viewerRef = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const fileName = ref('')
const status = ref('Select a .happack file to inspect and play.')
const error = ref('')
const metadata = ref<HapPackMetadata | null>(null)
const currentFrame = ref(0)
const targetFrame = ref(0)
const uploadedFrame = ref<number | null>(null)
const playing = ref(false)
const loop = ref(true)
const inFlight = ref(0)
const readMs = ref(0)
const decodeMs = ref(0)
const uploadMs = ref(0)
const averageFps = ref(0)
const staleFrames = ref(0)
const useOpfs = ref(false)
const opfsAvailable = ref(false)
const sourceMode = ref<'File API' | 'OPFS SyncAccessHandle'>('File API')
const loading = ref(false)
const workerReady = ref(false)
const canvasPopped = ref(false)
const dockedCanvasWidth = ref(0)
const dockedCanvasHeight = ref(0)
const midiInputNames = ref<string[]>([])
const selectedMidiInput = ref('')
const midiStatus = ref('MIDI not initialized.')
const latestMidiNote = ref<number | null>(null)
const latestMidiVelocity = ref<number | null>(null)
const midiMappings = ref<MidiMapping[]>([])

let reader: HapPackReader | null = null
let device: GPUDevice | null = null
let renderer: HapWebGpuRenderer | null = null
let worker: Worker | null = null
let clock: PlaybackClock | null = null
let rafId = 0
let rafWindow: Window = window
let requestId = 1
let generation = 1
let requestedFrame: number | null = null
let pendingRequestCount = 0
let frameCounter = 0
let fpsWindowStart = performance.now()
let pendingSeekFrame: number | null = null
let seekDebounceTimer: number | undefined
let activeOpfsEntry: OpfsCacheEntry | null = null
let canvasPopoutWindow: Window | null = null
let viewerResizeObserver: ResizeObserver | null = null
let unregisterMidiNoteOn: (() => void) | null = null
let nextMidiMappingId = 1

const frameCount = computed(() => metadata.value?.frameCount ?? 0)
const durationSeconds = computed(() => (metadata.value ? metadata.value.durationUs / 1_000_000 : 0))
const fps = computed(() => {
  if (!metadata.value) return 0
  if (metadata.value.frameRateDenominator > 0 && metadata.value.frameRateNumerator > 0) {
    return metadata.value.frameRateNumerator / metadata.value.frameRateDenominator
  }
  return metadata.value.frameCount / Math.max(0.001, durationSeconds.value)
})
const canPlay = computed(() => !!metadata.value && workerReady.value && !error.value)
const playLabel = computed(() => (playing.value ? 'Pause' : 'Play'))
const opfsToggleLabel = computed(() => (opfsAvailable.value ? 'Use OPFS' : 'OPFS unavailable'))
const showPerfStats = new URLSearchParams(window.location.search).has('perfStats')
const popoutWidth = computed(() => metadata.value?.width ?? 1280)
const popoutHeight = computed(() => metadata.value?.height ?? 720)
const canvasAspectRatio = computed(() => popoutWidth.value / Math.max(1, popoutHeight.value))
const currentTimeSeconds = computed(() =>
  metadata.value
    ? Math.min(durationSeconds.value, currentFrame.value / Math.max(0.001, fps.value))
    : 0
)
const targetTimeSeconds = computed(() =>
  metadata.value
    ? Math.min(durationSeconds.value, targetFrame.value / Math.max(0.001, fps.value))
    : 0
)
const latestMidiMapping = computed(() =>
  latestMidiNote.value === null
    ? null
    : (midiMappings.value.find((mapping) => mapping.note === latestMidiNote.value) ?? null)
)
const latestMidiMappedTime = computed(() =>
  latestMidiMapping.value ? frameToSeconds(latestMidiMapping.value.frame) : null
)
const canvasStageStyle = computed<CSSProperties>(() => {
  if (canvasPopped.value) return {}
  if (dockedCanvasWidth.value > 0 && dockedCanvasHeight.value > 0) {
    return {
      width: `${dockedCanvasWidth.value}px`,
      height: `${dockedCanvasHeight.value}px`
    }
  }
  return {
    aspectRatio: String(canvasAspectRatio.value),
    width: '100%',
    height: 'auto'
  }
})

watch(loop, (value) => {
  clock?.setLoop(value)
})

watch([canvasAspectRatio, canvasPopped], () => {
  void nextTick().then(() => {
    if (canvasPopped.value) resizeRendererNextFrame()
    else resizeDockedCanvas(true)
  })
})

watch(selectedMidiInput, (deviceName) => {
  attachMidiInput(deviceName)
})

function frameToSeconds(frame: number) {
  return Math.min(durationSeconds.value, clampFrame(frame) / Math.max(0.001, fps.value))
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00.000'
  const minutes = Math.floor(seconds / 60)
  const wholeSeconds = Math.floor(seconds % 60)
  const millis = Math.floor((seconds % 1) * 1000)
  return `${minutes}:${String(wholeSeconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`
}

function formatMidiNote(note: number | null) {
  if (note === null) return ''
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const pitchClass = ((note % 12) + 12) % 12
  const octave = Math.floor(note / 12) - 1
  return `${note} ${names[pitchClass]}${octave}`
}

function disposeWorker(): Promise<void> {
  const activeWorker = worker
  if (!activeWorker) return Promise.resolve()
  worker = null

  return new Promise((resolve) => {
    let settled = false
    let timeoutId = 0

    const finish = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timeoutId)
      activeWorker.removeEventListener('message', handleDisposed)
      activeWorker.removeEventListener('error', finish)
      activeWorker.terminate()
      resolve()
    }

    const handleDisposed = (event: MessageEvent<WorkerOutput>) => {
      if (event.data.type === 'disposed') finish()
    }

    activeWorker.addEventListener('message', handleDisposed)
    activeWorker.addEventListener('error', finish)
    timeoutId = window.setTimeout(finish, 750)

    try {
      activeWorker.postMessage({ type: 'dispose' })
    } catch {
      finish()
    }
  })
}

async function cleanupActiveOpfsFile() {
  const entry = activeOpfsEntry
  if (!entry) return
  activeOpfsEntry = null
  sourceMode.value = 'File API'
  try {
    await removeOpfsCacheEntry(entry)
  } catch (caught) {
    console.warn('Failed to remove HAP OPFS cache entry.', caught)
  }
}

async function resetPlaybackState() {
  clearScheduledSeek()
  reader = null
  renderer?.destroy()
  renderer = null
  const workerDisposed = disposeWorker()
  clock = null
  metadata.value = null
  workerReady.value = false
  currentFrame.value = 0
  targetFrame.value = 0
  uploadedFrame.value = null
  playing.value = false
  inFlight.value = 0
  readMs.value = 0
  decodeMs.value = 0
  uploadMs.value = 0
  staleFrames.value = 0
  generation += 1
  requestedFrame = null
  pendingRequestCount = 0
  await workerDisposed
  await cleanupActiveOpfsFile()
}

async function ensureDevice() {
  if (!device) device = await createHapDevice()
  return device
}

function cancelOutstandingRequests() {
  generation += 1
  requestedFrame = null
  pendingRequestCount = 0
  inFlight.value = 0
  worker?.postMessage({ type: 'cancelBefore', generation })
}

function releaseDecodedBuffer(buffer: ArrayBuffer) {
  worker?.postMessage({ type: 'releaseFrameBuffer', buffer }, [buffer])
}

function requestExactFrame(frameNumber: number) {
  if (!worker || !metadata.value || !workerReady.value) return
  const clamped = clampFrame(frameNumber)
  if (requestedFrame === clamped) return
  if (uploadedFrame.value === clamped && pendingRequestCount === 0) return

  cancelOutstandingRequests()
  requestedFrame = clamped
  pendingRequestCount = 1
  inFlight.value = 1
  worker.postMessage({
    type: 'decodeFrame',
    requestId: requestId++,
    generation,
    frameNumber: clamped
  })
}

function handleWorkerMessage(event: MessageEvent<WorkerOutput>) {
  const message = event.data
  if (message.type === 'ready') {
    workerReady.value = true
    loading.value = false
    status.value =
      sourceMode.value === 'OPFS SyncAccessHandle' ? 'Happack loaded from OPFS.' : 'Happack loaded.'
    requestExactFrame(targetFrame.value)
    return
  }
  if (message.type === 'disposed') return
  if (message.type === 'error') {
    error.value = message.error
    loading.value = false
    workerReady.value = false
    playing.value = false
    clock?.pause()
    return
  }
  if (message.generation !== generation || message.frameNumber !== requestedFrame) {
    staleFrames.value += 1
    releaseDecodedBuffer(message.buffer)
    return
  }

  requestedFrame = null
  pendingRequestCount = 0
  inFlight.value = 0
  readMs.value = message.readMs
  decodeMs.value = message.decodeMs
  try {
    if (renderer && uploadedFrame.value !== message.frameNumber) {
      const start = performance.now()
      renderer.uploadFrame(new Uint8Array(message.buffer))
      uploadMs.value = performance.now() - start
      uploadedFrame.value = message.frameNumber
      currentFrame.value = message.frameNumber
    }
  } finally {
    releaseDecodedBuffer(message.buffer)
  }
}

function scheduleRenderLoop() {
  const ownerWindow = canvasRef.value?.ownerDocument.defaultView ?? window
  rafWindow = ownerWindow
  rafId = ownerWindow.requestAnimationFrame(tick)
}

function cancelRenderLoop() {
  if (rafId === 0) return
  try {
    rafWindow.cancelAnimationFrame(rafId)
  } catch {
    // The render loop may be owned by a popup that is already closing.
  }
  rafId = 0
  rafWindow = window
}

function restartRenderLoopInCanvasWindow() {
  if (rafId === 0) return
  cancelRenderLoop()
  scheduleRenderLoop()
}

function tick(now: number) {
  scheduleRenderLoop()
  if (!renderer || !clock) return

  const desired = clock.currentFrame(now)
  targetFrame.value = desired
  if (clock.playing) requestExactFrame(desired)
  renderer.draw()

  frameCounter += 1
  if (now - fpsWindowStart >= 500) {
    averageFps.value = (frameCounter * 1000) / (now - fpsWindowStart)
    frameCounter = 0
    fpsWindowStart = now
  }
}

async function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  cancelRenderLoop()
  loading.value = true
  await resetPlaybackState()
  fileName.value = file.name
  error.value = ''
  status.value = 'Opening happack...'

  try {
    const selectedUseOpfs = useOpfs.value
    let opened = await HapPackReader.open(file)
    let workerSource: WorkerSourceMessage = { kind: 'file', file }

    if (selectedUseOpfs) {
      if (!opfsAvailable.value) throw new Error('OPFS is not available in this browser/context.')
      status.value = 'Importing happack into OPFS...'
      const imported = await importFileToOpfs(file, ({ copiedBytes, totalBytes }) => {
        const percent = totalBytes > 0 ? (copiedBytes / totalBytes) * 100 : 0
        status.value = `Importing happack into OPFS... ${percent.toFixed(1)}%`
      })
      activeOpfsEntry = imported.entry
      opened = await HapPackReader.openSource(imported.source)
      workerSource = imported.entry
      sourceMode.value = 'OPFS SyncAccessHandle'
    } else {
      sourceMode.value = 'File API'
    }

    reader = opened
    metadata.value = opened.metadata

    await nextTick()
    resizeDockedCanvas(true)
    await nextTick()
    const canvas = canvasRef.value
    if (!canvas) throw new Error('Canvas is not mounted.')

    renderer = new HapWebGpuRenderer(
      canvas,
      await ensureDevice(),
      opened.metadata.width,
      opened.metadata.height
    )
    renderer.resize()

    worker = new Worker(new URL('../../hapSampler/workers/decode.worker.ts', import.meta.url), {
      type: 'module'
    })
    worker.onmessage = handleWorkerMessage
    worker.postMessage({
      type: 'init',
      source: workerSource,
      metadata: opened.metadata,
      index: opened.index
    } satisfies {
      type: 'init'
      source: WorkerSourceMessage
      metadata: HapPackMetadata
      index: FrameIndexEntry[]
    })

    clock = new PlaybackClock(fps.value, opened.metadata.frameCount, loop.value)
    scheduleRenderLoop()
    status.value = selectedUseOpfs
      ? 'Initializing OPFS decoder worker...'
      : 'Initializing decoder worker...'
  } catch (caught) {
    await resetPlaybackState()
    error.value = caught instanceof Error ? caught.message : String(caught)
    status.value = 'Load failed.'
    loading.value = false
  } finally {
    input.value = ''
  }
}

function togglePlayback() {
  if (!clock || !canPlay.value) return
  if (playing.value) {
    clock.pause()
    playing.value = false
    cancelOutstandingRequests()
  } else {
    clock.play(targetFrame.value)
    playing.value = true
    requestExactFrame(targetFrame.value)
  }
}

function displayFrameIntervalMs() {
  const measured = averageFps.value > 1 ? averageFps.value : 60
  return 1000 / Math.max(1, measured)
}

function clampFrame(frame: number) {
  return Math.min(Math.max(Math.round(frame), 0), Math.max(0, frameCount.value - 1))
}

function clearScheduledSeek() {
  if (seekDebounceTimer !== undefined) {
    window.clearTimeout(seekDebounceTimer)
    seekDebounceTimer = undefined
  }
  pendingSeekFrame = null
}

function commitSeek(frame: number) {
  if (!clock) return
  const clamped = clampFrame(frame)
  clock.seek(clamped)
  targetFrame.value = clamped
  currentFrame.value = clamped
  requestExactFrame(clamped)
}

function seekTo(frame: number) {
  clearScheduledSeek()
  commitSeek(frame)
}

function scheduleSeek(frame: number) {
  const clamped = clampFrame(frame)
  targetFrame.value = clamped
  currentFrame.value = clamped
  pendingSeekFrame = clamped

  if (seekDebounceTimer !== undefined) return
  seekDebounceTimer = window.setTimeout(() => {
    const next = pendingSeekFrame
    seekDebounceTimer = undefined
    pendingSeekFrame = null
    if (next !== null) commitSeek(next)
  }, displayFrameIntervalMs())
}

function flushScheduledSeek() {
  if (pendingSeekFrame === null) return
  const next = pendingSeekFrame
  clearScheduledSeek()
  commitSeek(next)
}

function stepFrame(delta: number) {
  seekTo(targetFrame.value + delta)
}

function jumpToPercent(percent: number) {
  seekTo(Math.round(Math.max(0, Math.min(1, percent)) * Math.max(0, frameCount.value - 1)))
}

function jumpToRandomFrame() {
  if (frameCount.value <= 0) return
  seekTo(Math.floor(Math.random() * frameCount.value))
}

function handleTimelineInput(event: Event) {
  const input = event.target as HTMLInputElement
  scheduleSeek(Number(input.value))
}

function handleTimelineChange() {
  flushScheduledSeek()
}

function handleTimelinePointerDown(event: PointerEvent) {
  const input = event.currentTarget as HTMLInputElement | null
  input?.focus()
}

function handleTimelineKeydown(event: KeyboardEvent) {
  if (!canPlay.value) return

  if (/^[0-9]$/.test(event.key)) {
    event.preventDefault()
    jumpToPercent(Number(event.key) / 10)
    return
  }

  if (event.key.toLowerCase() === 'r') {
    event.preventDefault()
    jumpToRandomFrame()
  }
}

function clampMidiNote(note: number) {
  return Math.min(127, Math.max(0, Math.round(note)))
}

function refreshMidiInputs() {
  const names = Array.from(midiInputs.keys()).sort((a, b) => a.localeCompare(b))
  midiInputNames.value = names
  if (!selectedMidiInput.value || !midiInputs.has(selectedMidiInput.value)) {
    selectedMidiInput.value = names[0] ?? ''
  }
  if (names.length === 0) midiStatus.value = 'No MIDI inputs found.'
}

async function initializeMidiInputList() {
  midiStatus.value = 'Initializing MIDI...'
  try {
    await MIDI_READY
    refreshMidiInputs()
    if (selectedMidiInput.value) {
      midiStatus.value = `Listening to ${selectedMidiInput.value}.`
    }
  } catch (caught) {
    midiStatus.value = caught instanceof Error ? caught.message : String(caught)
  }
}

function detachMidiInput() {
  if (!unregisterMidiNoteOn) return
  unregisterMidiNoteOn()
  unregisterMidiNoteOn = null
}

function attachMidiInput(deviceName: string) {
  detachMidiInput()
  if (!deviceName) return
  const input = midiInputs.get(deviceName)
  if (!input) {
    midiStatus.value = 'Selected MIDI input is unavailable.'
    return
  }
  unregisterMidiNoteOn = input.onAllNoteOn(handleMidiNoteOn)
  midiStatus.value = `Listening to ${deviceName}.`
}

function handleMidiNoteOn(message: NoteMessage) {
  latestMidiNote.value = message.note
  latestMidiVelocity.value = message.velocity
  const mapping = midiMappings.value.find((entry) => entry.note === message.note)
  if (mapping) seekTo(mapping.frame)
}

function upsertMidiMapping(note: number, frame: number) {
  const clampedNote = clampMidiNote(note)
  const clampedFrame = clampFrame(frame)
  const existing = midiMappings.value.find((mapping) => mapping.note === clampedNote)
  if (existing) {
    existing.frame = clampedFrame
    return
  }
  midiMappings.value.push({
    id: nextMidiMappingId++,
    note: clampedNote,
    frame: clampedFrame
  })
}

function saveCurrentTimeForLatestNote() {
  if (latestMidiNote.value === null) return
  upsertMidiMapping(latestMidiNote.value, targetFrame.value)
}

function addMidiMapping() {
  const usedNotes = new Set(midiMappings.value.map((mapping) => mapping.note))
  const baseNote = latestMidiNote.value ?? 60
  let note = baseNote
  for (let offset = 0; offset < 128; offset += 1) {
    const candidate = clampMidiNote(baseNote + offset)
    if (!usedNotes.has(candidate)) {
      note = candidate
      break
    }
  }
  upsertMidiMapping(note, targetFrame.value)
}

function updateMidiMappingNote(mappingId: number, note: number) {
  const mapping = midiMappings.value.find((entry) => entry.id === mappingId)
  if (!mapping) return

  const clampedNote = clampMidiNote(note)
  const duplicate = midiMappings.value.find(
    (entry) => entry.id !== mappingId && entry.note === clampedNote
  )
  if (duplicate) {
    duplicate.frame = mapping.frame
    removeMidiMapping(mappingId)
    return
  }
  mapping.note = clampedNote
}

function updateMidiMappingTime(mappingId: number, seconds: number) {
  const mapping = midiMappings.value.find((entry) => entry.id === mappingId)
  if (!mapping || !Number.isFinite(seconds)) return
  mapping.frame = clampFrame(seconds * Math.max(0.001, fps.value))
}

function handleMidiMappingNoteInput(mappingId: number, event: Event) {
  const input = event.target as HTMLInputElement
  updateMidiMappingNote(mappingId, Number(input.value))
}

function handleMidiMappingTimeInput(mappingId: number, event: Event) {
  const input = event.target as HTMLInputElement
  updateMidiMappingTime(mappingId, Number(input.value))
}

function saveCurrentTimeToMapping(mappingId: number) {
  const mapping = midiMappings.value.find((entry) => entry.id === mappingId)
  if (!mapping) return
  mapping.frame = clampFrame(targetFrame.value)
}

function jumpToMidiMapping(mapping: MidiMapping) {
  seekTo(mapping.frame)
}

function removeMidiMapping(mappingId: number) {
  midiMappings.value = midiMappings.value.filter((mapping) => mapping.id !== mappingId)
}

function resizeRendererNextFrame() {
  const ownerWindow = canvasRef.value?.ownerDocument.defaultView ?? window
  ownerWindow.requestAnimationFrame(() => {
    renderer?.resize()
  })
}

function resizeDockedCanvas(forceResize = false) {
  const viewer = viewerRef.value
  if (!viewer || canvasPopped.value) return

  const rect = viewer.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return

  const aspect = canvasAspectRatio.value
  let width = rect.width
  let height = width / aspect
  if (height > rect.height) {
    height = rect.height
    width = height * aspect
  }

  const nextWidth = Math.max(1, Math.floor(width))
  const nextHeight = Math.max(1, Math.floor(height))
  const changed = nextWidth !== dockedCanvasWidth.value || nextHeight !== dockedCanvasHeight.value
  if (!changed && !forceResize) return

  if (changed) {
    dockedCanvasWidth.value = nextWidth
    dockedCanvasHeight.value = nextHeight
  }
  void nextTick().then(resizeRendererNextFrame)
}

function handleWindowResize() {
  if (canvasPopped.value) return
  resizeDockedCanvas(true)
}

function removeCanvasPopoutListeners() {
  if (!canvasPopoutWindow) return
  try {
    canvasPopoutWindow.removeEventListener('resize', resizeRendererNextFrame)
    canvasPopoutWindow.document.removeEventListener('fullscreenchange', resizeRendererNextFrame)
  } catch {
    // The popup may already be closed.
  }
  canvasPopoutWindow = null
}

function handleCanvasPopoutOpened(win: Window) {
  removeCanvasPopoutListeners()
  canvasPopoutWindow = win
  win.addEventListener('resize', resizeRendererNextFrame)
  win.document.addEventListener('fullscreenchange', resizeRendererNextFrame)
  restartRenderLoopInCanvasWindow()
  void nextTick().then(resizeRendererNextFrame)
}

function handleCanvasPopoutClosed() {
  removeCanvasPopoutListeners()
  restartRenderLoopInCanvasWindow()
  void nextTick().then(() => resizeDockedCanvas(true))
}

function handlePageClose() {
  void disposeWorker().finally(() => {
    void cleanupActiveOpfsFile()
  })
}

window.addEventListener('resize', handleWindowResize)
window.addEventListener('pagehide', handlePageClose)
window.addEventListener('beforeunload', handlePageClose)

onMounted(() => {
  opfsAvailable.value = isOpfsAvailable()
  if (viewerRef.value && 'ResizeObserver' in window) {
    viewerResizeObserver = new ResizeObserver(() => resizeDockedCanvas())
    viewerResizeObserver.observe(viewerRef.value)
  }
  resizeDockedCanvas(true)
  void initializeMidiInputList()
  void cleanupStaleOpfsCacheEntries().catch((caught) => {
    console.warn('Failed to clean stale HAP OPFS cache entries.', caught)
  })
})

onBeforeUnmount(() => {
  cancelRenderLoop()
  removeCanvasPopoutListeners()
  detachMidiInput()
  viewerResizeObserver?.disconnect()
  viewerResizeObserver = null
  window.removeEventListener('resize', handleWindowResize)
  window.removeEventListener('pagehide', handlePageClose)
  window.removeEventListener('beforeunload', handlePageClose)
  clearScheduledSeek()
  void resetPlaybackState()
})
</script>

<template>
  <main class="hap-page" :class="{ 'with-stats': showPerfStats }">
    <section class="toolbar">
      <label class="file-button">
        <input type="file" accept=".happack" :disabled="loading" @change="handleFileChange" />
        Select .happack
      </label>
      <label class="loop-toggle">
        <input v-model="loop" type="checkbox" />
        Loop
      </label>
      <label class="opfs-toggle">
        <input v-model="useOpfs" type="checkbox" :disabled="loading || !opfsAvailable" />
        {{ opfsToggleLabel }}
      </label>
      <span class="status" :class="{ bad: !!error }">{{ error || status }}</span>
    </section>

    <section ref="viewerRef" class="viewer">
      <PopoutWindow
        v-model="canvasPopped"
        title="HAP Sampler Video"
        :width="popoutWidth"
        :height="popoutHeight"
        fullscreen-target=".canvas-stage"
        @opened="handleCanvasPopoutOpened"
        @closed="handleCanvasPopoutClosed"
      >
        <template #controls="{ popped, popOut, popIn }">
          <button type="button" class="popout-button" @click="popped ? popIn() : popOut()">
            {{ popped ? 'Dock Video' : 'Pop Out Video' }}
          </button>
        </template>
        <div class="canvas-stage" :class="{ popped: canvasPopped }" :style="canvasStageStyle">
          <canvas ref="canvasRef" class="hap-canvas"></canvas>
          <div v-if="!metadata" class="empty-state">
            <div class="empty-title">HAP Q WebGPU Sampler</div>
            <div class="empty-subtitle">
              Load a packaged HapY file to decode frames in a worker.
            </div>
          </div>
        </div>
      </PopoutWindow>
    </section>

    <section class="timeline">
      <div class="timeline-row">
        <div class="transport-controls">
          <button type="button" :disabled="!canPlay" @click="togglePlayback">
            {{ playLabel }}
          </button>
          <button type="button" :disabled="!canPlay" @click="stepFrame(-1)">Prev</button>
          <button type="button" :disabled="!canPlay" @click="stepFrame(1)">Next</button>
        </div>
        <input
          type="range"
          min="0"
          :max="Math.max(0, frameCount - 1)"
          :value="targetFrame"
          :disabled="!canPlay"
          @input="handleTimelineInput"
          @change="handleTimelineChange"
          @pointerdown="handleTimelinePointerDown"
          @keydown="handleTimelineKeydown"
        />
      </div>
      <div class="time-readout">
        <span>
          Frame {{ currentFrame }} / {{ Math.max(0, frameCount - 1) }} ·
          {{ formatTime(currentTimeSeconds) }} / {{ formatTime(durationSeconds) }}
        </span>
        <span v-if="showPerfStats">{{ fps.toFixed(2) }} fps</span>
      </div>
    </section>

    <section class="midi-panel">
      <div class="midi-device-row">
        <label>
          <span>Input</span>
          <select v-model="selectedMidiInput" :disabled="midiInputNames.length === 0">
            <option value="">None</option>
            <option v-for="name in midiInputNames" :key="name" :value="name">
              {{ name }}
            </option>
          </select>
        </label>
        <button type="button" @click="refreshMidiInputs">Refresh</button>
        <span class="midi-status">{{ midiStatus }}</span>
      </div>

      <div class="midi-latest-row">
        <div>
          <span class="midi-label">Latest note</span>
          <strong>{{ formatMidiNote(latestMidiNote) }}</strong>
          <span v-if="latestMidiVelocity !== null" class="midi-muted">
            vel {{ latestMidiVelocity }}
          </span>
        </div>
        <div>
          <span class="midi-label">Mapped time</span>
          <strong>
            {{ latestMidiMappedTime === null ? '' : formatTime(latestMidiMappedTime) }}
          </strong>
        </div>
        <button
          type="button"
          :disabled="latestMidiNote === null || !metadata"
          @click="saveCurrentTimeForLatestNote"
        >
          Save Current Time
        </button>
      </div>

      <div class="midi-mapping-list" :class="{ empty: midiMappings.length === 0 }">
        <div v-if="midiMappings.length === 0" class="midi-empty">No mappings</div>
        <div v-for="mapping in midiMappings" :key="mapping.id" class="midi-mapping-row">
          <label>
            <span>Note</span>
            <input
              type="number"
              min="0"
              max="127"
              :value="mapping.note"
              @change="handleMidiMappingNoteInput(mapping.id, $event)"
            />
          </label>
          <span class="midi-note-name">{{ formatMidiNote(mapping.note) }}</span>
          <label>
            <span>Time</span>
            <input
              type="number"
              min="0"
              step="0.001"
              :max="durationSeconds"
              :value="frameToSeconds(mapping.frame).toFixed(3)"
              @change="handleMidiMappingTimeInput(mapping.id, $event)"
            />
          </label>
          <span class="midi-time-label">{{ formatTime(frameToSeconds(mapping.frame)) }}</span>
          <button type="button" @click="jumpToMidiMapping(mapping)">Jump</button>
          <button type="button" @click="saveCurrentTimeToMapping(mapping.id)">Set</button>
          <button type="button" @click="removeMidiMapping(mapping.id)">Delete</button>
        </div>
      </div>

      <div class="midi-add-row">
        <button type="button" :disabled="!metadata" @click="addMidiMapping">Add Mapping</button>
        <span class="midi-muted">Current time {{ formatTime(targetTimeSeconds) }}</span>
      </div>
    </section>

    <section v-if="showPerfStats" class="details">
      <div class="detail-block">
        <h2>Source</h2>
        <dl>
          <div>
            <dt>File</dt>
            <dd>{{ fileName || 'none' }}</dd>
          </div>
          <div>
            <dt>Read path</dt>
            <dd>{{ sourceMode }}</dd>
          </div>
          <div>
            <dt>Codec</dt>
            <dd>{{ metadata?.codec ?? '-' }}</dd>
          </div>
          <div>
            <dt>Compressor</dt>
            <dd>{{ metadata?.compressor ?? '-' }}</dd>
          </div>
          <div>
            <dt>Format</dt>
            <dd>{{ metadata?.gpuFormat ?? '-' }}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>{{ metadata ? `${metadata.width} x ${metadata.height}` : '-' }}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{{ durationSeconds.toFixed(2) }}s</dd>
          </div>
        </dl>
      </div>
      <div class="detail-block">
        <h2>Runtime</h2>
        <dl>
          <div>
            <dt>Target</dt>
            <dd>{{ targetFrame }}</dd>
          </div>
          <div>
            <dt>Uploaded</dt>
            <dd>{{ uploadedFrame ?? '-' }}</dd>
          </div>
          <div>
            <dt>In flight</dt>
            <dd>{{ inFlight }}</dd>
          </div>
          <div>
            <dt>Display</dt>
            <dd>{{ averageFps.toFixed(1) }} fps</dd>
          </div>
        </dl>
      </div>
      <div class="detail-block">
        <h2>Timing</h2>
        <dl>
          <div>
            <dt>Read</dt>
            <dd>{{ readMs.toFixed(2) }} ms</dd>
          </div>
          <div>
            <dt>Decode</dt>
            <dd>{{ decodeMs.toFixed(2) }} ms</dd>
          </div>
          <div>
            <dt>Upload</dt>
            <dd>{{ uploadMs.toFixed(2) }} ms</dd>
          </div>
          <div>
            <dt>Stale</dt>
            <dd>{{ staleFrames }}</dd>
          </div>
        </dl>
      </div>
    </section>
  </main>
</template>

<style scoped>
.hap-page {
  min-height: 100vh;
  color: #eef3f8;
  background: #101316;
  font-family:
    Inter,
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 54px;
  padding: 10px 14px;
  background: #181d21;
  border-bottom: 1px solid #2a3238;
}

button,
.file-button {
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 12px;
  border: 1px solid #3b464f;
  border-radius: 6px;
  background: #252d34;
  color: #f4f8fb;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

button:disabled {
  opacity: 0.42;
  cursor: default;
}

.file-button input {
  display: none;
}

.loop-toggle,
.opfs-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #c7d0d8;
  font-size: 13px;
}

.opfs-toggle:has(input:disabled) {
  opacity: 0.52;
}

.status {
  margin-left: auto;
  min-width: 0;
  color: #9fb0bd;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status.bad {
  color: #ff9b91;
}

.viewer {
  position: relative;
  display: grid;
  place-items: center;
  height: calc(100vh - 354px);
  min-height: 300px;
  background: #050607;
  overflow: hidden;
}

.viewer :deep(.popout-wrapper) {
  position: relative;
  width: 100%;
  height: 100%;
  gap: 0;
}

.viewer :deep(.popout-toolbar) {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 3;
}

.viewer :deep(.popout-anchor) {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.viewer :deep(.popout-anchor > div) {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.with-stats .viewer {
  height: min(52vh, calc(100vh - 430px));
}

.canvas-stage {
  position: relative;
  width: 100%;
  height: 100%;
  background: #050607;
}

.canvas-stage.popped {
  width: 100%;
  height: 100%;
}

.hap-canvas {
  width: 100%;
  height: 100%;
  display: block;
}

.popout-button {
  box-shadow: 0 4px 14px rgb(0 0 0 / 0.35);
}

.empty-state {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  gap: 8px;
  text-align: center;
  pointer-events: none;
}

.empty-title {
  font-size: 22px;
  font-weight: 650;
}

.empty-subtitle {
  color: #9faab4;
  font-size: 14px;
}

.timeline {
  padding: 12px 14px;
  border-top: 1px solid #2a3238;
  border-bottom: 1px solid #2a3238;
  background: #15191d;
}

.timeline-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 12px;
}

.transport-controls {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.transport-controls button {
  min-width: 56px;
}

.timeline input[type='range'] {
  width: 100%;
  min-width: 0;
}

.time-readout {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  color: #aeb9c2;
  font-size: 12px;
}

.midi-panel {
  display: grid;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid #2a3238;
  background: #12171b;
}

.midi-device-row,
.midi-latest-row,
.midi-add-row {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  align-items: center;
  gap: 10px;
}

.midi-device-row label,
.midi-latest-row > div,
.midi-mapping-row label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.midi-device-row select,
.midi-mapping-row input {
  height: 30px;
  min-width: 0;
  border: 1px solid #34404a;
  border-radius: 6px;
  background: #0f1317;
  color: #edf3f7;
  font: inherit;
  font-size: 12px;
}

.midi-device-row select {
  width: 220px;
  padding: 0 8px;
}

.midi-mapping-row input {
  width: 74px;
  padding: 0 6px;
}

.midi-label,
.midi-mapping-row label span {
  color: #8d9aa4;
  font-size: 11px;
  text-transform: uppercase;
}

.midi-muted,
.midi-status,
.midi-note-name,
.midi-time-label,
.midi-empty {
  color: #9aa7b0;
  font-size: 12px;
}

.midi-latest-row strong {
  min-width: 70px;
  color: #f2f7fb;
  font-size: 13px;
  font-weight: 650;
}

.midi-mapping-list {
  display: grid;
  gap: 6px;
  max-height: 128px;
  overflow-y: auto;
  padding-right: 4px;
}

.midi-mapping-list.empty {
  place-items: center start;
  min-height: 34px;
}

.midi-mapping-row {
  display: grid;
  grid-template-columns: auto 72px auto 76px auto auto auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.midi-add-row {
  grid-template-columns: auto minmax(0, 1fr);
}

.details {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  background: #2a3238;
}

.detail-block {
  min-width: 0;
  padding: 14px;
  background: #181d21;
}

.detail-block h2 {
  margin: 0 0 10px;
  color: #eef3f8;
  font-size: 13px;
  font-weight: 650;
}

dl {
  margin: 0;
  display: grid;
  gap: 7px;
}

dl div {
  display: grid;
  grid-template-columns: 82px minmax(0, 1fr);
  gap: 8px;
}

dt {
  color: #87939d;
  font-size: 12px;
}

dd {
  margin: 0;
  min-width: 0;
  color: #dbe4eb;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 760px) {
  .toolbar {
    flex-wrap: wrap;
  }

  .status {
    flex-basis: 100%;
    margin-left: 0;
  }

  .viewer {
    min-height: 300px;
    height: calc(100vh - 470px);
  }

  .with-stats .viewer {
    height: 38vh;
  }

  .timeline-row {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .transport-controls {
    justify-content: flex-start;
  }

  .midi-device-row,
  .midi-latest-row,
  .midi-mapping-row {
    grid-template-columns: 1fr;
    align-items: stretch;
  }

  .midi-device-row select,
  .midi-mapping-row input {
    width: 100%;
  }

  .details {
    grid-template-columns: 1fr;
  }
}
</style>
