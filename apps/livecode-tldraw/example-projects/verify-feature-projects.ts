/**
 * Headless verification for the feature-* example projects.
 *
 * Starts the real Deno livecode server (port 0, parses the serverReady line),
 * then for every feature project: opens it through /project/open, asserts
 * /project/diagnostics is clean, launches its modules through the documented
 * /runtime/analyze + /runtime/launch flow, and asserts the documented
 * observable state (params entities with values/meta, rolls with notes,
 * animation timelines, signals with anchors, lifecycle terminal states, and
 * stop-hook effects).
 *
 * Usage (from the repository root or anywhere):
 *
 *   deno run --no-config --allow-all \
 *     apps/livecode-tldraw/example-projects/verify-feature-projects.ts
 *
 * `--no-config` matters: this file lives under apps/livecode-tldraw, whose
 * package.json is not a member of the root deno.json workspace, so Deno's
 * config discovery otherwise refuses to run. The script needs no import map.
 *
 * It is deliberately standalone: not wired into any deno task or npm script.
 * MIDI note output during the run is expected when a MIDI device is present
 * (the players use the default output); every module is stopped before exit.
 */

const scriptDir = new URL(".", import.meta.url).pathname;
const exampleProjectsDir = scriptDir.replace(/\/$/, "");
const repoRoot = new URL("../../..", import.meta.url).pathname.replace(
  /\/$/,
  "",
);
const denoNotebooksDir = `${repoRoot}/apps/deno-notebooks`;

let baseUrl = "";
let checksPassed = 0;
const projectSummaries: string[] = [];

function assert(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(`ASSERT FAILED: ${label}`);
  checksPassed += 1;
  console.log(`  ok: ${label}`);
}

async function post(
  path: string,
  body: unknown,
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function get(path: string): Promise<any> {
  const response = await fetch(`${baseUrl}${path}`);
  return await response.json();
}

async function waitUntil<T>(
  label: string,
  read: () => Promise<T | undefined | false | null>,
  timeoutMs = 15_000,
  intervalMs = 100,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value !== undefined && value !== false && value !== null) {
        checksPassed += 1;
        console.log(`  ok: ${label}`);
        return value;
      }
      last = value;
    } catch (error) {
      last = error instanceof Error ? error.message : error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(
    `TIMEOUT after ${timeoutMs}ms: ${label} (last: ${JSON.stringify(last)})`,
  );
}

async function openProject(name: string): Promise<void> {
  const projectPath = `${exampleProjectsDir}/${name}`;
  const opened = await post("/project/open", { projectPath });
  assert(
    opened.status === 200 && opened.body.ok !== false,
    `${name}: /project/open succeeded`,
  );
  const diagnostics = await get("/project/diagnostics");
  assert(
    diagnostics.denoCheck?.success === true,
    `${name}: deno check passes`,
  );
  assert(
    Array.isArray(diagnostics.diagnostics) &&
      diagnostics.diagnostics.length === 0,
    `${name}: no shadow diagnostics`,
  );
}

async function launchModule(
  id: string,
  opts: { replaceRunning?: boolean } = {},
): Promise<{ generatedRunId: string; launchStatus: number; launchBody: any }> {
  const analyze = await post("/runtime/analyze", {
    moduleId: id,
    sourceVersion: 1,
    projectModuleId: id,
  });
  if (analyze.body?.type !== "analyzeSuccess") {
    throw new Error(`analyze failed for ${id}: ${JSON.stringify(analyze)}`);
  }
  const launch = await post("/runtime/launch", {
    moduleId: id,
    transformedModuleUri: analyze.body.transformedModuleUri,
    generatedRunId: analyze.body.generatedRunId,
    sourceHash: analyze.body.sourceHash,
    projectSourceHash: analyze.body.projectSourceHash,
    projectModulePath: analyze.body.projectModulePath,
    manifest: analyze.body.manifest,
    replaceRunning: opts.replaceRunning ?? false,
  });
  return {
    generatedRunId: analyze.body.generatedRunId,
    launchStatus: launch.status,
    launchBody: launch.body,
  };
}

async function runState(): Promise<any> {
  return await get("/runtime/state");
}

async function waitForRun(
  id: string,
  state: string,
  generatedRunId?: string,
  timeoutMs = 15_000,
): Promise<void> {
  await waitUntil(
    `${id} reaches run state "${state}"${
      generatedRunId ? " (run-id matched)" : ""
    }`,
    async () => {
      const snapshot = await runState();
      const entry = snapshot.moduleRuns?.[id];
      if (!entry) return false;
      if (entry.state !== state) return false;
      if (generatedRunId && entry.generatedRunId !== generatedRunId) {
        return false;
      }
      return entry;
    },
    timeoutMs,
  );
}

