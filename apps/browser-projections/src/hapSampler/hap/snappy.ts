function readVarint(input: Uint8Array): { value: number; offset: number } {
  let result = 0
  let shift = 0
  for (let offset = 0; offset < 5; offset += 1) {
    const byte = input[offset]
    result |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return { value: result, offset: offset + 1 }
    shift += 7
  }
  throw new Error('Invalid Snappy varint length.')
}

function readLittleEndian(input: Uint8Array, offset: number, length: number): number {
  let value = 0
  for (let i = 0; i < length; i += 1) {
    value |= input[offset + i] << (i * 8)
  }
  return value
}

function copyBackReference(output: Uint8Array, outputOffset: number, offset: number, length: number) {
  if (offset <= 0 || offset > outputOffset) {
    throw new Error('Invalid Snappy copy offset.')
  }
  for (let i = 0; i < length; i += 1) {
    output[outputOffset + i] = output[outputOffset - offset + i]
  }
}

export function snappyUncompress(input: Uint8Array, expectedLength?: number): Uint8Array {
  const header = readVarint(input)
  const outputLength = header.value
  if (expectedLength !== undefined && outputLength !== expectedLength) {
    throw new Error(`Snappy decoded length mismatch. Expected ${expectedLength}, got ${outputLength}.`)
  }

  const output = new Uint8Array(outputLength)
  let inputOffset = header.offset
  let outputOffset = 0

  while (inputOffset < input.byteLength) {
    const tag = input[inputOffset++]
    const type = tag & 0x03

    if (type === 0) {
      let literalLength = tag >> 2
      if (literalLength < 60) {
        literalLength += 1
      } else {
        const lengthBytes = literalLength - 59
        if (inputOffset + lengthBytes > input.byteLength) {
          throw new Error('Snappy literal length exceeds input bounds.')
        }
        literalLength = readLittleEndian(input, inputOffset, lengthBytes) + 1
        inputOffset += lengthBytes
      }

      if (inputOffset + literalLength > input.byteLength) {
        throw new Error('Snappy literal exceeds input bounds.')
      }
      if (outputOffset + literalLength > output.byteLength) {
        throw new Error('Snappy literal exceeds output bounds.')
      }
      output.set(input.subarray(inputOffset, inputOffset + literalLength), outputOffset)
      inputOffset += literalLength
      outputOffset += literalLength
      continue
    }

    let length = 0
    let offset = 0
    if (type === 1) {
      length = ((tag >> 2) & 0x07) + 4
      if (inputOffset >= input.byteLength) throw new Error('Snappy copy-1 is truncated.')
      offset = ((tag & 0xe0) << 3) | input[inputOffset++]
    } else if (type === 2) {
      length = (tag >> 2) + 1
      if (inputOffset + 2 > input.byteLength) throw new Error('Snappy copy-2 is truncated.')
      offset = input[inputOffset] | (input[inputOffset + 1] << 8)
      inputOffset += 2
    } else {
      length = (tag >> 2) + 1
      if (inputOffset + 4 > input.byteLength) throw new Error('Snappy copy-4 is truncated.')
      offset = readLittleEndian(input, inputOffset, 4)
      inputOffset += 4
    }

    if (outputOffset + length > output.byteLength) {
      throw new Error('Snappy copy exceeds output bounds.')
    }
    copyBackReference(output, outputOffset, offset, length)
    outputOffset += length
  }

  if (outputOffset !== output.byteLength) {
    throw new Error(`Snappy output ended early. Wrote ${outputOffset} of ${output.byteLength} bytes.`)
  }
  return output
}
