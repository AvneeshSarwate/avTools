// Builds the browser-engine vertical slice's static asset tree:
//
//   engine-bundle.js   the engine host page bundle (deno bundle --platform browser)
//   runtime.js         re-export of the instrumentation helpers from the bundle
//   canvas_signals.js  re-export target for the `canvas-signals` import map entry
//   canvas_params.js   re-export target for the `canvas-params` import map entry
//   engine.html        the engine tab
//   ui.html            a blank same-origin page for observer tabs
//   module.js          the fixture module: analyzer-transformed with
//                      runtimeImport "./runtime.js", then type-stripped
//   slice.json         build metadata the E2E reads (moduleId, generatedRunId)
//
// This is the seed of the real coordination-server browser build step: the
// analyzer already takes `runtimeImport` as a parameter, and the transpile is
// ts-morph's own TypeScript `transpileModule` (type stripping only), so no new
// dependency is involved. A full project build additionally rewrites relative
// `.ts` imports to `.js`; the slice's fixture has none.
//
// Usage: deno run --allow-all build_slice.ts --out <dir> [--module <path>]

import { ts } from "npm:ts-morph@23.0.0";
import { dirname, fromFileUrl, join } from "jsr:@std/path@1";
import { analyzeAndTransformTimedModule } from "../visualizer/analyze_transform.ts";

const HERE = dirname(fromFileUrl(import.meta.url));

function argValue(name: string): string | undefined {
  const index = Deno.args.indexOf(`--${name}`);
  return index >= 0 ? Deno.args[index + 1] : undefined;
}

const outDir = argValue("out");
if (!outDir) {
  console.error("--out <dir> is required");
  Deno.exit(2);
}
const modulePath = argValue("module") ??
  join(HERE, "fixtures", "slice_module.ts");
const moduleId = argValue("module-id") ?? "browser-slice/module";

await Deno.mkdir(outDir, { recursive: true });

// 1) Analyzer transform with the browser runtime import. Same transform the
// server runs; only the runtime specifier differs.
const sourceText = await Deno.readTextFile(modulePath);
const analysis = analyzeAndTransformTimedModule({
  moduleId,
  sourceUri: `file://${modulePath}`,
  sourceText,
  runtimeImport: "./runtime.js",
  requireDefaultTimedRoot: true,
});
if (analysis.type !== "analyzeSuccess" || !analysis.transformedCode) {
  console.error(JSON.stringify(analysis, null, 2));
  throw new Error("slice module failed analysis");
}

// 2) Type-strip the transformed module for the browser. Bare specifiers
// (canvas-signals) survive and are resolved by the page's import map;
// type-only imports are elided with the types.
const transpiled = ts.transpileModule(analysis.transformedCode, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    useDefineForClassFields: true,
  },
});
await Deno.writeTextFile(join(outDir, "module.js"), transpiled.outputText);

// 3) Bundle the engine host page for the browser.
const bundle = new Deno.Command(Deno.execPath(), {
  args: [
    "bundle",
    "--platform",
    "browser",
    "--quiet",
    "-o",
    join(outDir, "engine-bundle.js"),
    join(HERE, "engine_page.ts"),
  ],
  stdout: "inherit",
  stderr: "inherit",
});
const bundleResult = await bundle.output();
if (bundleResult.code !== 0) throw new Error("deno bundle failed");

// 4) The two re-export stubs. Sharing the bundle's module instance is the
// whole point: generated code importing ./runtime.js must reach the same
// runtime singletons the engine's sync sources read.
await Deno.writeTextFile(
  join(outDir, "runtime.js"),
  `export { visualizedAwait, visualizedOwnedSignal, visualizedPianoRollLookup } from "./engine-bundle.js";\n`,
);
await Deno.writeTextFile(
  join(outDir, "canvas_signals.js"),
  `export { signal } from "./engine-bundle.js";\n`,
);
await Deno.writeTextFile(
  join(outDir, "canvas_params.js"),
  `export { canvasParams } from "./engine-bundle.js";\n`,
);

// 5) Pages. The import map covers the bare helper specifiers user modules may
// keep after transform; ./runtime.js needs no mapping.
await Deno.writeTextFile(
  join(outDir, "engine.html"),
  `<!doctype html>
<meta charset="utf-8">
<title>livecode browser engine</title>
<script type="importmap">
{
  "imports": {
    "canvas-signals": "./canvas_signals.js",
    "canvas-params": "./canvas_params.js"
  }
}
</script>
<script type="module" src="./engine-bundle.js"></script>
<body>livecode browser engine host</body>
`,
);
await Deno.writeTextFile(
  join(outDir, "ui.html"),
  `<!doctype html>
<meta charset="utf-8">
<title>livecode observer</title>
<body>livecode observer tab</body>
`,
);

const sliceMeta = {
  moduleId,
  generatedRunId: analysis.generatedRunId,
  callsiteCount: analysis.manifest.callsites.length,
};
await Deno.writeTextFile(
  join(outDir, "slice.json"),
  JSON.stringify(sliceMeta, null, 2) + "\n",
);
console.log(JSON.stringify({ type: "sliceBuilt", outDir, ...sliceMeta }));
