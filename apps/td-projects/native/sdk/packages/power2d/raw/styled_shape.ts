/// <reference lib="dom" />

import earcut from 'earcut';
import type {
  MaterialDef,
  MaterialInstanceOf,
  MaterialTextureNames,
  MaterialUniforms,
  Point2D,
  Power2DScene,
  TextureSource,
} from './types.ts';
import { generateStrokeMesh } from '../core/stroke_mesh_generator.ts';
import { RawMesh } from './mesh.ts';

const DEFAULT_TRANSLATE: readonly [number, number] = [0, 0];
const DEFAULT_SCALE: readonly [number, number] = [1, 1];

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

type MaybeMaterialDef = MaterialDef<object, string> | undefined;

type UniformsOf<M> = M extends MaterialDef<infer U, infer _T> ? U : never;

type TextureNamesOf<M> = M extends MaterialDef<unknown, infer T> ? T : never;

interface StyledShapeOptions<BodyMat extends MaterialDef<object, string>, StrokeMat extends MaybeMaterialDef = undefined> {
  scene: Power2DScene;
  points: readonly Point2D[];
  bodyMaterial: BodyMat;
  strokeMaterial?: StrokeMat;
  strokeThickness?: number;
  closed?: boolean;
}

export class StyledShape<BodyMat extends MaterialDef<object, string>, StrokeMat extends MaybeMaterialDef = undefined> {
  private readonly scene: Power2DScene;
  private readonly device: GPUDevice;
  private bodyMesh: RawMesh;
  private strokeMesh: RawMesh | null = null;
  private readonly bodyMaterialInstance: MaterialInstanceOf<BodyMat>;
  private strokeMaterialInstance: MaterialInstanceOf<Exclude<StrokeMat, undefined>> | null = null;

  private points: readonly Point2D[];
  private closed: boolean;
  private _strokeThickness: number;
  private _alphaIndex = 0;
  private _x = 0;
  private _y = 0;
  private _rotation = 0;
  private _scaleX = 1;
  private _scaleY = 1;

  constructor(options: StyledShapeOptions<BodyMat, StrokeMat>) {
    this.scene = options.scene;
    this.device = options.scene.device;
    this.points = options.points;
    this.closed = options.closed ?? true;
    this._strokeThickness = options.strokeThickness ?? 1;

    this.bodyMaterialInstance = options.bodyMaterial.createMaterial(this.device, this.scene.format, 'power2dBodyMaterial') as MaterialInstanceOf<BodyMat>;
    this.bodyMaterialInstance.setCanvasSize(this.scene.width, this.scene.height);

    this.bodyMesh = this.createBodyMesh();

    if (options.strokeMaterial) {
      this.strokeMaterialInstance = options.strokeMaterial.createMaterial(this.device, this.scene.format, 'power2dStrokeMaterial') as MaterialInstanceOf<Exclude<StrokeMat, undefined>>;
      this.strokeMaterialInstance.setCanvasSize(this.scene.width, this.scene.height);
      this.strokeMaterialInstance.setBuiltins({ power2d_strokeThickness: this._strokeThickness });
      this.strokeMesh = this.createStrokeMesh();
    }

    this.applyShapeTransform();
    this.scene.addShape(this);
  }

  //===========================================================================
  // Body API
  //===========================================================================

  get body() {
    const self = this;
    return {
      setUniforms(uniforms: Partial<UniformsOf<BodyMat>>): void {
        self.bodyMaterialInstance.setUniforms(uniforms);
      },
      setTexture(name: TextureNamesOf<BodyMat>, source: TextureSource): void {
        self.bodyMaterialInstance.setTexture(name, resolveTextureView(source));
      },
      get mesh(): RawMesh {
        return self.bodyMesh;
      },
    };
  }

  //===========================================================================
  // Stroke API
  //===========================================================================

  get stroke(): StrokeMat extends MaterialDef<object, string> ? {
    setUniforms(uniforms: Partial<UniformsOf<Exclude<StrokeMat, undefined>>>): void;
    setTexture(name: TextureNamesOf<Exclude<StrokeMat, undefined>>, source: TextureSource): void;
    thickness: number;
    mesh: RawMesh;
  } : null {
    if (!this.strokeMaterialInstance || !this.strokeMesh) {
      return null as StrokeMat extends MaterialDef<object, string> ? never : null;
    }
    const self = this;
    return {
      setUniforms(uniforms: Partial<UniformsOf<Exclude<StrokeMat, undefined>>>): void {
        self.strokeMaterialInstance!.setUniforms(uniforms);
      },
      setTexture(name: TextureNamesOf<Exclude<StrokeMat, undefined>>, source: TextureSource): void {
        self.strokeMaterialInstance!.setTexture(name, resolveTextureView(source));
      },
      get thickness(): number {
        return self._strokeThickness;
      },
      set thickness(value: number) {
        if (value !== self._strokeThickness) {
          self._strokeThickness = value;
          self.strokeMaterialInstance!.setBuiltins({ power2d_strokeThickness: value });
          self.rebuildStrokeMesh();
        }
      },
      get mesh(): RawMesh {
        return self.strokeMesh!;
      },
    } as unknown as StrokeMat extends MaterialDef<object, string> ? never : null;
  }