async function paramsEntity(name: string): Promise<any> {
  const snapshot = await get("/params/list");
  return snapshot.params?.[name];
}

async function signalEntity(name: string): Promise<any> {
  const snapshot = await get("/signals/list");
  return snapshot.signals?.[name];
}

async function roll(name: string): Promise<any> {
  const snapshot = await get("/piano-roll/list");
  return snapshot.rolls?.[name];
}

async function syncEntities(entityType: string): Promise<any[]> {
  const syncUrl = new URL("/sync", baseUrl);
  syncUrl.protocol = syncUrl.protocol === "https:" ? "wss:" : "ws:";
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(syncUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`Timed out waiting for ${entityType} sync reset`));
    }, 10_000);
    socket.onopen = () => {
      socket.send(JSON.stringify({
        type: "subscribe",
        entityTypes: [entityType],
      }));
    };
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      const reset = message.resets?.[entityType];
      if (!Array.isArray(reset)) return;
      clearTimeout(timer);
      socket.close();
      resolve(reset);
    };
    socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`Sync socket failed for ${entityType}`));
    };
  });
}

async function animationTimelineEntity(name: string): Promise<any> {
  return (await syncEntities("animationTimeline"))
    .find((entity) => entity.name === name);
}

async function stopAll(): Promise<void> {
  await post("/runtime/stop-all", {});
}

// ---------------------------------------------------------------------------

async function verifyParamsBasics(): Promise<void> {
  console.log("\n=== feature-params-basics ===");
  await openProject("feature-params-basics");

  const automation = await launchModule("params-basics/automation");
  assert(automation.launchStatus === 200, "automation launch accepted");
  await waitForRun("params-basics/automation", "running");
  const reader = await launchModule("params-basics/reader");
  assert(reader.launchStatus === 200, "reader launch accepted");
  await waitForRun("params-basics/reader", "running");

  // A data-only module with a no-op root still runs and completes naturally.
  const panel = await launchModule("params-basics/panel");
  await waitForRun("params-basics/panel", "stopped", panel.generatedRunId);

  const entity = await waitUntil(
    "params-basics/panel entity is listed",
    () => paramsEntity("params-basics/panel"),
  );
  assert(
    entity.values.osc.freq === 1.5 && entity.values.mix.gain === 0.5,
    "declared default values are visible",
  );
  assert(
    entity.meta?.osc?.freq?.min === 0.1 &&
      entity.meta?.osc?.freq?.label === "frequency (Hz)",
    "field meta (bounds + label) is visible",
  );
  assert(
    entity.meta?.monitor?.level?.graph === true,
    "monitor.level meta declares graph: true",
  );

  await waitUntil(
    'automation writes are adopted (updatedBy becomes "code")',
    async () => {
      const current = await paramsEntity("params-basics/panel");
      return current?.updatedBy === "code" ? current : false;
    },
  );
  const levelA = (await paramsEntity("params-basics/panel")).values.monitor
    .level;
  await waitUntil(
    "monitor.level keeps moving (code-driven automation)",
    async () => {
      const current = await paramsEntity("params-basics/panel");
      return current.values.monitor.level !== levelA ? current : false;
    },
  );

  const derived = await waitUntil(
    "params-basics/derived signal is listed with a numeric value",
    async () => {
      const sig = await signalEntity("params-basics/derived");
      return sig && typeof sig.value === "number" ? sig : false;
    },
  );
  await waitUntil(
    "derived signal keeps moving",
    async () => {
      const sig = await signalEntity("params-basics/derived");
      return sig.value !== derived.value ? sig : false;
    },
  );

  const setResult = await post("/params/set", {
    name: "params-basics/panel",
    values: { mix: { muted: true } },
    originId: "verify-runner",
  });
  assert(
    setResult.status === 200 && setResult.body?.values?.mix?.muted === true,
    "/params/set merges a leaf write (mute)",
  );
  await waitUntil(
    "reader sees the write: derived pins to exactly 0 while muted",
    async () => {
      const sig = await signalEntity("params-basics/derived");
      return sig.value === 0 ? sig : false;
    },
  );
  await post("/params/set", {
    name: "params-basics/panel",
    values: { mix: { muted: false } },
    originId: "verify-runner",
  });

  await stopAll();
  await waitForRun("params-basics/automation", "stopped");
  await waitForRun("params-basics/reader", "stopped");
  await waitUntil(
    "derived signal is marked ended after stop-all",
    async () => {
      const sig = await signalEntity("params-basics/derived");
      return sig?.ended === true ? sig : false;
    },
  );
  projectSummaries.push(
    "feature-params-basics: declaration/meta/graph, code automation, loop-rate reader, /params/set round trip, ended signal",
  );
}

