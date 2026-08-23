// Reproducing tests for visualizer server defects found during the 2026-07
// stability review. See docs/livecode/history/stability-review-2026-07.md.
//
// Asserts CURRENT (buggy) behavior; flip the marked assertions after fixing.
//
// Run with:
//   deno test --allow-all livecode/tests/repro/server_repro_test.ts

import { assert, assertEquals } from "jsr:@std/assert@1";
import { join } from "jsr:@std/path@1";
import { createLivecodeVisualizerServer } from "../../visualizer/server.ts";
import { postJson, sleep } from "../test_helpers.ts";
import {
  clearParamsStore,
  registerParams,
} from "@avtools/livecode-engine/params_store.ts";
import type {
  AnalyzeSuccess,
  ProjectCurrentResponse,
} from "../../visualizer/protocol.ts";

const PROJECT_MANIFEST_FILENAME = "project.avtools-livecode.json";

const FIXTURE_SOURCE = (marker: number) => `
import type { TimeContext } from "@avtools/core-timing";

export default async function(ctx: TimeContext) {
  console.log("fixture ${marker}", ctx.time);
  await ctx.waitSec(0.0${marker + 1});
}
`;

const HUNG_STOP_SOURCE = (marker: string) => `
import type { TimeContext } from "@avtools/core-timing";

export function stop() {
  console.log("hung stop ${marker}");
  return new Promise(() => {});
}

export default async function(ctx: TimeContext) {
  while (true) await ctx.waitSec(30);
}
`;

Deno.test({
  name:
    "runtime stop-all runs stop hooks in parallel, and runtime panic returns immediately",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const sessionRoot = await Deno.makeTempDir({ prefix: "tcv-repro-panic-" });
    const server = await createLivecodeVisualizerServer({
      port: 0,
      sessionRoot,
      logLevel: "info",
    });
    try {
      await analyzeAndLaunch(
        server.baseUrl,
        "hung-stop-a",
        HUNG_STOP_SOURCE("a"),
      );
      await analyzeAndLaunch(
        server.baseUrl,
        "hung-stop-b",
        HUNG_STOP_SOURCE("b"),
      );
      await waitForActiveModules(
        server.baseUrl,
        2,
        "two hung-stop modules active",
      );

      const stopStartedAt = performance.now();
      await postJson(`${server.baseUrl}/runtime/stop-all`, {});
      const stopElapsedMs = performance.now() - stopStartedAt;
      assert(
        stopElapsedMs < 3_500,
        `expected parallel stop-all to finish under 3500ms, took ${stopElapsedMs}ms`,
      );
      await waitForActiveModules(server.baseUrl, 0, "stop-all cleared modules");

      await analyzeAndLaunch(
        server.baseUrl,
        "panic-module",
        HUNG_STOP_SOURCE("panic"),
      );
      await waitForActiveModules(server.baseUrl, 1, "panic module active");

      const panicStartedAt = performance.now();
      await postJson(`${server.baseUrl}/runtime/panic`, {});
      const panicElapsedMs = performance.now() - panicStartedAt;
      assert(
        panicElapsedMs < 500,
        `expected panic to finish under 500ms, took ${panicElapsedMs}ms`,
      );
      await waitForActiveModules(server.baseUrl, 0, "panic cleared modules");
    } finally {
      await server.close();
    }
  },
});

Deno.test({
  name:
    "BUG S1: a throwing route handler produces an opaque 500 — the HTTP layer has no error guard",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const sessionRoot = await Deno.makeTempDir({ prefix: "tcv-repro-500-" });
    const server = await createLivecodeVisualizerServer({
      port: 0,
      sessionRoot,
      logLevel: "info",
    });
    try {
      // No project is open, so requireCurrentProject() throws a plain Error
      // inside the handler. Nothing catches it, so Deno.serve emits a generic
      // 500 with no JSON diagnostics payload — the same fate awaits any
      // ts-morph/filesystem throw during /runtime/analyze mid-performance.
      const response = await fetch(
        `${server.baseUrl}/project/modules/source?id=nope`,
      );
      const bodyText = await response.text();

      assertEquals(response.status, 500);
      const body = JSON.parse(bodyText) as { ok?: boolean; error?: unknown };
      assertEquals(body.ok, false);
      assert(
        typeof body.error === "string" && body.error.length > 0,
        `expected JSON error body, got: ${bodyText}`,
      );
    } finally {
      await server.close();
    }
  },
});

