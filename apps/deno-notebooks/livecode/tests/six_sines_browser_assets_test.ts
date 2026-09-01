import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { fromFileUrl, join } from "jsr:@std/path@1";
import { buildBrowserHostAssets } from "../browser_host/build_host_assets.ts";

const REPO_ROOT = fromFileUrl(new URL("../../../..", import.meta.url));
const RUNTIME_FILES = [
  "six-sines-worklet.js",
  "six-sines.js",
  "six-sines.wasm",
  "six-sines-build.json",
] as const;

Deno.test("browser host publishes the adjacent Six Sines runtime", async () => {
  const outDir = await Deno.makeTempDir({ prefix: "six-sines-host-assets-" });
  try {
    await buildBrowserHostAssets({ outDir });

    const engineHtml = await Deno.readTextFile(join(outDir, "engine.html"));
    assertStringIncludes(
      engineHtml,
      '"@avtools/six-sines": "./six_sines.js"',
    );

    const publicBundle = await Deno.readTextFile(join(outDir, "six_sines.js"));
    assertStringIncludes(publicBundle, 'new URL("./six-sines-worklet.js"');
    assertStringIncludes(publicBundle, 'new URL("./six-sines.wasm"');

    for (const name of RUNTIME_FILES) {
      const emittedPath = join(outDir, name);
      const emitted = await Deno.readFile(emittedPath);
      const packaged = await Deno.readFile(
        join(REPO_ROOT, "packages/six-sines", name),
      );
      assert(emitted.byteLength > 0, `${name} must not be empty`);
      assertEquals(emitted, packaged, `${name} must be copied byte-for-byte`);
    }
  } finally {
    await Deno.remove(outDir, { recursive: true }).catch(() => {});
  }
});
