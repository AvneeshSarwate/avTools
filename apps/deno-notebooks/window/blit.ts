/// <reference lib="dom" />

const BLIT_SHADER = `@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let uv = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var srcSampler: sampler;

@fragment
fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let dims = vec2f(textureDimensions(src));
  let uv = pos.xy / dims;
  return textureSample(src, srcSampler, uv);
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
