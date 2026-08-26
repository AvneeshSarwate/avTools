// Remote-mode ordering contract: durable entity data reaches whichever engine
// is attached, regardless of whether the project was opened before or after
// the engine arrived. A hello whose resets already contain an entity must NOT
// get it replayed — engine memory is the truth.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { join } from "jsr:@std/path@1";
import { createLivecodeVisualizerServer } from "../visualizer/server.ts";
import { postJson, waitFor } from "./test_helpers.ts";
import type {
  EngineUplinkServerMessage,
} from "../visualizer/protocol.ts";

const TIMELINE_DATA = {
  type: "animationTimeline",
  name: "replay/timeline",
  savedAt: "2026-08-26T00:00:00.000Z",
  data: {
    tracks: [
      {
        id: "x-track",
        name: "x",
        fieldType: "number",
        low: 0,
        high: 1,
        elementData: [
          { id: "x-0", time: 0, value: 0.25 },
          { id: "x-1", time: 1, value: 0.75 },
        ],
      },
    ],
    trackOrder: ["x-track"],
  },
};

async function writeReplayProject(): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: "tcv-replay-project-" });
  await Deno.mkdir(join(root, "data", "animationTimeline"), {
    recursive: true,
  });
  await Deno.writeTextFile(
    join(root, "data", "animationTimeline", "timeline.json"),
    JSON.stringify(TIMELINE_DATA),
  );
  await Deno.writeTextFile(
    join(root, "project.avtools-livecode.json"),
    JSON.stringify({
      version: 1,
      name: "replay-fixture",
      modules: [],
      data: [{
        type: "animationTimeline",
        name: "replay/timeline",
        path: "data/animationTimeline/timeline.json",
      }],
    }),
  );
  return root;
}

/** A fake uplink engine: records loadEntities ops and answers them ok. */
class FakeEngine {
  readonly socket: WebSocket;
  readonly loadOps: Array<{ type: string; name: string }[]> = [];

  constructor(baseUrl: string, helloResets: Record<string, unknown[]>) {
    this.socket = new WebSocket(
      `${baseUrl.replace("http", "ws")}/engine/uplink`,
    );
    this.socket.onopen = () => {
      this.socket.send(JSON.stringify({
        type: "engineHello",
        engineKind: "browser",
        resets: helloResets,
      }));
    };
    this.socket.onmessage = (event) => {
      const message = JSON.parse(
        event.data as string,
      ) as EngineUplinkServerMessage;
      if (message.type !== "engineRequest") return;
      const op = message.op as {
        kind: string;
        entries?: Array<{ type: string; name: string }>;
      };
      let body: unknown = null;
      if (op.kind === "loadEntities") {
        const entries = op.entries ?? [];
        this.loadOps.push(entries.map((e) => ({ type: e.type, name: e.name })));
        body = entries.map((e) => ({
          type: e.type,
          name: e.name,
          ok: true,
          latestJson: null,
        }));
      }
      this.socket.send(JSON.stringify({
        type: "engineResult",
        requestId: message.requestId,
        ok: true,
        body,
      }));
    };
  }

  async close(): Promise<void> {
    this.socket.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

Deno.test("engine attaching after project open receives saved entity data", async () => {
  const sessionRoot = await Deno.makeTempDir({ prefix: "tcv-replay-" });
  const projectRoot = await writeReplayProject();
  const server = await createLivecodeVisualizerServer({
    port: 0,
    sessionRoot,
    engineMode: "remote",
  });
  try {
    // Open with NO engine attached: the load is skipped, not failed.
    const open = await postJson<{ ok: boolean }>(
      `${server.baseUrl}/project/open`,
      { projectPath: projectRoot },
    );
    assertEquals(open.ok, true);

    // A fresh engine (empty resets) attaches: the data must be replayed.
    const fresh = new FakeEngine(server.baseUrl, {});
    await waitFor(
      () => fresh.loadOps.length > 0,
      "replay to fresh engine",
      3_000,
    );
    assertEquals(fresh.loadOps[0], [
      { type: "animationTimeline", name: "replay/timeline" },
    ]);
    await fresh.close();

    // An engine that already holds the entity (hello resets carry it) must
    // not have it replayed over its live state.
    const surviving = new FakeEngine(server.baseUrl, {
      animationTimeline: [{
        name: "replay/timeline",
        rev: 7,
        data: TIMELINE_DATA.data,
        updatedAt: 1,
        updatedBy: "live",
      }],
    });
    // Give a wrongly-sent replay time to arrive before asserting silence.
    await new Promise((resolve) => setTimeout(resolve, 500));
    assertEquals(surviving.loadOps.length, 0);
    await surviving.close();
  } finally {
    await server.close();
  }
});

Deno.test("replay skips only the entities the engine already holds", async () => {
  const sessionRoot = await Deno.makeTempDir({ prefix: "tcv-replay-" });
  const projectRoot = await writeReplayProject();
  // Second saved entity alongside the timeline.
  await Deno.mkdir(join(projectRoot, "data", "pianoRoll"), {
    recursive: true,
  });
  await Deno.writeTextFile(
    join(projectRoot, "data", "pianoRoll", "roll.json"),
    JSON.stringify({
      type: "pianoRoll",
      name: "replay/roll",
      savedAt: "2026-08-26T00:00:00.000Z",
      data: { notes: [] },
    }),
  );
  const manifestPath = join(projectRoot, "project.avtools-livecode.json");
  const manifest = JSON.parse(await Deno.readTextFile(manifestPath));
  manifest.data.push({
    type: "pianoRoll",
    name: "replay/roll",
    path: "data/pianoRoll/roll.json",
  });
  await Deno.writeTextFile(manifestPath, JSON.stringify(manifest));

  const server = await createLivecodeVisualizerServer({
    port: 0,
    sessionRoot,
    engineMode: "remote",
  });
  try {
    await postJson(`${server.baseUrl}/project/open`, {
      projectPath: projectRoot,
    });
    // Engine already holds the roll but not the timeline.
    const engine = new FakeEngine(server.baseUrl, {
      pianoRoll: [{ name: "replay/roll", rev: 3 }],
    });
    await waitFor(
      () => engine.loadOps.length > 0,
      "partial replay",
      3_000,
    );
    assertEquals(engine.loadOps[0], [
      { type: "animationTimeline", name: "replay/timeline" },
    ]);
    assert(engine.loadOps.length === 1);
    await engine.close();
  } finally {
    await server.close();
  }
});
