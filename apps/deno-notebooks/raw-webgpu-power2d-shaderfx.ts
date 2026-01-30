/// <reference lib="dom" />

import { encodePNG } from '@img/png';
import {
  createPower2DScene,
  selectPower2DFormat,
  StyledShape,
  type MaterialDef,
  type MaterialInstance,
} from '@avtools/power2d/raw';
import { CustomShaderEffect, type MaterialHandles } from '@avtools/shader-fx/raw';

const width = 256;
const height = 256;

console.log('Requesting WebGPU adapter...');
const adapter = await Promise.race([
  navigator.gpu?.requestAdapter(),
  new Promise<null>((_, reject) => setTimeout(() => reject(new Error('requestAdapter timed out')), 5000)),
]);
if (!adapter) {
  console.error('No WebGPU adapter available');
  Deno.exit(1);
}

console.log('Requesting WebGPU device...');
const device = await Promise.race([
  adapter.requestDevice(),
  new Promise<GPUDevice>((_, reject) => setTimeout(() => reject(new Error('requestDevice timed out')), 5000)),
]);

const format = await selectPower2DFormat(device, ['rgba16float', 'rgba32float', 'rgba8unorm']);
console.log(`Using render format: ${format}`);

device.addEventListener('uncapturederror', (event) => {
  console.error('WebGPU uncaptured error:', event);
});

interface BasicUniforms {
  color: readonly [number, number, number, number];
}

const POWER2D_WGSL = `
struct Uniforms {
  color: vec4f,
  shapeTranslate: vec2f,
  shapeRotation: f32,
  _pad0: f32,
  shapeScale: vec2f,
  canvasSize: vec2f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInput {
  @location(0) position: vec2f,
  @location(1) uv: vec2f,
};

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(input: VertexInput) -> VertexOutput {
  var out: VertexOutput;
  let scaled = input.position * uniforms.shapeScale;
  let s = sin(uniforms.shapeRotation);
  let c = cos(uniforms.shapeRotation);
  let rotated = vec2f(
    scaled.x * c - scaled.y * s,
    scaled.x * s + scaled.y * c,
  );
  let pixel = rotated + uniforms.shapeTranslate;
  let ndcX = (pixel.x / uniforms.canvasSize.x) * 2.0 - 1.0;
  let ndcY = -((pixel.y / uniforms.canvasSize.y) * 2.0 - 1.0);
  out.position = vec4f(ndcX, ndcY, 0.0, 1.0);
  out.uv = input.uv;
  return out;
}

@fragment
fn fs(input: VertexOutput) -> @location(0) vec4f {
  return uniforms.color;
}
`;

