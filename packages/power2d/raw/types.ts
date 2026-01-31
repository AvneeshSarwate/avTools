/// <reference lib="dom" />

export type TextureSource = GPUTexture | GPUTextureView;

export interface Power2DBuiltins {
  power2d_shapeTranslate: readonly [number, number];
  power2d_shapeRotation: number;
  power2d_shapeScale: readonly [number, number];
  power2d_canvasWidth: number;
  power2d_canvasHeight: number;
  power2d_strokeThickness?: number;
}

export interface MaterialInstance<U, T extends string> {
  pipeline: GPURenderPipeline;
  bindGroup: GPUBindGroup;
  attributeOrder: readonly string[];
  setUniforms(uniforms: Partial<U>): void;
  setBuiltins(uniforms: Partial<Power2DBuiltins>): void;
  setTexture(name: T, texture: TextureSource): void;
  setCanvasSize(width: number, height: number): void;
  dispose(): void;
}

export interface MaterialDef<U, T extends string> {
  readonly createMaterial: (device: GPUDevice, format: GPUTextureFormat, name?: string) => MaterialInstance<U, T>;
  readonly uniformDefaults: U;
  readonly textureNames: readonly T[];
}

export type MaterialUniforms<M> = M extends MaterialDef<infer U, infer _T> ? U : never;
export type MaterialTextureNames<M> = M extends MaterialDef<unknown, infer T> ? T : never;
export type MaterialInstanceOf<M> = M extends MaterialDef<unknown, infer _T> ? ReturnType<M['createMaterial']> : never;

export interface InstanceAttrLayout<I> {
  size: number;
  members: Array<{
    name: keyof I;
    offset: number;
    floatCount: number;
  }>;
}

export interface BatchMaterialDef<U, T extends string, I> extends MaterialDef<U, T> {
  readonly instanceAttrLayout: InstanceAttrLayout<I>;
}

export type BatchInstanceAttrs<M> = M extends { instanceAttrLayout: InstanceAttrLayout<infer I> } ? I : never;

export interface Power2DRenderable {
  alphaIndex: number;
  beforeRender?: () => void;
  render(pass: GPURenderPassEncoder): void;
}

export interface Power2DScene {
  device: GPUDevice;
  format: GPUTextureFormat;
  width: number;
  height: number;
  addShape(shape: Power2DRenderable): void;
  removeShape(shape: Power2DRenderable): void;
  render(): GPUTextureView;
  resize(width: number, height: number): void;
  outputTexture: GPUTexture;
  outputView: GPUTextureView;
}

export type { Point2D, StrokeMeshData } from '../core/types.ts';
