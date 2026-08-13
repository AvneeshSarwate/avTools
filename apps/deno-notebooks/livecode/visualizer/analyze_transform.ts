import MagicString from "npm:magic-string@0.30.17";
import {
  ArrowFunction,
  AwaitExpression,
  CallExpression,
  FunctionDeclaration,
  FunctionExpression,
  ImportDeclaration,
  MethodDeclaration,
  Node,
  ParameterDeclaration,
  Project,
  SourceFile,
  ts,
} from "npm:ts-morph@23.0.0";
import type {
  AnalyzeFailure,
  AnalyzeSuccess,
  VisualizerDiagnostic,
  VisualizerManifestMessage,
  WaitCallsiteKind,
  WaitCallsiteManifestEntry,
} from "./protocol.ts";
import { createGeneratedRunId } from "./generated_run_id.ts";

const TIME_CONTEXT_METHODS = new Set([
  "wait",
  "waitSec",
  "waitFrame",
  "branchWait",
]);
const ALLOWED_UNAWAITED_TIME_CONTEXT_METHODS = new Set(["branch"]);

/**
 * Piano-roll store access helpers whose first argument is the roll name.
 * The transform wraps that argument with `visualizedPianoRollLookup` so the
 * runtime can report the resolved roll name for each callsite.
 */
const PIANO_ROLL_LOOKUP_FUNCTIONS = new Set([
  "getPianoRollClip",
  "setPianoRollClip",
  "getPianoRoll",
  "setPianoRoll",
]);
const PIANO_ROLL_LOOKUP_IMPORT_ALIASES = new Set([
  "piano-roll-helpers",
  "piano-roll-store",
]);
const PIANO_ROLL_LOOKUP_SOURCE_SUFFIXES = [
  "/helpers/piano_roll_helpers.ts",
  "/visualizer/piano_roll_store.ts",
];
const PIANO_ROLL_LOOKUP_SOURCE_BASENAMES = new Set([
  "piano_roll_helpers.ts",
  "piano_roll_store.ts",
]);

/**
 * Canvas-params declarations. Unlike piano-roll access these are pure
 * observation: the manifest records the callsite so the editor can offer a
 * pane for the declared name, and the transform leaves the call untouched.
 */
const CANVAS_PARAMS_FUNCTIONS = new Set(["canvasParams"]);
const CANVAS_PARAMS_IMPORT_ALIASES = new Set(["canvas-params"]);
const CANVAS_PARAMS_SOURCE_SUFFIXES = ["/helpers/canvas_params.ts"];
const CANVAS_PARAMS_SOURCE_BASENAMES = new Set(["canvas_params.ts"]);

export interface AnalyzeAndTransformRequest {
  moduleId: string;
  sourceVersion: number;
  sourceUri: string;
  sourceText: string;
  generatedRunId?: string;
  runtimeImport?: string;
  requireDefaultTimedRoot?: boolean;
  idFactory?: (input: {
    moduleId: string;
    sourceUri: string;
    start: number;
    end: number;
    displayName: string;
    index: number;
  }) => string;
}

export type AnalyzeAndTransformResult =
  | (AnalyzeSuccess & { transformedCode: string; diagnostics: [] })
  | AnalyzeFailure;

interface RootFunctionInfo {
  fn: FunctionDeclaration;
  ctxName: string;
}

interface VisualScope {
  ctxNames: Set<string>;
}

interface VisualFunctionScope extends VisualScope {
  body: Node;
  owner: Node;
}

interface InstrumentedCallsiteData {
  kind: WaitCallsiteKind;
  staticName?: string;
  nameArgRange?: { from: number; to: number };
}

interface InstrumentedCallsite extends InstrumentedCallsiteData {
  id: string;
  call: CallExpression;
  displayName: string;
  nameArg?: Node;
}

/**
 * Local bindings of one recognized helper module, resolved to ts-morph
 * symbols so a same-named local function or unrelated import is ignored.
 */
interface HelperImportBindings {
  named: Map<ts.Symbol, { importedName: string }>;
  namespaces: Map<ts.Symbol, { moduleSpecifier: string }>;
}

