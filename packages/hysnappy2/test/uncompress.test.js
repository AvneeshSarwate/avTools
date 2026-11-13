import assert from 'node:assert/strict'
import test from 'node:test'
import {
  snappyCompress,
  snappyUncompress,
  snappyUncompressInto,
  snappyUncompressorInto,
} from '../js/index.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

test('snappyUncompress keeps allocating API compatibility', () => {
  const compressed = new Uint8Array([
    0x0a, 0x24, 0x68, 0x79, 0x70, 0x65, 0x72, 0x70, 0x61, 0x72, 0x61, 0x6d,
  ])
  assert.equal(decoder.decode(snappyUncompress(compressed, 10)), 'hyperparam')
})

test('snappyUncompressInto writes into caller-owned output', () => {
  const compressed = new Uint8Array([0x05, 0x10, 0x68, 0x79, 0x70, 0x65, 0x72])
  const output = new Uint8Array(12)
  output.fill(0xff)

  const returned = snappyUncompressInto(compressed, output, 3, 5)

  assert.equal(returned, output)
  assert.deepEqual([...output.subarray(0, 3)], [0xff, 0xff, 0xff])
  assert.equal(decoder.decode(output.subarray(3, 8)), 'hyper')
  assert.deepEqual([...output.subarray(8)], [0xff, 0xff, 0xff, 0xff])
})

test('snappyUncompressorInto reuses one wasm instance', () => {
  const uncompressInto = snappyUncompressorInto()
  const compressedA = new Uint8Array([0x01, 0x00, 0x68])
  const compressedB = new Uint8Array([0x02, 0x04, 0x68, 0x79])
  const output = new Uint8Array(4)

  uncompressInto(compressedA, output, 0, 1)
  uncompressInto(compressedB, output, 1, 2)

  assert.equal(decoder.decode(output.subarray(0, 3)), 'hhy')
})

test('snappyUncompressInto validates output bounds', () => {
  const compressed = new Uint8Array([0x01, 0x00, 0x68])
  assert.throws(
    () => snappyUncompressInto(compressed, new Uint8Array(1), 1, 1),
    /output range exceeds output buffer length/,
  )
})

test('snappyCompress round trips through decode-into', () => {
  const input = encoder.encode('low allocation media decode '.repeat(64))
  const compressed = snappyCompress(input)
  const output = new Uint8Array(input.length)

  snappyUncompressInto(compressed, output)

  assert.deepEqual(output, input)
})
