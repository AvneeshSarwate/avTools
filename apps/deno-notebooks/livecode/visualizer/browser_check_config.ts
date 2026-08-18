// The browser-target typecheck configuration: the repository import map,
// absolutized so it works from any config location, with `compilerOptions.lib`
// replaced by the browser lib set — under it, `Deno.*` is a type error and DOM
// globals are legal, which is the world a browser-engine project's modules
// actually execute in. Used by the project shadow check for browser-target
// projects and by `browser_target_check_test.ts`, which proves the mechanism
// (including that the config genuinely rejects Deno globals).

import { join, resolve } from "jsr:@std/path@1";

export const BROWSER_CHECK_LIB = [
  "esnext",
  "dom",
  "dom.iterable",
  "dom.asynciterable",
];

/**
 * Write a browser-lib deno config into `dir` and return its path. npm
 * specifiers resolve byonm from the repository's node_modules (found by
 * walking up from the checked files), so no install step is involved.
 */
export async function writeBrowserCheckConfig(
  repoRoot: string,
  dir: string,
): Promise<string> {
  const rootConfig = JSON.parse(
    await Deno.readTextFile(join(repoRoot, "deno.json")),
  ) as { imports?: Record<string, string> };
  const imports: Record<string, string> = {};
  for (const [key, value] of Object.entries(rootConfig.imports ?? {})) {
    imports[key] = value.startsWith("./") || value.startsWith("../")
      ? resolve(repoRoot, value) + (value.endsWith("/") ? "/" : "")
      : value;
  }
  const configPath = join(dir, "deno.json");
  await Deno.writeTextFile(
    configPath,
    JSON.stringify(
      {
        compilerOptions: { lib: BROWSER_CHECK_LIB },
        imports,
        nodeModulesDir: "manual",
        lock: false,
      },
      null,
      2,
    ) + "\n",
  );
  return configPath;
}
