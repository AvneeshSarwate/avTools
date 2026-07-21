// Reproducing test for the analyzer default-export rename defect found during
// the 2026-07 stability review. See
// docs/livecode/history/stability-review-2026-07.md.
//
// Asserts CURRENT (buggy) behavior; flip the marked assertions after fixing.
//
// Run with:
//   deno test --allow-env --allow-sys --allow-read livecode/tests/repro/analyzer_repro_test.ts

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { analyzeAndTransformTimedModule } from "../../visualizer/analyze_transform.ts";

function analyze(sourceText: string) {
  return analyzeAndTransformTimedModule({
    moduleId: "module-repro",
    sourceVersion: 1,
    sourceUri: "fixture.ts",
    sourceText,
    generatedRunId: "run-repro",
    runtimeImport: "./timeContextVisualizerRuntime.ts",
    idFactory: ({ index }) => `id_${index + 1}`,
  });
}

Deno.test("BUG A1: renaming a recursive named default export leaves dangling self-references", () => {
  const result = analyze(`
import type { TimeContext } from "@avtools/core-timing";

export default async function loop(ctx: TimeContext) {
  await ctx.waitSec(0.1);
  if (ctx.time < 0.5) {
    await loop(ctx);
  }
}
`);

  assertEquals(result.type, "analyzeSuccess");
  if (result.type !== "analyzeSuccess") return;

  // The declaration is renamed to runFunc...
  assertStringIncludes(result.transformedCode, "export async function runFunc");
  // ...and the recursive callsite still references `loop`, preserved as an
  // alias to runFunc after the function declaration.
  assertStringIncludes(result.transformedCode, "loop(ctx)");
  const declaresLoop =
    /\bfunction\s+loop\b|\bconst\s+loop\b|\blet\s+loop\b|\bvar\s+loop\b/
      .test(result.transformedCode);
  assert(
    declaresLoop,
    "transformed code should preserve `loop` as an alias for recursive calls",
  );
});
