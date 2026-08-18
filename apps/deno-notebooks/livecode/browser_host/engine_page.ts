/// <reference lib="dom" />
// The browser engine host page (docs/livecode/history/browser-engine-plan-2026-08.md).
//
// Bundled by build_host_assets.ts alongside per-alias helper bundles that
// share its module instances via code splitting. The page runs the engine and
// speaks two transports:
//
//  - the local BroadcastChannel sync host, carrying the real `SyncMessage`
//    envelope to same-origin observer tabs (subscribe answered with resets);
//  - the `/engine/uplink` WebSocket to the coordination server that served
//    this page: it announces itself with full resets, ships every tick's
//    changes, and executes forwarded `EngineOp`s with the same
//    `executeEngineOp` the server's local mode uses.
//
// Served statically with no server (the baked setup, the slice E2E) the
// uplink simply keeps retrying in the background and everything local works.

import {
  createLivecodeEngine,
  executeEngineOp,
  type LivecodeEngine,
} from "@avtools/livecode-engine";
import type {
  EngineEntityLoadEntry,
  EngineUplinkClientMessage,
  EngineUplinkServerMessage,
  SyncEntity,
  SyncEntityChange,
  SyncMessage,
  SyncSubscribeMessage,
} from "@avtools/livecode-protocol";

const SYNC_CHANNEL_NAME = "livecode-sync";
const ENTITY_TYPES = [
  "pianoRoll",
  "params",
  "signal",
  "run",
  "moduleWaits",
  "moduleLookups",
];
const UPLINK_RETRY_MS = 2_000;

const channel = new BroadcastChannel(SYNC_CHANNEL_NAME);
let seq = 0;
let uplink: WebSocket | null = null;

function sendLocal(body: {
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

function sendUplink(message: EngineUplinkClientMessage): void {
  if (!uplink || uplink.readyState !== WebSocket.OPEN) return;
  try {
    uplink.send(JSON.stringify(message));
  } catch (error) {
    console.warn("[livecode-engine] uplink send failed", error);
  }
}

function snapshotAllTypes(): Record<string, SyncEntity[]> {
  const resets: Record<string, SyncEntity[]> = {};
  for (const entityType of ENTITY_TYPES) {
    resets[entityType] = engine.syncSources.snapshotAll(
      entityType,
    ) as SyncEntity[];
  }
  return resets;
}

const engine: LivecodeEngine = createLivecodeEngine({
  log: (entry) => {
    console.log("[livecode-engine]", JSON.stringify(entry));
    sendUplink({ type: "engineLog", entry });
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
    if (changes.length === 0) return;
    sendLocal({ changes });
    sendUplink({ type: "engineSync", changes });
  },
});

// Local observer tabs: a subscribe is answered with full resets.
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
  sendLocal({ resets });
};

// The actions channel: same-origin UI tabs post the uplink's
// `engineRequest` envelope here when there is no server to POST to (the
// serverless baked topology, `actions=broadcast`). Always listening is
// harmless in the served topology — nothing posts there.
const actionsChannel = new BroadcastChannel("livecode-actions");
actionsChannel.onmessage = (event) => {
  const message = event.data as EngineUplinkServerMessage | undefined;
  if (message?.type !== "engineRequest") return;
  void (async () => {
    try {
      const body = await executeEngineOp(engine, message.op);
      actionsChannel.postMessage({
        type: "engineResult",
        requestId: message.requestId,
        ok: true,
        body,
      });
    } catch (error) {
      actionsChannel.postMessage({
        type: "engineResult",
        requestId: message.requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();
};

// Baked boot: a static bake places baked.json next to this page — durable
// entity seeds plus the prebuilt module list, auto-launched because a baked
// artifact IS the performance setup. Absent (404) means the dynamic
// topologies, where launches arrive over the uplink or harness instead.
interface BakedManifest {
  modules?: Array<{
    moduleId: string;
    entry: string;
    generatedRunId: string;
    title?: string;
  }>;
  data?: EngineEntityLoadEntry[];
}

void (async () => {
  let baked: BakedManifest;
  try {
    const response = await fetch("./baked.json");
    if (!response.ok) return;
    baked = await response.json() as BakedManifest;
  } catch {
    return;
  }
  try {
    if (baked.data && baked.data.length > 0) {
      await executeEngineOp(engine, {
        kind: "loadEntities",
        entries: baked.data,
      });
    }
    for (const bakedModule of baked.modules ?? []) {
      await engine.launchModule({
        moduleId: bakedModule.moduleId,
        // Resolved against the page URL so a bake hosted under any subpath
        // works; the engine's import() would otherwise resolve relative to
        // whichever bundle chunk it lives in.
        transformedModuleUri: new URL(bakedModule.entry, location.href).href,
        generatedRunId: bakedModule.generatedRunId,
      });
    }
    console.log("[livecode-engine] baked boot complete");
  } catch (error) {
    console.warn("[livecode-engine] baked boot failed", error);
  }
})();

// The server uplink: reconnect forever; a served page without a server (or a
// server restart) just keeps retrying in the background.
function connectUplink(): void {
  const url = new URL("/engine/uplink", location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  let socket: WebSocket;
  try {
    socket = new WebSocket(url.href);
  } catch {
    setTimeout(connectUplink, UPLINK_RETRY_MS);
    return;
  }
  socket.onopen = () => {
    uplink = socket;
    console.log("[livecode-engine] uplink connected");
    sendUplink({
      type: "engineHello",
      engineKind: "browser",
      resets: snapshotAllTypes(),
    });
  };
  socket.onmessage = (event) => {
    if (typeof event.data !== "string") return;
    let message: EngineUplinkServerMessage;
    try {
      message = JSON.parse(event.data) as EngineUplinkServerMessage;
    } catch {
      return;
    }
    if (message?.type !== "engineRequest") return;
    void (async () => {
      try {
        const body = await executeEngineOp(engine, message.op);
        sendUplink({
          type: "engineResult",
          requestId: message.requestId,
          ok: true,
          body,
        });
      } catch (error) {
        sendUplink({
          type: "engineResult",
          requestId: message.requestId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  };
  const retry = () => {
    if (uplink === socket) uplink = null;
    setTimeout(connectUplink, UPLINK_RETRY_MS);
  };
  socket.onclose = retry;
  socket.onerror = () => {
    // onclose follows; avoid double-scheduling.
  };
}
connectUplink();

// The page-level harness the slice E2E (and manual debugging) drives.
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