async function verifyPianoRollFlows(): Promise<void> {
  console.log("\n=== feature-piano-roll-flows ===");
  await openProject("feature-piano-roll-flows");

  const seed = await launchModule("piano-roll-flows/seed");
  await waitForRun("piano-roll-flows/seed", "stopped", seed.generatedRunId);
  const loop = await waitUntil(
    "rolls/loop exists with the seeded phrase",
    async () => {
      const current = await roll("rolls/loop");
      return current?.data?.notes?.length === 4 ? current : false;
    },
  );
  assert(loop.data.notes[0].pitch === 60, "seeded first note is C4");

  const echo = await launchModule("piano-roll-flows/echo");
  await waitForRun("piano-roll-flows/echo", "stopped", echo.generatedRunId);
  const echoRoll = await waitUntil(
    "rolls/loop-echo was written back by the echo module",
    async () => {
      const current = await roll("rolls/loop-echo");
      return current?.data?.notes?.length === 4 ? current : false;
    },
  );
  assert(
    echoRoll.data.notes[0].pitch === 72,
    "echo notes are transposed up an octave",
  );

  const player = await launchModule("piano-roll-flows/player");
  assert(player.launchStatus === 200, "player launch accepted");
  await waitForRun("piano-roll-flows/player", "running");

  // Entity CRUD over the documented HTTP surface, while a module runs.
  const created = await post("/entities/create", {
    type: "pianoRoll",
    name: "rolls/scratch",
  });
  assert(
    created.status === 200 && created.body.ok === true,
    "/entities/create makes an empty roll",
  );
  await waitUntil(
    "created roll is listed (empty)",
    async () => {
      const current = await roll("rolls/scratch");
      return current && current.data.notes.length === 0 ? current : false;
    },
  );
  const createdAgain = await post("/entities/create", {
    type: "pianoRoll",
    name: "rolls/scratch",
  });
  assert(
    createdAgain.status === 409,
    "/entities/create rejects an existing name with 409",
  );
  const duplicated = await post("/entities/duplicate", {
    type: "pianoRoll",
    name: "rolls/loop",
    targetName: "rolls/loop-copy",
  });
  assert(
    duplicated.status === 200 && duplicated.body.entity?.name ===
        "rolls/loop-copy",
    "/entities/duplicate copies the loop",
  );
  await waitUntil(
    "duplicate carries the source notes",
    async () => {
      const current = await roll("rolls/loop-copy");
      return current?.data?.notes?.length === 4 ? current : false;
    },
  );
  for (const name of ["rolls/loop-copy", "rolls/scratch"]) {
    const deleted = await post("/entities/delete", { type: "pianoRoll", name });
    assert(deleted.status === 200, `/entities/delete removes ${name}`);
  }
  await waitUntil(
    "deleted rolls are no longer listed",
    async () => {
      const copy = await roll("rolls/loop-copy");
      const scratch = await roll("rolls/scratch");
      return copy === undefined && scratch === undefined ? true : false;
    },
  );

  await post("/runtime/stop", { moduleId: "piano-roll-flows/player" });
  await waitForRun("piano-roll-flows/player", "stopped");
  projectSummaries.push(
    "feature-piano-roll-flows: seed write, read-transform-write echo, live player, HTTP entity CRUD incl. 409",
  );
}

