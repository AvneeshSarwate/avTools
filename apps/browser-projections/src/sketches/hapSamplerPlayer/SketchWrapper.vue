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
  channel: number
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
const latestMidiChannel = ref<number | null>(null)
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
const playProgressPercent = computed(() => {
  const max = Math.max(1, frameCount.value - 1)
  if (max <= 0) return 0
  return Math.min(100, Math.max(0, (targetFrame.value / max) * 100))
})
const latestMidiMapping = computed(() =>
  latestMidiNote.value === null || latestMidiChannel.value === null
    ? null
    : (midiMappings.value.find(
        (mapping) =>
          mapping.note === latestMidiNote.value && mapping.channel === latestMidiChannel.value
      ) ?? null)
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

function clampMidiChannel(channel: number) {
  return Math.min(16, Math.max(1, Math.round(channel)))
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
  latestMidiChannel.value = message.channel
  latestMidiNote.value = message.note
  latestMidiVelocity.value = message.velocity
  const mapping = midiMappings.value.find(
    (entry) => entry.note === message.note && entry.channel === message.channel
  )
  if (mapping) seekTo(mapping.frame)
}

function upsertMidiMapping(channel: number, note: number, frame: number) {
  const c = clampMidiChannel(channel)
  const n = clampMidiNote(note)
  const f = clampFrame(frame)
  const existing = midiMappings.value.find((m) => m.channel === c && m.note === n)
  if (existing) {
    existing.frame = f
    return
  }
  midiMappings.value.push({
    id: nextMidiMappingId++,
    channel: c,
    note: n,
    frame: f
  })
}

function saveCurrentTimeForLatestNote() {
  if (latestMidiNote.value === null || latestMidiChannel.value === null) return
  upsertMidiMapping(latestMidiChannel.value, latestMidiNote.value, targetFrame.value)
}

function addMidiMapping() {
  const used = new Set(midiMappings.value.map((m) => `${m.channel}:${m.note}`))
  const lastCh = latestMidiChannel.value
  const lastNote = latestMidiNote.value
  if (
    lastCh !== null &&
    lastNote !== null &&
    !used.has(`${lastCh}:${lastNote}`)
  ) {
    upsertMidiMapping(lastCh, lastNote, targetFrame.value)
    return
  }
  const baseCh = lastCh ?? 1
  for (let n = 0; n < 128; n += 1) {
    if (!used.has(`${baseCh}:${n}`)) {
      upsertMidiMapping(baseCh, n, targetFrame.value)
      return
    }
  }
  for (let c = 1; c <= 16; c += 1) {
    for (let n = 0; n < 128; n += 1) {
      if (!used.has(`${c}:${n}`)) {
        upsertMidiMapping(c, n, targetFrame.value)
        return
      }
    }
  }
}

function updateMidiMappingNote(mappingId: number, note: number) {
  const mapping = midiMappings.value.find((entry) => entry.id === mappingId)
  if (!mapping) return

  const n = clampMidiNote(note)
  const duplicate = midiMappings.value.find(
    (entry) => entry.id !== mappingId && entry.note === n && entry.channel === mapping.channel
  )
  if (duplicate) {
    duplicate.frame = mapping.frame
    removeMidiMapping(mappingId)
    return
  }
  mapping.note = n
}

function updateMidiMappingChannel(mappingId: number, channel: number) {
  const mapping = midiMappings.value.find((entry) => entry.id === mappingId)
  if (!mapping) return

  const c = clampMidiChannel(channel)
  const duplicate = midiMappings.value.find(
    (entry) => entry.id !== mappingId && entry.channel === c && entry.note === mapping.note
  )
  if (duplicate) {
    duplicate.frame = mapping.frame
    removeMidiMapping(mappingId)
    return
  }
  mapping.channel = c
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

function handleMidiMappingChannelInput(mappingId: number, event: Event) {
  const input = event.target as HTMLInputElement
  updateMidiMappingChannel(mappingId, Number(input.value))
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
      <div class="timeline-inner">
        <div class="timeline-top">
          <div class="transport-cluster">
            <div class="transport-controls">
              <button
                type="button"
                class="transport-btn"
                :disabled="!canPlay"
                title="Previous frame"
                @click="stepFrame(-1)"
              >
                <span class="transport-icon">⏮</span>
              </button>
              <button
                type="button"
                class="transport-btn transport-btn-primary"
                :class="{ 'is-playing': playing }"
                :disabled="!canPlay"
                @click="togglePlayback"
              >
                <span class="transport-icon">{{ playing ? '⏸' : '▶' }}</span>
                <span class="transport-btn-label">{{ playLabel }}</span>
              </button>
              <button
                type="button"
                class="transport-btn"
                :disabled="!canPlay"
                title="Next frame"
                @click="stepFrame(1)"
              >
                <span class="transport-icon">⏭</span>
              </button>
            </div>
            <button
              type="button"
              class="transport-aux"
              :class="{ 'is-on': loop }"
              :aria-pressed="loop"
              title="Toggle loop"
              @click="loop = !loop"
            >
              <span class="transport-aux-led"></span>
              <span class="transport-aux-label">Loop</span>
            </button>
          </div>
          <div class="time-readout">
            <div class="time-readout-primary">
              <span class="time-current">{{ formatTime(currentTimeSeconds) }}</span>
              <span class="time-divider">/</span>
              <span class="time-total">{{ formatTime(durationSeconds) }}</span>
            </div>
            <div class="time-readout-meta">
              <span>Frame {{ currentFrame }} / {{ Math.max(0, frameCount - 1) }}</span>
              <span v-if="showPerfStats" class="time-readout-fps">
                · {{ fps.toFixed(2) }} fps
              </span>
            </div>
          </div>
        </div>
        <input
          type="range"
          class="timeline-slider"
          :style="{ '--progress': `${playProgressPercent}%` }"
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
    </section>

    <section class="midi-panel">
      <div class="midi-panel-inner">
      <header class="midi-panel-header">
        <div class="midi-panel-title">
          <span class="midi-panel-eyebrow">CH 01</span>
          <h2>Midi Mapping</h2>
        </div>
        <div class="midi-device-control">
          <select
            v-model="selectedMidiInput"
            :disabled="midiInputNames.length === 0"
            class="midi-device-select"
          >
            <option value="">— No input —</option>
            <option v-for="name in midiInputNames" :key="name" :value="name">
              {{ name }}
            </option>
          </select>
          <button
            type="button"
            class="midi-icon-button"
            title="Refresh MIDI inputs"
            @click="refreshMidiInputs"
          >
            ↻
          </button>
        </div>
      </header>

      <div
        class="midi-status-line"
        :class="{ 'is-active': !!selectedMidiInput && midiInputNames.length > 0 }"
      >
        <span class="midi-status-dot"></span>
        <span>{{ midiStatus }}</span>
      </div>

      <div class="midi-display">
        <div class="midi-display-cell">
          <div class="midi-display-label">
            <span>Latest Note</span>
            <span v-if="latestMidiChannel !== null" class="midi-display-chip">
              CH {{ latestMidiChannel }}
            </span>
          </div>
          <div
            class="midi-display-value"
            :class="{ 'is-empty': latestMidiNote === null }"
          >
            {{ latestMidiNote === null ? '— —' : formatMidiNote(latestMidiNote) }}
          </div>
          <div class="midi-display-meta">
            <span v-if="latestMidiVelocity !== null">vel {{ latestMidiVelocity }}</span>
            <span v-else>awaiting input</span>
          </div>
        </div>
        <div class="midi-display-cell">
          <div class="midi-display-label">Mapped To</div>
          <div
            class="midi-display-value"
            :class="{ 'is-empty': latestMidiMappedTime === null }"
          >
            {{ latestMidiMappedTime === null ? '—:——.———' : formatTime(latestMidiMappedTime) }}
          </div>
          <div class="midi-display-meta">
            {{ latestMidiMapping ? `frame ${latestMidiMapping.frame}` : 'no mapping' }}
          </div>
        </div>
      </div>

      <button
        type="button"
        class="midi-save-current"
        :disabled="latestMidiNote === null || !metadata"
        @click="saveCurrentTimeForLatestNote"
      >
        <span class="midi-save-current-icon">●</span>
        Save Current Time to Latest Note
      </button>

      <div class="midi-mappings">
        <div v-if="midiMappings.length > 0" class="midi-mappings-header">
          <span>Channel</span>
          <span>Note</span>
          <span>Time</span>
          <span></span>
        </div>
        <div
          class="midi-mapping-list"
          :class="{ 'is-empty': midiMappings.length === 0 }"
        >
          <div v-if="midiMappings.length === 0" class="midi-empty">
            No mappings — play a note, then hit Save
          </div>
          <div
            v-for="mapping in midiMappings"
            :key="mapping.id"
            class="midi-mapping-row"
            :class="{
              'is-active':
                latestMidiNote === mapping.note && latestMidiChannel === mapping.channel
            }"
          >
            <div class="midi-mapping-field">
              <span class="midi-mapping-prefix">CH</span>
              <input
                type="number"
                min="1"
                max="16"
                :value="mapping.channel"
                @change="handleMidiMappingChannelInput(mapping.id, $event)"
              />
            </div>
            <div class="midi-mapping-field">
              <input
                type="number"
                min="0"
                max="127"
                :value="mapping.note"
                @change="handleMidiMappingNoteInput(mapping.id, $event)"
              />
              <span class="midi-mapping-suffix">
                {{ formatMidiNote(mapping.note).split(' ')[1] }}
              </span>
            </div>
            <div class="midi-mapping-field">
              <input
                type="number"
                min="0"
                step="0.001"
                :max="durationSeconds"
                :value="frameToSeconds(mapping.frame).toFixed(3)"
                @change="handleMidiMappingTimeInput(mapping.id, $event)"
              />
              <span class="midi-mapping-suffix">s</span>
            </div>
            <div class="midi-mapping-actions">
              <button
                type="button"
                class="midi-action"
                @click="jumpToMidiMapping(mapping)"
              >
                Jump
              </button>
              <button
                type="button"
                class="midi-action"
                @click="saveCurrentTimeToMapping(mapping.id)"
              >
                Set
              </button>
              <button
                type="button"
                class="midi-action midi-action-danger"
                title="Remove mapping"
                @click="removeMidiMapping(mapping.id)"
              >
                ×
              </button>
            </div>
          </div>
        </div>
      </div>

      <footer class="midi-panel-footer">
        <button
          type="button"
          class="midi-add-button"
          @click="addMidiMapping"
        >
          <span class="midi-add-icon">+</span>
          Add Mapping
        </button>
        <div class="midi-current-time">
          <span class="midi-current-time-label">Playhead</span>
          <span class="midi-current-time-value">{{ formatTime(targetTimeSeconds) }}</span>
        </div>
      </footer>
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
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap');

.hap-page {
  --mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  --led: #ffb74d;
  --led-hi: #ffd28a;
  --led-glow: rgba(255, 183, 77, 0.45);
  --led-dim: #7a5828;
  --chassis-deep: #07090c;
  --chassis-row: #131a20;
  --chassis-row-hover: #181f25;
  --hairline: #1f262c;
  --hairline-strong: #2a3238;
  --text-primary: #e9eef3;
  --text-muted: #7e8b95;
  --text-faint: #4f5862;

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

/* === TIMELINE / TRANSPORT — tape deck ============================ */
.timeline {
  padding: 14px 18px 16px;
  border-top: 1px solid var(--hairline-strong);
  border-bottom: 1px solid var(--hairline-strong);
  background: linear-gradient(180deg, #181d22 0%, #14191e 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
}

.timeline-inner {
  display: grid;
  gap: 12px;
}

.timeline-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

/* ── Transport button group ─────────────── */
.transport-cluster {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.transport-controls {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px;
  background: var(--chassis-deep);
  border: 1px solid var(--hairline);
  border-radius: 5px;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.5);
}

.transport-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 32px;
  min-width: 38px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: var(--chassis-row);
  color: var(--text-muted);
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  cursor: pointer;
  transition: color 120ms, background 120ms, border-color 120ms, box-shadow 200ms;
}

.transport-btn:hover:not(:disabled) {
  color: var(--led);
  background: var(--chassis-row-hover);
  border-color: var(--hairline);
}

.transport-btn:active:not(:disabled) {
  transform: translateY(1px);
}

.transport-btn:disabled {
  opacity: 0.32;
  cursor: default;
}

.transport-btn-primary {
  min-width: 96px;
  padding: 0 16px;
  background: linear-gradient(180deg, rgba(255, 183, 77, 0.18), rgba(255, 183, 77, 0.06));
  border-color: var(--led-dim);
  color: var(--led);
  box-shadow:
    inset 0 1px 0 rgba(255, 183, 77, 0.2),
    inset 0 -1px 0 rgba(0, 0, 0, 0.3);
}

.transport-btn-primary:hover:not(:disabled) {
  color: var(--led-hi);
  background: linear-gradient(180deg, rgba(255, 183, 77, 0.3), rgba(255, 183, 77, 0.12));
  border-color: var(--led);
  box-shadow:
    inset 0 1px 0 rgba(255, 183, 77, 0.26),
    inset 0 -1px 0 rgba(0, 0, 0, 0.3),
    0 0 16px var(--led-glow);
}

.transport-btn-primary.is-playing {
  background: linear-gradient(180deg, rgba(255, 183, 77, 0.34), rgba(255, 183, 77, 0.16));
  color: var(--led-hi);
  box-shadow:
    inset 0 1px 0 rgba(255, 183, 77, 0.32),
    inset 0 -1px 0 rgba(0, 0, 0, 0.3),
    0 0 14px var(--led-glow);
}

.transport-icon {
  font-size: 12px;
  line-height: 1;
  text-shadow: 0 0 6px currentColor;
}

.transport-btn:not(.transport-btn-primary) .transport-icon {
  text-shadow: none;
}

.transport-btn-label {
  font-variant-caps: all-small-caps;
}

/* ── Aux toggle (loop) ──────────────────── */
.transport-aux {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 14px;
  border: 1px solid var(--hairline);
  border-radius: 4px;
  background: var(--chassis-deep);
  color: var(--text-muted);
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  cursor: pointer;
  transition: color 140ms, background 140ms, border-color 140ms, box-shadow 200ms;
}

.transport-aux:hover:not(:disabled) {
  color: var(--text-primary);
  border-color: var(--hairline-strong);
}

.transport-aux.is-on {
  color: var(--led);
  border-color: var(--led-dim);
  background: rgba(255, 183, 77, 0.08);
  box-shadow:
    inset 0 1px 0 rgba(255, 183, 77, 0.12),
    0 0 12px rgba(255, 183, 77, 0.15);
  text-shadow: 0 0 6px var(--led-glow);
}

.transport-aux.is-on:hover {
  background: rgba(255, 183, 77, 0.14);
  box-shadow:
    inset 0 1px 0 rgba(255, 183, 77, 0.18),
    0 0 16px rgba(255, 183, 77, 0.25);
}

.transport-aux-led {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-faint);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.5);
  flex-shrink: 0;
}

.transport-aux.is-on .transport-aux-led {
  background: var(--led);
  box-shadow:
    0 0 8px var(--led-glow),
    0 0 3px var(--led),
    inset 0 0 0 1px rgba(0, 0, 0, 0.2);
}

/* ── Time readout (tape deck timecode) ──── */
.time-readout {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  font-family: var(--mono);
}

.time-readout-primary {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
}

.time-current {
  color: var(--led);
  font-size: 20px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-shadow: 0 0 12px var(--led-glow);
  font-variant-numeric: tabular-nums;
}

.time-divider {
  color: var(--text-faint);
  font-size: 14px;
  font-weight: 300;
}

.time-total {
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.time-readout-meta {
  display: inline-flex;
  gap: 6px;
  color: var(--text-faint);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-variant-numeric: tabular-nums;
}

/* ── Scrub slider ───────────────────────── */
.timeline-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  min-width: 0;
  height: 22px;
  background: transparent;
  cursor: ew-resize;
  padding: 0;
  margin: 0;
}

.timeline-slider:focus {
  outline: none;
}

.timeline-slider::-webkit-slider-runnable-track {
  height: 8px;
  border: 1px solid var(--hairline);
  border-radius: 2px;
  background:
    linear-gradient(
      to right,
      rgba(255, 183, 77, 0.85) 0%,
      rgba(255, 183, 77, 0.85) var(--progress, 0%),
      var(--chassis-deep) var(--progress, 0%),
      var(--chassis-deep) 100%
    );
  box-shadow:
    inset 0 1px 2px rgba(0, 0, 0, 0.55),
    inset 0 0 0 1px rgba(0, 0, 0, 0.25);
}

.timeline-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 4px;
  height: 22px;
  background: var(--led-hi);
  border: 0;
  border-radius: 1px;
  margin-top: -8px;
  box-shadow:
    0 0 10px var(--led-glow),
    0 0 4px var(--led),
    inset 0 0 0 1px rgba(255, 255, 255, 0.2);
  cursor: ew-resize;
}

