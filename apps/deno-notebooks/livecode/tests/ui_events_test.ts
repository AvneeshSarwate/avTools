// Engine-to-UI events: the engine queue (validation, one batch per turn, the
// bound), and delivery through the server in both engine modes. The client
// side of every transport is covered by the tldraw E2E `uiEvents` case.

import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { createLivecodeEngine } from "@avtools/livecode-engine";
import {
  addUiEventSink,
  send,
  UI_EVENT_QUEUE_LIMIT,
} from "@avtools/livecode-engine/ui_events.ts";
import { createLivecodeVisualizerServer } from "../visualizer/server.ts";
import type {
  AnalyzeSuccess,
  HealthResponse,
  UiEventBatch,
} from "../visualizer/protocol.ts";
import {
  fetchJson,
  postJson,
  sleep,
  SyncClient,
  waitFor,
} from "./test_helpers.ts";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

Deno.test("send batches one synchronous turn, stamps seq, and validates JSON", async () => {
  const batches: UiEventBatch[] = [];
  const remove = addUiEventSink((batch) => batches.push(batch));
  try {
    send({ type: "a", body: 1 });
    send({ type: "b", body: { nested: [true, null, "x"] } });
    assertEquals(batches.length, 0, "nothing leaves before the turn ends");
    await tick();
    assertEquals(batches.length, 1);
    const [first] = batches;
    assertEquals(first.type, "uiEvents");
    assertEquals(first.events.map((event) => [event.type, event.body]), [
      ["a", 1],
      ["b", { nested: [true, null, "x"] }],
    ]);
    assertEquals(first.events[1].seq, first.events[0].seq + 1);
    assertEquals(first.dropped, undefined);

    // The body is copied at send time; later mutation does not leak through.
    const body = { value: 1 };
    send({ type: "copy", body });
    body.value = 2;
    await tick();
    assertEquals(batches[1].events[0].body, { value: 1 });
    assert(batches[1].events[0].seq > first.events[1].seq);

    assertThrows(() => send({ type: "bad", body: { f() {} } }));
    assertThrows(() => send({ type: "bad", body: new Map() }));
    assertThrows(() => send({ type: "", body: 1 }));
    await tick();
    assertEquals(batches.length, 2, "rejected events never queue");
  } finally {
    remove();
  }
});

Deno.test("the queue bound drops the oldest events and reports the count", async () => {
  const batches: UiEventBatch[] = [];
  const remove = addUiEventSink((batch) => batches.push(batch));
  try {
    for (let index = 0; index < UI_EVENT_QUEUE_LIMIT + 5; index++) {
      send({ type: "flood", body: index });
    }
    await tick();
    assertEquals(batches.length, 1);
    assertEquals(batches[0].events.length, UI_EVENT_QUEUE_LIMIT);
    assertEquals(batches[0].dropped, 5);
    assertEquals(batches[0].events[0].body, 5, "the oldest five went");
  } finally {
    remove();
  }
});

Deno.test("sending with no sink is silent, and a closed engine stops receiving", async () => {
  send({ type: "nobody", body: null });
  await tick();

  const received: UiEventBatch[] = [];
  const engine = createLivecodeEngine({
    log: () => {},
    onSyncTick: () => {},
    onUiEvents: (batch) => received.push(batch),
    seedDemoRoll: false,
  });
  send({ type: "open", body: null });
  await tick();
  assertEquals(received.map((batch) => batch.events[0].type), ["open"]);
  await engine.close();
  send({ type: "closed", body: null });
  await tick();
  assertEquals(received.length, 1);
});

async function withServer(
  engineMode: "local" | "remote",
  body: (baseUrl: string, sockets: WebSocket[]) => Promise<void>,
): Promise<void> {
  const sessionRoot = await Deno.makeTempDir({ prefix: "tcv-ui-events-" });
  const server = await createLivecodeVisualizerServer({
    port: 0,
    sessionRoot,
    engineMode,
  });
  // Sockets the test opens toward the server. The server's shutdown closes
  // them from its side, which is prompt; a client-initiated close would wait
  // out the close handshake.
  const sockets: WebSocket[] = [];
  try {
    await body(server.baseUrl, sockets);
  } finally {
    const closed = sockets
      .filter((socket) => socket.readyState !== WebSocket.CLOSED)
      .map((socket) =>
        new Promise((resolve) =>
          socket.addEventListener("close", resolve, { once: true })
        )
      );
    await server.close();
    await Promise.all(closed);
    await Deno.remove(sessionRoot, { recursive: true });
  }
}

