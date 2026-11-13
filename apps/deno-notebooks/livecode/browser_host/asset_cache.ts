// Optional, disposable build cache. Source checkpoints remain authoritative.
// Archive objects are immutable; a missing/corrupt/stale cache only costs a build.
import { isAbsolute, join, relative } from "jsr:@std/path@1";

export type CacheInputs = Record<string, string>;
interface Manifest {
  version: 1;
  deno: string;
  archive: string;
  sha256: string;
  inputs: CacheInputs;
}

async function hash(path: string): Promise<string> {
  const bytes = await Deno.readFile(path);
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  )
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeRelative(path: string): boolean {
  return path.length > 0 && !isAbsolute(path) &&
    !path.split(/[\\/]/).includes("..");
}

export async function captureInputs(
  root: string,
  paths: string[],
): Promise<CacheInputs> {
  const inputs: CacheInputs = {};
  for (const path of [...new Set(paths)].sort()) {
    const key = relative(root, path);
    // External local dependencies cannot be made portable across containers.
    if (!safeRelative(key)) throw new Error(`Uncacheable dependency: ${path}`);
    inputs[key] = await hash(path);
  }
  return inputs;
}

export async function inputsMatch(
  root: string,
  inputs: CacheInputs,
): Promise<boolean> {
  if (!inputs || !Object.keys(inputs).length) return false;
  try {
    for (const [path, expected] of Object.entries(inputs)) {
      if (!safeRelative(path) || await hash(join(root, path)) !== expected) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

async function tar(args: string[]): Promise<void> {
  const result = await new Deno.Command("tar", {
    args,
    stdout: "null",
    stderr: "piped",
  }).output();
  if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
}

export async function restoreAssetCache(
  root: string,
  cache: string,
  out: string,
): Promise<boolean> {
  let temporary: string | undefined;
  try {
    const manifest: Manifest = JSON.parse(
      await Deno.readTextFile(join(cache, "current.json")),
    );
    if (
      manifest.version !== 1 || manifest.deno !== Deno.version.deno ||
      !/^[a-f0-9-]{36}\.tar\.gz$/.test(manifest.archive) ||
      !await inputsMatch(root, manifest.inputs)
    ) return false;
    temporary = await Deno.makeTempDir({ prefix: "livecode-asset-restore-" });
    const archive = join(temporary, "assets.tar.gz");
    await Deno.copyFile(join(cache, manifest.archive), archive);
    if (await hash(archive) !== manifest.sha256) return false;
    const tree = join(temporary, "tree");
    await Deno.mkdir(tree);
    await tar(["-xzf", archive, "-C", tree]);
    // Recheck after download in case a framework edit raced cache validation.
    if (!await inputsMatch(root, manifest.inputs)) return false;
    await Deno.mkdir(out, { recursive: true });
    for await (const entry of Deno.readDir(tree)) {
      if (!entry.isFile) throw new Error("Unexpected cached asset type");
      await Deno.copyFile(join(tree, entry.name), join(out, entry.name));
    }
    console.log(JSON.stringify({ type: "browserHostAssetsCacheHit", cache }));
    return true;
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      console.warn(`[livecode] asset cache miss: ${error}`);
    }
    return false;
  } finally {
    if (temporary) await Deno.remove(temporary, { recursive: true });
  }
}

export async function publishAssetCache(
  root: string,
  cache: string,
  out: string,
  inputs: CacheInputs,
): Promise<boolean> {
  if (!await inputsMatch(root, inputs)) return false;
  const temporary = await Deno.makeTempDir({ prefix: "livecode-asset-save-" });
  try {
    const tree = join(temporary, "tree");
    await Deno.mkdir(tree);
    // Entry stubs contain absolute paths; only the served, flat asset tree is cached.
    for await (const entry of Deno.readDir(out)) {
      if (entry.isFile) {
        await Deno.copyFile(join(out, entry.name), join(tree, entry.name));
      }
    }
    const archive = `${crypto.randomUUID()}.tar.gz`;
    const local = join(temporary, archive);
    await tar(["-czf", local, "-C", tree, "."]);
    if (!await inputsMatch(root, inputs)) return false;
    const manifest: Manifest = {
      version: 1,
      deno: Deno.version.deno,
      archive,
      sha256: await hash(local),
      inputs,
    };
    await Deno.mkdir(cache, { recursive: true });
    let previous: Manifest | undefined;
    try {
      previous = JSON.parse(
        await Deno.readTextFile(join(cache, "current.json")),
      );
    } catch { /* optional */ }
    await Deno.copyFile(local, join(cache, archive));
    // No R2 rename assumption: publish only after the archive has closed.
    await Deno.writeTextFile(
      join(cache, "current.json"),
      JSON.stringify(manifest),
    );
    if (
      previous && /^[a-f0-9-]{36}\.tar\.gz$/.test(previous.archive) &&
      previous.archive !== archive
    ) {
      await Deno.remove(join(cache, previous.archive)).catch(() => {});
    }
    console.log(
      JSON.stringify({ type: "browserHostAssetsCachePublished", cache }),
    );
    return true;
  } finally {
    await Deno.remove(temporary, { recursive: true });
  }
}
