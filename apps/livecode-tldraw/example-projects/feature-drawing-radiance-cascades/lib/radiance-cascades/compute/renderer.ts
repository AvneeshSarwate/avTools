/**
 * The compute-shader radiance cascade renderer: raw WebGPU, one command
 * encoder per frame, storage buffers for the cascade levels, and the
 * workgroup-memory stagings `compute_cascade.wgsl` describes. Same inputs,
 * configuration and outputs as the fragment renderer; see `backend.ts`.
 *
 * Passes per frame: scene bins + raster (when the scene changed), bounce,
 * cascades top-down (cascade 0 fused with the gather and the bounce band),
 * an upsample when cascade 0's spacing is above a pixel, and the debug
 * unpacks when debug views are on.
 */

import type { RadianceRenderer, TextureOutput } from "../backend.ts";
import {
  type CascadeLevel,
  type CascadeRuntime,
  createFullscreenPipeline,
  createTargetTexture,
  DISTANCE_FORMAT,
  HDR_FORMAT,
} from "../effects.ts";
import {
  MATERIAL_FLOATS,
  SEGMENT_STRIDE,
  type StrokeScene,
} from "../geometry.ts";
import {
  type CascadePlan,
  DEFAULT_CONFIG,
  MERGE_MODES,
  planCascades,
  type RadianceCascadeConfig,
  type RendererViews,
} from "../renderer.ts";
import {
  COMPUTE_BOUNCE_WGSL,
  COMPUTE_CASCADE_WGSL,
  COMPUTE_DEBUG_UNPACK_WGSL,
  COMPUTE_GATHER_WGSL,
  COMPUTE_SCENE_BINS_WGSL,
  COMPUTE_SCENE_RASTER_WGSL,
  COMPUTE_UPSAMPLE_WGSL,
  REFERENCE_WGSL,
} from "../wgsl.generated.ts";
import {
  BAND_ENTRY_BYTES,
  type ComputeLevelPlan,
  type ComputeOptions,
  DEFAULT_COMPUTE_OPTIONS,
  describeComputeLevel,
  planComputeLevel,
  RAW_ENTRY_BYTES,
  STORE_ENTRY_BYTES,
} from "./plan.ts";
import { GpuTimer } from "./timer.ts";

const STORAGE_TEXTURE_USAGE = GPUTextureUsage.STORAGE_BINDING |
  GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC;
const CASCADE_UNIFORM_BYTES = 128;
const BINS_LANES = 64;

interface Texture2 {
  texture: GPUTexture;
  view: GPUTextureView;
}

function createStorageTexture(
  device: GPUDevice,
  width: number,
  height: number,
  format: GPUTextureFormat,
  label: string,
): Texture2 {
  const texture = device.createTexture({
    label,
    size: { width: Math.max(1, width), height: Math.max(1, height) },
    format,
    usage: STORAGE_TEXTURE_USAGE,
  });
  return { texture, view: texture.createView() };
}

function createStorageBuffer(
  device: GPUDevice,
  label: string,
  bytes: number,
  extraUsage = 0,
): GPUBuffer {
  return device.createBuffer({
    label,
    size: Math.max(16, Math.ceil(bytes / 16) * 16),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | extraUsage,
  });
}

interface LevelState {
  level: CascadeLevel;
  plan: ComputeLevelPlan;
  pipeline: GPUComputePipeline;
  uniform: GPUBuffer;
  /** The direction store; null for cascade 0 unless debug views are on. */
  store: GPUBuffer | null;
  raw: GPUBuffer | null;
  debug: {
    merged: Texture2;
    raw: Texture2;
    uniform: GPUBuffer;
    unpackBindGroup: GPUBindGroup;
  } | null;
  bindGroup: GPUBindGroup | null;
}

export interface BandStats {
  capacity: number;
  /** Probes that wanted a band slot in the last frame read back. */
  lastCount: number;
  /** Times the band overflowed and was grown. */
  growths: number;
}

export class ComputeRadianceRenderer implements RadianceRenderer {
  readonly backend = "compute" as const;
  readonly width: number;
  readonly height: number;
  readonly options: ComputeOptions;
  private config: RadianceCascadeConfig;
  private currentPlan: CascadePlan | null = null;
  private computePlans: ComputeLevelPlan[] = [];
  private levelsKey = "";
  private computeKey = "";
  private disposed = false;

  private readonly timer: GpuTimer;
  private readonly modules: Record<
    | "bins"
    | "raster"
    | "cascade"
    | "bounce"
    | "upsample"
    | "gather"
    | "unpack",
    GPUShaderModule
  >;
  private readonly cascadeLayout: GPUBindGroupLayout;
  private readonly cascadePipelineLayout: GPUPipelineLayout;
  private readonly pipelineCache = new Map<string, GPUComputePipeline>();

  // Scene.
  private sceneDirty = true;
  private segmentCount = 0;
  private shapeCount = 0;
  private segmentBuffer: GPUBuffer;
  private materialBuffer: GPUBuffer;
  private readonly sceneUniform: GPUBuffer;
  private readonly tiles: [number, number];
  private readonly binsBuffer: GPUBuffer;
  private readonly tileMeta: GPUBuffer;
  private readonly binsPipeline: GPUComputePipeline;
  private readonly rasterPipeline: GPUComputePipeline;
  private binsBindGroup: GPUBindGroup | null = null;
  private rasterBindGroup: GPUBindGroup | null = null;
  private readonly emission: Texture2;
  private readonly transmittance: Texture2;
  private readonly albedo: Texture2;
  private readonly distance: Texture2;

