import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { createRemoteExecutionPlane } from "../visualizer/execution_plane.ts";
import type {
  EngineUplinkClientMessage,
  EngineUplinkRequest,
} from "../visualizer/protocol.ts";
import { waitFor } from "./test_helpers.ts";

class FakeEngineSocket {
  readyState: number = WebSocket.OPEN;
  onmessage: WebSocket["onmessage"] = null;
  onclose: WebSocket["onclose"] = null;
  onerror: WebSocket["onerror"] = null;
  readonly requests: EngineUplinkRequest[] = [];

  asWebSocket(): WebSocket {
    return this as unknown as WebSocket;
  }

  send(payload: string): void {
    if (this.readyState !== WebSocket.OPEN) throw new Error("socket closed");
    const request = JSON.parse(payload) as EngineUplinkRequest;
    this.requests.push(request);
    this.receive({
      type: "engineResult",
      requestId: request.requestId,
      ok: true,
      body: { socket: "fake" },
    });
  }

  receive(message: EngineUplinkClientMessage): void {
    this.onmessage?.call(
      this.asWebSocket(),
      { data: JSON.stringify(message) } as MessageEvent,
    );
  }

  close(): void {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.onclose?.call(this.asWebSocket(), {} as CloseEvent);
  }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function hello(socket: FakeEngineSocket): void {
  socket.receive({
    type: "engineHello",
    engineKind: "browser",
    resets: {},
  });
}

Deno.test("remote execution waits for engine initialization", async () => {
  const initialization = deferred();
  const plane = createRemoteExecutionPlane({
    log: () => {},
    onSyncChanges: () => {},
    onEngineResets: () => {},
    initializeEngine: () => initialization.promise,
  });
  const socket = new FakeEngineSocket();
  plane.attachEngineSocket(socket.asWebSocket());
  hello(socket);

  assertEquals(plane.hasEngine(), false);
  const operation = plane.execute({ kind: "runtimeState" });
  assertEquals(socket.requests.length, 0);

  initialization.resolve();
  const result = await operation;
  assertEquals(socket.requests.length, 1);
  assertEquals(result, { socket: "fake" });
  assertEquals(plane.hasEngine(), true);
  await plane.close();
});

Deno.test("stale engine initialization cannot target its replacement", async () => {
  const firstGate = deferred();
  const firstStarted = deferred();
  let initializationCount = 0;
  let staleExecution: Promise<unknown> | null = null;
  const plane = createRemoteExecutionPlane({
    log: () => {},
    onSyncChanges: () => {},
    onEngineResets: () => {},
    initializeEngine: async (_resets, execute) => {
      initializationCount += 1;
      if (initializationCount !== 1) return;
      firstStarted.resolve();
      await firstGate.promise;
      staleExecution = execute({ kind: "runtimeState" });
      await staleExecution;
    },
  });

  const first = new FakeEngineSocket();
  plane.attachEngineSocket(first.asWebSocket());
  hello(first);
  await firstStarted.promise;

  const replacement = new FakeEngineSocket();
  plane.attachEngineSocket(replacement.asWebSocket());
  hello(replacement);
  await waitFor(() => plane.hasEngine(), "replacement engine ready");

  firstGate.resolve();
  await waitFor(() => staleExecution !== null, "stale initializer resumed");
  await assertRejects(
    () => staleExecution as Promise<unknown>,
    Error,
    "engine replaced",
  );
  assertEquals(first.requests.length, 0);
  assertEquals(replacement.requests.length, 0);
  assert(plane.hasEngine());
  await plane.close();
});

Deno.test("remote event operations preserve individual down/up messages", async () => {
  const plane = createRemoteExecutionPlane({
    log: () => {}, onSyncChanges: () => {}, onEngineResets: () => {},
    initializeEngine: async () => {},
  });
  const socket = new FakeEngineSocket();
  plane.attachEngineSocket(socket.asWebSocket());
  hello(socket);
  try {
    await waitFor(() => plane.hasEngine(), "event engine ready");
    for (const state of ["down", "up"]) {
      await plane.execute({ kind: "emitEvent", event: {
        type: "trigger", body: { melody: "dscale5", state },
      } });
    }
    assertEquals(socket.requests.map(request => request.op), ["down", "up"].map(state => ({
      kind: "emitEvent" as const, event: { type: "trigger", body: { melody: "dscale5", state } },
    })));
  } finally { await plane.close(); }
});

Deno.test("remote execution forwards sparse patches without materializing or dropping them", async () => {
  const changes: unknown[] = [];
  const plane = createRemoteExecutionPlane({
    log: () => {},
    onSyncChanges: (batch) => changes.push(batch),
    onEngineResets: () => {},
  });
  const socket = new FakeEngineSocket();
  plane.attachEngineSocket(socket.asWebSocket());
  hello(socket);
  await waitFor(() => plane.hasEngine(), "remote engine ready");
  const batch: import("@avtools/livecode-protocol").SyncEntityChange[] = [{
    entityType: "sixSines",
    name: "remote",
    patches: [{ op: "set", path: ["data", "values", "1"], value: 0.5 }],
  }];
  socket.receive({ type: "engineSync", changes: batch });
  assertEquals(changes, [batch]);
  await plane.close();
});
