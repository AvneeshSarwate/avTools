// Builds the browser engine host's static asset tree — the pieces a server in
// remote engine mode (or the standalone slice) serves at `/engine/`:
//
//   engine_page.js            the engine host page bundle
//   runtime.js                the generated-code instrumentation helpers
//   canvas_signals.js ...     one bundle per module-facing helper alias
//   engine.html / ui.html     the engine tab and a blank same-origin observer
//
// Everything is bundled in ONE `deno bundle --code-splitting` invocation with
// multiple entry points, so the stores/runtime singletons land in shared
// chunks and every entry (the page, the runtime import, each alias) sees the
// same module instances — the property the observation contract depends on.
//
// The bundle resolves through a generated config: the root import map
// absolutized, plus `@avtools/midi` overridden to the browser backend so the
// FFI graph (hidden behind a variable-specifier dynamic import at runtime)
// never has to resolve at bundle time.

import { dirname, fromFileUrl, join, resolve } from "jsr:@std/path@1";
import {
  type CacheInputs,
  captureInputs,
  publishAssetCache,
  restoreAssetCache,
} from "./asset_cache.ts";

const HERE = dirname(fromFileUrl(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");

/** Alias entries served next to the page; the import map points bare
 * specifiers user modules keep after transform at these bundles. */
const ALIAS_ENTRIES: Record<string, string> = {
  "canvas_signals": 'export { signal } from "canvas-signals";\n',
  "canvas_params": 'export { canvasParams } from "canvas-params";\n',
  "animation_timeline": 'export * from "animation-timeline";\n',
  "canvas_drawing": 'export * from "canvas-drawing";\n',
  "canvas_surface": 'export * from "canvas-surface";\n',
  // The timing library itself, for value imports (barriers, launch helpers,
  // TempoMap): its module state (barrier registry, scheduler classes) is in
  // the shared chunk the engine uses, so a module's barrier and the engine's
  // root context see one registry.
  "core_timing": 'export * from "@avtools/core-timing";\n',
  "piano_roll_helpers": 'export * from "piano-roll-helpers";\n',
  "piano_roll_store": 'export * from "piano-roll-store";\n',
  "midi_helpers": 'export * from "midi-helpers";\n',
  "six_sines": 'export * from "@avtools/six-sines";\n',
  // Graphics libraries user modules may import when the engine runs in a
  // browser tab (versions pinned by the root import map). Re-exported through
  // repo-resident vendor shims so the npm specifiers resolve from inside the
  // repo (entry stubs live in the out dir, which has no node_modules above
  // it).
  "three": `export * from "${join(HERE, "vendor", "three.ts")}";\n`,
  "p5": `export { default } from "${join(HERE, "vendor", "p5.ts")}";\n`,
  "runtime":
    'export {\n  visualizedAwait,\n  visualizedOwnedSignal,\n  visualizedPianoRollLookup,\n} from "@avtools/livecode-engine/runtime.ts";\n',
  // The reusable engine host, for a UI page that runs the engine in its own
  // tab (`?engine=inprocess`). Bundled in the same code-splitting invocation
  // as the page and the aliases, so an in-process engine and the modules it
  // launches share one set of store singletons.
  "engine_host": `export * from "${join(HERE, "browser_engine_host.ts")}";\n`,
};

/**
 * Bare specifiers user modules keep after the analyzer transform, mapped to
 * the bundles above. Both engine.html (prefix `./`) and the tldraw client's
 * index.html (prefix `./engine/`, for the in-process topology) declare this
 * map; `browser_host_import_map_test.ts` keeps the two copies in agreement.
 */
export const MODULE_IMPORT_MAP: Readonly<Record<string, string>> = {
  "canvas-signals": "canvas_signals.js",
  "canvas-params": "canvas_params.js",
  "animation-timeline": "animation_timeline.js",
  "canvas-drawing": "canvas_drawing.js",
  "canvas-surface": "canvas_surface.js",
  "@avtools/core-timing": "core_timing.js",
  "piano-roll-helpers": "piano_roll_helpers.js",
  "piano-roll-store": "piano_roll_store.js",
  "midi-helpers": "midi_helpers.js",
  "@avtools/six-sines": "six_sines.js",
  "three": "three.js",
  "p5": "p5.js",
};

export function moduleImportMapHtml(prefix: string): string {
  const imports = Object.fromEntries(
    Object.entries(MODULE_IMPORT_MAP).map(([specifier, file]) => [
      specifier,
      `${prefix}${file}`,
    ]),
  );
  return `<script type="importmap">\n${
    JSON.stringify({ imports }, null, 2)
  }\n</script>`;
}

const IMPORT_MAP_HTML = moduleImportMapHtml("./");

// The public node module is bundled above as `six_sines.js`. It resolves the
// worklet and Wasm relative to its own import.meta.url, and the worklet in turn
// imports the Emscripten glue beside itself, so these filenames are part of the
// runtime contract and must remain adjacent in the host asset tree.
const SIX_SINES_RUNTIME_FILES = [
  "six-sines-worklet.js",
  "six-sines.js",
  "six-sines.wasm",
  "six-sines-build.json",
] as const;

async function writeBundleConfig(): Promise<string> {
  const rootConfig = JSON.parse(
    await Deno.readTextFile(join(REPO_ROOT, "deno.json")),
  ) as { imports?: Record<string, string> };
  const imports: Record<string, string> = {};
  for (const [key, value] of Object.entries(rootConfig.imports ?? {})) {
    imports[key] = value.startsWith("./") || value.startsWith("../")
      ? resolve(REPO_ROOT, value) + (value.endsWith("/") ? "/" : "")
      : value;
  }
  // The browser bundle must never see the FFI backend.
  imports["@avtools/midi"] = join(REPO_ROOT, "packages/midi/browser.ts");
  // OS temp, never inside the repo: `deno bundle` (2.8.x) rejects a --config
  // that sits physically inside a workspace tree without being a member, so a
  // config in the server's repo-local session dir fails where one in /tmp
  // works. All paths in the config are absolute, so location is meaningless.
  const configPath = join(
    await Deno.makeTempDir({ prefix: "livecode-bundle-config-" }),
    "deno.json",
  );
  await Deno.writeTextFile(
    configPath,
    JSON.stringify(
      // "auto" (deno-managed node_modules for this config) rather than
      // "manual" (byonm): the repo's top-level node_modules can only hold one
      // version per package, and browser-projections pins p5@^1 while the
      // livecode graph wants p5@^2 — byonm cannot serve both.
      { imports, nodeModulesDir: "auto", lock: false },
      null,
      2,
    ) + "\n",
  );
  return configPath;
}

async function runDenoBundle(label: string, args: string[]): Promise<void> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["bundle", "--platform", "browser", "--quiet", ...args],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  });
  const result = await command.output();
  if (result.code !== 0) {
    throw new Error(
      `deno bundle (${label}) failed:\n${
        new TextDecoder().decode(result.stderr)
      }`,
    );
  }
}