.timeline-slider:focus::-webkit-slider-thumb {
  box-shadow:
    0 0 16px var(--led-glow),
    0 0 6px var(--led),
    inset 0 0 0 1px rgba(255, 255, 255, 0.3);
}

.timeline-slider:disabled {
  cursor: default;
}

.timeline-slider:disabled::-webkit-slider-runnable-track {
  background: var(--chassis-deep);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.5);
}

.timeline-slider:disabled::-webkit-slider-thumb {
  background: var(--text-faint);
  box-shadow: none;
}

/* Firefox */
.timeline-slider::-moz-range-track {
  height: 8px;
  background: var(--chassis-deep);
  border: 1px solid var(--hairline);
  border-radius: 2px;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.55);
}

.timeline-slider::-moz-range-progress {
  height: 8px;
  background: rgba(255, 183, 77, 0.85);
  border-radius: 2px 0 0 2px;
}

.timeline-slider::-moz-range-thumb {
  width: 4px;
  height: 22px;
  background: var(--led-hi);
  border: 0;
  border-radius: 1px;
  box-shadow: 0 0 10px var(--led-glow), 0 0 4px var(--led);
}

.timeline-slider:disabled::-moz-range-progress {
  background: var(--chassis-deep);
}
.timeline-slider:disabled::-moz-range-thumb {
  background: var(--text-faint);
  box-shadow: none;
}

