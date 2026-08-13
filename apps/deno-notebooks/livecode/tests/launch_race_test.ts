import { assert, assertEquals } from "jsr:@std/assert@1";
import { join, toFileUrl } from "jsr:@std/path@1";
import { createLivecodeVisualizerServer } from "../visualizer/server.ts";
import { fetchJson, postJson, sleep, waitFor } from "./test_helpers.ts";
import type {
  LaunchModuleRequest,
  RuntimeModuleStatus,
  RuntimeStateResponse,
} from "../visualizer/protocol.ts";

// Launch acceptance means queued, not started. Everything below drives that
// window on purpose: a second launch, a stop, or a panic arriving after the
// HTTP response and before the queued action runs.
//
// The fixtures are plain module files launched by URI rather than prepared
// through `/runtime/analyze`. The launch route accepts any module URI, and what
// is under test is the queue's safety controls, not the transform. A fixture
// can therefore use a top-level `await` to make its own import slow, which is
// what turns "the stop arrives during the import" from a lucky timing into a
// deterministic case.

interface LaunchOutcome {
  generatedRunId: string;
  status: number;
  ok: boolean;
  error?: string;
}

Deno.test("two concurrent launches leave exactly one active run", async () => {
  const sessionRoot = await Deno.makeTempDir({ prefix: "tcv-launch-race-" });
  const server = await createLivecodeVisualizerServer({
    port: 0,
    sessionRoot,
    logLevel: "debug",
  });
  const moduleId = "module-launch-race";
  const startLogPath = join(sessionRoot, "race-starts.txt");

  try {
    const moduleUri = await writeFixtureModule(sessionRoot, "race", {
      startLogPath,
    });
    const outcomes = await Promise.all([
      launch(server.baseUrl, {
        moduleId,
        transformedModuleUri: moduleUri,
        generatedRunId: "race-run-a",
      }),
      launch(server.baseUrl, {
        moduleId,
        transformedModuleUri: moduleUri,
        generatedRunId: "race-run-b",
      }),
    ]);

    // The loser may be refused at request time or abort silently at execution
    // time; both are correct, and neither may produce a second run.
    const accepted = outcomes.filter((outcome) => outcome.ok);
    const refused = outcomes.filter((outcome) => !outcome.ok);
    assert(accepted.length >= 1, "at least one launch must be accepted");
    for (const outcome of refused) {
      assertEquals(outcome.status, 409);
      assert(
        /already (running|launching)/.test(outcome.error ?? ""),
        `unexpected refusal message: ${outcome.error}`,
      );
    }

    await waitForActiveModule(server.baseUrl, moduleId, "race winner running");
    // A loser still sitting in the queue would take its turn well inside this.
    await sleep(300);

    const runs = await activeRuns(server.baseUrl, moduleId);
    assertEquals(runs.length, 1, "exactly one run may be active");
    assert(
      accepted.some((outcome) =>
        outcome.generatedRunId === runs[0].generatedRunId
      ),
      `active run ${runs[0].generatedRunId} was never accepted`,
    );
    assertEquals(
      await countLines(startLogPath),
      1,
      "only the winning launch may execute user code",
    );
  } finally {
    await server.close();
    await Deno.remove(sessionRoot, { recursive: true });
  }
});

Deno.test("a stop before the queue drains cancels the launch", async () => {
  const sessionRoot = await Deno.makeTempDir({ prefix: "tcv-launch-cancel-" });
  const server = await createLivecodeVisualizerServer({
    port: 0,
    sessionRoot,
    logLevel: "debug",
  });
  const moduleId = "module-launch-cancel";
  const startLogPath = join(sessionRoot, "cancel-starts.txt");

  try {
    const moduleUri = await writeFixtureModule(sessionRoot, "cancel", {
      startLogPath,
      importDelayMs: 400,
    });
    const accepted = await launch(server.baseUrl, {
      moduleId,
      transformedModuleUri: moduleUri,
      generatedRunId: "cancel-run",
    });
    assertEquals(accepted.ok, true);

    await postJson(`${server.baseUrl}/runtime/stop`, { moduleId });

    // Well past the fixture's import delay: the module must never appear.
    await assertNeverActive(server.baseUrl, moduleId, 1_200);
    assertEquals(
      await countLines(startLogPath),
      0,
      "a cancelled launch must not execute user code",
    );

    const run = await moduleRun(server.baseUrl, moduleId);
    assertEquals(run?.generatedRunId, "cancel-run");
    assertEquals(run?.state, "stopped");
  } finally {
    await server.close();
    await Deno.remove(sessionRoot, { recursive: true });
  }
});

