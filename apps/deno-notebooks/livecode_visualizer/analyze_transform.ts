import MagicString from "npm:magic-string@0.30.17";
import {
  ArrowFunction,
  AwaitExpression,
  CallExpression,
  FunctionDeclaration,
  FunctionExpression,
  Node,
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

export interface AnalyzeAndTransformRequest {
  moduleId: string;
  sourceVersion: number;
  sourceUri: string;
  sourceText: string;
  generatedRunId?: string;
  runtimeImport?: string;
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

interface InstrumentedCallsiteData {
  kind: WaitCallsiteKind;
}

interface InstrumentedCallsite extends InstrumentedCallsiteData {
  id: string;
  call: CallExpression;
  displayName: string;
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
  const diagnostics: VisualizerDiagnostic[] = [];
  const root = findDefaultTimedRoot(sourceFile);

  if (!root) {
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

  processNode(root.fn.getBodyOrThrow(), { ctxNames: new Set([root.ctxName]) });

  for (const callsite of collectSortedInstrumentedCallsites()) {
    const call = callsite.call;
    const start = call.getStart();
    const end = call.getEnd();
    magic.prependLeft(
      start,
      `__tcvVisualizedAwait(${JSON.stringify(request.moduleId)}, ${
        JSON.stringify(callsite.id)
      }, `,
    );
    magic.appendRight(end, ")");
    manifestEntries.push({
      id: callsite.id,
      moduleId: request.moduleId,
      sourceUri: request.sourceUri,
      range: { from: start, to: end },
      kind: callsite.kind,
      displayName: callsite.displayName,
    });
  }

  if (diagnostics.length > 0) return failure(request, diagnostics);

  normalizeDefaultExportToRunFunc(root.fn, magic, request.sourceText);
  magic.prepend(
    `import { visualizedAwait as __tcvVisualizedAwait } from ${
      JSON.stringify(runtimeImport)
    };\n`,
  );
  magic.append("\nexport default runFunc;\n");

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
    return [...instrumentedCalls.entries()].map(([call, data]) => {
      const start = call.getStart();
      const end = call.getEnd();
      const displayName = call.getExpression().getText();
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
      };
    }).sort((a, b) => a.call.getStart() - b.call.getStart());
  }

  function processNode(node: Node, scope: VisualScope) {
    if (Node.isAwaitExpression(node)) {
      processAwait(node, scope);
      return;
    }

    if (Node.isCallExpression(node)) {
      processUnawaitedCall(node, scope);
      processBranchCallback(node, scope);
    }

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
    processNode(body, nextScope);
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
