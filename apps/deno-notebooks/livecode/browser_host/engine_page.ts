/// <reference lib="dom" />
// Browser engine host page (phase-2 vertical slice of
// docs/livecode/history/browser-engine-plan-2026-08.md).
//
// This module is bundled for the browser (`deno bundle --platform browser`,
// see build_slice.ts) and served next to two tiny re-export stubs:
//
//   runtime.js         -> re-exports the instrumentation helpers from this
//                         bundle, so generated code's `./runtime.js` import
//                         shares the engine's runtime singletons;
//   canvas_signals.js  -> re-exports `signal` for the page import map, so a
//                         module's bare `canvas-signals` import resolves.
//
// The sync host here is deliberately minimal: one BroadcastChannel carrying
// the real `SyncMessage` envelope, broadcast to every listening tab, with a
// `subscribe` message answered by full `resets`. Per-tab subscription scoping
// and seq-per-subscriber arrive with the real transport work; the envelope on
// the wire is already the one from `@avtools/livecode-protocol`.

import {
  createLivecodeEngine,
  type LivecodeEngine,
} from "@avtools/livecode-engine";
import type {
  SyncEntity,
  SyncEntityChange,
  SyncMessage,
  SyncSubscribeMessage,
} from "@avtools/livecode-protocol";

// Re-exported for runtime.js: generated code imports these three by alias.
export {
  visualizedAwait,
  visualizedOwnedSignal,
  visualizedPianoRollLookup,
} from "@avtools/livecode-engine";
// Re-exported for canvas_signals.js (the `canvas-signals` import-map target).
export { signal } from "canvas-signals";
// Re-exported for canvas_params.js (the `canvas-params` import-map target).
export { canvasParams } from "canvas-params";

const SYNC_CHANNEL_NAME = "livecode-sync";
const ENTITY_TYPES = [
  "pianoRoll",
  "params",
  "signal",
  "run",
  "moduleWaits",
  "moduleLookups",
];

const channel = new BroadcastChannel(SYNC_CHANNEL_NAME);
let seq = 0;

function send(body: {
  resets?: Record<string, SyncEntity[]>;
  changes?: SyncEntityChange[];
}): void {
  const message: SyncMessage = {
    type: "sync",
    seq: ++seq,
    timestampMs: Date.now(),
    ...body,
  };
  channel.postMessage(message);
}

const engine: LivecodeEngine = createLivecodeEngine({
  log: (entry) => {
    console.log("[livecode-engine]", JSON.stringify(entry));
  },
  onSyncTick: (collected) => {
    if (collected.size === 0) return;
    const changes: SyncEntityChange[] = [];
    for (const [entityType, entries] of collected) {
      for (const entry of entries) {
        changes.push({
          entityType,
          name: entry.name,
          entity: entry.entity as SyncEntity | null,
        });
      }
    }
    if (changes.length > 0) send({ changes });
  },
});

channel.onmessage = (event) => {
  const message = event.data as SyncSubscribeMessage | undefined;
  if (message?.type !== "subscribe") return;
  const entityTypes = Array.isArray(message.entityTypes)
    ? message.entityTypes.filter((entityType): entityType is string =>
      typeof entityType === "string"
    )
    : ENTITY_TYPES;
  const resets: Record<string, SyncEntity[]> = {};
  for (const entityType of entityTypes) {
    resets[entityType] = engine.syncSources.snapshotAll(
      entityType,
    ) as SyncEntity[];
  }
  send({ resets });
};

// The page-level harness the slice E2E (and later the real UI/uplink) drives.
(globalThis as Record<string, unknown>).__livecodeBrowserEngine = {
  engine,
  launch: (request: {
    moduleId: string;
    transformedModuleUri: string;
    generatedRunId: string;
  }) => engine.launchModule(request),
  stop: (moduleId: string, reason = "stopRequest") =>
    engine.stopModule(moduleId, reason),
  activeModuleIds: () => engine.activeModuleIds(),
};

console.log("[livecode-engine] browser engine host ready");
