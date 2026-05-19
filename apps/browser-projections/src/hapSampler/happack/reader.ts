import {
  HAPPACK_HEADER_SIZE,
  HAPPACK_INDEX_ENTRY_SIZE,
  HAPPACK_MAGIC,
  type FrameIndexEntry,
  type HapPackHeader,
  type HapPackMetadata,
} from './types'

const decoder = new TextDecoder()

async function readRange(file: File, offset: number, length: number): Promise<ArrayBuffer> {
  if (offset < 0 || length < 0 || offset + length > file.size) {
    throw new Error(`Read range is outside file bounds: offset=${offset}, length=${length}`)
  }
  return await file.slice(offset, offset + length).arrayBuffer()
}

function u64(view: DataView, offset: number): number {
  const value = view.getBigUint64(offset, true)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Happack file is too large for browser number offsets.')
  }
  return Number(value)
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
    indexEntrySize: view.getUint32(48, true),
  }

  if (header.version !== 1) throw new Error(`Unsupported happack version ${header.version}.`)
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
  if (metadata.version !== 1) throw new Error('Happack metadata version must be 1.')
  if (metadata.codec !== 'HapY') throw new Error('Only HapY / Hap Q happacks are supported.')
  if (metadata.hapFlavor !== 'hap_q') throw new Error('Only hap_q happacks are supported.')
  if (metadata.gpuFormat !== 'bc3-rgba-unorm') throw new Error('Only BC3 RGBA happacks are supported.')
  if (metadata.colorModel !== 'scaled-ycocg') throw new Error('Only Scaled YCoCg happacks are supported.')
  if (metadata.hasAudio !== false) throw new Error('Audio tracks are not supported.')
  if (metadata.compressor !== 'snappy' && metadata.compressor !== 'none') {
    throw new Error('Only Snappy or uncompressed HAP happacks are supported.')
  }
  if (typeof metadata.width !== 'number' || !Number.isFinite(metadata.width) || metadata.width <= 0) {
    throw new Error('Invalid width.')
  }
  if (typeof metadata.height !== 'number' || !Number.isFinite(metadata.height) || metadata.height <= 0) {
    throw new Error('Invalid height.')
  }
  if (typeof metadata.frameCount !== 'number' || !Number.isInteger(metadata.frameCount) || metadata.frameCount <= 0) {
    throw new Error('Invalid frame count.')
  }
  if (typeof metadata.durationUs !== 'number' || !Number.isFinite(metadata.durationUs) || metadata.durationUs <= 0) {
    throw new Error('Invalid duration.')
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
      byteLength: u64(view, base + 24),
    })
  }
  return entries
}

export class HapPackReader {
  private constructor(
    readonly file: File,
    readonly header: HapPackHeader,
    readonly metadata: HapPackMetadata,
    readonly index: FrameIndexEntry[],
  ) {}

  static async open(file: File): Promise<HapPackReader> {
    const header = parseHeader(await readRange(file, 0, HAPPACK_HEADER_SIZE))
    if (header.metadataOffset + header.metadataLength > file.size) {
      throw new Error('Metadata range is outside file bounds.')
    }
    if (header.indexOffset + header.indexEntryCount * header.indexEntrySize > file.size) {
      throw new Error('Frame index range is outside file bounds.')
    }

    const metadataBuffer = await readRange(file, header.metadataOffset, header.metadataLength)
    const metadata = JSON.parse(decoder.decode(metadataBuffer)) as unknown
    assertMetadata(metadata)

    const indexBuffer = await readRange(
      file,
      header.indexOffset,
      header.indexEntryCount * header.indexEntrySize,
    )
    const index = parseIndex(indexBuffer, header.indexEntryCount)

    if (metadata.frameCount !== index.length) {
      throw new Error('Metadata frame count does not match index length.')
    }

    for (const [frameNumber, entry] of index.entries()) {
      if (entry.byteLength <= 0) throw new Error(`Frame ${frameNumber} is empty.`)
      if (entry.offset + entry.byteLength > file.size) {
        throw new Error(`Frame ${frameNumber} payload range is outside file bounds.`)
      }
    }

    return new HapPackReader(file, header, metadata, index)
  }

  async readFrame(frameNumber: number): Promise<ArrayBuffer> {
    const entry = this.index[frameNumber]
    if (!entry) throw new Error(`Frame ${frameNumber} is outside the index.`)
    return await readRange(this.file, entry.offset, entry.byteLength)
  }
}
