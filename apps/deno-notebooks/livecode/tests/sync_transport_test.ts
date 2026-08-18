import { assert, assertEquals } from "jsr:@std/assert@1";
import { join, toFileUrl } from "jsr:@std/path@1";
import { createLivecodeVisualizerServer } from "../visualizer/server.ts";
import {
  fetchJson,
  postJson,
  sleep,
  SyncClient,
  waitFor,
} from "./test_helpers.ts";
import {
  clearAllPianoRollLookups,
  clearAllWaits,
  clearModulePianoRollLookups,
  clearModuleWaits,
  enterWait,
  exitWait,
  recordPianoRollLookup,
} from "@avtools/livecode-engine/runtime.ts";
import {
  createModuleLookupsSyncSource,
  createModuleWaitsSyncSource,
} from "@avtools/livecode-engine/sync_sources.ts";
import type {
  ActiveWaitSnapshot,
  AnalyzeSuccess,
  ModuleWaitsEntity,
  ParamsEntity,
  PianoRollObject,
  PianoRollSnapshot,
  RunEntity,
  SignalEntity,
  SyncEntityChange,
} from "../visualizer/protocol.ts";

// The multiplexed transport, driven over a real socket against a real server.
// Everything asserted here is the contract the client builds on: resets replace
// a per-type map, changes ship per entity, `entity: null` means deleted, `seq`
// is per socket, and the deprecated `/runtime/snapshots` shim keeps getting its
// full envelope off the SAME tick.

async function withServer(
  prefix: string,
  body: (server: {
    baseUrl: string;
    sessionRoot: string;
  }) => Promise<void>,
): Promise<void> {
  const sessionRoot = await Deno.makeTempDir({ prefix });
  const server = await createLivecodeVisualizerServer({
    port: 0,
    sessionRoot,
    logLevel: "debug",
  });
  try {
    await body({ baseUrl: server.baseUrl, sessionRoot });
  } finally {
    await server.close();
    await Deno.remove(sessionRoot, { recursive: true });
  }
}

Deno.test("subscribe resets every listed type and replaces the previous set", async () => {
  await withServer("tcv-sync-subscribe-", async ({ baseUrl }) => {
    await postJson(`${baseUrl}/piano-roll/set`, {
      name: "sync/subscribe-roll",
      data: { notes: [{ id: "n1", pitch: 60, position: 0, duration: 1 }] },
    });

    const client = await SyncClient.open(baseUrl);
    try {
      const first = await client.subscribe(["pianoRoll", "params", "nope"]);
      // Resets arrive for ALL listed types, including one nothing is
      // registered for: a reset REPLACES the client's per-type map, so an
      // omitted key would leave a stale map behind instead of emptying it.
      assertEquals(
        Object.keys(first.resets ?? {}).sort(),
        ["nope", "params", "pianoRoll"],
      );
      assertEquals(first.resets?.nope, []);
      const rollNames = (first.resets?.pianoRoll as PianoRollObject[])
        .map((roll) => roll.name);
      assert(rollNames.includes("sync/subscribe-roll"));
      assert(rollNames.includes("melody"), "the demo seed is in the reset");

      // A second subscribe replaces the set outright rather than adding to it.
      const before = client.messages.length;
      const second = await client.subscribe(["signal"]);
      assertEquals(Object.keys(second.resets ?? {}), ["signal"]);

      await postJson(`${baseUrl}/piano-roll/set`, {
        name: "sync/subscribe-roll",
        data: { notes: [{ id: "n2", pitch: 64, position: 0, duration: 1 }] },
      });
      await sleep(200);
      assertEquals(
        client.changesSince(before, "pianoRoll"),
        [],
        "a replaced subscription stops delivering the dropped type",
      );

      // Gap recovery is exactly this: resubscribe the same set, get resets.
      const third = await client.subscribe(["pianoRoll"]);
      const resubscribed = (third.resets?.pianoRoll as PianoRollObject[])
        .find((roll) => roll.name === "sync/subscribe-roll");
      assertEquals(resubscribed?.data.notes[0].id, "n2");
    } finally {
      client.close();
    }
  });
});

