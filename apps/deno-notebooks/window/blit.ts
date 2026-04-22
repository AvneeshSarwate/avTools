/// <reference lib="dom" />

const BLIT_SHADER = `struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VsOut {
  let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  var out: VsOut;
  out.pos = vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
  out.uv = uv;
  return out;
}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var srcSampler: sampler;

@fragment
fn fs(in: VsOut) -> @location(0) vec4f {
  // Match top-left canvas origin during present blit.
  return textureSample(src, srcSampler, vec2f(in.uv.x, 1.0 - in.uv.y));
}
`;

export interface BlitPipeline {
  pipeline: GPURenderPipeline;
  bindGroupLayout: GPUBindGroupLayout;
  sampler: GPUSampler;
}

export function createBlitPipeline(device: GPUDevice, targetFormat: GPUTextureFormat): BlitPipeline {
  const module = device.createShaderModule({ code: BLIT_SHADER });
  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
    ],
  });
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
  const pipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: { module, entryPoint: "vs" },
    fragment: { module, entryPoint: "fs", targets: [{ format: targetFormat }] },
    primitive: { topology: "triangle-list", cullMode: "none" },
  });

  const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });

  return { pipeline, bindGroupLayout, sampler };
}

export function blit(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  pipeline: BlitPipeline,
  src: GPUTextureView,
  dst: GPUTextureView,
): void {
  const bindGroup = device.createBindGroup({
    layout: pipeline.bindGroupLayout,
    entries: [
      { binding: 0, resource: src },
      { binding: 1, resource: pipeline.sampler },
    ],
  });

  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: dst,
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
      },
    ],
  });
  pass.setPipeline(pipeline.pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(3);
  pass.end();
}

export interface BlitViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function blitToViewport(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  pipeline: BlitPipeline,
  src: GPUTextureView,
  dst: GPUTextureView,
  viewport: BlitViewport,
): void {
  const bindGroup = device.createBindGroup({
    layout: pipeline.bindGroupLayout,
    entries: [
      { binding: 0, resource: src },
      { binding: 1, resource: pipeline.sampler },
    ],
  });

  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: dst,
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
      },
    ],
  });
  pass.setViewport(viewport.x, viewport.y, viewport.width, viewport.height, 0, 1);
  pass.setPipeline(pipeline.pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(3);
  pass.end();
}

// ── Alpha-blending variant ──────────────────────────────────────────
//
// Same shader as the basic blit, but the pipeline target has standard
// "source-over" alpha blending enabled, and `alphaBlit` uses `loadOp: "load"`
// so the destination is preserved. Use these to composite multiple textures
// onto the same target in draw order.

export function createAlphaBlitPipeline(device: GPUDevice, targetFormat: GPUTextureFormat): BlitPipeline {
  const module = device.createShaderModule({ code: BLIT_SHADER });
  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
    ],
  });
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
  const pipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: { module, entryPoint: "vs" },
    fragment: {
      module,
      entryPoint: "fs",
      targets: [{
        format: targetFormat,
        blend: {
          color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
          alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
        },
      }],
    },
    primitive: { topology: "triangle-list", cullMode: "none" },
  });

  const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });

  return { pipeline, bindGroupLayout, sampler };
}

export function alphaBlit(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  pipeline: BlitPipeline,
  src: GPUTextureView,
  dst: GPUTextureView,
): void {
  const bindGroup = device.createBindGroup({
    layout: pipeline.bindGroupLayout,
    entries: [
      { binding: 0, resource: src },
      { binding: 1, resource: pipeline.sampler },
    ],
  });

  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: dst,
        loadOp: "load",
        storeOp: "store",
      },
    ],
  });
  pass.setPipeline(pipeline.pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(3);
  pass.end();
}
