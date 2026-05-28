import { assertEquals } from "jsr:@std/assert@1";
import { OfflineRunner, type TimeContext } from "@avtools/core-timing";
import { pathToFileURL } from "node:url";
import { analyzeAndTransformTimedModule } from "../livecode_visualizer/analyze_transform.ts";
import {
  clearAllWaits,
  getActiveWaitsByModule,
} from "../livecode_visualizer/runtime.ts";

Deno.test("generated module imports and reports active wait ids", async () => {
  clearAllWaits();
  const tempDir = await Deno.makeTempDir({ prefix: "tcv-dynamic-import-" });
  try {
    const runtimeUrl =
      new URL("../livecode_visualizer/runtime.ts", import.meta.url).href;
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
