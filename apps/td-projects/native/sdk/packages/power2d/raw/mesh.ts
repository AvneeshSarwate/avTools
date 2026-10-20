/// <reference lib="dom" />

export class RawMesh {
  readonly vertexBuffers: Record<string, GPUBuffer>;
  readonly indexBuffer: GPUBuffer | null;
  readonly indexCount: number;
  readonly indexFormat: GPUIndexFormat;
  readonly vertexCount: number;

  constructor(options: {
    vertexBuffers: Record<string, GPUBuffer>;
    indexBuffer?: GPUBuffer | null;
    indexCount?: number;
    indexFormat?: GPUIndexFormat;
    vertexCount?: number;
  }) {
    this.vertexBuffers = options.vertexBuffers;
    this.indexBuffer = options.indexBuffer ?? null;
    this.indexCount = options.indexCount ?? 0;
    this.indexFormat = options.indexFormat ?? 'uint32';
    this.vertexCount = options.vertexCount ?? 0;
  }

  bind(pass: GPURenderPassEncoder, attributeOrder: readonly string[]): void {
    for (let i = 0; i < attributeOrder.length; i += 1) {
      const name = attributeOrder[i];
      const buffer = this.vertexBuffers[name];
      if (!buffer) {
        throw new Error(`RawMesh is missing vertex buffer for attribute "${name}"`);
      }
      pass.setVertexBuffer(i, buffer);
    }
  }

  draw(pass: GPURenderPassEncoder): void {
    if (this.indexBuffer) {
      pass.setIndexBuffer(this.indexBuffer, this.indexFormat);
      pass.drawIndexed(this.indexCount);
    } else {
      pass.draw(this.vertexCount);
    }
  }

  dispose(): void {
    for (const buffer of Object.values(this.vertexBuffers)) {
      buffer.destroy();
    }
    this.indexBuffer?.destroy();
  }
}
