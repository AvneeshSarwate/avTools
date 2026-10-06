// Standalone project check: the same whole-project verdict the coordination
// server's `/project/diagnostics` route gives the Run button, without a running
// server. It transforms every canonical `*.orig.ts` into a temporary shadow
// tree (so modules check against each other's current source, never stale
// generated `*.ts` files), reports the analyzer's own TCV_* rules, and runs a
// target-aware `deno check` over the result.
//
//   deno task livecode:check <projectDir | manifest.json> [--target deno|browser] [--json]
//
// Exit code 0 means no diagnostics; 1 means diagnostics or a failed check;
// 2 means the command itself could not run (bad arguments, unreadable project).

import { dirname, fromFileUrl, join, resolve } from "jsr:@std/path@1";
import type {
  LivecodeProjectManifest,
  ProjectShadowDiagnostic,
} from "./protocol.ts";
import { analyzeProjectShadow } from "./project_shadow_analysis.ts";
import { writeBrowserCheckConfig } from "./browser_check_config.ts";
import { normalizeProjectModuleRecord } from "./project_paths.ts";
import { removePathBestEffort } from "./fs_utils.ts";

const PROJECT_MANIFEST_FILENAME = "project.avtools-livecode.json";
const REPO_ROOT = fromFileUrl(new URL("../../../..", import.meta.url));
const RUNTIME_IMPORT = new URL(
  "../../../../packages/livecode-engine/runtime.ts",
  import.meta.url,
).href;

type EngineTarget = "deno" | "browser";

interface CheckOptions {
  projectPath: string;
  target: EngineTarget | null;
  json: boolean;
}

const USAGE =
  "usage: deno task livecode:check <projectDir | manifest.json> [--target deno|browser] [--json]";

