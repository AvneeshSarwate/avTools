import {
  dirname,
  fromFileUrl,
  isAbsolute,
  join,
  normalize,
} from "jsr:@std/path@1";
import {
  Node,
  Project as TsMorphProject,
  SourceFile,
  ts,
} from "npm:ts-morph@23.0.0";
import type {
  AnalyzeFailure,
  ProjectDependencyEdge,
  ProjectModuleRecord,
  ProjectShadowCheckResponse,
  ProjectShadowDiagnostic,
  ProjectShadowModuleStatus,
  VisualizerDiagnostic,
} from "./protocol.ts";
import { analyzeAndTransformTimedModule } from "./analyze_transform.ts";
import { removePathBestEffort } from "./fs_utils.ts";
import { createGeneratedRunId } from "@avtools/livecode-engine/generated_run_id.ts";

interface ProjectSourceModule extends ProjectModuleRecord {
  absoluteSourcePath: string;
  sourceText: string;
  sourceHash: string;
  lastLoadedHash: string | null;
}

interface ProjectShadowAnalysisRequest {
  projectRoot: string;
  project: ProjectShadowCheckResponse["project"];
  modules: ProjectSourceModule[];
  shadowRoot: string;
  repoRoot: string;
  denoConfigPath: string;
  runtimeImport: string;
}

interface ModuleSpecifierRef {
  specifier: string;
  start: number;
  end: number;
  kind: ProjectDependencyEdge["kind"];
}

interface ProjectImportGraph {
  edges: ProjectDependencyEdge[];
  dependenciesByModule: Map<string, Set<string>>;
  dependentsByModule: Map<string, Set<string>>;
}

interface ParsedDenoDiagnostic {
  code: string;
  message: string;
  filePath?: string;
  line?: number;
  column?: number;
  raw: string;
}

export async function analyzeProjectShadow(
  request: ProjectShadowAnalysisRequest,
): Promise<ProjectShadowCheckResponse> {
  const shadowRoot = join(request.shadowRoot, crypto.randomUUID());
  await Deno.mkdir(shadowRoot, { recursive: true });

  try {
    return await analyzeProjectShadowInDirectory(request, shadowRoot);
  } finally {
    await removePathBestEffort(shadowRoot, "shadow dir");
  }
}

