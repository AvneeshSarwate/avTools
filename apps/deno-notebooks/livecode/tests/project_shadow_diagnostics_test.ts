import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { join } from "jsr:@std/path@1";
import { createLivecodeVisualizerServer } from "../visualizer/server.ts";
import type {
  AnalyzeSuccess,
  ProjectShadowCheckResponse,
  ProjectStatusResponse,
  RuntimeModuleStatus,
} from "../visualizer/protocol.ts";

Deno.test("shadow diagnostics report dependency issues without rewriting runtime files", async () => {
  const sessionRoot = await Deno.makeTempDir({
    prefix: "tcv-shadow-session-",
  });
  const projectRoot = await Deno.makeTempDir({
    prefix: "tcv-shadow-project-",
  });
  const server = await createLivecodeVisualizerServer({
    port: 0,
    sessionRoot,
    logLevel: "debug",
  });

  try {
    const goodStateSource = `
import type { TimeContext } from "@avtools/core-timing";

export const state = {
  color: [235, 90, 140] as [number, number, number],
  speed: 1,
};

export default async function(_ctx: TimeContext) {}
`;
    const misspelledStateSource = goodStateSource.replace(
      "speed: 1",
      "sped: 1",
    );
    await postJson(`${server.baseUrl}/project/create`, {
      projectPath: projectRoot,
      name: "shadow-diagnostics",
      modules: [
        {
          path: "modules/state.ts",
          kind: "runnable",
          title: "state",
          sourceText: goodStateSource,
        },
        {
          path: "modules/sketch.ts",
          kind: "runnable",
          title: "sketch",
          sourceText: `
import type { TimeContext } from "@avtools/core-timing";
import { state } from "./state.ts";

export default async function(ctx: TimeContext) {
  while (true) {
    state.speed += 0.1;
    await ctx.waitSec(1);
  }
}
`,
        },
        {
          path: "modules/modifiers/color-loop.ts",
          kind: "runnable",
          title: "color loop",
          sourceText: `
import type { TimeContext } from "@avtools/core-timing";
import { state } from "../state.ts";

export default async function(ctx: TimeContext) {
  state.color = [80, 230, 170];
  state.speed = 2;
  await ctx.waitSec(1);
}
`,
        },
      ],
    });

    const cleanDiagnostics = await fetchJson<ProjectShadowCheckResponse>(
      `${server.baseUrl}/project/diagnostics`,
    );
    assertEquals(cleanDiagnostics.ok, true);
    assertEquals(cleanDiagnostics.denoCheck.success, true);
    assert(
      cleanDiagnostics.edges.some((edge) =>
        edge.fromModuleId === "modules/sketch.ts" &&
        edge.toModuleId === "modules/state.ts"
      ),
      "shadow diagnostics should include sketch -> state dependency",
    );
    assert(
      cleanDiagnostics.edges.some((edge) =>
        edge.fromModuleId === "modules/modifiers/color-loop.ts" &&
        edge.toModuleId === "modules/state.ts"
      ),
      "shadow diagnostics should include color-loop -> state dependency",
    );

    await Deno.writeTextFile(
      join(projectRoot, "modules", "state.orig.ts"),
      misspelledStateSource,
    );
    const propertyDiagnostics = await fetchJson<ProjectShadowCheckResponse>(
      `${server.baseUrl}/project/diagnostics`,
    );
    assertEquals(propertyDiagnostics.denoCheck.success, false);
    const propertySketchDiagnostics = requireShadowModule(
      propertyDiagnostics,
      "modules/sketch.ts",
    );
    const propertyColorDiagnostics = requireShadowModule(
      propertyDiagnostics,
      "modules/modifiers/color-loop.ts",
    );
    assert(
      propertySketchDiagnostics.dependencyDiagnostics.some((diagnostic) =>
        diagnostic.message.includes("speed")
      ),
      "sketch should report the misspelled state.speed dependency",
    );
    assert(
      propertyColorDiagnostics.dependencyDiagnostics.some((diagnostic) =>
        diagnostic.message.includes("speed")
      ),
      "color-loop should report the misspelled state.speed dependency",
    );

    await Deno.writeTextFile(
      join(projectRoot, "modules", "state.orig.ts"),
      goodStateSource,
    );
    const fixedPropertyDiagnostics = await fetchJson<
      ProjectShadowCheckResponse
    >(
      `${server.baseUrl}/project/diagnostics`,
    );
    assertEquals(fixedPropertyDiagnostics.denoCheck.success, true);
    assertEquals(
      requireShadowModule(fixedPropertyDiagnostics, "modules/sketch.ts")
        .dependencyDiagnostics,
      [],
    );
    assertEquals(
      requireShadowModule(
        fixedPropertyDiagnostics,
        "modules/modifiers/color-loop.ts",
      )
        .dependencyDiagnostics,
      [],
    );

    const stateAnalyze = await analyzeProjectModule(
      server.baseUrl,
      "modules/state.ts",
    );
    assertEquals(stateAnalyze.type, "analyzeSuccess");
    await launchAnalyzedModule(server.baseUrl, stateAnalyze);

    const sketchAnalyze = await analyzeProjectModule(
      server.baseUrl,
      "modules/sketch.ts",
    );
    await launchAnalyzedModule(server.baseUrl, sketchAnalyze);
    await waitForRuntimeModule(
      server.baseUrl,
      "modules/sketch.ts",
      "sketch running",
      2_000,
    );
    await assertRejects(
      () => launchAnalyzedModule(server.baseUrl, sketchAnalyze),
      Error,
      "already running",
    );

    await Deno.writeTextFile(
      join(projectRoot, "modules", "modifiers", "color-loop.orig.ts"),
      "\n// agent-edited modifier\n",
      { append: true },
    );
    const modifierStatus = await fetchJson<ProjectStatusResponse>(
      `${server.baseUrl}/project/status`,
    );
    const changedColor = requireModuleStatus(
      modifierStatus,
      "modules/modifiers/color-loop.ts",
    );
    const unaffectedSketch = requireModuleStatus(
      modifierStatus,
      "modules/sketch.ts",
    );
    assertEquals(changedColor.changedOnDisk, true);
    assertEquals(unaffectedSketch.runningStale, false);
    assertEquals(unaffectedSketch.changedDependencies, []);

    const runtimeStateBeforeDiagnostics = await Deno.readTextFile(
      join(projectRoot, "modules", "state.ts"),
    );
    await Deno.writeTextFile(
      join(projectRoot, "modules", "state.orig.ts"),
      `
import type { TimeContext } from "@avtools/core-timing";

export const renamedState = {
  color: [10, 20, 30] as [number, number, number],
  speed: 2,
};

export default async function(_ctx: TimeContext) {}
`,
    );

    const staleStatus = await fetchJson<ProjectStatusResponse>(
      `${server.baseUrl}/project/status`,
    );
    const staleSketch = requireModuleStatus(staleStatus, "modules/sketch.ts");
    const staleColor = requireModuleStatus(
      staleStatus,
      "modules/modifiers/color-loop.ts",
    );
    assertEquals(staleSketch.changedDependencies, ["modules/state.ts"]);
    assertEquals(staleSketch.runningStale, true);
    assertEquals(staleColor.changedDependencies, ["modules/state.ts"]);

    const diagnostics = await fetchJson<ProjectShadowCheckResponse>(
      `${server.baseUrl}/project/diagnostics`,
    );
    assertEquals(diagnostics.ok, true);
    assertEquals(diagnostics.denoCheck.success, false);
    const sketchDiagnostics = requireShadowModule(
      diagnostics,
      "modules/sketch.ts",
    );
    const colorDiagnostics = requireShadowModule(
      diagnostics,
      "modules/modifiers/color-loop.ts",
    );
    assertEquals(sketchDiagnostics.hasDependencyWarnings, true);
    assertEquals(colorDiagnostics.hasDependencyWarnings, true);
    assert(
      sketchDiagnostics.dependencyDiagnostics.some((diagnostic) =>
        diagnostic.message.includes("state")
      ),
      "sketch warning should mention the missing state export",
    );
    assert(
      colorDiagnostics.dependencyDiagnostics.some((diagnostic) =>
        diagnostic.message.includes("state")
      ),
      "color-loop warning should mention the missing state export",
    );

    const runtimeStateAfterDiagnostics = await Deno.readTextFile(
      join(projectRoot, "modules", "state.ts"),
    );
    assertEquals(
      runtimeStateAfterDiagnostics,
      runtimeStateBeforeDiagnostics,
      "shadow diagnostics must not overwrite real generated runtime files",
    );
    const brokenStateAnalyze = await analyzeProjectModule(
      server.baseUrl,
      "modules/state.ts",
    );
    assertEquals(
      brokenStateAnalyze.type,
      "analyzeSuccess",
      "state itself should still be runnable while project diagnostics catch dependent import errors",
    );
  } finally {
    await postJson(`${server.baseUrl}/runtime/stop-all`, {});
    await server.close();
    await Deno.remove(sessionRoot, { recursive: true });
    await Deno.remove(projectRoot, { recursive: true });
  }
});

