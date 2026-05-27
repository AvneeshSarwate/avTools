// Runtime path resolver for the .app-bundled build of combined_landscape.ts.
//
// `deno compile` extracts the bundled sources to a per-process temp dir like
//   /var/folders/.../T/deno-compile-<exec-name>/<original-source-path>
// and resolves `import.meta.url` to that virtual path. Reading bundled
// assets through that path works only for files passed to `--include`; we
// instead keep dylibs and assets on a real filesystem path inside the .app
// so the bundle can be edited without rebuilding, and so dlopen() (which
// can't see the virtual FS) can load the FFI libraries.
//
// Layout assumed by isCompiled() mode:
//   HanoiShow.app/Contents/MacOS/<exec>
//   HanoiShow.app/Contents/Resources/lib*.dylib
//   HanoiShow.app/Contents/Resources/assets/*

// The `/deno-compile-` segment is injected by the Deno runtime into the
// virtual temp path used for embedded sources; if it appears in our own
// import.meta.url we know we're running from a compiled binary.
const COMPILED_MODE_MARKER = "/deno-compile-";

export function isCompiled(): boolean {
  return import.meta.url.includes(COMPILED_MODE_MARKER);
}

function posixDirname(p: string): string {
  const i = p.lastIndexOf("/");
  if (i < 0) return "";
  if (i === 0) return "/";
  return p.slice(0, i);
}

function posixBasename(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}

function pathToFileUrl(absPath: string): URL {
  // macOS exec paths are absolute POSIX. Encode each segment so spaces in
  // ".app" bundle names survive.
  const parts = absPath.split("/").map(encodeURIComponent);
  return new URL("file://" + parts.join("/"));
}

let cachedResourcesDir: string | null = null;

function resourcesDir(): string {
  if (cachedResourcesDir) return cachedResourcesDir;
  const exec = Deno.execPath();
  cachedResourcesDir = posixDirname(posixDirname(exec)) + "/Resources";
  return cachedResourcesDir;
}

/** Resolve a sidecar native library. In dev, returns the URL constructed
 *  from `devRelativeBase` (the existing `new URL(name, base)` pattern).
 *  In compiled mode, returns the path under `Contents/Resources/`. */
export function resolveNativeLib(devRelativeBase: URL, libBasename: string): URL {
  if (isCompiled()) {
    return pathToFileUrl(resourcesDir() + "/" + libBasename);
  }
  return new URL(libBasename, devRelativeBase);
}

/** Resolve an asset URL. In dev, uses `new URL(devRelative, baseUrl)`.
 *  In compiled, maps to `Contents/Resources/assets/<basename of rel>`. */
export function resolveAsset(devRelative: string, baseUrl: string | URL): URL {
  if (isCompiled()) {
    return pathToFileUrl(
      resourcesDir() + "/assets/" + posixBasename(devRelative),
    );
  }
  return new URL(devRelative, baseUrl);
}

/** Resolve an asset directory (for `Deno.readDirSync`).
 *  In dev, uses `new URL(devRelative, baseUrl)`. In compiled, returns the
 *  flat `Contents/Resources/assets/` directory. */
export function resolveAssetDir(devRelative: string, baseUrl: string | URL): URL {
  if (isCompiled()) {
    return pathToFileUrl(resourcesDir() + "/assets/");
  }
  return new URL(devRelative, baseUrl);
}
