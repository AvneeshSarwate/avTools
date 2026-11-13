import { decodeHapYFrameInto, expectedBc3ByteLength } from '../hap/decoder'
import type { FrameIndexEntry, HapPackMetadata } from '../happack/types'

type FileSourceMessage = {
  kind: 'file'
  file: File
}

type OpfsSourceMessage = {
  kind: 'opfs'
  directoryName: string
  fileName: string
  size: number
}

type SourceMessage = FileSourceMessage | OpfsSourceMessage

type InitMessage = {
  type: 'init'
  source: SourceMessage
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

type ReleaseFrameBufferMessage = {
  type: 'releaseFrameBuffer'
  buffer: ArrayBuffer
}

type DisposeMessage = {
  type: 'dispose'
}

type WorkerInput =
  | InitMessage
  | DecodeFrameMessage
  | CancelBeforeMessage
  | ReleaseFrameBufferMessage
  | DisposeMessage

type SyncAccessHandle = {
  read(buffer: Uint8Array, options?: { at?: number }): number
  close(): void
}

type SyncFileSystemFileHandle = FileSystemFileHandle & {
  createSyncAccessHandle(): Promise<SyncAccessHandle>
}

const MAX_DECODED_BUFFER_POOL_SIZE = 4
const MAX_ENCODED_BUFFER_POOL_SIZE = 4
const MAX_RETAINED_ENCODED_BUFFER_BYTES = 128 * 1024 * 1024

let fileSource: File | undefined
let opfsAccessHandle: SyncAccessHandle | undefined
let opfsSourceSize = 0
let metadata: HapPackMetadata | undefined
let index: FrameIndexEntry[] = []
let activeGeneration = 0
let expectedDecodedLength = 0
let decodedBufferPool: ArrayBuffer[] = []
let encodedBufferPool: ArrayBuffer[] = []
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerInput>) => void | Promise<void>) | null
  postMessage(message: unknown, transfer?: Transferable[]): void
}

function closeOpfsAccessHandle() {
  if (!opfsAccessHandle) return
  try {
    opfsAccessHandle.close()
  } finally {
    opfsAccessHandle = undefined
    opfsSourceSize = 0
  }
}

async function initializeSource(source: SourceMessage) {
  closeOpfsAccessHandle()
  fileSource = undefined
  encodedBufferPool = []

  if (source.kind === 'file') {
    fileSource = source.file
    return
  }

  const root = await navigator.storage.getDirectory()
  const directory = await root.getDirectoryHandle(source.directoryName)
  const handle = (await directory.getFileHandle(source.fileName)) as SyncFileSystemFileHandle
  opfsAccessHandle = await handle.createSyncAccessHandle()
  opfsSourceSize = source.size
}

function disposeSource() {
  closeOpfsAccessHandle()
  fileSource = undefined
  encodedBufferPool = []
}

function checkoutEncodedBuffer(byteLength: number): ArrayBuffer {
  const index = encodedBufferPool.findIndex((buffer) => buffer.byteLength >= byteLength)
  if (index >= 0) {
    const [buffer] = encodedBufferPool.splice(index, 1)
    return buffer
  }
  return new ArrayBuffer(byteLength)
}

function releaseEncodedBuffer(buffer: ArrayBuffer) {
  if (
    buffer.byteLength > 0 &&
    buffer.byteLength <= MAX_RETAINED_ENCODED_BUFFER_BYTES &&
    encodedBufferPool.length < MAX_ENCODED_BUFFER_POOL_SIZE
  ) {
    encodedBufferPool.push(buffer)
  }
}

type FrameRead = {
  bytes: Uint8Array
  release(): void
}

