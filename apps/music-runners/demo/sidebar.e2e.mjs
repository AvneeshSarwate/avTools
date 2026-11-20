// The runner sidebar. Serves projects/default/project.json as project
// "zz_sidebar" (never written: PUTs are captured), then drives the sidebar:
// one row per instance, + per runner type, Play/Run/Stop and the row state,
// click to reveal, double-click to rename, the row's Q (queue) toggle with the
// top bar's Play/Run queued, and dragging the sidebar's edge to resize it. With the dev server up:
//   NODE_PATH=$(npm root -g) node demo/sidebar.e2e.mjs [screenshot dir]
// Set PW_CHROMIUM_PATH when that Playwright has no browser of its own.
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const project = JSON.parse(await readFile(path.join(here, "../projects/default/project.json"), "utf8"));
const runnerShapes = Object.values(project.canvas.document.store).filter((r) => r.typeName === "shape" && r.type.startsWith("runner-"));

const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
await page.addInitScript(() => {
  class Port extends EventTarget {
    constructor(id, name, type) { super(); Object.assign(this, { id, name, type, manufacturer: "fake", state: "connected", connection: "closed", version: "1" }); }
    async open() { this.connection = "open"; return this; }
    async close() { this.connection = "closed"; return this; }
    send() {}
  }
  const access = new EventTarget();
  access.inputs = new Map();
  access.outputs = new Map([["out1", new Port("out1", "Fake Synth", "output")]]);
  access.sysexEnabled = false;
  navigator.requestMIDIAccess = async () => access;
});
const saved = [];
await page.route("**/api/projects/zz_sidebar", (r) => {
  if (r.request().method() === "PUT") {
    saved.push(JSON.parse(r.request().postData()));
    return r.fulfill({ status: 200, body: "{}" });
  }
  return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...project, name: "zz_sidebar" }) });
});
await page.goto("http://localhost:5190/?project=zz_sidebar");
await page.waitForFunction(() => window.__musicRunners?.editor && window.__musicRunners.stores.projectStore.status !== "loading");
await sleep(800);

// --- every instance has its clip
const loaded = await page.evaluate(() => {
  const mr = window.__musicRunners;
  return mr.editor.store.allRecords().filter((r) => r.typeName === "shape" && r.type.startsWith("runner-")).map((r) => ({
    id: r.id, name: r.props.name, clip: JSON.parse(JSON.stringify(mr.stores.clipsStore.clips[r.id] ?? null)),
  }));
});
assert.equal(loaded.length, runnerShapes.length);
for (const shape of loaded) assert.deepEqual(shape.clip, project.clips[shape.id], "the clip loads as saved");

// --- sidebar rows match the canvas
const rowCount = await page.locator(".runner-row[data-shape-id]").count();
assert.equal(rowCount, loaded.length, "one row per instance");
for (const def of ["variants", "extender"]) {
  const expected = loaded.filter((s) => runnerShapes.find((r) => r.id === s.id).type === `runner-${def}`).length;
  assert.equal(await page.locator(`.runner-group[data-runner-type=${def}] .runner-row[data-shape-id]`).count(), expected, `${def} rows`);
}

// --- + creates an instance of that type, selected and named
await page.locator(".runner-group[data-runner-type=extender] .runner-group__add").click();
await sleep(500);
const created = await page.evaluate(() => {
  const ed = window.__musicRunners.editor;
  const [id] = ed.getSelectedShapeIds();
  const s = ed.getShape(id);
  const vp = ed.getViewportPageBounds(), b = ed.getShapePageBounds(id);
  return { id, type: s.type, name: s.props.name, visible: vp.collides(b) };
});
console.log("created", JSON.stringify(created));
assert.equal(created.type, "runner-extender");
assert.match(created.name, /^extender \d+$/);
assert.ok(created.visible, "the new instance is brought into view");
const createdRow = page.locator(`.runner-row[data-shape-id="${created.id}"]`);
assert.ok(await createdRow.evaluate((el) => el.classList.contains("is-selected")), "its row shows as selected");
assert.equal(await page.locator(".top-bar__add").count(), 0, "no Add runner chooser in the top bar");

