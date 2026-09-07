/// <reference lib="dom" />
// Shared by the engine page and the same-tab UI. Build this host and every
// module helper in one code-split asset tree so they share store singletons.

import {
  createLivecodeEngine,
  executeEngineOp,
  type LivecodeEngine,
} from "@avtools/livecode-engine";
import {
  hasMidiAccess,
  initMidi,
  listMidiDevices,
  panicMidi,
} from "midi-helpers";
import type {
  BakedProjectFile,
  BrowserEngineHost,
  BrowserEngineHostOptions,
  BrowserEngineHostStatus,
  BrowserEngineLockState,
  EngineOp,
  EngineUplinkClientMessage,
  EngineUplinkServerMessage,
  InProcessSyncObserver,
  SyncEntity,
  SyncEntityChange,
  SyncMessage,
  SyncSubscribeMessage,
} from "@avtools/livecode-protocol";

const SYNC_CHANNEL_NAME = "livecode-sync";
const ACTIONS_CHANNEL_NAME = "livecode-actions";
const UPLINK_RETRY_MS = 2_000;
const ENGINE_LOCK_NAME = "livecode-engine";
// The broadcast tick is ~33 ms; a main-thread timer stretching past this is
// the platform throttling us (hidden tab) or a stall worth knowing about.
const TICK_STRETCH_WARN_MS = 250;
const TICK_STRETCH_LOG_INTERVAL_MS = 5_000;
const TICK_WATCHDOG_INTERVAL_MS = 100;

interface EngineRuntime {
  engine: LivecodeEngine;
  channel: BroadcastChannel;
  actionsChannel: BroadcastChannel;
  uplink: UplinkLifecycle;
  audio: AudioContext | null;
  watchdogTimer: number;
}

type UplinkLifecycle =
  | { phase: "idle" }
  | { phase: "connecting"; socket: WebSocket }
  | { phase: "open"; socket: WebSocket }
  | { phase: "waiting"; timer: number }
  | { phase: "stopped" };

/**
 * Start the engine host in this page. Returns synchronously; the engine
 * itself starts once the origin's engine lock is acquired (observe `status()`
 * / `subscribeStatus`), and `execute` rejects until then.
 */
