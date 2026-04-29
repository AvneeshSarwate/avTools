/// <reference lib="dom" />

import {
  ShaderEffect,
  type ShaderSource,
  type ShaderUniforms,
} from "@avtools/shader-fx/raw";

export interface NtscVhsInputs extends Record<string, ShaderSource> {
  src: ShaderSource;
}

export interface NtscVhsSettings {
  lumaSmear: number;
  chromaBlur: number;
  chromaDelayX: number;
  chromaDelayY: number;
  compositeSharpness: number;
  ringingIntensity: number;
  ringingFrequency: number;
  vhsSharpen: number;
  scanlineIntensity: number;
  edgeWaveIntensity: number;
  edgeWaveFrequency: number;
  edgeWaveSpeed: number;
  headSwitchingHeight: number;
  headSwitchingShift: number;
  noiseIntensity: number;
  snowDensity: number;
  snowStrength: number;
  chromaPhaseError: number;
  chromaLossDensity: number;
  chromaLossAmount: number;
  verticalBlend: number;
  tapeSpeed: number;
}

export const DEFAULT_NTSC_VHS_SETTINGS: NtscVhsSettings = {
  lumaSmear: 0.25,
  chromaBlur: 0.72,
  chromaDelayX: 2.0,
  chromaDelayY: 0.0,
  compositeSharpness: 0.65,
  ringingIntensity: 1.0,
  ringingFrequency: 0.42,
  vhsSharpen: 0.16,
  scanlineIntensity: 0.12,
  edgeWaveIntensity: 0.0,
  edgeWaveFrequency: 0.045,
  edgeWaveSpeed: 0.9,
  headSwitchingHeight: 0.0,
  headSwitchingShift: 0.0,
  noiseIntensity: 0.0,
  snowDensity: 0.0,
  snowStrength: 0.65,
  chromaPhaseError: 0.0,
  chromaLossDensity: 0.0,
  chromaLossAmount: 1.0,
  verticalBlend: 1.0,
  tapeSpeed: 1.0,
};

export const NTSC_RS_STABLE_APPROX_SETTINGS: NtscVhsSettings = {
  ...DEFAULT_NTSC_VHS_SETTINGS,
  lumaSmear: 0.0,
  chromaBlur: 0.30,
  chromaDelayX: 0.0,
  compositeSharpness: 1.55,
  ringingIntensity: 0.0,
  vhsSharpen: 0.16,
  scanlineIntensity: 0.0,
  edgeWaveIntensity: 0.0,
  headSwitchingHeight: 0.0,
  headSwitchingShift: 0.0,
  noiseIntensity: 0.0,
  snowDensity: 0.0,
  snowStrength: 0.65,
  chromaPhaseError: 0.0,
  chromaLossDensity: 0.0,
  chromaLossAmount: 1.0,
};

export const VHS_LOOK_SETTINGS: NtscVhsSettings = {
  ...NTSC_RS_STABLE_APPROX_SETTINGS,
  scanlineIntensity: 0.14,
  edgeWaveIntensity: 1.5,
  headSwitchingHeight: 10.0,
  headSwitchingShift: 28.0,
  noiseIntensity: 0.015,
  snowDensity: 0.0009,
  snowStrength: 0.65,
  chromaLossDensity: 0.002,
  chromaLossAmount: 1.0,
};

const UNIFORM_FLOAT_COUNT = 32;
const WORKGROUP_SIZE = 16;

