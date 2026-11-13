/// <reference lib="dom" />

export async function requestHapWebGpuDevice(): Promise<GPUDevice> {
  if (!navigator.gpu) {
    throw new Error("WebGPU is not available in this Deno runtime.");
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error("No WebGPU adapter found.");
  }
  if (!adapter.features.has("texture-compression-bc")) {
    throw new Error("This WebGPU adapter does not expose texture-compression-bc.");
  }
  const device = await adapter.requestDevice({
    requiredFeatures: ["texture-compression-bc"],
  });
  device.addEventListener("uncapturederror", (event) => {
    const gpuEvent = event as unknown as { error: { message: string } };
    console.error("[hap] WebGPU error:", gpuEvent.error.message);
  });
  return device;
}

export function expectedBc3ByteLength(width: number, height: number): number {
  return Math.ceil(width / 4) * Math.ceil(height / 4) * 16;
}

const HAP_SHADER = `
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
  let dims = vec2<f32>(textureDimensions(hapTex));
  let coord = vec2<i32>(clamp(in.uv * dims, vec2<f32>(0.0), dims - vec2<f32>(1.0)));
  let sampled = textureLoad(hapTex, coord, 0);
  return vec4<f32>(scaledYCoCgToRgb(sampled), 1.0);
}
`;

export interface HapGpuRendererOptions {
  device: GPUDevice;
  videoWidth: number;
  videoHeight: number;
  outputWidth: number;
  outputHeight: number;
  outputFormat: GPUTextureFormat;
}

export class HapGpuRenderer {
  readonly outputFormat: GPUTextureFormat;
  readonly outputWidth: number;
  readonly outputHeight: number;

  #device: GPUDevice;
  #videoWidth: number;
  #videoHeight: number;
  #pipeline: GPURenderPipeline;
  #textures: GPUTexture[];
  #bindGroups: GPUBindGroup[];
  #outputTexture: GPUTexture;
  #nextTexture = 0;
  #currentBindGroup = 0;
  #destroyed = false;

  constructor(options: HapGpuRendererOptions) {
    this.#device = options.device;
    this.#videoWidth = options.videoWidth;
    this.#videoHeight = options.videoHeight;
    this.outputWidth = options.outputWidth;
    this.outputHeight = options.outputHeight;
    this.outputFormat = options.outputFormat;

    const module = this.#device.createShaderModule({ label: "hap scaled-ycocg shader", code: HAP_SHADER });
    this.#pipeline = this.#device.createRenderPipeline({
      label: "hap bc3 decode pipeline",
      layout: "auto",
      vertex: { module, entryPoint: "vsMain" },
      fragment: {
        module,
        entryPoint: "fsMain",
        targets: [{ format: this.outputFormat }],
      },
      primitive: { topology: "triangle-list" },
    });

    this.#textures = Array.from({ length: 3 }, (_, index) =>
      this.#device.createTexture({
        label: `hap bc3 frame texture ${index}`,
        size: { width: this.#videoWidth, height: this.#videoHeight, depthOrArrayLayers: 1 },
        format: "bc3-rgba-unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      })
    );

    this.#bindGroups = this.#textures.map((texture) =>
      this.#device.createBindGroup({
        label: "hap bc3 texture bind group",
        layout: this.#pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: texture.createView() },
        ],
      })
    );

    this.#outputTexture = this.#createOutputTexture();
  }

  get outputTexture(): GPUTexture {
    return this.#outputTexture;
  }

  uploadFrame(bcBytes: Uint8Array<ArrayBuffer>): void {
    if (this.#destroyed) {
      return;
    }
    const expected = expectedBc3ByteLength(this.#videoWidth, this.#videoHeight);
    if (bcBytes.byteLength !== expected) {
      throw new Error(`Cannot upload BC3 frame. Expected ${expected}, got ${bcBytes.byteLength}.`);
    }

    const textureIndex = this.#nextTexture;
    const texture = this.#textures[textureIndex];
    const blockWidth = Math.ceil(this.#videoWidth / 4);
    const blockHeight = Math.ceil(this.#videoHeight / 4);
    this.#device.queue.writeTexture(
      { texture },
      bcBytes,
      {
        bytesPerRow: blockWidth * 16,
        rowsPerImage: blockHeight,
      },
      {
        width: this.#videoWidth,
        height: this.#videoHeight,
        depthOrArrayLayers: 1,
      },
    );
    this.#currentBindGroup = textureIndex;
    this.#nextTexture = (this.#nextTexture + 1) % this.#textures.length;
  }

  render(): GPUTexture {
    if (this.#destroyed) {
      return this.#outputTexture;
    }
    const encoder = this.#device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.#outputTexture.createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    });
    const viewport = containViewport(
      this.#videoWidth,
      this.#videoHeight,
      this.outputWidth,
      this.outputHeight,
    );
    pass.setViewport(viewport.x, viewport.y, viewport.width, viewport.height, 0, 1);
    pass.setPipeline(this.#pipeline);
    pass.setBindGroup(0, this.#bindGroups[this.#currentBindGroup]);
    pass.draw(3);
    pass.end();
    this.#device.queue.submit([encoder.finish()]);
    return this.#outputTexture;
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }
    this.#destroyed = true;
    for (const texture of this.#textures) {
      texture.destroy();
    }
    this.#outputTexture.destroy();
  }

  #createOutputTexture(): GPUTexture {
    return this.#device.createTexture({
      label: "hap rgba output texture",
      size: { width: this.outputWidth, height: this.outputHeight, depthOrArrayLayers: 1 },
      format: this.outputFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
  }
}

function containViewport(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): { x: number; y: number; width: number; height: number } {
  const sourceAspect = sourceWidth / sourceHeight;
  const targetAspect = targetWidth / targetHeight;
  let width = targetWidth;
  let height = targetHeight;
  if (sourceAspect > targetAspect) {
    height = targetWidth / sourceAspect;
  } else {
    width = targetHeight * sourceAspect;
  }
  return {
    x: (targetWidth - width) * 0.5,
    y: (targetHeight - height) * 0.5,
    width,
    height,
  };
}
