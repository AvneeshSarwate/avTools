import { LSProxy, utils } from "@valtown/ls-ws-server/proxy";
import {
  dirname,
  fromFileUrl,
  isAbsolute,
  join,
  toFileUrl,
} from "jsr:@std/path@1";

type JsonRecord = Record<string, unknown>;

const args = parseArgs(Deno.args);
const repoRoot = resolvePath(
  args["repo-root"] ?? fromFileUrl(new URL("../../..", import.meta.url)),
);
const workspaceRoot = resolvePath(
  args["workspace-root"] ??
    await Deno.makeTempDir({ prefix: "avtools-lsp-workspaces-" }),
);
const workspaceDir = join(workspaceRoot, crypto.randomUUID());

await Deno.mkdir(workspaceDir, { recursive: true });
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
      return {
        ...params,
        rootUri: params.rootUri ?? toFileUrl(workspaceDir).href,
        workspaceFolders: params.workspaceFolders ??
          [{ uri: toFileUrl(workspaceDir).href, name: "Livecode" }],
      };
    },
    "textDocument/didOpen": async (params) => {
      await writeTextDocument(
        params.textDocument.uri,
        params.textDocument.text,
      );
      return params;
    },
    "textDocument/didChange": async (params) => {
      const text = params.contentChanges.find((change) =>
        "text" in change && !("range" in change)
      )?.text;
      if (typeof text === "string") {
        await writeTextDocument(params.textDocument.uri, text);
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

await proxy.listen();

async function writeTextDocument(uri: string, text: string) {
  const mapped = utils.virtualUriToTempDirUri(uri, workspaceDir);
  if (!mapped?.startsWith("file:")) return;

  const filePath = fromFileUrl(mapped);
  await Deno.mkdir(dirname(filePath), { recursive: true });
  await Deno.writeTextFile(filePath, text);
}

async function writeWorkspaceDenoConfig(targetDir: string, rootDir: string) {
  const notebookConfigPath = join(rootDir, "apps/deno-notebooks/deno.json");
  const notebookConfig = JSON.parse(
    await Deno.readTextFile(notebookConfigPath),
  ) as JsonRecord;

  const imports = normalizeImports(
    (notebookConfig.imports ?? {}) as Record<string, string>,
    dirname(notebookConfigPath),
  );

  await Deno.writeTextFile(
    join(targetDir, "deno.json"),
    JSON.stringify({ imports }, null, 2),
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
