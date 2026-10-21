/// <reference path="./td-runtime.d.ts" />
/// <reference path="./td-types/webgpu.d.ts" />
/** TOP-only Dawn globals. Mixed projects opt into this union profile. */
declare var GPU: {
  prototype: GPU;
};
declare var GPUAdapter: {
  prototype: GPUAdapter;
};
declare var GPUAdapterInfo: {
  prototype: GPUAdapterInfo;
};
declare var GPUBindGroup: {
  prototype: GPUBindGroup;
};
declare var GPUBindGroupLayout: {
  prototype: GPUBindGroupLayout;
};
declare var GPUBuffer: {
  prototype: GPUBuffer;
};
declare var GPUCanvasContext: {
  prototype: GPUCanvasContext;
};
declare var GPUCommandBuffer: {
  prototype: GPUCommandBuffer;
};
declare var GPUCommandEncoder: {
  prototype: GPUCommandEncoder;
};
declare var GPUCompilationInfo: {
  prototype: GPUCompilationInfo;
};
declare var GPUCompilationMessage: {
  prototype: GPUCompilationMessage;
};
declare var GPUComputePassEncoder: {
  prototype: GPUComputePassEncoder;
};
declare var GPUComputePipeline: {
  prototype: GPUComputePipeline;
};
declare var GPUDevice: {
  prototype: GPUDevice;
};
declare var GPUDeviceLostInfo: {
  prototype: GPUDeviceLostInfo;
};
declare var GPUError: {
  prototype: GPUError;
};
declare var GPUExternalTexture: {
  prototype: GPUExternalTexture;
};
declare var GPUInternalError: { prototype: GPUInternalError; };
declare var GPUOutOfMemoryError: { prototype: GPUOutOfMemoryError; };
declare var GPUPipelineError: {
  prototype: GPUPipelineError;
  new (
    message:
      | string
      | undefined,
    options: GPUPipelineErrorInit
  ): GPUPipelineError;
};
declare var GPUPipelineLayout: {
  prototype: GPUPipelineLayout;
};
declare var GPUQuerySet: {
  prototype: GPUQuerySet;
};
declare var GPUQueue: {
  prototype: GPUQueue;
};
declare var GPURenderBundle: {
  prototype: GPURenderBundle;
};
declare var GPURenderBundleEncoder: {
  prototype: GPURenderBundleEncoder;
};
declare var GPURenderPassEncoder: {
  prototype: GPURenderPassEncoder;
};
declare var GPURenderPipeline: {
  prototype: GPURenderPipeline;
};
declare var GPUSampler: {
  prototype: GPUSampler;
};
declare var GPUShaderModule: {
  prototype: GPUShaderModule;
};
declare var GPUSupportedLimits: {
  prototype: GPUSupportedLimits;
};
declare var GPUTexture: {
  prototype: GPUTexture;
};
declare var GPUTextureView: {
  prototype: GPUTextureView;
};
declare var GPUUncapturedErrorEvent: {
  prototype: GPUUncapturedErrorEvent;
  new (
    type: string,
    gpuUncapturedErrorEventInitDict: GPUUncapturedErrorEventInit
  ): GPUUncapturedErrorEvent;
};
declare var GPUValidationError: { prototype: GPUValidationError; };
declare var GPUBufferUsage: GPUBufferUsage;
declare var GPUColorWrite: GPUColorWrite;
declare var GPUMapMode: GPUMapMode;
declare var GPUShaderStage: GPUShaderStage;
declare var GPUTextureUsage: GPUTextureUsage;
