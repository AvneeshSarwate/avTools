import { assert, assertEquals } from "jsr:@std/assert@1";
import { fromFileUrl, join } from "jsr:@std/path@1";
import { createLivecodeVisualizerServer } from "../visualizer/server.ts";

const REPO_ROOT = fromFileUrl(new URL("../../../..", import.meta.url));
const EXAMPLE_ROOT = join(
  REPO_ROOT,
  "apps/livecode-tldraw/example-projects/browser-six-sines-piano-roll",
);
const MODULES = [
  ["six-sines-piano-roll/helpers", "six-sines.orig.ts"],
  ["six-sines-piano-roll/seed", "seed.orig.ts"],
  ["six-sines-piano-roll/player", "player.orig.ts"],
] as const;

async function postJson(
  baseUrl: string,
  path: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

Deno.test("Six Sines example is a clean analyzable browser project", async () => {
  const sessionRoot = await Deno.makeTempDir({
    prefix: "six-sines-example-session-",
  });
  const projectRoot = join(sessionRoot, "project");
  await Deno.mkdir(join(projectRoot, "modules"), { recursive: true });
  await Deno.copyFile(
    join(EXAMPLE_ROOT, "project.avtools-livecode.json"),
    join(projectRoot, "project.avtools-livecode.json"),
  );
  for (const [, sourceName] of MODULES) {
    await Deno.copyFile(
      join(EXAMPLE_ROOT, "modules", sourceName),
      join(projectRoot, "modules", sourceName),
    );
  }

  const server = await createLivecodeVisualizerServer({
    host: "127.0.0.1",
    port: 0,
    sessionRoot,
    engineMode: "remote",
  });
  try {
    const opened = await postJson(server.baseUrl, "/project/open", {
      projectPath: projectRoot,
    });
    assertEquals(opened.status, 200);
    assertEquals(opened.body.ok, true);

    const diagnosticsResponse = await fetch(
      `${server.baseUrl}/project/diagnostics`,
    );
    const diagnostics = await diagnosticsResponse.json();
    assertEquals(diagnosticsResponse.status, 200);
    assertEquals(
      diagnostics.denoCheck?.success,
      true,
      diagnostics.denoCheck?.output,
    );
    assertEquals(diagnostics.diagnostics, []);
    assertEquals(diagnostics.project?.manifest?.engineTarget, "browser");

    for (const [moduleId] of MODULES) {
      const analyzed = await postJson(server.baseUrl, "/runtime/analyze", {
        moduleId,
        sourceVersion: 1,
        projectModuleId: moduleId,
      });
      assertEquals(analyzed.status, 200);
      assertEquals(
        analyzed.body.type,
        "analyzeSuccess",
        JSON.stringify(analyzed.body),
      );
    }

    const manifest = diagnostics.project?.manifest;
    const helper = manifest?.modules?.find?.((module: { id?: string }) =>
      module.id === "six-sines-piano-roll/helpers"
    );
    assert(helper, "the project helper must remain a canvas module");
  } finally {
    await server.close();
    await Deno.remove(sessionRoot, { recursive: true }).catch(() => {});
  }
});
