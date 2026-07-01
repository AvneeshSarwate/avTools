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

Deno.test("analyzer instruments piano roll lookup calls with static name", () => {
  const result = analyze(`
import type { TimeContext } from "@avtools/core-timing";
import { getPianoRollClip, setPianoRollClip } from "piano-roll-helpers";

export default async function(ctx: TimeContext) {
  const clip = getPianoRollClip("melody");
  setPianoRollClip("bass", clip);
  await ctx.waitSec(0.05);
}
`);

  assertEquals(result.type, "analyzeSuccess");
  if (result.type !== "analyzeSuccess") return;

  const pianoRollCallsites = result.manifest.callsites.filter((c) =>
    c.kind === "pianoRollLookup"
  );
  assertEquals(pianoRollCallsites.length, 2);
  assertEquals(pianoRollCallsites.map((c) => c.id), ["id_1", "id_2"]);
  assertEquals(pianoRollCallsites.map((c) => c.displayName), [
    "getPianoRollClip",
    "setPianoRollClip",
  ]);
  assertEquals(pianoRollCallsites.map((c) => c.staticName), [
    "melody",
    "bass",
  ]);
  for (const entry of pianoRollCallsites) {
    assert(entry.nameArgRange, "nameArgRange should be present");
    assert(
      entry.nameArgRange.from < entry.nameArgRange.to,
      "nameArgRange should be ordered",
    );
  }
  assertStringIncludes(
    result.transformedCode,
    'getPianoRollClip(__tcvPianoRollLookup("module-test", "id_1", "melody"))',
  );
  assertStringIncludes(
    result.transformedCode,
    'setPianoRollClip(__tcvPianoRollLookup("module-test", "id_2", "bass"), clip)',
  );
  assertStringIncludes(
    result.transformedCode,
    "visualizedPianoRollLookup as __tcvPianoRollLookup",
  );
});

Deno.test("analyzer instruments piano roll lookup with identifier name arg", () => {
  const result = analyze(`
import type { TimeContext } from "@avtools/core-timing";
import { getPianoRollClip } from "piano-roll-helpers";

export default async function(ctx: TimeContext) {
  const name = "melody";
  const clip = getPianoRollClip(name);
  await ctx.waitSec(0.05);
}
`);

  assertEquals(result.type, "analyzeSuccess");
  if (result.type !== "analyzeSuccess") return;

  const entry = result.manifest.callsites.find((c) =>
    c.kind === "pianoRollLookup"
  );
  assert(entry, "expected a pianoRollLookup callsite");
  if (!entry) return;
  // No static name is available for an identifier argument.
  assertEquals(entry.staticName, undefined);
  assertStringIncludes(
    result.transformedCode,
    'getPianoRollClip(__tcvPianoRollLookup("module-test", "id_1", name))',
  );
});

Deno.test("analyzer instruments aliased piano roll helper imports", () => {
  const result = analyze(`
import type { TimeContext } from "@avtools/core-timing";
import { getPianoRollClip as getClip } from "piano-roll-helpers";

export default async function(ctx: TimeContext) {
  const clip = getClip("melody");
  await ctx.waitSec(0.05);
}
`);

  assertEquals(result.type, "analyzeSuccess");
  if (result.type !== "analyzeSuccess") return;
  const pianoRollCallsites = result.manifest.callsites.filter((c) =>
    c.kind === "pianoRollLookup"
  );
  assertEquals(pianoRollCallsites.length, 1);
  assertEquals(pianoRollCallsites[0].displayName, "getClip");
  assertEquals(pianoRollCallsites[0].staticName, "melody");
  assertStringIncludes(
    result.transformedCode,
    'getClip(__tcvPianoRollLookup("module-test", "id_1", "melody"))',
  );
});

Deno.test("analyzer ignores locally shadowed piano roll helper imports", () => {
  const result = analyze(`
import type { TimeContext } from "@avtools/core-timing";
import { getPianoRollClip } from "piano-roll-helpers";

export default async function(ctx: TimeContext) {
  const getPianoRollClip = (name: string) => name;
  const clip = getPianoRollClip("not-store");
  await ctx.waitSec(0.05);
}
`);

  assertEquals(result.type, "analyzeSuccess");
  if (result.type !== "analyzeSuccess") return;
  assertEquals(
    result.manifest.callsites.filter((c) => c.kind === "pianoRollLookup")
      .length,
    0,
  );
  assertStringIncludes(
    result.transformedCode,
    'const clip = getPianoRollClip("not-store")',
  );
});

Deno.test("analyzer instruments piano roll store alias and namespace imports", () => {
  const result = analyze(`
import type { TimeContext } from "@avtools/core-timing";
import { getPianoRoll as getRoll } from "piano-roll-store";
import * as rollStore from "piano-roll-store";

export default async function(ctx: TimeContext) {
  const melody = getRoll("melody");
  rollStore.setPianoRoll("bass", melody!.data);
  await ctx.waitSec(0.05);
}
`);

  assertEquals(result.type, "analyzeSuccess");
  if (result.type !== "analyzeSuccess") return;
  const pianoRollCallsites = result.manifest.callsites.filter((c) =>
    c.kind === "pianoRollLookup"
  );
  assertEquals(pianoRollCallsites.length, 2);
  assertEquals(pianoRollCallsites.map((c) => c.displayName), [
    "getRoll",
    "rollStore.setPianoRoll",
  ]);
  assertEquals(pianoRollCallsites.map((c) => c.staticName), [
    "melody",
    "bass",
  ]);
  assertStringIncludes(
    result.transformedCode,
    'getRoll(__tcvPianoRollLookup("module-test", "id_1", "melody"))',
  );
  assertStringIncludes(
    result.transformedCode,
    'rollStore.setPianoRoll(__tcvPianoRollLookup("module-test", "id_2", "bass"), melody!.data)',
  );
});

Deno.test("analyzer instruments piano roll lookups nested inside awaited calls", () => {
  const result = analyze(`
import type { TimeContext } from "@avtools/core-timing";
import { getPianoRollClip, playPianoRoll } from "piano-roll-helpers";

export default async function(ctx: TimeContext) {
  await playPianoRoll(ctx, getPianoRollClip("melody"));
}
`);

  assertEquals(result.type, "analyzeSuccess");
  if (result.type !== "analyzeSuccess") return;
  assertEquals(result.manifest.callsites.map((c) => c.kind), [
    "timeContextArgumentCall",
    "pianoRollLookup",
  ]);
  assertEquals(result.manifest.callsites.map((c) => c.displayName), [
    "playPianoRoll",
    "getPianoRollClip",
  ]);
  assertStringIncludes(
    result.transformedCode,
    '__tcvVisualizedAwait("module-test", "id_1", playPianoRoll(ctx, getPianoRollClip(__tcvPianoRollLookup("module-test", "id_2", "melody"))))',
  );
});

Deno.test("analyzer ignores same-named helpers from unrelated imports", () => {
  const result = analyze(`
import type { TimeContext } from "@avtools/core-timing";
import { getPianoRollClip } from "other-module";

export default async function(ctx: TimeContext) {
  const clip = getPianoRollClip("melody");
  await ctx.waitSec(0.05);
}
`);

  assertEquals(result.type, "analyzeSuccess");
  if (result.type !== "analyzeSuccess") return;
  assertEquals(
    result.manifest.callsites.filter((c) => c.kind === "pianoRollLookup")
      .length,
    0,
  );
  assertStringIncludes(
    result.transformedCode,
    '__tcvVisualizedAwait("module-test", "id_1", ctx.waitSec(0.05))',
  );
});
