import { LSProxy, utils } from "@valtown/ls-ws-server/proxy";
import {
  dirname,
  fromFileUrl,
  isAbsolute,
  join,
  normalize,
  toFileUrl,
} from "jsr:@std/path@1";
import { BROWSER_CHECK_LIB } from "./browser_check_config.ts";
import { removePathBestEffort } from "./fs_utils.ts";

type JsonRecord = Record<string, unknown>;

const args = parseArgs(Deno.args);
const repoRoot = resolvePath(
  args["repo-root"] ?? fromFileUrl(new URL("../../../..", import.meta.url)),
);
const workspaceRoot = resolvePath(
  args["workspace-root"] ??
    await Deno.makeTempDir({ prefix: "avtools-lsp-workspaces-" }),
);
const workspaceDir = join(workspaceRoot, crypto.randomUUID());
// The engine target the server publishes for the current project (see
// `publishLspEngineTarget` in server.ts). Editor diagnostics follow it so they
// agree with the Run gate about which globals exist.
const engineTargetFile = args["engine-target-file"];
const documentVersions = new Map<string, number>();
let lastAppliedEngineTarget: "deno" | "browser" | null = null;
// The workspace config the LS should use right now. Target-specific filenames,
// because `deno lsp` re-reads config when the `deno.config` SETTING changes on
// a didChangeConfiguration pull — not when the same file's contents change.
let activeConfigPath = join(workspaceDir, "deno.json");
let engineTargetPollTimer: ReturnType<typeof setInterval> | null = null;
let cleaningUp = false;

const ENGINE_TARGET_POLL_MS = 1_000;

await Deno.mkdir(workspaceDir, { recursive: true });
await ensureRepoRootMirror(workspaceDir, repoRoot);
await writeWorkspaceDenoConfig(workspaceDir, repoRoot);