async function verifyAnimationTimeline(): Promise<void> {
  console.log("\n=== feature-animation-timeline ===");
  await openProject("feature-animation-timeline");

  const name = "animation-fixture/timeline";
  const timeline = await waitUntil(
    "animation timeline restored from checked-in data",
    () => animationTimelineEntity(name),
  );
  assert(timeline.updatedBy === "load", "timeline records its load origin");
  assert(
    timeline.data.trackOrder.join(",") === "gain-track,scene-track,cue-track",
    "number, enum, and function tracks retain their saved order",
  );
  assert(
    timeline.data.tracks.map((track: any) => track.fieldType).join(",") ===
      "number,enum,func",
    "all three animation track kinds restore",
  );
  const status = await get("/project/status");
  const dataStatus = status.data.find((entry: any) =>
    entry.type === "animationTimeline" && entry.name === name
  );
  assert(dataStatus?.unsaved === false, "restored timeline starts saved");

  const sampler = await launchModule("animation-fixture/sampler");
  assert(sampler.launchStatus === 200, "timeline sampler launch accepted");
  await waitForRun(
    "animation-fixture/sampler",
    "running",
    sampler.generatedRunId,
  );
  const gain = await waitUntil(
    "sampler publishes numeric gain",
    async () => {
      const signal = await signalEntity("animation-fixture/gain");
      return typeof signal?.value === "number" ? signal : false;
    },
  );
  await waitUntil(
    "sampler follows the saved gain curve",
    async () => {
      const signal = await signalEntity("animation-fixture/gain");
      return signal?.value !== gain.value ? signal : false;
    },
  );

  const edited = structuredClone(timeline.data);
  const gainTrack = edited.tracks.find((track: any) =>
    track.id === "gain-track"
  );
  assert(gainTrack, "saved gain track exists");
  for (const element of gainTrack.elementData) element.value = 0.42;
  const setResult = await post("/animation-timeline/set", {
    name,
    data: edited,
    expectedRev: timeline.rev,
    originId: "feature-project-verifier",
  });
  assert(
    setResult.status === 200 && setResult.body.ok === true,
    "whole-timeline compare-and-set edit accepted",
  );
  await waitUntil(
    "running sampler sees the timeline edit",
    async () => {
      const signal = await signalEntity("animation-fixture/gain");
      return signal?.value === 0.42 ? signal : false;
    },
  );

  const restored = await post("/animation-timeline/set", {
    name,
    data: timeline.data,
    expectedRev: setResult.body.timeline.rev,
    originId: "feature-project-verifier",
  });
  assert(restored.body.ok === true, "timeline restored after verifier edit");
  const restoredStatus = await get("/project/status");
  assert(
    restoredStatus.data.find((entry: any) =>
      entry.type === "animationTimeline" && entry.name === name
    )?.unsaved === false,
    "restoring saved data clears the unsaved comparison",
  );

  await post("/runtime/stop", { moduleId: "animation-fixture/sampler" });
  await waitForRun("animation-fixture/sampler", "stopped");
  await waitUntil(
    "sampler signal ends with its module",
    async () => {
      const signal = await signalEntity("animation-fixture/gain");
      return signal?.ended === true ? signal : false;
    },
  );
  projectSummaries.push(
    "feature-animation-timeline: checked-in restore, all track kinds, live sampling, CAS edit, saved-state comparison",
  );
}

async function verifySignalsAndScopes(): Promise<void> {
  console.log("\n=== feature-signals-and-scopes ===");
  await openProject("feature-signals-and-scopes");

  // Pre-launch: the checked-in data file was loaded by /project/open.
  const groove = await waitUntil(
    "signals/groove roll restored from the checked-in data file",
    async () => {
      const current = await roll("signals/groove");
      return current?.data?.notes?.length === 6 ? current : false;
    },
  );
  assert(groove.data.notes[0].pitch === 48, "restored groove keeps its notes");

  for (const id of ["signals/walker", "signals/strider", "signals/lfo"]) {
    await launchModule(id);
    await waitForRun(id, "running");
  }

  const walker = await waitUntil(
    "walker publishes a numeric playhead anchored to signals/groove",
    async () => {
      const sig = await signalEntity("signals/walker");
      return sig && typeof sig.value === "number" &&
          sig.anchor?.type === "pianoRoll" &&
          sig.anchor?.name === "signals/groove"
        ? sig
        : false;
    },
  );
  await waitUntil(
    "strider publishes { position } against the SAME roll (multi-marker)",
    async () => {
      const sig = await signalEntity("signals/strider");
      return sig && typeof sig.value?.position === "number" &&
          sig.anchor?.type === "pianoRoll" &&
          sig.anchor?.name === "signals/groove"
        ? sig
        : false;
    },
  );
  const lfo = await waitUntil(
    "lfo publishes a plain numeric signal with no anchor",
    async () => {
      const sig = await signalEntity("signals/lfo");
      return sig && typeof sig.value === "number" && sig.anchor === undefined
        ? sig
        : false;
    },
  );
  await waitUntil(
    "walker playhead keeps moving",
    async () => {
      const sig = await signalEntity("signals/walker");
      return sig.value !== walker.value ? sig : false;
    },
  );
  await waitUntil(
    "lfo keeps moving",
    async () => {
      const sig = await signalEntity("signals/lfo");
      return sig.value !== lfo.value ? sig : false;
    },
  );

  await stopAll();
  for (const name of ["signals/walker", "signals/strider", "signals/lfo"]) {
    await waitUntil(
      `${name} is marked ended after stop-all`,
      async () => {
        const sig = await signalEntity(name);
        return sig?.ended === true ? sig : false;
      },
    );
  }
  projectSummaries.push(
    "feature-signals-and-scopes: restored roll, two playheads on one melody (both value shapes), scope-ready lfo, sticky ended",
  );
}