function createBasicMaterial(): MaterialDef<BasicUniforms, never> {
  return {
    uniformDefaults: { color: [1, 0, 0, 1] },
    textureNames: [],
    createMaterial: (deviceRef, targetFormat) => {
      const uniformData = new Float32Array(12);
      uniformData.set([1, 0, 0, 1], 0);
      uniformData.set([0, 0], 4);
      uniformData[6] = 0;
      uniformData[7] = 0;
      uniformData.set([1, 1], 8);
      uniformData.set([width, height], 10);

      const uniformBuffer = deviceRef.createBuffer({
        size: uniformData.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      deviceRef.queue.writeBuffer(uniformBuffer, 0, uniformData);

      const bindGroupLayout = deviceRef.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: 'uniform' },
          },
        ],
      });

      const pipelineLayout = deviceRef.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout],
      });

      const shaderModule = deviceRef.createShaderModule({ code: POWER2D_WGSL });

      const pipeline = deviceRef.createRenderPipeline({
        layout: pipelineLayout,
        vertex: {
          module: shaderModule,
          entryPoint: 'vs',
          buffers: [
            {
              arrayStride: 8,
              attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }],
            },
            {
              arrayStride: 8,
              attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x2' }],
            },
          ],
        },
        fragment: {
          module: shaderModule,
          entryPoint: 'fs',
          targets: [{ format: targetFormat }],
        },
        primitive: {
          topology: 'triangle-list',
          cullMode: 'none',
        },
      });

      let bindGroup = deviceRef.createBindGroup({
        layout: bindGroupLayout,
        entries: [
          {
            binding: 0,
            resource: { buffer: uniformBuffer },
          },
        ],
      });

      const writeUniforms = () => {
        deviceRef.queue.writeBuffer(uniformBuffer, 0, uniformData);
      };

      const instance: MaterialInstance<BasicUniforms, never> = {
        pipeline,
        bindGroup,
        attributeOrder: ['position', 'uv'],
        setUniforms: (uniforms) => {
          if (uniforms.color) {
            uniformData.set(uniforms.color, 0);
            writeUniforms();
          }
        },
        setBuiltins: (uniforms) => {
          if (uniforms.power2d_shapeTranslate) {
            uniformData.set(uniforms.power2d_shapeTranslate, 4);
          }
          if (uniforms.power2d_shapeRotation !== undefined) {
            uniformData[6] = uniforms.power2d_shapeRotation;
          }
          if (uniforms.power2d_shapeScale) {
            uniformData.set(uniforms.power2d_shapeScale, 8);
          }
          if (uniforms.power2d_canvasWidth !== undefined) {
            uniformData[10] = uniforms.power2d_canvasWidth;
          }
          if (uniforms.power2d_canvasHeight !== undefined) {
            uniformData[11] = uniforms.power2d_canvasHeight;
          }
          writeUniforms();
        },
        setTexture: () => {},
        setCanvasSize: (w, h) => {
          uniformData[10] = w;
          uniformData[11] = h;
          writeUniforms();
        },
        dispose: () => {
          uniformBuffer.destroy();
        },
      };

      return instance;
    },
  };
}

console.log('Creating power2d scene...');
const scene = createPower2DScene({
  device,
  width,
  height,
  format,
  clearColor: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
});

const rectW = width * 0.6;
const rectH = height * 0.4;
const rectPoints: Array<[number, number]> = [
  [0, 0],
  [rectW, 0],
  [rectW, rectH],
  [0, rectH],
];

const shape = new StyledShape({
  scene,
  points: rectPoints,
  bodyMaterial: createBasicMaterial(),
});
shape.x = width * 0.2;
shape.y = height * 0.3;
shape.body.setUniforms({ color: [0.1, 0.8, 0.2, 1] });

scene.render();
console.log('Rendered power2d scene');

const POST_WGSL = `
@group(0) @binding(0) var srcSampler: sampler;
@group(0) @binding(1) var srcTex: texture_2d<f32>;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) index: u32) -> VertexOutput {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0),
  );
  var uvs = array<vec2f, 3>(
    vec2f(0.0, 0.0),
    vec2f(2.0, 0.0),
    vec2f(0.0, 2.0),
  );
  var out: VertexOutput;
  out.position = vec4f(positions[index], 0.0, 1.0);
  out.uv = uvs[index];
  return out;
}

@fragment
fn fs(input: VertexOutput) -> @location(0) vec4f {
  let color = textureSample(srcTex, srcSampler, input.uv);
  return vec4f(1.0 - color.rgb, color.a);
}
`;

function createPostMaterial(deviceRef: GPUDevice, targetFormat: GPUTextureFormat): MaterialHandles<Record<string, never>, 'src'> {
  const sampler = deviceRef.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
  });

  const bindGroupLayout = deviceRef.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: 'filtering' },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: 'float' },
      },
    ],
  });

  const pipelineLayout = deviceRef.createPipelineLayout({
    bindGroupLayouts: [bindGroupLayout],
  });

  const shaderModule = deviceRef.createShaderModule({ code: POST_WGSL });

  const pipeline = deviceRef.createRenderPipeline({
    layout: pipelineLayout,
    vertex: {
      module: shaderModule,
      entryPoint: 'vs',
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fs',
      targets: [{ format: targetFormat }],
    },
    primitive: {
      topology: 'triangle-list',
      cullMode: 'none',
    },
  });

  let currentView: GPUTextureView | null = null;
  let bindGroup = deviceRef.createBindGroup({
    layout: bindGroupLayout,
    entries: [
      { binding: 0, resource: sampler },
      { binding: 1, resource: deviceRef.createTexture({
        size: { width: 1, height: 1 },
        format: targetFormat,
        usage: GPUTextureUsage.TEXTURE_BINDING,
      }).createView() },
    ],
  });

  const updateBindGroup = () => {
    if (!currentView) return;
    bindGroup = deviceRef.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: currentView },
      ],
    });
  };

  return {
    pipeline,
    get bindGroup() {
      return bindGroup;
    },
    setTexture: (_name, texture) => {
      currentView = texture;
      updateBindGroup();
    },
    setUniforms: () => {},
  };
}