const SHADER_SOURCE = /* wgsl */ `
struct NtscUniforms {
  size: vec2f,
  frame: f32,
  lumaSmear: f32,
  chromaBlur: f32,
  chromaDelayX: f32,
  chromaDelayY: f32,
  compositeSharpness: f32,
  ringingIntensity: f32,
  ringingFrequency: f32,
  vhsSharpen: f32,
  scanlineIntensity: f32,
  edgeWaveIntensity: f32,
  edgeWaveFrequency: f32,
  edgeWaveSpeed: f32,
  headSwitchingHeight: f32,
  headSwitchingShift: f32,
  noiseIntensity: f32,
  snowDensity: f32,
  snowStrength: f32,
  chromaPhaseError: f32,
  chromaLossDensity: f32,
  chromaLossAmount: f32,
  verticalBlend: f32,
  tapeSpeed: f32,
};

@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var encodeOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> uni: NtscUniforms;

@group(1) @binding(0) var yiqIn: texture_2d<f32>;
@group(1) @binding(1) var yiqOut: texture_storage_2d<rgba16float, write>;
@group(1) @binding(2) var<uniform> uniYiq: NtscUniforms;

@group(2) @binding(0) var compositeIn: texture_2d<f32>;
@group(2) @binding(1) var demodOut: texture_storage_2d<rgba16float, write>;
@group(2) @binding(2) var<uniform> uniDemod: NtscUniforms;

@group(3) @binding(0) var finalIn: texture_2d<f32>;
@group(3) @binding(1) var finalOut: texture_storage_2d<rgba8unorm, write>;
@group(3) @binding(2) var<uniform> uniFinal: NtscUniforms;

const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.283185307179586;
const I_CARRIER = array<f32, 4>(1.0, 0.0, -1.0, 0.0);
const Q_CARRIER = array<f32, 4>(0.0, 1.0, 0.0, -1.0);

fn dims(u: NtscUniforms) -> vec2i {
  return vec2i(max(vec2f(1.0), u.size));
}

fn clampCoord(c: vec2i, u: NtscUniforms) -> vec2i {
  let d = dims(u);
  return clamp(c, vec2i(0), d - vec2i(1));
}

fn hash12(p: vec2f) -> f32 {
  let h = dot(p, vec2f(127.1, 311.7));
  return fract(sin(h) * 43758.5453123);
}

fn rowShift(y: i32, u: NtscUniforms) -> f32 {
  let fy = f32(y);
  var shift = sin(fy * u.edgeWaveFrequency + u.frame * u.edgeWaveSpeed) * u.edgeWaveIntensity;
  let d = dims(u);
  if (u.headSwitchingHeight > 0.0) {
    let bottom = f32(d.y - y);
    if (bottom < u.headSwitchingHeight) {
      let t = 1.0 - bottom / max(1.0, u.headSwitchingHeight);
      shift += pow(clamp(t, 0.0, 1.0), 1.5) * u.headSwitchingShift;
    }
  }
  return shift;
}

fn rgbToYiq(rgb: vec3f) -> vec3f {
  return vec3f(
    dot(rgb, vec3f(0.299, 0.587, 0.114)),
    dot(rgb, vec3f(0.5959, -0.2746, -0.3213)),
    dot(rgb, vec3f(0.2115, -0.5227, 0.3112))
  );
}

fn yiqToRgb(yiq: vec3f) -> vec3f {
  return vec3f(
    yiq.x + yiq.y * 0.956 + yiq.z * 0.619,
    yiq.x - yiq.y * 0.272 - yiq.z * 0.647,
    yiq.x - yiq.y * 1.106 + yiq.z * 1.703
  );
}

fn loadSrcRgb(x: i32, y: i32, u: NtscUniforms) -> vec3f {
  let c = clampCoord(vec2i(x, y), u);
  return textureLoad(srcTex, c, 0).rgb;
}

fn loadSrcRgbLinear(xf: f32, y: i32, u: NtscUniforms) -> vec3f {
  let x0 = i32(floor(xf));
  let t = fract(xf);
  let a = loadSrcRgb(x0, y, u);
  let b = loadSrcRgb(x0 + 1, y, u);
  return mix(a, b, t);
}

fn sampleInputYiq(xf: f32, y: i32, u: NtscUniforms) -> vec3f {
  return rgbToYiq(loadSrcRgbLinear(xf, y, u));
}

fn loadYiq(x: i32, y: i32, u: NtscUniforms) -> vec3f {
  let c = clampCoord(vec2i(x, y), u);
  return textureLoad(yiqIn, c, 0).rgb;
}

fn loadComposite(x: i32, y: i32, u: NtscUniforms) -> f32 {
  let c = clampCoord(vec2i(x, y), u);
  return textureLoad(compositeIn, c, 0).r;
}

fn loadFinalYiq(x: i32, y: i32, u: NtscUniforms) -> vec3f {
  let c = clampCoord(vec2i(x, y), u);
  return textureLoad(finalIn, c, 0).rgb;
}

fn phaseFor(x: i32, y: i32, frame: f32) -> u32 {
  let xi = (i32(frame) + y * 2) & 2;
  return u32((x + xi) & 3);
}

fn lowCompositeAt(x: i32, y: i32, u: NtscUniforms) -> f32 {
  return (
    loadComposite(x - 1, y, u) +
    loadComposite(x, y, u) +
    loadComposite(x + 1, y, u) +
    loadComposite(x + 2, y, u)
  ) * 0.25;
}

fn chromaFromCompositeAt(x: i32, y: i32, u: NtscUniforms) -> f32 {
  return loadComposite(x, y, u) - lowCompositeAt(x, y, u);
}

@compute @workgroup_size(16, 16, 1)
fn encodePrefilter(@builtin(global_invocation_id) gid: vec3u) {
  let u = uni;
  let d = dims(u);
  if (gid.x >= u32(d.x) || gid.y >= u32(d.y)) {
    return;
  }

  let x = i32(gid.x);
  let y = i32(gid.y);
  let xf = f32(x) - rowShift(y, u);

  var boxY = 0.0;
  for (var k = -1; k <= 2; k = k + 1) {
    boxY += sampleInputYiq(xf + f32(k), y, u).x;
  }
  let luma = boxY * 0.25;

  let radius = clamp(2.5 + u.chromaBlur * 14.0 * max(0.25, u.tapeSpeed), 1.0, 24.0);
  var accumI = 0.0;
  var accumQ = 0.0;
  var total = 0.0;
  for (var k = 0; k <= 24; k = k + 1) {
    let w = exp(-f32(k) / radius);
    let yiq = sampleInputYiq(xf - f32(k), y, u);
    accumI += yiq.y * w;
    accumQ += yiq.z * w;
    total += w;
  }

  var i = accumI / max(0.0001, total);
  var q = accumQ / max(0.0001, total);
  let phase = u.chromaPhaseError * TAU;
  let s = sin(phase);
  let c = cos(phase);
  let ri = i * c - q * s;
  let rq = i * s + q * c;
  i = ri;
  q = rq;

  textureStore(encodeOut, vec2i(x, y), vec4f(luma, i, q, 1.0));
}

@compute @workgroup_size(16, 16, 1)
fn compositeSignal(@builtin(global_invocation_id) gid: vec3u) {
  let u = uniYiq;
  let d = dims(u);
  if (gid.x >= u32(d.x) || gid.y >= u32(d.y)) {
    return;
  }

  let x = i32(gid.x);
  let y = i32(gid.y);
  let yiq = loadYiq(x, y, u);
  let phase = phaseFor(x, y, u.frame);
  var modulated = yiq.x + yiq.y * I_CARRIER[phase] + yiq.z * Q_CARRIER[phase];
  let blur = (
    loadYiq(x - 2, y, u).x +
    loadYiq(x - 1, y, u).x +
    loadYiq(x, y, u).x +
    loadYiq(x + 1, y, u).x +
    loadYiq(x + 2, y, u).x
  ) * 0.2;
  modulated += (yiq.x - blur) * u.compositeSharpness;
  modulated += (hash12(vec2f(f32(x), f32(y)) + vec2f(u.frame * 17.0, 2.0)) - 0.5) * u.noiseIntensity;
  textureStore(yiqOut, vec2i(x, y), vec4f(modulated, yiq.x, yiq.y, yiq.z));
}

@compute @workgroup_size(16, 16, 1)
fn demodulate(@builtin(global_invocation_id) gid: vec3u) {
  let u = uniDemod;
  let d = dims(u);
  if (gid.x >= u32(d.x) || gid.y >= u32(d.y)) {
    return;
  }

  let x = i32(gid.x);
  let y = i32(gid.y);
  let luma = lowCompositeAt(x, y, u);
  let cL = chromaFromCompositeAt(x - 1, y, u);
  let cC = chromaFromCompositeAt(x, y, u);
  let cR = chromaFromCompositeAt(x + 1, y, u);
  let pL = phaseFor(x - 1, y, u.frame);
  let pC = phaseFor(x, y, u.frame);
  let pR = phaseFor(x + 1, y, u.frame);
  let i = cC * I_CARRIER[pC] + 0.5 * cL * I_CARRIER[pL] + 0.5 * cR * I_CARRIER[pR];
  let q = cC * Q_CARRIER[pC] + 0.5 * cL * Q_CARRIER[pL] + 0.5 * cR * Q_CARRIER[pR];
  textureStore(demodOut, vec2i(x, y), vec4f(luma, i, q, 1.0));
}

@compute @workgroup_size(16, 16, 1)
fn postProcessYiq(@builtin(global_invocation_id) gid: vec3u) {
  let u = uniYiq;
  let d = dims(u);
  if (gid.x >= u32(d.x) || gid.y >= u32(d.y)) {
    return;
  }

  let x = i32(gid.x);
  let y = i32(gid.y);
  let cy = y - i32(round(u.chromaDelayY));
  let delayX = u.chromaDelayX;

  let lumaRadius = clamp(1.0 + u.lumaSmear * 12.0 * max(0.25, u.tapeSpeed), 1.0, 20.0);
  var luma = 0.0;
  var lumaTotal = 0.0;
  for (var k = 0; k <= 20; k = k + 1) {
    let w = exp(-f32(k) / lumaRadius);
    luma += loadYiq(x - k, y, u).x * w;
    lumaTotal += w;
  }
  luma = luma / max(0.0001, lumaTotal);

  let chromaRadius = clamp(2.0 + u.chromaBlur * 18.0 * max(0.25, u.tapeSpeed), 1.0, 28.0);
  var i = 0.0;
  var q = 0.0;
  var chromaTotal = 0.0;
  for (var k = 0; k <= 28; k = k + 1) {
    let w = exp(-f32(k) / chromaRadius);
    let c0 = loadYiq(i32(floor(f32(x) - delayX - f32(k))), cy, u);
    i += c0.y * w;
    q += c0.z * w;
    chromaTotal += w;
  }
  i = i / max(0.0001, chromaTotal);
  q = q / max(0.0001, chromaTotal);

  if (u.verticalBlend > 0.0) {
    let above = loadYiq(x, y - 1, u);
    i = mix(i, (i + above.y) * 0.5, clamp(u.verticalBlend, 0.0, 1.0));
    q = mix(q, (q + above.z) * 0.5, clamp(u.verticalBlend, 0.0, 1.0));
  }

  var ring = 0.0;
  for (var k = 1; k <= 14; k = k + 1) {
    let edge = loadYiq(x - k, y, u).x - loadYiq(x - k - 1, y, u).x;
    ring += edge * cos(f32(k) * u.ringingFrequency * TAU) * exp(-f32(k) / 4.0);
  }
  luma += ring * u.ringingIntensity * 0.35;

  let blur3 = (loadYiq(x - 1, y, u).x + loadYiq(x, y, u).x + loadYiq(x + 1, y, u).x) / 3.0;
  luma += (luma - blur3) * u.vhsSharpen;

  if (hash12(vec2f(f32(y), u.frame * 13.0)) < u.chromaLossDensity) {
    let retain = 1.0 - clamp(u.chromaLossAmount, 0.0, 1.0);
    i *= retain;
    q *= retain;
  }

  let noise = hash12(vec2f(f32(x) * 0.37, f32(y) * 1.91) + vec2f(u.frame * 23.0, 5.0)) - 0.5;
  luma += noise * u.noiseIntensity;
  if (hash12(vec2f(f32(x), f32(y)) + vec2f(u.frame * 31.0, 9.0)) < u.snowDensity) {
    let snow = 0.45 + 0.35 * hash12(vec2f(f32(x) + 3.0, f32(y)) + vec2f(u.frame, 1.0));
    luma += snow * u.snowStrength;
  }

  textureStore(yiqOut, vec2i(x, y), vec4f(luma, i, q, 1.0));
}

@compute @workgroup_size(16, 16, 1)
fn finalRgb(@builtin(global_invocation_id) gid: vec3u) {
  let u = uniFinal;
  let d = dims(u);
  if (gid.x >= u32(d.x) || gid.y >= u32(d.y)) {
    return;
  }

  let x = i32(gid.x);
  let y = i32(gid.y);
  var rgb = yiqToRgb(loadFinalYiq(x, y, u));
  let scan = 1.0 - u.scanlineIntensity * (0.5 + 0.5 * cos(PI * f32(y)));
  rgb *= scan;
  textureStore(finalOut, vec2i(x, y), vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), 1.0));
}
`;