async function analyzeProjectShadowInDirectory(
  request: ProjectShadowAnalysisRequest,
  shadowRoot: string,
): Promise<ProjectShadowCheckResponse> {
  const moduleById = new Map(
    request.modules.map((moduleRecord) => [moduleRecord.id, moduleRecord]),
  );
  const moduleByRuntimePath = new Map<string, ProjectSourceModule>();
  const moduleBySourcePath = new Map<string, ProjectSourceModule>();
  for (const moduleRecord of request.modules) {
    moduleByRuntimePath.set(
      normalize(join(request.projectRoot, moduleRecord.runtimePath)),
      moduleRecord,
    );
    moduleBySourcePath.set(
      normalize(join(request.projectRoot, moduleRecord.sourcePath)),
      moduleRecord,
    );
  }

  const graph = buildProjectImportGraph({
    projectRoot: request.projectRoot,
    modules: request.modules,
    moduleByRuntimePath,
    moduleBySourcePath,
  });
  const sourceHashes = new Map(
    request.modules.map((moduleRecord) => [
      moduleRecord.id,
      moduleRecord.sourceHash,
    ]),
  );
  const projectSourceHash = await hashText(
    [...sourceHashes.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, hash]) => `${id}:${hash}`)
      .join("\n"),
  );

  const generatedRunId = createGeneratedRunId();
  const shadowPathByModule = new Map<string, string>();
  const moduleByShadowPath = new Map<string, ProjectSourceModule>();
  const visualizerDiagnostics: ProjectShadowDiagnostic[] = [];

  for (const moduleRecord of request.modules) {
    const shadowPath = normalize(
      join(shadowRoot, moduleRecord.runtimePath),
    );
    shadowPathByModule.set(moduleRecord.id, shadowPath);
    moduleByShadowPath.set(shadowPath, moduleRecord);
    const shadowSource = rewriteNonModuleRelativeImports({
      projectRoot: request.projectRoot,
      sourcePath: moduleRecord.absoluteSourcePath,
      sourceText: moduleRecord.sourceText,
      moduleByRuntimePath,
      moduleBySourcePath,
    });
    const result = analyzeAndTransformTimedModule({
      moduleId: moduleRecord.id,
      sourceVersion: moduleRecord.sourceVersion,
      sourceUri: moduleRecord.absoluteSourcePath,
      sourceText: shadowSource,
      generatedRunId,
      runtimeImport: request.runtimeImport,
      requireDefaultTimedRoot: true,
    });

    await Deno.mkdir(dirname(shadowPath), { recursive: true });
    if (result.type === "analyzeFailure") {
      visualizerDiagnostics.push(
        ...result.diagnostics.map((diagnostic) =>
          fromVisualizerDiagnostic(moduleRecord, diagnostic)
        ),
      );
      await Deno.writeTextFile(shadowPath, shadowSource);
    } else {
      await Deno.writeTextFile(shadowPath, result.transformedCode);
    }
  }

  const denoCheck = await runDenoCheck({
    entryPaths: [...shadowPathByModule.values()],
    denoConfigPath: request.denoConfigPath,
    cwd: request.repoRoot,
  });
  const denoDiagnostics = parseDenoDiagnostics(denoCheck.output)
    .map((diagnostic) =>
      fromDenoDiagnostic(diagnostic, shadowRoot, moduleByShadowPath)
    );
  const diagnostics = [...visualizerDiagnostics, ...denoDiagnostics];
  const diagnosticsByModule = groupDiagnosticsByModule(diagnostics);

  const changedModuleIds = new Set(
    request.modules
      .filter((moduleRecord) =>
        moduleRecord.lastLoadedHash !== null &&
        moduleRecord.sourceHash !== moduleRecord.lastLoadedHash
      )
      .map((moduleRecord) => moduleRecord.id),
  );
  const modules: ProjectShadowModuleStatus[] = request.modules.map(
    (moduleRecord) => {
      const dependencies = sortedIds(
        graph.dependenciesByModule.get(moduleRecord.id),
      );
      const dependents = sortedIds(
        graph.dependentsByModule.get(moduleRecord.id),
      );
      const changedDependencies = [...collectTransitiveDependencies(
        moduleRecord.id,
        graph.dependenciesByModule,
      )]
        .filter((moduleId) => changedModuleIds.has(moduleId))
        .sort();
      const moduleDiagnostics = diagnosticsByModule.get(moduleRecord.id) ?? [];
      const dependencyDiagnostics = moduleDiagnostics;
      return {
        moduleId: moduleRecord.id,
        path: moduleRecord.path,
        dependencies,
        dependents,
        changedDependencies,
        diagnostics: moduleDiagnostics,
        dependencyDiagnostics,
        hasDependencyWarnings: dependencyDiagnostics.length > 0,
      };
    },
  );

  return {
    ok: true,
    project: request.project,
    checkedAt: new Date().toISOString(),
    shadowRoot,
    projectSourceHash,
    edges: graph.edges,
    modules,
    diagnostics,
    denoCheck,
  };
}

/**
 * Hash of every project library file the modules reach through relative
 * imports (transitively, through other library files), so a diagnostics
 * cache keyed on module sources alone cannot outlive a library edit. Manifest
 * modules are hashed by the caller; missing files hash as absent.
 */
export async function hashProjectLibraryClosure(request: {
  projectRoot: string;
  modules: ProjectSourceModule[];
}): Promise<string> {
  const moduleByRuntimePath = new Map(
    request.modules.map((moduleRecord) => [
      normalize(join(request.projectRoot, moduleRecord.runtimePath)),
      moduleRecord,
    ]),
  );
  const moduleBySourcePath = new Map(
    request.modules.map((moduleRecord) => [
      normalize(join(request.projectRoot, moduleRecord.sourcePath)),
      moduleRecord,
    ]),
  );
  const hashes = new Map<string, string>();
  const pending: Array<{ path: string; text: string }> = request.modules.map(
    (moduleRecord) => ({
      path: moduleRecord.absoluteSourcePath,
      text: moduleRecord.sourceText,
    }),
  );
  while (pending.length > 0) {
    const { path, text } = pending.pop()!;
    for (const ref of collectModuleSpecifiers(text, path)) {
      const resolved = resolveProjectImport({
        projectRoot: request.projectRoot,
        sourcePath: path,
        specifier: ref.specifier,
        moduleByRuntimePath,
        moduleBySourcePath,
      });
      if (!resolved || resolved.module || hashes.has(resolved.path)) continue;
      if (!resolved.exists) {
        hashes.set(resolved.path, "absent");
        continue;
      }
      const libraryText = await Deno.readTextFile(resolved.path);
      hashes.set(resolved.path, await hashText(libraryText));
      pending.push({ path: resolved.path, text: libraryText });
    }
  }
  return await hashText(
    [...hashes.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, hash]) => `${path}:${hash}`)
      .join("\n"),
  );
}

