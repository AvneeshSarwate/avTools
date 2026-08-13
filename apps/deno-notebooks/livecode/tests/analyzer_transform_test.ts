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

Deno.test("analyzer flags default export name colliding with an import binding", () => {
  const result = analyze(`
import { loop } from "@avtools/core-timing";
import type { TimeContext } from "@avtools/core-timing";

export default async function loop(ctx: TimeContext) {
  await ctx.waitSec(0.10);
  await loop(ctx);
}
`);

  assertEquals(result.type, "analyzeFailure");
  if (result.type !== "analyzeFailure") return;
  assertEquals(
    result.diagnostics[0].code,
    "TCV_DEFAULT_EXPORT_RENAME_COLLISION",
  );
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

Deno.test("analyzer reports syntax errors with source ranges", () => {
  const source =
    `export default async function f(ctx: TimeContext) { await ctx.waitSec(0.1);`;
  const result = analyze(source);

  assertEquals(result.type, "analyzeFailure");
  if (result.type !== "analyzeFailure") return;
  assertEquals(result.diagnostics[0].code, "TCV_SYNTAX_ERROR");
  assert(
    result.diagnostics[0].from >= source.length - 2,
    `expected syntax diagnostic near end, got ${result.diagnostics[0].from}`,
  );
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

Deno.test("analyzer records top-level canvasParams declarations without editing them", () => {
  const result = analyze(`
import type { TimeContext } from "@avtools/core-timing";
import { canvasParams } from "canvas-params";

export const params = canvasParams("kinaree/rects", {
  launchRate: 10.5,
  strobe: { rate: 0 },
});

export default async function(_ctx: TimeContext) {}
`);

  assertEquals(result.type, "analyzeSuccess");
  if (result.type !== "analyzeSuccess") return;

  assertEquals(result.manifest.callsites.length, 1);
  const entry = result.manifest.callsites[0];
  assertEquals(entry.kind, "canvasParams");
  assertEquals(entry.displayName, "canvasParams");
  assertEquals(entry.staticName, "kinaree/rects");
  assert(entry.nameArgRange, "nameArgRange should be present");
  if (!entry.nameArgRange) return;
  assert(
    entry.nameArgRange.from < entry.nameArgRange.to,
    "nameArgRange should be ordered",
  );

  // No-edit path: the call is recorded, never wrapped, and a module whose only
  // callsite is an observation imports no runtime helpers.
  assertStringIncludes(
    result.transformedCode,
    'export const params = canvasParams("kinaree/rects", {',
  );
  assert(
    !result.transformedCode.includes("__tcv"),
    "canvasParams callsites must not be instrumented",
  );
  assert(
    !result.transformedCode.includes("timeContextVisualizerRuntime.ts"),
    "an observation-only module must not import the runtime helpers",
  );
});

Deno.test("analyzer records canvasParams declared inside a TimeContext scope", () => {
  const result = analyze(`
import type { TimeContext } from "@avtools/core-timing";
import { canvasParams } from "canvas-params";

export default async function(ctx: TimeContext) {
  const params = canvasParams("scoped/params", { gain: 0.5 });
  await ctx.waitSec(params.gain);
}
`);

  assertEquals(result.type, "analyzeSuccess");
  if (result.type !== "analyzeSuccess") return;

  assertEquals(result.manifest.callsites.map((c) => c.kind), [
    "canvasParams",
    "timeContextMethod",
  ]);
  assertEquals(result.manifest.callsites.map((c) => c.staticName), [
    "scoped/params",
    undefined,
  ]);
  assertStringIncludes(
    result.transformedCode,
    'const params = canvasParams("scoped/params", { gain: 0.5 })',
  );
  // The wait in the same module is still wrapped, and the wrapped callsite is
  // what pulls in the runtime import.
  assertStringIncludes(
    result.transformedCode,
    '__tcvVisualizedAwait("module-test", "id_2", ctx.waitSec(params.gain))',
  );
  assertStringIncludes(
    result.transformedCode,
    "visualizedAwait as __tcvVisualizedAwait",
  );
});

Deno.test("analyzer ignores locally shadowed canvasParams imports", () => {
  const result = analyze(`
import type { TimeContext } from "@avtools/core-timing";
import { canvasParams } from "canvas-params";

export default async function(ctx: TimeContext) {
  const canvasParams = (name: string) => ({ name });
  const params = canvasParams("not-a-declaration");
  await ctx.waitSec(0.05);
}
`);

  assertEquals(result.type, "analyzeSuccess");
  if (result.type !== "analyzeSuccess") return;
  assertEquals(
    result.manifest.callsites.filter((c) => c.kind === "canvasParams").length,
    0,
  );
  assertStringIncludes(
    result.transformedCode,
    'const params = canvasParams("not-a-declaration")',
  );
});

Deno.test("analyzer records a canvasParams declaration with a non-literal name", () => {
  const result = analyze(`
import type { TimeContext } from "@avtools/core-timing";
import { canvasParams } from "canvas-params";

const name = "dynamic/params";
export const params = canvasParams(name, { gain: 0.5 });

export default async function(_ctx: TimeContext) {}
`);

  assertEquals(result.type, "analyzeSuccess");
  if (result.type !== "analyzeSuccess") return;

  const entry = result.manifest.callsites.find((c) =>
    c.kind === "canvasParams"
  );
  assert(entry, "expected a canvasParams callsite");
  if (!entry) return;
  // There is no runtime name resolution for params, so a non-literal name has
  // no static name and the editor renders no widget for it.
  assertEquals(entry.staticName, undefined);
  assert(entry.nameArgRange, "nameArgRange should still be present");
});

Deno.test("analyzer wraps a top-level signal declaration and emits the runtime import", () => {
  const result = analyze(`
import type { TimeContext } from "@avtools/core-timing";
import { signal } from "canvas-signals";

export const playhead = signal("kinaree/playhead", {
  anchor: { type: "pianoRoll", name: "melody" },
});

export default async function(_ctx: TimeContext) {}
`);

  assertEquals(result.type, "analyzeSuccess");
  if (result.type !== "analyzeSuccess") return;

  assertEquals(result.manifest.callsites.length, 1);
  const entry = result.manifest.callsites[0];
  assertEquals(entry.kind, "canvasSignal");
  assertEquals(entry.displayName, "signal");
  assertEquals(entry.staticName, "kinaree/playhead");
  assert(entry.nameArgRange, "nameArgRange should be present");
  if (!entry.nameArgRange) return;
  assert(
    entry.nameArgRange.from < entry.nameArgRange.to,
    "nameArgRange should be ordered",
  );

  // The whole call is wrapped, and the returned handle passes through
  // untouched, so the declaration keeps its exact meaning.
  assertStringIncludes(
    result.transformedCode,
    'export const playhead = __tcvOwnedSignal("module-test", "id_1", signal("kinaree/playhead", {\n  anchor: { type: "pianoRoll", name: "melody" },\n}))',
  );
  // A signal-bearing module must import the wrapper, or the generated code
  // would ReferenceError at launch.
  assertStringIncludes(
    result.transformedCode,
    "visualizedOwnedSignal as __tcvOwnedSignal",
  );
  assertStringIncludes(
    result.transformedCode,
    'from "./timeContextVisualizerRuntime.ts"',
  );
});

Deno.test("analyzer wraps signals declared inside a timed body and imports every alias", () => {
  const result = analyze(`
import type { TimeContext } from "@avtools/core-timing";
import { signal } from "canvas-signals";
import { getPianoRollClip } from "piano-roll-helpers";

export default async function(ctx: TimeContext) {
  const clip = getPianoRollClip("melody");
  for (const _note of clip) {
    const step = signal("kinaree/step");
    step.set(1);
    await ctx.waitSec(0.1);
  }
}
`);

  assertEquals(result.type, "analyzeSuccess");
  if (result.type !== "analyzeSuccess") return;

  assertEquals(result.manifest.callsites.map((c) => c.kind), [
    "pianoRollLookup",
    "canvasSignal",
    "timeContextMethod",
  ]);
  assertStringIncludes(
    result.transformedCode,
    'const step = __tcvOwnedSignal("module-test", "id_2", signal("kinaree/step"))',
  );
  assertStringIncludes(
    result.transformedCode,
    '__tcvVisualizedAwait("module-test", "id_3", ctx.waitSec(0.1))',
  );
  // One import line binds all three wrappers, so any wrapped callsite makes
  // every alias resolvable.
  assertStringIncludes(
    result.transformedCode,
    'import { visualizedAwait as __tcvVisualizedAwait, visualizedPianoRollLookup as __tcvPianoRollLookup, visualizedOwnedSignal as __tcvOwnedSignal } from "./timeContextVisualizerRuntime.ts";',
  );
});

Deno.test("analyzer ignores locally shadowed signal imports", () => {
  const result = analyze(`
import type { TimeContext } from "@avtools/core-timing";
import { signal } from "canvas-signals";

export default async function(ctx: TimeContext) {
  const signal = (name: string) => ({ name });
  const local = signal("not-a-declaration");
  await ctx.waitSec(0.05);
}
`);

  assertEquals(result.type, "analyzeSuccess");
  if (result.type !== "analyzeSuccess") return;
  assertEquals(
    result.manifest.callsites.filter((c) => c.kind === "canvasSignal").length,
    0,
  );
  assertStringIncludes(
    result.transformedCode,
    'const local = signal("not-a-declaration")',
  );
});

Deno.test("analyzer wraps a signal declaration with a non-literal name", () => {
  const result = analyze(`
import type { TimeContext } from "@avtools/core-timing";
import { signal } from "canvas-signals";

const name = "dynamic/signal";
export const handle = signal(name);

export default async function(_ctx: TimeContext) {}
`);

  assertEquals(result.type, "analyzeSuccess");
  if (result.type !== "analyzeSuccess") return;

  const entry = result.manifest.callsites.find((c) =>
    c.kind === "canvasSignal"
  );
  assert(entry, "expected a canvasSignal callsite");
  if (!entry) return;
  // Ownership is resolved at runtime from the handle, so a computed name is
  // wrapped exactly the same; only the editor affordance needs a static name.
  assertEquals(entry.staticName, undefined);
  assert(entry.nameArgRange, "nameArgRange should still be present");
  assertStringIncludes(
    result.transformedCode,
    'export const handle = __tcvOwnedSignal("module-test", "id_1", signal(name))',
  );
});

Deno.test("analyzer leaves canvasParams untouched in a module that also declares signals", () => {
  const result = analyze(`
import type { TimeContext } from "@avtools/core-timing";
import { canvasParams } from "canvas-params";
import { signal } from "canvas-signals";

export const params = canvasParams("both/params", { gain: 0.5 });
export const playhead = signal("both/playhead");

export default async function(_ctx: TimeContext) {}
`);

  assertEquals(result.type, "analyzeSuccess");
  if (result.type !== "analyzeSuccess") return;

  assertEquals(result.manifest.callsites.map((c) => c.kind), [
    "canvasParams",
    "canvasSignal",
  ]);
  assertStringIncludes(
    result.transformedCode,
    'export const params = canvasParams("both/params", { gain: 0.5 })',
  );
  assertStringIncludes(
    result.transformedCode,
    'export const playhead = __tcvOwnedSignal("module-test", "id_2", signal("both/playhead"))',
  );
});