type PipelineKind = "encode" | "composite" | "demod" | "post" | "final";

function resolveTextureView(source: ShaderSource): GPUTextureView {
  if (source instanceof ShaderEffect) {
    return source.output;
  }
  if ("createView" in source) {
    return source.createView();
  }
  return source;
}

function extractUniformValue(value: unknown): unknown {
  return value instanceof Function ? value() : value;
}

function createFloatTexture(
  device: GPUDevice,
  width: number,
  height: number,
): GPUTexture {
  return device.createTexture({
    size: { width, height },
    format: "rgba16float",
    usage: GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.COPY_SRC,
  });
}

export class NtscVhsGpuEffect extends ShaderEffect<NtscVhsInputs> {
  readonly device: GPUDevice;
  readonly format: GPUTextureFormat = "rgba8unorm";
  readonly outputTexture: GPUTexture;
  output: GPUTextureView;
  settings: NtscVhsSettings;

  private readonly module: GPUShaderModule;
  private readonly uniformBuffer: GPUBuffer;
  private readonly uniformData = new Float32Array(UNIFORM_FLOAT_COUNT);
  private readonly encodeLayout: GPUBindGroupLayout;
  private readonly yiqLayout: GPUBindGroupLayout;
  private readonly demodLayout: GPUBindGroupLayout;
  private readonly finalLayout: GPUBindGroupLayout;
  private readonly emptyLayout: GPUBindGroupLayout;
  private readonly emptyBindGroup: GPUBindGroup;
  private readonly pipelines: Record<PipelineKind, GPUComputePipeline>;
  private readonly yiqA: GPUTexture;
  private readonly yiqB: GPUTexture;
  private readonly composite: GPUTexture;
  private frame = 0;