const proxy = new LSProxy({
  name: "avtools-deno-lsp",
  cwd: workspaceDir,
  exec: {
    command: Deno.execPath(),
    args: ["lsp", "-q"],
  },
  clientToProcMiddlewares: {
    initialize: async (params) => {
      await writeWorkspaceDenoConfig(workspaceDir, repoRoot);
      const workspaceUri = toFileUrl(workspaceDir).href;
      return {
        ...params,
        rootPath: workspaceDir,
        rootUri: workspaceUri,
        workspaceFolders: [{ uri: workspaceUri, name: "Livecode" }],
      };
    },
    "textDocument/didOpen": async (params) => {
      rememberDocumentVersion(
        params.textDocument.uri,
        params.textDocument.version,
      );
      await writeTextDocument(
        params.textDocument.uri,
        params.textDocument.text,
      );
      return params;
    },
    "textDocument/didChange": async (params) => {
      rememberDocumentVersion(
        params.textDocument.uri,
        params.textDocument.version,
      );
      const text = params.contentChanges.find((change) =>
        "text" in change && !("range" in change)
      )?.text;
      if (typeof text === "string") {
        await writeTextDocument(params.textDocument.uri, text);
      }
      return params;
    },
  },
  procToClientHandlers: {
    "workspace/configuration": (params: unknown) => {
      return getConfigurationItems(params).map((item) =>
        denoConfigurationForItem(item)
      );
    },
    "client/registerCapability": () => null,
    "client/unregisterCapability": () => null,
    "workspace/workspaceFolders": () => [
      { uri: toFileUrl(workspaceDir).href, name: "Livecode" },
    ],
  },
  procToClientMiddlewares: {
    "textDocument/publishDiagnostics": (params) => {
      if (
        typeof params.version !== "number" &&
        typeof params.uri === "string"
      ) {
        const version = documentVersions.get(params.uri);
        if (typeof version === "number") {
          return { ...params, version };
        }
      }
      return params;
    },
  },
  uriConverters: {
    toProcUri: (uriString: string) => {
      return utils.virtualUriToTempDirUri(uriString, workspaceDir) ?? uriString;
    },
    fromProcUri: (uriString: string) => {
      return utils.tempDirUriToVirtualUri(uriString, workspaceDir);
    },
  },
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  Deno.addSignalListener(sig, async () => {
    await cleanup();
    Deno.exit(0);
  });
}

try {
  await proxy.listen();
  watchEngineTarget();
  await new Promise(() => {
    // Keep this proxy process alive until the parent LSP server terminates it.
  });
} finally {
  await cleanup();
}

async function writeTextDocument(uri: string, text: string) {
  // Repo-backed docs are sent to Deno LSP as in-memory open documents. Do not
  // write those buffers through the temp-workspace symlink, or editor changes
  // would bypass the project write path.
  if (isRepoFileUri(uri)) return;

  const mapped = utils.virtualUriToTempDirUri(uri, workspaceDir);
  if (!mapped?.startsWith("file:")) return;

  const filePath = fromFileUrl(mapped);
  await Deno.mkdir(dirname(filePath), { recursive: true });
  await Deno.writeTextFile(filePath, text);
}

async function ensureRepoRootMirror(targetDir: string, rootDir: string) {
  const root = normalize(rootDir).replace(/\/+$/, "");
  const mirrorPath = join(targetDir, root.replace(/^\/+/, ""));
  await Deno.mkdir(dirname(mirrorPath), { recursive: true });
  try {
    await Deno.symlink(root, mirrorPath, { type: "dir" });
  } catch (error) {
    if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
  }
}

function rememberDocumentVersion(uri: string, version: number) {
  if (typeof version !== "number") return;
  const virtualUri = utils.tempDirUriToVirtualUri(uri, workspaceDir);
  documentVersions.set(virtualUri, version);
}

function getConfigurationItems(params: unknown): unknown[] {
  if (!params || typeof params !== "object" || Array.isArray(params)) return [];
  const items = (params as { items?: unknown }).items;
  return Array.isArray(items) ? items : [];
}

function denoConfigurationForItem(item: unknown): unknown {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const section = (item as { section?: unknown }).section;
  if (section === "deno") return denoWorkspaceSettings();
  if (section === "deno.enable") return true;
  if (section === "deno.lint") return true;
  if (section === "deno.config") return activeConfigPath;
  return null;
}

function denoWorkspaceSettings(): JsonRecord {
  return {
    enable: true,
    lint: true,
    config: activeConfigPath,
  };
}

async function readEngineTarget(): Promise<"deno" | "browser"> {
  if (!engineTargetFile) return "deno";
  try {
    const parsed = JSON.parse(await Deno.readTextFile(engineTargetFile)) as {
      target?: unknown;
    };
    return parsed.target === "browser" ? "browser" : "deno";
  } catch {
    return "deno";
  }
}

async function writeWorkspaceDenoConfig(targetDir: string, rootDir: string) {
  const rootConfigPath = join(rootDir, "deno.json");
  const notebookConfigPath = join(rootDir, "apps/deno-notebooks/deno.json");
  const imports = {
    ...await readNormalizedImports(rootConfigPath),
    ...await readNormalizedImports(notebookConfigPath),
  };

  const engineTarget = await readEngineTarget();
  lastAppliedEngineTarget = engineTarget;
  const configName = engineTarget === "browser"
    ? "deno.browser.json"
    : "deno.json";
  const staleName = engineTarget === "browser"
    ? "deno.json"
    : "deno.browser.json";
  await Deno.writeTextFile(
    join(targetDir, configName),
    JSON.stringify(
      {
        nodeModulesDir: "auto",
        imports,
        ...(engineTarget === "browser"
          ? { compilerOptions: { lib: BROWSER_CHECK_LIB } }
          : {}),
      },
      null,
      2,
    ),
  );
  // Only the active world's config exists, so `deno lsp` can never discover
  // the other one on its own.
  try {
    await Deno.remove(join(targetDir, staleName));
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  activeConfigPath = join(targetDir, configName);
}

/**
 * Follow live engine-target flips (a browser-target project opening after this
 * proxy spawned): rewrite the workspace config and nudge `deno lsp` to re-pull
 * configuration, which re-reads the config file and re-diagnoses open docs.
 */
async function reapplyEngineTargetIfChanged(): Promise<void> {
  if (await readEngineTarget() === lastAppliedEngineTarget) return;
  await writeWorkspaceDenoConfig(workspaceDir, repoRoot);
  try {
    // The next workspace/configuration pull returns the new config path, and a
    // changed `deno.config` setting makes deno lsp reload for real. Must go
    // over procConn: LSProxy's sendNotification* send to the editor client
    // despite their doc comments.
    proxy.procConn?.sendNotification("workspace/didChangeConfiguration", {
      settings: {},
    });
  } catch (error) {
    console.warn("[livecode-lsp-proxy] engine-target notify failed", error);
  }
}

function watchEngineTarget(): void {
  if (!engineTargetFile) return;
  // A poll, not Deno.watchFs: fs-event paths are not symlink-stable across
  // platforms (macOS reports /private/var/... for a /var/... TMPDIR watch,
  // so an equality filter never matches), and a flip is a rare, latency-
  // tolerant event. Reading ~40 bytes a second is cheaper than being wrong.
  engineTargetPollTimer = setInterval(() => {
    if (cleaningUp) return;
    void reapplyEngineTargetIfChanged().catch((error) => {
      console.warn("[livecode-lsp-proxy] engine-target poll failed", error);
    });
  }, ENGINE_TARGET_POLL_MS);
}

async function readNormalizedImports(
  configPath: string,
): Promise<Record<string, string>> {
  const config = JSON.parse(await Deno.readTextFile(configPath)) as JsonRecord;
  return normalizeImports(
    (config.imports ?? {}) as Record<string, string>,
    dirname(configPath),
  );
}

function normalizeImports(
  imports: Record<string, string>,
  baseDir: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(imports).map(([key, value]) => {
      return [key, normalizeImportTarget(value, baseDir)];
    }),
  );
}

function normalizeImportTarget(value: string, baseDir: string): string {
  if (/^(npm|jsr|https?|file|data):/i.test(value)) return value;
  if (!value.startsWith(".") && !value.startsWith("/")) return value;

  const path = isAbsolute(value) ? value : join(baseDir, value);
  let href = toFileUrl(path).href;
  if (value.endsWith("/") && !href.endsWith("/")) href += "/";
  return href;
}

function isRepoFileUri(uriString: string): boolean {
  if (!uriString.startsWith("file:")) return false;
  try {
    const filePath = normalize(fromFileUrl(uriString));
    const root = normalize(repoRoot);
    return filePath === root || filePath.startsWith(`${root}/`);
  } catch {
    return false;
  }
}

function parseArgs(rawArgs: string[]): Record<string, string | undefined> {
  const parsed: Record<string, string | undefined> = {};
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = rawArgs[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
    } else {
      parsed[key] = next;
      i++;
    }
  }
  return parsed;
}

