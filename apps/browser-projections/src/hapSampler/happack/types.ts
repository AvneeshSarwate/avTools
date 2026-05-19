export type HapPackMetadata = {
  version: 1
  codec: 'HapY'
  hapFlavor: 'hap_q'
  gpuFormat: 'bc3-rgba-unorm'
  colorModel: 'scaled-ycocg'
  width: number
  height: number
  frameRateNumerator: number
  frameRateDenominator: number
  timescale: number
  frameCount: number
  durationUs: number
  hasAudio: false
  chunks: number
  compressor: 'snappy' | 'none'
}

export type FrameIndexEntry = {
  timestampUs: number
  durationUs: number
  flags: number
  offset: number
  byteLength: number
}

export type HapPackHeader = {
  version: number
  headerSize: number
  metadataOffset: number
  metadataLength: number
  indexOffset: number
  indexEntryCount: number
  indexEntrySize: number
}

export const HAPPACK_MAGIC = 'HAPPACK\0'
export const HAPPACK_HEADER_SIZE = 64
export const HAPPACK_INDEX_ENTRY_SIZE = 32