  // Bounce.
  private readonly effective: Texture2;
  private readonly bouncePipeline: GPUComputePipeline;
  private readonly bounceUniform: GPUBuffer;
  private bounceBindGroup: GPUBindGroup | null = null;

  // Cascades.
  private levels: LevelState[] = [];
  private probeIrradiance: Texture2 | null = null;
  private irradianceTex: Texture2 | null = null;
  private readonly upsamplePipeline: GPUComputePipeline;
  private readonly upsampleUniform: GPUBuffer;
  private upsampleBindGroup: GPUBindGroup | null = null;
  private readonly gatherPipeline: GPUComputePipeline;
  private readonly gatherUniform: GPUBuffer;
  private gatherBindGroup: GPUBindGroup | null = null;
  private readonly unpackPipeline: GPUComputePipeline;
  private slotMap: GPUBuffer | null = null;
  private band: GPUBuffer | null = null;
  private readonly bandCounter: GPUBuffer;
  private readonly counterStaging: GPUBuffer;
  private counterPending = false;
  private bandCapacity: number;
  private bandLastCount = 0;
  private bandGrowths = 0;
  private debugEnabled = false;
  /** One per cascade storage binding: a buffer may not be bound both read-only and read-write. */
  private readonly dummyBuffers: GPUBuffer[];
  private readonly dummyStorageTexture: Texture2;

  // Reference.
  private readonly referencePipeline: GPURenderPipeline;
  private readonly referenceUniform: GPUBuffer;
  private readonly referenceTex: Texture2;
  private referenceBindGroup: GPUBindGroup | null = null;

  constructor(
    private readonly device: GPUDevice,
    width: number,
    height: number,
    config: Partial<RadianceCascadeConfig> = {},
    options: Partial<ComputeOptions> = {},
  ) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.options = { ...DEFAULT_COMPUTE_OPTIONS, ...options };
    const tile = Math.max(4, Math.floor(this.options.tileSize));
    this.options.tileSize = tile;
    this.options.binRadius = Math.max(
      this.options.binRadius,
      (tile / 2) * Math.SQRT2,
    );
    this.bandCapacity = Math.max(64, Math.floor(this.options.bandCapacity));
    this.timer = new GpuTimer(device);

    const module = (label: string, code: string) =>
      device.createShaderModule({ label, code });
    this.modules = {
      bins: module("rc-compute-scene-bins", COMPUTE_SCENE_BINS_WGSL),
      raster: module("rc-compute-scene-raster", COMPUTE_SCENE_RASTER_WGSL),
      cascade: module("rc-compute-cascade", COMPUTE_CASCADE_WGSL),
      bounce: module("rc-compute-bounce", COMPUTE_BOUNCE_WGSL),
      upsample: module("rc-compute-upsample", COMPUTE_UPSAMPLE_WGSL),
      gather: module("rc-compute-gather", COMPUTE_GATHER_WGSL),
      unpack: module("rc-compute-debug-unpack", COMPUTE_DEBUG_UNPACK_WGSL),
    };

    const compute = GPUShaderStage.COMPUTE;
    this.cascadeLayout = device.createBindGroupLayout({
      label: "rc-compute-cascade-layout",
      entries: [
        { binding: 0, visibility: compute, buffer: { type: "uniform" } },
        { binding: 1, visibility: compute, texture: {} },
        { binding: 2, visibility: compute, texture: {} },
        {
          binding: 3,
          visibility: compute,
          texture: { sampleType: "unfilterable-float" },
        },
        {
          binding: 4,
          visibility: compute,
          buffer: { type: "read-only-storage" },
        },
        { binding: 5, visibility: compute, buffer: { type: "storage" } },
        { binding: 6, visibility: compute, buffer: { type: "storage" } },
        {
          binding: 7,
          visibility: compute,
          storageTexture: { access: "write-only", format: HDR_FORMAT },
        },
        { binding: 8, visibility: compute, buffer: { type: "storage" } },
        { binding: 9, visibility: compute, buffer: { type: "storage" } },
        { binding: 10, visibility: compute, buffer: { type: "storage" } },
      ],
    });
    this.cascadePipelineLayout = device.createPipelineLayout({
      label: "rc-compute-cascade-pipeline-layout",
      bindGroupLayouts: [this.cascadeLayout],
    });

