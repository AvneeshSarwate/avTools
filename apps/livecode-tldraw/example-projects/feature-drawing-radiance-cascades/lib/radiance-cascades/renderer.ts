/**
 * The fragment-shader radiance cascade renderer: plans the cascade levels
 * from the render size and configuration, owns the shader-fx effect chain,
 * and re-plans it when a structural parameter changes. The compute-shader
 * alternative is `compute/renderer.ts`; both satisfy `RadianceRenderer` in
 * `backend.ts` and share `planCascades`.
 */

import type { RadianceRenderer } from "./backend.ts";
import { GpuTimer } from "./compute/timer.ts";
import {
  BounceEffect,
  CascadeEffect,
  type CascadeLevel,
  type CascadeRuntime,
  GatherEffect,
  ReferenceEffect,
  StrokeSceneEffect,
} from "./effects.ts";
import type { StrokeScene } from "./geometry.ts";

export type MergeMode = "vanilla" | "bilinearFix" | "parallaxFix";

export interface RadianceCascadeConfig {
  /** Cascade 0 probe spacing in render pixels. */
  probeSpacing: number;
  /** Rays per probe at cascade 0. */
  baseRayCount: number;
  /** Ray count multiplier per cascade (probe spacing always doubles). */
  branching: number;
  /** Cascade 0 interval length in render pixels. */
  intervalLength: number;
  /** Interval length multiplier per cascade. */
  intervalScale: number;
  /** Number of cascades; 0 derives it from the render size. */
  cascadeCount: number;
  mergeMode: MergeMode;
  /**
   * Merge mode for the far levels, from cascade `farMergeFrom` up (0 turns
   * this off). The bilinear fix marches eight rays per lane against one; its
   * visual value is at the near levels, so a cheaper far mode buys most of
   * the speed back.
   */
  farMergeMode: MergeMode;
  farMergeFrom: number;
  /** Store each level pre-averaged over its branching groups. */
  preAverage: boolean;
  /**
   * Also pre-average the levels from this cascade up (0 turns this off): a
   * pre-averaged level halves the marches of the bilinear-fix merge below
   * it (one child direction instead of `branching`).
   */
  preAverageFrom: number;
  /** Radiance for rays that leave the top cascade with light left to gather. */
  sky: readonly [number, number, number];
  /** Scale of last frame's irradiance times albedo fed back as emission. */
  bounceStrength: number;
  /** Sphere-trace the distance field between outlines; off marches fixed steps everywhere. */
  useDistanceField: boolean;
  /** March step inside outlines (and everywhere when the distance field is off), in render pixels. */
  stepSize: number;
  /** Interval length multiplier applied when marching (1 = exact; a little more hides seams). */
  intervalOverlap: number;
  /** Rays per pixel for the brute-force reference. */
  referenceRays: number;
}

/**
 * Defaults follow the penumbra condition: a level's angular ray spacing at
 * the end of its interval should match its probe spacing. With probe spacing
 * doubling and intervals quadrupling per level, rays need only double, and
 * cascade 0 needs about 2π·t1/s0 ≈ 16 rays at 1 px spacing. Measured on the
 * checked-in drawing, 1 px spacing cut the error against the brute-force
 * reference 2.5x over 2 px; the bilinear fix halved it again.
 */
export const DEFAULT_CONFIG: RadianceCascadeConfig = {
  probeSpacing: 1,
  baseRayCount: 16,
  branching: 2,
  intervalLength: 2,
  intervalScale: 4,
  cascadeCount: 0,
  mergeMode: "bilinearFix",
  farMergeMode: "vanilla",
  farMergeFrom: 0,
  preAverage: false,
  preAverageFrom: 0,
  sky: [0, 0, 0],
  bounceStrength: 0,
  useDistanceField: true,
  stepSize: 1,
  intervalOverlap: 1,
  referenceRays: 64,
};

export const MERGE_MODES: Record<MergeMode, number> = {
  vanilla: 0,
  bilinearFix: 1,
  parallaxFix: 2,
};

export interface CascadePlan {
  levels: CascadeLevel[];
  /** What the renderer runs after clamping; differs from the request when a level was dropped or a count rounded. */
  effective: {
    baseRayCount: number;
    branching: number;
    cascadeCount: number;
    preAverage: boolean;
    preAverageFrom: number;
  };
  warnings: string[];
}