function parseArgs(args: string[]): CheckOptions {
  let projectPath: string | null = null;
  let target: EngineTarget | null = null;
  let json = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--target" || arg.startsWith("--target=")) {
      const value = arg.includes("=") ? arg.split("=")[1] : args[++index];
      if (value !== "deno" && value !== "browser") {
        throw new Error(`--target must be deno or browser, got ${value}`);
      }
      target = value;
    } else if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      Deno.exit(0);
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown option ${arg}`);
    } else if (projectPath === null) {
      projectPath = arg;
    } else {
      throw new Error(`unexpected argument ${arg}`);
    }
  }
  if (!projectPath) throw new Error("a project directory is required");
  return { projectPath, target, json };
}

async function hashText(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** 1-based line/column of an offset, for analyzer diagnostics that carry offsets. */
function lineColumnAt(text: string, offset: number) {
  const before = text.slice(0, Math.max(0, Math.min(offset, text.length)));
  const lines = before.split("\n");
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

async function main(): Promise<number> {
  let options: CheckOptions;
  try {
    options = parseArgs(Deno.args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    return 2;
  }

  // Relative paths resolve against the caller's directory; `deno task` runs
  // from the task's own directory but exports the caller's as INIT_CWD.
  const resolved = resolve(
    Deno.env.get("INIT_CWD") ?? Deno.cwd(),
    options.projectPath,
  );
  const manifestPath = resolved.endsWith(".json")
    ? resolved
    : join(resolved, PROJECT_MANIFEST_FILENAME);
  const projectRoot = dirname(manifestPath);
  const manifest = JSON.parse(
    await Deno.readTextFile(manifestPath),
  ) as LivecodeProjectManifest;
  manifest.modules = manifest.modules.map(normalizeProjectModuleRecord);

  // The server falls back to its own engine mode when the manifest names no
  // target; a standalone check has no server to ask, so it says what it chose.
  const target: EngineTarget = options.target ?? manifest.engineTarget ??
    "deno";
  const targetNote = options.target
    ? "from --target"
    : manifest.engineTarget
    ? "from the manifest"
    : "default: the manifest sets no engineTarget, so a server in browser-engine mode would check this project as browser";

  const modules = await Promise.all(
    manifest.modules.map(async (moduleRecord) => {
      const absoluteSourcePath = join(projectRoot, moduleRecord.sourcePath);
      const sourceText = await Deno.readTextFile(absoluteSourcePath);
      return {
        ...moduleRecord,
        absoluteSourcePath,
        sourceText,
        sourceHash: await hashText(sourceText),
        lastLoadedHash: null,
      };
    }),
  );
  const moduleById = new Map(modules.map((entry) => [entry.id, entry]));

  const denoConfigPath = target === "browser"
    ? await writeBrowserCheckConfig(REPO_ROOT)
    : join(REPO_ROOT, "deno.json");
  const shadowParent = await Deno.makeTempDir({ prefix: "livecode-check-" });
  let response;
  try {
    response = await analyzeProjectShadow({
      projectRoot,
      project: { root: projectRoot, manifestPath, manifest },
      modules,
      shadowRoot: shadowParent,
      repoRoot: REPO_ROOT,
      denoConfigPath,
      runtimeImport: RUNTIME_IMPORT,
    });
  } finally {
    await removePathBestEffort(shadowParent, "check shadow dir");
  }

  const located = response.diagnostics.map((diagnostic) =>
    locateDiagnostic(diagnostic, moduleById)
  );
  const ok = response.denoCheck.success && located.length === 0;

  if (options.json) {
    console.log(JSON.stringify(
      {
        ok,
        projectRoot,
        target,
        diagnostics: located,
        denoCheck: {
          success: response.denoCheck.success,
          code: response.denoCheck.code,
        },
      },
      null,
      2,
    ));
    return ok ? 0 : 1;
  }

  console.log(`project: ${projectRoot}`);
  console.log(`target:  ${target} (${targetNote})`);
  console.log(`modules: ${modules.length}`);
  for (const entry of located) {
    const where = entry.line !== undefined
      ? `${entry.file}:${entry.line}:${entry.column ?? 1}`
      : entry.file;
    const approx = entry.positionIsGenerated ? " (generated position)" : "";
    console.log(`\n${entry.code} ${where}${approx}\n  ${entry.message}`);
  }
  if (!response.denoCheck.success && located.length === 0) {
    // deno check failed without a diagnostic we could parse (a resolution or
    // config error, for example): show its raw output rather than a bare FAIL.
    console.log(`\n${response.denoCheck.output.trim()}`);
  }
  console.log(
    ok ? "\nOK" : `\nFAIL: ${located.length || "unparsed"} diagnostic(s)`,
  );
  return ok ? 0 : 1;
}

interface LocatedDiagnostic {
  source: ProjectShadowDiagnostic["source"];
  code: string;
  message: string;
  /** The canonical `*.orig.ts` for module diagnostics, else the reported path. */
  file: string;
  line?: number;
  column?: number;
  /**
   * True for `deno check` positions inside a manifest module: they index the
   * transformed shadow file, whose inserted instrumentation can shift lines.
   */
  positionIsGenerated: boolean;
}

function locateDiagnostic(
  diagnostic: ProjectShadowDiagnostic,
  moduleById: Map<string, { sourcePath: string; sourceText: string }>,
): LocatedDiagnostic {
  const moduleRecord = diagnostic.moduleId
    ? moduleById.get(diagnostic.moduleId)
    : undefined;
  const base = {
    source: diagnostic.source,
    code: diagnostic.code,
    message: diagnostic.message,
    file: moduleRecord?.sourcePath ?? diagnostic.path ?? "project",
  };
  if (moduleRecord && diagnostic.from !== undefined) {
    return {
      ...base,
      ...lineColumnAt(moduleRecord.sourceText, diagnostic.from),
      positionIsGenerated: false,
    };
  }
  if (moduleRecord && diagnostic.line !== undefined) {
    const sourceLine = sourceLineForGeneratedSnippet(
      moduleRecord.sourceText,
      diagnostic.raw,
    );
    if (sourceLine !== null) {
      return {
        ...base,
        line: sourceLine,
        column: diagnostic.column,
        positionIsGenerated: false,
      };
    }
  }
  return {
    ...base,
    line: diagnostic.line,
    column: diagnostic.column,
    positionIsGenerated: moduleRecord !== undefined &&
      diagnostic.line !== undefined,
  };
}

/**
 * deno check quotes the offending generated line under its header. Inserted
 * instrumentation shifts line numbers but leaves user lines intact, so a quoted
 * line that occurs exactly once in the canonical source names its real line.
 * Ambiguous or rewritten lines stay unmapped.
 */
function sourceLineForGeneratedSnippet(
  sourceText: string,
  raw: string,
): number | null {
  // deno's own ANSI styling, stripped before comparing text.
  // deno-lint-ignore no-control-regex
  const rawLines = raw.replace(/\x1b\[[0-9;]*m/g, "").split("\n");
  const snippet = rawLines[1]?.trim();
  if (!snippet) return null;
  const matches: number[] = [];
  sourceText.split("\n").forEach((line, index) => {
    if (line.trim() === snippet) matches.push(index + 1);
  });
  return matches.length === 1 ? matches[0] : null;
}

if (import.meta.main) {
  try {
    Deno.exit(await main());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(2);
  }
}