/* === MIDI MAPPING PANEL — vintage hardware sampler ============== */
.midi-panel {
  padding: 18px 18px 16px;
  background:
    linear-gradient(180deg, #181d22 0%, #12171b 60%, #0f1418 100%);
  border-bottom: 1px solid var(--hairline-strong);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.035);
  position: relative;
}

.midi-panel-inner {
  display: grid;
  gap: 14px;
  max-width: 880px;
  margin: 0 auto;
}

.midi-panel::before {
  content: '';
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: min(840px, calc(100% - 48px));
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 183, 77, 0.28) 50%,
    transparent 100%
  );
  pointer-events: none;
}

/* ── Header ─────────────────────────────── */
.midi-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.midi-panel-title {
  display: inline-flex;
  align-items: baseline;
  gap: 12px;
}

.midi-panel-eyebrow {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 7px;
  color: var(--led);
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  border: 1px solid var(--led-dim);
  border-radius: 2px;
  background: rgba(255, 183, 77, 0.05);
  text-shadow: 0 0 6px var(--led-glow);
}

.midi-panel-title h2 {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: var(--text-primary);
}

.midi-device-control {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.midi-device-select {
  height: 28px;
  min-width: 200px;
  padding: 0 28px 0 10px;
  background-color: var(--chassis-deep);
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6' fill='%237e8b95'><path d='M0 0l5 6 5-6z'/></svg>");
  background-repeat: no-repeat;
  background-position: right 10px center;
  border: 1px solid var(--hairline);
  border-radius: 3px;
  color: var(--text-primary);
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.04em;
  appearance: none;
  cursor: pointer;
}

.midi-device-select:focus {
  outline: none;
  border-color: var(--led-dim);
  box-shadow: 0 0 0 1px var(--led-dim);
}

.midi-device-select:disabled {
  opacity: 0.45;
  cursor: default;
}

.midi-icon-button {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--hairline);
  border-radius: 3px;
  background: var(--chassis-deep);
  color: var(--text-muted);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  transition: color 140ms ease, border-color 140ms ease;
}

