/**
 * Uncompress a snappy compressed buffer.
 *
 * @param {Uint8Array} input
 * @param {Uint8Array} output
 */
export function snappyUncompress(input: Uint8Array, outputLength: number): Uint8Array

/**
 * Uncompress into an existing output buffer.
 *
 * @param {Uint8Array} input
 * @param {Uint8Array} output
 * @param {number} [outputOffset]
 * @param {number} [outputLength]
 */
export function snappyUncompressInto(
  input: Uint8Array,
  output: Uint8Array,
  outputOffset?: number,
  outputLength?: number,
): Uint8Array

/**
 * Load wasm and return allocating uncompressor function.
 */
export function snappyUncompressor(): (input: Uint8Array, outputLength: number) => Uint8Array

/**
 * Load wasm and return no-copy-friendly uncompressor function.
 */
export function snappyUncompressorInto(): (
  input: Uint8Array,
  output: Uint8Array,
  outputOffset?: number,
  outputLength?: number,
) => Uint8Array

/**
 * Compress a buffer using snappy.
 *
 * @param {Uint8Array} input
 * @returns {Uint8Array}
 */
export function snappyCompress(input: Uint8Array): Uint8Array

/**
 * Load wasm and return compressor function.
 */
export function snappyCompressor(): (input: Uint8Array) => Uint8Array