Deno.test("a stop during the module import cancels the launch", async () => {
  const sessionRoot = await Deno.makeTempDir({ prefix: "tcv-launch-import-" });
  const server = await createLivecodeVisualizerServer({
    port: 0,
    sessionRoot,
    logLevel: "debug",
  });
  const moduleId = "module-launch-import-cancel";
  const startLogPath = join(sessionRoot, "import-cancel-starts.txt");

  try {
    const moduleUri = await writeFixtureModule(sessionRoot, "import-cancel", {
      startLogPath,
      importDelayMs: 500,
    });
    const accepted = await launch(server.baseUrl, {
      moduleId,
      transformedModuleUri: moduleUri,
      generatedRunId: "import-cancel-run",
    });
    assertEquals(accepted.ok, true);

    // The parent loop drains at ~30 ms, so by now the action is inside its
    // 500 ms import — the one long await where a stop used to be unobservable.
    await sleep(100);
    await postJson(`${server.baseUrl}/runtime/stop`, { moduleId });

    await assertNeverActive(server.baseUrl, moduleId, 1_200);
    assertEquals(
      await countLines(startLogPath),
      0,
      "an import cancelled mid-flight must not execute user code",
    );

    const entries = await readLogEntries(sessionRoot);
    const cancellations = entries.filter((entry) =>
      entry.type === "launchCancelled" &&
      entry.generatedRunId === "import-cancel-run"
    );
    assert(cancellations.length > 0, "the launch must be cancelled");
    // A starved parent loop can leave the action queued when the stop lands, in
    // which case the earlier check cancels it and no import ever happens. The
    // outcome is identical; only assert the post-import branch when the import
    // is what the stop actually raced.
    const imported = entries.some((entry) =>
      entry.type === "moduleImported" &&
      entry.generatedRunId === "import-cancel-run"
    );
    if (imported) {
      assert(
        cancellations.some((entry) => entry.reason === "cancelledDuringImport"),
        "an import that completed must be followed by the post-import check",
      );
    }
  } finally {
    await server.close();
    await Deno.remove(sessionRoot, { recursive: true });
  }
});

Deno.test("replaceRunning stops the running run and starts the new one", async () => {
  const sessionRoot = await Deno.makeTempDir({ prefix: "tcv-launch-replace-" });
  const server = await createLivecodeVisualizerServer({
    port: 0,
    sessionRoot,
    logLevel: "debug",
  });
  const moduleId = "module-launch-replace";
  const startLogPath = join(sessionRoot, "replace-starts.txt");
  const stopLogPath = join(sessionRoot, "replace-stops.txt");

  try {
    const firstUri = await writeFixtureModule(sessionRoot, "replace-a", {
      startLogPath,
      stopLogPath,
    });
    const secondUri = await writeFixtureModule(sessionRoot, "replace-b", {
      startLogPath,
    });

    assertEquals(
      (await launch(server.baseUrl, {
        moduleId,
        transformedModuleUri: firstUri,
        generatedRunId: "replace-run-a",
      })).ok,
      true,
    );
    await waitForActiveModule(server.baseUrl, moduleId, "first run running");

    assertEquals(
      (await launch(server.baseUrl, {
        moduleId,
        transformedModuleUri: secondUri,
        generatedRunId: "replace-run-b",
        replaceRunning: true,
      })).ok,
      true,
    );
    await waitFor(
      async () => {
        const runs = await activeRuns(server.baseUrl, moduleId);
        return runs.length === 1 && runs[0].generatedRunId === "replace-run-b";
      },
      "replacement run active",
      5_000,
    );

    const runs = await activeRuns(server.baseUrl, moduleId);
    assertEquals(runs.length, 1, "a replacement may not leave two runs active");
    assertEquals(await countLines(startLogPath), 2, "both runs executed once");
    assertEquals(await countLines(stopLogPath), 1, "the first run's stop hook");

    // The replaced run's terminal is only the latest `moduleRuns` entry until
    // the replacement overwrites it, so the lifecycle log is what can be
    // asserted without racing the 33 ms snapshot tick.
    const entries = await readLogEntries(sessionRoot);
    assert(
      entries.some((entry) =>
        entry.type === "moduleStopped" &&
        entry.generatedRunId === "replace-run-a" &&
        entry.reason === "replaceBeforeLaunch"
      ),
      "the replaced run must emit a terminal lifecycle entry",
    );
  } finally {
    await server.close();
    await Deno.remove(sessionRoot, { recursive: true });
  }
});

