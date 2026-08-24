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

const HERE = dirname(fromFileUrl(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");

/** Alias entries served next to the page; the import map points bare
 * specifiers user modules keep after transform at these bundles. */
const ALIAS_ENTRIES: Record<string, string> = {
  "canvas_signals": 'export { signal } from "canvas-signals";\n',
  "canvas_params": 'export { canvasParams } from "canvas-params";\n',
  "animation_timeline": 'export * from "animation-timeline";\n',
  "piano_roll_helpers": 'export * from "piano-roll-helpers";\n',
  "piano_roll_store": 'export * from "piano-roll-store";\n',
  "midi_helpers": 'export * from "midi-helpers";\n',
  "runtime":
    'export {\n  visualizedAwait,\n  visualizedOwnedSignal,\n  visualizedPianoRollLookup,\n} from "@avtools/livecode-engine/runtime.ts";\n',
};

const IMPORT_MAP_HTML = `<script type="importmap">
{
  "imports": {
    "canvas-signals": "./canvas_signals.js",
    "canvas-params": "./canvas_params.js",
    "animation-timeline": "./animation_timeline.js",
    "piano-roll-helpers": "./piano_roll_helpers.js",
    "piano-roll-store": "./piano_roll_store.js",
    "midi-helpers": "./midi_helpers.js"
  }
}
</script>`;

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
      { imports, nodeModulesDir: "manual", lock: false },
      null,
      2,
    ) + "\n",
  );
  return configPath;
}

export interface BuildBrowserHostAssetsOptions {
  outDir: string;
}

export async function buildBrowserHostAssets(
  options: BuildBrowserHostAssetsOptions,
): Promise<void> {
  const outDir = options.outDir;
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

  const bundle = new Deno.Command(Deno.execPath(), {
    args: [
      "bundle",
      "--platform",
      "browser",
      "--code-splitting",
      "--quiet",
      "--config",
      configPath,
      "--outdir",
      outDir,
      ...entryPaths,
    ],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  });
  const result = await bundle.output();
  if (result.code !== 0) {
    throw new Error(
      `deno bundle failed:\n${new TextDecoder().decode(result.stderr)}`,
    );
  }

  await Deno.writeTextFile(
    join(outDir, "engine.html"),
    `<!doctype html>
<meta charset="utf-8">
<title>livecode browser engine</title>
${IMPORT_MAP_HTML}
<script type="module" src="./engine_page.js"></script>
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
