import { assert, assertEquals } from "jsr:@std/assert@1";
import { createLivecodeVisualizerServer } from "../visualizer/server.ts";
import { fetchJson, postJson, SyncClient, waitFor } from "./test_helpers.ts";
import type {
  ActiveWaitSnapshot,
  AnalyzeFailure,
  AnalyzeSuccess,
  ClientControlCommandResponse,
  ClientControlEnvelope,
  ModuleLookupsEntity,
  ModuleWaitsEntity,
  RunEntity,
  RuntimeStateResponse,
} from "../visualizer/protocol.ts";

Deno.test("server analyze, launch, snapshot, and stop protocol smoke", async () => {
  const sessionRoot = await Deno.makeTempDir({ prefix: "tcv-server-smoke-" });
  const server = await createLivecodeVisualizerServer({
    port: 0,
    sessionRoot,
    logLevel: "debug",
  });
  // The runtime lifecycle now reaches clients over `/sync`. The legacy
  // `/runtime/snapshots` socket stays open beside it purely to keep the
  // deprecated shim honest: it must keep emitting its FULL envelope off the
  // same tick for the clients that have not migrated.
  const client = await SyncClient.open(server.baseUrl);
  const legacySocket = new WebSocket(
    `${server.baseUrl.replace("http", "ws")}/runtime/snapshots`,
  );
  const snapshots: ActiveWaitSnapshot[] = [];
  legacySocket.onmessage = (event) => {
    snapshots.push(JSON.parse(event.data));
  };

  try {
    await waitFor(
      () => legacySocket.readyState === WebSocket.OPEN,
      "legacy snapshot socket open",
    );
    await client.subscribe(["moduleWaits", "moduleLookups", "run"]);
    const syncFrom = client.messages.length;

    const health = await fetchJson(`${server.baseUrl}/health`);
    assertEquals(health.ok, true);

    const validAnalyze = await postJson(`${server.baseUrl}/runtime/analyze`, {
      moduleId: "module-smoke",
      sourceVersion: 1,
      sourceUri: "module-smoke.ts",
      sourceText: `
import type { TimeContext } from "@avtools/core-timing";

export default async function(ctx: TimeContext) {
  console.log("[fixture] start", ctx.time);
  await ctx.waitSec(0.40);
  console.log("[fixture] done", ctx.time);
}
`,
    }) as AnalyzeSuccess;

    assertEquals(validAnalyze.type, "analyzeSuccess");
    assertEquals(validAnalyze.manifest.callsites.length, 1);
    const waitId = validAnalyze.manifest.callsites[0].id;

    const invalidAnalyze = await postJson(`${server.baseUrl}/runtime/analyze`, {
      moduleId: "module-error",
      sourceVersion: 1,
      sourceUri: "module-error.ts",
      sourceText: `
import type { TimeContext } from "@avtools/core-timing";

export default async function(ctx: TimeContext) {
  await fetch("https://example.com");
}
`,
    }) as AnalyzeFailure;
    assertEquals(invalidAnalyze.type, "analyzeFailure");
    assertEquals(invalidAnalyze.diagnostics[0].code, "TCV_UNSUPPORTED_AWAIT");

    await postJson(`${server.baseUrl}/runtime/launch`, {
      type: "launchModule",
      moduleId: validAnalyze.moduleId,
      sourceVersion: validAnalyze.sourceVersion,
      transformedModuleUri: validAnalyze.transformedModuleUri,
      generatedRunId: validAnalyze.generatedRunId,
    });

    await client.waitForChange(
      syncFrom,
      "moduleWaits",
      (change) =>
        change.name === "module-smoke" &&
        (change.entity as ModuleWaitsEntity | null)?.callsiteIds
            .includes(waitId) === true,
      "active wait entity",
    );

    const runtimeState = await fetchJson(
      `${server.baseUrl}/runtime/state`,
    ) as unknown as RuntimeStateResponse;
    const activeModule = runtimeState.activeModules.find((moduleEntry) =>
      moduleEntry.moduleId === "module-smoke"
    );
    assertEquals(activeModule?.manifest?.callsites[0]?.id, waitId);
    // `/runtime/state` carries the run token now — rehydration is where a
    // reconnecting client seeds the token memory its terminal dedupe keys on —
    // while keeping `updatedAtMs`, the name every legacy surface uses.
    for (const entry of Object.values(runtimeState.moduleRuns)) {
      assertEquals(typeof entry.runToken, "string");
      assertEquals(typeof entry.updatedAtMs, "number");
    }

    await postJson(`${server.baseUrl}/runtime/stop`, {
      type: "stopModule",
      moduleId: "module-smoke",
    });

    await client.waitForChange(
      syncFrom,
      "moduleWaits",
      (change) => change.name === "module-smoke" && change.entity === null,
      "cleared wait entity",
    );

    const lookupOnlyAnalyze = await postJson(
      `${server.baseUrl}/runtime/analyze`,
      {
        moduleId: "module-lookup-only",
        sourceVersion: 1,
        sourceUri: "module-lookup-only.ts",
        sourceText: `
import type { TimeContext } from "@avtools/core-timing";
import { getPianoRollClip } from "piano-roll-helpers";

export default async function(ctx: TimeContext) {
  void ctx;
  void getPianoRollClip("melody");
}
`,
      },
    ) as AnalyzeSuccess;
    assertEquals(lookupOnlyAnalyze.type, "analyzeSuccess");
    assertEquals(
      lookupOnlyAnalyze.manifest.callsites[0].kind,
      "pianoRollLookup",
    );
    const lookupOnlyId = lookupOnlyAnalyze.manifest.callsites[0].id;

    await postJson(`${server.baseUrl}/runtime/launch`, {
      type: "launchModule",
      moduleId: lookupOnlyAnalyze.moduleId,
      sourceVersion: lookupOnlyAnalyze.sourceVersion,
      transformedModuleUri: lookupOnlyAnalyze.transformedModuleUri,
      generatedRunId: lookupOnlyAnalyze.generatedRunId,
    });

    await client.waitForChange(
      syncFrom,
      "moduleLookups",
      (change) =>
        change.name === "module-lookup-only" &&
        (change.entity as ModuleLookupsEntity | null)
            ?.lookups[lookupOnlyId] === "melody",
      "lookup-only module lookup entity",
    );
    await client.waitForChange(
      syncFrom,
      "run",
      (change) =>
        change.name === "module-lookup-only" &&
        (change.entity as RunEntity).state === "stopped",
      "lookup-only module terminal run entity",
    );
    const lookupOnlyRun = client
      .changesSince(syncFrom, "run")
      .map((change) => change.entity as RunEntity)
      .find((run) => run.moduleId === "module-lookup-only");
    assert(lookupOnlyRun?.runToken, "a run entity carries its token");

    // The legacy shim: the same tick still produces the FULL envelope, all four
    // sections included, for the Vue client this slice does not modernize.
    await waitFor(
      () =>
        snapshots.some((snapshot) =>
          snapshot.pianoRollLookups?.["module-lookup-only"]?.[lookupOnlyId] ===
            "melody" &&
          snapshot.moduleRuns?.["module-lookup-only"]?.state === "stopped" &&
          Array.isArray(snapshot.activeModules)
        ),
      "lookup-only module stopped snapshot on the legacy shim",
      2_000,
    );
    // And its rows stay token-FREE: the shim's shape is frozen, so the token
    // reaches clients only on the `run` entity and on `/runtime/state`.
    for (const snapshot of snapshots) {
      for (const entry of Object.values(snapshot.moduleRuns ?? {})) {
        assertEquals("runToken" in entry, false);
        assertEquals(typeof entry.updatedAtMs, "number");
      }
    }

    const stopMarkerPath = `${sessionRoot}/stop-hook.txt`;
    const stopAnalyze = await postJson(`${server.baseUrl}/runtime/analyze`, {
      moduleId: "module-stop-hook",
      sourceVersion: 1,
      sourceUri: "module-stop-hook.ts",
      sourceText: `
import type { TimeContext } from "@avtools/core-timing";

export function stop() {
  Deno.writeTextFileSync(${JSON.stringify(stopMarkerPath)}, "stopped");
}

export default async function(ctx: TimeContext) {
  await ctx.waitSec(30);
}
`,
    }) as AnalyzeSuccess;
    assertEquals(stopAnalyze.type, "analyzeSuccess");

    await postJson(`${server.baseUrl}/runtime/launch`, {
      type: "launchModule",
      moduleId: stopAnalyze.moduleId,
      sourceVersion: stopAnalyze.sourceVersion,
      transformedModuleUri: stopAnalyze.transformedModuleUri,
      generatedRunId: stopAnalyze.generatedRunId,
    });

    await waitForRuntimeModule(
      server.baseUrl,
      "module-stop-hook",
      "stop hook fixture running",
      2_000,
    );

    await postJson(`${server.baseUrl}/runtime/stop`, {
      type: "stopModule",
      moduleId: "module-stop-hook",
    });

    await waitFor(
      () => fileExists(stopMarkerPath),
      "stop hook marker file",
      2_000,
    );
    assertEquals(await Deno.readTextFile(stopMarkerPath), "stopped");
  } finally {
    legacySocket.close();
    client.close();
    await server.close();
    await Deno.remove(sessionRoot, { recursive: true });
  }
});

