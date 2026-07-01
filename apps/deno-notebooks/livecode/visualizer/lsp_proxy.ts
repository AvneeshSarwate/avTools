import { LSProxy, utils } from "@valtown/ls-ws-server/proxy";
import {
  dirname,
  fromFileUrl,
  isAbsolute,
  join,
  normalize,
  toFileUrl,
} from "jsr:@std/path@1";

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
const documentVersions = new Map<string, number>();
let cleaningUp = false;

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
  if (section === "deno.config") return join(workspaceDir, "deno.json");
  return null;
}

function denoWorkspaceSettings(): JsonRecord {
  return {
    enable: true,
    lint: true,
    config: join(workspaceDir, "deno.json"),
  };
}

async function writeWorkspaceDenoConfig(targetDir: string, rootDir: string) {
  const rootConfigPath = join(rootDir, "deno.json");
  const notebookConfigPath = join(rootDir, "apps/deno-notebooks/deno.json");
  const imports = {
    ...await readNormalizedImports(rootConfigPath),
    ...await readNormalizedImports(notebookConfigPath),
  };

  await Deno.writeTextFile(
    join(targetDir, "deno.json"),
    JSON.stringify({ nodeModulesDir: "auto", imports }, null, 2),
  );
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
  await shutdownProxyBestEffort(proxy);
  try {
    await Deno.remove(workspaceDir, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      console.warn("[livecode-lsp-proxy] failed to remove workspace", error);
    }
  }
}

async function shutdownProxyBestEffort(target: unknown): Promise<void> {
  if (!target || typeof target !== "object") return;
  const methods = ["shutdown", "dispose", "close", "kill"] as const;
  for (const method of methods) {
    const candidate = (target as Record<string, unknown>)[method];
    if (typeof candidate !== "function") continue;
    try {
      await candidate.call(target);
    } catch (error) {
      console.warn(`[livecode-lsp-proxy] proxy ${method} failed`, error);
    }
    return;
  }
}
