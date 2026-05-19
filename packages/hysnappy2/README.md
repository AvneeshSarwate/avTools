# hysnappy2

`hysnappy2` is a local fork of [hysnappy](https://github.com/hyparam/hysnappy) with decode-into APIs for allocation-sensitive media playback.

It provides:
- Very fast Snappy compression/decompression suitable for web and Node.js environments.
- A minimal footprint with no external dependencies.
- A `snappyUncompressInto` API that writes decompressed bytes into caller-owned buffers.


The Snappy compression format, originally released by Google, is designed for high-speed and reasonable compression ratios. HySnappy leverages these strengths by providing a WebAssembly build that can be included directly in your JavaScript bundle for optimal performance.

## Usage

### Decompress Snappy Data

The `snappyUncompress` function requires arguments:
 - `compressed`: a `Uint8Array` with compressed data.
 - `outputLength`: the uncompressed size of the data.

The length is needed to know how much wasm memory to allocate.
For formats like parquet, this length will generally be known in advance.

To decompress a `Uint8Array` with known output length:

```javascript
const { snappyUncompress } = await import('hysnappy2')

const compressed = new Uint8Array([
  0x0a, 0x24, 0x68, 0x79, 0x70, 0x65, 0x72, 0x70, 0x61, 0x72, 0x61, 0x6d
])
const outputLength = 10
const output = snappyUncompress(compressed, outputLength) // hyperparam
```

### Decompress Into An Existing Buffer

For video or other repeated decode loops, use `snappyUncompressorInto()` once and reuse output buffers:

```javascript
import { snappyUncompressorInto } from 'hysnappy2'

const uncompressInto = snappyUncompressorInto()
const output = new Uint8Array(outputLength)
uncompressInto(compressed, output, 0, outputLength)
```

### Compress Snappy Data

Use the `snappyCompress` function to compress a `Uint8Array`:

```javascript
const { snappyCompress } = await import('hysnappy2')

const input = new Uint8Array([
  0x68, 0x79, 0x70, 0x61, 0x72, 0x61, 0x6d
])
const compressed = snappyCompress(input)
```

## Development

The build uses clang _without_ emscripten, in order to produce the smallest possible binary.

Run `make` to build from source. The build process consists of:

1. Compile from c to wasm using `clang`.
2. Encode wasm as base64 to `uncompress.wasm.base64` and `compress.wasm.base64`.
3. Insert base64 strings into `uncompress.js` and `compress.js` for distribution.

## WASM Loading

By keeping wasm files under 4kb, we can include it directly in the javascript files and load the WASM blob synchronously, which is faster than loading a separate `.wasm` file. [[web.dev]](https://web.dev/articles/loading-wasm)

## References

 - https://en.wikipedia.org/wiki/Snappy_(compression)
 - https://github.com/andikleen/snappy-c
 - https://github.com/google/snappy
 - https://github.com/zhipeng-jia/snappyjs
 - https://web.dev/articles/loading-wasm
