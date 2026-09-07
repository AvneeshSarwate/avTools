import { assertEquals } from "jsr:@std/assert@1";
import { OfflineRunner, type TimeContext } from "@avtools/core-timing";
import { pathToFileURL } from "node:url";
import { analyzeAndTransformTimedModule } from "../visualizer/analyze_transform.ts";
import {
  clearAllWaits,
  getActiveWaitsByModule,
} from "@avtools/livecode-engine/runtime.ts";

Deno.test("generated module imports and reports active wait ids", async () => {
  clearAllWaits();
  const tempDir = await Deno.makeTempDir({ prefix: "tcv-dynamic-import-" });
  try {
    const runtimeUrl = new URL(
      "../../../../packages/livecode-engine/runtime.ts",
      import.meta.url,
    ).href;
    const sourceText = `
import type { TimeContext } from "@avtools/core-timing";

export default async function(ctx: TimeContext) {
  console.log("[fixture] start", ctx.time);
  await ctx.waitSec(0.20);
  console.log("[fixture] done", ctx.time);
}
`;

    const result = analyzeAndTransformTimedModule({
      moduleId: "module-dynamic",
      sourceVersion: 1,
      sourceUri: `${tempDir}/fixture.ts`,
      sourceText,
      generatedRunId: "run-dynamic",
      runtimeImport: runtimeUrl,
      idFactory: () => "dynamic_wait_1",
    });

    if (result.type !== "analyzeSuccess") {
      throw new Error(
        `Expected transform success: ${JSON.stringify(result.diagnostics)}`,
      );
    }

    const generatedPath = `${tempDir}/run-dynamic.ts`;
    await Deno.writeTextFile(generatedPath, result.transformedCode);
    const mod = await import(
      `${pathToFileURL(generatedPath).href}?v=${crypto.randomUUID()}`
    ) as {
      runFunc: (ctx: TimeContext) => Promise<void>;
    };

    const runner = new OfflineRunner((ctx) => mod.runFunc(ctx), { bpm: 60 });
    await Promise.resolve();
    assertEquals(getActiveWaitsByModule(), {
      "module-dynamic": ["dynamic_wait_1"],
    });

    await runner.stepSec(0.20);
    await Promise.resolve();
    await Promise.resolve();
    assertEquals(getActiveWaitsByModule(), {});
  } finally {
    await Deno.remove(tempDir, { recursive: true });
    clearAllWaits();
  }
});

Deno.test("generated Promise.all observes children and adopts the longest finish time", async () => {
  clearAllWaits();
  const tempDir = await Deno.makeTempDir({ prefix: "tcv-join-" });
  try {
    const result = analyzeAndTransformTimedModule({
      moduleId: "join",
      sourceVersion: 1,
      sourceUri: pathToFileURL(`${tempDir}/fixture.ts`).href,
      runtimeImport: new URL(
        "../../../../packages/livecode-engine/runtime.ts",
        import.meta.url,
      ).href,
      sourceText: `import type { TimeContext } from "@avtools/core-timing";
export let finish = -1;
export default async function(ctx: TimeContext) {
  const tasks = [0.1, 0.3].map(n => ctx.branchWait(async c => { await c.waitSec(n); }));
  await Promise.all(tasks);
  finish = ctx.time;
}`,
      idFactory: ({ displayName }) => displayName,
    });
    if (result.type !== "analyzeSuccess") {
      throw new Error(JSON.stringify(result));
    }
    const generatedPath = `${tempDir}/generated.ts`;
    await Deno.writeTextFile(generatedPath, result.transformedCode);
    const mod = await import(pathToFileURL(generatedPath).href);
    const runner = new OfflineRunner((ctx) => mod.runFunc(ctx), { bpm: 60 });
    await Promise.resolve();
    assertEquals(getActiveWaitsByModule(), {
      join: ["c.waitSec", "ctx.branchWait", "Promise.all"],
    });
    await runner.stepSec(0.1);
    assertEquals(getActiveWaitsByModule(), {
      join: ["c.waitSec", "ctx.branchWait", "Promise.all"],
    });
    await runner.stepSec(0.2);
    assertEquals(mod.finish, 0.3);
    assertEquals(getActiveWaitsByModule(), {});
  } finally {
    await Deno.remove(tempDir, { recursive: true });
    clearAllWaits();
  }
});