Deno.test("a local engine's events reach every sync socket without a subscription", async () => {
  await withServer("local", async (baseUrl) => {
    const bare = await SyncClient.open(baseUrl);
    const subscribed = await SyncClient.open(baseUrl);
    try {
      await subscribed.subscribe(["params"]);
      const analysis = await postJson<AnalyzeSuccess>(
        `${baseUrl}/runtime/analyze`,
        {
          moduleId: "module-ui-events",
          sourceVersion: 1,
          sourceUri: "module-ui-events.ts",
          sourceText: `
import type { TimeContext } from "@avtools/core-timing";
import * as ui from "ui-events";

export default async function (ctx: TimeContext) {
  await ctx.waitSec(0.05);
  ui.send({ type: "test.first", body: { n: 1 } });
  ui.send({ type: "test.second", body: { n: 2 } });
  await ctx.waitSec(0.05);
  ui.send({ type: "test.third", body: "later" });
}
`,
        },
      );
      assertEquals(analysis.type, "analyzeSuccess");
      await postJson(`${baseUrl}/runtime/launch`, {
        moduleId: analysis.moduleId,
        transformedModuleUri: analysis.transformedModuleUri,
        generatedRunId: analysis.generatedRunId,
      });
      const types = (client: SyncClient) =>
        client.uiBatches.flatMap((batch) => batch.events.map((e) => e.type));
      for (const client of [bare, subscribed]) {
        await waitFor(
          () => types(client).length === 3,
          "three UI events",
          5_000,
        );
        assertEquals(types(client), [
          "test.first",
          "test.second",
          "test.third",
        ]);
        assertEquals(
          client.uiBatches.length,
          2,
          "events sent in one turn arrive as one batch",
        );
      }
      assertEquals(bare.messages.length, 0, "no subscription, no sync");
      const seqs = subscribed.messages.map((message) => message.seq);
      assertEquals(
        seqs,
        seqs.map((_, index) => index + 1),
        "UI events never advance or break the sync seq",
      );
    } finally {
      bare.close();
      subscribed.close();
    }
  });
});

Deno.test("a remote engine's events are relayed from the uplink to sync sockets", async () => {
  await withServer("remote", async (baseUrl, sockets) => {
    const engine = new WebSocket(
      `${baseUrl.replace("http", "ws")}/engine/uplink`,
    );
    sockets.push(engine);
    // Answer whatever the server asks, as the engine host would.
    engine.onmessage = (event) => {
      const message = JSON.parse(event.data as string);
      if (message.type !== "engineRequest") return;
      engine.send(JSON.stringify({
        type: "engineResult",
        requestId: message.requestId,
        ok: true,
        body: null,
      }));
    };
    engine.onopen = () => {
      engine.send(JSON.stringify({
        type: "engineHello",
        engineKind: "browser",
        resets: {},
      }));
    };
    const client = await SyncClient.open(baseUrl);
    try {
      await waitFor(
        async () =>
          (await fetchJson<HealthResponse>(`${baseUrl}/health`)).engine
            .attached,
        "remote engine attached",
        3_000,
      );
      const batch: UiEventBatch = {
        type: "uiEvents",
        events: [{ seq: 7, type: "tldraw.focusEntity", body: { name: "x" } }],
        dropped: 2,
      };
      engine.send(JSON.stringify({ type: "engineUiEvents", batch }));
      await waitFor(
        () => client.uiBatches.length === 1,
        "relayed batch",
        3_000,
      );
      assertEquals(client.uiBatches[0], batch);
      // A malformed relay is ignored rather than forwarded.
      engine.send(JSON.stringify({ type: "engineUiEvents", batch: null }));
      await sleep(100);
      assertEquals(client.uiBatches.length, 1);
    } finally {
      client.close();
    }
  });
});