Deno.test({
  name:
    "FIX B: /project/canvas persists piano-roll view layout to the manifest and survives reopen",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const sessionRoot = await Deno.makeTempDir({ prefix: "tcv-canvas-" });
    const projectRoot = await Deno.makeTempDir({ prefix: "tcv-canvas-proj-" });
    const server = await createLivecodeVisualizerServer({
      port: 0,
      sessionRoot,
      logLevel: "info",
    });
    try {
      await postJson(`${server.baseUrl}/project/create`, {
        projectPath: projectRoot,
        name: "canvas-repro",
      });

      const view = {
        id: "shape:piano-roll-view-1",
        rollName: "melody",
        x: 820,
        y: 120,
        w: 560,
        h: 360,
      };
      await postJson(`${server.baseUrl}/project/canvas`, {
        canvas: { pianoRollViews: [view] },
      });

      const current = await (await fetch(`${server.baseUrl}/project/current`))
        .json() as ProjectCurrentResponse;
      assertEquals(current.project?.manifest.canvas?.pianoRollViews, [view]);

      const manifestOnDisk = JSON.parse(
        await Deno.readTextFile(join(projectRoot, PROJECT_MANIFEST_FILENAME)),
      ) as { canvas?: { pianoRollViews?: unknown[] } };
      assertEquals(manifestOnDisk.canvas?.pianoRollViews, [view]);

      const reopened = await postJson(`${server.baseUrl}/project/open`, {
        projectPath: projectRoot,
      }) as ProjectCurrentResponse;
      assertEquals(reopened.project?.manifest.canvas?.pianoRollViews, [view]);
    } finally {
      await server.close();
    }
  },
});

Deno.test({
  name: "project save aborts before writing when an entity cannot serialize",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const sessionRoot = await Deno.makeTempDir({ prefix: "tcv-save-invalid-" });
    const projectRoot = await Deno.makeTempDir({
      prefix: "tcv-save-invalid-proj-",
    });
    const manifestPath = join(projectRoot, PROJECT_MANIFEST_FILENAME);
    const server = await createLivecodeVisualizerServer({
      port: 0,
      sessionRoot,
      logLevel: "info",
    });
    try {
      await postJson(`${server.baseUrl}/project/create`, {
        projectPath: projectRoot,
        name: "save-invalid",
      });
      const manifestBefore = await Deno.readTextFile(manifestPath);

      const values = registerParams("save/invalid", { gain: 1 });
      (values as Record<string, unknown>).gain = 1n;

      const response = await fetch(`${server.baseUrl}/project/save`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const body = await response.json() as { ok?: boolean; error?: string };

      assertEquals(response.status, 500);
      assertEquals(body.ok, false);
      assert(body.error?.includes("Project save aborted"));
      assertEquals(await Deno.readTextFile(manifestPath), manifestBefore);
    } finally {
      clearParamsStore();
      await server.close();
    }
  },
});

async function analyzeAndLaunch(
  baseUrl: string,
  moduleId: string,
  sourceText: string,
): Promise<void> {
  const analyze = await postJson(`${baseUrl}/runtime/analyze`, {
    moduleId,
    sourceVersion: 1,
    sourceUri: `${moduleId}.ts`,
    sourceText,
  }) as AnalyzeSuccess;
  assertEquals(analyze.type, "analyzeSuccess");
  await postJson(`${baseUrl}/runtime/launch`, {
    type: "launchModule",
    moduleId,
    sourceVersion: analyze.sourceVersion,
    transformedModuleUri: analyze.transformedModuleUri,
    generatedRunId: analyze.generatedRunId,
  });
}

