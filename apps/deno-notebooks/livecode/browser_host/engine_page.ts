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
//
// Operational duties beyond the transports:
//  - one engine per origin: a `navigator.locks` exclusive lock; a second tab
//    renders "already running" with a takeover (steal) button, and a stolen
//    engine panics and shuts down;
//  - MIDI: `initMidi()` runs at engine start (silent once the origin's
//    permission is granted) and retries from the first user gesture (the
//    first-ever visit's permission prompt), with a visible status line;
//    `panicMidi` from the same midi-helpers singleton is wired into the
//    engine, same as the Deno host;
//  - graphics stage: `#livecode-stage` (engine.html) is user-module DOM —
//    graphics modules append canvases there; page chrome never touches it;
//  - throttling defenses: a silent AudioContext keepalive (exempts the tab
//    from intensive throttling) plus a timer watchdog that logs — locally and
//    over the uplink — whenever the main-thread clock stretches, so hidden-tab
//    clamping never fails silently.

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
  EngineUplinkClientMessage,
  EngineUplinkServerMessage,
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

type EngineLockState = "starting" | "engine" | "blocked" | "takenOver";
let lockState: EngineLockState = "starting";

interface EngineRuntime {
  engine: LivecodeEngine;
  channel: BroadcastChannel;
  actionsChannel: BroadcastChannel;
  uplink: WebSocket | null;
  audio: AudioContext | null;
  watchdogTimer: number | null;
  stopped: boolean;
}

let runtime: EngineRuntime | null = null;

/**
 * Find-or-create one of the page's own chrome lines. Status rendering only
 * ever touches these elements — never the body — because `#livecode-stage`
 * (declared in engine.html) belongs to user modules: graphics modules append
 * canvases there, and a status update must not destroy them.
 */
function pageLine(className: string): HTMLDivElement | null {
  const body = document.body;
  if (!body) return null;
  let line = body.querySelector<HTMLDivElement>(`:scope > .${className}`);
  if (!line) {
    line = document.createElement("div");
    line.className = className;
    body.appendChild(line);
  }
  return line;
}

function setStatus(text: string, takeover?: () => void): void {
  const line = pageLine("livecode-engine-status");
  if (!line) return;
  line.textContent = text;
  if (takeover) {
    const button = document.createElement("button");
    button.className = "livecode-engine-takeover";
    button.type = "button";
    button.textContent = "Take over as engine";
    button.onclick = takeover;
    line.appendChild(button);
  }
}

// ---------------------------------------------------------------------------
// One engine per origin: exclusive Web Lock with explicit takeover.

function holdForever(): Promise<never> {
  return new Promise<never>(() => {});
}

let blockedRetryUsed = false;

async function tryBecomeEngine(options: { steal: boolean }): Promise<void> {
  try {
    await navigator.locks.request(
      ENGINE_LOCK_NAME,
      options.steal
        ? { mode: "exclusive", steal: true }
        : { mode: "exclusive", ifAvailable: true },
      async (lock) => {
        if (!lock) {
          onEngineLockBlocked();
          return;
        }
        lockState = "engine";
        startEngine();
        // Hold the lock for the tab's lifetime; a steal rejects this request.
        await holdForever();
      },
    );
  } catch (error) {
    if (lockState === "engine") {
      lockState = "takenOver";
      shutdownEngine("another tab took over as the engine");
    } else {
      console.warn("[livecode-engine] engine lock request failed", error);
    }
  }
}

function onEngineLockBlocked(): void {
  // A just-closed engine tab releases its lock asynchronously; absorb that
  // with one short retry before declaring another engine alive.
  if (!blockedRetryUsed) {
    blockedRetryUsed = true;
    setTimeout(() => void tryBecomeEngine({ steal: false }), 750);
    return;
  }
  lockState = "blocked";
  console.log("[livecode-engine] blocked: engine already running on this origin");
  setStatus(
    "livecode engine already running in another tab on this origin",
    () => void tryBecomeEngine({ steal: true }),
  );
}

