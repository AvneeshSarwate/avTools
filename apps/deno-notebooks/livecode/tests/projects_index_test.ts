// Coverage for the projects-index surface: `GET /projects/list` scanning and
// `POST /server/engine-mode` (already-in-mode, restart-callback, and
// no-callback answers). The full page flow is exercised by hand/e2e; these
// tests pin the route contracts the index page depends on.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { join } from "jsr:@std/path@1";
import { createLivecodeVisualizerServer } from "../visualizer/server.ts";
import { fetchJson, postJson, waitFor } from "./test_helpers.ts";
import type {
  EngineModeChangeResponse,
  ProjectsListResponse,
} from "../visualizer/protocol.ts";

async function writeProject(
  root: string,
  name: string,
  manifest: Record<string, unknown> | string,
): Promise<string> {
  const dir = join(root, name);
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(
    join(dir, "project.avtools-livecode.json"),
    typeof manifest === "string" ? manifest : JSON.stringify(manifest),
  );
  return dir;
}

Deno.test("GET /projects/list scans roots for manifests", async () => {
  const sessionRoot = await Deno.makeTempDir({ prefix: "tcv-projects-list-" });
  const projectsRoot = await Deno.makeTempDir({
    prefix: "tcv-projects-root-",
  });

  const alphaDir = await writeProject(projectsRoot, "alpha", {
    version: 1,
    name: "Alpha Project",
    engineTarget: "browser",
    modules: [{ id: "m1", path: "main.ts" }],
  });
  // Nested one level down: found by the recursive scan.
  const nestedDir = await writeProject(
    join(projectsRoot, "nested"),
    "beta",
    { version: 1, name: "Beta Project", modules: [] },
  );
  // Unreadable manifest: listed with an error instead of failing the route.
  const brokenDir = await writeProject(projectsRoot, "broken", "{not json");
  // A project directory must not surface projects nested inside it.
  await writeProject(alphaDir, "shadowed", {
    version: 1,
    name: "Shadowed",
    modules: [],
  });

  const server = await createLivecodeVisualizerServer({
    port: 0,
    sessionRoot,
    projectsRoots: [projectsRoot],
  });
  try {
    const listing = await fetchJson<ProjectsListResponse>(
      `${server.baseUrl}/projects/list`,
    );
    assertEquals(listing.ok, true);
    assertEquals(listing.roots, [projectsRoot]);
    assertEquals(
      listing.projects.map((project) => project.root).sort(),
      [alphaDir, nestedDir, brokenDir].sort(),
    );

    const alpha = listing.projects.find((p) => p.root === alphaDir)!;
    assertEquals(alpha.name, "Alpha Project");
    assertEquals(alpha.engineTarget, "browser");
    assertEquals(alpha.moduleCount, 1);
    assertEquals(alpha.error, undefined);

    const broken = listing.projects.find((p) => p.root === brokenDir)!;
    assertEquals(broken.name, "broken");
    assert(typeof broken.error === "string" && broken.error.length > 0);
  } finally {
    await server.close();
  }
});

Deno.test("POST /server/engine-mode answers per mode and callback", async () => {
  const sessionRoot = await Deno.makeTempDir({ prefix: "tcv-engine-mode-" });

  // Without a restart callback: same mode is a no-op, another mode is 501.
  const fixedServer = await createLivecodeVisualizerServer({
    port: 0,
    sessionRoot,
  });
  try {
    const sameMode = await postJson<EngineModeChangeResponse>(
      `${fixedServer.baseUrl}/server/engine-mode`,
      { mode: "local" },
    );
    assertEquals(sameMode, {
      ok: true,
      mode: "local",
      changed: false,
      restarting: false,
    });

    const refused = await fetch(`${fixedServer.baseUrl}/server/engine-mode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "remote" }),
    });
    assertEquals(refused.status, 501);
    await refused.body?.cancel();

    const invalid = await fetch(`${fixedServer.baseUrl}/server/engine-mode`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "warp" }),
    });
    assertEquals(invalid.status, 400);
    await invalid.body?.cancel();
  } finally {
    await fixedServer.close();
  }

  // With a restart callback: the route answers restarting and invokes it,
  // and a main.ts-style embedder can re-create the server on the same port.
  let requestedMode: "local" | "remote" | null = null;
  const restartable = await createLivecodeVisualizerServer({
    port: 0,
    sessionRoot,
    onEngineModeChangeRequest: (mode) => {
      requestedMode = mode;
    },
  });
  try {
    const changed = await postJson<EngineModeChangeResponse>(
      `${restartable.baseUrl}/server/engine-mode`,
      { mode: "remote" },
    );
    assertEquals(changed, {
      ok: true,
      mode: "remote",
      changed: true,
      restarting: true,
    });
    await waitFor(
      () => requestedMode === "remote",
      "engine-mode change callback",
    );
  } finally {
    await restartable.close();
  }

  const port = restartable.port;
  const remoteServer = await createLivecodeVisualizerServer({
    port,
    sessionRoot,
    engineMode: "remote",
  });
  try {
    assertEquals(remoteServer.port, port);
    const health = await fetchJson<
      { ok: boolean; engine: { mode: string; attached: boolean } }
    >(`${remoteServer.baseUrl}/health`);
    assertEquals(health.engine.mode, "remote");
    assertEquals(health.engine.attached, false);
  } finally {
    await remoteServer.close();
  }
});