export function analyzeAndTransformTimedModule(
  request: AnalyzeAndTransformRequest,
): AnalyzeAndTransformResult {
  const project = new Project({
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

  const sourceFile = project.createSourceFile(
    request.sourceUri,
    request.sourceText,
    { overwrite: true },
  );
  // Read parse diagnostics straight off the parsed source file to avoid forcing
  // full TS program construction on the hot (no-error) analyze path. Fall back
  // to the program path if the internal array is unavailable so behavior never
  // regresses.
  const parseDiagnostics = (sourceFile.compilerNode as unknown as {
    parseDiagnostics?: ts.DiagnosticWithLocation[];
  }).parseDiagnostics;
  const syntacticDiagnostics = parseDiagnostics ??
    project.getProgram().compilerObject.getSyntacticDiagnostics(
      sourceFile.compilerNode,
    );
  if (syntacticDiagnostics.length > 0) {
    return failure(
      request,
      syntacticDiagnostics.map((diagnostic) =>
        fromSyntacticDiagnostic(request.sourceText, diagnostic)
      ),
    );
  }

  const diagnostics: VisualizerDiagnostic[] = [];
  const root = findDefaultTimedRoot(sourceFile);

  if (!root && request.requireDefaultTimedRoot !== false) {
    return failure(request, [{
      severity: "error",
      code: "TCV_NO_DEFAULT_TIMED_ROOT",
      message:
        "Expected a default exported async function with a TimeContext parameter.",
      from: 0,
      to: Math.min(request.sourceText.length, 1),
    }]);
  }

  const magic = new MagicString(request.sourceText);
  const manifestEntries: WaitCallsiteManifestEntry[] = [];
  let callsiteIndex = 0;
  const idFactory = request.idFactory ?? defaultIdFactory;
  const runtimeImport = request.runtimeImport ??
    "./timeContextVisualizerRuntime.ts";
  const instrumentedCalls = new Map<CallExpression, InstrumentedCallsiteData>();
  const processedBodies = new Set<Node>();
  const pianoRollLookupBindings = collectPianoRollLookupImports(sourceFile);
  const canvasParamsBindings = collectCanvasParamsImports(sourceFile);

  for (const scope of collectVisualFunctionScopes(sourceFile)) {
    processVisualBody(scope);
  }
  collectCanvasParamsCallsites();

  let hasWrappedCallsite = false;
  for (const callsite of collectSortedInstrumentedCallsites()) {
    const call = callsite.call;
    const start = call.getStart();
    const end = call.getEnd();
    if (callsite.kind === "canvasParams") {
      // Observation only: the manifest entry is the whole feature, so this
      // kind deliberately emits no wrapper and no runtime import.
    } else if (callsite.kind === "pianoRollLookup" && callsite.nameArg) {
      hasWrappedCallsite = true;
      const argStart = callsite.nameArg.getStart();
      const argEnd = callsite.nameArg.getEnd();
      magic.prependLeft(
        argStart,
        `__tcvPianoRollLookup(${JSON.stringify(request.moduleId)}, ${
          JSON.stringify(callsite.id)
        }, `,
      );
      magic.appendRight(argEnd, ")");
    } else {
      hasWrappedCallsite = true;
      magic.prependLeft(
        start,
        `__tcvVisualizedAwait(${JSON.stringify(request.moduleId)}, ${
          JSON.stringify(callsite.id)
        }, `,
      );
      magic.appendRight(end, ")");
    }
    manifestEntries.push({
      id: callsite.id,
      moduleId: request.moduleId,
      sourceUri: request.sourceUri,
      range: { from: start, to: end },
      kind: callsite.kind,
      displayName: callsite.displayName,
      ...(callsite.staticName !== undefined
        ? { staticName: callsite.staticName }
        : {}),
      ...(callsite.nameArgRange !== undefined
        ? { nameArgRange: callsite.nameArgRange }
        : {}),
    });
  }

  const rootAliasName = root?.fn.getName();
  const shouldAliasRootName = rootAliasName !== undefined &&
    rootAliasName !== "runFunc";
  if (
    root && shouldAliasRootName &&
    hasConflictingTopLevelBinding(sourceFile, rootAliasName, root.fn)
  ) {
    addDiagnostic(
      "TCV_DEFAULT_EXPORT_RENAME_COLLISION",
      `Cannot preserve recursive default export name "${rootAliasName}" because another top-level binding already uses it.`,
      root.fn,
    );
  }

  if (diagnostics.length > 0) return failure(request, diagnostics);

  if (root) {
    normalizeDefaultExportToRunFunc(root.fn, magic, request.sourceText);
    if (shouldAliasRootName) {
      magic.appendLeft(
        root.fn.getEnd(),
        `\nconst ${rootAliasName} = runFunc;\n`,
      );
    }
    magic.append("\nexport default runFunc;\n");
  }
  // Keyed on wrapped callsites, not on the manifest: a module whose only
  // manifest entries are `canvasParams` observations must import nothing.
  if (hasWrappedCallsite) {
    magic.prepend(
      `import { visualizedAwait as __tcvVisualizedAwait, visualizedPianoRollLookup as __tcvPianoRollLookup } from ${
        JSON.stringify(runtimeImport)
      };\n`,
    );
  }

  const generatedRunId = request.generatedRunId ?? createGeneratedRunId();
  const manifest: VisualizerManifestMessage = {
    type: "manifest",
    moduleId: request.moduleId,
    sourceVersion: request.sourceVersion,
    callsites: manifestEntries,
  };

  return {
    type: "analyzeSuccess",
    moduleId: request.moduleId,
    sourceVersion: request.sourceVersion,
    generatedRunId,
    manifest,
    transformedModuleUri: "",
    transformedCode: magic.toString(),
    diagnostics: [],
  };

  function collectSortedInstrumentedCallsites(): InstrumentedCallsite[] {
    return [...instrumentedCalls.entries()].sort(([a], [b]) =>
      a.getStart() - b.getStart()
    ).map(([call, data]) => {
      const start = call.getStart();
      const end = call.getEnd();
      const displayName = call.getExpression().getText();
      const nameArg = data.kind === "pianoRollLookup"
        ? call.getArguments()[0]
        : undefined;
      return {
        call,
        id: idFactory({
          moduleId: request.moduleId,
          sourceUri: request.sourceUri,
          start,
          end,
          displayName,
          index: callsiteIndex++,
        }),
        kind: data.kind,
        displayName,
        ...(data.staticName !== undefined
          ? { staticName: data.staticName }
          : {}),
        ...(data.nameArgRange !== undefined
          ? { nameArgRange: data.nameArgRange }
          : {}),
        ...(nameArg ? { nameArg } : {}),
      };
    });
  }

  function collectVisualFunctionScopes(sourceFile: SourceFile) {
    return sourceFile.getDescendants()
      .map((node): VisualFunctionScope | null => {
        const body = getFunctionBody(node);
        if (!body) return null;

        const ctxNames = getTimeContextParameterNames(node);
        if (ctxNames.length === 0) return null;

        return {
          body,
          ctxNames: new Set(ctxNames),
          owner: node,
        };
      })
      .filter((scope): scope is VisualFunctionScope => Boolean(scope))
      .sort((a, b) => a.owner.getStart() - b.owner.getStart());
  }

  function processVisualBody(scope: VisualFunctionScope) {
    if (processedBodies.has(scope.body)) return;
    processedBodies.add(scope.body);
    processNode(scope.body, scope);
  }

  function processNode(node: Node, scope: VisualScope) {
    if (Node.isAwaitExpression(node)) {
      processAwait(node, scope);
      // The awaited call itself is handled by processAwait, but non-await
      // instrumentation such as piano-roll lookups can appear inside the
      // awaited expression's callee/arguments and must still be discovered.
      processChildNodes(node.getExpression(), scope);
      return;
    }

    if (Node.isCallExpression(node)) {
      processUnawaitedCall(node, scope);
      processBranchCallback(node, scope);
      processPianoRollLookup(node);
    }

    processChildNodes(node, scope);
  }

  function processChildNodes(node: Node, scope: VisualScope) {
    node.forEachChild((child) => {
      if (isNestedFunctionLike(child)) return;
      processNode(child, scope);
    });
  }

  function processAwait(awaitExpr: AwaitExpression, scope: VisualScope) {
    const expr = awaitExpr.getExpression();
    if (!Node.isCallExpression(expr)) {
      addDiagnostic(
        "TCV_UNSUPPORTED_AWAIT",
        "Only direct awaited calls can be visualized in a timed module.",
        awaitExpr,
      );
      return;
    }

    processBranchCallback(expr, scope);
    processPianoRollLookup(expr);

    if (isDynamicTimeContextCall(expr, scope.ctxNames)) {
      addDiagnostic(
        "TCV_DYNAMIC_TIME_CONTEXT_CALL",
        "Dynamic TimeContext method access is unsupported. Use direct ctx.wait(...) style calls.",
        expr,
      );
      return;
    }

    if (isSupportedAwaitedCall(expr, scope.ctxNames)) {
      instrumentedCalls.set(expr, {
        kind: getDirectTimeContextMethod(expr, scope.ctxNames)
          ? "timeContextMethod"
          : "timeContextArgumentCall",
      });
      return;
    }

    addDiagnostic(
      "TCV_UNSUPPORTED_AWAIT",
      "Awaited calls in timed modules must call a TimeContext method or receive a TimeContext argument.",
      awaitExpr,
    );
  }

  function processUnawaitedCall(call: CallExpression, scope: VisualScope) {
    if (isAllowedUnawaitedBranch(call, scope.ctxNames)) return;

    if (isDynamicTimeContextCall(call, scope.ctxNames)) {
      addDiagnostic(
        "TCV_DYNAMIC_TIME_CONTEXT_CALL",
        "Dynamic TimeContext method access is unsupported. Use direct ctx.wait(...) style calls.",
        call,
      );
      return;
    }

    const directMethod = getDirectTimeContextMethod(call, scope.ctxNames);
    if (directMethod) {
      addDiagnostic(
        "TCV_UNAWAITED_TIMED_CALL",
        `TimeContext call ctx.${directMethod} must be awaited or launched through ctx.branch(...).`,
        call,
      );
      return;
    }

    if (
      callHasTimeContextArgument(call, scope.ctxNames) &&
      returnsPromiseLike(call)
    ) {
      addDiagnostic(
        "TCV_UNAWAITED_TIMED_CALL",
        "Promise-like calls that receive a TimeContext must be directly awaited.",
        call,
      );
    }
  }

  function processPianoRollLookup(call: CallExpression) {
    const target = resolvePianoRollLookupTarget(call);
    if (!target) return;

    const args = call.getArguments();
    const nameArg = args[0];
    if (!nameArg) return;
    const staticName = extractStaticRollName(nameArg);
    const nameArgRange = {
      from: nameArg.getStart(),
      to: nameArg.getEnd(),
    };
    instrumentedCalls.set(call, {
      kind: "pianoRollLookup",
      ...(staticName !== undefined ? { staticName } : {}),
      nameArgRange,
    });
  }

  function resolvePianoRollLookupTarget(
    call: CallExpression,
  ): { importedName: string } | null {
    return resolveHelperCallTarget(
      call,
      pianoRollLookupBindings,
      PIANO_ROLL_LOOKUP_FUNCTIONS,
    );
  }

  /**
   * Params are normally declared at module scope, so this pass walks the whole
   * file rather than the `TimeContext` scopes: a declaration inside a timed
   * body, at top level, or inside any other function is equally real. It
   * returns immediately for a module that does not import `canvas-params`, so
   * detection costs nothing for every other module.
   */
  function collectCanvasParamsCallsites() {
    if (
      canvasParamsBindings.named.size === 0 &&
      canvasParamsBindings.namespaces.size === 0
    ) {
      return;
    }
    sourceFile.forEachDescendant((node) => {
      if (Node.isCallExpression(node)) processCanvasParams(node);
    });
  }

  function processCanvasParams(call: CallExpression) {
    const target = resolveHelperCallTarget(
      call,
      canvasParamsBindings,
      CANVAS_PARAMS_FUNCTIONS,
    );
    if (!target) return;

    const nameArg = call.getArguments()[0];
    if (!nameArg) return;
    const staticName = extractStaticRollName(nameArg);
    instrumentedCalls.set(call, {
      kind: "canvasParams",
      ...(staticName !== undefined ? { staticName } : {}),
      nameArgRange: { from: nameArg.getStart(), to: nameArg.getEnd() },
    });
  }

  function extractStaticRollName(node: Node): string | undefined {
    if (Node.isStringLiteral(node)) return node.getLiteralValue();
    if (Node.isNoSubstitutionTemplateLiteral(node)) {
      return node.getLiteralValue();
    }
    return undefined;
  }

  function processBranchCallback(call: CallExpression, scope: VisualScope) {
    const method = getDirectTimeContextMethod(call, scope.ctxNames);
    if (method !== "branch" && method !== "branchWait") return;

    const callback = call.getArguments()[0];
    if (
      !Node.isArrowFunction(callback) && !Node.isFunctionExpression(callback)
    ) return;

    const callbackCtx = callback.getParameters()[0]?.getName();
    if (!callbackCtx) {
      addDiagnostic(
        "TCV_BRANCH_CALLBACK_CTX",
        "Branch callbacks must accept a TimeContext parameter.",
        callback,
      );
      return;
    }

    const nextScope = { ctxNames: new Set([...scope.ctxNames, callbackCtx]) };
    const body = callback.getBody();
    processVisualBody({ body, owner: callback, ...nextScope });
  }

  function isSupportedAwaitedCall(call: CallExpression, ctxNames: Set<string>) {
    return Boolean(getDirectTimeContextMethod(call, ctxNames)) ||
      callHasTimeContextArgument(call, ctxNames);
  }

  function getDirectTimeContextMethod(
    call: CallExpression,
    ctxNames: Set<string>,
  ): string | null {
    const expr = call.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) return null;
    const receiver = expr.getExpression();
    if (!Node.isIdentifier(receiver) || !ctxNames.has(receiver.getText())) {
      return null;
    }
    const method = expr.getName();
    return TIME_CONTEXT_METHODS.has(method) ||
        ALLOWED_UNAWAITED_TIME_CONTEXT_METHODS.has(method)
      ? method
      : null;
  }

  function isAllowedUnawaitedBranch(
    call: CallExpression,
    ctxNames: Set<string>,
  ) {
    const method = getDirectTimeContextMethod(call, ctxNames);
    return method === "branch";
  }

  function isDynamicTimeContextCall(
    call: CallExpression,
    ctxNames: Set<string>,
  ) {
    const expr = call.getExpression();
    if (!Node.isElementAccessExpression(expr)) return false;
    const receiver = expr.getExpression();
    return Node.isIdentifier(receiver) && ctxNames.has(receiver.getText());
  }

  function callHasTimeContextArgument(
    call: CallExpression,
    ctxNames: Set<string>,
  ) {
    return call.getArguments().some((arg) =>
      Node.isIdentifier(arg) && ctxNames.has(arg.getText())
    );
  }

  function returnsPromiseLike(call: CallExpression) {
    const returnType = call.getReturnType();
    const text = returnType.getText(call);
    if (text.includes("Promise") || text.includes("PromiseLike")) return true;
    const thenProp = returnType.getProperty("then");
    return Boolean(thenProp);
  }

  function isNestedFunctionLike(node: Node) {
    return Node.isArrowFunction(node) ||
      Node.isFunctionExpression(node) ||
      Node.isFunctionDeclaration(node) ||
      Node.isMethodDeclaration(node);
  }

  function addDiagnostic(code: string, message: string, node: Node) {
    diagnostics.push({
      severity: "error",
      code,
      message,
      from: node.getStart(),
      to: node.getEnd(),
    });
  }
}

function getFunctionBody(node: Node): Node | null {
  if (Node.isArrowFunction(node)) return node.getBody();
  if (Node.isFunctionDeclaration(node)) return node.getBody() ?? null;
  if (Node.isFunctionExpression(node)) return node.getBody();
  if (Node.isMethodDeclaration(node)) return node.getBody() ?? null;
  return null;
}

function getTimeContextParameterNames(node: Node): string[] {
  if (!hasParameters(node)) return [];
  return node.getParameters()
    .filter(isTimeContextParameter)
    .map((parameter) => parameter.getName());
}

function hasParameters(
  node: Node,
): node is
  | ArrowFunction
  | FunctionDeclaration
  | FunctionExpression
  | MethodDeclaration {
  return Node.isArrowFunction(node) ||
    Node.isFunctionDeclaration(node) ||
    Node.isFunctionExpression(node) ||
    Node.isMethodDeclaration(node);
}

function isTimeContextParameter(parameter: ParameterDeclaration) {
  const paramType = parameter.getTypeNode()?.getText() ??
    parameter.getType().getText(parameter);
  return /\bTimeContext\b/.test(paramType);
}

function fromSyntacticDiagnostic(
  sourceText: string,
  diagnostic: ts.Diagnostic,
): VisualizerDiagnostic {
  const start = diagnostic.start ?? 0;
  const length = diagnostic.length ?? 1;
  return {
    severity: "error",
    code: "TCV_SYNTAX_ERROR",
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    from: clampOffset(start, sourceText.length),
    to: clampOffset(start + length, sourceText.length),
  };
}

function hasConflictingTopLevelBinding(
  sourceFile: SourceFile,
  name: string,
  excluded: Node,
): boolean {
  return sourceFile.getStatements().some((statement) => {
    if (statement === excluded) return false;
    if (
      (Node.isFunctionDeclaration(statement) ||
        Node.isClassDeclaration(statement) ||
        Node.isInterfaceDeclaration(statement) ||
        Node.isEnumDeclaration(statement) ||
        Node.isModuleDeclaration(statement)) &&
      statement.getName() === name
    ) {
      return true;
    }
    if (Node.isVariableStatement(statement)) {
      return statement.getDeclarations().some((declaration) =>
        declaration.getName() === name
      );
    }
    if (Node.isImportDeclaration(statement)) {
      return importDeclarationBindsName(statement, name);
    }
    return false;
  });
}

function importDeclarationBindsName(
  statement: ImportDeclaration,
  name: string,
): boolean {
  // Default import: `import loop from "..."`
  if (statement.getDefaultImport()?.getText() === name) return true;
  // Namespace import: `import * as loop from "..."`
  if (statement.getNamespaceImport()?.getText() === name) return true;
  // Named imports incl. aliases: `import { loop }` / `import { x as loop }`
  return statement.getNamedImports().some((named) =>
    (named.getAliasNode() ?? named.getNameNode()).getText() === name
  );
}

function clampOffset(value: number, max: number): number {
  return Math.max(0, Math.min(max, value));
}

function failure(
  request: AnalyzeAndTransformRequest,
  diagnostics: VisualizerDiagnostic[],
): AnalyzeFailure {
  return {
    type: "analyzeFailure",
    moduleId: request.moduleId,
    sourceVersion: request.sourceVersion,
    diagnostics,
  };
}

function findDefaultTimedRoot(sourceFile: SourceFile): RootFunctionInfo | null {
  const fn = sourceFile.getFunctions().find((candidate) =>
    candidate.isDefaultExport()
  );
  if (!fn) return null;
  if (!fn.isAsync()) return null;

  const firstParam = fn.getParameters()[0];
  if (!firstParam) return null;

  const paramType = firstParam.getTypeNode()?.getText() ??
    firstParam.getType().getText(firstParam);
  if (!/\bTimeContext\b/.test(paramType)) return null;

  return { fn, ctxName: firstParam.getName() };
}

function normalizeDefaultExportToRunFunc(
  fn: FunctionDeclaration,
  magic: MagicString,
  sourceText: string,
) {
  const start = fn.getStart();
  const body = fn.getBodyOrThrow();
  const header = sourceText.slice(start, body.getStart());
  const exportDefaultIndex = header.indexOf("export default");
  if (exportDefaultIndex >= 0) {
    magic.overwrite(
      start + exportDefaultIndex,
      start + exportDefaultIndex + "export default".length,
      "export",
    );
  }

  const nameNode = fn.getNameNode();
  if (nameNode) {
    magic.overwrite(nameNode.getStart(), nameNode.getEnd(), "runFunc");
    return;
  }

  const functionIndex = header.indexOf("function");
  if (functionIndex < 0) return;
  magic.appendLeft(start + functionIndex + "function".length, " runFunc");
}

function defaultIdFactory(): string {
  return crypto.randomUUID();
}

/**
 * Collects the set of locally-bound names that are imported from a
 * piano-roll store / helper module. Used to restrict piano-roll lookup
 * instrumentation to genuine store access calls rather than same-named
 * helpers from unrelated modules.
 */
function collectPianoRollLookupImports(
  sourceFile: SourceFile,
): HelperImportBindings {
  return collectHelperImports(
    sourceFile,
    PIANO_ROLL_LOOKUP_FUNCTIONS,
    isPianoRollLookupModuleSpecifier,
  );
}

/** The same binding discipline for `canvasParams` declarations. */
function collectCanvasParamsImports(
  sourceFile: SourceFile,
): HelperImportBindings {
  return collectHelperImports(
    sourceFile,
    CANVAS_PARAMS_FUNCTIONS,
    isCanvasParamsModuleSpecifier,
  );
}

function collectHelperImports(
  sourceFile: SourceFile,
  functionNames: Set<string>,
  isRecognizedSpecifier: (specifier: string) => boolean,
): HelperImportBindings {
  const named = new Map<ts.Symbol, { importedName: string }>();
  const namespaces = new Map<ts.Symbol, { moduleSpecifier: string }>();
  for (const declaration of sourceFile.getImportDeclarations()) {
    const specifier = declaration.getModuleSpecifierValue();
    if (!isRecognizedSpecifier(specifier)) continue;

    for (const clause of declaration.getNamedImports()) {
      const importedName = clause.getName();
      if (!functionNames.has(importedName)) continue;
      const localName = clause.getAliasNode() ?? clause.getNameNode();
      const symbol = localName.getSymbol()?.compilerSymbol;
      if (symbol) named.set(symbol, { importedName });
    }

    const namespaceImport = declaration.getNamespaceImport();
    const namespaceSymbol = namespaceImport?.getSymbol()?.compilerSymbol;
    if (namespaceSymbol) {
      namespaces.set(namespaceSymbol, { moduleSpecifier: specifier });
    }
  }
  return { named, namespaces };
}

/**
 * Resolves a call to one of `functionNames` imported from a recognized module,
 * through the local symbol for a named/aliased import or through a namespace
 * import receiver. Re-export chains and arbitrary receiver expressions are not
 * traced.
 */
function resolveHelperCallTarget(
  call: CallExpression,
  bindings: HelperImportBindings,
  functionNames: Set<string>,
): { importedName: string } | null {
  const expr = call.getExpression();
  if (Node.isIdentifier(expr)) {
    const symbol = expr.getSymbol()?.compilerSymbol;
    return symbol ? bindings.named.get(symbol) ?? null : null;
  }

  if (Node.isPropertyAccessExpression(expr)) {
    const importedName = expr.getName();
    if (!functionNames.has(importedName)) return null;
    const receiver = expr.getExpression();
    if (!Node.isIdentifier(receiver)) return null;
    const namespaceSymbol = receiver.getSymbol()?.compilerSymbol;
    return namespaceSymbol && bindings.namespaces.has(namespaceSymbol)
      ? { importedName }
      : null;
  }

  return null;
}

function isPianoRollLookupModuleSpecifier(specifier: string): boolean {
  return matchesHelperModuleSpecifier(
    specifier,
    PIANO_ROLL_LOOKUP_IMPORT_ALIASES,
    PIANO_ROLL_LOOKUP_SOURCE_SUFFIXES,
    PIANO_ROLL_LOOKUP_SOURCE_BASENAMES,
  );
}

function isCanvasParamsModuleSpecifier(specifier: string): boolean {
  return matchesHelperModuleSpecifier(
    specifier,
    CANVAS_PARAMS_IMPORT_ALIASES,
    CANVAS_PARAMS_SOURCE_SUFFIXES,
    CANVAS_PARAMS_SOURCE_BASENAMES,
  );
}

function matchesHelperModuleSpecifier(
  specifier: string,
  aliases: Set<string>,
  sourceSuffixes: string[],
  basenames: Set<string>,
): boolean {
  const normalized = specifier.replaceAll("\\", "/");
  if (aliases.has(normalized)) return true;
  if (sourceSuffixes.some((suffix) => normalized.endsWith(suffix))) return true;
  return basenames.has(normalized.replace(/^\.\//, ""));
}
