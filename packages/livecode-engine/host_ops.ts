// One implementation of the execution-plane op surface, executed either
// in-process (the Deno server's local mode) or inside the browser engine host
// against an uplink request. Everything here is portable: stores, registry,
// and the engine object — no filesystem, no transport.

import type {
  EngineEntityActionResult,
  EngineEntityCapture,
  EngineEntityLoadEntry,
  EngineEntityLoadResult,
  EngineEntitySaveState,
  EngineOp,
  RuntimeModuleStatus,
  SyncEntity,
} from "@avtools/livecode-protocol";
import type { LivecodeEngine } from "./engine.ts";
import {
  getDurableEntityType,
  listDurableEntityTypes,
} from "./entity_registry.ts";
import {
  makePianoRollSnapshot,
  redoPianoRoll,
  setPianoRoll,
  undoPianoRoll,
} from "./piano_roll_store.ts";
import { makeParamsSnapshot, setParamsValues } from "./params_store.ts";
import { makeSignalsSnapshot } from "./signals_store.ts";
import { setAnimationTimeline } from "./animation_timeline_store.ts";
import { setDrawing } from "./drawing_store.ts";

function resolveEntityRequest(
  typeId: unknown,
  name: unknown,
):
  | {
    descriptor: ReturnType<typeof listDurableEntityTypes>[number];
    name: string;
  }
  | { error: string; status: number } {
  const requestedType = typeof typeId === "string" ? typeId.trim() : "";
  const requestedName = typeof name === "string" ? name.trim() : "";
  if (!requestedType) {
    return { error: "Entity type is required", status: 400 };
  }
  if (!requestedName) {
    return { error: "Entity name is required", status: 400 };
  }
  const descriptor = getDurableEntityType(requestedType);
  if (!descriptor) {
    return { error: `Unknown entity type "${requestedType}"`, status: 404 };
  }
  return { descriptor, name: requestedName };
}

