/**
 * Planning for the compute backend: how each cascade level maps onto
 * workgroups and which workgroup-memory stagings pay for themselves.
 */

import type { CascadeLevel, CascadeRuntime } from "../effects.ts";

export interface ComputeOptions {
  /**
   * Stage the scene texels a tile's rays can reach in workgroup memory and
   * march there. "auto" enables it per level where the marches per patch
   * texel make it a win (cascade 0 with the bilinear fix, typically).
   */
  scenePatch: "auto" | boolean;
  /** Stage the upper-level probes a tile merges with in workgroup memory. */
  stageUpper: boolean;
  /** Lanes per cascade workgroup: a power of two, at most the device limit. */
  workgroupLanes: number;
  /** Scene rasterizer tile in pixels (also its workgroup size squared). */
  tileSize: number;
  /** Segments a tile bin holds before the tile falls back to all segments. */
  binCapacity: number;
  /**
   * Segments within this many pixels of a tile are binned; farther away the
   * distance field is a lower bound. At least half the tile diagonal.
   */
  binRadius: number;
  /** Initial bounce band capacity in probes; grows when it overflows. */
  bandCapacity: number;
  /** Bounce sample offset outside the outline, pixels (see bounce.wgsl). */
  bounceOffset: number;
}

export const DEFAULT_COMPUTE_OPTIONS: ComputeOptions = {
  scenePatch: "auto",
  stageUpper: true,
  workgroupLanes: 256,
  tileSize: 16,
  binCapacity: 128,
  binRadius: 24,
  bandCapacity: 8192,
  bounceOffset: 1.5,
};

export interface ComputeLimits {
  maxWorkgroupStorage: number;
  maxInvocations: number;
}

export interface ComputeLevelPlan {
  index: number;
  /** Probe tile (x, y) and stored directions per workgroup. */
  workgroup: [number, number, number];
  dispatch: [number, number, number];
  /** Cascade 0: reduce the directions to irradiance instead of storing them. */
  reduce: boolean;
  /** Scene patch in texels and its halo in pixels, when staged. */
  patch: { size: [number, number]; halo: number } | null;
  /** Upper footprint: probes (x, y) and upper directions, when staged. */
  footprint: [number, number, number] | null;
  workgroupBytes: number;
  /** Bytes of this level's direction store (0 when only reduced). */
  storeBytes: number;
  /** Rays marched per lane (the merge's cost model). */
  marchesPerLane: number;
}

export const STORE_ENTRY_BYTES = 12;
export const RAW_ENTRY_BYTES = 8;
export const BAND_ENTRY_BYTES = 8;

const floorPow2 = (n: number) => 2 ** Math.floor(Math.log2(Math.max(1, n)));

/** Split `lanes` into a (TX, TY) tile of powers of two, as square as possible. */
function tileOf(lanes: number): [number, number] {
  const n = floorPow2(lanes);
  const tx = floorPow2(Math.sqrt(n));
  return [tx, Math.max(1, n / tx)];
}

/** Pixels a ray of this level can travel from its probe's centre, per axis. */
export function rayHalo(
  level: CascadeLevel,
  upper: CascadeLevel | null,
  runtime: CascadeRuntime,
): number {
  const t0 = level.intervalStart;
  const t1 = level.intervalEnd;
  let reach = Math.max(t0, t0 + (t1 - t0) * runtime.intervalOverlap);
  if (upper && runtime.mergeMode === 1) {
    reach = Math.max(reach, upper.probeSpacing + t1);
  }
  return reach + 1;
}

