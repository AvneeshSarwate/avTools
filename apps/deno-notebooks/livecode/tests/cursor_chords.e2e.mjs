// Run from apps/deno-notebooks: node livecode/tests/cursor_chords.e2e.mjs
// Requires the built livecode-tldraw UI. Only a temporary project copy is edited.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import http from "node:http";
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const tmp = mkdtempSync(path.join(tmpdir(), "cursor-chords-browser-"));
cpSync(
  root + "/apps/livecode-tldraw/example-projects/six-sines-cursor-chords",
  tmp + "/project",
  { recursive: true },
);
const bake = spawnSync("deno", [
  "run",
  "--allow-all",
  "livecode/browser_host/bake_project.ts",
  "--project",
  tmp + "/project",
  "--out",
  tmp + "/site",
  "--ui",
  root + "/apps/livecode-tldraw/dist",
], { cwd: root + "/apps/deno-notebooks", encoding: "utf8" });
if (bake.status) throw Error(bake.stderr + bake.stdout);
console.log("Baked", tmp);
const server = http.createServer((req, res) => {
  try {
    const pathname = new URL(req.url, "http://local").pathname;
    const file = tmp + "/site" +
      (pathname === "/" ? "/index.html" : decodeURIComponent(pathname));
    const body = readFileSync(file);
    res.setHeader(
      "Content-Type",
      file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".html")
        ? "text/html"
        : file.endsWith(".wasm")
        ? "application/wasm"
        : file.endsWith(".css")
        ? "text/css"
        : file.endsWith(".json")
        ? "application/json"
        : "application/octet-stream",
    );
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + server.address().port;
const browser = await chromium.launch({
  headless: true,
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
  ],
});
const context = await browser.newContext({
  viewport: { width: 1800, height: 1200 },
});
await context.addInitScript(() => {
  window.__batches = [];
  const post = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (message, ...args) {
    if (message?.type === "eventsNow") {
      window.__batches.push({
        time: performance.now(),
        events: structuredClone(message.events),
      });
    }
    return post.call(this, message, ...args);
  };
  const Native = window.AudioWorkletNode;
  window.AudioWorkletNode = class extends Native {
    constructor(ctx, name, opts) {
      super(ctx, name, opts);
      if (name === "six-sines") {
        window.__audioAnalyser = ctx.createAnalyser();
        this.connect(window.__audioAnalyser);
      }
    }
  };
});
context.setDefaultTimeout(10000);
const engine = await context.newPage();
const errors = [];
const engineLog = [];
engine.on("pageerror", (e) => errors.push(String(e)));
engine.on("console", (m) => {
  engineLog.push(m.text());
  if (
    m.type() === "error" && !m.text().includes("WebSocket") &&
    !m.text().includes("module script")
  ) errors.push(m.text());
});
try {
  await engine.goto(origin + "/engine/engine.html");
  await engine.waitForFunction(
    () => window.__batches.some((b) => b.events.length > 100),
    null,
    { timeout: 30000 },
  );
  const ui = await context.newPage();
  ui.on("pageerror", (e) => errors.push(String(e)));
  await ui.goto(
    origin + "/?serverBaseUrl=none&sync=broadcast&actions=broadcast",
  );
  await ui.waitForFunction(() =>
    window.__livecodeSyncDebug?.getEntities("params")["cursor-chords/controls"]
  );
  await ui.evaluate(() =>
    window.__livecodeTldrawRuntimeDebug.selectShapes([
      "shape:cursor-chords-controls",
      "shape:cursor-chords-phrase",
    ])
  );
  await ui.keyboard.press("Shift+2");
  await ui.waitForTimeout(300);
  const play = ui.getByRole("button", { name: "Play at cursor", exact: true });
  const off = ui.getByRole("button", { name: "Off", exact: true });
  const batches = () => engine.evaluate(() => window.__batches);
  const noteBatches = async () =>
    (await batches()).filter((b) =>
      b.events.some((e) => e.type === 1 || e.type === 2)
    );
  const setParams = (values) =>
    ui.evaluate(
      (values) =>
        window.__livecodeSyncDebug.setParams("cursor-chords/controls", values),
      values,
    );
  const modes = ui.locator(".param-pane-shape select");
  assert.equal(await modes.count(), 3);
  assert.deepEqual(await modes.first().locator("option").allTextContents(), [
    "Off",
    "On (sine)",
    "Random ramp",
  ]);
  await play.click();
  await engine.waitForFunction(() =>
    window.__batches.some((b) => b.events.some((e) => e.type === 1))
  );
  let first = (await noteBatches()).at(-1).events.filter((e) => e.type === 1);
  assert.deepEqual(first.map((e) => e.key), [48, 55, 60, 64]);
  await engine.waitForFunction(() => {
    const a = window.__audioAnalyser;
    const buf = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(buf);
    return Math.max(...buf.map(Math.abs)) > 1e-5;
  });
  await play.click();
  await engine.waitForFunction(() =>
    window.__batches.filter((b) => b.events.some((e) => e.type === 1))
      .length === 2
  );
  const repeated = (await noteBatches()).at(-1).events.filter((e) =>
    e.type === 1 || e.type === 2
  );
  assert.deepEqual(
    repeated.slice(0, 4).map((e) => [e.type, e.noteId]),
    first.map((e) => [2, e.noteId]),
  );
  assert.deepEqual(
    repeated.slice(4).map((e) => e.key),
    first.map((e) => e.key),
  );
  assert.equal(
    new Set([...first, ...repeated.slice(4)].map((e) => e.noteId)).size,
    8,
  );
  // A real empty-grid click commits the green cursor without emitting a note edit.
  const roll = ui.locator("piano-roll-component");
  await roll.evaluate((el) => {
    window.__noteEdits = 0;
    el.addEventListener("notes-update", () => window.__noteEdits++);
  });
  await ui.waitForTimeout(500);
  const canvas = await roll.locator("canvas").first().boundingBox();
  await ui.mouse.click(
    canvas.x + canvas.width * .28,
    canvas.y + canvas.height * .55,
  );
  await ui.waitForFunction(() =>
    window.__livecodeSyncDebug.getEntities("pianoRoll")["cursor-chords/chords"]
      .data.playStartPosition >= 4
  );
  const cursor = await ui.evaluate(() =>
    window.__livecodeSyncDebug.getEntities("pianoRoll")["cursor-chords/chords"]
      .data.playStartPosition
  );
  assert(cursor >= 4 && cursor < 8);
  assert.equal(await ui.evaluate(() => window.__noteEdits), 0);
  assert.equal(await roll.evaluate((el) => el.getPlayStartPosition()), cursor);
  await play.click();
  await engine.waitForFunction(() =>
    window.__batches.filter((b) => b.events.some((e) => e.type === 1))
      .length === 3
  );
  assert.deepEqual(
    (await noteBatches()).at(-1).events.filter((e) => e.type === 1).map((e) =>
      e.key
    ),
    [48, 57, 60, 65],
  );
  const synthRev = await ui.evaluate(() =>
    window.__livecodeSyncDebug.getEntities("sixSines")["cursor-chords/synth"]
      .rev
  );
  // Real dropdown changes round-trip to the running engine. Spread was sampled
  // at note-on; the four sine outputs must diverge while remaining bipolar.
  await modes.nth(0).selectOption({ label: "On (sine)" });
  await modes.nth(1).selectOption({ label: "On (sine)" });
  await modes.nth(2).selectOption({ label: "On (sine)" });
  await engine.waitForTimeout(1200);
  const modulation = (await batches()).flatMap((b) => b.events).filter((e) =>
    e.type === 5
  );
  assert.deepEqual([...new Set(modulation.map((e) => e.paramId))].sort(), [
    40000,
    40250,
    40500,
  ]);
  assert(
    modulation.some((e) => e.value < -.05) &&
      modulation.some((e) => e.value > .05),
  );
  assert(modulation.every((e) => Math.abs(e.value) <= .5));
  const together = (await batches()).find((b) =>
    b.events.filter((e) => e.type === 5 && e.paramId === 40000).length === 4
  );
  assert(
    new Set(
      together.events.filter((e) => e.paramId === 40000).map((e) => e.value),
    ).size > 1,
  );
  for (let i = 0; i < 3; i++) await modes.nth(i).selectOption({ label: "Off" });
  await engine.waitForFunction(() =>
    window.__batches.some((b) =>
      b.events.filter((e) => e.type === 5 && e.value === 0).length >= 4
    )
  );
  await off.click();
  await setParams({
    macro1: { rateHz: 1, rateSpreadHz: 0, depth: .5 },
    macro2: { rateHz: 1, rateSpreadHz: 0 },
    macro3: { rateHz: 1, rateSpreadHz: 0 },
  });
  // Replace all lanes with distinct constant ramps in this disposable test copy.
  const durations = await engine.evaluate(async () => {
    const { animationTimeline } = await import("animation-timeline");
    const timeline = animationTimeline("cursor-chords/ramps");
    window.__originalRamps = structuredClone(timeline.data());
    const data = structuredClone(timeline.data());
    data.tracks.forEach((t, i) => {
      t.elementData = [{ id: t.id + "a", time: 0, value: (i + 1) / 5 }, {
        id: t.id + "b",
        time: 3.2,
        value: (i + 1) / 5,
      }];
    });
    timeline.set(data);
    return window.__originalRamps.tracks.map((t) => t.elementData.at(-1).time);
  });
  assert.equal(durations.length, 4);
  assert(durations.every((d) => d >= 3 && d <= 4));
  await modes.nth(0).selectOption({ label: "Random ramp" });
  await engine.evaluate(() => window.__batches = []);
  await play.click();
  await engine.waitForFunction(() =>
    window.__batches.some((b) =>
      b.events.filter((e) => e.type === 5).length === 4
    )
  );
  const initialRamps = (await batches()).flatMap((b) => b.events).filter((e) =>
    e.type === 5
  );
  assert(
    initialRamps.every((e) =>
      [.1, .2, .3, .4].some((v) => Math.abs(e.value - v) < 1e-9)
    ),
  );
  const editTime = await engine.evaluate(async () => {
    const { animationTimeline } = await import("animation-timeline");
    const timeline = animationTimeline("cursor-chords/ramps");
    const data = structuredClone(timeline.data());
    data.tracks.forEach((t) =>
      t.elementData.forEach((p) => p.value = -p.value)
    );
    timeline.set(data);
    return performance.now();
  });
  await engine.waitForTimeout(700);
  assert(
    !(await batches()).filter((b) => b.time > editTime).flatMap((b) => b.events)
      .some((e) => e.type === 5 && e.value < 0),
    "lane edit must not jump the active ramp",
  );
  await engine.waitForFunction(
    () =>
      window.__batches.some((b) =>
        b.events.some((e) => e.type === 5 && e.value < 0)
      ),
    null,
    { timeout: 6000 },
  );
  const refresh = (await batches()).flatMap((b) =>
    b.events.filter((e) => e.type === 5 && e.value < 0).map((e) => ({
      ...e,
      time: b.time,
    }))
  );
  assert.equal(refresh.length, 4);
  for (const e of refresh) {
    assert(
      Math.abs(
        e.value + initialRamps.find((a) => a.noteId === e.noteId).value,
      ) < 1e-9,
    );
    assert(e.time - editTime > 2000);
  }
  assert.equal(
    await ui.evaluate(() =>
      window.__livecodeSyncDebug.getEntities("sixSines")["cursor-chords/synth"]
        .rev
    ),
    synthRev,
    "per-note LFOs must not churn the synth entity",
  );
  // Restore the seeded lanes, and capture the actual editor/control layout.
  await engine.evaluate(async () => {
    const { animationTimeline } = await import("animation-timeline");
    animationTimeline("cursor-chords/ramps").set(window.__originalRamps);
  });
  await off.click();
  await engine.waitForTimeout(100);
  const afterOff = (await batches()).length;
  await engine.waitForTimeout(250);
  assert.equal(
    (await batches()).length,
    afterOff,
    "released voices stop receiving modulation",
  );
  await ui.evaluate(() =>
    window.__livecodeTldrawRuntimeDebug.selectShapes([
      "shape:cursor-chords-controls",
      "shape:cursor-chords-phrase",
      "shape:cursor-chords-ramps",
    ])
  );
  await ui.keyboard.press("Shift+2");
  await ui.waitForTimeout(250);
  const artifacts = path.join(
    root,
    "apps/livecode-tldraw/output/playwright/cursor-chords",
  );
  mkdirSync(artifacts, { recursive: true });
  await ui.screenshot({ path: path.join(artifacts, "controls.png") });
  // The UI can be replaced while the engine survives, including cursor state.
  await ui.reload();
  await ui.waitForFunction(
    (position) =>
      window.__livecodeSyncDebug?.getEntities(
        "pianoRoll",
      )["cursor-chords/chords"]?.data.playStartPosition === position,
    cursor,
  );
  await engine.evaluate(() =>
    window.__livecodeBrowserEngine.stop("cursor-chords/player")
  );
  assert.deepEqual(
    await engine.evaluate(() =>
      window.__livecodeBrowserEngine.activeModuleIds()
    ),
    [],
  );
  // The same authored project also boots and plays in the single-page form.
  await ui.close();
  await engine.close();
  const single = await context.newPage();
  single.on("pageerror", (e) => errors.push(String(e)));
  await single.goto(origin + "/");
  await single.waitForFunction(() =>
    window.__batches.some((b) => b.events.length > 100)
  );
  await single.waitForFunction(() =>
    window.__livecodeSyncDebug?.getEntities("params")["cursor-chords/controls"]
  );
  await single.evaluate(() =>
    window.__livecodeTldrawRuntimeDebug.selectShapes([
      "shape:cursor-chords-controls",
      "shape:cursor-chords-phrase",
    ])
  );
  await single.keyboard.press("Shift+2");
  await single.waitForTimeout(500);
  await single.getByRole("button", { name: "Play at cursor", exact: true })
    .click();
  await single.waitForFunction(() =>
    window.__batches.some((b) =>
      b.events.filter((e) => e.type === 1).length === 4
    )
  );
  await single.locator(".param-pane-shape select").first().selectOption({
    label: "Random ramp",
  });
  await single.waitForFunction(() =>
    window.__batches.some((b) =>
      b.events.some((e) => e.type === 5 && e.value !== 0)
    )
  );
  await single.getByRole("button", { name: "Off", exact: true }).click();
  await single.waitForFunction(() =>
    window.__batches.some((b) =>
      b.events.filter((e) => e.type === 2).length === 4
    )
  );
  await single.evaluate(() =>
    window.__livecodeBrowserEngine.stop("cursor-chords/player")
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: two-tab cursor, real buttons/dropdowns/audio, unique same-pitch IDs, bipolar per-note sine spread, ramp boundary refresh, no synth-state churn, UI reload, Stop, and same-tab playback.",
  );
  console.log("errors", errors);
} catch (error) {
  console.error(engineLog.slice(-30).join("\n"));
  console.error(errors);
  throw error;
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