function captureEntities(): EngineEntityCapture[] {
  const rows: EngineEntityCapture[] = [];
  for (const descriptor of listDurableEntityTypes()) {
    for (const name of descriptor.listNames()) {
      try {
        const payload = descriptor.serialize(name) ?? null;
        rows.push({
          type: descriptor.typeId,
          name,
          payload,
          latestJson: descriptor.latestJson(name),
        });
      } catch (error) {
        rows.push({
          type: descriptor.typeId,
          name,
          payload: null,
          latestJson: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return rows;
}

function entitySaveState(): EngineEntitySaveState[] {
  const rows: EngineEntitySaveState[] = [];
  for (const descriptor of listDurableEntityTypes()) {
    for (const name of descriptor.listNames()) {
      try {
        rows.push({
          type: descriptor.typeId,
          name,
          latestJson: descriptor.latestJson(name),
          wouldSave: descriptor.serialize(name) !== null,
        });
      } catch (error) {
        rows.push({
          type: descriptor.typeId,
          name,
          latestJson: null,
          wouldSave: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return rows;
}

function loadEntities(
  entries: EngineEntityLoadEntry[],
): EngineEntityLoadResult[] {
  return entries.map((entry) => {
    try {
      const resolved = resolveEntityRequest(entry.type, entry.name);
      if ("error" in resolved) throw new Error(resolved.error);
      resolved.descriptor.deserialize(resolved.name, entry.data);
      return {
        type: entry.type,
        name: entry.name,
        ok: true,
        latestJson: resolved.descriptor.latestJson(resolved.name),
      };
    } catch (error) {
      return {
        type: entry.type,
        name: entry.name,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

/**
 * Execute one execution-plane op against this isolate's engine and stores.
 * Ops that carry HTTP-shaped failure semantics return a structured result
 * (`EngineEntityActionResult`); everything else throws on genuine failure —
 * the caller maps a throw to its transport's error shape (HTTP 409/500, or an
 * `engineResult` with `ok: false`).
 */
export async function executeEngineOp(
  engine: LivecodeEngine,
  op: EngineOp,
): Promise<unknown> {
  switch (op.kind) {
    case "launch":
      return await engine.launchModule(op.request, op.prepared ?? undefined);
    case "stop":
      await engine.stopModule(op.moduleId, op.reason);
      return { ok: true };
    case "stopAll":
      await engine.stopAllModules(op.reason);
      return { ok: true };
    case "panic":
      await engine.panicRuntime(op.reason);
      return { ok: true };
    case "activeModuleIds":
      return engine.activeModuleIds();
    case "runtimeStatus": {
      const rows: RuntimeModuleStatus[] = engine.activeModulesSnapshot().map(
        (active) => ({
          moduleId: active.moduleId,
          generatedRunId: active.generatedRunId,
          transformedModuleUri: active.transformedModuleUri,
          projectModulePath: active.projectModulePath,
          sourceHash: active.sourceHash,
          projectSourceHash: active.projectSourceHash,
        }),
      );
      return rows;
    }
    case "runtimeState":
      return {
        activeModules: engine.activeModulesSnapshot().map((active) => ({
          moduleId: active.moduleId,
          generatedRunId: active.generatedRunId,
          transformedModuleUri: active.transformedModuleUri,
          projectModulePath: active.projectModulePath,
          sourceHash: active.sourceHash,
          projectSourceHash: active.projectSourceHash,
          manifest: active.manifest,
        })),
        moduleRuns: engine.moduleRunRecords(),
      };
    case "pianoRollList":
      return makePianoRollSnapshot();
    case "pianoRollSet":
      return setPianoRoll(op.request.name, op.request.data, {
        label: op.request.label,
        source: op.request.source ?? "client",
        originId: op.request.originId,
        undoable: op.request.undoable,
        expectedRev: op.request.expectedRev,
      });
    case "pianoRollHistory": {
      const apply = op.action === "undo" ? undoPianoRoll : redoPianoRoll;
      return apply(op.request.name, { originId: op.request.originId }) ?? null;
    }
    case "paramsList":
      return makeParamsSnapshot();
    case "paramsSet":
      return setParamsValues(op.request.name, op.request.values, {
        originId: op.request.originId,
        expectedRev: op.request.expectedRev,
      }) ?? null;
    case "animationTimelineSet":
      return setAnimationTimeline(op.request.name, op.request.data, {
        originId: op.request.originId,
        expectedRev: op.request.expectedRev,
      });
    case "drawingSet":
      return setDrawing(op.request.name, op.request.data, {
        originId: op.request.originId,
        expectedRev: op.request.expectedRev,
      });
    case "signalsList":
      return makeSignalsSnapshot();
    case "entityCreate": {
      const resolved = resolveEntityRequest(op.request.type, op.request.name);
      if ("error" in resolved) {
        return { ok: false, ...resolved } satisfies EngineEntityActionResult;
      }
      const { descriptor, name } = resolved;
      if (descriptor.exists(name)) {
        return {
          ok: false,
          error: `${descriptor.typeId} entity "${name}" already exists`,
          status: 409,
        } satisfies EngineEntityActionResult;
      }
      descriptor.create(name);
      return {
        ok: true,
        entity: { type: descriptor.typeId, name },
      } satisfies EngineEntityActionResult;
    }
    case "entityDuplicate": {
      const resolved = resolveEntityRequest(op.request.type, op.request.name);
      if ("error" in resolved) {
        return { ok: false, ...resolved } satisfies EngineEntityActionResult;
      }
      const { descriptor, name } = resolved;
      const targetName = typeof op.request.targetName === "string"
        ? op.request.targetName.trim()
        : "";
      if (!targetName) {
        return {
          ok: false,
          error: "Entity targetName is required",
          status: 400,
        } satisfies EngineEntityActionResult;
      }
      if (!descriptor.exists(name)) {
        return {
          ok: false,
          error: `No ${descriptor.typeId} entity "${name}"`,
          status: 404,
        } satisfies EngineEntityActionResult;
      }
      if (descriptor.exists(targetName)) {
        return {
          ok: false,
          error: `${descriptor.typeId} entity "${targetName}" already exists`,
          status: 409,
        } satisfies EngineEntityActionResult;
      }
      try {
        descriptor.duplicate(name, targetName);
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          status: 422,
        } satisfies EngineEntityActionResult;
      }
      return {
        ok: true,
        entity: { type: descriptor.typeId, name: targetName },
      } satisfies EngineEntityActionResult;
    }
    case "entityDelete": {
      const resolved = resolveEntityRequest(op.request.type, op.request.name);
      if ("error" in resolved) {
        return { ok: false, ...resolved } satisfies EngineEntityActionResult;
      }
      const { descriptor, name } = resolved;
      if (!descriptor.remove(name)) {
        return {
          ok: false,
          error: `No ${descriptor.typeId} entity "${name}"`,
          status: 404,
        } satisfies EngineEntityActionResult;
      }
      return {
        ok: true,
        entity: { type: descriptor.typeId, name },
      } satisfies EngineEntityActionResult;
    }
    case "captureEntities":
      return captureEntities();
    case "entitySaveState":
      return entitySaveState();
    case "loadEntities":
      return loadEntities(op.entries);
    case "snapshotAll": {
      const resets: Record<string, SyncEntity[]> = {};
      for (const entityType of op.entityTypes) {
        resets[entityType] = engine.syncSources.snapshotAll(
          entityType,
        ) as SyncEntity[];
      }
      return resets;
    }
  }
}
