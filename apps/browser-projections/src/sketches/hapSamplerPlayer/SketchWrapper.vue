<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { createHapDevice, HapWebGpuRenderer } from '@/hapSampler/gpu/renderer'
import { HapPackReader } from '@/hapSampler/happack/reader'
import type { FrameIndexEntry, HapPackMetadata } from '@/hapSampler/happack/types'
import { PlaybackClock } from '@/hapSampler/playback/clock'

type WorkerReadyMessage = { type: 'ready' }
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
type WorkerOutput = WorkerReadyMessage | WorkerDecodedMessage | WorkerErrorMessage

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

let reader: HapPackReader | null = null
let device: GPUDevice | null = null
let renderer: HapWebGpuRenderer | null = null
let worker: Worker | null = null
let clock: PlaybackClock | null = null
let rafId = 0
let requestId = 1
let generation = 1
let requestedFrame: number | null = null
let pendingRequestCount = 0
let frameCounter = 0
let fpsWindowStart = performance.now()
let pendingSeekFrame: number | null = null
let seekDebounceTimer: number | undefined

const frameCount = computed(() => metadata.value?.frameCount ?? 0)
const durationSeconds = computed(() => (metadata.value ? metadata.value.durationUs / 1_000_000 : 0))
const fps = computed(() => {
  if (!metadata.value) return 0
  if (metadata.value.frameRateDenominator > 0 && metadata.value.frameRateNumerator > 0) {
    return metadata.value.frameRateNumerator / metadata.value.frameRateDenominator
  }
  return metadata.value.frameCount / Math.max(0.001, durationSeconds.value)
})
const canPlay = computed(() => !!metadata.value && !error.value)
const playLabel = computed(() => (playing.value ? 'Pause' : 'Play'))

watch(loop, (value) => {
  clock?.setLoop(value)
})

function resetPlaybackState() {
  clearScheduledSeek()
  reader = null
  renderer?.destroy()
  renderer = null
  worker?.terminate()
  worker = null
  clock = null
  metadata.value = null
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
  if (!worker || !metadata.value) return
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
    frameNumber: clamped,
  })
}

function handleWorkerMessage(event: MessageEvent<WorkerOutput>) {
  const message = event.data
  if (message.type === 'ready') {
    status.value = 'Decoder worker ready.'
    return
  }
  if (message.type === 'error') {
    error.value = message.error
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

function tick(now: number) {
  rafId = requestAnimationFrame(tick)
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

  cancelAnimationFrame(rafId)
  resetPlaybackState()
  fileName.value = file.name
  error.value = ''
  status.value = 'Opening happack...'

  try {
    const opened = await HapPackReader.open(file)
    reader = opened
    metadata.value = opened.metadata

    await nextTick()
    const canvas = canvasRef.value
    if (!canvas) throw new Error('Canvas is not mounted.')

    renderer = new HapWebGpuRenderer(
      canvas,
      await ensureDevice(),
      opened.metadata.width,
      opened.metadata.height,
    )
    renderer.resize()

    worker = new Worker(new URL('../../hapSampler/workers/decode.worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = handleWorkerMessage
    worker.postMessage({
      type: 'init',
      file,
      metadata: opened.metadata,
      index: opened.index,
    } satisfies {
      type: 'init'
      file: File
      metadata: HapPackMetadata
      index: FrameIndexEntry[]
    })

    clock = new PlaybackClock(fps.value, opened.metadata.frameCount, loop.value)
    requestExactFrame(0)
    rafId = requestAnimationFrame(tick)
    status.value = 'Happack loaded.'
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught)
    status.value = 'Load failed.'
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

function resizeRenderer() {
  renderer?.resize()
}

window.addEventListener('resize', resizeRenderer)

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId)
  window.removeEventListener('resize', resizeRenderer)
  clearScheduledSeek()
  resetPlaybackState()
})
</script>

<template>
  <main class="hap-page">
    <section class="toolbar">
      <label class="file-button">
        <input type="file" accept=".happack" @change="handleFileChange" />
        Select .happack
      </label>
      <button type="button" :disabled="!canPlay" @click="togglePlayback">{{ playLabel }}</button>
      <button type="button" :disabled="!canPlay" @click="stepFrame(-1)">Prev</button>
      <button type="button" :disabled="!canPlay" @click="stepFrame(1)">Next</button>
      <label class="loop-toggle">
        <input v-model="loop" type="checkbox" />
        Loop
      </label>
      <span class="status" :class="{ bad: !!error }">{{ error || status }}</span>
    </section>

    <section class="viewer">
      <canvas ref="canvasRef" class="hap-canvas"></canvas>
      <div v-if="!metadata" class="empty-state">
        <div class="empty-title">HAP Q WebGPU Sampler</div>
        <div class="empty-subtitle">Load a packaged HapY file to decode frames in a worker.</div>
      </div>
    </section>

    <section class="timeline">
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
      <div class="time-readout">
        <span>Frame {{ currentFrame }} / {{ Math.max(0, frameCount - 1) }}</span>
        <span>{{ fps.toFixed(2) }} fps</span>
      </div>
    </section>

    <section class="details">
      <div class="detail-block">
        <h2>Source</h2>
        <dl>
          <div><dt>File</dt><dd>{{ fileName || 'none' }}</dd></div>
          <div><dt>Codec</dt><dd>{{ metadata?.codec ?? '-' }}</dd></div>
          <div><dt>Compressor</dt><dd>{{ metadata?.compressor ?? '-' }}</dd></div>
          <div><dt>Format</dt><dd>{{ metadata?.gpuFormat ?? '-' }}</dd></div>
          <div><dt>Size</dt><dd>{{ metadata ? `${metadata.width} x ${metadata.height}` : '-' }}</dd></div>
          <div><dt>Duration</dt><dd>{{ durationSeconds.toFixed(2) }}s</dd></div>
        </dl>
      </div>
      <div class="detail-block">
        <h2>Runtime</h2>
        <dl>
          <div><dt>Target</dt><dd>{{ targetFrame }}</dd></div>
          <div><dt>Uploaded</dt><dd>{{ uploadedFrame ?? '-' }}</dd></div>
          <div><dt>In flight</dt><dd>{{ inFlight }}</dd></div>
          <div><dt>Display</dt><dd>{{ averageFps.toFixed(1) }} fps</dd></div>
        </dl>
      </div>
      <div class="detail-block">
        <h2>Timing</h2>
        <dl>
          <div><dt>Read</dt><dd>{{ readMs.toFixed(2) }} ms</dd></div>
          <div><dt>Decode</dt><dd>{{ decodeMs.toFixed(2) }} ms</dd></div>
          <div><dt>Upload</dt><dd>{{ uploadMs.toFixed(2) }} ms</dd></div>
          <div><dt>Stale</dt><dd>{{ staleFrames }}</dd></div>
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
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
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

.loop-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #c7d0d8;
  font-size: 13px;
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
  height: min(68vh, calc(100vh - 240px));
  min-height: 360px;
  background: #050607;
}

.hap-canvas {
  width: 100%;
  height: 100%;
  display: block;
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

.timeline input[type='range'] {
  width: 100%;
}

.time-readout {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  color: #aeb9c2;
  font-size: 12px;
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
    height: 52vh;
  }

  .details {
    grid-template-columns: 1fr;
  }
}
</style>
