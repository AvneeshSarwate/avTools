/// <reference lib="dom" />

import earcut from 'earcut';
import type {
  BatchInstanceAttrs,
  BatchMaterialDef,
  MaterialInstanceOf,
  MaterialTextureNames,
  MaterialUniforms,
  Point2D,
  Power2DRenderable,
  Power2DScene,
  TextureSource,
} from './types.ts';
import { RawMesh } from './mesh.ts';

function createBuffer(device: GPUDevice, data: Float32Array | Uint32Array, usage: GPUBufferUsageFlags): GPUBuffer {
  const buffer = device.createBuffer({
    size: Math.max(4, data.byteLength),
    usage,
    mappedAtCreation: true,
  });
  const mapped = buffer.getMappedRange();
  new (data instanceof Float32Array ? Float32Array : Uint32Array)(mapped).set(data);
  buffer.unmap();
  return buffer;
}

function resolveTextureView(source: TextureSource): GPUTextureView {
  if ('createView' in source) {
    return source.createView();
  }
  return source;
}

interface BatchedStyledShapeOptions<M extends BatchMaterialDef<unknown, string, any>> {
  scene: Power2DScene;
  points: readonly Point2D[];
  material: M;
  instanceCount: number;
  canvasWidth: number;
  canvasHeight: number;
  closed?: boolean;
}

export class BatchedStyledShape<M extends BatchMaterialDef<unknown, string, any>> implements Power2DRenderable {
  private readonly scene: Power2DScene;
  private readonly device: GPUDevice;
  private readonly materialInstance: MaterialInstanceOf<M>;
  private readonly instanceCount: number;
  private readonly instanceAttrLayout: M['instanceAttrLayout'];

  private readonly vertexBuffers: Record<string, GPUBuffer>;
  private readonly baseVertexBuffers: GPUBuffer[];
  private readonly indexBuffer: GPUBuffer | null;
  private readonly indexCount: number;
  private readonly mesh: RawMesh;

  private readonly instanceData: Float32Array;
  private readonly instanceBuffer: GPUBuffer;
  private externalInstanceBuffer: GPUBuffer | null = null;
  private useExternalBuffers = false;

  private _alphaIndex = 0;
  private _x = 0;
  private _y = 0;
  private _rotation = 0;
  private _scaleX = 1;
  private _scaleY = 1;

