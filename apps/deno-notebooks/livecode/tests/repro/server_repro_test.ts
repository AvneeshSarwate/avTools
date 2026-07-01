// Reproducing tests for visualizer server defects found during the 2026-07
// stability review. See livecode/timeContextVisualizerPlans/stability-fix-plan.md.
//
// Asserts CURRENT (buggy) behavior; flip the marked assertions after fixing.
//
// Run with:
//   deno test --allow-all livecode/tests/repro/server_repro_test.ts

import { assert, assertEquals } from "jsr:@std/assert@1";
import { join } from "jsr:@std/path@1";
import { createLivecodeVisualizerServer } from "../../visualizer/server.ts";

const FIXTURE_SOURCE = (marker: number) => `
import type { TimeContext } from "@avtools/core-timing";

export default async function(ctx: TimeContext) {
  console.log("fixture ${marker}", ctx.time);
  await ctx.waitSec(0.0${marker + 1});
}
`;

async function postJson(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return await response.json();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

      // BUGGY BEHAVIOR. AFTER FIX (wrap handler in try/catch returning a
      // structured { ok:false, error, diagnostics? } JSON): flip to expect a
      // JSON body and an application-level error field.
      assertEquals(response.status, 500);
      let parsedAsJson = true;
      try {
        JSON.parse(bodyText);
      } catch {
        parsedAsJson = false;
      }
      assert(
        !parsedAsJson,
        `expected an opaque non-JSON 500 body, got: ${bodyText}`,
      );
    } finally {
      await server.close();
    }
  },
});

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

      // BUGGY BEHAVIOR: one generated file (and one preparedRuns map entry)
      // per debounced analyze, forever. At a 100ms edit debounce over an
      // hours-long set this is thousands of files + entries for ONE module.
      // AFTER FIX (retain latest N per module, delete superseded files): flip
      // to expect <= N.
      assertEquals(
        generatedFileCount,
        ANALYZE_COUNT,
        `every analyze left its generated file behind (${generatedFileCount})`,
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
        runtimePaths.map(async (path) => (await Deno.stat(path)).mtime!.getTime()),
      );
      await sleep(1100); // ensure mtime resolution can't mask rewrites

      // Analyze ONLY mod_a — the equivalent of one 100ms edit debounce firing.
      const result = await postJson(`${server.baseUrl}/runtime/analyze`, {
        moduleId: "mod_a.ts",
        sourceVersion: 2,
        sourceUri: "mod_a.ts",
      }) as { type: string };
      assertEquals(result.type, "analyzeSuccess");

      const mtimesAfter = await Promise.all(
        runtimePaths.map(async (path) => (await Deno.stat(path)).mtime!.getTime()),
      );

      // BUGGY BEHAVIOR: materializeProjectRuntime re-analyzes and rewrites
      // every module in the project on every analyze call, so editing one
      // module costs O(project size) per keystroke burst. AFTER FIX
      // (skip unchanged modules by sourceHash): flip so only mod_a's runtime
      // file has a new mtime.
      for (let i = 0; i < runtimePaths.length; i++) {
        assert(
          mtimesAfter[i] > mtimesBefore[i],
          `expected ${moduleNames[i]} to be rewritten by an unrelated module's analyze`,
        );
      }
    } finally {
      await server.close();
    }
  },
});