export function startBrowserEngineHost(
  options: BrowserEngineHostOptions,
): BrowserEngineHost {
  const engineBaseUrl = new URL(options.engineBaseUrl, location.href).href;
  const uplinkEnabled = options.uplink ?? true;

  let runtime: EngineRuntime | null = null;
  const status: BrowserEngineHostStatus = {
    lock: "starting",
    message: "livecode browser engine host starting",
    midi: null,
    uplinkOpen: false,
  };
  const statusListeners = new Set<(status: BrowserEngineHostStatus) => void>();
  const observers = new Set<InProcessSyncObserver>();
  const lifetime = new AbortController();
  let releaseLock = () => {};

  let resolveUplinkOpen!: () => void;
  let rejectUplinkOpen!: (error: Error) => void;
  const uplinkOpenPromise = new Promise<void>((resolve, reject) => {
    resolveUplinkOpen = resolve;
    rejectUplinkOpen = reject;
  });
  // A host that is shut down before its uplink ever opens rejects this; an
  // embedder that never awaits it must not surface an unhandled rejection.
  void uplinkOpenPromise.catch(() => {});

  function publishStatus(patch: Partial<BrowserEngineHostStatus>): void {
    Object.assign(status, patch);
    const snapshot = { ...status };
    options.onStatus?.(snapshot);
    for (const listener of [...statusListeners]) listener(snapshot);
  }

  function setLockState(next: BrowserEngineLockState, message?: string): void {
    publishStatus({ lock: next, ...(message ? { message } : {}) });
  }

  async function tryBecomeEngine(steal: boolean): Promise<void> {
    try {
      await navigator.locks.request(
        ENGINE_LOCK_NAME,
        steal
          ? { mode: "exclusive", steal: true }
          : { mode: "exclusive", ifAvailable: true },
        async (lock) => {
          if (!lock) {
            onEngineLockBlocked();
            return;
          }
          if (status.lock === "takenOver" || status.lock === "stopped") return;
          const released = new Promise<void>((resolve) => {
            releaseLock = resolve;
          });
          try {
            startEngine();
          } catch (error) {
            shutdownEngine(`startup failed: ${error}`, "stopped");
          }
          // Shutdown releases this after engine cleanup; stealing rejects the request.
          await released;
        },
      );
    } catch (error) {
      if (status.lock === "engine") {
        shutdownEngine("another tab took over as the engine", "takenOver");
      } else if (!lifetime.signal.aborted) {
        shutdownEngine(`engine lock request failed: ${error}`, "stopped");
      }
    }
  }

  function takeover(): void {
    if (status.lock !== "blocked") return;
    setLockState("retrying");
    void tryBecomeEngine(true);
  }

  function onEngineLockBlocked(): void {
    // A just-closed engine tab releases its lock asynchronously; absorb that
    // with one short retry before declaring another engine alive.
    if (status.lock === "starting") {
      setLockState("retrying");
      setTimeout(() => {
        if (status.lock === "retrying") void tryBecomeEngine(false);
      }, 750);
      return;
    }
    if (status.lock !== "retrying") return;
    console.log(
      "[livecode-engine] blocked: engine already running on this origin",
    );
    setLockState(
      "blocked",
      "livecode engine already running in another tab on this origin",
    );
  }

  function shutdownEngine(
    reason: string,
    finalState: "takenOver" | "stopped",
  ): void {
    if (lifetime.signal.aborted) return;
    lifetime.abort();
    const active = runtime;
    runtime = null;
    publishStatus({
      lock: finalState,
      message: `livecode engine stopped: ${reason}`,
      uplinkOpen: false,
    });
    rejectUplinkOpen(new Error(`engine host shut down: ${reason}`));
    console.warn("[livecode-engine] shutdown:", reason);
    if (!active) {
      releaseLock();
      return;
    }
    const previousUplink = active.uplink;
    active.uplink = { phase: "stopped" };
    // Panic first: branches cancelled, MIDI note-offs sent — the same emergency
    // semantics as the Deno host.
    void active.engine.panicRuntime(reason)
      .catch((error) =>
        console.warn("[livecode-engine] shutdown panic failed", error)
      )
      .finally(() => active.engine.close())
      .catch((error) => {
        console.warn("[livecode-engine] shutdown close failed", error);
      })
      .finally(releaseLock);
    clearInterval(active.watchdogTimer);
    active.channel.close();
    active.actionsChannel.close();
    if (previousUplink.phase === "waiting") {
      clearTimeout(previousUplink.timer);
    } else if (
      previousUplink.phase === "connecting" || previousUplink.phase === "open"
    ) {
      previousUplink.socket.close();
    }
    void active.audio?.close().catch(() => {});
  }

  function startEngine(): void {
    let seq = 0;

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
      state.channel.postMessage(message);
    }

    function sendUplink(message: EngineUplinkClientMessage): void {
      const uplink = runtime?.uplink;
      if (uplink?.phase !== "open") return;
      try {
        uplink.socket.send(JSON.stringify(message));
      } catch (error) {
        console.warn("[livecode-engine] uplink send failed", error);
      }
    }

    const engine = createLivecodeEngine({
      log: (entry) => {
        console.log("[livecode-engine]", JSON.stringify(entry));
        sendUplink({ type: "engineLog", entry });
      },
      panicMidi,
      onSyncTick: (collected) => {
        if (runtime !== state || collected.size === 0) return;
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
        // Observers share immutable wire objects; channel/uplink fan-out still
        // serializes its own copies.
        for (const observer of [...observers]) {
          try {
            observer.onChanges(changes);
          } catch (error) {
            console.warn("[livecode-engine] in-process observer threw", error);
          }
        }
        sendLocal({ changes });
        sendUplink({ type: "engineSync", changes });
      },
    });
    const state: EngineRuntime = {
      engine,
      channel: new BroadcastChannel(SYNC_CHANNEL_NAME),
      actionsChannel: new BroadcastChannel(ACTIONS_CHANNEL_NAME),
      uplink: { phase: "idle" },
      audio: startAudioKeepalive(lifetime.signal),
      watchdogTimer: startTickWatchdog(sendUplink),
    };
    runtime = state;

    // Local observer tabs: a subscribe is answered with full resets.
    state.channel.onmessage = (event) => {
      const message = event.data as SyncSubscribeMessage | undefined;
      if (message?.type !== "subscribe") return;
      const entityTypes = Array.isArray(message.entityTypes)
        ? message.entityTypes.filter((entityType): entityType is string =>
          typeof entityType === "string"
        )
        : undefined;
      sendLocal({ resets: snapshot(entityTypes) });
    };

    state.actionsChannel.onmessage = (event) => {
      const message = event.data as EngineUplinkServerMessage | undefined;
      if (message?.type !== "engineRequest") return;
      void handleRequest(message, (result) => {
        if (runtime === state) state.actionsChannel.postMessage(result);
      });
    };

    async function handleRequest(
      message: EngineUplinkServerMessage,
      reply: (result: EngineUplinkClientMessage) => void,
    ): Promise<void> {
      let result: EngineUplinkClientMessage;
      try {
        const body = await executeEngineOp(engine, message.op);
        result = {
          type: "engineResult",
          requestId: message.requestId,
          ok: true,
          body,
        };
      } catch (error) {
        result = {
          type: "engineResult",
          requestId: message.requestId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      try {
        reply(result);
      } catch (error) {
        console.warn("[livecode-engine] engine reply failed", error);
      }
    }

    // A bake seeds entities and launches prebuilt modules. A missing file
    // means the server/harness owns launches instead.
    void (async () => {
      let baked: BakedProjectFile;
      try {
        const response = await fetch(new URL("baked.json", engineBaseUrl));
        if (response.status === 404) return;
        if (!response.ok) {
          throw new Error(`baked.json: HTTP ${response.status}`);
        }
        baked = await response.json() as BakedProjectFile;
      } catch (error) {
        console.warn(
          "[livecode-engine] baked project could not be read",
          error,
        );
        return;
      }
      if (state.uplink.phase === "stopped") return;
      try {
        if (baked.data.length > 0) {
          await executeEngineOp(engine, {
            kind: "loadEntities",
            entries: baked.data,
          });
        }
        for (const bakedModule of baked.modules) {
          if (lifetime.signal.aborted) return;
          await engine.launchModule({
            moduleId: bakedModule.moduleId,
            // Resolved against baked.json's own location so a bake hosted
            // under any subpath works; the engine's import() would otherwise
            // resolve relative to whichever bundle chunk it lives in.
            transformedModuleUri: new URL(bakedModule.entry, engineBaseUrl)
              .href,
            generatedRunId: bakedModule.generatedRunId,
          });
        }
        console.log("[livecode-engine] baked boot complete");
      } catch (error) {
        console.warn("[livecode-engine] baked boot failed", error);
      }
    })();

    // The server uplink: reconnect forever; a served page without a server
    // (or a server restart) just keeps retrying in the background.
    function scheduleUplinkReconnect(): void {
      if (
        state.uplink.phase === "stopped" || state.uplink.phase === "waiting"
      ) return;
      const timer = setTimeout(() => {
        if (state.uplink.phase !== "waiting" || state.uplink.timer !== timer) {
          return;
        }
        state.uplink = { phase: "idle" };
        connectUplink();
      }, UPLINK_RETRY_MS);
      state.uplink = { phase: "waiting", timer };
    }

    function connectUplink(): void {
      if (state.uplink.phase === "stopped") return;
      const url = new URL("/engine/uplink", engineBaseUrl);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      let socket: WebSocket;
      try {
        socket = new WebSocket(url.href);
      } catch {
        scheduleUplinkReconnect();
        return;
      }
      state.uplink = { phase: "connecting", socket };
      socket.onopen = () => {
        if (uplinkSocket(state.uplink) !== socket) return;
        state.uplink = { phase: "open", socket };
        console.log("[livecode-engine] uplink connected");
        sendUplink({
          type: "engineHello",
          engineKind: "browser",
          resets: snapshot(),
        });
        publishStatus({ uplinkOpen: true });
        resolveUplinkOpen();
      };
      socket.onmessage = (event) => {
        if (
          uplinkSocket(state.uplink) !== socket ||
          typeof event.data !== "string"
        ) return;
        let message: EngineUplinkServerMessage;
        try {
          message = JSON.parse(event.data) as EngineUplinkServerMessage;
        } catch {
          return;
        }
        if (message?.type !== "engineRequest") return;
        // The request belongs to this socket generation. A reconnect may
        // replace state.uplink while the operation is awaiting; its result
        // must never be delivered to that replacement connection.
        const reply = (result: EngineUplinkClientMessage): void => {
          if (
            state.uplink.phase !== "open" ||
            state.uplink.socket !== socket ||
            socket.readyState !== WebSocket.OPEN
          ) {
            return;
          }
          socket.send(JSON.stringify(result));
        };
        void handleRequest(message, reply);
      };
      const retry = () => {
        if (uplinkSocket(state.uplink) !== socket) return;
        if (status.uplinkOpen) publishStatus({ uplinkOpen: false });
        scheduleUplinkReconnect();
      };
      socket.onclose = retry;
      socket.onerror = () => {
        // onclose follows; avoid double-scheduling.
      };
    }
    if (uplinkEnabled) connectUplink();

    function uplinkSocket(lifecycle: UplinkLifecycle): WebSocket | null {
      return lifecycle.phase === "connecting" || lifecycle.phase === "open"
        ? lifecycle.socket
        : null;
    }

    // The page-level harness the E2E scripts (and manual debugging) drive,
    // present in every embedder.
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

    setLockState("engine", "livecode browser engine running");
    startMidiInit();
    console.log("[livecode-engine] browser engine host ready");
  }

  /** Read-only per-type state; the watched-kind list is the engine's own
   * sync-source registry, so a new kind is automatically part of resets. */
  function snapshot(
    entityTypes?: readonly string[],
  ): Record<string, SyncEntity[]> {
    const resets: Record<string, SyncEntity[]> = {};
    const engine = runtime?.engine;
    for (
      const entityType of entityTypes ?? engine?.syncSources.entityTypes() ?? []
    ) {
      resets[entityType] = engine?.syncSources.snapshotAll(
        entityType,
      ) as SyncEntity[] ?? [];
    }
    return resets;
  }

  // MIDI permission may need a focused gesture. Late init is safe because
  // playPianoRoll resolves its output on every call.
  function startMidiInit(): void {
    // initMidi never rejects — failure is caught inside and leaves no access.
    const attempt = () => void initMidi().then(publishMidiStatus);
    const onGesture = () => {
      if (!hasMidiAccess()) attempt();
    };
    globalThis.addEventListener("pointerdown", onGesture, {
      signal: lifetime.signal,
    });
    globalThis.addEventListener("keydown", onGesture, {
      signal: lifetime.signal,
    });
    attempt();
  }

  async function publishMidiStatus(): Promise<void> {
    if (!runtime || runtime.uplink.phase === "stopped") return;
    const outputs = listMidiDevices();
    let text: string;
    if (outputs.length > 0) {
      text = `MIDI: ${outputs.length} output${
        outputs.length === 1 ? "" : "s"
      } (${outputs.map((port) => port.name).join(", ")})`;
    } else if (hasMidiAccess()) {
      text = "MIDI: no outputs found on this machine";
    } else {
      switch (await queryMidiPermission()) {
        case "denied":
          text = "MIDI: permission denied — re-enable it in site settings";
          break;
        case "granted":
          text = "MIDI: access failed — click or press a key to retry";
          break;
        default:
          text = "MIDI: not enabled — click or press a key to request access";
      }
    }
    if (!lifetime.signal.aborted && status.midi !== text) {
      publishStatus({ midi: text });
    }
  }

  // Always present, engine or not: the lock surface the E2E (and a curious
  // operator console) can query and drive.
  (globalThis as Record<string, unknown>).__livecodeEngineLock = {
    state: () => status.lock,
    takeover,
  };

  if (typeof navigator.locks?.request === "function") {
    void tryBecomeEngine(false);
  } else {
    // No Web Locks (very old browser): run unguarded rather than not at all.
    startEngine();
  }

  return {
    status: () => ({ ...status }),
    subscribeStatus: (listener) => {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },
    takeover,
    snapshot,
    observe: (observer) => {
      observers.add(observer);
      return () => {
        observers.delete(observer);
      };
    },
    execute: (op: EngineOp) => {
      const engine = runtime?.engine;
      if (!engine) {
        return Promise.reject(
          new Error(
            status.lock === "blocked"
              ? "the engine is running in another tab on this origin"
              : `no engine in this page (lock state: ${status.lock})`,
          ),
        );
      }
      return executeEngineOp(engine, op);
    },
    whenUplinkOpen: () => uplinkOpenPromise,
    shutdown: (reason) => shutdownEngine(reason, "stopped"),
  };
}

async function queryMidiPermission(): Promise<string | null> {
  try {
    // "midi" is a valid permission name in Chrome (the supported browser) but
    // not in TypeScript's PermissionDescriptor union.
    const status = await navigator.permissions.query(
      { name: "midi" as PermissionName },
    );
    return status.state;
  } catch {
    return null;
  }
}

// Autoplay may suspend audio until a gesture; this is a throttling mitigation,
// not a background timing guarantee.
function startAudioKeepalive(signal: AbortSignal): AudioContext | null {
  const Ctor = globalThis.AudioContext;
  if (typeof Ctor !== "function") return null;
  try {
    const audio = new Ctor();
    const resume = () => {
      if (audio.state === "suspended") void audio.resume().catch(() => {});
    };
    resume();
    globalThis.addEventListener("pointerdown", resume, { signal });
    globalThis.addEventListener("keydown", resume, { signal });
    return audio;
  } catch {
    return null;
  }
}

function startTickWatchdog(
  sendUplink: (message: EngineUplinkClientMessage) => void,
): number {
  let lastFiredAt = performance.now();
  let lastWarnedAt = 0;
  return setInterval(() => {
    const now = performance.now();
    const gap = now - lastFiredAt;
    lastFiredAt = now;
    if (gap <= TICK_STRETCH_WARN_MS) return;
    if (now - lastWarnedAt < TICK_STRETCH_LOG_INTERVAL_MS) return;
    lastWarnedAt = now;
    const entry = {
      type: "engineTickStretch",
      gapMs: Math.round(gap),
      hidden: document.hidden,
    };
    console.warn("[livecode-engine] timer clock stretched", entry);
    sendUplink({ type: "engineLog", entry });
  }, TICK_WATCHDOG_INTERVAL_MS);
}