async function verifyLifecycleBasics(): Promise<void> {
  console.log("\n=== feature-lifecycle-basics ===");
  await openProject("feature-lifecycle-basics");

  // Natural completion: no stop is ever posted for this module.
  const finite = await launchModule("lifecycle/finite");
  assert(finite.launchStatus === 200, "finite launch accepted");
  await waitForRun("lifecycle/finite", "stopped", finite.generatedRunId);

  const steady = await launchModule("lifecycle/steady");
  await waitForRun("lifecycle/steady", "running", steady.generatedRunId);
  const beforeReplace = await waitUntil(
    "steady heartbeat is counting",
    async () => {
      const entity = await paramsEntity("lifecycle/steady");
      return entity && entity.values.heartbeat > 0 ? entity : false;
    },
  );

  const refused = await launchModule("lifecycle/steady");
  assert(
    refused.launchStatus === 409,
    "second launch without replaceRunning is refused with 409",
  );

  const replacement = await launchModule("lifecycle/steady", {
    replaceRunning: true,
  });
  assert(
    replacement.generatedRunId !== steady.generatedRunId,
    "replacement got a fresh generated run id",
  );
  await waitForRun(
    "lifecycle/steady",
    "running",
    replacement.generatedRunId,
  );
  await waitUntil(
    "heartbeat continues (not reset) across Replace",
    async () => {
      const entity = await paramsEntity("lifecycle/steady");
      return entity.values.heartbeat > beforeReplace.values.heartbeat
        ? entity
        : false;
    },
  );

  const cleanup = await launchModule("lifecycle/cleanup");
  await waitForRun("lifecycle/cleanup", "running", cleanup.generatedRunId);
  await waitUntil(
    "cleanup ticks while running",
    async () => {
      const entity = await paramsEntity("lifecycle/cleanup");
      return entity && entity.values.ticks > 0 ? entity : false;
    },
  );
  await post("/runtime/stop", { moduleId: "lifecycle/cleanup" });
  await waitForRun("lifecycle/cleanup", "stopped");
  await waitUntil(
    "stop() hook effect observed: stops === 1 and lastStop stamped",
    async () => {
      const entity = await paramsEntity("lifecycle/cleanup");
      return entity.values.stops === 1 && entity.values.lastStop !== "never"
        ? entity
        : false;
    },
  );

  await post("/runtime/stop", { moduleId: "lifecycle/steady" });
  await waitForRun("lifecycle/steady", "stopped");
  projectSummaries.push(
    "feature-lifecycle-basics: natural completion, 409 without consent, Replace with fresh run id + surviving values, observable stop() hook",
  );
}

