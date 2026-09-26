/**
 * The render passes as shader-fx `ShaderEffect`s, so they chain into the raw
 * shader-fx DAG (`renderAll`, `disposeAll`) and the final irradiance can feed
 * any generated-raw post effect. Each pass owns its pipeline, uniform buffer
 * and output textures; multi-output passes expose extra views as properties
 * and pass the *effect* along as the DAG input.
 */

import { ShaderEffect, type ShaderUniforms } from "@avtools/shader-fx/raw";
import type { GpuTimer } from "./compute/timer.ts";
import {
  MATERIAL_FLOATS,
  SEGMENT_STRIDE,
  type StrokeScene,
} from "./geometry.ts";
import { bundleWorthIt, interleaveWorthIt } from "./renderer.ts";
import {
  BOUNCE_WGSL,
  CASCADE_WGSL,
  GATHER_WGSL,
  REFERENCE_WGSL,
  STROKE_SCENE_WGSL,
} from "./wgsl.generated.ts";

export const HDR_FORMAT: GPUTextureFormat = "rgba16float";
export const DISTANCE_FORMAT: GPUTextureFormat = "r32float";

const TEXTURE_USAGE = GPUTextureUsage.RENDER_ATTACHMENT |
  GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC;

export function createTargetTexture(
  device: GPUDevice,
  width: number,
  height: number,
  format: GPUTextureFormat,
  label: string,
): GPUTexture {
  return device.createTexture({
    label,
    size: { width: Math.max(1, width), height: Math.max(1, height) },
    format,
    usage: TEXTURE_USAGE,
  });
}

/** A complete fullscreen-triangle program (`vs` + `fs` entry points). */
export function createFullscreenPipeline(
  device: GPUDevice,
  label: string,
  source: string,
  formats: GPUTextureFormat[],
  fragmentEntry = "fs",
  constants: Record<string, number> = {},
): GPURenderPipeline {
  const module = device.createShaderModule({ label, code: source });
  return device.createRenderPipeline({
    label,
    layout: "auto",
    vertex: { module, entryPoint: "vs" },
    fragment: {
      module,
      entryPoint: fragmentEntry,
      targets: formats.map((format) => ({ format })),
      constants,
    },
    primitive: { topology: "triangle-list", cullMode: "none" },
  });
}

