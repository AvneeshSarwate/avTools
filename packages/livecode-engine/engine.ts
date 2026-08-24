import { launch, type TimeContext } from "@avtools/core-timing";
import type {
  LaunchModuleRequest,
  LaunchModuleResponse,
  RunEntity,
  RuntimeStateModuleRun,
  VisualizerManifestMessage,
} from "@avtools/livecode-protocol";
import {
  createModuleLookupsSyncSource,
  createModuleWaitsSyncSource,
  createRunSyncSource,
  type SyncCollectedChanges,
  SyncSourceRegistry,
} from "./sync_sources.ts";
import { clearModuleWaits, setRootTimeContext } from "./runtime.ts";
import { endSignalsForModule } from "./signals_store.ts";
import { seedDemoPianoRoll } from "./piano_roll_store.ts";
import { registerBuiltinEntityKinds } from "./entity_kinds.ts";

// The execution plane extracted from the Deno visualizer server: the parent
// TimeContext loop, the launch queue with its pending-launch safety window,
// active-module lifecycle and run records, the sync-source registry, and the
// one broadcast tick. Everything host-specific — HTTP/WS transports, files,
// analysis, LSP, MIDI backends — is injected or lives in the host. The race
// discipline (runToken identity, pending-launch cancellation, slot-scoped
// teardown) is ported verbatim from the server and stays covered by
// `livecode/tests/launch_race_test.ts` through the Deno host.

interface BranchHandle {
  cancel: () => void;
  finally: (f: () => void) => Promise<unknown>;
}

type ModuleStopFunc = () => void | Promise<void>;

interface ActiveModule {
  moduleId: string;
  generatedRunId: string;
  // Identity of this run, not of its build. `generatedRunId` is reused whenever
  // a relaunch finds an unchanged prepared build, so it cannot tell an old run
  // from the one that replaced it; this token can.
  runToken: string;
  transformedModuleUri: string;
  handle: BranchHandle;
  stopFunc?: ModuleStopFunc;
  projectModulePath?: string;
  sourceHash?: string;
  projectSourceHash?: string;
  manifest: VisualizerManifestMessage | null;
}

// An accepted launch is queued, not started. This is the identity of that
// window: it makes a not-yet-started run addressable by stop, panic, and a
// replacing launch, none of which can find it in `activeModules` yet.
interface PendingLaunch {
  generatedRunId: string;
  // Minted at ACCEPT time rather than after the import, so the `launching`
  // entry this request publishes already carries the run's identity and a
  // cancellation can tell whether that entry is still the one it owns.
  runToken: string;
  cancelled: boolean;
}

export type ModuleRunRecord = RuntimeStateModuleRun;

/** The active-module fields hosts may read; the branch handle stays private. */
export interface EngineActiveModuleInfo {
  moduleId: string;
  generatedRunId: string;
  runToken: string;
  transformedModuleUri: string;
  projectModulePath?: string;
  sourceHash?: string;
  projectSourceHash?: string;
  manifest: VisualizerManifestMessage | null;
}

/** Build metadata the host's prepared-run bookkeeping contributes to a launch. */
export interface PreparedLaunchMetadata {
  projectModulePath?: string;
  sourceHash?: string;
  projectSourceHash?: string;
  manifest?: VisualizerManifestMessage | null;
}

export interface LivecodeEngineDeps {
  log: (entry: Record<string, unknown>) => void | Promise<void>;
  /**
   * Receives every broadcast tick's collected changes (may be empty). The host
   * fans them out to its transports. Runs inside the engine's tick try/catch,
   * so a throwing sink is logged rather than killing the timer.
   */
  onSyncTick: (collected: SyncCollectedChanges) => void;
  /** Dynamic import of a generated module. Defaults to the host `import()`. */
  importModule?: (url: string) => Promise<unknown>;
  /** MIDI panic capability; a host without MIDI omits it. */
  panicMidi?: () => void;
  /** Seed the demo piano roll at construction (default true). */
  seedDemoRoll?: boolean;
  syncTickMs?: number;
  stopHookTimeoutMs?: number;
}