export function buildProjectImportGraph(request: {
  projectRoot: string;
  modules: ProjectSourceModule[];
  moduleByRuntimePath?: Map<string, ProjectSourceModule>;
  moduleBySourcePath?: Map<string, ProjectSourceModule>;
}): ProjectImportGraph {
  const moduleByRuntimePath = request.moduleByRuntimePath ??
    new Map(
      request.modules.map((moduleRecord) => [
        normalize(join(request.projectRoot, moduleRecord.runtimePath)),
        moduleRecord,
      ]),
    );
  const moduleBySourcePath = request.moduleBySourcePath ??
    new Map(
      request.modules.map((moduleRecord) => [
        normalize(join(request.projectRoot, moduleRecord.sourcePath)),
        moduleRecord,
      ]),
    );
  const edges: ProjectDependencyEdge[] = [];
  const dependenciesByModule = new Map<string, Set<string>>();
  const dependentsByModule = new Map<string, Set<string>>();

  for (const moduleRecord of request.modules) {
    dependenciesByModule.set(moduleRecord.id, new Set());
    dependentsByModule.set(moduleRecord.id, new Set());
  }

  for (const moduleRecord of request.modules) {
    const specifiers = collectModuleSpecifiers(
      moduleRecord.sourceText,
      moduleRecord.absoluteSourcePath,
    );
    for (const specifierRef of specifiers) {
      const resolved = resolveProjectImport({
        projectRoot: request.projectRoot,
        sourcePath: moduleRecord.absoluteSourcePath,
        specifier: specifierRef.specifier,
        moduleByRuntimePath,
        moduleBySourcePath,
      });
      if (!resolved) continue;
      edges.push({
        fromModuleId: moduleRecord.id,
        toModuleId: resolved.module?.id,
        specifier: specifierRef.specifier,
        kind: specifierRef.kind,
        resolvedPath: resolved.path,
        external: resolved.external,
        unresolved: !resolved.exists,
      });
      if (resolved.module) {
        dependenciesByModule.get(moduleRecord.id)?.add(resolved.module.id);
        dependentsByModule.get(resolved.module.id)?.add(moduleRecord.id);
      }
    }
  }

  return { edges, dependenciesByModule, dependentsByModule };
}

function collectModuleSpecifiers(
  sourceText: string,
  sourceUri: string,
): ModuleSpecifierRef[] {
  const sourceFile = createSourceFile(sourceText, sourceUri);
  const refs: ModuleSpecifierRef[] = [];
  for (const declaration of sourceFile.getImportDeclarations()) {
    const specifier = declaration.getModuleSpecifier();
    refs.push({
      specifier: specifier.getLiteralText(),
      start: specifier.getStart(),
      end: specifier.getEnd(),
      kind: "static",
    });
  }
  for (const declaration of sourceFile.getExportDeclarations()) {
    const specifier = declaration.getModuleSpecifier();
    if (!specifier) continue;
    refs.push({
      specifier: specifier.getLiteralText(),
      start: specifier.getStart(),
      end: specifier.getEnd(),
      kind: "static",
    });
  }
  for (
    const call of sourceFile.getDescendantsOfKind(ts.SyntaxKind.CallExpression)
  ) {
    if (call.getExpression().getText() !== "import") continue;
    const [arg] = call.getArguments();
    if (!Node.isStringLiteral(arg)) continue;
    refs.push({
      specifier: arg.getLiteralText(),
      start: arg.getStart(),
      end: arg.getEnd(),
      kind: "dynamic",
    });
  }
  return refs.sort((a, b) => a.start - b.start);
}

/**
 * Only manifest modules are mirrored into the shadow tree, so a relative
 * import resolves there only when it names one. Every other relative import —
 * a project library file (see "Project libraries are normal code" in
 * `docs/livecode/principles.md`) or a path outside the project — is pointed at
 * the real file so `deno check` follows it in place.
 */