  //===========================================================================
  // Transform API
  //===========================================================================

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

  //===========================================================================
  // Rendering
  //===========================================================================

  render(pass: GPURenderPassEncoder): void {
    this.renderMesh(pass, this.bodyMesh, this.bodyMaterialInstance);
    if (this.strokeMesh && this.strokeMaterialInstance) {
      this.renderMesh(pass, this.strokeMesh, this.strokeMaterialInstance);
    }
  }

  private renderMesh(pass: GPURenderPassEncoder, mesh: RawMesh, material: { pipeline: GPURenderPipeline; bindGroup: GPUBindGroup; attributeOrder: readonly string[] }): void {
    pass.setPipeline(material.pipeline);
    pass.setBindGroup(0, material.bindGroup);
    mesh.bind(pass, material.attributeOrder);
    mesh.draw(pass);
  }

  //===========================================================================
  // Point Updates
  //===========================================================================

  setPoints(points: readonly Point2D[], closed?: boolean): void {
    this.points = points;
    if (closed !== undefined) {
      this.closed = closed;
    }

    this.bodyMesh.dispose();
    this.bodyMesh = this.createBodyMesh();

    if (this.strokeMesh) {
      this.rebuildStrokeMesh();
    }
  }

  setCanvasSize(width: number, height: number): void {
    this.bodyMaterialInstance.setCanvasSize(width, height);
    if (this.strokeMaterialInstance) {
      this.strokeMaterialInstance.setCanvasSize(width, height);
    }
  }

  //===========================================================================
  // Mesh Creation (Private)
  //===========================================================================

  private createBodyMesh(): RawMesh {
    const contour: number[] = [];
    for (const [x, y] of this.points) {
      contour.push(x, y);
    }

    const indices = earcut(contour, undefined, 2);
    const positions: number[] = [];
    const uvs: number[] = [];

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of this.points) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    const width = maxX - minX || 1;
    const height = maxY - minY || 1;

    for (const [x, y] of this.points) {
      positions.push(x, y);
      uvs.push((x - minX) / width, (y - minY) / height);
    }

    const positionBuffer = createBuffer(this.device, new Float32Array(positions), GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);
    const uvBuffer = createBuffer(this.device, new Float32Array(uvs), GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);
    const indexBuffer = createBuffer(this.device, new Uint32Array(indices), GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST);

    return new RawMesh({
      vertexBuffers: {
        position: positionBuffer,
        uv: uvBuffer,
      },
      indexBuffer,
      indexCount: indices.length,
      indexFormat: 'uint32',
    });
  }

  private createStrokeMesh(): RawMesh {
    const strokeData = generateStrokeMesh(this.points, this._strokeThickness, this.closed);

    const positionBuffer = createBuffer(this.device, strokeData.positions, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);
    const uvBuffer = createBuffer(this.device, strokeData.uvs, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);
    const indexBuffer = createBuffer(this.device, strokeData.indices, GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST);

    return new RawMesh({
      vertexBuffers: {
        position: positionBuffer,
        uv: uvBuffer,
        strokeNormal: createBuffer(this.device, strokeData.normals, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST),
        strokeSide: createBuffer(this.device, strokeData.sides, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST),
        strokeArcLength: createBuffer(this.device, strokeData.arcLengths, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST),
        strokeNormalizedArc: createBuffer(this.device, strokeData.normalizedArcs, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST),
        strokeMiterFactor: createBuffer(this.device, strokeData.miterFactors, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST),
      },
      indexBuffer,
      indexCount: strokeData.indices.length,
      indexFormat: 'uint32',
    });
  }

  private rebuildStrokeMesh(): void {
    if (!this.strokeMesh || !this.strokeMaterialInstance) return;
    this.strokeMesh.dispose();
    this.strokeMesh = this.createStrokeMesh();
  }

  private applyShapeTransform(): void {
    const translate: readonly [number, number] = [this._x, this._y];
    const scale: readonly [number, number] = [this._scaleX, this._scaleY];
    this.bodyMaterialInstance.setBuiltins({
      power2d_shapeTranslate: translate,
      power2d_shapeRotation: this._rotation,
      power2d_shapeScale: scale,
      power2d_canvasWidth: this.scene.width,
      power2d_canvasHeight: this.scene.height,
    });

    if (this.strokeMaterialInstance) {
      this.strokeMaterialInstance.setBuiltins({
        power2d_shapeTranslate: translate,
        power2d_shapeRotation: this._rotation,
        power2d_shapeScale: scale,
        power2d_canvasWidth: this.scene.width,
        power2d_canvasHeight: this.scene.height,
      });
    }
  }

  //===========================================================================
  // Disposal
  //===========================================================================

  dispose(): void {
    this.scene.removeShape(this);
    this.bodyMesh.dispose();
    this.bodyMaterialInstance.dispose();
    if (this.strokeMesh) {
      this.strokeMesh.dispose();
    }
    if (this.strokeMaterialInstance) {
      this.strokeMaterialInstance.dispose();
    }
  }
}