/** Whether cascade `index` stores pre-averaged directions under `config`. */
export function levelPreAveraged(
  config: RadianceCascadeConfig,
  index: number,
): boolean {
  const branching = Math.max(1, Math.round(config.branching));
  if (branching <= 1) return false;
  return config.preAverage ||
    (config.preAverageFrom > 0 && index >= Math.round(config.preAverageFrom));
}

/** The merge mode cascade `index` uses under `config`, as a shader number. */
export function levelMergeMode(
  config: RadianceCascadeConfig,
  index: number,
): number {
  const far = config.farMergeFrom > 0 &&
    index >= Math.round(config.farMergeFrom);
  return MERGE_MODES[far ? config.farMergeMode : config.mergeMode] ?? 0;
}

/** A level's runtime: the shared settings with that level's merge mode and pre-averaging. */
export function levelRuntime(
  base: CascadeRuntime,
  config: RadianceCascadeConfig,
  index: number,
): CascadeRuntime {
  return {
    ...base,
    mergeMode: levelMergeMode(config, index),
    preAverage: levelPreAveraged(config, index),
  };
}

const MAX_CASCADES = 10;

/**
 * Cascade i: spacing s0 * 2^i, rays r0 * B^i, interval
 * [l0 (S^i - 1)/(S - 1), l0 (S^(i+1) - 1)/(S - 1)]. The automatic count is
 * the smallest whose top interval reaches the render diagonal. Levels whose
 * texture would exceed the device limit, or for which `fits` returns a
 * reason, are dropped with a warning (and so is everything above them).
 */
export function planCascades(
  width: number,
  height: number,
  config: RadianceCascadeConfig,
  maxTextureSize: number,
  fits?: (level: CascadeLevel) => string | null,
): CascadePlan {
  const warnings: string[] = [];
  const branching = Math.max(1, Math.round(config.branching));
  let baseRayCount = Math.max(1, Math.round(config.baseRayCount));
  const preAverage = config.preAverage && branching > 1;
  const preAverageFrom = Math.max(0, Math.round(config.preAverageFrom));
  if (levelPreAveraged(config, 0) && baseRayCount % branching !== 0) {
    const rounded = Math.max(
      branching,
      Math.round(baseRayCount / branching) * branching,
    );
    warnings.push(
      `pre-averaging needs the base ray count to be a multiple of the branching factor; using ${rounded} rays instead of ${baseRayCount}`,
    );
    baseRayCount = rounded;
  }
  const spacing0 = Math.max(1, config.probeSpacing);
  const l0 = Math.max(0.5, config.intervalLength);
  const scale = Math.max(1, config.intervalScale);
  const diagonal = Math.hypot(width, height);
  const intervalStart = (i: number) =>
    scale === 1 ? l0 * i : (l0 * (scale ** i - 1)) / (scale - 1);
  let requested = Math.round(config.cascadeCount);
  if (requested <= 0) {
    requested = 1;
    while (requested < MAX_CASCADES && intervalStart(requested) < diagonal) {
      requested++;
    }
  }
  requested = Math.min(MAX_CASCADES, Math.max(1, requested));

  const levels: CascadeLevel[] = [];
  for (let i = 0; i < requested; i++) {
    const probeSpacing = spacing0 * 2 ** i;
    const probeCount: [number, number] = [
      Math.max(1, Math.ceil(width / probeSpacing)),
      Math.max(1, Math.ceil(height / probeSpacing)),
    ];
    const rayCount = baseRayCount * branching ** i;
    const storedDirs = levelPreAveraged(config, i)
      ? rayCount / branching
      : rayCount;
    const tileCols = Math.ceil(Math.sqrt(storedDirs));
    const tileRows = Math.ceil(storedDirs / tileCols);
    const textureSize: [number, number] = [
      tileCols * probeCount[0],
      tileRows * probeCount[1],
    ];
    if (Math.max(...textureSize) > maxTextureSize) {
      warnings.push(
        `cascade ${i} would need a ${textureSize[0]}x${
          textureSize[1]
        } texture (device limit ${maxTextureSize}); stopping at ${i} cascades`,
      );
      break;
    }
    const level: CascadeLevel = {
      index: i,
      probeSpacing,
      probeCount,
      rayCount,
      storedDirs,
      tileCols,
      tileRows,
      textureSize,
      intervalStart: intervalStart(i),
      intervalEnd: intervalStart(i + 1),
    };
    const reason = fits?.(level);
    if (reason) {
      warnings.push(`cascade ${i}: ${reason}; stopping at ${i} cascades`);
      break;
    }
    levels.push(level);
  }
  if (levels.length === 0) {
    throw new Error("radiance cascades: no cascade fits the device limits");
  }
  return {
    levels,
    effective: {
      baseRayCount,
      branching,
      cascadeCount: levels.length,
      preAverage,
      preAverageFrom,
    },
    warnings,
  };
}

