import { assert, assertEquals } from "jsr:@std/assert@1";
import { createLivecodeVisualizerServer } from "../visualizer/server.ts";
import type {
  ActiveWaitSnapshot,
  AnalyzeFailure,
  AnalyzeSuccess,
  ClientControlCommandResponse,
  ClientControlEnvelope,
} from "../visualizer/protocol.ts";

Deno.test("server analyze, launch, snapshot, and stop protocol smoke", async () => {
  const sessionRoot = await Deno.makeTempDir({ prefix: "tcv-server-smoke-" });
  const server = await createLivecodeVisualizerServer({
    port: 0,
    sessionRoot,
    logLevel: "debug",
  });
  const socket = new WebSocket(
    `${server.baseUrl.replace("http", "ws")}/runtime/snapshots`,
  );
  const snapshots: ActiveWaitSnapshot[] = [];
  socket.onmessage = (event) => {
    snapshots.push(JSON.parse(event.data));
  };

  try {
    await waitFor(
      () => socket.readyState === WebSocket.OPEN,
      "snapshot socket open",
    );

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

    await waitFor(
      () =>
        snapshots.some((snapshot) =>
          snapshot.modules["module-smoke"]?.includes(waitId)
        ),
      "active wait snapshot",
      2_000,
    );

    await postJson(`${server.baseUrl}/runtime/stop`, {
      type: "stopModule",
      moduleId: "module-smoke",
    });

    await waitFor(
      () =>
        snapshots.some((snapshot) =>
          snapshot.seq > 1 &&
          !snapshot.modules["module-smoke"]?.includes(waitId)
        ),
      "cleared wait snapshot",
      2_000,
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

    await waitFor(
      () =>
        snapshots.some((snapshot) =>
          snapshot.pianoRollLookups?.["module-lookup-only"]?.[lookupOnlyId] ===
            "melody" &&
          snapshot.moduleRuns?.["module-lookup-only"]?.state === "stopped"
        ),
      "lookup-only module stopped snapshot",
      2_000,
    );

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
    socket.close();
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

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return await response.json();
}

async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return await response.json();
}

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

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  label: string,
  timeoutMs = 1_000,
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}`);
}