async function verifyStudioCombined(): Promise<void> {
  console.log("\n=== feature-studio-combined ===");
  await openProject("feature-studio-combined");

  // Pre-launch persistence: saved values (not declaration defaults) and meta.
  const mix = await waitUntil(
    "studio/mix params restored before any module ran",
    () => paramsEntity("studio/mix"),
  );
  assert(
    mix.values.tempo.secondsPerBeat === 0.3 &&
      mix.values.dynamics.velocity === 88,
    "restored values win over declaration defaults (0.3s/beat, vel 88)",
  );
  assert(
    mix.meta?.monitor?.level?.graph === true &&
      mix.meta?.tempo?.secondsPerBeat?.min === 0.1,
    "saved meta restored with the values (pane renders pre-launch)",
  );
  const theme = await waitUntil(
    "studio/theme roll restored from the checked-in data file",
    async () => {
      const current = await roll("studio/theme");
      return current?.data?.notes?.length === 9 ? current : false;
    },
  );
  assert(theme.data.notes[0].pitch === 60, "restored theme keeps its notes");

  const performer = await launchModule("studio/performer");
  await waitForRun("studio/performer", "running", performer.generatedRunId);
  const playhead = await waitUntil(
    "studio/playhead signal anchored to studio/theme",
    async () => {
      const sig = await signalEntity("studio/playhead");
      return sig && typeof sig.value === "number" &&
          sig.anchor?.type === "pianoRoll" &&
          sig.anchor?.name === "studio/theme"
        ? sig
        : false;
    },
  );
  await waitUntil(
    "playhead keeps moving",
    async () => {
      const sig = await signalEntity("studio/playhead");
      return sig.value !== playhead.value ? sig : false;
    },
  );
  await waitUntil(
    "monitor.level is driven by the performer (updatedBy code, > 0)",
    async () => {
      const entity = await paramsEntity("studio/mix");
      return entity.updatedBy === "code" && entity.values.monitor.level > 0
        ? entity
        : false;
    },
  );
  await waitUntil(
    "declaration reattached without resetting saved values",
    async () => {
      const entity = await paramsEntity("studio/mix");
      return entity.values.tempo.secondsPerBeat === 0.3 ? entity : false;
    },
  );

  const sparkle = await launchModule("studio/sparkle");
  await waitForRun("studio/sparkle", "stopped", sparkle.generatedRunId);
  const variation = await waitUntil(
    "studio/theme-var written by the finite variation module",
    async () => {
      const current = await roll("studio/theme-var");
      return current?.data?.notes?.length === 9 ? current : false;
    },
  );
  assert(
    variation.data.notes[0].pitch === 72,
    "variation is transposed up an octave",
  );

  await post("/runtime/stop", { moduleId: "studio/performer" });
  await waitForRun("studio/performer", "stopped");
  await waitUntil(
    "playhead signal ended with its run",
    async () => {
      const sig = await signalEntity("studio/playhead");
      return sig?.ended === true ? sig : false;
    },
  );
  await waitUntil(
    "performer stop() hook parked monitor.level at 0",
    async () => {
      const entity = await paramsEntity("studio/mix");
      return entity.values.monitor.level === 0 ? entity : false;
    },
  );
  projectSummaries.push(
    "feature-studio-combined: pre-launch restored pane+roll, live playhead+graph field, finite variation writer, stop hook + ended signal",
  );
}

// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  console.log("starting livecode server (port 0)...");
  const child = new Deno.Command("deno", {
    args: [
      "run",
      "--unstable-webgpu",
      "--unstable-ffi",
      "--allow-all",
      "livecode/visualizer/main.ts",
      "--host",
      "localhost",
      "--port",
      "0",
      "--log-level",
      "info",
    ],
    cwd: denoNotebooksDir,
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  const ready = Promise.withResolvers<string>();
  const tail: string[] = [];
  const scan = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        tail.push(line);
        if (tail.length > 60) tail.shift();
        if (line.includes('"serverReady"')) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === "serverReady" && parsed.baseUrl) {
              ready.resolve(parsed.baseUrl);
            }
          } catch {
            // not the JSON line we want
          }
        }
      }
    }
  };
  const drains = [scan(child.stdout), scan(child.stderr)];

  let failed = false;
  try {
    baseUrl = await Promise.race([
      ready.promise,
      new Promise<string>((_, reject) =>
        setTimeout(
          () => reject(new Error("server did not become ready")),
          30_000,
        )
      ),
    ]);
    console.log(`server ready at ${baseUrl}`);

    await verifyParamsBasics();
    await verifyPianoRollFlows();
    await verifyAnimationTimeline();
    await verifySignalsAndScopes();
    await verifyLifecycleBasics();
    await verifyStudioCombined();

    console.log(`\nALL PROJECTS VERIFIED (${checksPassed} checks)`);
    for (const line of projectSummaries) console.log(`  - ${line}`);
  } catch (error) {
    failed = true;
    console.error("\nVERIFICATION FAILED:");
    console.error(error instanceof Error ? error.stack : error);
    console.error("\nlast server output:");
    for (const line of tail.slice(-25)) console.error(`  | ${line}`);
  } finally {
    try {
      await post("/runtime/stop-all", {});
    } catch {
      // server may already be gone
    }
    try {
      child.kill("SIGTERM");
    } catch {
      // already exited
    }
    await Promise.race([
      Promise.allSettled([child.status, ...drains]),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }
  return failed ? 1 : 0;
}

Deno.exit(await main());
