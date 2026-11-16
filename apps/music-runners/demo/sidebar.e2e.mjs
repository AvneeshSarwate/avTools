// The runner sidebar and loading a version 1 (bank-based) project. Serves
// projects/default/project.json as project "zz_sidebar" (never written: PUTs
// are captured), then checks that every instance got its own clip and its
// bank's name, and drives the sidebar: + per runner type, Play/Run/Stop and
// the row state, click to reveal, double-click to rename. With the dev
// server up:
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

// A version 1 file: banks shared by reference. Make one bank shared by two
// instances so the split into two clips (and the numbered name) is covered.
const legacy = JSON.parse(await readFile(path.join(here, "../projects/default/project.json"), "utf8"));
if (legacy.version !== 1) {
  console.log("projects/default is no longer a version 1 file; using a built-in sample");
}
const store = legacy.canvas.document.store;
const runnerShapes = Object.values(store).filter((r) => r.typeName === "shape" && r.type.startsWith("runner-"));
assert.equal(legacy.version, 1, "this check needs a version 1 file");
const banks = new Map(legacy.banks.map((b) => [b.id, b]));
const sharedFrom = runnerShapes.find((r) => banks.get(r.props.bankId)?.notes.length);
const sharedTo = runnerShapes.find((r) => r !== sharedFrom && r.type === sharedFrom.type);
if (sharedTo) sharedTo.props.bankId = sharedFrom.props.bankId;

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
  return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...legacy, name: "zz_sidebar" }) });
});
await page.goto("http://localhost:5190/?project=zz_sidebar");
await page.waitForFunction(() => window.__musicRunners?.editor && window.__musicRunners.stores.projectStore.status !== "loading");
await sleep(800);

// --- version 1 conversion
const loaded = await page.evaluate(() => {
  const mr = window.__musicRunners;
  return mr.editor.store.allRecords().filter((r) => r.typeName === "shape" && r.type.startsWith("runner-")).map((r) => ({
    id: r.id, name: r.props.name, hasBankId: "bankId" in r.props, owner: r.meta.clipOwner,
    clip: JSON.parse(JSON.stringify(mr.stores.clipsStore.clips[r.id] ?? null)),
  }));
});
console.log("loaded", JSON.stringify(loaded.map(({ clip, ...rest }) => ({ ...rest, notes: clip?.notes.length }))));
assert.equal(loaded.length, runnerShapes.length);
for (const shape of loaded) {
  const raw = runnerShapes.find((r) => r.id === shape.id);
  const bank = banks.get(raw.props.bankId);
  assert.ok(!shape.hasBankId, "bankId is migrated away");
  assert.equal(shape.owner, shape.id);
  assert.ok(shape.clip, "every instance has a clip");
  assert.equal(shape.clip.notes.length, bank?.notes.length ?? 0, "the clip holds its bank's notes");
  assert.equal(shape.clip.loopLength, bank?.loopLength ?? 16);
}
assert.equal(new Set(loaded.map((s) => s.name)).size, loaded.length, "names are unique");
if (sharedTo) {
  const a = loaded.find((s) => s.id === sharedFrom.id), b = loaded.find((s) => s.id === sharedTo.id);
  assert.equal(a.name, banks.get(sharedFrom.props.bankId).name);
  assert.notEqual(b.name, a.name, "a second user of a shared bank gets its own name");
  assert.doesNotMatch(b.name, /\d+ \d+$/, "numbered like a duplicate, not suffixed twice");
  await page.evaluate((id) => window.__musicRunners.clips.setClipNotes(id, []), b.id);
  assert.equal(await page.evaluate((id) => window.__musicRunners.stores.clipsStore.clips[id].notes.length, a.id), a.clip.notes.length, "a shared bank became two independent clips");
}

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
assert.match(await row.locator(".runner-row__status").innerText(), /^\d+n · [\d.]+b$/, "idle rows show notes and loop length");

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

// --- saving writes version 2: clips by shape id, no banks
await page.evaluate(() => window.__musicRunners.project.saveProject());
await sleep(300);
const file = saved[saved.length - 1];
assert.equal(file.version, 2);
assert.ok(!("banks" in file));
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
