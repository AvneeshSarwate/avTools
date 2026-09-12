import { assertEquals } from "jsr:@std/assert@1";
import { copy } from "jsr:@std/fs@1/copy";
import { fromFileUrl, join } from "jsr:@std/path@1";
import type { LivecodeProjectManifest } from "@avtools/livecode-protocol";
import { getDurableEntityType } from "@avtools/livecode-engine/entity_registry.ts";
import { createLivecodeVisualizerServer } from "../visualizer/server.ts";

const EXAMPLE_ROOT = fromFileUrl(
  new URL(
    "../../../livecode-tldraw/example-projects/six-sines-cursor-chords/",
    import.meta.url,
  ),
);
const MANIFEST = "project.avtools-livecode.json";
const MODULE_IDS = [
  "cursor-chords/instrument",
  "cursor-chords/player",
];

async function post(baseUrl: string, path: string, body: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function withFixture(
  mode: "local" | "remote",
  body: (
    baseUrl: string,
    projectRoot: string,
    manifest: LivecodeProjectManifest,
  ) => Promise<void>,
) {
  const sessionRoot = await Deno.makeTempDir({
    prefix: "six-sines-cursor-chords-test-",
  });
  const projectRoot = join(sessionRoot, "project");
  let server:
    | Awaited<ReturnType<typeof createLivecodeVisualizerServer>>
    | undefined;
  let manifest: LivecodeProjectManifest | undefined;
  try {
    await copy(EXAMPLE_ROOT, projectRoot);
    manifest = JSON.parse(await Deno.readTextFile(join(projectRoot, MANIFEST)));
    server = await createLivecodeVisualizerServer({
      host: "127.0.0.1",
      port: 0,
      sessionRoot,
      engineMode: mode,
    });
    await body(server.baseUrl, projectRoot, manifest!);
  } finally {
    await server?.close();
    if (mode === "local") {
      for (const entry of manifest?.data ?? []) {
        getDurableEntityType(entry.type)?.remove(entry.name);
      }
    }
    await Deno.remove(sessionRoot, { recursive: true });
  }
}

Deno.test("Six Sines cursor-chords fixture has clean browser diagnostics and both modules analyze", async () => {
  await withFixture("remote", async (baseUrl, projectRoot, manifest) => {
    assertEquals(manifest.engineTarget, "browser");
    assertEquals(
      manifest.modules.map((module) => module.id).sort(),
      [...MODULE_IDS].sort(),
    );
    const opened = await post(baseUrl, "/project/open", {
      projectPath: projectRoot,
    });
    assertEquals(opened.status, 200);
    assertEquals(opened.body.ok, true);
    const response = await fetch(`${baseUrl}/project/diagnostics`);
    const diagnostics = await response.json();
    const failures: string[] = [];
    if (
      response.status !== 200 || diagnostics.denoCheck?.success !== true ||
      diagnostics.diagnostics?.length !== 0
    ) {
      failures.push(
        `Browser diagnostics:\n${
          diagnostics.denoCheck?.output ?? JSON.stringify(diagnostics)
        }\n${JSON.stringify(diagnostics.diagnostics)}`,
      );
    }
    // Analyze every module even if diagnostics fail, so the fixture owner gets
    // all source-located failures in one run. No browser/audio runtime starts.
    for (const moduleId of MODULE_IDS) {
      const analyzed = await post(baseUrl, "/runtime/analyze", {
        moduleId,
        sourceVersion: 1,
        projectModuleId: moduleId,
      });
      if (analyzed.status !== 200 || analyzed.body.type !== "analyzeSuccess") {
        failures.push(`${moduleId}: ${JSON.stringify(analyzed.body)}`);
      }
    }
    assertEquals(failures, [], failures.join("\n\n"));
    assertEquals(
      diagnostics.project?.manifest?.canvas?.sixSinesViews,
      manifest.canvas?.sixSinesViews,
    );
  });
});
