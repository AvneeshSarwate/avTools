/// <reference lib="dom" />

export function alignedBytesPerRow(
  width: number,
  bytesPerPixel: number = 4,
): number {
  return Math.ceil((width * bytesPerPixel) / 256) * 256;
}

export interface StagingBufferPair {
  readonly count: 2;
  getWriteBuffer(device: GPUDevice, width: number, height: number): {
    buffer: GPUBuffer;
    bytesPerRow: number;
    bufferSize: number;
  };
  getReadBuffer(): {
    buffer: GPUBuffer;
    bytesPerRow: number;
    width: number;
    height: number;
  } | null;
  advance(): void;
  destroy(): void;
}

interface StagingEntry {
  buffer: GPUBuffer | null;
  bytesPerRow: number;
  width: number;
  height: number;
  bufferSize: number;
  hasData: boolean;
}

export function createStagingBufferPair(): StagingBufferPair {
  const entries: [StagingEntry, StagingEntry] = [
    {
      buffer: null,
      bytesPerRow: 0,
      width: 0,
      height: 0,
      bufferSize: 0,
      hasData: false,
    },
    {
      buffer: null,
      bytesPerRow: 0,
      width: 0,
      height: 0,
      bufferSize: 0,
      hasData: false,
    },
  ];

  let writeIdx = 0;
  let frameCount = 0;

  function ensureBuffer(
    device: GPUDevice,
    entry: StagingEntry,
    width: number,
    height: number,
  ): void {
    const bytesPerRow = alignedBytesPerRow(width);
    const bufferSize = bytesPerRow * height;

    if (
      entry.buffer &&
      entry.width === width &&
      entry.height === height &&
      entry.bytesPerRow === bytesPerRow &&
      entry.bufferSize === bufferSize
    ) {
      return;
    }

    entry.buffer?.destroy();
    entry.buffer = device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    entry.bytesPerRow = bytesPerRow;
    entry.width = width;
    entry.height = height;
    entry.bufferSize = bufferSize;
    entry.hasData = false;
  }

  return {
    count: 2,

    getWriteBuffer(device: GPUDevice, width: number, height: number) {
      const entry = entries[writeIdx];
      ensureBuffer(device, entry, width, height);
      return {
        buffer: entry.buffer!,
        bytesPerRow: entry.bytesPerRow,
        bufferSize: entry.bufferSize,
      };
    },

    getReadBuffer() {
      if (frameCount < 1) {
        return null;
      }
      const readIdx = (writeIdx + 1) % entries.length;
      const entry = entries[readIdx];
      if (!entry.buffer || !entry.hasData) {
        return null;
      }
      return {
        buffer: entry.buffer,
        bytesPerRow: entry.bytesPerRow,
        width: entry.width,
        height: entry.height,
      };
    },

    advance() {
      entries[writeIdx].hasData = true;
      writeIdx = (writeIdx + 1) % entries.length;
      frameCount += 1;
    },

    destroy() {
      for (const entry of entries) {
        entry.buffer?.destroy();
        entry.buffer = null;
        entry.hasData = false;
      }
    },
  };
}