async function waitForActiveModules(
  baseUrl: string,
  expectedCount: number,
  label: string,
  timeoutMs = 2_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const response = await fetch(`${baseUrl}/runtime/status`);
    const status = await response.json() as {
      activeModules?: Array<{ moduleId: string }>;
    };
    if ((status.activeModules?.length ?? 0) === expectedCount) return;
    await sleep(20);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

Deno.test({
  name:
    "BUG S2: prepared runs and generated module files accumulate without pruning",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const sessionRoot = await Deno.makeTempDir({ prefix: "tcv-repro-prune-" });
    const server = await createLivecodeVisualizerServer({
      port: 0,
      sessionRoot,
      logLevel: "info",
    });
    try {
      const ANALYZE_COUNT = 6;
      for (let i = 0; i < ANALYZE_COUNT; i++) {
        const result = await postJson(`${server.baseUrl}/runtime/analyze`, {
          moduleId: "module-prune-repro",
          sourceVersion: i + 1,
          sourceUri: "module-prune-repro.ts",
          sourceText: FIXTURE_SOURCE(i),
        }) as { type: string };
        assertEquals(result.type, "analyzeSuccess");
      }

      // Find the session's generated dir: sessionRoot/<sessionId>/generated
      let generatedFileCount = 0;
      for await (const entry of Deno.readDir(sessionRoot)) {
        if (!entry.isDirectory || entry.name === "logs") continue;
        const generatedDir = join(sessionRoot, entry.name, "generated");
        try {
          for await (const file of Deno.readDir(generatedDir)) {
            if (file.name.endsWith(".ts")) generatedFileCount += 1;
          }
        } catch {
          // no generated dir for this entry
        }
      }

      assert(
        generatedFileCount <= 3,
        `expected at most 3 generated files, got ${generatedFileCount}`,
      );
    } finally {
      await server.close();
    }
  },
});

Deno.test({
  name:
    "BUG S3: analyzing ONE project module re-transforms and rewrites EVERY module's runtime file",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const sessionRoot = await Deno.makeTempDir({ prefix: "tcv-repro-mat-" });
    const projectRoot = await Deno.makeTempDir({ prefix: "tcv-repro-proj-" });
    const server = await createLivecodeVisualizerServer({
      port: 0,
      sessionRoot,
      logLevel: "info",
    });
    try {
      const moduleNames = ["mod_a.ts", "mod_b.ts", "mod_c.ts"];
      await postJson(`${server.baseUrl}/project/create`, {
        projectPath: projectRoot,
        name: "materialize-repro",
        modules: moduleNames.map((path, index) => ({
          path,
          sourceText: FIXTURE_SOURCE(index),
        })),
      });

      const runtimePaths = moduleNames.map((name) => join(projectRoot, name));
      const mtimesBefore = await Promise.all(
        runtimePaths.map(async (path) =>
          (await Deno.stat(path)).mtime!.getTime()
        ),
      );
      await sleep(1100); // ensure mtime resolution can't mask rewrites

      await postJson(`${server.baseUrl}/project/modules/write`, {
        id: "mod_a.ts",
        sourceVersion: 2,
        sourceText: FIXTURE_SOURCE(9),
      });

      // Analyze ONLY mod_a — the equivalent of the second materialize call in
      // the write -> analyze debounce path.
      const result = await postJson(`${server.baseUrl}/runtime/analyze`, {
        moduleId: "mod_a.ts",
        sourceVersion: 2,
        sourceUri: "mod_a.ts",
      }) as { type: string };
      assertEquals(result.type, "analyzeSuccess");

      const mtimesAfter = await Promise.all(
        runtimePaths.map(async (path) =>
          (await Deno.stat(path)).mtime!.getTime()
        ),
      );

      assert(
        mtimesAfter[0] > mtimesBefore[0],
        "expected changed mod_a.ts to be rewritten",
      );
      for (let i = 1; i < runtimePaths.length; i++) {
        assertEquals(
          mtimesAfter[i],
          mtimesBefore[i],
          `expected unchanged ${moduleNames[i]} not to be rewritten`,
        );
      }
    } finally {
      await server.close();
    }
  },
});