const effect = new CustomShaderEffect(device, { src: scene.outputTexture }, {
  factory: createPostMaterial,
  textureInputKeys: ['src'],
  width,
  height,
  format,
  clearColor: { r: 0, g: 0, b: 0, a: 1 },
});

effect.render();
console.log('Rendered shader-fx pass');

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function halfToFloat(bits: number): number {
  const sign = (bits & 0x8000) ? -1 : 1;
  const exp = (bits >> 10) & 0x1f;
  const frac = bits & 0x03ff;
  if (exp === 0) {
    return sign * Math.pow(2, -14) * (frac / 1024);
  }
  if (exp === 31) {
    return frac === 0 ? sign * Infinity : NaN;
  }
  return sign * Math.pow(2, exp - 15) * (1 + frac / 1024);
}

async function writeTextureToPng(
  deviceRef: GPUDevice,
  texture: GPUTexture,
  outPath: string,
  textureFormat: GPUTextureFormat,
): Promise<void> {
  const bytesPerPixel = textureFormat === 'rgba16float' ? 8 : textureFormat === 'rgba32float' ? 16 : 4;
  const bytesPerRow = align(width * bytesPerPixel, 256);
  const bufferSize = bytesPerRow * height;
  const readBuffer = deviceRef.createBuffer({
    size: bufferSize,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  deviceRef.pushErrorScope('validation');
  deviceRef.pushErrorScope('out-of-memory');

  const encoder = deviceRef.createCommandEncoder();
  encoder.copyTextureToBuffer(
    { texture },
    { buffer: readBuffer, bytesPerRow, rowsPerImage: height },
    { width, height, depthOrArrayLayers: 1 },
  );
  deviceRef.queue.submit([encoder.finish()]);
  const oomError = await deviceRef.popErrorScope();
  const validationError = await deviceRef.popErrorScope();
  if (oomError) {
    console.error('GPU out-of-memory error:', oomError);
  }
  if (validationError) {
    console.error('GPU validation error:', validationError);
  }

  console.log('Mapping readback buffer...');
  await Promise.race([
    readBuffer.mapAsync(GPUMapMode.READ),
    new Promise<void>((_, reject) => setTimeout(() => reject(new Error('mapAsync timed out')), 10000)),
  ]);
  const mapped = readBuffer.getMappedRange();
  const out = new Uint8Array(width * height * 4);
  const floatPixels = new Float32Array(width * height * 4);

  if (textureFormat === 'rgba16float') {
    const src16 = new Uint16Array(mapped);
    const rowStride = bytesPerRow / 2;
    for (let y = 0; y < height; y += 1) {
      const rowStart = y * rowStride;
      for (let x = 0; x < width; x += 1) {
        const srcIndex = rowStart + x * 4;
        const dstIndex = (y * width + x) * 4;
        const r = halfToFloat(src16[srcIndex]);
        const g = halfToFloat(src16[srcIndex + 1]);
        const b = halfToFloat(src16[srcIndex + 2]);
        const a = halfToFloat(src16[srcIndex + 3]);
        floatPixels[dstIndex] = r;
        floatPixels[dstIndex + 1] = g;
        floatPixels[dstIndex + 2] = b;
        floatPixels[dstIndex + 3] = a;
        out[dstIndex] = Math.max(0, Math.min(255, Math.round(r * 255)));
        out[dstIndex + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
        out[dstIndex + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
        out[dstIndex + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
      }
    }
  } else if (textureFormat === 'rgba32float') {
    const src32 = new Float32Array(mapped);
    const rowStride = bytesPerRow / 4;
    for (let y = 0; y < height; y += 1) {
      const rowStart = y * rowStride;
      for (let x = 0; x < width; x += 1) {
        const srcIndex = rowStart + x * 4;
        const dstIndex = (y * width + x) * 4;
        const r = src32[srcIndex];
        const g = src32[srcIndex + 1];
        const b = src32[srcIndex + 2];
        const a = src32[srcIndex + 3];
        floatPixels[dstIndex] = r;
        floatPixels[dstIndex + 1] = g;
        floatPixels[dstIndex + 2] = b;
        floatPixels[dstIndex + 3] = a;
        out[dstIndex] = Math.max(0, Math.min(255, Math.round(r * 255)));
        out[dstIndex + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
        out[dstIndex + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
        out[dstIndex + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
      }
    }
  } else {
    const src8 = new Uint8Array(mapped);
    const rowStride = bytesPerRow;
    for (let y = 0; y < height; y += 1) {
      const rowStart = y * rowStride;
      for (let x = 0; x < width; x += 1) {
        const srcIndex = rowStart + x * 4;
        const dstIndex = (y * width + x) * 4;
        floatPixels[dstIndex] = src8[srcIndex] / 255;
        floatPixels[dstIndex + 1] = src8[srcIndex + 1] / 255;
        floatPixels[dstIndex + 2] = src8[srcIndex + 2] / 255;
        floatPixels[dstIndex + 3] = src8[srcIndex + 3] / 255;
        out[dstIndex] = src8[srcIndex];
        out[dstIndex + 1] = src8[srcIndex + 1];
        out[dstIndex + 2] = src8[srcIndex + 2];
        out[dstIndex + 3] = src8[srcIndex + 3];
      }
    }
  }

  const epsilon = 0.02;
  const insideExpected: [number, number, number, number] = [0.9, 0.2, 0.8, 1.0];
  const outsideExpected: [number, number, number, number] = [0.9, 0.9, 0.9, 1.0];

  const insidePoint: [number, number] = [Math.floor(width * 0.5), Math.floor(height * 0.5)];
  const outsidePoint: [number, number] = [Math.floor(width * 0.05), Math.floor(height * 0.05)];

  function sampleFloat(x: number, y: number): [number, number, number, number] {
    const idx = (y * width + x) * 4;
    return [
      floatPixels[idx],
      floatPixels[idx + 1],
      floatPixels[idx + 2],
      floatPixels[idx + 3],
    ];
  }

  function closeEnough(actual: number[], expected: number[]): boolean {
    return actual.every((value, idx) => Math.abs(value - expected[idx]) <= epsilon);
  }

  const insideSample = sampleFloat(insidePoint[0], insidePoint[1]);
  const outsideSample = sampleFloat(outsidePoint[0], outsidePoint[1]);

  const insideOk = closeEnough(insideSample, insideExpected);
  const outsideOk = closeEnough(outsideSample, outsideExpected);

  console.log('Float readback check:');
  console.log(`  inside @ ${insidePoint[0]},${insidePoint[1]} =`, insideSample, 'expected', insideExpected, insideOk ? 'OK' : 'FAIL');
  console.log(`  outside @ ${outsidePoint[0]},${outsidePoint[1]} =`, outsideSample, 'expected', outsideExpected, outsideOk ? 'OK' : 'FAIL');

  readBuffer.unmap();
  readBuffer.destroy();

  await Deno.mkdir('.output', { recursive: true });
  const png = await encodePNG(out, {
    width,
    height,
    compression: 0,
    filter: 0,
    interlace: 0,
  });
  await Deno.writeFile(outPath, png);
}

await writeTextureToPng(device, effect.outputTexture, '.output/raw-webgpu-output.png', format);

console.log('Wrote .output/raw-webgpu-output.png');