// --- transport state from the sidebar
const playing = loaded.find((s) => s.clip.notes.length > 0);
const row = page.locator(`.runner-row[data-shape-id="${playing.id}"]`);
// The saved output is not connected here: the row shows the error
await page.evaluate((id) => { const ed = window.__musicRunners.editor; ed.updateShape({ id, type: ed.getShape(id).type, props: { midiOutputName: "Missing Port" } }); }, playing.id);
await row.locator("button[title^='Play']").click();
await page.waitForFunction((id) => window.__musicRunners.stores.playbackStore.instances[id]?.error, playing.id);
assert.equal(await row.locator(".runner-row__status").innerText(), "error", "a failed start shows on the row");
await page.evaluate((id) => { const ed = window.__musicRunners.editor; ed.updateShape({ id, type: ed.getShape(id).type, props: { midiOutputName: "Fake Synth" } }); }, playing.id);
await row.locator("button[title^='Play']").click();
await page.waitForFunction((id) => window.__musicRunners.stores.playbackStore.instances[id]?.mode === "play", playing.id);
await sleep(400);
assert.ok(await row.evaluate((el) => el.classList.contains("runner-row--play")), "row shows play");
assert.match(await row.locator(".runner-row__status").innerText(), /^loop \d+$/);
const progress = await row.locator(".runner-row__progress").evaluate((el) => el.style.transform);
assert.match(progress, /scaleX\(0\.\d+|scaleX\([1-9]/, "loop progress is drawn");
// the shape shows the same state
assert.ok(await page.evaluate((id) => document.querySelector(`[data-shape-id="${id}"] .runner-shape--play`) !== null || [...document.querySelectorAll(".runner-shape--play")].length > 0, playing.id));
await row.locator("button[title^='Run']").click();
// (straight from Play: the cancelled play must not reset the new run's state)
await page.waitForFunction((id) => window.__musicRunners.stores.playbackStore.instances[id]?.mode === "run", playing.id);
await sleep(600);
assert.equal(await page.evaluate((id) => window.__musicRunners.stores.playbackStore.instances[id]?.mode, playing.id), "run", "still run after the old play settled");
assert.ok(await row.evaluate((el) => el.classList.contains("runner-row--run")), "row shows run");
if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "sidebar-running.png") });
await row.locator("button[title='stop']").click();
await page.waitForFunction((id) => window.__musicRunners.stores.playbackStore.instances[id]?.mode === "idle", playing.id);
await sleep(100);
assert.ok(await row.evaluate((el) => el.classList.contains("runner-row--idle")), "row shows idle");
assert.equal(await row.locator(".runner-row__status").innerText(), "", "idle rows show no status text");
assert.equal(await row.locator(".ui-lamp").count(), 0, "no lamp before the name");

// --- click a row: select and reveal
await page.evaluate(() => { const ed = window.__musicRunners.editor; ed.selectNone(); ed.setCamera({ x: -20000, y: -20000, z: 0.5 }); });
await row.locator(".runner-row__name").click();
await sleep(500);
const revealed = await page.evaluate((id) => {
  const ed = window.__musicRunners.editor;
  return { selected: ed.getSelectedShapeIds(), visible: ed.getViewportPageBounds().collides(ed.getShapePageBounds(id)) };
}, playing.id);
assert.deepEqual(revealed.selected, [playing.id]);
assert.ok(revealed.visible, "clicking a row brings its instance into view");

// --- double-click to rename; the title bar follows
await row.locator(".runner-row__name").dblclick();
await row.locator("input").fill("lead line");
await row.locator("input").press("Enter");
await sleep(200);
assert.equal(await page.evaluate((id) => window.__musicRunners.editor.getShape(id).props.name, playing.id), "lead line");
assert.equal(await page.locator(".runner-shape__instance-name").evaluateAll((els) => els.some((el) => el.value === "lead line")), true, "title bar shows the new name");

