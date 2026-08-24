/** Runtime wire types for launch, lifecycle, health, and rehydration. */

import type { VisualizerManifestMessage } from "./analysis.ts";

export interface LaunchModuleRequest {
  moduleId: string;
  transformedModuleUri: string;
  generatedRunId: string;
  sourceHash?: string;
  projectSourceHash?: string;
  projectModulePath?: string;
  manifest?: VisualizerManifestMessage | null;
  replaceRunning?: boolean;
}

export interface LaunchModuleResponse {
  ok: true;
  runToken: string;
}

export interface StopModuleRequest {
  moduleId: string;
}

export type RuntimeModuleRunState =
  | "launching"
  | "running"
  | "stopped"
  | "error";

/**
 * One module's latest run, keyed by `moduleId`. Active modules derive from
 * `state` client-side.
 */
export interface RunEntity {
  /** The entity name: exactly one run entity per module id. */
  moduleId: string;
  state: RuntimeModuleRunState;
  generatedRunId: string;
  /**
   * Identity of the RUN, minted when its launch is accepted. `generatedRunId`
   * identifies a prepared BUILD and is reused whenever a relaunch finds an
   * unchanged one, so it cannot distinguish a run from the run that replaced
   * it. Terminal dedupe keys on this token instead.
   */
  runToken: string;
  /** Number of times this module has entered user code in this engine process. */
  executionCount: number;
  updatedAt: number;
  projectModulePath?: string;
  sourceHash?: string;
  projectSourceHash?: string;
  message?: string;
}

/**
 * One module's currently active wait callsites, keyed by `moduleId`. The value
 * is the same per-module shape the editor already joins against a manifest —
 * only its transport changes.
 */
export interface ModuleWaitsEntity {
  /** The entity name: exactly one waits entity per module id. */
  moduleId: string;
  /** Sorted ids of the callsites this module is currently awaiting. */
  callsiteIds: string[];
}

/**
 * One module's last runtime-resolved piano-roll name per instrumented lookup
 * callsite, keyed by `moduleId`. Survives the run that produced it and is
 * cleared when the module is analyzed again.
 */
export interface ModuleLookupsEntity {
  /** The entity name: exactly one lookups entity per module id. */
  moduleId: string;
  /** callsiteId → the roll name that callsite last resolved to. */
  lookups: Record<string, string>;
}

export interface RuntimeCapabilityStatus {
  webgpu: boolean;
  unsafeWindowSurface: boolean;
  windowedP5gpu: boolean;
  warnings: string[];
}

export interface HealthResponse {
  ok: true;
  serverVersion: string;
  sessionRoot: string;
  activeModules: string[];
  /**
   * The SERVER process's capabilities. In remote engine mode execution
   * happens in a browser tab, so check `engine` to know which world the
   * capabilities describe.
   */
  runtimeCapabilities: RuntimeCapabilityStatus;
  /** Which execution plane serves this server, and whether it is live. */
  engine: {
    mode: "local" | "remote";
    /** From the engine's hello; null while no remote engine is attached. */
    kind: "deno" | "browser" | null;
    attached: boolean;
  };
}

export interface RuntimeModuleStatus {
  moduleId: string;
  generatedRunId: string;
  transformedModuleUri: string;
  projectModulePath?: string;
  sourceHash?: string;
  projectSourceHash?: string;
}

/** A run row returned by `/runtime/state`. */
export interface RuntimeStateModuleRun {
  moduleId: string;
  generatedRunId: string;
  state: RuntimeModuleRunState;
  updatedAtMs: number;
  runToken: string;
  /** Number of times this module has entered user code in this engine process. */
  executionCount: number;
  projectModulePath?: string;
  sourceHash?: string;
  projectSourceHash?: string;
  message?: string;
}

export interface RuntimeStateResponse {
  ok: true;
  activeModules: Array<
    RuntimeModuleStatus & {
      manifest: VisualizerManifestMessage | null;
    }
  >;
  moduleRuns: Record<string, RuntimeStateModuleRun>;
  latestPreparedByModule: Record<string, {
    generatedRunId: string;
    sourceHash?: string;
    manifest: VisualizerManifestMessage;
  }>;
}
