import { assert, assertEquals } from "jsr:@std/assert@1";
import { fromFileUrl, isAbsolute, join, resolve } from "jsr:@std/path@1";

// The portable helper graph — everything a browser-target module may import
// through the livecode aliases — must typecheck under a browser lib, where the
// `Deno` global does not exist and DOM globals do. This is the executable form
// of the browser-engine plan's "browser-lib-clean" requirement: a bare `Deno.`
// reference anywhere in this graph fails here before it can fail a
// browser-target project's shadow check.

const REPO_ROOT = fromFileUrl(new URL("../../../..", import.meta.url));

const PORTABLE_ENTRYPOINTS = [
  "apps/deno-notebooks/livecode/helpers/canvas_params.ts",
  "apps/deno-notebooks/livecode/helpers/canvas_signals.ts",
  "apps/deno-notebooks/livecode/helpers/piano_roll_helpers.ts",
  "apps/deno-notebooks/livecode/helpers/midi_helpers.ts",
  "apps/deno-notebooks/livecode/visualizer/piano_roll_store.ts",
  // The generated-code runtime import target: every browser-built module
  // imports it, so it must be part of the browser-clean graph.
  "apps/deno-notebooks/livecode/visualizer/runtime.ts",
];

const BROWSER_LIB = ["esnext", "dom", "dom.iterable", "dom.asynciterable"];

async function writeBrowserCheckConfig(dir: string): Promise<string> {
  const rootConfig = JSON.parse(
    await Deno.readTextFile(join(REPO_ROOT, "deno.json")),
  ) as { imports?: Record<string, string> };
  const imports: Record<string, string> = {};
  for (const [key, value] of Object.entries(rootConfig.imports ?? {})) {
    imports[key] = value.startsWith("./") || value.startsWith("../")
      ? resolve(REPO_ROOT, value) + (value.endsWith("/") ? "/" : "")
      : value;
  }
  const configPath = join(dir, "deno.json");
  await Deno.writeTextFile(
    configPath,
    JSON.stringify(
      {
        compilerOptions: { lib: BROWSER_LIB },
        imports,
        // byonm: npm specifiers resolve from the repository's existing
        // node_modules (found by walking up from the checked files), so the
        // temp-dir config needs no install step of its own.
        nodeModulesDir: "manual",
        lock: false,
      },
      null,
      2,
    ) + "\n",
  );
  return configPath;
}

async function runDenoCheck(
  configPath: string,
  files: string[],
): Promise<{ code: number; output: string }> {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["check", "--config", configPath, ...files],
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "piped",
  });
  const result = await command.output();
  const decoder = new TextDecoder();
  return {
    code: result.code,
    output: decoder.decode(result.stdout) + decoder.decode(result.stderr),
  };
}

Deno.test("portable helper graph typechecks under a browser-target lib", async () => {
  const dir = await Deno.makeTempDir({ prefix: "browser-target-check-" });
  try {
    const configPath = await writeBrowserCheckConfig(dir);
    const files = PORTABLE_ENTRYPOINTS.map((entry) =>
      isAbsolute(entry) ? entry : join(REPO_ROOT, entry)
    );
    const { code, output } = await runDenoCheck(configPath, files);
    assertEquals(
      code,
      0,
      `browser-target deno check failed:\n${output}`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});

Deno.test("the browser-target config actually rejects Deno globals", async () => {
  const dir = await Deno.makeTempDir({ prefix: "browser-target-check-" });
  try {
    const configPath = await writeBrowserCheckConfig(dir);
    const probePath = join(dir, "uses_deno_global.ts");
    await Deno.writeTextFile(
      probePath,
      "export const cwd: string = Deno.cwd();\n",
    );
    const { code, output } = await runDenoCheck(configPath, [probePath]);
    assert(code !== 0, "expected the Deno-global probe to fail the check");
    assert(
      output.includes("Cannot find name 'Deno'"),
      `expected a missing-Deno diagnostic, got:\n${output}`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});

// Keep the helper honest: the config writer must absolutize relative imports,
// or the temp-dir config would silently resolve aliases against the wrong root.
Deno.test("browser check config absolutizes relative import-map entries", async () => {
  const dir = await Deno.makeTempDir({ prefix: "browser-target-check-" });
  try {
    const configPath = await writeBrowserCheckConfig(dir);
    const config = JSON.parse(await Deno.readTextFile(configPath)) as {
      imports: Record<string, string>;
    };
    const pianoRollStore = config.imports["piano-roll-store"];
    assert(pianoRollStore !== undefined, "piano-roll-store alias missing");
    assert(isAbsolute(pianoRollStore), "alias was not absolutized");
    const trailing = Object.entries(config.imports).filter(([, value]) =>
      value.startsWith("/")
    );
    assert(trailing.length > 0);
    // A directory mapping must keep its trailing slash to stay a valid prefix
    // mapping after absolutization.
    for (const [key, value] of Object.entries(config.imports)) {
      if (key.endsWith("/") && isAbsolute(value)) {
        assert(
          value.endsWith("/"),
          `directory mapping ${key} lost its trailing slash: ${value}`,
        );
      }
    }
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});
