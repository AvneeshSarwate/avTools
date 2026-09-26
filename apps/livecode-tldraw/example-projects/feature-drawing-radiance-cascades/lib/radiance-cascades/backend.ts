/**
 * The renderer contract both backends satisfy, so a module or tool can swap
 * the fragment-shader implementation (`renderer.ts`, shader-fx effects) for
 * the compute-shader one (`compute/renderer.ts`, raw WebGPU) with one string.
 */

import type { StrokeScene } from "./geometry.ts";
import {
  type CascadePlan,
  type RadianceCascadeConfig,
  RadianceCascadeRenderer,
  type RendererViews,
} from "./renderer.ts";
import type { ComputeOptions } from "./compute/plan.ts";
import { ComputeRadianceRenderer } from "./compute/renderer.ts";

export type RendererBackend = "fragment" | "compute" | "compute-subgroups";

/**
 * `compute-subgroups` is the compute backend with cascade 0 on WebGPU
 * subgroups: browsers only, since Deno's naga lacks the feature;
 * `backendAvailable` says whether a device can run one.
 */
export const RENDERER_BACKENDS: readonly RendererBackend[] = [
  "fragment",
  "compute",
  "compute-subgroups",
];

export function backendAvailable(
  backend: RendererBackend,
  device: GPUDevice,
): boolean {
  return backend !== "compute-subgroups" ||
    device.features.has("subgroups" as GPUFeatureName);
}

/** The backend `createRadianceRenderer` picks when none is named. */
export const DEFAULT_BACKEND: RendererBackend = "compute";

/** A texture the display pass or a readback can consume. */
export interface TextureOutput {
  readonly texture: GPUTexture;
  readonly output: GPUTextureView;
}

export interface RadianceRenderer {
  readonly backend: RendererBackend;
  readonly width: number;
  readonly height: number;
  readonly plan: CascadePlan;
  readonly currentConfig: RadianceCascadeConfig;
  /** Per-pixel irradiance, `rgba16float`, render size. */
  readonly irradiance: TextureOutput;
  /** The brute-force reference, rendered by `renderReference()`. */
  readonly reference: TextureOutput;
  readonly views: RendererViews;
  /**
   * GPU time per pass in milliseconds from the most recently resolved frame,
   * plus `total`; null when the backend or device does not time passes.
   */
  readonly timings: Readonly<Record<string, number>> | null;
  setScene(scene: StrokeScene): void;
  /** Apply a configuration; rebuilds what the new plan needs. */
  configure(config: Partial<RadianceCascadeConfig>): CascadePlan;
  /**
   * Whether the per-cascade debug views (`views.cascades`, `cascadeTextures`)
   * are produced. The compute backend only stores what they need on request.
   */
  setDebugViews(enabled: boolean): void;
  render(): void;
  renderReference(): void;
  /** A cascade's merged and raw radiance textures, direction-tiled. */
  cascadeTextures(index: number): [GPUTexture, GPUTexture];
  /** One line per cascade level describing what the backend runs. */
  describe(): string[];
  dispose(): void;
}

/**
 * The device features and limits the compute backend benefits from, all
 * optional: pass to `adapter.requestDevice()`. `timestamp-query` gives
 * per-pass GPU timings; the raised compute limits let the planner use larger
 * workgroup-memory patches and cascade buffers above 128 MB.
 */
export function radianceDeviceDescriptor(
  adapter: GPUAdapter,
): GPUDeviceDescriptor {
  const requiredFeatures: GPUFeatureName[] = [];
  for (const feature of ["timestamp-query", "subgroups"] as GPUFeatureName[]) {
    if (adapter.features.has(feature)) requiredFeatures.push(feature);
  }
  const limits = adapter.limits;
  return {
    requiredFeatures,
    requiredLimits: {
      maxComputeWorkgroupStorageSize: limits.maxComputeWorkgroupStorageSize,
      maxComputeInvocationsPerWorkgroup:
        limits.maxComputeInvocationsPerWorkgroup,
      maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
      maxBufferSize: limits.maxBufferSize,
    },
  };
}

export interface CreateRendererOptions {
  backend?: RendererBackend;
  compute?: Partial<ComputeOptions>;
}

export function createRadianceRenderer(
  device: GPUDevice,
  width: number,
  height: number,
  config: Partial<RadianceCascadeConfig> = {},
  options: CreateRendererOptions = {},
): RadianceRenderer {
  const backend = options.backend ?? DEFAULT_BACKEND;
  if (backend === "compute" || backend === "compute-subgroups") {
    return new ComputeRadianceRenderer(
      device,
      width,
      height,
      config,
      { ...options.compute, subgroups: backend === "compute-subgroups" },
    );
  }
  return new RadianceCascadeRenderer(device, width, height, config);
}