// --- queue from the sidebar; the top bar plays or runs the queued ones
await page.evaluate(() => window.__musicRunners.playback.stopAll());
const ids = await page.evaluate(() => window.__musicRunners.shapes.listInstances(window.__musicRunners.editor).map((i) => i.id));
const queueOf = (id) => page.evaluate((id) => window.__musicRunners.editor.getShape(id).props.queued, id);
for (const id of ids) {
  if (await queueOf(id)) await page.locator(`.runner-row[data-shape-id="${id}"] .runner-row__queue`).click();
}
const [qa, qb, ...rest] = ids;
await page.locator(`.runner-row[data-shape-id="${qa}"] .runner-row__queue`).click();
await page.locator(`.runner-row[data-shape-id="${qb}"] .runner-row__queue`).click();
await sleep(150);
assert.equal(await queueOf(qa), true, "row Q queues the instance");
assert.equal(await queueOf(qb), true);
for (const id of rest) assert.equal(await queueOf(id), false);
const modes = () => page.evaluate((ids) => ids.map((id) => window.__musicRunners.stores.playbackStore.instances[id]?.mode ?? "idle"), ids);
await page.locator(".top-bar__play-queued").click();
await sleep(400);
let m = await modes();
assert.deepEqual([m[0], m[1]], ["play", "play"], "Play queued plays the queued instances");
assert.ok(m.slice(2).every((x) => x === "idle"), "and only them");
await page.locator(".top-bar__run-queued").click();
await sleep(400);
m = await modes();
assert.deepEqual([m[0], m[1]], ["run", "run"], "Run queued runs them");
await page.locator(".top-bar__stop-all").click();
await sleep(300);
assert.ok((await modes()).every((x) => x === "idle"), "stop all");
await page.locator(`.runner-row[data-shape-id="${qa}"] .runner-row__queue`).click();
await sleep(100);
assert.equal(await queueOf(qa), false, "row Q toggles off");

// --- the sidebar's right edge resizes it; the width is remembered
const sidebarWidth = () => page.evaluate(() => document.querySelector(".runner-sidebar").getBoundingClientRect().width);
const w0 = await sidebarWidth();
const edge = await page.locator(".runner-sidebar__resize").boundingBox();
await page.mouse.move(edge.x + 3, edge.y + 300);
await page.mouse.down();
await page.mouse.move(edge.x + 123, edge.y + 300, { steps: 6 });
await page.mouse.up();
await sleep(150);
const w1 = await sidebarWidth();
console.log("sidebar width", w0, "->", w1);
assert.ok(Math.abs(w1 - w0 - 120) <= 2, "dragging the edge widens the sidebar");
assert.ok(Math.abs(Number(await page.evaluate(() => localStorage.getItem("music-runners:sidebar-width"))) - w1) <= 1, "remembered");
await page.locator(".runner-sidebar__resize").dblclick();
await sleep(100);
assert.equal(await sidebarWidth(), w0, "double-click: back to the default width");

// --- saving writes one clip per instance
await page.evaluate(() => window.__musicRunners.project.saveProject());
await sleep(300);
const file = saved[saved.length - 1];
const savedRunnerIds = Object.values(file.canvas.document.store).filter((r) => r.typeName === "shape" && r.type.startsWith("runner-")).map((r) => r.id).sort();
assert.deepEqual(Object.keys(file.clips).sort(), savedRunnerIds, "one clip per instance");
if (SHOTS) {
  await page.evaluate(() => { window.__musicRunners.editor.zoomToFit(); });
  await sleep(300);
  await page.screenshot({ path: path.join(SHOTS, "sidebar.png") });
}

console.log("errors", errors);
assert.equal(errors.length, 0);
console.log("SIDEBAR OK");
await browser.close();