/**
 * Whether a level's bilinear-fix corner rays should share a bundle trace of
 * their free-space prefix (march.wgsl, `marchBundle`). The four rays of a
 * child diverge by about two upper spacings over the interval, so the
 * bundle only pays where the interval is long against that: measured, from
 * eight upper spacings up (the two farthest levels of the default plan);
 * below, the setup costs more than the shared steps save.
 */
export function bundleWorthIt(
  level: CascadeLevel,
  upper: CascadeLevel | null,
): boolean {
  return upper !== null && level.intervalEnd >= 8 * upper.probeSpacing;
}

/**
 * Whether a level's bilinear-fix corner rays should be marched in lockstep
 * (march.wgsl, `march4`): four distance loads in flight per lane instead of
 * a serial chain. Pays where marches are a few steps long and latency
 * dominates: measured, intervals up to two probe spacings (cascade 0 of the
 * default plan, whose rays are 2 px); on longer intervals the bookkeeping
 * and the rays finishing at different times cost more.
 */
export function interleaveWorthIt(level: CascadeLevel): boolean {
  return level.intervalEnd - level.intervalStart <= 2 * level.probeSpacing;
}

export interface CascadeViews {
  merged: GPUTextureView;
  raw: GPUTextureView;
  size: [number, number];
}

export interface RendererViews {
  irradiance: GPUTextureView;
  reference: GPUTextureView;
  emission: GPUTextureView;
  effectiveEmission: GPUTextureView;
  transmittance: GPUTextureView;
  albedo: GPUTextureView;
  distance: GPUTextureView;
  cascades: CascadeViews[];
}

export class RadianceCascadeRenderer implements RadianceRenderer {
  readonly backend = "fragment" as const;
  readonly width: number;
  readonly height: number;
  readonly scene: StrokeSceneEffect;
  readonly bounce: BounceEffect;
  readonly reference: ReferenceEffect;
  private cascades: CascadeEffect[] = [];
  private gather: GatherEffect | null = null;
  private config: RadianceCascadeConfig;
  private currentPlan: CascadePlan | null = null;
  private planKey = "";
  private debugViews = false;
  private readonly timer: GpuTimer;

