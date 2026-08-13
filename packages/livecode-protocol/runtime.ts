/**
 * Runtime wire types: launch/stop bodies, run lifecycle records, the
 * `/runtime/snapshots` envelope, `/health`, and `/runtime/state`.
 */

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

export interface StopModuleRequest {
  moduleId: string;
}

export type RuntimeModuleRunState =
  | "launching"
  | "running"
  | "stopped"
  | "error";

export interface RuntimeModuleRunSnapshotEntry {
  moduleId: string;
  generatedRunId: string;
  state: RuntimeModuleRunState;
  updatedAtMs: number;
  projectModulePath?: string;
  sourceHash?: string;
  projectSourceHash?: string;
  message?: string;
}

export interface ActiveWaitSnapshot {
  type: "activeWaitSnapshot";
  seq: number;
  timestampMs: number;
  modules: Record<string, string[]>;
  /**
   * Runtime-resolved piano-roll lookup names, keyed by moduleId then
   * callsiteId. Populated by instrumented `__tcvPianoRollLookup` wrappers
   * in generated modules. Absent/empty until a module runs.
   */
  pianoRollLookups?: Record<string, Record<string, string>>;
  /** Active module ids according to the server runtime. */
  activeModules?: string[];
  /**
   * Latest run lifecycle state by module id. This lets clients mark a module
   * stopped/error even when it has no active wait callsites at completion.
   */
  moduleRuns?: Record<string, RuntimeModuleRunSnapshotEntry>;
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
  runtimeCapabilities: RuntimeCapabilityStatus;
}

export interface RuntimeModuleStatus {
  moduleId: string;
  generatedRunId: string;
  transformedModuleUri: string;
  projectModulePath?: string;
  sourceHash?: string;
  projectSourceHash?: string;
}

export interface RuntimeStateResponse {
  ok: true;
  activeModules: Array<
    RuntimeModuleStatus & {
      manifest: VisualizerManifestMessage | null;
    }
  >;
  moduleRuns: Record<string, RuntimeModuleRunSnapshotEntry>;
  latestPreparedByModule: Record<string, {
    generatedRunId: string;
    sourceHash?: string;
    manifest: VisualizerManifestMessage;
  }>;
}