    // Scene.
    this.tiles = [Math.ceil(this.width / tile), Math.ceil(this.height / tile)];
    this.segmentBuffer = createStorageBuffer(
      device,
      "rc-segments",
      SEGMENT_STRIDE,
    );
    this.materialBuffer = createStorageBuffer(
      device,
      "rc-materials",
      MATERIAL_FLOATS * 4,
    );
    this.sceneUniform = device.createBuffer({
      label: "rc-compute-scene-uniforms",
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const binCapacity = Math.max(1, Math.floor(this.options.binCapacity));
    this.options.binCapacity = binCapacity;
    this.binsBuffer = createStorageBuffer(
      device,
      "rc-scene-bins",
      this.tiles[0] * this.tiles[1] * binCapacity * 4,
    );
    this.tileMeta = createStorageBuffer(
      device,
      "rc-scene-tile-meta",
      this.tiles[0] * this.tiles[1] * 8,
    );
    this.binsPipeline = device.createComputePipeline({
      label: "rc-compute-scene-bins",
      layout: "auto",
      compute: {
        module: this.modules.bins,
        entryPoint: "main",
        constants: { TILE: tile, BIN_CAPACITY: binCapacity, LANES: BINS_LANES },
      },
    });
    this.rasterPipeline = device.createComputePipeline({
      label: "rc-compute-scene-raster",
      layout: "auto",
      compute: {
        module: this.modules.raster,
        entryPoint: "main",
        constants: { TILE: tile, BIN_CAPACITY: binCapacity },
      },
    });
    this.emission = createStorageTexture(
      device,
      this.width,
      this.height,
      HDR_FORMAT,
      "rc-scene-emission",
    );
    this.transmittance = createStorageTexture(
      device,
      this.width,
      this.height,
      HDR_FORMAT,
      "rc-scene-transmittance",
    );
    this.albedo = createStorageTexture(
      device,
      this.width,
      this.height,
      HDR_FORMAT,
      "rc-scene-albedo",
    );
    this.distance = createStorageTexture(
      device,
      this.width,
      this.height,
      DISTANCE_FORMAT,
      "rc-scene-distance",
    );
    this.writeSceneUniforms();

    // Bounce.
    this.effective = createStorageTexture(
      device,
      this.width,
      this.height,
      HDR_FORMAT,
      "rc-effective-emission",
    );
    this.bouncePipeline = device.createComputePipeline({
      label: "rc-compute-bounce",
      layout: "auto",
      compute: {
        module: this.modules.bounce,
        entryPoint: "main",
        constants: { TILE: 16 },
      },
    });
    this.bounceUniform = device.createBuffer({
      label: "rc-compute-bounce-uniforms",
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Cascades.
    this.upsamplePipeline = device.createComputePipeline({
      label: "rc-compute-upsample",
      layout: "auto",
      compute: {
        module: this.modules.upsample,
        entryPoint: "main",
        constants: { TILE: 16 },
      },
    });
    this.upsampleUniform = device.createBuffer({
      label: "rc-compute-upsample-uniforms",
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.gatherPipeline = device.createComputePipeline({
      label: "rc-compute-gather",
      layout: "auto",
      compute: {
        module: this.modules.gather,
        entryPoint: "main",
        constants: { TILE: 16 },
      },
    });
    this.gatherUniform = device.createBuffer({
      label: "rc-compute-gather-uniforms",
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.unpackPipeline = device.createComputePipeline({
      label: "rc-compute-debug-unpack",
      layout: "auto",
      compute: {
        module: this.modules.unpack,
        entryPoint: "main",
        constants: { TILE: 16 },
      },
    });
    this.bandCounter = createStorageBuffer(
      device,
      "rc-band-counter",
      4,
      GPUBufferUsage.COPY_SRC,
    );
    this.counterStaging = device.createBuffer({
      label: "rc-band-counter-staging",
      size: 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    this.dummyBuffers = [4, 5, 6, 8, 9, 10].map((binding) =>
      createStorageBuffer(device, `rc-dummy-buffer-${binding}`, 16)
    );
    this.dummyStorageTexture = createStorageTexture(
      device,
      1,
      1,
      HDR_FORMAT,
      "rc-dummy-storage",
    );

    // Reference.
    this.referencePipeline = createFullscreenPipeline(
      device,
      "rc-reference",
      REFERENCE_WGSL,
      [HDR_FORMAT],
    );
    this.referenceUniform = device.createBuffer({
      label: "rc-reference-uniforms",
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const referenceTexture = createTargetTexture(
      device,
      this.width,
      this.height,
      HDR_FORMAT,
      "rc-reference",
    );
    this.referenceTex = {
      texture: referenceTexture,
      view: referenceTexture.createView(),
    };

    this.config = { ...DEFAULT_CONFIG, ...config };
    this.configure(this.config);
  }

  get plan(): CascadePlan {
    if (!this.currentPlan) throw new Error("renderer is disposed");
    return this.currentPlan;
  }

  get currentConfig(): RadianceCascadeConfig {
    return this.config;
  }

  get irradiance(): TextureOutput {
    if (!this.irradianceTex) throw new Error("renderer is disposed");
    return {
      texture: this.irradianceTex.texture,
      output: this.irradianceTex.view,
    };
  }

  get reference(): TextureOutput {
    return {
      texture: this.referenceTex.texture,
      output: this.referenceTex.view,
    };
  }

  get timings(): Readonly<Record<string, number>> | null {
    return this.timer.timings;
  }

  get bandStats(): BandStats {
    return {
      capacity: this.bandCapacity,
      lastCount: this.bandLastCount,
      growths: this.bandGrowths,
    };
  }

  /** The per-level compute plans behind `plan.levels`. */
  get levelPlans(): readonly ComputeLevelPlan[] {
    return this.computePlans;
  }

  describe(): string[] {
    return this.levels.map((state) =>
      describeComputeLevel(state.level, state.plan)
    );
  }

  // ---------------------------------------------------------------- scene

  private writeSceneUniforms(): void {
    const data = new ArrayBuffer(32);
    const view = new DataView(data);
    view.setFloat32(0, this.width, true);
    view.setFloat32(4, this.height, true);
    view.setUint32(8, this.segmentCount, true);
    view.setUint32(12, this.shapeCount, true);
    view.setUint32(16, this.tiles[0], true);
    view.setUint32(20, this.tiles[1], true);
    view.setFloat32(24, this.options.binRadius, true);
    this.device.queue.writeBuffer(this.sceneUniform, 0, data);
  }

  setScene(scene: StrokeScene): void {
    if (scene.segmentData.byteLength > this.segmentBuffer.size) {
      this.segmentBuffer.destroy();
      this.segmentBuffer = createStorageBuffer(
        this.device,
        "rc-segments",
        scene.segmentData.byteLength * 2,
      );
      this.binsBindGroup = null;
      this.rasterBindGroup = null;
    }
    if (scene.materialData.byteLength > this.materialBuffer.size) {
      this.materialBuffer.destroy();
      this.materialBuffer = createStorageBuffer(
        this.device,
        "rc-materials",
        scene.materialData.byteLength * 2,
      );
      this.binsBindGroup = null;
      this.rasterBindGroup = null;
    }
    this.device.queue.writeBuffer(this.segmentBuffer, 0, scene.segmentData);
    this.device.queue.writeBuffer(
      this.materialBuffer,
      0,
      scene.materialData.buffer,
      scene.materialData.byteOffset,
      scene.materialData.byteLength,
    );
    this.segmentCount = scene.segmentCount;
    this.shapeCount = scene.shapeCount;
    this.writeSceneUniforms();
    this.sceneDirty = true;
  }

  private encodeScene(encoder: GPUCommandEncoder): void {
    if (!this.sceneDirty) return;
    this.sceneDirty = false;
    this.binsBindGroup ??= this.device.createBindGroup({
      label: "rc-compute-scene-bins-bind",
      layout: this.binsPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.sceneUniform } },
        { binding: 1, resource: { buffer: this.segmentBuffer } },
        { binding: 2, resource: { buffer: this.materialBuffer } },
        { binding: 3, resource: { buffer: this.binsBuffer } },
        { binding: 4, resource: { buffer: this.tileMeta } },
      ],
    });
    this.rasterBindGroup ??= this.device.createBindGroup({
      label: "rc-compute-scene-raster-bind",
      layout: this.rasterPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.sceneUniform } },
        { binding: 1, resource: { buffer: this.segmentBuffer } },
        { binding: 2, resource: { buffer: this.materialBuffer } },
        { binding: 3, resource: { buffer: this.binsBuffer } },
        { binding: 4, resource: { buffer: this.tileMeta } },
        { binding: 5, resource: this.emission.view },
        { binding: 6, resource: this.transmittance.view },
        { binding: 7, resource: this.albedo.view },
        { binding: 8, resource: this.distance.view },
      ],
    });
    const bins = encoder.beginComputePass({
      label: "rc-scene-bins",
      timestampWrites: this.timer.writes("scene bins"),
    });
    bins.setPipeline(this.binsPipeline);
    bins.setBindGroup(0, this.binsBindGroup);
    bins.dispatchWorkgroups(this.tiles[0], this.tiles[1], 1);
    bins.end();
    const raster = encoder.beginComputePass({
      label: "rc-scene-raster",
      timestampWrites: this.timer.writes("scene raster"),
    });
    raster.setPipeline(this.rasterPipeline);
    raster.setBindGroup(0, this.rasterBindGroup);
    raster.dispatchWorkgroups(this.tiles[0], this.tiles[1], 1);
    raster.end();
  }

  // ------------------------------------------------------------- planning

  private runtime(): CascadeRuntime {
    const plan = this.plan;
    return {
      branching: plan.effective.branching,
      mergeMode: MERGE_MODES[this.config.mergeMode] ?? 0,
      preAverage: plan.effective.preAverage,
      useDistanceField: this.config.useDistanceField,
      stepSize: Math.max(0.1, this.config.stepSize),
      intervalOverlap: Math.max(0.1, this.config.intervalOverlap),
      sky: this.config.sky,
    };
  }

  configure(config: Partial<RadianceCascadeConfig>): CascadePlan {
    if (this.disposed) throw new Error("renderer is disposed");
    this.config = { ...this.config, ...config };
    const limits = this.device.limits;
    const maxLevelBytes = Math.min(
      limits.maxStorageBufferBindingSize,
      limits.maxBufferSize,
    );
    const lanes = Math.min(256, limits.maxComputeInvocationsPerWorkgroup);
    const branching = Math.max(1, Math.round(this.config.branching));
    const group = this.config.preAverage && branching > 1 ? branching : 1;
    const warnings: string[] = [];
    const planConfig = { ...this.config };
    if (Math.round(planConfig.baseRayCount) / group > lanes) {
      const clamped = Math.floor(lanes) * group;
      warnings.push(
        `compute backend: cascade 0 must store at most ${lanes} directions; using ${clamped} rays instead of ${planConfig.baseRayCount}`,
      );
      planConfig.baseRayCount = clamped;
    }
    const plan = planCascades(
      this.width,
      this.height,
      planConfig,
      Infinity,
      (level) => {
        if (level.index === 0) return null;
        const bytes = level.probeCount[0] * level.probeCount[1] *
          level.storedDirs * STORE_ENTRY_BYTES;
        return bytes > maxLevelBytes
          ? `its ${(bytes / 1e6).toFixed(0)} MB store exceeds the device's ${
            (maxLevelBytes / 1e6).toFixed(0)
          } MB buffer limit`
          : null;
      },
    );
    plan.warnings.unshift(...warnings);
    this.currentPlan = plan;
    const runtime = this.runtime();
    const computePlans = plan.levels.map((level, i) =>
      planComputeLevel(
        level,
        plan.levels[i + 1] ?? null,
        runtime,
        this.options,
        {
          maxWorkgroupStorage: limits.maxComputeWorkgroupStorageSize,
          maxInvocations: limits.maxComputeInvocationsPerWorkgroup,
        },
      )
    );
    const levelsKey = JSON.stringify(plan.levels);
    const computeKey = JSON.stringify(computePlans);
    if (levelsKey !== this.levelsKey) {
      this.rebuildLevels(plan, computePlans);
      this.levelsKey = levelsKey;
      this.computeKey = computeKey;
    } else if (computeKey !== this.computeKey) {
      this.rebuildPipelines(computePlans);
      this.computeKey = computeKey;
    }
    this.computePlans = computePlans;
    this.writeAllUniforms();
    return plan;
  }

  private levelPipeline(plan: ComputeLevelPlan): GPUComputePipeline {
    const [tx, ty, dw] = plan.workgroup;
    const constants: Record<string, number> = {
      TX: tx,
      TY: ty,
      DW: dw,
      REDUCE: plan.reduce ? 1 : 0,
      USE_PATCH: plan.patch ? 1 : 0,
      PATCH_W: plan.patch?.size[0] ?? 1,
      PATCH_H: plan.patch?.size[1] ?? 1,
      USE_FOOT: plan.footprint ? 1 : 0,
      FOOT_X: plan.footprint?.[0] ?? 1,
      FOOT_Y: plan.footprint?.[1] ?? 1,
      FOOT_D: plan.footprint?.[2] ?? 1,
    };
    const key = JSON.stringify(constants);
    let pipeline = this.pipelineCache.get(key);
    if (!pipeline) {
      pipeline = this.device.createComputePipeline({
        label: `rc-compute-cascade ${key}`,
        layout: this.cascadePipelineLayout,
        compute: {
          module: this.modules.cascade,
          entryPoint: "main",
          constants,
        },
      });
      this.pipelineCache.set(key, pipeline);
    }
    return pipeline;
  }

  private rebuildLevels(
    plan: CascadePlan,
    computePlans: ComputeLevelPlan[],
  ): void {
    this.disposeLevels();
    const device = this.device;
    const level0 = plan.levels[0];
    this.probeIrradiance = createStorageTexture(
      device,
      level0.probeCount[0],
      level0.probeCount[1],
      HDR_FORMAT,
      "rc-probe-irradiance",
    );
    this.irradianceTex = computePlans[0].reduce &&
        level0.probeSpacing === 1 &&
        level0.probeCount[0] === this.width &&
        level0.probeCount[1] === this.height
      ? this.probeIrradiance
      : createStorageTexture(
        device,
        this.width,
        this.height,
        HDR_FORMAT,
        "rc-irradiance",
      );
    const probes0 = level0.probeCount[0] * level0.probeCount[1];
    this.slotMap = createStorageBuffer(device, "rc-band-slots", probes0 * 4);
    // Outline-adjacent probes are a small fraction of all probes; start at an
    // eighth (the option is the floor), grow on overflow, never shrink.
    this.bandCapacity = Math.max(
      this.bandCapacity,
      Math.floor(this.options.bandCapacity),
      Math.ceil(probes0 / 8),
    );
    this.allocateBand();
    this.levels = plan.levels.map((level, i) => {
      const cplan = computePlans[i];
      return {
        level,
        plan: cplan,
        pipeline: this.levelPipeline(cplan),
        uniform: device.createBuffer({
          label: `rc-compute-cascade-${i}-uniforms`,
          size: CASCADE_UNIFORM_BYTES,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }),
        store: cplan.reduce ? null : createStorageBuffer(
          device,
          `rc-cascade-${i}-store`,
          cplan.storeBytes,
        ),
        raw: null,
        debug: null,
        bindGroup: null,
      };
    });
    if (this.debugEnabled) this.allocateDebug();
    this.bounceBindGroup = null;
    this.upsampleBindGroup = null;
    this.gatherBindGroup = null;
    this.referenceBindGroup = null;
  }

  private rebuildPipelines(computePlans: ComputeLevelPlan[]): void {
    for (const [i, state] of this.levels.entries()) {
      state.plan = computePlans[i];
      state.pipeline = this.levelPipeline(state.plan);
      state.bindGroup = null;
    }
  }

  private allocateBand(): void {
    const level0 = this.levels[0]?.level ?? this.plan.levels[0];
    this.band?.destroy();
    this.band = createStorageBuffer(
      this.device,
      "rc-band",
      this.bandCapacity * level0.storedDirs * BAND_ENTRY_BYTES,
    );
  }

  private growBand(needed: number): void {
    this.bandCapacity = Math.max(
      this.bandCapacity * 2,
      Math.ceil(needed * 1.25),
    );
    this.bandGrowths++;
    this.allocateBand();
    // A fresh slot map, so the bounce never indexes the new band with stale slots.
    this.slotMap?.destroy();
    const level0 = this.plan.levels[0];
    this.slotMap = createStorageBuffer(
      this.device,
      "rc-band-slots",
      level0.probeCount[0] * level0.probeCount[1] * 4,
    );
    if (this.levels[0]) this.levels[0].bindGroup = null;
    this.bounceBindGroup = null;
    this.writeAllUniforms();
  }

  private pollBandCounter(): void {
    if (this.counterPending) return;
    this.counterPending = true;
    this.counterStaging.mapAsync(GPUMapMode.READ).then(() => {
      const count = new Uint32Array(this.counterStaging.getMappedRange())[0];
      this.counterStaging.unmap();
      this.counterPending = false;
      this.bandLastCount = count;
      if (!this.disposed && count > this.bandCapacity) this.growBand(count);
    }).catch(() => {
      this.counterPending = false;
    });
  }

  // ------------------------------------------------------------- uniforms

  private writeAllUniforms(): void {
    const runtime = this.runtime();
    for (const [i, state] of this.levels.entries()) {
      this.writeLevelUniforms(
        state,
        this.levels[i + 1]?.level ?? null,
        runtime,
      );
    }
    const level0 = this.plan.levels[0];
    const bounce = new ArrayBuffer(32);
    const bv = new DataView(bounce);
    bv.setUint32(0, level0.probeCount[0], true);
    bv.setUint32(4, level0.probeCount[1], true);
    bv.setFloat32(8, level0.probeSpacing, true);
    bv.setUint32(12, level0.storedDirs, true);
    bv.setUint32(16, level0.rayCount, true);
    bv.setFloat32(20, Math.max(0, this.config.bounceStrength), true);
    bv.setFloat32(24, this.options.bounceOffset, true);
    bv.setUint32(28, this.options.fuseCascade0 ? 0 : 1, true);
    this.device.queue.writeBuffer(this.bounceUniform, 0, bounce);
    const gather = new ArrayBuffer(16);
    const gv = new DataView(gather);
    gv.setUint32(0, level0.probeCount[0], true);
    gv.setUint32(4, level0.probeCount[1], true);
    gv.setFloat32(8, level0.probeSpacing, true);
    gv.setUint32(12, level0.storedDirs, true);
    this.device.queue.writeBuffer(this.gatherUniform, 0, gather);
    const upsample = new ArrayBuffer(16);
    const uv = new DataView(upsample);
    uv.setUint32(0, level0.probeCount[0], true);
    uv.setUint32(4, level0.probeCount[1], true);
    uv.setFloat32(8, level0.probeSpacing, true);
    this.device.queue.writeBuffer(this.upsampleUniform, 0, upsample);
    const maxDistance = Math.hypot(this.width, this.height);
    const referenceSteps = runtime.useDistanceField
      ? 512
      : Math.min(8192, Math.ceil(maxDistance / runtime.stepSize) + 8);
    this.device.queue.writeBuffer(
      this.referenceUniform,
      0,
      new Float32Array([
        runtime.sky[0],
        runtime.sky[1],
        runtime.sky[2],
        0,
        this.width,
        this.height,
        Math.max(1, Math.floor(this.config.referenceRays)),
        maxDistance,
        runtime.useDistanceField ? 1 : 0,
        runtime.stepSize,
        referenceSteps,
        0,
      ]),
    );
  }

  private writeLevelUniforms(
    state: LevelState,
    upper: CascadeLevel | null,
    runtime: CascadeRuntime,
  ): void {
    const level = state.level;
    const intervalLength = (level.intervalEnd - level.intervalStart) *
      runtime.intervalOverlap;
    const maxSteps = runtime.useDistanceField
      ? 256
      : Math.min(4096, Math.ceil(intervalLength / runtime.stepSize) + 8);
    const data = new ArrayBuffer(CASCADE_UNIFORM_BYTES);
    const v = new DataView(data);
    v.setFloat32(0, runtime.sky[0], true);
    v.setFloat32(4, runtime.sky[1], true);
    v.setFloat32(8, runtime.sky[2], true);
    v.setFloat32(16, this.width, true);
    v.setFloat32(20, this.height, true);
    v.setUint32(24, level.probeCount[0], true);
    v.setUint32(28, level.probeCount[1], true);
    v.setUint32(32, upper?.probeCount[0] ?? 1, true);
    v.setUint32(36, upper?.probeCount[1] ?? 1, true);
    v.setFloat32(40, level.probeSpacing, true);
    v.setFloat32(44, upper?.probeSpacing ?? 1, true);
    v.setUint32(48, level.rayCount, true);
    v.setUint32(52, level.storedDirs, true);
    v.setUint32(56, upper?.rayCount ?? 1, true);
    v.setUint32(60, upper?.storedDirs ?? 1, true);
    v.setFloat32(64, level.intervalStart, true);
    v.setFloat32(68, level.intervalEnd, true);
    v.setUint32(72, runtime.branching, true);
    v.setUint32(76, upper ? 0 : 1, true);
    v.setUint32(80, runtime.mergeMode, true);
    v.setUint32(84, runtime.preAverage ? 1 : 0, true);
    v.setUint32(88, runtime.useDistanceField ? 1 : 0, true);
    v.setFloat32(92, runtime.stepSize, true);
    v.setFloat32(96, runtime.intervalOverlap, true);
    v.setInt32(100, maxSteps, true);
    v.setUint32(104, state.store ? 1 : 0, true);
    v.setUint32(108, state.raw ? 1 : 0, true);
    v.setUint32(112, this.bandCapacity, true);
    v.setFloat32(
      116,
      this.options.bounceBand
        ? this.options.bounceOffset + 1.5 * level.probeSpacing + 1
        : -1,
      true,
    );
    v.setFloat32(120, state.plan.patch?.halo ?? 0, true);
    this.device.queue.writeBuffer(state.uniform, 0, data);
  }

  // ---------------------------------------------------------------- debug

  setDebugViews(enabled: boolean): void {
    if (enabled === this.debugEnabled) return;
    this.debugEnabled = enabled;
    if (enabled) this.allocateDebug();
    else this.disposeDebug();
    for (const state of this.levels) state.bindGroup = null;
    // The bounce binds cascade 0's store, which debug views create and free.
    this.bounceBindGroup = null;
    this.writeAllUniforms();
  }

  private allocateDebug(): void {
    const device = this.device;
    const limits = device.limits;
    const maxBytes = Math.min(
      limits.maxStorageBufferBindingSize,
      limits.maxBufferSize,
    );
    for (const state of this.levels) {
      const level = state.level;
      const entries = level.probeCount[0] * level.probeCount[1] *
        level.storedDirs;
      const rawBytes = entries * RAW_ENTRY_BYTES;
      const storeBytes = entries * STORE_ENTRY_BYTES;
      if (
        Math.max(...level.textureSize) > limits.maxTextureDimension2D ||
        rawBytes > maxBytes || (!state.store && storeBytes > maxBytes)
      ) {
        console.warn(
          `[radiance-cascades] compute backend: cascade ${level.index} debug views exceed device limits; skipped`,
        );
        continue;
      }
      state.store ??= createStorageBuffer(
        device,
        `rc-cascade-${level.index}-store`,
        storeBytes,
      );
      state.raw = createStorageBuffer(
        device,
        `rc-cascade-${level.index}-raw`,
        rawBytes,
      );
      const merged = createStorageTexture(
        device,
        level.textureSize[0],
        level.textureSize[1],
        HDR_FORMAT,
        `rc-cascade-${level.index}-merged-debug`,
      );
      const raw = createStorageTexture(
        device,
        level.textureSize[0],
        level.textureSize[1],
        HDR_FORMAT,
        `rc-cascade-${level.index}-raw-debug`,
      );
      const uniform = device.createBuffer({
        label: `rc-unpack-${level.index}-uniforms`,
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const data = new ArrayBuffer(16);
      const v = new DataView(data);
      v.setUint32(0, level.probeCount[0], true);
      v.setUint32(4, level.probeCount[1], true);
      v.setUint32(8, level.storedDirs, true);
      v.setUint32(12, level.tileCols, true);
      device.queue.writeBuffer(uniform, 0, data);
      const unpackBindGroup = device.createBindGroup({
        label: `rc-unpack-${level.index}-bind`,
        layout: this.unpackPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniform } },
          { binding: 1, resource: { buffer: state.store } },
          { binding: 2, resource: { buffer: state.raw } },
          { binding: 3, resource: merged.view },
          { binding: 4, resource: raw.view },
        ],
      });
      state.debug = { merged, raw, uniform, unpackBindGroup };
    }
  }

  private disposeDebug(): void {
    for (const state of this.levels) {
      if (state.debug) {
        state.debug.merged.texture.destroy();
        state.debug.raw.texture.destroy();
        state.debug.uniform.destroy();
        state.debug = null;
      }
      state.raw?.destroy();
      state.raw = null;
      if (state.plan.reduce) {
        state.store?.destroy();
        state.store = null;
      }
    }
  }

  // ------------------------------------------------------------- encoding

  private levelBindGroup(index: number): GPUBindGroup {
    const state = this.levels[index];
    if (state.bindGroup) return state.bindGroup;
    const upper = this.levels[index + 1];
    const [d4, d5, d6, d8, d9, d10] = this.dummyBuffers;
    const reduce = state.plan.reduce;
    state.bindGroup = this.device.createBindGroup({
      label: `rc-compute-cascade-${index}-bind`,
      layout: this.cascadeLayout,
      entries: [
        { binding: 0, resource: { buffer: state.uniform } },
        { binding: 1, resource: this.effective.view },
        { binding: 2, resource: this.transmittance.view },
        { binding: 3, resource: this.distance.view },
        { binding: 4, resource: { buffer: upper?.store ?? d4 } },
        { binding: 5, resource: { buffer: state.store ?? d5 } },
        { binding: 6, resource: { buffer: state.raw ?? d6 } },
        {
          binding: 7,
          resource: reduce
            ? this.probeIrradiance!.view
            : this.dummyStorageTexture.view,
        },
        { binding: 8, resource: { buffer: reduce ? this.slotMap! : d8 } },
        { binding: 9, resource: { buffer: reduce ? this.band! : d9 } },
        { binding: 10, resource: { buffer: reduce ? this.bandCounter : d10 } },
      ],
    });
    return state.bindGroup;
  }

  private encodeBounce(encoder: GPUCommandEncoder): void {
    this.bounceBindGroup ??= this.device.createBindGroup({
      label: "rc-compute-bounce-bind",
      layout: this.bouncePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.bounceUniform } },
        { binding: 1, resource: this.emission.view },
        { binding: 2, resource: this.albedo.view },
        { binding: 3, resource: this.distance.view },
        { binding: 4, resource: { buffer: this.slotMap! } },
        { binding: 5, resource: { buffer: this.band! } },
        { binding: 6, resource: this.probeIrradiance!.view },
        { binding: 7, resource: this.effective.view },
        {
          binding: 8,
          resource: { buffer: this.levels[0]?.store ?? this.dummyBuffers[0] },
        },
      ],
    });
    const pass = encoder.beginComputePass({
      label: "rc-bounce",
      timestampWrites: this.timer.writes("bounce"),
    });
    pass.setPipeline(this.bouncePipeline);
    pass.setBindGroup(0, this.bounceBindGroup);
    pass.dispatchWorkgroups(
      Math.ceil(this.width / 16),
      Math.ceil(this.height / 16),
      1,
    );
    pass.end();
  }

  private encodeCascades(encoder: GPUCommandEncoder): void {
    encoder.clearBuffer(this.bandCounter);
    for (let i = this.levels.length - 1; i >= 0; i--) {
      const state = this.levels[i];
      const pass = encoder.beginComputePass({
        label: `rc-cascade-${i}`,
        timestampWrites: this.timer.writes(`cascade ${i}`),
      });
      pass.setPipeline(state.pipeline);
      pass.setBindGroup(0, this.levelBindGroup(i));
      pass.dispatchWorkgroups(...state.plan.dispatch);
      pass.end();
    }
    if (!this.levels[0].plan.reduce) {
      this.gatherBindGroup ??= this.device.createBindGroup({
        label: "rc-compute-gather-bind",
        layout: this.gatherPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.gatherUniform } },
          { binding: 1, resource: { buffer: this.levels[0].store! } },
          { binding: 2, resource: this.irradianceTex!.view },
        ],
      });
      const pass = encoder.beginComputePass({
        label: "rc-gather",
        timestampWrites: this.timer.writes("gather"),
      });
      pass.setPipeline(this.gatherPipeline);
      pass.setBindGroup(0, this.gatherBindGroup);
      pass.dispatchWorkgroups(
        Math.ceil(this.width / 16),
        Math.ceil(this.height / 16),
        1,
      );
      pass.end();
    } else if (this.irradianceTex !== this.probeIrradiance) {
      this.upsampleBindGroup ??= this.device.createBindGroup({
        label: "rc-compute-upsample-bind",
        layout: this.upsamplePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.upsampleUniform } },
          { binding: 1, resource: this.probeIrradiance!.view },
          { binding: 2, resource: this.irradianceTex!.view },
        ],
      });
      const pass = encoder.beginComputePass({
        label: "rc-upsample",
        timestampWrites: this.timer.writes("upsample"),
      });
      pass.setPipeline(this.upsamplePipeline);
      pass.setBindGroup(0, this.upsampleBindGroup);
      pass.dispatchWorkgroups(
        Math.ceil(this.width / 16),
        Math.ceil(this.height / 16),
        1,
      );
      pass.end();
    }
    if (this.debugEnabled) {
      for (const state of this.levels) {
        if (!state.debug) continue;
        const pass = encoder.beginComputePass({
          label: `rc-unpack-${state.level.index}`,
          timestampWrites: this.timer.writes("debug unpack"),
        });
        pass.setPipeline(this.unpackPipeline);
        pass.setBindGroup(0, state.debug.unpackBindGroup);
        pass.dispatchWorkgroups(
          Math.ceil(state.level.textureSize[0] / 16),
          Math.ceil(state.level.textureSize[1] / 16),
          1,
        );
        pass.end();
      }
    }
  }

  render(): void {
    if (this.disposed) throw new Error("renderer is disposed");
    const encoder = this.device.createCommandEncoder({
      label: "rc-compute-frame",
    });
    this.timer.begin();
    this.encodeScene(encoder);
    this.encodeBounce(encoder);
    this.encodeCascades(encoder);
    this.timer.resolve(encoder);
    const readCounter = !this.counterPending;
    if (readCounter) {
      encoder.copyBufferToBuffer(
        this.bandCounter,
        0,
        this.counterStaging,
        0,
        4,
      );
    }
    this.device.queue.submit([encoder.finish()]);
    this.timer.collect();
    if (readCounter) this.pollBandCounter();
  }

  renderReference(): void {
    if (this.disposed) throw new Error("renderer is disposed");
    const encoder = this.device.createCommandEncoder({
      label: "rc-compute-reference",
    });
    this.timer.begin();
    this.encodeScene(encoder);
    this.encodeBounce(encoder);
    this.referenceBindGroup ??= this.device.createBindGroup({
      label: "rc-reference-bind",
      layout: this.referencePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.referenceUniform } },
        { binding: 1, resource: this.effective.view },
        { binding: 2, resource: this.transmittance.view },
        { binding: 3, resource: this.distance.view },
      ],
    });
    const pass = encoder.beginRenderPass({
      label: "rc-reference",
      colorAttachments: [{
        view: this.referenceTex.view,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: "clear",
        storeOp: "store",
      }],
    });
    pass.setPipeline(this.referencePipeline);
    pass.setBindGroup(0, this.referenceBindGroup);
    pass.draw(3);
    pass.end();
    this.timer.resolve(encoder);
    this.device.queue.submit([encoder.finish()]);
    this.timer.collect();
  }

  // ---------------------------------------------------------------- views

  cascadeTextures(index: number): [GPUTexture, GPUTexture] {
    const state = this.levels[index];
    if (!state) throw new Error(`no cascade ${index}`);
    if (!state.debug) {
      throw new Error(
        `cascade ${index} debug views are off; call setDebugViews(true) and render a frame first`,
      );
    }
    return [state.debug.merged.texture, state.debug.raw.texture];
  }

  get views(): RendererViews {
    const dummy = this.dummyStorageTexture.view;
    return {
      irradiance: this.irradiance.output,
      reference: this.referenceTex.view,
      emission: this.emission.view,
      effectiveEmission: this.effective.view,
      transmittance: this.transmittance.view,
      albedo: this.albedo.view,
      distance: this.distance.view,
      cascades: this.levels.map((state) => ({
        merged: state.debug?.merged.view ?? dummy,
        raw: state.debug?.raw.view ?? dummy,
        size: state.debug ? state.level.textureSize : [1, 1],
      })),
    };
  }

  // -------------------------------------------------------------- dispose

  private disposeLevels(): void {
    this.disposeDebug();
    for (const state of this.levels) {
      state.uniform.destroy();
      state.store?.destroy();
    }
    this.levels = [];
    if (this.irradianceTex && this.irradianceTex !== this.probeIrradiance) {
      this.irradianceTex.texture.destroy();
    }
    this.probeIrradiance?.texture.destroy();
    this.probeIrradiance = null;
    this.irradianceTex = null;
    this.slotMap?.destroy();
    this.slotMap = null;
    this.band?.destroy();
    this.band = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeLevels();
    this.currentPlan = null;
    this.timer.dispose();
    this.segmentBuffer.destroy();
    this.materialBuffer.destroy();
    this.sceneUniform.destroy();
    this.binsBuffer.destroy();
    this.tileMeta.destroy();
    for (
      const t of [
        this.emission,
        this.transmittance,
        this.albedo,
        this.distance,
        this.effective,
        this.referenceTex,
        this.dummyStorageTexture,
      ]
    ) {
      t.texture.destroy();
    }
    this.bounceUniform.destroy();
    this.upsampleUniform.destroy();
    this.gatherUniform.destroy();
    this.bandCounter.destroy();
    if (!this.counterPending) this.counterStaging.destroy();
    for (const buffer of this.dummyBuffers) buffer.destroy();
    this.referenceUniform.destroy();
  }
}
