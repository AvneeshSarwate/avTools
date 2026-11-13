import type { FrameDecodeInfo } from '../happack/types'
import { snappyUncompressInto } from './snappy'

const HAP_SCALED_YCOCG_BC3 = 0xaf
const HAP_SCALED_YCOCG_BC3_SNAPPY = 0xbf
const HAP_SCALED_YCOCG_BC3_CHUNKED = 0xcf

export function expectedBc3ByteLength(width: number, height: number): number {
  const blockWidth = Math.ceil(width / 4)
  const blockHeight = Math.ceil(height / 4)
  return blockWidth * blockHeight * 16
}

export function decodeHapYFrame(
  encoded: Uint8Array,
  decodeInfo: FrameDecodeInfo,
  expectedLength: number,
): Uint8Array {
  return decodeHapYFrameInto(encoded, decodeInfo, new Uint8Array(expectedLength))
}

export function decodeHapYFrameInto(
  encoded: Uint8Array,
  decodeInfo: FrameDecodeInfo,
  output: Uint8Array,
): Uint8Array {
  if (
    decodeInfo.hapSectionType !== HAP_SCALED_YCOCG_BC3 &&
    decodeInfo.hapSectionType !== HAP_SCALED_YCOCG_BC3_SNAPPY &&
    decodeInfo.hapSectionType !== HAP_SCALED_YCOCG_BC3_CHUNKED
  ) {
    throw new Error(`Unsupported HAP top-level section 0x${decodeInfo.hapSectionType.toString(16)}.`)
  }

  let expectedDecodedOffset = 0

  for (const [index, chunkInfo] of decodeInfo.chunks.entries()) {
    if (chunkInfo.decodedOffsetInBc3Frame !== expectedDecodedOffset) {
      throw new Error(`HAP chunk ${index} decoded offset is not contiguous.`)
    }

    const payloadStart = chunkInfo.payloadOffsetInFrame
    const payloadEnd = payloadStart + chunkInfo.compressedByteLength
    const decodedEnd = chunkInfo.decodedOffsetInBc3Frame + chunkInfo.decodedByteLength
    if (payloadStart < 0 || payloadEnd > encoded.byteLength) {
      throw new Error(`HAP chunk ${index} exceeds frame payload bounds.`)
    }
    if (decodedEnd > output.byteLength) {
      throw new Error(`HAP chunk ${index} exceeds decoded output bounds.`)
    }

    const payload = encoded.subarray(payloadStart, payloadEnd)
    if (chunkInfo.compressor === 'none') {
      if (chunkInfo.compressedByteLength !== chunkInfo.decodedByteLength) {
        throw new Error(`Uncompressed HAP chunk ${index} has mismatched byte lengths.`)
      }
      output.set(payload, chunkInfo.decodedOffsetInBc3Frame)
    } else if (chunkInfo.compressor === 'snappy') {
      snappyUncompressInto(
        payload,
        output,
        chunkInfo.decodedOffsetInBc3Frame,
        chunkInfo.decodedByteLength,
      )
    } else {
      throw new Error(`Unsupported HAP chunk compressor ${chunkInfo.compressor}.`)
    }

    expectedDecodedOffset += chunkInfo.decodedByteLength
  }

  if (expectedDecodedOffset !== output.byteLength) {
    throw new Error(
      `Decoded BC3 byte length mismatch. Expected ${output.byteLength}, got ${expectedDecodedOffset}.`,
    )
  }
  return output
}