function readFromOpfsInto(accessHandle: SyncAccessHandle, entry: FrameIndexEntry): FrameRead {
  if (entry.offset + entry.byteLength > opfsSourceSize) {
    throw new Error('Frame payload range is outside OPFS source bounds.')
  }

  const buffer = checkoutEncodedBuffer(entry.byteLength)
  const bytes = new Uint8Array(buffer, 0, entry.byteLength)
  let offset = 0
  while (offset < bytes.byteLength) {
    const bytesRead = accessHandle.read(bytes.subarray(offset), { at: entry.offset + offset })
    if (bytesRead <= 0) {
      releaseEncodedBuffer(buffer)
      throw new Error(`Unexpected EOF while reading frame at offset ${entry.offset}.`)
    }
    offset += bytesRead
  }

  return {
    bytes,
    release: () => releaseEncodedBuffer(buffer)
  }
}

async function readFrame(frameNumber: number): Promise<FrameRead> {
  if (!fileSource && !opfsAccessHandle) throw new Error('Worker is not initialized.')
  const entry = index[frameNumber]
  if (!entry) throw new Error(`Frame ${frameNumber} is outside the index.`)

  if (opfsAccessHandle) return readFromOpfsInto(opfsAccessHandle, entry)

  if (!fileSource) throw new Error('Worker is not initialized.')
  const buffer = await fileSource.slice(entry.offset, entry.offset + entry.byteLength).arrayBuffer()
  return {
    bytes: new Uint8Array(buffer),
    release: () => undefined
  }
}

function checkoutDecodedBuffer(): ArrayBuffer {
  const buffer = decodedBufferPool.pop()
  if (buffer && buffer.byteLength === expectedDecodedLength) return buffer
  return new ArrayBuffer(expectedDecodedLength)
}

function releaseDecodedBuffer(buffer: ArrayBuffer) {
  if (
    expectedDecodedLength > 0 &&
    buffer.byteLength === expectedDecodedLength &&
    decodedBufferPool.length < MAX_DECODED_BUFFER_POOL_SIZE
  ) {
    decodedBufferPool.push(buffer)
  }
}

ctx.onmessage = async (event: MessageEvent<WorkerInput>) => {
  const message = event.data
  try {
    if (message.type === 'init') {
      await initializeSource(message.source)
      metadata = message.metadata
      index = message.index
      expectedDecodedLength = expectedBc3ByteLength(message.metadata.width, message.metadata.height)
      decodedBufferPool = []
      activeGeneration = 1
      ctx.postMessage({ type: 'ready' })
      return
    }

    if (message.type === 'cancelBefore') {
      activeGeneration = Math.max(activeGeneration, message.generation)
      return
    }

    if (message.type === 'releaseFrameBuffer') {
      releaseDecodedBuffer(message.buffer)
      return
    }

    if (message.type === 'dispose') {
      activeGeneration += 1
      metadata = undefined
      index = []
      expectedDecodedLength = 0
      decodedBufferPool = []
      disposeSource()
      ctx.postMessage({ type: 'disposed' })
      return
    }

    if (message.type === 'decodeFrame') {
      if (!metadata) throw new Error('Worker is not initialized.')
      if (message.generation < activeGeneration) return

      const readStart = performance.now()
      const frameRead = await readFrame(message.frameNumber)
      const readMs = performance.now() - readStart
      try {
        if (message.generation < activeGeneration) return

        const decodeStart = performance.now()
        const decodeInfo = metadata.decodeIndex[message.frameNumber]
        if (!decodeInfo) throw new Error(`Frame ${message.frameNumber} is missing decode metadata.`)
        const outputBuffer = checkoutDecodedBuffer()
        let bcBytes: Uint8Array
        try {
          bcBytes = decodeHapYFrameInto(frameRead.bytes, decodeInfo, new Uint8Array(outputBuffer))
        } catch (decodeError) {
          releaseDecodedBuffer(outputBuffer)
          throw decodeError
        }
        const decodeMs = performance.now() - decodeStart
        if (message.generation < activeGeneration) {
          releaseDecodedBuffer(outputBuffer)
          return
        }
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
            decodeMs
          },
          [transferBytes.buffer]
        )
      } finally {
        frameRead.release()
      }
    }
  } catch (error) {
    const requestId = message.type === 'decodeFrame' ? message.requestId : undefined
    ctx.postMessage({
      type: 'error',
      requestId,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

export {}