Deno.test("changes ship per entity and a deletion ships as a null entity", async () => {
  await withServer("tcv-sync-changes-", async ({ baseUrl }) => {
    const client = await SyncClient.open(baseUrl);
    try {
      await client.subscribe(["pianoRoll"]);
      const before = client.messages.length;

      await postJson(`${baseUrl}/piano-roll/set`, {
        name: "sync/edited",
        data: { notes: [{ id: "n1", pitch: 60, position: 0, duration: 1 }] },
      });
      await client.waitForChange(
        before,
        "pianoRoll",
        (change) => change.name === "sync/edited",
        "the edited roll",
      );

      const delivered = client.changesSince(before, "pianoRoll");
      assertEquals(
        delivered.map((change) => change.name),
        ["sync/edited"],
        "only the edited roll ships, not the whole store",
      );
      assertEquals(
        (delivered[0].entity as PianoRollObject).data.notes[0].id,
        "n1",
      );

      const beforeDelete = client.messages.length;
      await postJson(`${baseUrl}/entities/delete`, {
        type: "pianoRoll",
        name: "sync/edited",
      });
      await client.waitForChange(
        beforeDelete,
        "pianoRoll",
        (change) => change.name === "sync/edited" && change.entity === null,
        "the deletion",
      );
    } finally {
      client.close();
    }
  });
});

Deno.test("seq is per socket, monotonic, and gap-free", async () => {
  await withServer("tcv-sync-seq-", async ({ baseUrl }) => {
    const first = await SyncClient.open(baseUrl);
    const second = await SyncClient.open(baseUrl);
    try {
      await first.subscribe(["pianoRoll"]);
      for (let index = 0; index < 3; index++) {
        await postJson(`${baseUrl}/piano-roll/set`, {
          name: "sync/seq",
          data: {
            notes: [{ id: `n${index}`, pitch: 60 + index, position: 0, duration: 1 }],
          },
        });
        await sleep(80);
      }
      // The second socket only subscribes now, so its own counter starts at 1
      // however many messages the first one has already taken.
      await second.subscribe(["pianoRoll"]);

      assert(first.messages.length >= 2, "the first socket received updates");
      assertEquals(
        first.messages.map((message) => message.seq),
        first.messages.map((_message, index) => index + 1),
        "one socket's seq counts its own messages with no gaps",
      );
      assertEquals(second.messages.map((message) => message.seq), [1]);
    } finally {
      first.close();
      second.close();
    }
  });
});

Deno.test("run entities carry the launch token, and a supersede never republishes the old one", async () => {
  await withServer("tcv-sync-run-", async ({ baseUrl, sessionRoot }) => {
    const moduleId = "module-sync-supersede";
    const client = await SyncClient.open(baseUrl);
    try {
      await client.subscribe(["run"]);
      const before = client.messages.length;

      const slowUri = await writeFixtureModule(sessionRoot, "sync-supersede-a", {
        importDelayMs: 400,
      });
      // The replacement is slow to import too, so the moment where the
      // superseded action reaches the publish guard is a window this test can
      // actually observe rather than one collapsed into the same 33 ms tick as
      // the replacement's `running`.
      const replacementUri = await writeFixtureModule(
        sessionRoot,
        "sync-supersede-b",
        { importDelayMs: 300 },
      );

      await postJson(`${baseUrl}/runtime/launch`, {
        moduleId,
        transformedModuleUri: slowUri,
        generatedRunId: "sync-supersede-run-a",
      });
      await client.waitForChange(
        before,
        "run",
        (change) => runOf(change).state === "launching",
        "the accepted launch's launching entity",
      );
      const firstToken = runOf(client.changesSince(before, "run")[0]).runToken;
      assert(firstToken, "a launching run entity already carries its token");

      await postJson(`${baseUrl}/runtime/launch`, {
        moduleId,
        transformedModuleUri: replacementUri,
        generatedRunId: "sync-supersede-run-b",
        replaceRunning: true,
      });
      await client.waitForChange(
        before,
        "run",
        (change) => runOf(change).state === "running",
        "the superseding run running",
      );
      // Long enough for the superseded import to resolve and its cancelled
      // action to reach the publish guard.
      await sleep(600);

      const runs = client.changesSince(before, "run").map(runOf);
      const running = runs.filter((run) => run.state === "running");
      assertEquals(running.length, 1, "exactly one run may start");
      // Nothing here is a stop, so no terminal may appear at all. Without the
      // token half of the guard the superseded action would write one over the
      // replacement's still-`launching` entry.
      assertEquals(
        runs.map((run) => run.state).filter((state) => state === "stopped"),
        [],
        "a supersede publishes no terminal",
      );
      assert(
        running[0].runToken !== firstToken,
        "the superseding run has its own token",
      );
      assertEquals(running[0].generatedRunId, "sync-supersede-run-b");

      // The cancelled launch's own action reaches publishCancelledLaunch after
      // the replacement already owns the entry. The token half of the guard is
      // what suppresses it — `generatedRunId` could not, because a relaunch of
      // an unchanged build reuses the ID.
      const firstNewToken = runs.findIndex((run) =>
        run.runToken === running[0].runToken
      );
      assertEquals(
        runs.slice(firstNewToken).some((run) => run.runToken === firstToken),
        false,
        "a superseded launch must never write over its replacement's entry",
      );
      assertEquals(runs[runs.length - 1].state, "running");
    } finally {
      client.close();
    }
  });
});

