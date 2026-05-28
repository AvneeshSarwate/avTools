import { assert, assertEquals } from "jsr:@std/assert@1";
import { createLivecodeVisualizerServer } from "../livecode_visualizer/server.ts";
import type {
  ActiveWaitSnapshot,
  AnalyzeFailure,
  AnalyzeSuccess,
} from "../livecode_visualizer/protocol.ts";

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

async function postJson(url: string, body: unknown): Promise<unknown> {
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

async function waitFor(
  predicate: () => boolean,
  label: string,
  timeoutMs = 1_000,
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}`);
}