export interface BuildBrowserHostAssetsOptions {
  outDir: string;
}

export async function buildBrowserHostAssets(
  options: BuildBrowserHostAssetsOptions,
): Promise<void> {
  const outDir = options.outDir;
  const bakedCache = Deno.env.get("LIVECODE_BROWSER_HOST_BAKED_CACHE");
  const writableCache = Deno.env.get("LIVECODE_BROWSER_HOST_CACHE");
  for (const cache of [writableCache, bakedCache]) {
    if (cache && await restoreAssetCache(REPO_ROOT, cache, outDir)) return;
  }
  const entriesDir = join(outDir, "entries");
  await Deno.mkdir(entriesDir, { recursive: true });

  const configPath = await writeBundleConfig();
  const entryPaths: string[] = [];
  for (const [name, source] of Object.entries(ALIAS_ENTRIES)) {
    const entryPath = join(entriesDir, `${name}.ts`);
    await Deno.writeTextFile(entryPath, source);
    entryPaths.push(entryPath);
  }
  const enginePageEntry = join(entriesDir, "engine_page.ts");
  await Deno.writeTextFile(
    enginePageEntry,
    `import "${join(HERE, "engine_page.ts")}";\n`,
  );
  entryPaths.push(enginePageEntry);

  let cacheInputs: CacheInputs | undefined;
  if (writableCache) {
    try {
      // Ask Deno for the resolved graph, rather than guessing which framework
      // folders the bundle imports. This runs only on cache misses/builds.
      const graphEntry = join(entriesDir, "cache_graph.ts");
      await Deno.writeTextFile(
        graphEntry,
        [...entryPaths, join(REPO_ROOT, "packages/midi/browser.ts")]
          .map((path) => `import ${JSON.stringify(path)};`).join("\n"),
      );
      const graphResult = await new Deno.Command(Deno.execPath(), {
        args: ["info", "--json", "--config", configPath, graphEntry],
        cwd: REPO_ROOT,
        stdout: "piped",
        stderr: "piped",
      }).output();
      if (!graphResult.success) {
        throw new Error(new TextDecoder().decode(graphResult.stderr));
      }
      const graph = JSON.parse(new TextDecoder().decode(graphResult.stdout));
      const paths = [
        join(REPO_ROOT, "deno.json"),
        join(REPO_ROOT, "deno.lock"),
        join(HERE, "build_host_assets.ts"),
        join(HERE, "asset_cache.ts"),
        ...SIX_SINES_RUNTIME_FILES.map((name) =>
          join(REPO_ROOT, "packages/six-sines", name)
        ),
      ];
      for (const module of graph.modules) {
        if (module.error) throw new Error(module.error);
        if (module.specifier.startsWith("file:")) {
          const path = fromFileUrl(module.specifier);
          if (!path.startsWith(entriesDir + "/")) paths.push(path);
        }
      }
      cacheInputs = await captureInputs(REPO_ROOT, paths);
    } catch (error) {
      // Caching must never prevent a normal build (e.g. an external local import).
      console.warn(`[livecode] asset dependency capture skipped: ${error}`);
    }
  }

  await runDenoBundle("host assets", [
    "--code-splitting",
    "--config",
    configPath,
    "--outdir",
    outDir,
    ...entryPaths,
  ]);

  // The midi package reaches its browser backend through a variable-specifier
  // dynamic import ("./browser.ts", resolved at runtime against the importing
  // chunk's URL) that no bundler can see, so the build above never includes
  // it. Emit it as its own bundle at exactly that URL — without this file,
  // browser-engine MIDI cannot initialize (the runtime import 404s).
  await runDenoBundle("midi browser backend", [
    "--config",
    configPath,
    "--output",
    join(outDir, "browser.ts"),
    join(REPO_ROOT, "packages/midi/browser.ts"),
  ]);

  await Promise.all(SIX_SINES_RUNTIME_FILES.map((name) =>
    Deno.copyFile(
      join(REPO_ROOT, "packages/six-sines", name),
      join(outDir, name),
    )
  ));

  await Deno.writeTextFile(
    join(outDir, "engine.html"),
    `<!doctype html>
<meta charset="utf-8">
<title>livecode browser engine</title>
${IMPORT_MAP_HTML}
<script type="module" src="./engine_page.js"></script>
<body>
<div class="livecode-engine-status">livecode browser engine host</div>
<div class="livecode-midi-status"></div>
<div id="livecode-stage"></div>
</body>
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
  if (writableCache && cacheInputs) {
    try {
      await publishAssetCache(REPO_ROOT, writableCache, outDir, cacheInputs);
    } catch (error) {
      console.warn(`[livecode] asset cache publication skipped: ${error}`);
    }
  }
}

if (import.meta.main) {
  const outIndex = Deno.args.indexOf("--out");
  const outDir = outIndex >= 0 ? Deno.args[outIndex + 1] : undefined;
  if (!outDir) {
    console.error("--out <dir> is required");
    Deno.exit(2);
  }
  await buildBrowserHostAssets({ outDir });
  console.log(JSON.stringify({ type: "browserHostAssetsBuilt", outDir }));
}