Deno.test("a cancelled launch publishes exactly one terminal run entity", async () => {
  await withServer("tcv-sync-cancel-", async ({ baseUrl, sessionRoot }) => {
    const moduleId = "module-sync-cancel";
    const client = await SyncClient.open(baseUrl);
    try {
      await client.subscribe(["run"]);
      const before = client.messages.length;

      const moduleUri = await writeFixtureModule(sessionRoot, "sync-cancel", {
        importDelayMs: 400,
      });
      await postJson(`${baseUrl}/runtime/launch`, {
        moduleId,
        transformedModuleUri: moduleUri,
        generatedRunId: "sync-cancel-run",
      });
      await client.waitForChange(
        before,
        "run",
        (change) => runOf(change).state === "launching",
        "the launching entity",
      );

      // The stop cancels the pending launch and publishes the terminal it owed.
      await postJson(`${baseUrl}/runtime/stop`, { moduleId });
      await client.waitForChange(
        before,
        "run",
        (change) => runOf(change).state === "stopped",
        "the cancellation terminal",
      );
      // Well past the fixture's import delay: the queued action now runs, sees
      // itself cancelled, and reaches the publish guard with a MATCHING token.
      // Only the "state is no longer launching" half stops it from reopening a
      // terminal the stop already published.
      await sleep(700);

      const runs = client.changesSince(before, "run").map(runOf);
      const terminals = runs.filter((run) => run.state === "stopped");
      assertEquals(terminals.length, 1, "one cancellation, one terminal");
      assertEquals(
        runs.some((run) => run.state === "running"),
        false,
        "a cancelled launch never runs user code",
      );
      const tokens = new Set(runs.map((run) => run.runToken));
      assertEquals(tokens.size, 1, "one accepted launch, one token");
    } finally {
      client.close();
    }
  });
});

Deno.test("the entity channels are gone and their HTTP lists still answer in full", async () => {
  await withServer("tcv-sync-retired-", async ({ baseUrl }) => {
    // The three per-kind snapshot sockets were deleted with the client that
    // read them. Everything watched now arrives on `/sync`; a full current
    // picture is still one HTTP list away, which is what the E2E's polling
    // helpers and the feature-project verifier use.
    for (const path of ["/piano-roll", "/params", "/signals"]) {
      const response = await fetch(`${baseUrl}${path}/snapshots`, {
        headers: { upgrade: "websocket", connection: "Upgrade" },
      });
      await response.body?.cancel();
      assertEquals(response.status, 404, `${path}/snapshots is retired`);
    }

    await postJson(`${baseUrl}/piano-roll/set`, {
      name: "sync/retired",
      data: { notes: [{ id: "n1", pitch: 62, position: 0, duration: 1 }] },
    });
    await postJson(`${baseUrl}/entities/create`, {
      type: "params",
      name: "sync/retired-params",
    });

    const rolls = await fetchJson<PianoRollSnapshot>(
      `${baseUrl}/piano-roll/list`,
    );
    assert(rolls.rolls["sync/retired"], "the roll list is still a full snapshot");
    const params = await fetchJson<{ params: Record<string, ParamsEntity> }>(
      `${baseUrl}/params/list`,
    );
    assert(params.params["sync/retired-params"], "the params list is full too");
  });
});