function rewriteNonModuleRelativeImports(request: {
  projectRoot: string;
  sourcePath: string;
  sourceText: string;
  moduleByRuntimePath: Map<string, ProjectSourceModule>;
  moduleBySourcePath: Map<string, ProjectSourceModule>;
}): string {
  const refs = collectModuleSpecifiers(request.sourceText, request.sourcePath);
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  for (const ref of refs) {
    if (!isRelativeSpecifier(ref.specifier)) continue;
    const resolved = resolveProjectImport({
      projectRoot: request.projectRoot,
      sourcePath: request.sourcePath,
      specifier: ref.specifier,
      moduleByRuntimePath: request.moduleByRuntimePath,
      moduleBySourcePath: request.moduleBySourcePath,
    });
    if (resolved?.module) continue;
    replacements.push({
      start: ref.start,
      end: ref.end,
      value: JSON.stringify(
        pathToFileUrl(join(dirname(request.sourcePath), ref.specifier)),
      ),
    });
  }
  if (replacements.length === 0) return request.sourceText;
  let next = request.sourceText;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    next = `${next.slice(0, replacement.start)}${replacement.value}${
      next.slice(replacement.end)
    }`;
  }
  return next;
}

function resolveProjectImport(request: {
  projectRoot: string;
  sourcePath: string;
  specifier: string;
  moduleByRuntimePath: Map<string, ProjectSourceModule>;
  moduleBySourcePath: Map<string, ProjectSourceModule>;
}): {
  path: string;
  module?: ProjectSourceModule;
  external: boolean;
  exists: boolean;
} | null {
  if (!isRelativeSpecifier(request.specifier)) return null;
  const base = normalize(join(dirname(request.sourcePath), request.specifier));
  const candidates = candidateImportPaths(base);
  for (const candidate of candidates) {
    const normalized = normalize(candidate);
    const moduleRecord = request.moduleByRuntimePath.get(normalized) ??
      request.moduleBySourcePath.get(normalized);
    if (moduleRecord) {
      return {
        path: normalized,
        module: moduleRecord,
        external: false,
        exists: true,
      };
    }
  }
  // Not a manifest module: a project library file, or a path outside the
  // project. Report the candidate that exists so the edge is a real file.
  const existing = candidates.find((candidate) => fileExists(candidate));
  const resolved = normalize(existing ?? candidates[0]);
  return {
    path: resolved,
    external: !isInsidePath(resolved, request.projectRoot),
    exists: existing !== undefined,
  };
}

function fileExists(path: string): boolean {
  try {
    return Deno.statSync(path).isFile;
  } catch {
    return false;
  }
}

function candidateImportPaths(path: string): string[] {
  const normalized = normalize(path);
  if (/\.[cm]?[tj]sx?$/.test(normalized)) return [normalized];
  return [
    normalized,
    `${normalized}.ts`,
    `${normalized}.tsx`,
    join(normalized, "mod.ts"),
    join(normalized, "index.ts"),
  ];
}