  override effectName = "NtscVhsGpu";

  constructor(
    device: GPUDevice,
    inputs: NtscVhsInputs,
    width: number,
    height: number,
    settings: Partial<NtscVhsSettings> = {},
  ) {
    super();
    this.device = device;
    this.inputs = inputs;
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.settings = { ...DEFAULT_NTSC_VHS_SETTINGS, ...settings };

    this.module = device.createShaderModule({
      label: "ntsc-vhs-gpu",
      code: SHADER_SOURCE,
    });
    this.uniformBuffer = device.createBuffer({
      size: UNIFORM_FLOAT_COUNT * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.emptyLayout = device.createBindGroupLayout({ entries: [] });
    this.emptyBindGroup = device.createBindGroup({
      layout: this.emptyLayout,
      entries: [],
    });
    this.encodeLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "float" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: "write-only", format: "rgba16float" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        },
      ],
    });
    this.yiqLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "float" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: "write-only", format: "rgba16float" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        },
      ],
    });
    this.demodLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "float" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: "write-only", format: "rgba16float" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        },
      ],
    });
    this.finalLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: "float" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: "write-only", format: "rgba8unorm" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        },
      ],
    });

    this.pipelines = {
      encode: this.createPipeline("encodePrefilter", this.encodeLayout, 0),
      composite: this.createPipeline("compositeSignal", this.yiqLayout, 1),
      demod: this.createPipeline("demodulate", this.demodLayout, 2),
      post: this.createPipeline("postProcessYiq", this.yiqLayout, 1),
      final: this.createPipeline("finalRgb", this.finalLayout, 3),
    };

    this.yiqA = createFloatTexture(device, this.width, this.height);
    this.yiqB = createFloatTexture(device, this.width, this.height);
    this.composite = createFloatTexture(device, this.width, this.height);
    this.outputTexture = device.createTexture({
      size: { width: this.width, height: this.height },
      format: this.format,
      usage: GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.COPY_SRC,
    });
    this.output = this.outputTexture.createView();
  }

  setSrcs(inputs: Partial<NtscVhsInputs>): void {
    this.inputs = { ...this.inputs, ...inputs };
  }

  setSettings(settings: Partial<NtscVhsSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  setFrame(frame: number): void {
    this.frame = Math.max(0, Math.floor(frame));
  }

  setUniforms(uniforms: ShaderUniforms): void {
    const next: Partial<NtscVhsSettings> = {};
    for (const [key, rawValue] of Object.entries(uniforms)) {
      if (!(key in this.settings)) continue;
      const value = Number(extractUniformValue(rawValue));
      if (Number.isFinite(value)) {
        (next as Record<string, number>)[key] = value;
      }
    }
    this.setSettings(next);
  }

  updateUniforms(): void {
    const s = this.settings;
    this.uniformData.fill(0);
    this.uniformData[0] = this.width;
    this.uniformData[1] = this.height;
    this.uniformData[2] = this.frame;
    this.uniformData[3] = s.lumaSmear;
    this.uniformData[4] = s.chromaBlur;
    this.uniformData[5] = s.chromaDelayX;
    this.uniformData[6] = s.chromaDelayY;
    this.uniformData[7] = s.compositeSharpness;
    this.uniformData[8] = s.ringingIntensity;
    this.uniformData[9] = s.ringingFrequency;
    this.uniformData[10] = s.vhsSharpen;
    this.uniformData[11] = s.scanlineIntensity;
    this.uniformData[12] = s.edgeWaveIntensity;
    this.uniformData[13] = s.edgeWaveFrequency;
    this.uniformData[14] = s.edgeWaveSpeed;
    this.uniformData[15] = s.headSwitchingHeight;
    this.uniformData[16] = s.headSwitchingShift;
    this.uniformData[17] = s.noiseIntensity;
    this.uniformData[18] = s.snowDensity;
    this.uniformData[19] = s.snowStrength;
    this.uniformData[20] = s.chromaPhaseError;
    this.uniformData[21] = s.chromaLossDensity;
    this.uniformData[22] = s.chromaLossAmount;
    this.uniformData[23] = s.verticalBlend;
    this.uniformData[24] = s.tapeSpeed;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);
  }

  render(): void {
    const src = this.inputs.src;
    if (!src) {
      throw new Error("NtscVhsGpuEffect requires a src texture");
    }
    this.updateUniforms();
    const srcView = resolveTextureView(src);
    const groupsX = Math.ceil(this.width / WORKGROUP_SIZE);
    const groupsY = Math.ceil(this.height / WORKGROUP_SIZE);
    const encoder = this.device.createCommandEncoder({ label: "ntsc-vhs-gpu" });

    this.dispatch(
      encoder,
      this.pipelines.encode,
      this.makeEncodeBindGroup(srcView, this.yiqA.createView()),
      0,
      groupsX,
      groupsY,
    );
    this.dispatch(
      encoder,
      this.pipelines.composite,
      this.makeYiqBindGroup(
        this.yiqA.createView(),
        this.composite.createView(),
      ),
      1,
      groupsX,
      groupsY,
    );
    this.dispatch(
      encoder,
      this.pipelines.demod,
      this.makeDemodBindGroup(
        this.composite.createView(),
        this.yiqB.createView(),
      ),
      2,
      groupsX,
      groupsY,
    );
    this.dispatch(
      encoder,
      this.pipelines.post,
      this.makeYiqBindGroup(this.yiqB.createView(), this.yiqA.createView()),
      1,
      groupsX,
      groupsY,
    );
    this.dispatch(
      encoder,
      this.pipelines.final,
      this.makeFinalBindGroup(this.yiqA.createView(), this.output),
      3,
      groupsX,
      groupsY,
    );

    this.device.queue.submit([encoder.finish()]);
    this.frame += 1;
  }

  override renderAll(): void {
    const src = this.inputs.src;
    if (src instanceof ShaderEffect) {
      src.renderAll();
    }
    this.render();
  }

  dispose(): void {
    this.uniformBuffer.destroy();
    this.yiqA.destroy();
    this.yiqB.destroy();
    this.composite.destroy();
    this.outputTexture.destroy();
  }

  private createPipeline(
    entryPoint: string,
    layout: GPUBindGroupLayout,
    groupIndex: number,
  ): GPUComputePipeline {
    const bindGroupLayouts = Array.from(
      { length: groupIndex },
      () => this.emptyLayout,
    );
    bindGroupLayouts.push(layout);
    return this.device.createComputePipeline({
      label: `ntsc-vhs-gpu:${entryPoint}`,
      layout: this.device.createPipelineLayout({ bindGroupLayouts }),
      compute: { module: this.module, entryPoint },
    });
  }

  private makeEncodeBindGroup(
    src: GPUTextureView,
    dst: GPUTextureView,
  ): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.encodeLayout,
      entries: [
        { binding: 0, resource: src },
        { binding: 1, resource: dst },
        { binding: 2, resource: { buffer: this.uniformBuffer } },
      ],
    });
  }

  private makeYiqBindGroup(
    src: GPUTextureView,
    dst: GPUTextureView,
  ): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.yiqLayout,
      entries: [
        { binding: 0, resource: src },
        { binding: 1, resource: dst },
        { binding: 2, resource: { buffer: this.uniformBuffer } },
      ],
    });
  }

  private makeDemodBindGroup(
    src: GPUTextureView,
    dst: GPUTextureView,
  ): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.demodLayout,
      entries: [
        { binding: 0, resource: src },
        { binding: 1, resource: dst },
        { binding: 2, resource: { buffer: this.uniformBuffer } },
      ],
    });
  }

  private makeFinalBindGroup(
    src: GPUTextureView,
    dst: GPUTextureView,
  ): GPUBindGroup {
    return this.device.createBindGroup({
      layout: this.finalLayout,
      entries: [
        { binding: 0, resource: src },
        { binding: 1, resource: dst },
        { binding: 2, resource: { buffer: this.uniformBuffer } },
      ],
    });
  }

  private dispatch(
    encoder: GPUCommandEncoder,
    pipeline: GPUComputePipeline,
    bindGroup: GPUBindGroup,
    bindGroupIndex: number,
    groupsX: number,
    groupsY: number,
  ): void {
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    for (let i = 0; i < bindGroupIndex; i += 1) {
      pass.setBindGroup(i, this.emptyBindGroup);
    }
    pass.setBindGroup(bindGroupIndex, bindGroup);
    pass.dispatchWorkgroups(groupsX, groupsY, 1);
    pass.end();
  }
}
