// Bake a livecode project into a fully static, serverless artifact — Setup A
// of docs/livecode/history/browser-engine-plan-2026-08.md:
//
//   <out>/index.html, assets/...   the built tldraw client (copied from a
//                                  vite dist) with boot defaults stamped in:
//                                  opened bare it runs the engine IN THE SAME
//                                  TAB (`serverBaseUrl=none&engine=inprocess`),
//                                  the single-page demo form; an explicit
//                                  ?serverBaseUrl=none&sync=broadcast&actions=broadcast
//                                  still selects the two-tab form
//   <out>/engine/...               the engine host assets (one code-split
//                                  bundle; see build_host_assets.ts)
//   <out>/engine/project/...       every project module: analyzer-transformed,
//                                  type-stripped, relative `.ts` specifiers
//                                  rewritten to `.js`
//   <out>/engine/baked.json        durable-entity seeds (the project's data/
//                                  tree) plus the module list the engine tab
//                                  auto-launches at boot
//
// Host the output on any static file server and open /: one tab runs the
// piece and shows it, with canvas view shapes mirroring the modules' named
// canvases. Or open /engine/engine.html in one tab and the two-tab UI URL in
// another: the engine runs the piece; the UI watches over BroadcastChannel and
// edits over the broadcast actions channel. Code is no longer editable — that
// is the bake's contract — and a bake cannot start or stop modules: every
// module auto-launches at boot, so per-example running state belongs in a
// params toggle the module itself honors.
//
// Usage (from apps/deno-notebooks):
//   deno run --allow-all livecode/browser_host/bake_project.ts \
//     --project <dir> --out <dir> [--ui <tldraw dist dir>]

import { ts } from "npm:ts-morph@23.0.0";
import { dirname, fromFileUrl, join, relative, resolve } from "jsr:@std/path@1";
import { analyzeAndTransformTimedModule } from "../visualizer/analyze_transform.ts";
import { buildBrowserHostAssets } from "./build_host_assets.ts";
import type {
  BakedProjectFile,
  BakedProjectModule,
  EngineEntityLoadEntry,
  LivecodeProjectManifest,
} from "@avtools/livecode-protocol";

const HERE = dirname(fromFileUrl(import.meta.url));

function argValue(name: string): string | undefined {
  const index = Deno.args.indexOf(`--${name}`);
  return index >= 0 ? Deno.args[index + 1] : undefined;
}

/**
 * Rewrite relative `./x.ts` / `../x.ts` module specifiers to `.js` in
 * transpiled output, by AST positions rather than text patterns so string
 * contents can never be touched.
 */
export function rewriteRelativeTsSpecifiers(js: string): string {
  const sourceFile = ts.createSourceFile(
    "module.js",
    js,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS,
  );
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const collect = (literal: ts.StringLiteral) => {
    const specifier = literal.text;
    if (!specifier.startsWith("./") && !specifier.startsWith("../")) return;
    if (!specifier.endsWith(".ts")) return;
    edits.push({
      start: literal.getStart(sourceFile),
      end: literal.getEnd(),
      text: JSON.stringify(specifier.slice(0, -3) + ".js"),
    });
  };
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
    ) {
      collect(node.moduleSpecifier);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])
    ) {
      collect(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  let output = js;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  }
  return output;
}

async function copyDirectory(from: string, to: string): Promise<void> {
  await Deno.mkdir(to, { recursive: true });
  for await (const entry of Deno.readDir(from)) {
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory) await copyDirectory(source, target);
    else if (entry.isFile) await Deno.copyFile(source, target);
  }
}

/** Boot defaults the copied UI reads when its URL carries no query string. */
export const BAKED_BOOT_DEFAULTS: Readonly<Record<string, string>> = {
  serverBaseUrl: "none",
  engine: "inprocess",
};

/**
 * Stamp the single-tab boot defaults into the copied client's index.html, as
 * the first script in <head> so it runs before the module script reads them
 * (`readBootParam` in the client). Idempotent for a re-bake over an old out.
 */
export async function stampBootDefaults(indexPath: string): Promise<void> {
  const html = await Deno.readTextFile(indexPath);
  const tag = `<script>window.livecodeBootDefaults=${
    JSON.stringify(BAKED_BOOT_DEFAULTS)
  };</script>`;
  const stripped = html.replace(
    /<script>window\.livecodeBootDefaults=[^<]*<\/script>\n?/g,
    "",
  );
  const headOpen = stripped.match(/<head[^>]*>/);
  if (!headOpen || headOpen.index === undefined) {
    throw new Error(`bake: ${indexPath} has no <head> to stamp defaults into`);
  }
  const insertAt = headOpen.index + headOpen[0].length;
  await Deno.writeTextFile(
    indexPath,
    stripped.slice(0, insertAt) + "\n    " + tag + stripped.slice(insertAt),
  );
}

