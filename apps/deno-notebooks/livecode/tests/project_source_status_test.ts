import { assert, assertEquals } from "jsr:@std/assert@1";
import { join } from "jsr:@std/path@1";
import { createLivecodeVisualizerServer } from "../visualizer/server.ts";
import { postJson, waitFor } from "./test_helpers.ts";
import type {
  ProjectModuleWriteConflict,
  ProjectSourceStatusMessage,
} from "../visualizer/protocol.ts";

const SOURCE = `
import type { TimeContext } from "@avtools/core-timing";

export default async function(ctx: TimeContext) {
  await ctx.waitSec(1);
}
`;

async function withProject(
  run: (baseUrl: string, projectRoot: string) => Promise<void>,
) {
  const sessionRoot = await Deno.makeTempDir({
    prefix: "tcv-sources-session-",
  });
  const projectRoot = await Deno.makeTempDir({
    prefix: "tcv-sources-project-",
  });
  const server = await createLivecodeVisualizerServer({
    port: 0,
    sessionRoot,
    logLevel: "info",
  });
  try {
    await postJson(`${server.baseUrl}/project/create`, {
      projectPath: projectRoot,
      name: "source-status",
      modules: [{
        path: "modules/player.ts",
        kind: "runnable",
        title: "player",
        sourceText: SOURCE,
      }],
    });
    await run(server.baseUrl, projectRoot);
  } finally {
    await server.close();
    await Deno.remove(sessionRoot, { recursive: true });
    await Deno.remove(projectRoot, { recursive: true });
  }
}

async function postRaw(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

Deno.test("/project/sources pushes an outside edit and its reload", async () => {
  await withProject(async (baseUrl, projectRoot) => {
    const messages: ProjectSourceStatusMessage[] = [];
    const socket = new WebSocket(
      `${baseUrl.replace(/^http/, "ws")}/project/sources`,
    );
    socket.onmessage = (event) => messages.push(JSON.parse(event.data));
    try {
      await waitFor(() => messages.length > 0, "initial snapshot");
      const initial = messages.at(-1)!;
      assertEquals(initial.projectRoot, projectRoot);
      assertEquals(initial.modules.map((entry) => entry.changedOnDisk), [
        false,
      ]);

      // An editor write is not an outside edit: no changedOnDisk.
      await postJson(`${baseUrl}/project/modules/write`, {
        path: "modules/player.ts",
        sourceText: `${SOURCE}// editor\n`,
        refuseIfChangedOnDisk: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 400));
      assertEquals(messages.at(-1)!.modules[0].changedOnDisk, false);

      await Deno.writeTextFile(
        join(projectRoot, "modules/player.orig.ts"),
        `${SOURCE}// agent\n`,
      );
      await waitFor(
        () => messages.at(-1)!.modules[0].changedOnDisk,
        "changedOnDisk push",
        2_000,
      );

      await postJson(`${baseUrl}/project/modules/reload`, {
        path: "modules/player.ts",
      });
      await waitFor(
        () => !messages.at(-1)!.modules[0].changedOnDisk,
        "reload clears changedOnDisk",
        2_000,
      );
    } finally {
      socket.close();
    }
  });
});

Deno.test("a guarded write refuses to overwrite an outside edit", async () => {
  await withProject(async (baseUrl, projectRoot) => {
    const sourcePath = join(projectRoot, "modules/player.orig.ts");
    await Deno.writeTextFile(sourcePath, `${SOURCE}// agent\n`);

    const refused = await postRaw(`${baseUrl}/project/modules/write`, {
      path: "modules/player.ts",
      sourceText: `${SOURCE}// stale editor buffer\n`,
      refuseIfChangedOnDisk: true,
    });
    assertEquals(refused.status, 409);
    assertEquals(
      (refused.body as ProjectModuleWriteConflict).conflict,
      "changedOnDisk",
    );
    assertEquals(await Deno.readTextFile(sourcePath), `${SOURCE}// agent\n`);

    // Writing what the disk already holds loses nothing, so it is allowed.
    const same = await postRaw(`${baseUrl}/project/modules/write`, {
      path: "modules/player.ts",
      sourceText: `${SOURCE}// agent\n`,
      refuseIfChangedOnDisk: true,
    });
    assertEquals(same.status, 200);

    // A deliberate overwrite (no guard) still wins.
    await Deno.writeTextFile(sourcePath, `${SOURCE}// agent again\n`);
    const forced = await postRaw(`${baseUrl}/project/modules/write`, {
      path: "modules/player.ts",
      sourceText: `${SOURCE}// mine\n`,
    });
    assert(forced.status === 200);
    assertEquals(await Deno.readTextFile(sourcePath), `${SOURCE}// mine\n`);
  });
});

Deno.test("analyzing one module does not accept an outside edit to another", async () => {
  await withProject(async (baseUrl, projectRoot) => {
    await postJson(`${baseUrl}/project/modules/add`, {
      path: "modules/other.ts",
      kind: "runnable",
      title: "other",
      sourceText: SOURCE,
    });
    const playerPath = join(projectRoot, "modules/player.orig.ts");
    await Deno.writeTextFile(playerPath, `${SOURCE}// agent\n`);

    // An editor write to the other module re-materializes the whole project.
    await postJson(`${baseUrl}/project/modules/write`, {
      path: "modules/other.ts",
      sourceText: `${SOURCE}// other edit\n`,
      refuseIfChangedOnDisk: true,
    });

    const refused = await postRaw(`${baseUrl}/project/modules/write`, {
      path: "modules/player.ts",
      sourceText: `${SOURCE}// stale editor buffer\n`,
      refuseIfChangedOnDisk: true,
    });
    assertEquals(refused.status, 409);
    assertEquals(await Deno.readTextFile(playerPath), `${SOURCE}// agent\n`);
  });
});