Deno.test("one tick feeds the sync sockets and the legacy runtime shim without starving either", async () => {
  await withServer("tcv-sync-fanout-", async ({ baseUrl }) => {
    const client = await SyncClient.open(baseUrl);
    const legacyRuntime = new WebSocket(
      `${baseUrl.replace("http", "ws")}/runtime/snapshots`,
    );
    const snapshots: ActiveWaitSnapshot[] = [];
    legacyRuntime.onmessage = (event) => {
      snapshots.push(JSON.parse(event.data as string) as ActiveWaitSnapshot);
    };

    try {
      await waitFor(
        () => legacyRuntime.readyState === WebSocket.OPEN,
        "legacy runtime socket open",
        5_000,
      );
      await client.subscribe(["run"]);
      const before = client.messages.length;
      const snapshotsBefore = snapshots.length;

      const analysis = await postJson<AnalyzeSuccess>(
        `${baseUrl}/runtime/analyze`,
        {
          moduleId: "module-sync-fanout",
          sourceVersion: 1,
          sourceUri: "module-sync-fanout.ts",
          sourceText: `
import type { TimeContext } from "@avtools/core-timing";

export default async function (ctx: TimeContext) {
  await ctx.waitSec(30);
}
`,
        },
      );
      assertEquals(analysis.type, "analyzeSuccess");
      await postJson(`${baseUrl}/runtime/launch`, {
        moduleId: analysis.moduleId,
        transformedModuleUri: analysis.transformedModuleUri,
        generatedRunId: analysis.generatedRunId,
      });

      // `collectAll` DRAINS the change gates, so it may be called exactly once
      // per tick; the shim derives its envelope from the same sources through
      // its own pure compare. A second collect would starve one side.
      await client.waitForChange(
        before,
        "run",
        (change) =>
          change.name === analysis.moduleId &&
          runOf(change).state === "running",
        "the running run entity on /sync",
      );
      await waitFor(
        () =>
          snapshots.slice(snapshotsBefore).some((snapshot) =>
            snapshot.moduleRuns?.[analysis.moduleId]?.state === "running"
          ),
        "the running module on the legacy runtime shim",
        5_000,
      );

      // The shim's rows stay token-FREE: it is a frozen shape for a client this
      // slice deliberately did not modernize.
      const shimRun = snapshots[snapshots.length - 1]
        .moduleRuns?.[analysis.moduleId];
      assertEquals("runToken" in (shimRun ?? {}), false);

      await postJson(`${baseUrl}/runtime/stop`, {
        moduleId: analysis.moduleId,
      });
    } finally {
      legacyRuntime.close();
      client.close();
    }
  });
});

Deno.test("a meta-only params change and a signal's ended flip both reach subscribers", async () => {
  await withServer("tcv-sync-meta-", async ({ baseUrl }) => {
    const client = await SyncClient.open(baseUrl);
    try {
      await client.subscribe(["params", "signal"]);
      const before = client.messages.length;

      const analysis = await postJson<AnalyzeSuccess>(
        `${baseUrl}/runtime/analyze`,
        {
          moduleId: "module-sync-meta",
          sourceVersion: 1,
          sourceUri: "module-sync-meta.ts",
          sourceText: `
import type { TimeContext } from "@avtools/core-timing";
import { canvasParams } from "canvas-params";
import { signal } from "canvas-signals";

export default async function (ctx: TimeContext) {
  canvasParams("sync/meta", { gain: 1 }, { gain: { min: 0, max: 2 } });
  const marker = signal<number>("sync/meta-marker", {
    anchor: { type: "pianoRoll", name: "melody" },
  });
  marker.set(1);
  await ctx.waitSec(0.2);
  // Same values, new meta: rev must not move, and the change must still ship.
  canvasParams("sync/meta", { gain: 1 }, { gain: { min: 0, max: 4 } });
  await ctx.waitSec(30);
}
`,
        },
      );
      assertEquals(analysis.type, "analyzeSuccess");

      await postJson(`${baseUrl}/runtime/launch`, {
        moduleId: analysis.moduleId,
        transformedModuleUri: analysis.transformedModuleUri,
        generatedRunId: analysis.generatedRunId,
      });

      await client.waitForChange(
        before,
        "params",
        (change) =>
          change.name === "sync/meta" &&
          (change.entity as ParamsEntity).meta?.gain !== undefined &&
          ((change.entity as ParamsEntity).meta
            ?.gain as { max?: number }).max === 4,
        "the redeclared meta",
      );

      const paramsChanges = client
        .changesSince(before, "params")
        .filter((change) => change.name === "sync/meta")
        .map((change) => change.entity as ParamsEntity);
      assert(
        paramsChanges.length >= 2,
        "the declaration and the meta-only redeclaration are separate changes",
      );
      assertEquals(
        new Set(paramsChanges.map((entity) => entity.rev)).size,
        1,
        "a meta-only change does not bump rev, and still has to be delivered",
      );

      const beforeStop = client.messages.length;
      await postJson(`${baseUrl}/runtime/stop`, {
        moduleId: analysis.moduleId,
      });
      // `ended` is a flag flip with no value generation behind it: nothing but
      // explicit change tracking could carry it, and a scope that never learns
      // it silently freezes.
      await client.waitForChange(
        beforeStop,
        "signal",
        (change) =>
          change.name === "sync/meta-marker" &&
          (change.entity as SignalEntity).ended === true,
        "the ended flip",
      );
    } finally {
      client.close();
    }
  });
});

