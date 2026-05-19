import { snappyUncompress } from './snappy'

type HapSection = {
  type: number
  dataOffset: number
  dataLength: number
  nextOffset: number
}

const HAP_SCALED_YCOCG_BC3 = 0xaf
const HAP_SCALED_YCOCG_BC3_SNAPPY = 0xbf
const HAP_SCALED_YCOCG_BC3_CHUNKED = 0xcf
const HAP_DECODE_INSTRUCTIONS = 0x01
const HAP_CHUNK_COMPRESSOR_TABLE = 0x02
const HAP_CHUNK_SIZE_TABLE = 0x03
const HAP_CHUNK_OFFSET_TABLE = 0x04
const HAP_COMPRESSOR_NONE = 0x0a
const HAP_COMPRESSOR_SNAPPY = 0x0b

export type HapSecondStageCompressor = 'snappy' | 'none'

function parseSection(bytes: Uint8Array, offset: number, limit = bytes.byteLength): HapSection {
  if (offset + 4 > limit) throw new Error('HAP section header is truncated.')

  const b0 = bytes[offset]
  const b1 = bytes[offset + 1]
  const b2 = bytes[offset + 2]
  const type = bytes[offset + 3]
  let dataOffset = offset + 4
  let dataLength = b0 | (b1 << 8) | (b2 << 16)

  if (b0 === 0 && b1 === 0 && b2 === 0) {
    if (offset + 8 > limit) throw new Error('Long HAP section header is truncated.')
    dataLength =
      bytes[offset + 4] |
      (bytes[offset + 5] << 8) |
      (bytes[offset + 6] << 16) |
      (bytes[offset + 7] << 24)
    dataLength >>>= 0
    dataOffset = offset + 8
  }

  const nextOffset = dataOffset + dataLength
  if (nextOffset > limit) throw new Error('HAP section exceeds frame bounds.')
  return { type, dataOffset, dataLength, nextOffset }
}

function readU32Table(bytes: Uint8Array): number[] {
  if (bytes.byteLength % 4 !== 0) throw new Error('HAP u32 table is not 4-byte aligned.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const values: number[] = []
  for (let offset = 0; offset < bytes.byteLength; offset += 4) {
    values.push(view.getUint32(offset, true))
  }
  return values
}

export function expectedBc3ByteLength(width: number, height: number): number {
  const blockWidth = Math.ceil(width / 4)
  const blockHeight = Math.ceil(height / 4)
  return blockWidth * blockHeight * 16
}

function decodeChunkedHapFrame(
  sectionData: Uint8Array,
  defaultCompressor: HapSecondStageCompressor,
): Uint8Array {
  const instructionSection = parseSection(sectionData, 0)
  if (instructionSection.type !== HAP_DECODE_INSTRUCTIONS) {
    throw new Error('Chunked HAP frame is missing decode instructions.')
  }

  const instructionEnd = instructionSection.dataOffset + instructionSection.dataLength
  let cursor = instructionSection.dataOffset
  let compressors: number[] | undefined
  let sizes: number[] | undefined
  let offsets: number[] | undefined

  while (cursor < instructionEnd) {
    const child = parseSection(sectionData, cursor, instructionEnd)
    const data = sectionData.subarray(child.dataOffset, child.nextOffset)
    if (child.type === HAP_CHUNK_COMPRESSOR_TABLE) {
      compressors = [...data]
    } else if (child.type === HAP_CHUNK_SIZE_TABLE) {
      sizes = readU32Table(data)
    } else if (child.type === HAP_CHUNK_OFFSET_TABLE) {
      offsets = readU32Table(data)
    }
    cursor = child.nextOffset
  }

  if (!sizes || sizes.length === 0) throw new Error('Chunked HAP frame is missing a size table.')
  if (!compressors) {
    const fallback =
      defaultCompressor === 'snappy' ? HAP_COMPRESSOR_SNAPPY : HAP_COMPRESSOR_NONE
    compressors = sizes.map(() => fallback)
  }
  if (compressors.length !== sizes.length) {
    throw new Error('HAP compressor table length does not match chunk count.')
  }
  if (offsets && offsets.length !== sizes.length) {
    throw new Error('HAP chunk offset table length does not match chunk count.')
  }

  const frameData = sectionData.subarray(instructionSection.nextOffset)
  const decodedChunks: Uint8Array[] = []
  let totalLength = 0
  let implicitOffset = 0

  for (let i = 0; i < sizes.length; i += 1) {
    const chunkOffset = offsets ? offsets[i] : implicitOffset
    const chunkSize = sizes[i]
    implicitOffset += chunkSize

    if (chunkOffset + chunkSize > frameData.byteLength) {
      throw new Error(`HAP chunk ${i} exceeds frame data bounds.`)
    }
    const chunk = frameData.subarray(chunkOffset, chunkOffset + chunkSize)
    const compressor = compressors[i]
    let decoded: Uint8Array
    if (compressor === HAP_COMPRESSOR_NONE) {
      decoded = chunk
    } else if (compressor === HAP_COMPRESSOR_SNAPPY) {
      decoded = snappyUncompress(chunk)
    } else {
      throw new Error(`Unsupported HAP chunk compressor 0x${compressor.toString(16)}.`)
    }
    decodedChunks.push(decoded)
    totalLength += decoded.byteLength
  }

  const output = new Uint8Array(totalLength)
  let outputOffset = 0
  for (const chunk of decodedChunks) {
    output.set(chunk, outputOffset)
    outputOffset += chunk.byteLength
  }
  return output
}

export function decodeHapYFrame(
  encoded: Uint8Array,
  width: number,
  height: number,
  defaultCompressor: HapSecondStageCompressor = 'snappy',
): Uint8Array {
  const top = parseSection(encoded, 0)
  if (top.nextOffset !== encoded.byteLength) {
    throw new Error('HAP frame contains trailing bytes after the top-level section.')
  }

  const data = encoded.subarray(top.dataOffset, top.nextOffset)
  let bcBytes: Uint8Array
  if (top.type === HAP_SCALED_YCOCG_BC3) {
    bcBytes = data
  } else if (top.type === HAP_SCALED_YCOCG_BC3_SNAPPY) {
    bcBytes = snappyUncompress(data)
  } else if (top.type === HAP_SCALED_YCOCG_BC3_CHUNKED) {
    bcBytes = decodeChunkedHapFrame(data, defaultCompressor)
  } else {
    throw new Error(`Unsupported HAP top-level section 0x${top.type.toString(16)}.`)
  }

  const expectedLength = expectedBc3ByteLength(width, height)
  if (bcBytes.byteLength !== expectedLength) {
    throw new Error(`Decoded BC3 byte length mismatch. Expected ${expectedLength}, got ${bcBytes.byteLength}.`)
  }
  return bcBytes
}
