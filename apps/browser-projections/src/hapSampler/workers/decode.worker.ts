import { decodeHapYFrame } from '../hap/decoder'
import type { FrameIndexEntry, HapPackMetadata } from '../happack/types'

type InitMessage = {
  type: 'init'
  file: File
  metadata: HapPackMetadata
  index: FrameIndexEntry[]
}

type DecodeFrameMessage = {
  type: 'decodeFrame'
  requestId: number
  generation: number
  frameNumber: number
}

type CancelBeforeMessage = {
  type: 'cancelBefore'
  generation: number
}

type WorkerInput = InitMessage | DecodeFrameMessage | CancelBeforeMessage

let file: File | undefined
let metadata: HapPackMetadata | undefined
let index: FrameIndexEntry[] = []
let activeGeneration = 0
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerInput>) => void | Promise<void>) | null
  postMessage(message: unknown, transfer?: Transferable[]): void
}

async function readFrame(frameNumber: number): Promise<ArrayBuffer> {
  if (!file) throw new Error('Worker is not initialized.')
  const entry = index[frameNumber]
  if (!entry) throw new Error(`Frame ${frameNumber} is outside the index.`)
  return await file.slice(entry.offset, entry.offset + entry.byteLength).arrayBuffer()
}

ctx.onmessage = async (event: MessageEvent<WorkerInput>) => {
  const message = event.data
  try {
    if (message.type === 'init') {
      file = message.file
      metadata = message.metadata
      index = message.index
      activeGeneration = 1
      ctx.postMessage({ type: 'ready' })
      return
    }

    if (message.type === 'cancelBefore') {
      activeGeneration = Math.max(activeGeneration, message.generation)
      return
    }

    if (message.type === 'decodeFrame') {
      if (!metadata) throw new Error('Worker is not initialized.')
      if (message.generation < activeGeneration) return

      const readStart = performance.now()
      const encoded = new Uint8Array(await readFrame(message.frameNumber))
      const readMs = performance.now() - readStart
      if (message.generation < activeGeneration) return

      const decodeStart = performance.now()
      const bcBytes = decodeHapYFrame(
        encoded,
        metadata.width,
        metadata.height,
        metadata.compressor,
      )
      const decodeMs = performance.now() - decodeStart
      if (message.generation < activeGeneration) return
      const transferBytes =
        bcBytes.byteOffset === 0 && bcBytes.byteLength === bcBytes.buffer.byteLength
          ? bcBytes
          : bcBytes.slice()

      ctx.postMessage(
        {
          type: 'decodedFrame',
          requestId: message.requestId,
          generation: message.generation,
          frameNumber: message.frameNumber,
          buffer: transferBytes.buffer,
          readMs,
          decodeMs,
        },
        [transferBytes.buffer],
      )
    }
  } catch (error) {
    const requestId = message.type === 'decodeFrame' ? message.requestId : undefined
    ctx.postMessage({
      type: 'error',
      requestId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export {}