export function planComputeLevel(
  level: CascadeLevel,
  upper: CascadeLevel | null,
  runtime: CascadeRuntime,
  options: ComputeOptions,
  limits: ComputeLimits,
): ComputeLevelPlan {
  const lanes = Math.min(
    floorPow2(options.workgroupLanes),
    floorPow2(limits.maxInvocations),
  );
  const reduce = level.index === 0;
  let tx: number;
  let ty: number;
  let dw: number;
  if (reduce) {
    dw = level.storedDirs;
    if (dw > lanes) {
      throw new Error(
        `compute cascades: cascade 0 stores ${dw} directions, more than the ${lanes} lanes of a workgroup`,
      );
    }
    [tx, ty] = tileOf(Math.floor(lanes / dw));
  } else {
    dw = 1;
    [tx, ty] = tileOf(lanes);
  }
  const laneCount = tx * ty * dw;
  const group = runtime.preAverage ? runtime.branching : 1;
  const upperPerDir = upper ? upper.storedDirs >= upper.rayCount : false;
  const childCount = upperPerDir ? runtime.branching : 1;
  const marchesPerLane = upper && runtime.mergeMode === 1
    ? 4 * childCount * group
    : group;

  const bandSlotBytes = tx * ty * 4;
  const reductionBytes = reduce ? laneCount * 16 : 16;
  let bytes = bandSlotBytes + reductionBytes;

  // Upper footprint: FX = TX/2 + 2 probes for spacing that doubles per level.
  let footprint: [number, number, number] | null = null;
  if (options.stageUpper && upper && runtime.mergeMode !== 2) {
    const fx = Math.floor(tx / 2) + 2;
    const fy = Math.floor(ty / 2) + 2;
    const fd = dw * group * childCount;
    const footBytes = fx * fy * fd * STORE_ENTRY_BYTES;
    if (bytes + footBytes <= limits.maxWorkgroupStorage) {
      footprint = [fx, fy, fd];
      bytes += footBytes;
    }
  }

  let patch: ComputeLevelPlan["patch"] = null;
  if (options.scenePatch !== false) {
    const halo = rayHalo(level, upper, runtime);
    const pw = Math.ceil(tx * level.probeSpacing + 2 * halo) + 1;
    const ph = Math.ceil(ty * level.probeSpacing + 2 * halo) + 1;
    const patchBytes = pw * ph * 16;
    const fits = bytes + patchBytes <= limits.maxWorkgroupStorage;
    // Loading a texel costs three texture reads; a march step saves about as
    // many. Stage when the tile's marches outnumber the patch texels enough.
    const worthIt = laneCount * marchesPerLane >= 6 * pw * ph;
    if (fits && (options.scenePatch === true || worthIt)) {
      patch = { size: [pw, ph], halo };
      bytes += patchBytes;
    }
  }

  return {
    index: level.index,
    workgroup: [tx, ty, dw],
    dispatch: [
      Math.ceil(level.probeCount[0] / tx),
      Math.ceil(level.probeCount[1] / ty),
      Math.ceil(level.storedDirs / dw),
    ],
    reduce,
    patch,
    footprint,
    workgroupBytes: bytes,
    storeBytes: reduce
      ? 0
      : level.probeCount[0] * level.probeCount[1] * level.storedDirs *
        STORE_ENTRY_BYTES,
    marchesPerLane,
  };
}

export function describeComputeLevel(
  level: CascadeLevel,
  plan: ComputeLevelPlan,
): string {
  const [tx, ty, dw] = plan.workgroup;
  const parts = [
    `c${level.index}: spacing ${level.probeSpacing}, ${level.rayCount} rays, ` +
    `[${level.intervalStart.toFixed(1)}, ${level.intervalEnd.toFixed(1)}] px`,
    `workgroup ${tx}x${ty}x${dw}${plan.reduce ? " reduce" : ""}`,
    plan.patch ? `patch ${plan.patch.size.join("x")}` : "no patch",
    plan.footprint ? `footprint ${plan.footprint.join("x")}` : "no footprint",
    `${(plan.workgroupBytes / 1024).toFixed(1)} KB workgroup`,
    plan.storeBytes
      ? `${(plan.storeBytes / 1e6).toFixed(1)} MB store`
      : "not stored",
  ];
  return parts.join(", ");
}
