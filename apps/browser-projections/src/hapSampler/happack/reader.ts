import {
  HAPPACK_HEADER_SIZE,
  HAPPACK_INDEX_ENTRY_SIZE,
  HAPPACK_MAGIC,
  type FrameDecodeInfo,
  type FrameIndexEntry,
  type HapChunkDecodeInfo,
  type HapPackHeader,
  type HapPackMetadata
} from './types'
import { FileByteSource, type ByteSource } from '../io/byteSource'

const decoder = new TextDecoder()

function u64(view: DataView, offset: number): number {
  const value = view.getBigUint64(offset, true)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Happack file is too large for browser number offsets.')
  }
  return Number(value)
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function expectedBc3ByteLength(width: number, height: number): number {
  return Math.ceil(width / 4) * Math.ceil(height / 4) * 16
}

function parseHeader(buffer: ArrayBuffer): HapPackHeader {
  if (buffer.byteLength < HAPPACK_HEADER_SIZE) {
    throw new Error('File is too small to contain a happack header.')
  }

  const view = new DataView(buffer)
  const magic = decoder.decode(new Uint8Array(buffer, 0, 8))
  if (magic !== HAPPACK_MAGIC) {
    throw new Error('Invalid happack magic. Expected HAPPACK\\0.')
  }

  const header: HapPackHeader = {
    version: view.getUint32(8, true),
    headerSize: view.getUint32(12, true),
    metadataOffset: u64(view, 16),
    metadataLength: u64(view, 24),
    indexOffset: u64(view, 32),
    indexEntryCount: u64(view, 40),
    indexEntrySize: view.getUint32(48, true)
  }

  if (header.version !== 2) throw new Error(`Unsupported happack version ${header.version}.`)
  if (header.headerSize !== HAPPACK_HEADER_SIZE) {
    throw new Error(`Unsupported happack header size ${header.headerSize}.`)
  }
  if (header.metadataOffset !== HAPPACK_HEADER_SIZE) {
    throw new Error('Unexpected metadata offset in happack header.')
  }
  if (header.indexEntrySize !== HAPPACK_INDEX_ENTRY_SIZE) {
    throw new Error(`Unsupported index entry size ${header.indexEntrySize}.`)
  }

  return header
}

function assertMetadata(value: unknown): asserts value is HapPackMetadata {
  const metadata = value as Partial<HapPackMetadata>
  if (metadata.version !== 2) throw new Error('Happack metadata version must be 2.')
  if (metadata.codec !== 'HapY') throw new Error('Only HapY / Hap Q happacks are supported.')
  if (metadata.hapFlavor !== 'hap_q') throw new Error('Only hap_q happacks are supported.')
  if (metadata.gpuFormat !== 'bc3-rgba-unorm')
    throw new Error('Only BC3 RGBA happacks are supported.')
  if (metadata.colorModel !== 'scaled-ycocg')
    throw new Error('Only Scaled YCoCg happacks are supported.')
  if (metadata.hasAudio !== false) throw new Error('Audio tracks are not supported.')
  if (metadata.compressor !== 'snappy' && metadata.compressor !== 'none') {
    throw new Error('Only Snappy or uncompressed HAP happacks are supported.')
  }
  if (
    typeof metadata.width !== 'number' ||
    !Number.isFinite(metadata.width) ||
    metadata.width <= 0
  ) {
    throw new Error('Invalid width.')
  }
  if (
    typeof metadata.height !== 'number' ||
    !Number.isFinite(metadata.height) ||
    metadata.height <= 0
  ) {
    throw new Error('Invalid height.')
  }
  if (
    typeof metadata.frameCount !== 'number' ||
    !Number.isInteger(metadata.frameCount) ||
    metadata.frameCount <= 0
  ) {
    throw new Error('Invalid frame count.')
  }
  if (
    typeof metadata.durationUs !== 'number' ||
    !Number.isFinite(metadata.durationUs) ||
    metadata.durationUs <= 0
  ) {
    throw new Error('Invalid duration.')
  }
  if (!Array.isArray(metadata.decodeIndex)) {
    throw new Error('Happack metadata is missing a frame decode index.')
  }
  if (metadata.decodeIndex.length !== metadata.frameCount) {
    throw new Error('Happack decode index length does not match frame count.')
  }

  const decodedLength = expectedBc3ByteLength(metadata.width, metadata.height)
  for (const [frameNumber, frameInfo] of metadata.decodeIndex.entries()) {
    assertFrameDecodeInfo(frameInfo, frameNumber, decodedLength)
  }
}