.midi-icon-button:hover {
  color: var(--led);
  border-color: var(--led-dim);
}

/* ── Status line ────────────────────────── */
.midi-status-line {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}

.midi-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-faint);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.4);
  flex-shrink: 0;
}

.midi-status-line.is-active .midi-status-dot {
  background: var(--led);
  box-shadow: 0 0 8px var(--led-glow), inset 0 0 0 1px rgba(0, 0, 0, 0.2);
  animation: midi-pulse 2.4s ease-in-out infinite;
}

@keyframes midi-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}

/* ── LED Display window ─────────────────── */
.midi-display {
  display: grid;
  grid-template-columns: 1fr 1fr;
  background:
    radial-gradient(120% 100% at 50% 0%, rgba(255, 183, 77, 0.035), transparent 60%),
    radial-gradient(ellipse at center, #0a0e12 0%, #06080a 100%);
  border: 1px solid #161c22;
  border-radius: 5px;
  box-shadow:
    inset 0 2px 6px rgba(0, 0, 0, 0.65),
    inset 0 0 0 1px rgba(0, 0, 0, 0.4),
    0 1px 0 rgba(255, 255, 255, 0.04);
  overflow: hidden;
  position: relative;
}

.midi-display::after {
  content: '';
  position: absolute;
  inset: 0;
  background-image: repeating-linear-gradient(
    0deg,
    transparent 0px,
    transparent 2px,
    rgba(255, 183, 77, 0.02) 2px,
    rgba(255, 183, 77, 0.02) 3px
  );
  pointer-events: none;
}

.midi-display-cell {
  display: grid;
  align-content: start;
  gap: 6px;
  padding: 14px 18px 12px;
  position: relative;
  z-index: 1;
}

.midi-display-cell + .midi-display-cell {
  border-left: 1px solid #161c22;
  box-shadow: inset 1px 0 0 rgba(255, 255, 255, 0.02);
}

.midi-display-label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-faint);
  font-family: var(--mono);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.22em;
  text-transform: uppercase;
}

