import { assert, assertEquals } from "jsr:@std/assert@1";
import { join } from "jsr:@std/path@1";
import {
  captureInputs,
  publishAssetCache,
  restoreAssetCache,
} from "../browser_host/asset_cache.ts";

async function fixture(
  run: (
    root: string,
    cache: string,
    out: string,
    restored: string,
  ) => Promise<void>,
) {
  const temp = await Deno.makeTempDir();
  try {
    const root = join(temp, "root"), out = join(temp, "out");
    await Deno.mkdir(root);
    await Deno.mkdir(out);
    await Deno.writeTextFile(join(root, "source.ts"), "export const x = 1;");
    await Deno.writeTextFile(join(root, "deno.lock"), "{}");
    await Deno.writeTextFile(join(out, "engine.html"), "engine");
    await Deno.writeTextFile(join(out, "chunk.js"), "chunk");
    await Deno.mkdir(join(out, "entries"));
    await Deno.writeTextFile(join(out, "entries", "stub.ts"), "private paths");
    await run(root, join(temp, "cache"), out, join(temp, "restored"));
  } finally {
    await Deno.remove(temp, { recursive: true });
  }
}

Deno.test("asset cache restores across output directories, omitting entry stubs", () =>
  fixture(async (root, cache, out, restored) => {
    const inputs = await captureInputs(root, [
      join(root, "source.ts"),
      join(root, "deno.lock"),
    ]);
    assert(await publishAssetCache(root, cache, out, inputs));
    assert(await restoreAssetCache(root, cache, restored));
    assertEquals(await Deno.readTextFile(join(restored, "chunk.js")), "chunk");
    assertEquals([...Deno.readDirSync(restored)].length, 2);
    // Unrelated project files do not invalidate the resolved dependency graph.
    await Deno.writeTextFile(join(root, "project.ts"), "new project");
    assert(await restoreAssetCache(root, cache, restored));
  }));

Deno.test("same-length source edits, config edits, and missing dependencies reject cache", () =>
  fixture(async (root, cache, out, restored) => {
    const paths = [join(root, "source.ts"), join(root, "deno.lock")];
    await publishAssetCache(root, cache, out, await captureInputs(root, paths));
    await Deno.writeTextFile(paths[0], "export const x = 2;");
    assertEquals(await restoreAssetCache(root, cache, restored), false);
    await Deno.writeTextFile(paths[0], "export const x = 1;");
    await Deno.writeTextFile(paths[1], "changed");
    assertEquals(await restoreAssetCache(root, cache, restored), false);
    await Deno.writeTextFile(paths[1], "{}");
    await Deno.remove(paths[0]);
    assertEquals(await restoreAssetCache(root, cache, restored), false);
  }));

Deno.test("missing, corrupt, and different-runtime caches fall back", () =>
  fixture(async (root, cache, out, restored) => {
    assertEquals(await restoreAssetCache(root, cache, restored), false);
    const inputs = await captureInputs(root, [join(root, "source.ts")]);
    await publishAssetCache(root, cache, out, inputs);
    const path = join(cache, "current.json");
    const manifest = JSON.parse(await Deno.readTextFile(path));
    await Deno.writeTextFile(
      path,
      JSON.stringify({ ...manifest, deno: "other" }),
    );
    assertEquals(await restoreAssetCache(root, cache, restored), false);
    await Deno.writeTextFile(path, JSON.stringify(manifest));
    await Deno.writeTextFile(join(cache, manifest.archive), "corrupt");
    assertEquals(await restoreAssetCache(root, cache, restored), false);
    await Deno.writeTextFile(path, "incomplete JSON");
    assertEquals(await restoreAssetCache(root, cache, restored), false);
  }));

Deno.test("source edits during a build prevent cache publication", () =>
  fixture(async (root, cache, out, restored) => {
    const source = join(root, "source.ts");
    const inputs = await captureInputs(root, [source]);
    await Deno.writeTextFile(source, "edited during build");
    assertEquals(await publishAssetCache(root, cache, out, inputs), false);
    assertEquals(await restoreAssetCache(root, cache, restored), false);
  }));
