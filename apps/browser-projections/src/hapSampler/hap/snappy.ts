import { snappyUncompressorInto } from 'hysnappy2'

const wasmSnappyUncompressInto = snappyUncompressorInto()

export function snappyUncompressInto(
  input: Uint8Array,
  output: Uint8Array,
  outputOffset: number,
  expectedLength: number,
): Uint8Array {
  return wasmSnappyUncompressInto(input, output, outputOffset, expectedLength)
}