export interface BakeProjectOptions {
  projectRoot: string;
  outDir: string;
  /** A built tldraw client to copy in; omit for an engine-only bake. */
  uiDist?: string;
}

export async function bakeProject(options: BakeProjectOptions): Promise<{
  moduleCount: number;
  dataCount: number;
}> {
  const projectRoot = resolve(options.projectRoot);
  const outDir = resolve(options.outDir);
  const engineDir = join(outDir, "engine");

  const manifest = JSON.parse(
    await Deno.readTextFile(join(projectRoot, "project.avtools-livecode.json")),
  ) as LivecodeProjectManifest;

  await buildBrowserHostAssets({ outDir: engineDir });

  // Modules: transform each canonical source with a runtime import computed
  // relative to its own baked location, type-strip, rewrite relative
  // specifiers, and write the `.js` tree. The canonical source rides along so
  // the UI can render the project's code shapes read-only.
  const bakedModules: BakedProjectModule[] = [];
  for (const moduleRecord of manifest.modules) {
    const sourceText = await Deno.readTextFile(
      join(projectRoot, moduleRecord.sourcePath),
    );
    const jsPath = moduleRecord.runtimePath.replace(/\.ts$/, ".js");
    const moduleDir = dirname(join("project", jsPath));
    const runtimeImport = relative(moduleDir, "runtime.js").replaceAll(
      "\\",
      "/",
    );
    const analysis = analyzeAndTransformTimedModule({
      moduleId: moduleRecord.id,
      sourceVersion: moduleRecord.sourceVersion,
      sourceUri: `file://${join(projectRoot, moduleRecord.sourcePath)}`,
      sourceText,
      runtimeImport: runtimeImport.startsWith(".")
        ? runtimeImport
        : `./${runtimeImport}`,
      requireDefaultTimedRoot: true,
    });
    if (analysis.type !== "analyzeSuccess" || !analysis.transformedCode) {
      throw new Error(
        `bake: module ${moduleRecord.id} failed analysis:\n${
          JSON.stringify(analysis, null, 2)
        }`,
      );
    }
    const transpiled = ts.transpileModule(analysis.transformedCode, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        useDefineForClassFields: true,
      },
    }).outputText;
    const outPath = join(engineDir, "project", jsPath);
    await Deno.mkdir(dirname(outPath), { recursive: true });
    await Deno.writeTextFile(outPath, rewriteRelativeTsSpecifiers(transpiled));
    bakedModules.push({
      moduleId: moduleRecord.id,
      entry: `./project/${jsPath}`,
      generatedRunId: analysis.generatedRunId,
      title: moduleRecord.title,
      sourceText,
    });
  }

  // Durable-entity seeds: the project's saved data tree, verbatim.
  const data: EngineEntityLoadEntry[] = [];
  for (const entry of manifest.data ?? []) {
    const saved = JSON.parse(
      await Deno.readTextFile(join(projectRoot, entry.path)),
    ) as Record<string, unknown>;
    data.push({ type: entry.type, name: entry.name, data: saved });
  }

  const bakedFile: BakedProjectFile = {
    name: manifest.name,
    manifest,
    modules: bakedModules,
    data,
  };
  await Deno.writeTextFile(
    join(engineDir, "baked.json"),
    JSON.stringify(bakedFile, null, 2) + "\n",
  );

  if (options.uiDist) {
    await copyDirectory(resolve(options.uiDist), outDir);
    await stampBootDefaults(join(outDir, "index.html"));
  }

  return { moduleCount: bakedModules.length, dataCount: data.length };
}

if (import.meta.main) {
  const projectRoot = argValue("project");
  const outDir = argValue("out");
  if (!projectRoot || !outDir) {
    console.error("--project <dir> and --out <dir> are required");
    Deno.exit(2);
  }
  const uiDist = argValue("ui") ??
    join(HERE, "../../../livecode-tldraw/dist");
  const result = await bakeProject({
    projectRoot,
    outDir,
    uiDist: (await Deno.stat(join(uiDist, "index.html")).catch(() => null))
      ? uiDist
      : undefined,
  });
  console.log(JSON.stringify({ type: "projectBaked", outDir, ...result }));
}
