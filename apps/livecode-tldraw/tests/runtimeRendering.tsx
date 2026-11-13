import React, { useCallback, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type {
  LivecodeRuntimeApi,
  ModuleViewState,
} from "../src/livecodeRuntime";
import { RuntimeViewStore } from "../src/runtimeViewStore";

const counts = { a: 0, b: 0, broad: 0 };
const checks: string[] = [];
const uriA = "file:///a.ts";
const uriB = "file:///b.ts";

function assert(ok: unknown, message: string): void {
  if (!ok) throw new Error(message);
  checks.push(message);
}

function moduleView(moduleId: string): ModuleViewState {
  return {
    moduleId,
    sourceText: "",
    sourceVersion: 0,
    buildStatus: "idle",
    runStatus: "idle",
    diagnostics: [],
    manifest: null,
    history: [],
    activeIds: [],
    pianoRollLookups: {},
    lastSnapshotSeq: null,
    latestError: null,
    runToken: null,
    executionCount: 0,
  };
}

const noOp = () => {};
const noOpAsync = async () => {};
function api(modules: Record<string, ModuleViewState>): LivecodeRuntimeApi {
  return {
    serverBaseUrl: "http://localhost:7777",
    setServerBaseUrl: noOp,
    connectionStatus: "open",
    lspStatus: "ready",
    lspSessionId: "test",
    lspClient: null,
    lspDiagnosticsByUri: {},
    health: null,
    projectDiagnostics: null,
    projectDiagnosticsError: null,
    connectionError: null,
    modules,
    connect: noOpAsync,
    disconnect: noOp,
    registerModule: noOp,
    unregisterModule: noOp,
    setModuleSource: noOp,
    runModule: noOpAsync,
    replaceModule: noOpAsync,
    stopModule: noOpAsync,
  };
}

const store = new RuntimeViewStore();
let current = api({ a: moduleView("a"), b: moduleView("b") });
store.initialize(current);

function Probe({
  moduleId,
  documentUri,
}: {
  moduleId?: string;
  documentUri?: string;
}) {
  const read = useCallback(
    () => store.getSnapshot(moduleId, documentUri),
    [documentUri, moduleId],
  );
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(listener, moduleId, documentUri),
    [documentUri, moduleId],
  );
  const runtime = useSyncExternalStore(subscribe, read, read);
  const key = moduleId ?? "broad";
  counts[key as keyof typeof counts]++;
  return <span>{Object.keys(runtime.modules).join(",")}</span>;
}

function publish(next: LivecodeRuntimeApi): void {
  current = next;
  flushSync(() => store.publish(next));
}

async function run(): Promise<void> {
  const root = createRoot(document.getElementById("root")!);
  flushSync(() =>
    root.render(
      <>
        <Probe moduleId="a" documentUri={uriA} />
        <Probe moduleId="b" documentUri={uriB} />
        <Probe />
      </>,
    ),
  );

  const baseline = { ...counts };
  const bRun = {
    ...current.modules.b,
    runStatus: "running" as const,
    runToken: "run-b",
    executionCount: 1,
    lastSnapshotSeq: 1,
  };
  publish({ ...current, modules: { ...current.modules, b: bRun } });
  assert(counts.a === baseline.a, "module A ignores module B run publication");
  assert(counts.b === baseline.b + 1, "module B renders its run publication");
  assert(
    counts.broad === baseline.broad + 1,
    "broad runtime renders module B run publication",
  );

  const afterRun = { ...counts };
  const bWait = { ...bRun, activeIds: ["wait-b"], lastSnapshotSeq: 2 };
  publish({ ...current, modules: { ...current.modules, b: bWait } });
  assert(counts.a === afterRun.a, "module A ignores module B wait publication");
  assert(counts.b === afterRun.b + 1, "module B renders its wait publication");

  const afterWait = { ...counts };
  const bLookup = {
    ...bWait,
    pianoRollLookups: { callsite: "roll-b" },
    lastSnapshotSeq: 3,
  };
  publish({ ...current, modules: { ...current.modules, b: bLookup } });
  assert(
    counts.a === afterWait.a,
    "module A ignores module B lookup publication",
  );
  assert(
    counts.b === afterWait.b + 1,
    "module B renders its lookup publication",
  );

  const afterLookup = { ...counts };
  publish({
    ...current,
    lspDiagnosticsByUri: { [uriB]: [{ message: "B only" }] },
  });
  assert(
    counts.a === afterLookup.a,
    "module A ignores module B LSP diagnostics",
  );
  assert(
    counts.b === afterLookup.b + 1,
    "module B renders its LSP diagnostics",
  );

  const afterLsp = { ...counts };
  publish({ ...current });
  assert(
    counts.a === afterLsp.a && counts.b === afterLsp.b,
    "equivalent scoped snapshots cause zero module renders",
  );

  const diagnostics = {
    ok: true,
    project: null,
    checkedAt: "first",
    shadowRoot: "/tmp/project",
    projectSourceHash: "one",
    denoCheck: { success: true, code: 0, output: "" },
    modules: [
      { moduleId: "a", dependencyDiagnostics: [] },
      { moduleId: "b", dependencyDiagnostics: [] },
    ],
    diagnostics: [],
    edges: [],
  } as any;
  publish({ ...current, projectDiagnostics: diagnostics });
  const afterProject = { ...counts };
  publish({
    ...current,
    projectDiagnostics: {
      ...diagnostics,
      checkedAt: "second",
      projectSourceHash: "two",
      modules: [
        diagnostics.modules[0],
        { moduleId: "b", dependencyDiagnostics: ["changed"] },
      ],
    },
  });
  assert(
    counts.a === afterProject.a,
    "module A ignores module B project diagnostic changes and global polling metadata",
  );
  assert(
    counts.b === afterProject.b + 1,
    "module B receives its changed project diagnostics",
  );
  assert(
    !("checkedAt" in store.getSnapshot("a", uriA).projectDiagnostics!),
    "scoped diagnostic API excludes global poll fields instead of retaining stale values",
  );
  const equivalentLsp = { ...counts };
  publish({
    ...current,
    lspDiagnosticsByUri: JSON.parse(
      JSON.stringify(current.lspDiagnosticsByUri),
    ),
  });
  assert(
    counts.a === equivalentLsp.a && counts.b === equivalentLsp.b,
    "repeated equivalent LSP arrays do not rerender editors",
  );
  const beforeDelete = { ...counts };
  const savedB = current.modules.b;
  publish({ ...current, modules: { a: current.modules.a } });
  assert(
    counts.a === beforeDelete.a && counts.b === beforeDelete.b + 1,
    "module removal only rerenders its subscriber",
  );
  const beforeRecreate = { ...counts };
  publish({ ...current, modules: { ...current.modules, b: savedB } });
  assert(
    counts.a === beforeRecreate.a && counts.b === beforeRecreate.b + 1,
    "module recreation only rerenders its subscriber",
  );

  flushSync(() => root.unmount());
  (window as any).__runtimeRenderTests = {
    ok: true,
    assertions: checks.length,
    checks,
  };
}

void run().catch((error) => {
  (window as any).__runtimeRenderTests = {
    ok: false,
    error: String(error),
    stack: error.stack,
    checks,
  };
});