Deno.test("replaceRunning supersedes a launch that never started", async () => {
  const sessionRoot = await Deno.makeTempDir({
    prefix: "tcv-launch-supersede-",
  });
  const server = await createLivecodeVisualizerServer({
    port: 0,
    sessionRoot,
    logLevel: "debug",
  });
  const moduleId = "module-launch-supersede";
  const startLogPath = join(sessionRoot, "supersede-starts.txt");

  try {
    // The first launch is still queued or parked in its slow import when the
    // replacement arrives, so the replacement never sees it in `activeModules`.
    const firstUri = await writeFixtureModule(sessionRoot, "supersede-a", {
      startLogPath,
      importDelayMs: 400,
    });
    const secondUri = await writeFixtureModule(sessionRoot, "supersede-b", {
      startLogPath,
    });

    assertEquals(
      (await launch(server.baseUrl, {
        moduleId,
        transformedModuleUri: firstUri,
        generatedRunId: "supersede-run-a",
      })).ok,
      true,
    );
    assertEquals(
      (await launch(server.baseUrl, {
        moduleId,
        transformedModuleUri: secondUri,
        generatedRunId: "supersede-run-b",
        replaceRunning: true,
      })).ok,
      true,
    );

    await waitFor(
      async () => {
        const runs = await activeRuns(server.baseUrl, moduleId);
        return runs.length === 1 &&
          runs[0].generatedRunId === "supersede-run-b";
      },
      "the superseding run is active",
      5_000,
    );
    // Long enough for the superseded import to have resolved and, if it were
    // still live, to have started user code.
    await sleep(600);

    const runs = await activeRuns(server.baseUrl, moduleId);
    assertEquals(runs.length, 1);
    assertEquals(runs[0].generatedRunId, "supersede-run-b");
    assertEquals(
      await countLines(startLogPath),
      1,
      "only the superseding launch may execute user code",
    );

    const entries = await readLogEntries(sessionRoot);
    assert(
      entries.some((entry) =>
        entry.type === "launchCancelled" &&
        entry.generatedRunId === "supersede-run-a"
      ),
      "the superseded launch must be logged as cancelled",
    );
    const started = entries.filter((entry) => entry.type === "moduleStarted");
    assertEquals(started.length, 1, "exactly one run may start");
    assertEquals(started[0].generatedRunId, "supersede-run-b");
  } finally {
    await server.close();
    await Deno.remove(sessionRoot, { recursive: true });
  }
});