export interface LivecodeEngine {
  readonly syncSources: SyncSourceRegistry;
  /**
   * Accept and queue a launch. Throws for the synchronous refusals the HTTP
   * layer maps to 409 (already running / already launching without
   * `replaceRunning`). Resolution means queued, not started.
   */
  launchModule(
    request: LaunchModuleRequest,
    prepared?: PreparedLaunchMetadata,
  ): Promise<LaunchModuleResponse>;
  stopModule(moduleId: string, reason: string): Promise<void>;
  stopAllModules(reason: string): Promise<void>;
  panicRuntime(reason: string): Promise<void>;
  activeModuleIds(): string[];
  activeModulesSnapshot(): EngineActiveModuleInfo[];
  getActiveModuleInfo(moduleId: string): EngineActiveModuleInfo | undefined;
  isGeneratedRunActive(generatedRunId: string): boolean;
  moduleRunRecords(): Record<string, ModuleRunRecord>;
  close(): Promise<void>;
}

const DEFAULT_SYNC_TICK_MS = 33;
const DEFAULT_STOP_HOOK_TIMEOUT_MS = 2_000;

export function createLivecodeEngine(deps: LivecodeEngineDeps): LivecodeEngine {
  const log = deps.log;
  const importModule = deps.importModule ?? ((url: string) => import(url));
  const stopHookTimeoutMs = deps.stopHookTimeoutMs ??
    DEFAULT_STOP_HOOK_TIMEOUT_MS;

  const activeModules = new Map<string, ActiveModule>();
  const pendingLaunches = new Map<string, PendingLaunch>();
  const moduleRunSnapshots = new Map<string, ModuleRunRecord>();
  // Module ids whose run entry changed since the last collect.
  const dirtyRunModules = new Set<string>();
  const launchQueue: Array<(ctx: TimeContext) => Promise<void> | void> = [];
  let parentContext: TimeContext | null = null;
  let closing = false;

  // Construction, not a read path: `snapshotAll()` has to be genuinely
  // read-only, so nothing may seed a roll on the way to answering a subscribe.
  if (deps.seedDemoRoll ?? true) seedDemoPianoRoll();

  const parentHandle = launch(async (ctx) => {
    parentContext = ctx;
    // The parent loop is the process's root clock. Observation code (the
    // signals sampler today) stamps samples with its logical time.
    setRootTimeContext(ctx);
    await log({ type: "parentLoopStarted" });
    while (!closing) {
      const queued = launchQueue.splice(0);
      for (const action of queued) {
        await action(ctx);
      }
      try {
        await ctx.waitSec(0.03);
      } catch (error) {
        if (closing || isAbortError(error)) break;
        throw error;
      }
    }
  }, { bpm: 60, debugName: "livecode-visualizer-parent" });
  parentHandle.catch(() => {
    // Expected when the engine shuts down.
  });

  const syncSources = new SyncSourceRegistry();
  registerBuiltinEntityKinds(syncSources);
  syncSources.register(createModuleWaitsSyncSource());
  syncSources.register(createModuleLookupsSyncSource());
  syncSources.register(createRunSyncSource({
    listModuleIds: () => [...moduleRunSnapshots.keys()],
    read: (moduleId) => runEntityFor(moduleId),
    consumeDirty: () => {
      if (dirtyRunModules.size === 0) return [];
      const drained = [...dirtyRunModules];
      dirtyRunModules.clear();
      return drained;
    },
  }));

  // `collectAll` drains change gates and therefore has one caller.
  const broadcastTimer = setInterval(() => {
    try {
      deps.onSyncTick(syncSources.collectAll());
    } catch (error) {
      void log({
        type: "broadcastTickError",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, deps.syncTickMs ?? DEFAULT_SYNC_TICK_MS);

  /** One module's run as a sync entity. Null when it has never had a run. */
  function runEntityFor(moduleId: string): RunEntity | null {
    const record = moduleRunSnapshots.get(moduleId);
    if (!record) return null;
    const entity: RunEntity = {
      moduleId: record.moduleId,
      state: record.state,
      generatedRunId: record.generatedRunId,
      runToken: record.runToken,
      updatedAt: record.updatedAtMs,
    };
    if (record.projectModulePath !== undefined) {
      entity.projectModulePath = record.projectModulePath;
    }
    if (record.sourceHash !== undefined) entity.sourceHash = record.sourceHash;
    if (record.projectSourceHash !== undefined) {
      entity.projectSourceHash = record.projectSourceHash;
    }
    if (record.message !== undefined) entity.message = record.message;
    return entity;
  }

  function setModuleRunSnapshot(
    entry: Omit<ModuleRunRecord, "updatedAtMs">,
  ): ModuleRunRecord {
    const stored: ModuleRunRecord = {
      ...entry,
      updatedAtMs: Date.now(),
    };
    moduleRunSnapshots.set(entry.moduleId, stored);
    dirtyRunModules.add(entry.moduleId);
    // Returned so a writer can later ask whether its entry is still the latest.
    return stored;
  }

  async function launchModule(
    requestBody: LaunchModuleRequest,
    prepared?: PreparedLaunchMetadata,
  ): Promise<LaunchModuleResponse> {
    await log({
      type: "launchQueued",
      moduleId: requestBody.moduleId,
      generatedRunId: requestBody.generatedRunId,
    });

    // A launch already accepted but not yet started is refused exactly like a
    // running one, so two rapid requests cannot both pass the safety check.
    // `replaceRunning` supersedes the queued run instead: its action still runs,
    // sees `cancelled`, and returns before it can import anything. A cancelled
    // entry counts as absent: its action is already doomed, and refusing
    // because of it would 409 the relaunch that follows a Stop.
    const supersededLaunch = pendingLaunches.get(requestBody.moduleId);
    if (supersededLaunch && !supersededLaunch.cancelled) {
      if (!requestBody.replaceRunning) {
        throw new Error(
          `Module ${requestBody.moduleId} is already launching; stop it first or pass replaceRunning: true.`,
        );
      }
      supersededLaunch.cancelled = true;
    }

    if (activeModules.has(requestBody.moduleId)) {
      if (!requestBody.replaceRunning) {
        throw new Error(
          `Module ${requestBody.moduleId} is already running; stop it first or pass replaceRunning: true.`,
        );
      }
      // Request-time stop, so an explicit replacement silences the old run at
      // the moment the user asked for it. The queued action stops again if a
      // run appears in the meantime; a second stop is idempotent.
      await stopModule(requestBody.moduleId, "replaceBeforeLaunch");
    }

    // The stop above suspends past the point where it empties `activeModules`
    // — its teardown still awaits a log write — so another request can pass
    // both checks in that window and register its own pending entry. The `set`
    // below would then replace an uncancelled entry, orphaning an action that
    // stop-all and panic can no longer see and that would still run user code.
    // Anything holding the slot at this point is superseded by this request,
    // which is the one the caller is waiting on.
    const racedLaunch = pendingLaunches.get(requestBody.moduleId);
    if (racedLaunch) racedLaunch.cancelled = true;

    // This run's own identity, minted HERE rather than after the import so the
    // `launching` entry already carries it. `generatedRunId` cannot stand in:
    // a relaunch reuses it whenever the prepared build is unchanged — Replace
    // without an edit does exactly that — so it cannot distinguish this run
    // from the one it replaced.
    const runToken = crypto.randomUUID();
    const pendingLaunch: PendingLaunch = {
      generatedRunId: requestBody.generatedRunId,
      runToken,
      cancelled: false,
    };
    pendingLaunches.set(requestBody.moduleId, pendingLaunch);

    const runSnapshotBase = {
      moduleId: requestBody.moduleId,
      generatedRunId: requestBody.generatedRunId,
      runToken,
      projectModulePath: prepared?.projectModulePath ??
        requestBody.projectModulePath,
      sourceHash: prepared?.sourceHash ?? requestBody.sourceHash,
      projectSourceHash: prepared?.projectSourceHash ??
        requestBody.projectSourceHash,
    };
    setModuleRunSnapshot({
      ...runSnapshotBase,
      state: "launching",
    });

    launchQueue.push(async (ctx) => {
      try {
        // Acceptance means queued, so every safety decision taken between the
        // request and this turn is re-applied here rather than trusted from
        // request time.
        if (pendingLaunch.cancelled) {
          publishCancelledLaunch(
            requestBody.moduleId,
            pendingLaunch,
            "launchCancelled",
          );
          await log({
            type: "launchCancelled",
            moduleId: requestBody.moduleId,
            generatedRunId: requestBody.generatedRunId,
            reason: "cancelledBeforeStart",
          });
          return;
        }

        if (activeModules.has(requestBody.moduleId)) {
          if (!requestBody.replaceRunning) {
            // A run appeared between acceptance and execution and this launch
            // never asked to replace it. It loses silently: any lifecycle
            // snapshot written here would clobber `moduleRuns` for the run that
            // is genuinely active, and that run's own snapshots keep clients
            // converged.
            await log({
              type: "launchAborted",
              moduleId: requestBody.moduleId,
              generatedRunId: requestBody.generatedRunId,
              reason: "moduleAlreadyRunning",
            });
            return;
          }
          await stopModule(requestBody.moduleId, "replaceBeforeLaunch");
        }

        const moduleUrl = appendImportQuery(
          requestBody.transformedModuleUri,
          "launch",
          crypto.randomUUID(),
        );
        const importStartedAt = performance.now();
        const mod = await importModule(moduleUrl) as {
          runFunc?: (ctx: TimeContext) => Promise<void>;
          default?: (ctx: TimeContext) => Promise<void>;
          stop?: ModuleStopFunc;
        };
        await log({
          type: "moduleImported",
          moduleId: requestBody.moduleId,
          generatedRunId: requestBody.generatedRunId,
          durationMs: elapsedMs(importStartedAt),
        });

        // The import is the one long await inside this action, so a stop can
        // land while it is pending. Checked once more before any user code runs.
        if (pendingLaunch.cancelled) {
          publishCancelledLaunch(
            requestBody.moduleId,
            pendingLaunch,
            "launchCancelled",
          );
          await log({
            type: "launchCancelled",
            moduleId: requestBody.moduleId,
            generatedRunId: requestBody.generatedRunId,
            reason: "cancelledDuringImport",
          });
          return;
        }

        const runFunc = mod.runFunc ?? mod.default;
        if (!runFunc) {
          throw new Error(
            `Generated module ${moduleUrl} does not export runFunc/default`,
          );
        }

        const handle = ctx.branch(async (branchCtx) => {
          setModuleRunSnapshot({ ...runSnapshotBase, state: "running" });
          await log({
            type: "moduleStarted",
            moduleId: requestBody.moduleId,
            generatedRunId: requestBody.generatedRunId,
          });
          let reason = "completed";
          let errorMessage: string | undefined;
          try {
            await runFunc(branchCtx);
          } catch (error) {
            reason = isAbortError(error) ? "cancelled" : "error";
            if (reason === "error") {
              errorMessage = error instanceof Error
                ? error.message
                : String(error);
              await log({
                type: "moduleError",
                moduleId: requestBody.moduleId,
                generatedRunId: requestBody.generatedRunId,
                message: errorMessage,
              });
            }
          } finally {
            clearModuleWaits(requestBody.moduleId);
            const active = activeModules.get(requestBody.moduleId);
            if (active?.runToken === runToken) {
              activeModules.delete(requestBody.moduleId);
              // Guarded, unlike clearModuleWaits: `ended` sticks, so a slow-dying
              // previous branch must not end the signals a replacement run has
              // already redeclared.
              endSignalsForModule(requestBody.moduleId);
              setModuleRunSnapshot({
                ...runSnapshotBase,
                state: reason === "error" ? "error" : "stopped",
                ...(errorMessage ? { message: errorMessage } : {}),
              });
              await log({
                type: "moduleStopped",
                moduleId: requestBody.moduleId,
                generatedRunId: requestBody.generatedRunId,
                reason,
              });
            }
          }
        }, requestBody.moduleId);

        activeModules.set(requestBody.moduleId, {
          moduleId: requestBody.moduleId,
          generatedRunId: requestBody.generatedRunId,
          runToken,
          transformedModuleUri: requestBody.transformedModuleUri,
          projectModulePath: runSnapshotBase.projectModulePath,
          sourceHash: runSnapshotBase.sourceHash,
          projectSourceHash: runSnapshotBase.projectSourceHash,
          manifest: prepared?.manifest ?? requestBody.manifest ?? null,
          handle,
          stopFunc: typeof mod.stop === "function" ? mod.stop : undefined,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setModuleRunSnapshot({
          ...runSnapshotBase,
          state: "error",
          message,
        });
        await log({
          type: "moduleError",
          moduleId: requestBody.moduleId,
          generatedRunId: requestBody.generatedRunId,
          message,
        });
      } finally {
        // Ownership has already transferred to `activeModules` on the success
        // path, so the module is never absent from both maps while startable.
        // The identity check matters because a superseding request can have
        // registered its own pending entry under this module ID by now.
        if (pendingLaunches.get(requestBody.moduleId) === pendingLaunch) {
          pendingLaunches.delete(requestBody.moduleId);
        }
      }
    });

    if (!parentContext) await log({ type: "launchQueuedBeforeParentReady" });
    return { ok: true, runToken };
  }

  // The terminal snapshot an accepted-then-cancelled launch owes its client —
  // but only while the `launching` entry it published is still the latest one.
  // If anything has written since (a successor's `launching`, or the stop that
  // cancelled this launch), that writer owns the run entry and this write would
  // clobber it.
  //
  // Both halves of the test are load-bearing. The token rules out a successor's
  // entry, which `generatedRunId` could not: a relaunch of an unchanged build
  // reuses the ID. The state check rules out this launch's OWN terminal — a
  // stop cancels the pending launch and publishes `stopped` under the same
  // token, and the queued action then arrives and must not reopen it.
  function publishCancelledLaunch(
    moduleId: string,
    pending: PendingLaunch,
    message: string,
  ): void {
    const current = moduleRunSnapshots.get(moduleId);
    if (!current) return;
    if (current.runToken !== pending.runToken) return;
    if (current.state !== "launching") return;
    setModuleRunSnapshot({
      ...current,
      state: "stopped",
      message,
    });
  }

  // A queued launch has no branch to cancel and no active entry to tear down,
  // so cancelling it is an intent flag plus that terminal snapshot.
  async function cancelPendingLaunch(
    moduleId: string,
    pending: PendingLaunch,
    reason: string,
  ): Promise<void> {
    pending.cancelled = true;
    publishCancelledLaunch(moduleId, pending, reason);
    await log({
      type: "launchCancelled",
      moduleId,
      generatedRunId: pending.generatedRunId,
      reason,
    });
  }

  async function cancelPendingLaunches(reason: string): Promise<void> {
    for (const [moduleId, pending] of [...pendingLaunches]) {
      if (pending.cancelled) continue;
      await cancelPendingLaunch(moduleId, pending, reason);
    }
  }

  async function stopModule(moduleId: string, reason: string) {
    const active = activeModules.get(moduleId);
    if (!active) {
      clearModuleWaits(moduleId);
      const pending = pendingLaunches.get(moduleId);
      if (pending && !pending.cancelled) {
        await cancelPendingLaunch(moduleId, pending, reason);
        return;
      }
      const previous = moduleRunSnapshots.get(moduleId);
      if (previous?.state === "launching" || previous?.state === "running") {
        setModuleRunSnapshot({
          ...previous,
          state: "stopped",
          message: reason,
        });
      }
      return;
    }
    await runModuleStopFunc(active, reason);
    await teardownActiveModule(active, reason);
  }

  // Shared per-module teardown tail used by both graceful stop and panic. The
  // only difference between the two paths is that panic skips runModuleStopFunc
  // and passes its own reason/log type; the snapshot payload is identical.
  async function teardownActiveModule(
    active: ActiveModule,
    reason: string,
    opts: { logType?: string } = {},
  ) {
    // Cancelling the branch is unconditional: this handle is the run the caller
    // asked to stop, whatever has happened to the module slot since.
    active.handle.cancel();
    // Everything below is slot-scoped, so it only applies while this record is
    // still the module's active run. `stopModule` can await a `stop()` hook for
    // up to two seconds, and a replacement can win the slot inside that window;
    // deleting by key, ending signals, or writing a terminal snapshot then
    // would retire the run that is currently playing. Object identity, not
    // `generatedRunId`, because a relaunch of an unchanged build reuses the ID.
    if (activeModules.get(active.moduleId) !== active) {
      await log({
        type: "supersededTeardown",
        moduleId: active.moduleId,
        generatedRunId: active.generatedRunId,
        reason,
      });
      return;
    }
    activeModules.delete(active.moduleId);
    clearModuleWaits(active.moduleId);
    // Ephemeral entities end with the run that published them rather than
    // silently freezing, so stop and panic both end this module's signals.
    endSignalsForModule(active.moduleId);
    setModuleRunSnapshot({
      moduleId: active.moduleId,
      generatedRunId: active.generatedRunId,
      runToken: active.runToken,
      state: "stopped",
      projectModulePath: active.projectModulePath,
      sourceHash: active.sourceHash,
      projectSourceHash: active.projectSourceHash,
      message: reason,
    });
    await log({
      type: opts.logType ?? "moduleStopped",
      moduleId: active.moduleId,
      generatedRunId: active.generatedRunId,
      reason,
    });
  }

  async function runModuleStopFunc(active: ActiveModule, reason: string) {
    if (!active.stopFunc) return;
    try {
      await withTimeout(
        Promise.resolve(active.stopFunc()),
        stopHookTimeoutMs,
        `module ${active.moduleId} stop() timed out after ${stopHookTimeoutMs}ms`,
      );
      await log({
        type: "moduleStopHookCompleted",
        moduleId: active.moduleId,
        generatedRunId: active.generatedRunId,
        reason,
      });
    } catch (error) {
      await log({
        type: "moduleStopHookError",
        moduleId: active.moduleId,
        generatedRunId: active.generatedRunId,
        reason,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function stopAllModules(reason: string) {
    await cancelPendingLaunches(reason);
    await Promise.all(
      [...activeModules.keys()].map((moduleId) => stopModule(moduleId, reason)),
    );
  }

  async function panicRuntime(reason: string) {
    // Queued launches first: panic must not let one start after it.
    await cancelPendingLaunches(reason);
    for (const active of [...activeModules.values()]) {
      await teardownActiveModule(active, reason, {
        logType: "modulePanicStopped",
      });
    }
    deps.panicMidi?.();
  }

  function activeInfo(active: ActiveModule): EngineActiveModuleInfo {
    return {
      moduleId: active.moduleId,
      generatedRunId: active.generatedRunId,
      runToken: active.runToken,
      transformedModuleUri: active.transformedModuleUri,
      projectModulePath: active.projectModulePath,
      sourceHash: active.sourceHash,
      projectSourceHash: active.projectSourceHash,
      manifest: active.manifest,
    };
  }

  return {
    syncSources,
    launchModule,
    stopModule,
    stopAllModules,
    panicRuntime,
    activeModuleIds: () => [...activeModules.keys()],
    activeModulesSnapshot: () => [...activeModules.values()].map(activeInfo),
    getActiveModuleInfo: (moduleId) => {
      const active = activeModules.get(moduleId);
      return active ? activeInfo(active) : undefined;
    },
    isGeneratedRunActive: (generatedRunId) =>
      [...activeModules.values()].some((active) =>
        active.generatedRunId === generatedRunId
      ),
    moduleRunRecords: () => Object.fromEntries(moduleRunSnapshots),
    close: async () => {
      closing = true;
      clearInterval(broadcastTimer);
      // The parent loop is about to be cancelled; a cancelled clock must not
      // keep stamping samples with its frozen logical time.
      setRootTimeContext(null);
      await stopAllModules("serverClose");
      deps.panicMidi?.();
      parentHandle.cancel();
    },
  };
}

function appendImportQuery(uri: string, key: string, value: string): string {
  const separator = uri.includes("?") ? "&" : "?";
  return `${uri}${separator}${encodeURIComponent(key)}=${
    encodeURIComponent(value)
  }`;
}

function elapsedMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 1000) / 1000;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error &&
    /aborted|context canceled/i.test(error.message);
}
