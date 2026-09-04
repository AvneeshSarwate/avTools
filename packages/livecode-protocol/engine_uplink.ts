// The engine uplink: the wire contract between a coordination server and a
// remote (browser-tab) execution plane, per
// docs/livecode/history/browser-engine-plan-2026-08.md.
//
// The op set is exactly the `ExecutionPlane` surface the server's routes call.
// In local mode the server executes ops in-process; in remote mode it forwards
// them over the `/engine/uplink` WebSocket and the browser host executes them
// with `executeEngineOp` from `@avtools/livecode-engine` — one implementation,
// two transports.

import type { LaunchModuleRequest } from "./runtime.ts";
import type { SetPianoRollRequest } from "./piano_roll.ts";
import type { SetParamsRequest } from "./params.ts";
import type { SetAnimationTimelineRequest } from "./animation_timeline.ts";
import type { SetDrawingRequest } from "./drawing.ts";
import type {
  EntityCreateRequest,
  EntityDeleteRequest,
  EntityDuplicateRequest,
} from "./entities.ts";
import type { VisualizerManifestMessage } from "./analysis.ts";
import type { LivecodeProjectManifest } from "./project.ts";
import type { SyncEntity, SyncEntityChange } from "./sync.ts";

/** Build metadata the server's prepared-run bookkeeping adds to a launch. */
export interface EnginePreparedLaunch {
  projectModulePath?: string;
  sourceHash?: string;
  projectSourceHash?: string;
  manifest?: VisualizerManifestMessage | null;
}

export interface EngineEntityLoadEntry {
  type: string;
  name: string;
  data: unknown;
}

/**
 * One module of a baked artifact: the prebuilt entry the engine tab launches,
 * plus the canonical source the UI renders read-only.
 */
export interface BakedProjectModule {
  moduleId: string;
  /** Relative to baked.json's own location. */
  entry: string;
  generatedRunId: string;
  title?: string;
  sourceText: string;
}

/**
 * `engine/baked.json` — everything a bake's static output needs at boot: the
 * durable-entity seeds and launch list for the engine tab, and the project
 * manifest (layout, canvas views) plus module sources for the project-shaped
 * read-only UI.
 */
export interface BakedProjectFile {
  name: string;
  manifest: LivecodeProjectManifest;
  modules: BakedProjectModule[];
  data: EngineEntityLoadEntry[];
}

export type EngineOp =
  | {
    kind: "launch";
    request: LaunchModuleRequest;
    prepared?: EnginePreparedLaunch;
  }
  | { kind: "stop"; moduleId: string; reason: string }
  | { kind: "stopAll"; reason: string }
  | { kind: "panic"; reason: string }
  | { kind: "activeModuleIds" }
  | { kind: "runtimeStatus" }
  | { kind: "runtimeState" }
  | { kind: "pianoRollList" }
  | { kind: "pianoRollSet"; request: SetPianoRollRequest }
  | {
    kind: "pianoRollHistory";
    action: "undo" | "redo";
    request: { name: string; originId?: string };
  }
  | { kind: "paramsList" }
  | { kind: "paramsSet"; request: SetParamsRequest }
  | { kind: "animationTimelineSet"; request: SetAnimationTimelineRequest }
  | { kind: "drawingSet"; request: SetDrawingRequest }
  | { kind: "signalsList" }
  | { kind: "entityCreate"; request: EntityCreateRequest }
  | { kind: "entityDuplicate"; request: EntityDuplicateRequest }
  | { kind: "entityDelete"; request: EntityDeleteRequest }
  | { kind: "captureEntities" }
  | { kind: "entitySaveState" }
  | { kind: "loadEntities"; entries: EngineEntityLoadEntry[] }
  | { kind: "snapshotAll"; entityTypes: string[] };

/** One row of a point-in-time durable-entity capture (a project save). */
export interface EngineEntityCapture {
  type: string;
  name: string;
  /** JSON-ready payload; null means the registry chose to skip this entity. */
  payload: unknown | null;
  /** The store's compact canonical JSON, for saved-state bookkeeping. */
  latestJson: string | null;
  /** Set when serialization threw; the save reports it as skipped. */
  error?: string;
}

/** One row of the warning-tier unsaved computation (`/project/status`). */
export interface EngineEntitySaveState {
  type: string;
  name: string;
  latestJson: string | null;
  /** Whether a save would write this entity at all. */
  wouldSave: boolean;
  error?: string;
}

interface EngineEntityLoadIdentity {
  type: string;
  name: string;
}

export type EngineEntityLoadResult =
  & EngineEntityLoadIdentity
  & (
    | { ok: true; latestJson: string | null }
    | { ok: false; error: string }
  );

export type EngineEntityActionResult =
  | { ok: true; entity: { type: string; name: string } }
  | {
    ok: false;
    error: string;
    /** HTTP status the server should answer with for this failure. */
    status?: number;
  };

/** Server -> engine host. */
export interface EngineUplinkRequest {
  type: "engineRequest";
  requestId: string;
  op: EngineOp;
}

export type EngineUplinkServerMessage = EngineUplinkRequest;

/** Engine host -> server. */
export type EngineUplinkClientMessage =
  | {
    type: "engineHello";
    engineKind: "browser" | "deno";
    /** Full current state per entity type, seeding the server's mirror. */
    resets: Record<string, SyncEntity[]>;
  }
  | {
    /** One broadcast tick's changed entities, relayed to `/sync` watchers. */
    type: "engineSync";
    changes: SyncEntityChange[];
  }
  | {
    type: "engineResult";
    requestId: string;
  } & ({ ok: true; body: unknown } | { ok: false; error: string })
  | {
    /**
     * One structured engine log entry, forwarded so the server's log stays
     * the one place lifecycle truth is greppable — for humans, the agent,
     * and the E2E's log assertions — regardless of where execution happens.
     */
    type: "engineLog";
    entry: Record<string, unknown>;
  };