Deno.test("panic cancels a launch that is still queued", async () => {
  const sessionRoot = await Deno.makeTempDir({ prefix: "tcv-launch-panic-" });
  const server = await createLivecodeVisualizerServer({
    port: 0,
    sessionRoot,
    logLevel: "debug",
  });
  const moduleId = "module-launch-panic";
  const startLogPath = join(sessionRoot, "panic-starts.txt");

  try {
    const moduleUri = await writeFixtureModule(sessionRoot, "panic", {
      startLogPath,
      importDelayMs: 400,
    });
    assertEquals(
      (await launch(server.baseUrl, {
        moduleId,
        transformedModuleUri: moduleUri,
        generatedRunId: "panic-run",
      })).ok,
      true,
    );

    await postJson(`${server.baseUrl}/runtime/panic`, {});

    await assertNeverActive(server.baseUrl, moduleId, 1_200);
    assertEquals(
      await countLines(startLogPath),
      0,
      "panic must not let a queued launch start afterwards",
    );

    const run = await moduleRun(server.baseUrl, moduleId);
    assertEquals(run?.state, "stopped");

    const entries = await readLogEntries(sessionRoot);
    assert(
      entries.some((entry) =>
        entry.type === "launchCancelled" &&
        entry.generatedRunId === "panic-run"
      ),
      "panic must log the cancelled launch",
    );
  } finally {
    await server.close();
    await Deno.remove(sessionRoot, { recursive: true });
  }
});

async function launch(
  baseUrl: string,
  body: Partial<LaunchModuleRequest> & {
    moduleId: string;
    transformedModuleUri: string;
    generatedRunId: string;
  },
): Promise<LaunchOutcome> {
  const response = await fetch(`${baseUrl}/runtime/launch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as { ok?: boolean; error?: string };
  return {
    generatedRunId: body.generatedRunId,
    status: response.status,
    ok: payload.ok === true,
    error: payload.error,
  };
}

async function writeFixtureModule(
  dir: string,
  name: string,
  options: {
    startLogPath: string;
    stopLogPath?: string;
    importDelayMs?: number;
  },
): Promise<string> {
  const importDelay = options.importDelayMs
    ? `await new Promise((resolve) => setTimeout(resolve, ${options.importDelayMs}));\n\n`
    : "";
  const stopHook = options.stopLogPath
    ? `export function stop() {
  Deno.writeTextFileSync(${
      JSON.stringify(options.stopLogPath)
    }, "${name}\\n", { append: true, create: true });
}\n\n`
    : "";
  const source = `${importDelay}${stopHook}export default async function (
  ctx: { waitSec(seconds: number): Promise<void> },
) {
  Deno.writeTextFileSync(${
    JSON.stringify(options.startLogPath)
  }, "${name}\\n", { append: true, create: true });
  await ctx.waitSec(30);
}
`;
  const path = join(dir, `fixture-${name}.ts`);
  await Deno.writeTextFile(path, source);
  return toFileUrl(path).href;
}

async function activeRuns(
  baseUrl: string,
  moduleId: string,
): Promise<RuntimeModuleStatus[]> {
  const status = await fetchJson<{ activeModules: RuntimeModuleStatus[] }>(
    `${baseUrl}/runtime/status`,
  );
  return status.activeModules.filter((entry) => entry.moduleId === moduleId);
}

async function moduleRun(baseUrl: string, moduleId: string) {
  const state = await fetchJson<RuntimeStateResponse>(`${baseUrl}/runtime/state`);
  return state.moduleRuns[moduleId];
}

function waitForActiveModule(
  baseUrl: string,
  moduleId: string,
  label: string,
  timeoutMs = 5_000,
) {
  return waitFor(
    async () => (await activeRuns(baseUrl, moduleId)).length > 0,
    label,
    timeoutMs,
  );
}

async function assertNeverActive(
  baseUrl: string,
  moduleId: string,
  durationMs: number,
) {
  const deadline = Date.now() + durationMs;
  while (Date.now() < deadline) {
    const runs = await activeRuns(baseUrl, moduleId);
    assertEquals(
      runs.length,
      0,
      `${moduleId} became active after its launch was cancelled`,
    );
    await sleep(50);
  }
}

async function countLines(path: string): Promise<number> {
  try {
    const text = await Deno.readTextFile(path);
    return text.split("\n").filter((line) => line.trim().length > 0).length;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return 0;
    throw error;
  }
}

async function readLogEntries(
  sessionRoot: string,
): Promise<Array<Record<string, unknown>>> {
  const text = await Deno.readTextFile(join(sessionRoot, "logs", "server.log"));
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