  constructor(
    private readonly device: GPUDevice,
    width: number,
    height: number,
    config: Partial<RadianceCascadeConfig> = {},
  ) {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.timer = new GpuTimer(device);
    this.scene = new StrokeSceneEffect(device, this.width, this.height);
    this.bounce = new BounceEffect(device, this.scene);
    this.reference = new ReferenceEffect(device, this.bounce, this.scene);
    this.scene.timer = this.timer;
    this.bounce.timer = this.timer;
    this.reference.timer = this.timer;
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

  /** The final irradiance effect, for chaining into other shader-fx effects. */
  get irradiance(): GatherEffect {
    if (!this.gather) throw new Error("renderer is disposed");
    return this.gather;
  }

  setScene(scene: StrokeScene): void {
    this.scene.setScene(scene);
  }

  /**
   * The merged cascade textures always exist (the levels read each other);
   * the raw ones are rendered and kept only while requested.
   */
  setDebugViews(enabled: boolean): void {
    this.debugViews = enabled;
    for (const cascade of this.cascades) cascade.setRaw(enabled);
  }

  /** Per-pass GPU times (each pass is its own submit; `total` spans them). */
  get timings(): Readonly<Record<string, number>> | null {
    return this.timer.timings;
  }

  describe(): string[] {
    return this.plan.levels.map((level) =>
      `c${level.index}: spacing ${level.probeSpacing}, ${level.rayCount} rays, ` +
      `[${level.intervalStart.toFixed(1)}, ${
        level.intervalEnd.toFixed(1)
      }] px, ` +
      `${level.textureSize[0]}x${level.textureSize[1]} x2 textures`
    );
  }

  /** Apply a configuration; rebuilds the cascade chain when its plan changes. */
  configure(config: Partial<RadianceCascadeConfig>): CascadePlan {
    this.config = { ...this.config, ...config };
    const plan = planCascades(
      this.width,
      this.height,
      this.config,
      this.device.limits.maxTextureDimension2D,
    );
    const key = JSON.stringify(plan.levels);
    if (key !== this.planKey) {
      this.rebuild(plan);
      this.planKey = key;
    }
    this.currentPlan = plan;
    const runtime: CascadeRuntime = {
      branching: plan.effective.branching,
      mergeMode: MERGE_MODES[this.config.mergeMode] ?? 0,
      preAverage: plan.effective.preAverage,
      useDistanceField: this.config.useDistanceField,
      stepSize: Math.max(0.1, this.config.stepSize),
      intervalOverlap: Math.max(0.1, this.config.intervalOverlap),
      sky: this.config.sky,
    };
    for (const [i, cascade] of this.cascades.entries()) {
      cascade.setRuntime(levelRuntime(runtime, this.config, i));
    }
    this.bounce.setBounce(this.config.bounceStrength);
    this.reference.setRuntime({
      rays: this.config.referenceRays,
      useDistanceField: runtime.useDistanceField,
      stepSize: runtime.stepSize,
      sky: this.config.sky,
    });
    return plan;
  }

  private rebuild(plan: CascadePlan): void {
    this.gather?.dispose();
    for (const cascade of this.cascades) cascade.dispose();
    this.cascades = [];
    let upper: CascadeEffect | null = null;
    for (let i = plan.levels.length - 1; i >= 0; i--) {
      const cascade: CascadeEffect = new CascadeEffect(
        this.device,
        plan.levels[i],
        this.bounce,
        this.scene,
        upper,
      );
      cascade.timer = this.timer;
      cascade.setRaw(this.debugViews);
      this.cascades[i] = cascade;
      upper = cascade;
    }
    const cascade0 = this.cascades[0];
    this.bounce.setPrevious(cascade0, plan.levels[0]);
    this.gather = new GatherEffect(
      this.device,
      this.width,
      this.height,
      cascade0,
    );
    this.gather.timer = this.timer;
  }

  /** Resolve the frame's pass timestamps in a submit of their own. */
  private resolveTimings(): void {
    if (!this.timer.enabled) return;
    const encoder = this.device.createCommandEncoder({ label: "rc-timings" });
    this.timer.resolve(encoder);
    this.device.queue.submit([encoder.finish()]);
    this.timer.collect();
  }

  /** Render one frame: scene (if changed), bounce, cascades top-down, gather. */
  render(): void {
    this.timer.begin();
    this.irradiance.renderAll();
    this.resolveTimings();
  }

  /** Render the brute-force reference (and the scene and bounce it reads). */
  renderReference(): void {
    this.timer.begin();
    this.reference.renderAll();
    this.resolveTimings();
  }

  /** A cascade's merged and raw radiance textures (for readback tools). */
  cascadeTextures(index: number): [GPUTexture, GPUTexture] {
    const cascade = this.cascades[index];
    if (!cascade) throw new Error(`no cascade ${index}`);
    if (!cascade.raw) {
      throw new Error(
        `cascade ${index} debug views are off; call setDebugViews(true) and render a frame first`,
      );
    }
    return [cascade.radiance, cascade.raw];
  }

  get views(): RendererViews {
    return {
      irradiance: this.irradiance.output,
      reference: this.reference.output,
      emission: this.scene.emissionView,
      effectiveEmission: this.bounce.output,
      transmittance: this.scene.transmittanceView,
      albedo: this.scene.albedoView,
      distance: this.scene.distanceView,
      cascades: this.cascades.map((cascade) => ({
        merged: cascade.radianceView,
        raw: cascade.rawView,
        size: cascade.level.textureSize,
      })),
    };
  }

  dispose(): void {
    this.gather?.dispose();
    this.gather = null;
    for (const cascade of this.cascades) cascade.dispose();
    this.cascades = [];
    this.reference.dispose();
    this.bounce.dispose();
    this.scene.dispose();
    this.timer.dispose();
    this.currentPlan = null;
  }
}