Deno.test("module waits and lookups reach both transports and agree", async () => {
  await withServer("tcv-sync-waits-", async ({ baseUrl }) => {
    const client = await SyncClient.open(baseUrl);
    const legacyRuntime = new WebSocket(
      `${baseUrl.replace("http", "ws")}/runtime/snapshots`,
    );
    const snapshots: ActiveWaitSnapshot[] = [];
    legacyRuntime.onmessage = (event) => {
      snapshots.push(JSON.parse(event.data as string) as ActiveWaitSnapshot);
    };

    try {
      await waitFor(
        () => legacyRuntime.readyState === WebSocket.OPEN,
        "legacy runtime socket open",
        5_000,
      );
      await client.subscribe(["moduleWaits", "moduleLookups"]);
      const before = client.messages.length;

      const analysis = await postJson<AnalyzeSuccess>(
        `${baseUrl}/runtime/analyze`,
        {
          moduleId: "module-sync-waits",
          sourceVersion: 1,
          sourceUri: "module-sync-waits.ts",
          sourceText: `
import type { TimeContext } from "@avtools/core-timing";
import { getPianoRollClip } from "piano-roll-helpers";

export default async function (ctx: TimeContext) {
  void getPianoRollClip("melody");
  await ctx.waitSec(30);
}
`,
        },
      );
      assertEquals(analysis.type, "analyzeSuccess");
      const waitCallsite = analysis.manifest.callsites
        .find((callsite) => callsite.kind === "timeContextMethod");
      const lookupCallsite = analysis.manifest.callsites
        .find((callsite) => callsite.kind === "pianoRollLookup");
      assert(waitCallsite && lookupCallsite);

      await postJson(`${baseUrl}/runtime/launch`, {
        moduleId: analysis.moduleId,
        transformedModuleUri: analysis.transformedModuleUri,
        generatedRunId: analysis.generatedRunId,
      });

      await client.waitForChange(
        before,
        "moduleWaits",
        (change) =>
          (change.entity as ModuleWaitsEntity | null)?.callsiteIds
            .includes(waitCallsite.id) === true,
        "the parked wait on /sync",
      );
      await client.waitForChange(
        before,
        "moduleLookups",
        (change) => change.name === analysis.moduleId,
        "the recorded lookup on /sync",
      );
      await waitFor(
        () =>
          snapshots.some((snapshot) =>
            snapshot.modules[analysis.moduleId]?.includes(waitCallsite.id) ===
              true
          ),
        "the parked wait on the legacy runtime socket",
        5_000,
      );

      // Parity: the entity is the same per-module shape the legacy envelope
      // carries, which is what makes the Phase-C swap an import change.
      const latestSnapshot = snapshots[snapshots.length - 1];
      const latestWaits = client
        .changesSince(before, "moduleWaits")
        .filter((change) => change.name === analysis.moduleId)
        .map((change) => change.entity as ModuleWaitsEntity | null)
        .filter((entity): entity is ModuleWaitsEntity => entity !== null);
      assertEquals(
        latestWaits[latestWaits.length - 1].callsiteIds,
        [...(latestSnapshot.modules[analysis.moduleId] ?? [])].sort(),
      );
      assertEquals(
        latestSnapshot.pianoRollLookups?.[analysis.moduleId]?.[
          lookupCallsite.id
        ],
        "melody",
      );

      // A module parked in one long wait re-marks nothing, so the transport
      // goes quiet rather than reshipping an identical array every 33 ms.
      const quietFrom = client.messages.length;
      await sleep(400);
      assertEquals(
        client.changesSince(quietFrom, "moduleWaits"),
        [],
        "a parked wait must not rebroadcast every tick",
      );

      await postJson(`${baseUrl}/runtime/stop`, {
        moduleId: analysis.moduleId,
      });
      await client.waitForChange(
        before,
        "moduleWaits",
        (change) =>
          change.name === analysis.moduleId && change.entity === null,
        "the cleared waits as a deletion",
      );
    } finally {
      legacyRuntime.close();
      client.close();
    }
  });
});