function runFullscreenPass(
  device: GPUDevice,
  label: string,
  pipeline: GPURenderPipeline,
  bindGroup: GPUBindGroup,
  targets: GPUTextureView[],
  timestampWrites?: GPURenderPassTimestampWrites,
): void {
  const encoder = device.createCommandEncoder({ label });
  const pass = encoder.beginRenderPass({
    label,
    colorAttachments: targets.map((view) => ({
      view,
      clearValue: { r: 0, g: 0, b: 0, a: 0 },
      loadOp: "clear",
      storeOp: "store",
    })),
    timestampWrites,
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.draw(3);
  pass.end();
  device.queue.submit([encoder.finish()]);
}

/** Shared plumbing: a sized effect whose bind group is rebuilt lazily. */
abstract class PassEffect extends ShaderEffect {
  protected bindGroup: GPUBindGroup | null = null;
  /** Set by the renderer to time this effect's pass on the GPU. */
  timer: GpuTimer | null = null;

  protected constructor(
    protected readonly device: GPUDevice,
    width: number,
    height: number,
  ) {
    super();
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
  }

  setSrcs(inputs: Partial<Record<string, ShaderEffect>>): void {
    this.inputs = { ...this.inputs, ...inputs };
    this.bindGroup = null;
  }

  setUniforms(uniforms: ShaderUniforms): void {
    this.uniforms = { ...this.uniforms, ...uniforms };
  }

  updateUniforms(): void {}

  protected input<T extends ShaderEffect>(key: string): T {
    const value = this.inputs[key];
    if (!(value instanceof ShaderEffect)) {
      throw new Error(`${this.effectName}: input "${key}" is not connected`);
    }
    return value as T;
  }

  protected timestamps(): GPURenderPassTimestampWrites | undefined {
    return this.timer?.writes(this.effectName);
  }
}

/** Rasterizes the stroke scene into emission, transmittance, albedo and distance. */
export class StrokeSceneEffect extends PassEffect {
  override effectName = "StrokeScene";
  readonly emission: GPUTexture;
  readonly transmittance: GPUTexture;
  readonly albedo: GPUTexture;
  readonly distance: GPUTexture;
  readonly emissionView: GPUTextureView;
  readonly transmittanceView: GPUTextureView;
  readonly albedoView: GPUTextureView;
  readonly distanceView: GPUTextureView;
  output: GPUTextureView;
  private readonly pipeline: GPURenderPipeline;
  private readonly uniformBuffer: GPUBuffer;
  private segmentBuffer: GPUBuffer;
  private materialBuffer: GPUBuffer;
  private dirty = true;

  constructor(device: GPUDevice, width: number, height: number) {
    super(device, width, height);
    this.inputs = {};
    this.pipeline = createFullscreenPipeline(
      device,
      "rc-stroke-scene",
      STROKE_SCENE_WGSL,
      [HDR_FORMAT, HDR_FORMAT, HDR_FORMAT, DISTANCE_FORMAT],
    );
    this.uniformBuffer = device.createBuffer({
      label: "rc-scene-uniforms",
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.segmentBuffer = this.storageBuffer("rc-segments", SEGMENT_STRIDE);
    this.materialBuffer = this.storageBuffer(
      "rc-materials",
      MATERIAL_FLOATS * 4,
    );
    this.emission = createTargetTexture(
      device,
      this.width,
      this.height,
      HDR_FORMAT,
      "rc-scene-emission",
    );
    this.transmittance = createTargetTexture(
      device,
      this.width,
      this.height,
      HDR_FORMAT,
      "rc-scene-transmittance",
    );
    this.albedo = createTargetTexture(
      device,
      this.width,
      this.height,
      HDR_FORMAT,
      "rc-scene-albedo",
    );
    this.distance = createTargetTexture(
      device,
      this.width,
      this.height,
      DISTANCE_FORMAT,
      "rc-scene-distance",
    );
    this.emissionView = this.emission.createView();
    this.transmittanceView = this.transmittance.createView();
    this.albedoView = this.albedo.createView();
    this.distanceView = this.distance.createView();
    this.output = this.emissionView;
    this.writeUniforms(0, 0);
  }

  private storageBuffer(label: string, size: number): GPUBuffer {
    return this.device.createBuffer({
      label,
      size: Math.max(size, 16),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }

  private writeUniforms(segmentCount: number, shapeCount: number): void {
    const data = new ArrayBuffer(16);
    new Float32Array(data, 0, 2).set([this.width, this.height]);
    new Uint32Array(data, 8, 2).set([segmentCount, shapeCount]);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
  }

  setScene(scene: StrokeScene): void {
    if (scene.segmentData.byteLength > this.segmentBuffer.size) {
      this.segmentBuffer.destroy();
      this.segmentBuffer = this.storageBuffer(
        "rc-segments",
        scene.segmentData.byteLength * 2,
      );
      this.bindGroup = null;
    }
    if (scene.materialData.byteLength > this.materialBuffer.size) {
      this.materialBuffer.destroy();
      this.materialBuffer = this.storageBuffer(
        "rc-materials",
        scene.materialData.byteLength * 2,
      );
      this.bindGroup = null;
    }
    this.device.queue.writeBuffer(this.segmentBuffer, 0, scene.segmentData);
    this.device.queue.writeBuffer(
      this.materialBuffer,
      0,
      scene.materialData.buffer,
      scene.materialData.byteOffset,
      scene.materialData.byteLength,
    );
    this.writeUniforms(scene.segmentCount, scene.shapeCount);
    this.dirty = true;
  }

  render(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.bindGroup ??= this.device.createBindGroup({
      label: "rc-scene-bind",
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: this.segmentBuffer } },
        { binding: 2, resource: { buffer: this.materialBuffer } },
      ],
    });
    runFullscreenPass(this.device, "rc-scene", this.pipeline, this.bindGroup, [
      this.emissionView,
      this.transmittanceView,
      this.albedoView,
      this.distanceView,
    ], this.timestamps());
  }

  dispose(): void {
    this.emission.destroy();
    this.transmittance.destroy();
    this.albedo.destroy();
    this.distance.destroy();
    this.uniformBuffer.destroy();
    this.segmentBuffer.destroy();
    this.materialBuffer.destroy();
  }
}

/** Geometry of one cascade level and its texture layout. */
export interface CascadeLevel {
  index: number;
  probeSpacing: number;
  probeCount: [number, number];
  /** Rays cast per probe. */
  rayCount: number;
  /** Directions stored per probe: `rayCount`, or `rayCount / branching` when pre-averaging. */
  storedDirs: number;
  tileCols: number;
  tileRows: number;
  textureSize: [number, number];
  intervalStart: number;
  intervalEnd: number;
}

export interface CascadeRuntime {
  branching: number;
  mergeMode: number;
  preAverage: boolean;
  useDistanceField: boolean;
  stepSize: number;
  intervalOverlap: number;
  sky: readonly [number, number, number];
}

/**
 * Effective emission: scene emission plus last frame's bounce. Reads the
 * cascade-0 texture from the previous frame; that texture is deliberately not
 * an input, or the DAG would cycle.
 */
export class BounceEffect extends PassEffect {
  override effectName = "RadianceBounce";
  readonly texture: GPUTexture;
  output: GPUTextureView;
  private readonly pipeline: GPURenderPipeline;
  private readonly uniformBuffer: GPUBuffer;
  private previous: CascadeEffect | null = null;
  private previousLevel: CascadeLevel | null = null;
  private strength = 0;
  private offset = 1.5;

  constructor(device: GPUDevice, scene: StrokeSceneEffect) {
    super(device, scene.width, scene.height);
    this.inputs = { scene };
    this.pipeline = createFullscreenPipeline(
      device,
      "rc-bounce",
      BOUNCE_WGSL,
      [HDR_FORMAT],
    );
    this.uniformBuffer = device.createBuffer({
      label: "rc-bounce-uniforms",
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.texture = createTargetTexture(
      device,
      this.width,
      this.height,
      HDR_FORMAT,
      "rc-effective-emission",
    );
    this.output = this.texture.createView();
  }

  setPrevious(cascade0: CascadeEffect, level: CascadeLevel): void {
    this.previous = cascade0;
    this.previousLevel = level;
    this.bindGroup = null;
  }

  setBounce(strength: number, offset = 1.5): void {
    this.strength = Math.max(0, strength);
    this.offset = offset;
  }

  render(): void {
    if (!this.previous || !this.previousLevel) {
      throw new Error("BounceEffect: setPrevious() before render()");
    }
    const level = this.previousLevel;
    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      new Float32Array([
        level.probeCount[0],
        level.probeCount[1],
        level.probeSpacing,
        level.storedDirs,
        level.tileCols,
        level.rayCount,
        this.strength,
        this.offset,
      ]),
    );
    const scene = this.input<StrokeSceneEffect>("scene");
    this.bindGroup ??= this.device.createBindGroup({
      label: "rc-bounce-bind",
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: scene.emissionView },
        { binding: 2, resource: scene.albedoView },
        { binding: 3, resource: scene.distanceView },
        { binding: 4, resource: this.previous.radianceView },
      ],
    });
    runFullscreenPass(this.device, "rc-bounce", this.pipeline, this.bindGroup, [
      this.output,
    ], this.timestamps());
  }

  dispose(): void {
    this.texture.destroy();
    this.uniformBuffer.destroy();
  }
}

const CASCADE_UNIFORM_FLOATS = 32;

/**
 * One cascade level; input `upper` is the level above, absent at the top.
 * The raw (own-interval) radiance is a debug output: its texture and the
 * three-target pipeline exist only while `setRaw(true)`.
 */
export class CascadeEffect extends PassEffect {
  override effectName: string;
  readonly level: CascadeLevel;
  readonly radiance: GPUTexture;
  readonly transmittance: GPUTexture;
  readonly radianceView: GPUTextureView;
  readonly transmittanceView: GPUTextureView;
  output: GPUTextureView;
  private pipeline: GPURenderPipeline;
  private rawPipeline: GPURenderPipeline | null = null;
  /** The merge mode the pipelines were specialized for. */
  private pipelineMode = -1;
  private readonly pipelineCache = new Map<string, GPURenderPipeline>();
  private rawTexture: GPUTexture | null = null;
  private rawTextureView: GPUTextureView | null = null;
  private readonly uniformBuffer: GPUBuffer;
  private readonly dummy: GPUTexture;
  private readonly dummyView: GPUTextureView;
  private runtime: CascadeRuntime | null = null;

  constructor(
    device: GPUDevice,
    level: CascadeLevel,
    emission: BounceEffect,
    scene: StrokeSceneEffect,
    upper: CascadeEffect | null,
  ) {
    super(device, level.textureSize[0], level.textureSize[1]);
    this.level = level;
    this.effectName = `RadianceCascade${level.index}`;
    this.inputs = upper ? { emission, scene, upper } : { emission, scene };
    this.pipeline = this.cascadePipeline(false, 1);
    this.pipelineMode = 1;
    this.uniformBuffer = device.createBuffer({
      label: `rc-cascade-${level.index}-uniforms`,
      size: CASCADE_UNIFORM_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const [width, height] = level.textureSize;
    this.radiance = createTargetTexture(
      device,
      width,
      height,
      HDR_FORMAT,
      `rc-cascade-${level.index}-radiance`,
    );
    this.transmittance = createTargetTexture(
      device,
      width,
      height,
      HDR_FORMAT,
      `rc-cascade-${level.index}-transmittance`,
    );
    this.radianceView = this.radiance.createView();
    this.transmittanceView = this.transmittance.createView();
    this.output = this.radianceView;
    this.dummy = createTargetTexture(device, 1, 1, HDR_FORMAT, "rc-dummy");
    this.dummyView = this.dummy.createView();
  }

  /** The raw radiance texture, or null while the debug output is off. */
  get raw(): GPUTexture | null {
    return this.rawTexture;
  }

  /** The raw radiance view; a 1x1 placeholder while the debug output is off. */
  get rawView(): GPUTextureView {
    return this.rawTextureView ?? this.dummyView;
  }

  /** Produce (or stop producing and free) the raw debug output. */
  setRaw(enabled: boolean): void {
    if (enabled === (this.rawTexture !== null)) return;
    if (enabled) {
      const [width, height] = this.level.textureSize;
      this.rawPipeline = this.cascadePipeline(true, this.pipelineMode);
      this.rawTexture = createTargetTexture(
        this.device,
        width,
        height,
        HDR_FORMAT,
        `rc-cascade-${this.level.index}-raw`,
      );
      this.rawTextureView = this.rawTexture.createView();
    } else {
      this.rawTexture?.destroy();
      this.rawTexture = null;
      this.rawTextureView = null;
    }
    // The two pipelines have their own bind group layouts.
    this.bindGroup = null;
  }

  get upper(): CascadeEffect | null {
    const upper = this.inputs.upper;
    return upper instanceof CascadeEffect ? upper : null;
  }

  /**
   * A pipeline specialized for this level (renderer.ts, bundleWorthIt /
   * interleaveWorthIt) and a merge mode, cached: a mode as a uniform would
   * keep every mode's registers live.
   */
  private cascadePipeline(raw: boolean, mode: number): GPURenderPipeline {
    const constants = {
      BUNDLE: bundleWorthIt(this.level, this.upper?.level ?? null) ? 1 : 0,
      INTERLEAVE: interleaveWorthIt(this.level) ? 1 : 0,
      MERGE_MODE: mode,
    };
    const key = JSON.stringify([raw, constants]);
    let pipeline = this.pipelineCache.get(key);
    if (!pipeline) {
      pipeline = createFullscreenPipeline(
        this.device,
        `rc-cascade-${this.level.index}${raw ? "-raw" : ""} ${key}`,
        CASCADE_WGSL,
        raw ? [HDR_FORMAT, HDR_FORMAT, HDR_FORMAT] : [HDR_FORMAT, HDR_FORMAT],
        raw ? "fs" : "fsMerged",
        constants,
      );
      this.pipelineCache.set(key, pipeline);
    }
    return pipeline;
  }

  setRuntime(runtime: CascadeRuntime): void {
    this.runtime = runtime;
    if (runtime.mergeMode !== this.pipelineMode) {
      this.pipelineMode = runtime.mergeMode;
      this.pipeline = this.cascadePipeline(false, runtime.mergeMode);
      if (this.rawPipeline) {
        this.rawPipeline = this.cascadePipeline(true, runtime.mergeMode);
      }
      this.bindGroup = null;
    }
  }

  private writeUniforms(runtime: CascadeRuntime): void {
    const level = this.level;
    const scene = this.input<StrokeSceneEffect>("scene");
    const upper = this.upper?.level;
    const intervalLength = (level.intervalEnd - level.intervalStart) *
      runtime.intervalOverlap;
    const maxSteps = runtime.useDistanceField
      ? 256
      : Math.min(4096, Math.ceil(intervalLength / runtime.stepSize) + 8);
    const data = new Float32Array(CASCADE_UNIFORM_FLOATS);
    data.set([
      runtime.sky[0],
      runtime.sky[1],
      runtime.sky[2],
      0,
      scene.width,
      scene.height,
      level.probeCount[0],
      level.probeCount[1],
      upper?.probeCount[0] ?? 1,
      upper?.probeCount[1] ?? 1,
      level.probeSpacing,
      upper?.probeSpacing ?? 1,
      level.rayCount,
      level.storedDirs,
      upper?.rayCount ?? 1,
      upper?.storedDirs ?? 1,
      level.tileCols,
      upper?.tileCols ?? 1,
      level.intervalStart,
      level.intervalEnd,
      runtime.branching,
      upper ? 0 : 1,
      runtime.mergeMode,
      runtime.preAverage ? 1 : 0,
      runtime.useDistanceField ? 1 : 0,
      runtime.stepSize,
      runtime.intervalOverlap,
      maxSteps,
    ]);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, data);
  }

  render(): void {
    if (!this.runtime) {
      throw new Error(`${this.effectName}: setRuntime() before render()`);
    }
    this.writeUniforms(this.runtime);
    const scene = this.input<StrokeSceneEffect>("scene");
    const emission = this.input<BounceEffect>("emission");
    const upper = this.upper;
    const withRaw = this.rawTextureView !== null;
    const pipeline = withRaw ? this.rawPipeline! : this.pipeline;
    this.bindGroup ??= this.device.createBindGroup({
      label: `${this.effectName}-bind`,
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: emission.output },
        { binding: 2, resource: scene.transmittanceView },
        { binding: 3, resource: scene.distanceView },
        { binding: 4, resource: upper ? upper.radianceView : this.dummyView },
        {
          binding: 5,
          resource: upper ? upper.transmittanceView : this.dummyView,
        },
      ],
    });
    runFullscreenPass(
      this.device,
      this.effectName,
      pipeline,
      this.bindGroup,
      withRaw
        ? [this.radianceView, this.transmittanceView, this.rawTextureView!]
        : [this.radianceView, this.transmittanceView],
      this.timestamps(),
    );
  }

  dispose(): void {
    this.radiance.destroy();
    this.transmittance.destroy();
    this.rawTexture?.destroy();
    this.dummy.destroy();
    this.uniformBuffer.destroy();
  }
}

/** Per-pixel irradiance from cascade 0. */
export class GatherEffect extends PassEffect {
  override effectName = "RadianceGather";
  readonly texture: GPUTexture;
  output: GPUTextureView;
  private readonly pipeline: GPURenderPipeline;
  private readonly uniformBuffer: GPUBuffer;

  constructor(
    device: GPUDevice,
    width: number,
    height: number,
    cascade0: CascadeEffect,
  ) {
    super(device, width, height);
    this.inputs = { cascade0 };
    this.pipeline = createFullscreenPipeline(
      device,
      "rc-gather",
      GATHER_WGSL,
      [HDR_FORMAT],
    );
    this.uniformBuffer = device.createBuffer({
      label: "rc-gather-uniforms",
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.texture = createTargetTexture(
      device,
      this.width,
      this.height,
      HDR_FORMAT,
      "rc-irradiance",
    );
    this.output = this.texture.createView();
  }

  render(): void {
    const cascade0 = this.input<CascadeEffect>("cascade0");
    const level = cascade0.level;
    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      new Float32Array([
        level.probeCount[0],
        level.probeCount[1],
        level.probeSpacing,
        level.storedDirs,
        level.tileCols,
        0,
        0,
        0,
      ]),
    );
    this.bindGroup ??= this.device.createBindGroup({
      label: "rc-gather-bind",
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: cascade0.radianceView },
      ],
    });
    runFullscreenPass(this.device, "rc-gather", this.pipeline, this.bindGroup, [
      this.output,
    ], this.timestamps());
  }

  dispose(): void {
    this.texture.destroy();
    this.uniformBuffer.destroy();
  }
}