  constructor(options: BatchedStyledShapeOptions<M>) {
    this.scene = options.scene;
    this.device = options.scene.device;
    this.instanceCount = options.instanceCount;
    this.instanceAttrLayout = options.material.instanceAttrLayout;

    if (!this.instanceAttrLayout) {
      throw new Error('BatchedStyledShape requires a material with instanceAttrLayout');
    }

    this.materialInstance = options.material.createMaterial(
      this.device,
      this.scene.format,
      'power2dBatchMaterial',
    ) as MaterialInstanceOf<M>;
    this.materialInstance.setCanvasSize(options.canvasWidth, options.canvasHeight);

    const { vertexBuffers, indexBuffer, indexCount } = this.createMesh(options.points, options.closed ?? true);
    this.vertexBuffers = vertexBuffers;
    this.baseVertexBuffers = Object.values(vertexBuffers);
    this.indexBuffer = indexBuffer;
    this.indexCount = indexCount;

    const floatsPerInstance = this.instanceAttrLayout.size;
    const totalFloats = floatsPerInstance * this.instanceCount;
    this.instanceData = new Float32Array(totalFloats);
    this.instanceBuffer = this.device.createBuffer({
      size: Math.max(4, totalFloats * 4),
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    this.mesh = new RawMesh({
      vertexBuffers: this.vertexBuffers,
      indexBuffer: this.indexBuffer,
      indexCount: this.indexCount,
      indexFormat: 'uint32',
    });

    this.rebuildInstanceVertexBuffers();
    this.applyShapeTransform();
    this.scene.addShape(this);
  }

  setUniforms(uniforms: Partial<MaterialUniforms<M>>): void {
    this.materialInstance.setUniforms(uniforms);
  }

  setTexture(name: MaterialTextureNames<M>, source: TextureSource): void {
    this.materialInstance.setTexture(name, resolveTextureView(source));
  }

  get x(): number {
    return this._x;
  }

  set x(value: number) {
    if (value !== this._x) {
      this._x = value;
      this.applyShapeTransform();
    }
  }

  get y(): number {
    return this._y;
  }

  set y(value: number) {
    if (value !== this._y) {
      this._y = value;
      this.applyShapeTransform();
    }
  }

  get rotation(): number {
    return this._rotation;
  }

  set rotation(value: number) {
    if (value !== this._rotation) {
      this._rotation = value;
      this.applyShapeTransform();
    }
  }

  get scaleX(): number {
    return this._scaleX;
  }

  set scaleX(value: number) {
    if (value !== this._scaleX) {
      this._scaleX = value;
      this.applyShapeTransform();
    }
  }

  get scaleY(): number {
    return this._scaleY;
  }

  set scaleY(value: number) {
    if (value !== this._scaleY) {
      this._scaleY = value;
      this.applyShapeTransform();
    }
  }

  get alphaIndex(): number {
    return this._alphaIndex;
  }

  set alphaIndex(value: number) {
    this._alphaIndex = value;
  }

  writeInstanceAttr(index: number, values: Partial<BatchInstanceAttrs<M>>): void {
    if (this.useExternalBuffers) {
      console.warn('Cannot write instance attrs when using external buffers');
      return;
    }
    const floatsPerInstance = this.instanceAttrLayout.size;
    const baseOffset = index * floatsPerInstance;
    for (const member of this.instanceAttrLayout.members) {
      const memberKey = member.name as string;
      const value = (values as Record<string, unknown>)[memberKey];
      if (value === undefined) continue;
      const memberOffset = baseOffset + member.offset;
      if (typeof value === 'number') {
        this.instanceData[memberOffset] = value;
      } else if (Array.isArray(value)) {
        for (let i = 0; i < member.floatCount && i < value.length; i++) {
          this.instanceData[memberOffset + i] = value[i] ?? 0;
        }
      }
    }
  }

  updateInstanceBuffer(): void {
    if (!this.useExternalBuffers) {
      const dataView = this.instanceData.buffer instanceof ArrayBuffer
        ? new Float32Array(this.instanceData.buffer, this.instanceData.byteOffset, this.instanceData.length)
        : new Float32Array(this.instanceData);
      this.device.queue.writeBuffer(this.instanceBuffer, 0, dataView);
    }
  }

  setInstancingBuffer(buffer: GPUBuffer | null): void {
    this.externalInstanceBuffer = buffer;
    this.useExternalBuffers = buffer !== null;
    this.rebuildInstanceVertexBuffers();
  }

  setExternalBufferMode(enabled: boolean): void {
    if (enabled && !this.externalInstanceBuffer) {
      console.warn('setExternalBufferMode(true) called without an external buffer. Use setInstancingBuffer first.');
      return;
    }
    this.useExternalBuffers = enabled;
    this.rebuildInstanceVertexBuffers();
  }

  getInstanceBuffer(): GPUBuffer {
    return this.instanceBuffer;
  }

  beforeRender(): void {
    this.updateInstanceBuffer();
  }

  setCanvasSize(width: number, height: number): void {
    this.materialInstance.setCanvasSize(width, height);
    this.applyShapeTransform();
  }

  render(pass: GPURenderPassEncoder): void {
    pass.setPipeline(this.materialInstance.pipeline);
    pass.setBindGroup(0, this.materialInstance.bindGroup);
    this.mesh.bind(pass, this.materialInstance.attributeOrder);
    if (this.indexBuffer) {
      pass.setIndexBuffer(this.indexBuffer, 'uint32');
      pass.drawIndexed(this.indexCount, this.instanceCount);
    } else {
      pass.draw(this.mesh.vertexCount, this.instanceCount);
    }
  }

  dispose(): void {
    this.scene.removeShape(this);
    this.materialInstance.dispose();
    for (const buffer of this.baseVertexBuffers) {
      buffer.destroy();
    }
    this.indexBuffer?.destroy();
    this.instanceBuffer.destroy();
  }

  private createMesh(points: readonly Point2D[], closed: boolean): { vertexBuffers: Record<string, GPUBuffer>; indexBuffer: GPUBuffer | null; indexCount: number } {
    void closed;
    const contour: number[] = [];
    for (const [x, y] of points) {
      contour.push(x, y);
    }

    const indices = earcut(contour, undefined, 2);
    const positions: number[] = [];
    const uvs: number[] = [];

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of points) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    const width = maxX - minX || 1;
    const height = maxY - minY || 1;

    for (const [x, y] of points) {
      positions.push(x, y);
      uvs.push((x - minX) / width, (y - minY) / height);
    }

    const positionBuffer = createBuffer(this.device, new Float32Array(positions), GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);
    const uvBuffer = createBuffer(this.device, new Float32Array(uvs), GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);
    const indexBuffer = createBuffer(this.device, new Uint32Array(indices), GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST);

    return {
      vertexBuffers: {
        position: positionBuffer,
        uv: uvBuffer,
      },
      indexBuffer,
      indexCount: indices.length,
    };
  }

  private rebuildInstanceVertexBuffers(): void {
    const buffer = this.externalInstanceBuffer ?? this.instanceBuffer;
    if (!buffer) return;
    for (const member of this.instanceAttrLayout.members) {
      this.vertexBuffers[`inst_${String(member.name)}`] = buffer;
    }
  }

  private applyShapeTransform(): void {
    const translate: readonly [number, number] = [this._x, this._y];
    const scale: readonly [number, number] = [this._scaleX, this._scaleY];
    this.materialInstance.setBuiltins({
      power2d_shapeTranslate: translate,
      power2d_shapeRotation: this._rotation,
      power2d_shapeScale: scale,
      power2d_canvasWidth: this.scene.width,
      power2d_canvasHeight: this.scene.height,
    });
  }
}