function shutdownEngine(reason: string): void {
  const active = runtime;
  runtime = null;
  setStatus(`livecode engine stopped: ${reason}`);
  console.warn("[livecode-engine] shutdown:", reason);
  if (!active) return;
  active.stopped = true;
  // Panic first: branches cancelled, MIDI note-offs sent — the same emergency
  // semantics as the Deno host.
  void active.engine.panicRuntime(reason)
    .catch((error) => console.warn("[livecode-engine] shutdown panic failed", error))
    .finally(() => {
      active.engine.close().catch((error) =>
        console.warn("[livecode-engine] shutdown close failed", error)
      );
    });
  if (active.watchdogTimer !== null) clearInterval(active.watchdogTimer);
  try {
    active.channel.close();
    active.actionsChannel.close();
  } catch {
    // Already closed.
  }
  try {
    active.uplink?.close();
  } catch {
    // Already closed.
  }
  void active.audio?.close().catch(() => {});
}

// ---------------------------------------------------------------------------
// The engine proper. Everything below runs only in the tab holding the lock.

function startEngine(): void {
  const state: EngineRuntime = {
    engine: null as unknown as LivecodeEngine,
    channel: new BroadcastChannel(SYNC_CHANNEL_NAME),
    actionsChannel: new BroadcastChannel(ACTIONS_CHANNEL_NAME),
    uplink: null,
    audio: startAudioKeepalive(),
    watchdogTimer: null,
    stopped: false,
  };
  runtime = state;
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
    if (!state.uplink || state.uplink.readyState !== WebSocket.OPEN) return;
    try {
      state.uplink.send(JSON.stringify(message));
    } catch (error) {
      console.warn("[livecode-engine] uplink send failed", error);
    }
  }

  /** Throwing variant for op replies: a reply that cannot serialize must
   * surface as an error result, not a server-side timeout. */
  function sendUplinkStrict(message: EngineUplinkClientMessage): void {
    if (!state.uplink || state.uplink.readyState !== WebSocket.OPEN) {
      throw new Error("uplink not open");
    }
    state.uplink.send(JSON.stringify(message));
  }

  const engine = createLivecodeEngine({
    log: (entry) => {
      console.log("[livecode-engine]", JSON.stringify(entry));
      sendUplink({ type: "engineLog", entry });
    },
    panicMidi,
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
  state.engine = engine;
  state.watchdogTimer = startTickWatchdog(sendUplink);

  // The watched-entity-kind list is the engine's own registry — a new kind
  // registered in sync_sources is automatically part of hellos and resets.
  const entityTypeList = () => state.engine.syncSources.entityTypes();

  function snapshotAllTypes(): Record<string, SyncEntity[]> {
    const resets: Record<string, SyncEntity[]> = {};
    for (const entityType of entityTypeList()) {
      resets[entityType] = engine.syncSources.snapshotAll(
        entityType,
      ) as SyncEntity[];
    }
    return resets;
  }

  // Local observer tabs: a subscribe is answered with full resets.
  state.channel.onmessage = (event) => {
    const message = event.data as SyncSubscribeMessage | undefined;
    if (message?.type !== "subscribe") return;
    const entityTypes = Array.isArray(message.entityTypes)
      ? message.entityTypes.filter((entityType): entityType is string =>
        typeof entityType === "string"
      )
      : entityTypeList();
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
  state.actionsChannel.onmessage = (event) => {
    const message = event.data as EngineUplinkServerMessage | undefined;
    if (message?.type !== "engineRequest") return;
    void (async () => {
      try {
        const body = await executeEngineOp(engine, message.op);
        state.actionsChannel.postMessage({
          type: "engineResult",
          requestId: message.requestId,
          ok: true,
          body,
        });
      } catch (error) {
        state.actionsChannel.postMessage({
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
  // topologies, where launches arrive over the uplink or harness instead. The
  // file's manifest/sourceText fields are for the UI tab; this page ignores
  // them.
  void (async () => {
    let baked: BakedProjectFile;
    try {
      const response = await fetch("./baked.json");
      if (!response.ok) return;
      baked = await response.json() as BakedProjectFile;
    } catch {
      return;
    }
    if (state.stopped) return;
    try {
      if (baked.data.length > 0) {
        await executeEngineOp(engine, {
          kind: "loadEntities",
          entries: baked.data,
        });
      }
      for (const bakedModule of baked.modules) {
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

  // The server uplink: reconnect forever; a served page without a server (or
  // a server restart) just keeps retrying in the background.
  function connectUplink(): void {
    if (state.stopped) return;
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
      if (state.stopped) {
        socket.close();
        return;
      }
      state.uplink = socket;
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
          sendUplinkStrict({
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
      if (state.uplink === socket) state.uplink = null;
      if (!state.stopped) setTimeout(connectUplink, UPLINK_RETRY_MS);
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

  setStatus("livecode browser engine running");
  startMidiInit();
  console.log("[livecode-engine] browser engine host ready");
}

/**
 * Web MIDI needs a one-time per-origin permission grant; after that,
 * `initMidi()` resolves silently at page load, even in a background tab. So:
 * try immediately (the steady state), and retry from the same gesture events
 * the audio keepalive uses (the first-ever visit, where the permission prompt
 * wants a focused tab and a user gesture; a failed init clears its latch so
 * the retry re-prompts). Late init is safe — `playPianoRoll` resolves its
 * output on every call, so a looping player picks the device up next pass.
 */
function startMidiInit(): void {
  const attempt = () =>
    void initMidi()
      .then(renderMidiStatus)
      .catch(() => renderMidiStatus());
  const onGesture = () => {
    if (listMidiDevices().length === 0) attempt();
  };
  globalThis.addEventListener("pointerdown", onGesture);
  globalThis.addEventListener("keydown", onGesture);
  attempt();
}

/** The MIDI line lives outside `setStatus` (which owns/wipes the body). */
async function renderMidiStatus(): Promise<void> {
  if (!runtime || runtime.stopped) return;
  const outputs = listMidiDevices();
  let text: string;
  if (outputs.length > 0) {
    text = `MIDI: ${outputs.length} output${outputs.length === 1 ? "" : "s"} (${
      outputs.map((port) => port.name).join(", ")
    })`;
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
  const line = pageLine("livecode-midi-status");
  if (line) line.textContent = text;
}

async function queryMidiPermission(): Promise<string | null> {
  try {
    // "midi" is a valid permission name in Chrome (the supported browser) but
    // not in TypeScript's PermissionDescriptor union.
    const status = await navigator.permissions.query(
      { name: "midi" } as unknown as PermissionDescriptor,
    );
    return status.state;
  } catch {
    return null;
  }
}

/**
 * A running (silent) AudioContext exempts the tab from intensive throttling —
 * the same trick every browser DAW uses. Autoplay policy may hold it
 * suspended until a user gesture lands on this tab; resume opportunistically.
 */
function startAudioKeepalive(): AudioContext | null {
  const Ctor = globalThis.AudioContext;
  if (typeof Ctor !== "function") return null;
  try {
    const audio = new Ctor();
    const resume = () => {
      if (audio.state === "suspended") void audio.resume().catch(() => {});
    };
    resume();
    globalThis.addEventListener("pointerdown", resume);
    globalThis.addEventListener("keydown", resume);
    return audio;
  } catch {
    return null;
  }
}

/**
 * "The platform never fails silently": measure the main-thread timer clock
 * the engine's tick actually lives on. When a hidden tab gets clamped (or the
 * thread stalls), the interval fires late and the gap says by how much —
 * logged locally and over the uplink so the server log shows it too.
 */
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
  }, TICK_WATCHDOG_INTERVAL_MS) as unknown as number;
}

// Always present, engine or not: the lock surface the E2E (and a curious
// operator console) can query and drive.
(globalThis as Record<string, unknown>).__livecodeEngineLock = {
  state: () => lockState,
  takeover: () => void tryBecomeEngine({ steal: true }),
};

if (typeof navigator.locks?.request === "function") {
  void tryBecomeEngine({ steal: false });
} else {
  // No Web Locks (very old browser): run unguarded rather than not at all.
  lockState = "engine";
  startEngine();
}