function resolvePath(path: string): string {
  if (path.startsWith("file:")) return fromFileUrl(path);
  if (isAbsolute(path)) return path;
  return join(Deno.cwd(), path);
}

async function cleanup(): Promise<void> {
  if (cleaningUp) return;
  cleaningUp = true;
  if (engineTargetPollTimer !== null) clearInterval(engineTargetPollTimer);
  shutdownProxyBestEffort(proxy);
  await removePathBestEffort(workspaceDir, "lsp workspace");
}

function shutdownProxyBestEffort(target: LSProxy): void {
  // Dispose the RPC connection to the language server process if available.
  try {
    target.procConn?.dispose?.();
  } catch (error) {
    console.warn("[livecode-lsp-proxy] procConn dispose failed", error);
  }

  // Definitively kill the spawned `deno lsp` child. LSProxy exposes the Node
  // ChildProcess directly as `process`; without this the child is orphaned on
  // SIGINT/SIGTERM.
  const child =
    (target as { process?: { kill: (signal?: string) => boolean } | null })
      .process;
  console.log("[livecode-lsp-proxy] killing deno lsp child process (SIGTERM)");
  try {
    child?.kill("SIGTERM");
  } catch (error) {
    console.warn("[livecode-lsp-proxy] child process kill failed", error);
  }
}