async function runDenoCheck(request: {
  entryPaths: string[];
  denoConfigPath: string;
  cwd: string;
}): Promise<ProjectShadowCheckResponse["denoCheck"]> {
  if (request.entryPaths.length === 0) {
    return { success: true, code: 0, output: "" };
  }
  const command = new Deno.Command(Deno.execPath(), {
    args: [
      "check",
      "--unstable-webgpu",
      "--unstable-ffi",
      "--no-lock",
      "--config",
      request.denoConfigPath,
      ...request.entryPaths,
    ],
    cwd: request.cwd,
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();
  const stdout = new TextDecoder().decode(output.stdout);
  const stderr = new TextDecoder().decode(output.stderr);
  return {
    success: output.success,
    code: output.code,
    output: [stdout, stderr].filter(Boolean).join("\n"),
  };
}

function parseDenoDiagnostics(output: string): ParsedDenoDiagnostic[] {
  const lines = output.split(/\r?\n/);
  const diagnostics: ParsedDenoDiagnostic[] = [];
  for (let index = 0; index < lines.length; index++) {
    const strippedLine = stripAnsi(lines[index]);
    const header = strippedLine.match(/^([A-Z]+[0-9]+)\s+\[ERROR\]:\s+(.*)$/);
    if (!header) continue;
    const block: string[] = [lines[index]];
    index++;
    while (
      index < lines.length &&
      !/^([A-Z]+[0-9]+)\s+\[ERROR\]:/.test(stripAnsi(lines[index])) &&
      !/^error: /.test(stripAnsi(lines[index]))
    ) {
      block.push(lines[index]);
      index++;
    }
    index--;
    const strippedBlock = block.map(stripAnsi);
    const atLine = strippedBlock
      .map((line) => line.match(/\s+at (file:\/\/.*):(\d+):(\d+)$/))
      .find(Boolean);
    diagnostics.push({
      code: header[1],
      message: header[2],
      filePath: atLine ? normalize(fromFileUrl(atLine[1])) : undefined,
      line: atLine ? Number(atLine[2]) : undefined,
      column: atLine ? Number(atLine[3]) : undefined,
      raw: block.join("\n"),
    });
  }
  return diagnostics;
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

function fromDenoDiagnostic(
  diagnostic: ParsedDenoDiagnostic,
  shadowRoot: string,
  moduleByShadowPath: Map<string, ProjectSourceModule>,
): ProjectShadowDiagnostic {
  const filePath = diagnostic.filePath
    ? normalize(diagnostic.filePath)
    : undefined;
  const moduleRecord = filePath ? moduleByShadowPath.get(filePath) : undefined;
  return {
    source: "deno",
    moduleId: moduleRecord?.id,
    path: moduleRecord?.path ??
      (filePath && isInsidePath(filePath, shadowRoot)
        ? filePath.slice(normalize(shadowRoot).length + 1)
        : filePath),
    code: diagnostic.code,
    message: diagnostic.message,
    line: diagnostic.line,
    column: diagnostic.column,
    raw: diagnostic.raw,
  };
}

function fromVisualizerDiagnostic(
  moduleRecord: ProjectSourceModule,
  diagnostic: VisualizerDiagnostic,
): ProjectShadowDiagnostic {
  return {
    source: "visualizer",
    moduleId: moduleRecord.id,
    path: moduleRecord.path,
    code: diagnostic.code,
    message: diagnostic.message,
    from: diagnostic.from,
    to: diagnostic.to,
    raw: diagnostic.message,
  };
}

function groupDiagnosticsByModule(
  diagnostics: ProjectShadowDiagnostic[],
): Map<string, ProjectShadowDiagnostic[]> {
  const grouped = new Map<string, ProjectShadowDiagnostic[]>();
  for (const diagnostic of diagnostics) {
    if (!diagnostic.moduleId) continue;
    const group = grouped.get(diagnostic.moduleId) ?? [];
    group.push(diagnostic);
    grouped.set(diagnostic.moduleId, group);
  }
  return grouped;
}

export function collectTransitiveDependencies(
  moduleId: string,
  dependenciesByModule: Map<string, Set<string>>,
): Set<string> {
  const visited = new Set<string>();
  const pending = [...dependenciesByModule.get(moduleId) ?? []];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...dependenciesByModule.get(current) ?? []);
  }
  return visited;
}

function sortedIds(values: Set<string> | undefined): string[] {
  return [...values ?? []].sort();
}

function createSourceFile(sourceText: string, sourceUri: string): SourceFile {
  const project = new TsMorphProject({
    compilerOptions: {
      allowImportingTsExtensions: true,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      skipLibCheck: true,
      strict: true,
      target: ts.ScriptTarget.ES2022,
    },
    skipAddingFilesFromTsConfig: true,
  });
  return project.createSourceFile(sourceUri, sourceText, { overwrite: true });
}

function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

function isInsidePath(path: string, parent: string): boolean {
  const normalizedPath = normalize(path);
  const normalizedParent = normalize(parent).replace(/\/+$/, "");
  return normalizedPath === normalizedParent ||
    normalizedPath.startsWith(`${normalizedParent}/`);
}

function pathToFileUrl(path: string): string {
  const normalized = normalize(path);
  if (!isAbsolute(normalized)) {
    throw new Error(`Expected absolute path, got ${path}`);
  }
  return `file://${
    normalized.split("/").map((part, index) =>
      index === 0 ? "" : encodeURIComponent(part)
    ).join("/")
  }`;
}

async function recreateDirectory(path: string) {
  try {
    await Deno.remove(path, { recursive: true });
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  await Deno.mkdir(path, { recursive: true });
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