Deno.test("the module-keyed sources compare values, so a re-marked identical set stays silent", () => {
  const waits = createModuleWaitsSyncSource();
  const lookups = createModuleLookupsSyncSource();
  const moduleId = "module-source-level";

  // Whatever an earlier test in this process left marked is not this test's
  // subject; drain it the way a broadcast tick does.
  clearAllWaits();
  clearAllPianoRollLookups();
  waits.collectChanges();
  lookups.collectChanges();
  assertEquals(waits.collectChanges(), null, "an idle tick collects nothing");

  enterWait(moduleId, "w2");
  enterWait(moduleId, "w1");
  assertEquals(waits.collectChanges(), [{
    name: moduleId,
    entity: { moduleId, callsiteIds: ["w1", "w2"] },
  }]);

  // A tight loop enters and exits the same callsites several times inside one
  // tick. The dirty hint fires on every one of those calls and the resulting
  // set is unchanged, so nothing may go out: today's global JSON compare gives
  // that silence and the natural-completion e2e depends on it.
  enterWait(moduleId, "w1");
  exitWait(moduleId, "w1");
  enterWait(moduleId, "w2");
  exitWait(moduleId, "w2");
  assertEquals(
    waits.collectChanges(),
    null,
    "an unchanged callsite set must not rebroadcast",
  );

  exitWait(moduleId, "w2");
  assertEquals(waits.collectChanges(), [{
    name: moduleId,
    entity: { moduleId, callsiteIds: ["w1"] },
  }]);

  // A read-only snapshot answers one subscribe and must not consume anything.
  enterWait(moduleId, "w3");
  assertEquals(waits.snapshotAll(), [{
    moduleId,
    callsiteIds: ["w1", "w3"],
  }]);
  assert(
    waits.collectChanges(),
    "a subscribe reset must not swallow the pending change",
  );

  clearModuleWaits(moduleId);
  assertEquals(waits.collectChanges(), [{ name: moduleId, entity: null }]);
  assertEquals(waits.collectChanges(), null, "a deletion ships exactly once");

  recordPianoRollLookup(moduleId, "c1", "melody");
  assertEquals(lookups.collectChanges(), [{
    name: moduleId,
    entity: { moduleId, lookups: { c1: "melody" } },
  }]);
  recordPianoRollLookup(moduleId, "c1", "melody");
  assertEquals(
    lookups.collectChanges(),
    null,
    "re-resolving to the same roll name is silent",
  );
  recordPianoRollLookup(moduleId, "c1", "bass");
  assertEquals(lookups.collectChanges(), [{
    name: moduleId,
    entity: { moduleId, lookups: { c1: "bass" } },
  }]);
  clearModulePianoRollLookups(moduleId);
  assertEquals(lookups.collectChanges(), [{ name: moduleId, entity: null }]);
  assertEquals(lookups.collectChanges(), null);
});

function runOf(change: SyncEntityChange): RunEntity {
  return change.entity as RunEntity;
}

async function writeFixtureModule(
  dir: string,
  name: string,
  options: { importDelayMs?: number },
): Promise<string> {
  const importDelay = options.importDelayMs
    ? `await new Promise((resolve) => setTimeout(resolve, ${options.importDelayMs}));\n\n`
    : "";
  const source = `${importDelay}export default async function (
  ctx: { waitSec(seconds: number): Promise<void> },
) {
  await ctx.waitSec(30);
}
`;
  const path = join(dir, `fixture-${name}.ts`);
  await Deno.writeTextFile(path, source);
  return toFileUrl(path).href;
}