function assertFrameDecodeInfo(
  value: unknown,
  frameNumber: number,
  decodedLength: number
): asserts value is FrameDecodeInfo {
  const info = value as Partial<FrameDecodeInfo>
  if (
    info.hapSectionType !== 0xaf &&
    info.hapSectionType !== 0xbf &&
    info.hapSectionType !== 0xcf
  ) {
    throw new Error(`Frame ${frameNumber} has an unsupported HAP section type.`)
  }
  if (!Array.isArray(info.chunks) || info.chunks.length === 0) {
    throw new Error(`Frame ${frameNumber} has no decode chunks.`)
  }

  let decodedOffset = 0
  for (const [chunkNumber, chunk] of info.chunks.entries()) {
    assertChunkDecodeInfo(chunk, frameNumber, chunkNumber)
    if (chunk.decodedOffsetInBc3Frame !== decodedOffset) {
      throw new Error(`Frame ${frameNumber} chunk ${chunkNumber} decoded offset is not contiguous.`)
    }
    decodedOffset += chunk.decodedByteLength
  }
  if (decodedOffset !== decodedLength) {
    throw new Error(`Frame ${frameNumber} decoded byte length does not match image dimensions.`)
  }
}

function assertChunkDecodeInfo(
  value: unknown,
  frameNumber: number,
  chunkNumber: number
): asserts value is HapChunkDecodeInfo {
  const chunk = value as Partial<HapChunkDecodeInfo>
  if (chunk.compressor !== 'snappy' && chunk.compressor !== 'none') {
    throw new Error(`Frame ${frameNumber} chunk ${chunkNumber} has an unsupported compressor.`)
  }
  if (!isNonNegativeInteger(chunk.payloadOffsetInFrame)) {
    throw new Error(`Frame ${frameNumber} chunk ${chunkNumber} has an invalid payload offset.`)
  }
  if (!isPositiveInteger(chunk.compressedByteLength)) {
    throw new Error(`Frame ${frameNumber} chunk ${chunkNumber} has an invalid compressed length.`)
  }
  if (!isPositiveInteger(chunk.decodedByteLength)) {
    throw new Error(`Frame ${frameNumber} chunk ${chunkNumber} has an invalid decoded length.`)
  }
  if (!isNonNegativeInteger(chunk.decodedOffsetInBc3Frame)) {
    throw new Error(`Frame ${frameNumber} chunk ${chunkNumber} has an invalid decoded offset.`)
  }
  if (chunk.compressor === 'none' && chunk.compressedByteLength !== chunk.decodedByteLength) {
    throw new Error(
      `Frame ${frameNumber} chunk ${chunkNumber} has inconsistent uncompressed lengths.`
    )
  }
}

function parseIndex(buffer: ArrayBuffer, count: number): FrameIndexEntry[] {
  if (buffer.byteLength !== count * HAPPACK_INDEX_ENTRY_SIZE) {
    throw new Error('Happack index byte length does not match entry count.')
  }

  const view = new DataView(buffer)
  const entries: FrameIndexEntry[] = []
  for (let i = 0; i < count; i += 1) {
    const base = i * HAPPACK_INDEX_ENTRY_SIZE
    entries.push({
      timestampUs: u64(view, base),
      durationUs: view.getUint32(base + 8, true),
      flags: view.getUint32(base + 12, true),
      offset: u64(view, base + 16),
      byteLength: u64(view, base + 24)
    })
  }
  return entries
}

export class HapPackReader {
  private constructor(
    private readonly source: ByteSource,
    readonly header: HapPackHeader,
    readonly metadata: HapPackMetadata,
    readonly index: FrameIndexEntry[]
  ) {}

  static async open(file: File): Promise<HapPackReader> {
    return await HapPackReader.openSource(new FileByteSource(file))
  }

  static async openSource(source: ByteSource): Promise<HapPackReader> {
    const header = parseHeader(await source.readRange(0, HAPPACK_HEADER_SIZE))
    if (header.metadataOffset + header.metadataLength > source.size) {
      throw new Error('Metadata range is outside file bounds.')
    }
    if (header.indexOffset + header.indexEntryCount * header.indexEntrySize > source.size) {
      throw new Error('Frame index range is outside file bounds.')
    }

    const metadataBuffer = await source.readRange(header.metadataOffset, header.metadataLength)
    const metadata = JSON.parse(decoder.decode(metadataBuffer)) as unknown
    assertMetadata(metadata)

    const indexBuffer = await source.readRange(
      header.indexOffset,
      header.indexEntryCount * header.indexEntrySize
    )
    const index = parseIndex(indexBuffer, header.indexEntryCount)

    if (metadata.frameCount !== index.length) {
      throw new Error('Metadata frame count does not match index length.')
    }

    for (const [frameNumber, entry] of index.entries()) {
      if (entry.byteLength <= 0) throw new Error(`Frame ${frameNumber} is empty.`)
      if (entry.offset + entry.byteLength > source.size) {
        throw new Error(`Frame ${frameNumber} payload range is outside file bounds.`)
      }
      for (const [chunkNumber, chunk] of metadata.decodeIndex[frameNumber].chunks.entries()) {
        if (chunk.payloadOffsetInFrame + chunk.compressedByteLength > entry.byteLength) {
          throw new Error(
            `Frame ${frameNumber} chunk ${chunkNumber} payload range exceeds frame bounds.`
          )
        }
      }
    }

    return new HapPackReader(source, header, metadata, index)
  }

  async readFrame(frameNumber: number): Promise<ArrayBuffer> {
    const entry = this.index[frameNumber]
    if (!entry) throw new Error(`Frame ${frameNumber} is outside the index.`)
    return await this.source.readRange(entry.offset, entry.byteLength)
  }
}
