// Builds the standalone browser-engine slice: the shared host assets plus one
// analyzer-transformed fixture module, for the no-server E2E
// (livecode/tests/browser_engine_slice.e2e.mjs).
//
// Usage: deno run --allow-all build_slice.ts --out <dir> [--module <path>]

import { ts } from "npm:ts-morph@23.0.0";
import { dirname, fromFileUrl, join } from "jsr:@std/path@1";
import { analyzeAndTransformTimedModule } from "../visualizer/analyze_transform.ts";
import { buildBrowserHostAssets } from "./build_host_assets.ts";

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

await buildBrowserHostAssets({ outDir });

// Analyzer transform with the browser runtime import — the same transform the
// server runs; only the runtime specifier differs — then type stripping via
// ts-morph's own TypeScript. Bare helper specifiers survive and resolve
// through the page's import map.
const sourceText = await Deno.readTextFile(modulePath);
const analysis = analyzeAndTransformTimedModule({
  moduleId,
  sourceVersion: 1,
  sourceUri: `file://${modulePath}`,
  sourceText,
  runtimeImport: "./runtime.js",
  requireDefaultTimedRoot: true,
});
if (analysis.type !== "analyzeSuccess" || !analysis.transformedCode) {
  console.error(JSON.stringify(analysis, null, 2));
  throw new Error("slice module failed analysis");
}
const transpiled = ts.transpileModule(analysis.transformedCode, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    useDefineForClassFields: true,
  },
});
await Deno.writeTextFile(join(outDir, "module.js"), transpiled.outputText);

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