.midi-display-chip {
  display: inline-flex;
  align-items: center;
  height: 16px;
  padding: 0 6px;
  margin-left: auto;
  color: var(--led);
  font-family: var(--mono);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.18em;
  border: 1px solid var(--led-dim);
  border-radius: 2px;
  background: rgba(255, 183, 77, 0.07);
  text-shadow: 0 0 4px var(--led-glow);
}

.midi-display-value {
  color: var(--led);
  font-family: var(--mono);
  font-size: 22px;
  font-weight: 500;
  letter-spacing: 0.04em;
  text-shadow: 0 0 14px var(--led-glow);
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.midi-display-value.is-empty {
  color: var(--led-dim);
  text-shadow: none;
}

.midi-display-meta {
  color: var(--text-faint);
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

/* ── Save current time (prominent action) ── */
.midi-save-current {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 32px;
  padding: 0 16px;
  border: 1px solid var(--led-dim);
  border-radius: 3px;
  background:
    linear-gradient(180deg, rgba(255, 183, 77, 0.16), rgba(255, 183, 77, 0.06));
  color: var(--led);
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  cursor: pointer;
  box-shadow:
    inset 0 1px 0 rgba(255, 183, 77, 0.18),
    inset 0 -1px 0 rgba(0, 0, 0, 0.3);
  transition: background 140ms, box-shadow 200ms;
  justify-self: start;
}

.midi-save-current:hover:not(:disabled) {
  background:
    linear-gradient(180deg, rgba(255, 183, 77, 0.3), rgba(255, 183, 77, 0.12));
  box-shadow:
    inset 0 1px 0 rgba(255, 183, 77, 0.26),
    inset 0 -1px 0 rgba(0, 0, 0, 0.3),
    0 0 18px var(--led-glow);
}

.midi-save-current:disabled {
  opacity: 0.32;
  cursor: default;
}

.midi-save-current-icon {
  font-size: 9px;
  line-height: 1;
  color: var(--led);
  text-shadow: 0 0 6px var(--led-glow);
}

/* ── Mappings (channel strip table) ─────── */
.midi-mappings {
  display: grid;
  gap: 6px;
}

.midi-mappings-header {
  display: grid;
  grid-template-columns: 90px 130px 130px 1fr;
  gap: 10px;
  padding: 0 12px;
  color: var(--text-faint);
  font-family: var(--mono);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.22em;
  text-transform: uppercase;
}

.midi-mapping-list {
  display: grid;
  gap: 2px;
  max-height: 200px;
  overflow-y: auto;
  background: var(--chassis-deep);
  border: 1px solid var(--hairline);
  border-radius: 4px;
  padding: 3px;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.4);
}

.midi-mapping-list.is-empty {
  display: grid;
  place-items: center;
  min-height: 56px;
  max-width: 360px;
  padding: 14px 18px;
  justify-self: start;
  background: transparent;
  border-style: dashed;
  border-color: var(--hairline);
  box-shadow: none;
}

.midi-mapping-list::-webkit-scrollbar {
  width: 8px;
}

.midi-mapping-list::-webkit-scrollbar-track {
  background: transparent;
}

.midi-mapping-list::-webkit-scrollbar-thumb {
  background: var(--hairline-strong);
  border-radius: 4px;
}

.midi-empty {
  color: var(--text-faint);
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  text-align: center;
}

.midi-mapping-row {
  display: grid;
  grid-template-columns: 90px 130px 130px 1fr;
  align-items: center;
  gap: 10px;
  padding: 6px 9px;
  background: var(--chassis-row);
  border-radius: 3px;
  position: relative;
  transition: background 120ms ease, box-shadow 120ms ease;
}

.midi-mapping-row:hover {
  background: var(--chassis-row-hover);
}

.midi-mapping-row.is-active {
  background: rgba(255, 183, 77, 0.08);
  box-shadow: inset 2px 0 0 var(--led);
}

.midi-mapping-row.is-active .midi-mapping-field {
  border-color: var(--led-dim);
}

.midi-mapping-row.is-active .midi-mapping-field input {
  color: var(--led-hi);
  text-shadow: 0 0 8px var(--led-glow);
}

.midi-mapping-field {
  display: inline-flex;
  align-items: stretch;
  height: 28px;
  background: var(--chassis-deep);
  border: 1px solid var(--hairline);
  border-radius: 3px;
  overflow: hidden;
}

.midi-mapping-field:focus-within {
  border-color: var(--led-dim);
  box-shadow: 0 0 0 1px var(--led-dim);
}

.midi-mapping-field input {
  flex: 1;
  min-width: 0;
  width: 100%;
  height: 100%;
  padding: 0 8px;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  font-family: var(--mono);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.midi-mapping-field input:focus {
  outline: none;
}

.midi-mapping-field input::-webkit-outer-spin-button,
.midi-mapping-field input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.midi-mapping-field input[type='number'] {
  -moz-appearance: textfield;
  appearance: textfield;
}

.midi-mapping-suffix,
.midi-mapping-prefix {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 30px;
  padding: 0 8px;
  color: var(--text-muted);
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  background: rgba(0, 0, 0, 0.28);
}

.midi-mapping-suffix {
  border-left: 1px solid var(--hairline);
}

.midi-mapping-prefix {
  border-right: 1px solid var(--hairline);
}

.midi-mapping-actions {
  display: inline-flex;
  gap: 4px;
  justify-content: flex-end;
}

.midi-action {
  height: 26px;
  padding: 0 11px;
  border: 1px solid var(--hairline);
  border-radius: 3px;
  background: transparent;
  color: var(--text-muted);
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  cursor: pointer;
  transition: color 120ms, border-color 120ms, background 120ms;
}

.midi-action:hover {
  color: var(--led);
  border-color: var(--led-dim);
  background: rgba(255, 183, 77, 0.05);
}

.midi-action-danger {
  width: 26px;
  padding: 0;
  font-size: 16px;
  letter-spacing: 0;
}

.midi-action-danger:hover {
  color: #ff7770;
  border-color: #8a3835;
  background: rgba(255, 119, 112, 0.07);
}

/* ── Footer ─────────────────────────────── */
.midi-panel-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.midi-add-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 14px;
  border: 1px dashed var(--hairline-strong);
  border-radius: 3px;
  background: transparent;
  color: var(--text-primary);
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  cursor: pointer;
  transition: color 140ms, border-color 140ms, background 140ms;
}

.midi-add-button:hover:not(:disabled) {
  color: var(--led);
  border-color: var(--led-dim);
  border-style: solid;
  background: rgba(255, 183, 77, 0.04);
}

.midi-add-button:disabled {
  opacity: 0.4;
  cursor: default;
}

.midi-add-icon {
  font-size: 16px;
  line-height: 1;
  font-weight: 400;
}

.midi-current-time {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  font-family: var(--mono);
}

.midi-current-time-label {
  color: var(--text-faint);
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.22em;
  text-transform: uppercase;
}

.midi-current-time-value {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.06em;
  font-variant-numeric: tabular-nums;
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

  .timeline-top {
    flex-direction: column;
    align-items: stretch;
  }

  .time-readout {
    align-items: flex-start;
  }

  .transport-controls {
    justify-content: flex-start;
  }

  .midi-panel {
    padding: 14px;
  }

  .midi-display {
    grid-template-columns: 1fr;
  }

  .midi-display-cell + .midi-display-cell {
    border-left: 0;
    border-top: 1px solid #161c22;
  }

  .midi-device-select {
    min-width: 0;
    flex: 1;
  }

  .midi-mappings-header {
    display: none;
  }

  .midi-mapping-row {
    grid-template-columns: 90px 1fr 1fr;
    grid-template-areas:
      'ch note time'
      'actions actions actions';
    gap: 8px;
  }

  .midi-mapping-row .midi-mapping-field:nth-of-type(1) { grid-area: ch; }
  .midi-mapping-row .midi-mapping-field:nth-of-type(2) { grid-area: note; }
  .midi-mapping-row .midi-mapping-field:nth-of-type(3) { grid-area: time; }
  .midi-mapping-actions { grid-area: actions; justify-content: flex-start; }

  .details {
    grid-template-columns: 1fr;
  }
}
</style>
