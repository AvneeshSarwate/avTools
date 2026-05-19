import { expectedBc3ByteLength } from '../hap/decoder'

export async function createHapDevice(): Promise<GPUDevice> {
  if (!navigator.gpu) throw new Error('WebGPU is not available in this browser.')

  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) throw new Error('No WebGPU adapter found.')
  if (!adapter.features.has('texture-compression-bc')) {
    throw new Error('This WebGPU adapter does not expose texture-compression-bc.')
  }

  const device = await adapter.requestDevice({
    requiredFeatures: ['texture-compression-bc'],
  })
  device.addEventListener('uncapturederror', (event) => {
    const gpuEvent = event as unknown as { error: { message: string } }
    console.error('[webHapSampler] WebGPU error:', gpuEvent.error.message)
  })
  return device
}

const shaderCode = `
struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  var uvs = array<vec2<f32>, 3>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(2.0, 1.0),
    vec2<f32>(0.0, -1.0)
  );
  var out: VertexOut;
  out.position = vec4<f32>(positions[vertexIndex], 0.0, 1.0);
  out.uv = uvs[vertexIndex];
  return out;
}

@group(0) @binding(0)
var hapTex: texture_2d<f32>;

@group(0) @binding(1)
var hapSampler: sampler;

fn scaledYCoCgToRgb(sampled: vec4<f32>) -> vec3<f32> {
  let scale = (sampled.b * (255.0 / 8.0)) + 1.0;
  let center = 0.5 * (256.0 / 255.0);
  let co = (sampled.r - center) / scale;
  let cg = (sampled.g - center) / scale;
  let y = sampled.a;
  return clamp(vec3<f32>(
    y + co - cg,
    y + cg,
    y - co - cg
  ), vec3<f32>(0.0), vec3<f32>(1.0));
}

@fragment
fn fsMain(in: VertexOut) -> @location(0) vec4<f32> {
  let sampled = textureSample(hapTex, hapSampler, in.uv);
  return vec4<f32>(scaledYCoCgToRgb(sampled), 1.0);
}
`

export class HapWebGpuRenderer {
  private readonly context: GPUCanvasContext
  private readonly pipeline: GPURenderPipeline
  private readonly sampler: GPUSampler
  private readonly textures: GPUTexture[]
  private readonly bindGroups: GPUBindGroup[]
  private readonly presentationFormat: GPUTextureFormat
  private nextTexture = 0
  private currentBindGroup = 0
  private destroyed = false

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly device: GPUDevice,
    private readonly width: number,
    private readonly height: number,
  ) {
    const context = canvas.getContext('webgpu')
    if (!context) throw new Error('Could not create a WebGPU canvas context.')
    this.context = context
    const gpu = navigator.gpu
    if (!gpu) throw new Error('WebGPU is not available in this browser.')
    this.presentationFormat = gpu.getPreferredCanvasFormat()
    this.context.configure({
      device,
      format: this.presentationFormat,
      alphaMode: 'opaque',
    })

    const module = device.createShaderModule({ code: shaderCode })
    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vsMain' },
      fragment: {
        module,
        entryPoint: 'fsMain',
        targets: [{ format: this.presentationFormat }],
      },
      primitive: { topology: 'triangle-list' },
    })

    this.sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    })

    this.textures = Array.from({ length: 3 }, () =>
      device.createTexture({
        size: { width, height, depthOrArrayLayers: 1 },
        format: 'bc3-rgba-unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      }),
    )

    this.bindGroups = this.textures.map((texture) =>
      device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: texture.createView() },
          { binding: 1, resource: this.sampler },
        ],
      }),
    )
  }

  resize() {
    const dpr = window.devicePixelRatio || 1
    const rect = this.canvas.getBoundingClientRect()
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr))
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr))
  }

  uploadFrame(bcBytes: Uint8Array) {
    if (this.destroyed) return
    const expected = expectedBc3ByteLength(this.width, this.height)
    if (bcBytes.byteLength !== expected) {
      throw new Error(`Cannot upload BC3 frame. Expected ${expected}, got ${bcBytes.byteLength}.`)
    }

    const textureIndex = this.nextTexture
    const texture = this.textures[textureIndex]
    const blockWidth = Math.ceil(this.width / 4)
    const blockHeight = Math.ceil(this.height / 4)
    this.device.queue.writeTexture(
      { texture },
      bcBytes,
      {
        bytesPerRow: blockWidth * 16,
        rowsPerImage: blockHeight,
      },
      {
        width: this.width,
        height: this.height,
        depthOrArrayLayers: 1,
      },
    )
    this.currentBindGroup = textureIndex
    this.nextTexture = (this.nextTexture + 1) % this.textures.length
  }

  draw() {
    if (this.destroyed) return
    const encoder = this.device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0.02, g: 0.025, b: 0.03, a: 1 },
        },
      ],
    })
    pass.setPipeline(this.pipeline)
    pass.setBindGroup(0, this.bindGroups[this.currentBindGroup])
    pass.draw(3)
    pass.end()
    this.device.queue.submit([encoder.finish()])
  }

  destroy() {
    this.destroyed = true
    for (const texture of this.textures) texture.destroy()
  }
}