Deno.test("server forwards agent commands to a connected tldraw client websocket", async () => {
  const sessionRoot = await Deno.makeTempDir({
    prefix: "tcv-client-control-",
  });
  const server = await createLivecodeVisualizerServer({
    port: 0,
    sessionRoot,
    logLevel: "debug",
  });
  const clientId = "test-client";
  const socket = new WebSocket(
    `${
      server.baseUrl.replace("http", "ws")
    }/client/control?clientId=${clientId}`,
  );
  const received: ClientControlEnvelope[] = [];
  socket.onmessage = (event) => {
    const envelope = JSON.parse(event.data) as ClientControlEnvelope;
    received.push(envelope);
    socket.send(JSON.stringify({
      type: "clientCommandResult",
      commandId: envelope.commandId,
      ok: true,
      result: {
        commandType: envelope.command.type,
        moduleCount: 0,
      },
    }));
  };

  try {
    await waitFor(
      () => socket.readyState === WebSocket.OPEN,
      "client control socket open",
    );

    const clients = await fetchJson(`${server.baseUrl}/client/clients`);
    assertEquals(clients.ok, true);

    const response = await postJson<ClientControlCommandResponse>(
      `${server.baseUrl}/client/command`,
      {
        clientId,
        command: { type: "getState" },
        timeoutMs: 1_000,
      },
    );
    assertEquals(response.ok, true);
    assertEquals(response.clientId, clientId);
    assertEquals(response.result, {
      commandType: "getState",
      moduleCount: 0,
    });
    assertEquals(received[0].command.type, "getState");

    const missingClient = await postJson<ClientControlCommandResponse>(
      `${server.baseUrl}/client/command`,
      {
        clientId: "missing-client",
        command: { type: "getState" },
        timeoutMs: 100,
      },
    );
    assertEquals(missingClient.ok, false);
  } finally {
    socket.close();
    await server.close();
    await Deno.remove(sessionRoot, { recursive: true });
  }
});

async function waitForRuntimeModule(
  baseUrl: string,
  moduleId: string,
  label: string,
  timeoutMs: number,
) {
  await waitFor(
    async () => {
      const status = await fetchJson(`${baseUrl}/runtime/status`) as {
        activeModules?: Array<{ moduleId: string }>;
      };
      return Boolean(
        status.activeModules?.some((moduleEntry) =>
          moduleEntry.moduleId === moduleId
        ),
      );
    },
    label,
    timeoutMs,
  );
}

function fileExists(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}
