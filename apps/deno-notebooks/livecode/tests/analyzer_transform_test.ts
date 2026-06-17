import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { analyzeAndTransformTimedModule } from "../visualizer/analyze_transform.ts";

function analyze(sourceText: string) {
  return analyzeAndTransformTimedModule({
    moduleId: "module-test",
    sourceVersion: 1,
    sourceUri: "fixture.ts",
    sourceText,
    generatedRunId: "run-test",
    runtimeImport: "./timeContextVisualizerRuntime.ts",
    idFactory: ({ index }) => `id_${index + 1}`,
  });
}

Deno.test("analyzer instruments linear root waits", () => {
  const result = analyze(`
import type { TimeContext } from "@avtools/core-timing";

function log(label: string, ctx?: TimeContext) {
  console.log(label, ctx?.time);
}

export default async function(ctx: TimeContext) {
  log("start", ctx);
  await ctx.waitSec(0.20);
  log("middle", ctx);
  await ctx.wait(1);
  log("done", ctx);
}
`);

  assertEquals(result.type, "analyzeSuccess");
  if (result.type !== "analyzeSuccess") return;

  assertEquals(result.manifest.callsites.length, 2);
  assertEquals(result.manifest.callsites.map((c) => c.id), ["id_1", "id_2"]);
  assertEquals(result.manifest.callsites.map((c) => c.displayName), [
    "ctx.waitSec",
    "ctx.wait",
  ]);
  assertStringIncludes(result.transformedCode, "export async function runFunc");
  assertStringIncludes(result.transformedCode, "export default runFunc");
  assertStringIncludes(
    result.transformedCode,
    '__tcvVisualizedAwait("module-test", "id_1", ctx.waitSec(0.20))',
  );
  assertStringIncludes(
    result.transformedCode,
    '__tcvVisualizedAwait("module-test", "id_2", ctx.wait(1))',
  );
});

Deno.test("analyzer preserves explicit module stop export", () => {
  const result = analyze(`
import type { TimeContext } from "@avtools/core-timing";

export function stop() {
  console.log("cleanup");
}

export default async function(ctx: TimeContext) {
  await ctx.waitSec(0.20);
}
`);

  assertEquals(result.type, "analyzeSuccess");
  if (result.type !== "analyzeSuccess") return;

  assertStringIncludes(result.transformedCode, "export function stop()");
  assertStringIncludes(result.transformedCode, "export async function runFunc");
  assertStringIncludes(result.transformedCode, "export default runFunc");
});

Deno.test("analyzer instruments root helper calls and local helper internals", () => {
  const result = analyze(`
import type { TimeContext } from "@avtools/core-timing";

async function helper(ctx: TimeContext) {
  await ctx.waitSec(0.20);
}

export default async function(ctx: TimeContext) {
  await helper(ctx);
  await helper(ctx);
}
`);

  assertEquals(result.type, "analyzeSuccess");
  if (result.type !== "analyzeSuccess") return;

  assertEquals(result.manifest.callsites.length, 3);
  assertEquals(result.manifest.callsites.map((c) => c.displayName), [
    "ctx.waitSec",
    "helper",
    "helper",
  ]);
  assertStringIncludes(
    result.transformedCode,
    '__tcvVisualizedAwait("module-test", "id_1", ctx.waitSec(0.20))',
  );
  assertStringIncludes(
    result.transformedCode,
    '__tcvVisualizedAwait("module-test", "id_2", helper(ctx))',
  );
});

Deno.test("analyzer instruments local arrow helpers with TimeContext parameters", () => {
  const result = analyze(`
import type { TimeContext } from "@avtools/core-timing";

const helper = async (ctx: TimeContext) => {
  await ctx.waitSec(0.20);
};

export default async function(ctx: TimeContext) {
  await helper(ctx);
}
`);

  assertEquals(result.type, "analyzeSuccess");
  if (result.type !== "analyzeSuccess") return;

  assertEquals(result.manifest.callsites.length, 2);
  assertEquals(result.manifest.callsites.map((c) => c.displayName), [
    "ctx.waitSec",
    "helper",
  ]);
});

Deno.test("analyzer walks inline branch callback bodies", () => {
  const result = analyze(`
import type { TimeContext } from "@avtools/core-timing";

export default async function(ctx: TimeContext) {
  ctx.branch(async (branchCtx) => {
    await branchCtx.waitSec(0.30);
  });

  await ctx.waitSec(0.10);
}
`);

  assertEquals(result.type, "analyzeSuccess");
  if (result.type !== "analyzeSuccess") return;

  assertEquals(result.manifest.callsites.length, 2);
  assertEquals(result.manifest.callsites.map((c) => c.displayName), [
    "branchCtx.waitSec",
    "ctx.waitSec",
  ]);
  assertStringIncludes(
    result.transformedCode,
    '__tcvVisualizedAwait("module-test", "id_1", branchCtx.waitSec(0.30))',
  );
});

Deno.test("analyzer rejects unsupported arbitrary await", () => {
  const result = analyze(`
import type { TimeContext } from "@avtools/core-timing";

export default async function(ctx: TimeContext) {
  await fetch("https://example.com");
  await ctx.waitSec(0.10);
}
`);

  assertEquals(result.type, "analyzeFailure");
  if (result.type !== "analyzeFailure") return;
  assertEquals(result.diagnostics[0].code, "TCV_UNSUPPORTED_AWAIT");
});

Deno.test("analyzer rejects split promise timed helper", () => {
  const result = analyze(`
import type { TimeContext } from "@avtools/core-timing";

async function helper(ctx: TimeContext) {
  await ctx.waitSec(0.10);
}

export default async function(ctx: TimeContext) {
  const p = helper(ctx);
  await p;
}
`);

  assertEquals(result.type, "analyzeFailure");
  if (result.type !== "analyzeFailure") return;
  assertEquals(
    result.diagnostics.some((d) => d.code === "TCV_UNAWAITED_TIMED_CALL"),
    true,
  );
});

Deno.test("analyzer rejects dynamic context method access", () => {
  const result = analyze(`
import type { TimeContext } from "@avtools/core-timing";

export default async function(ctx: TimeContext) {
  const method = "waitSec";
  await ctx[method](0.10);
}
`);

  assertEquals(result.type, "analyzeFailure");
  if (result.type !== "analyzeFailure") return;
  assertEquals(result.diagnostics[0].code, "TCV_DYNAMIC_TIME_CONTEXT_CALL");
});