export interface ReferenceRuntime {
  rays: number;
  useDistanceField: boolean;
  stepSize: number;
  sky: readonly [number, number, number];
}

/** Brute-force per-pixel ray marcher, rendered on demand. */
export class ReferenceEffect extends PassEffect {
  override effectName = "RadianceReference";
  readonly texture: GPUTexture;
  output: GPUTextureView;
  private readonly pipeline: GPURenderPipeline;
  private readonly uniformBuffer: GPUBuffer;
  private runtime: ReferenceRuntime = {
    rays: 64,
    useDistanceField: true,
    stepSize: 1,
    sky: [0, 0, 0],
  };

  constructor(
    device: GPUDevice,
    emission: BounceEffect,
    scene: StrokeSceneEffect,
  ) {
    super(device, scene.width, scene.height);
    this.inputs = { emission, scene };
    this.pipeline = createFullscreenPipeline(
      device,
      "rc-reference",
      REFERENCE_WGSL,
      [HDR_FORMAT],
    );
    this.uniformBuffer = device.createBuffer({
      label: "rc-reference-uniforms",
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.texture = createTargetTexture(
      device,
      this.width,
      this.height,
      HDR_FORMAT,
      "rc-reference",
    );
    this.output = this.texture.createView();
  }

  setRuntime(runtime: ReferenceRuntime): void {
    this.runtime = runtime;
  }

  render(): void {
    const scene = this.input<StrokeSceneEffect>("scene");
    const emission = this.input<BounceEffect>("emission");
    const runtime = this.runtime;
    const maxDistance = Math.hypot(scene.width, scene.height);
    const maxSteps = runtime.useDistanceField
      ? 512
      : Math.min(8192, Math.ceil(maxDistance / runtime.stepSize) + 8);
    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      new Float32Array([
        runtime.sky[0],
        runtime.sky[1],
        runtime.sky[2],
        0,
        scene.width,
        scene.height,
        Math.max(1, Math.floor(runtime.rays)),
        maxDistance,
        runtime.useDistanceField ? 1 : 0,
        runtime.stepSize,
        maxSteps,
        0,
      ]),
    );
    this.bindGroup ??= this.device.createBindGroup({
      label: "rc-reference-bind",
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: emission.output },
        { binding: 2, resource: scene.transmittanceView },
        { binding: 3, resource: scene.distanceView },
      ],
    });
    runFullscreenPass(
      this.device,
      "rc-reference",
      this.pipeline,
      this.bindGroup,
      [this.output],
      this.timestamps(),
    );
  }

  dispose(): void {
    this.texture.destroy();
    this.uniformBuffer.destroy();
  }
}
