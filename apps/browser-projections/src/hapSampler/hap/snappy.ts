import { snappyUncompressor } from 'hysnappy'

const wasmSnappyUncompress = snappyUncompressor()

export function snappyUncompress(input: Uint8Array, expectedLength: number): Uint8Array {
  return wasmSnappyUncompress(input, expectedLength)
}