async function analyzeProjectModule(
  baseUrl: string,
  modulePath: string,
): Promise<AnalyzeSuccess> {
  return await postJson<AnalyzeSuccess>(`${baseUrl}/runtime/analyze`, {
    moduleId: modulePath,
    sourceVersion: 1,
    projectModulePath: modulePath,
  });
}

async function launchAnalyzedModule(baseUrl: string, analyze: AnalyzeSuccess) {
  await postJson(`${baseUrl}/runtime/launch`, {
    moduleId: analyze.moduleId,
    transformedModuleUri: analyze.transformedModuleUri,
    generatedRunId: analyze.generatedRunId,
    sourceHash: analyze.sourceHash,
    projectSourceHash: analyze.projectSourceHash,
    projectModulePath: analyze.projectModulePath,
  });
}

function requireModuleStatus(
  status: ProjectStatusResponse,
  moduleId: string,
) {
  const moduleStatus = status.modules.find((moduleEntry) =>
    moduleEntry.id === moduleId
  );
  assert(moduleStatus, `expected status for ${moduleId}`);
  return moduleStatus;
}

function requireShadowModule(
  diagnostics: ProjectShadowCheckResponse,
  moduleId: string,
) {
  const moduleStatus = diagnostics.modules.find((moduleEntry) =>
    moduleEntry.moduleId === moduleId
  );
  assert(moduleStatus, `expected shadow status for ${moduleId}`);
  return moduleStatus;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return await response.json();
}

async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return await response.json();
}

async function waitForRuntimeModule(
  baseUrl: string,
  moduleId: string,
  label: string,
  timeoutMs: number,
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await fetchJson<{ activeModules: RuntimeModuleStatus[] }>(
      `${baseUrl}/runtime/status`,
    );
    if (
      status.activeModules.some((moduleEntry) =>
        moduleEntry.moduleId === moduleId
      )
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}
