// Per-instance tempo and the Play/Run toggles.
// - Play and Run stop the instance when pressed again.
// - Each instance runs on its own TimeContext tempo (the source section's
//   tempo box): note timing follows it, live changes apply, speed multiplies
//   on top, and the playhead moves in the instance's beats.
// - Projects saved before per-instance tempo load with tempo = the project
//   BPM and speed 1 (shape migration), checked on a copy of projects/default.
// Projects "zz_tempo" / "zz_tempo_mig" are never saved. With the dev server up:
//   NODE_PATH=$(npm root -g) node demo/tempo.e2e.mjs
// Set PW_CHROMIUM_PATH when that Playwright has no browser of its own.
import { createRequire } from "node:module";
import fs from "node:fs";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const errors = [];
const fakeMidi = () => {
  const sent = (window.__midiSent = []);
  class Port extends EventTarget { constructor(id, name, type) { super(); Object.assign(this, { id, name, type, manufacturer: "fake", state: "connected", connection: "closed" }); } async open() {} async close() {} send(d) { sent.push([performance.now(), ...d]); } }
  const access = new EventTarget();
  access.inputs = new Map();
  access.outputs = new Map([["out1", new Port("out1", "IAC Driver Bus 1", "output")]]);
  navigator.requestMIDIAccess = async () => access;
};

// ---------- migration of a pre-tempo project ----------
{
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  const file = JSON.parse(fs.readFileSync(new URL("../projects/default/project.json", import.meta.url), "utf8"));
  const store = file.canvas.document?.store ?? file.canvas.store;
  const schema = file.canvas.document?.schema ?? file.canvas.schema;
  // As saved before this change: no tempo, no AddTempo version
  for (const record of Object.values(store)) if (record.typeName === "shape" && record.type.startsWith("runner")) delete record.props.tempo;
  for (const key of Object.keys(schema.sequences ?? {})) if (key.includes("runner")) delete schema.sequences[key];
  const runners = Object.values(store).filter((r) => r.typeName === "shape" && r.type.startsWith("runner"));
  await page.route("**/api/projects/zz_tempo_mig", (r) => r.request().method() === "PUT" ? r.fulfill({ status: 200, body: "{}" }) : r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...file, name: "zz_tempo_mig" }) }));
  await page.goto("http://localhost:5190/?project=zz_tempo_mig");
  await page.waitForFunction(() => window.__musicRunners?.editor && window.__musicRunners.shapes.listInstances(window.__musicRunners.editor).length > 0);
  await sleep(500);
  const loaded = await page.evaluate(() => window.__musicRunners.shapes.listInstances(window.__musicRunners.editor).map(({ props }) => ({ name: props.name, tempo: props.tempo, speed: props.params.speed })));
  console.log("migrated", JSON.stringify(loaded), "project bpm", file.bpm);
  assert.equal(loaded.length, runners.length);
  for (const r of loaded) {
    assert.equal(r.tempo, file.bpm, `${r.name}: tempo = project bpm`);
    if (r.speed !== undefined) assert.equal(r.speed, 1, `${r.name}: speed 1`);
  }
  await page.close();
}

const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(fakeMidi);
await page.route("**/api/projects/zz_tempo", (r) => r.request().method() === "PUT" ? r.fulfill({ status: 200, body: "{}" }) : r.fulfill({ status: 404, body: "" }));
await page.goto("http://localhost:5190/?project=zz_tempo");
await page.waitForFunction(() => window.__musicRunners?.editor);
await sleep(500);
await page.evaluate(async () => {
  const mr = window.__musicRunners, ed = mr.editor;
  await mr.midi.ensureMidi();
  mr.clock.setBpm(120);
  const id = mr.shapes.createInstance(ed, "variants", { x: 0, y: 0 });
  const s = ed.getShape(id);
  ed.updateShape({ id, type: s.type, props: { midiOutputName: "IAC Driver Bus 1", showGenerated: false } });
  mr.clips.setClipLoopLength(id, 4);
  mr.clips.setClipNotes(id, [0, 1, 2, 3].map((b) => ({ id: "n" + b, pitch: 60 + b, position: b, duration: 0.25, velocity: 100 })));
  ed.selectNone(); ed.setCamera({ x: -s.x + 20, y: -s.y + 20, z: 0.8 });
  window.__id = id;
});
await sleep(800);
const shape = page.locator(".runner-shape").first();
assert.equal(await page.evaluate(() => window.__musicRunners.editor.getShape(window.__id).props.tempo), 120, "a new instance starts at the project BPM");
assert.equal(await shape.locator(".runner-shape__tempo").count(), 1, "tempo box in the source section");

// ---------- Play / Run toggle ----------
const mode = () => page.evaluate(() => window.__musicRunners.stores.playbackStore.instances[window.__id]?.mode ?? "idle");
const play = shape.locator(".runner-shape__strip button", { hasText: "Play" }).first();
const run = shape.locator(".runner-shape__run").first();
await play.click(); await sleep(300);
assert.equal(await mode(), "play");
await play.click(); await sleep(300);
assert.equal(await mode(), "idle", "Play again stops");
await run.click(); await sleep(300);
assert.equal(await mode(), "run");
await play.click(); await sleep(300);
assert.equal(await mode(), "play", "Play while running switches to play");
await run.click(); await sleep(300);
await run.click(); await sleep(300);
assert.equal(await mode(), "idle", "Run again stops");

// ---------- tempo ----------
const onsBetween = (t0) => page.evaluate((t0) => window.__midiSent.filter((m) => m[0] >= t0 && (m[1] & 0xf0) === 0x90 && m[3] > 0).map((m) => m[0]), t0);
async function measure(label, setup, ms) {
  await page.evaluate(setup);
  const t0 = await page.evaluate(() => performance.now());
  await page.evaluate(() => window.__musicRunners.playback.startPlay(window.__id));
  await sleep(ms);
  await page.evaluate(() => window.__musicRunners.playback.stopInstance(window.__id));
  await sleep(150);
  const ons = await onsBetween(t0);
  const gaps = ons.slice(1).map((t, i) => t - ons[i]);
  const median = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  console.log(label, "note-ons", ons.length, "median gap ms", median?.toFixed(0));
  return median;
}
const setTempo = (bpm, speed) => `(() => { const mr = window.__musicRunners, ed = mr.editor, s = ed.getShape(window.__id); ed.updateShape({ id: s.id, type: s.type, props: { tempo: ${bpm}, params: { ...s.props.params, speed: ${speed} } } }); })()`;
let gap = await measure("tempo 120", setTempo(120, 1), 2300);
assert.ok(Math.abs(gap - 500) < 40, "120 bpm: a beat is 500ms");
gap = await measure("tempo 60 (project still 120)", setTempo(60, 1), 3400);
assert.ok(Math.abs(gap - 1000) < 60, "the instance's tempo, not the project's");
gap = await measure("tempo 60, speed 2", setTempo(60, 2), 2300);
assert.ok(Math.abs(gap - 500) < 40, "speed multiplies on top");
// live change while playing: 60 -> 240
await page.evaluate(setTempo(60, 1));
const t0 = await page.evaluate(() => performance.now());
await page.evaluate(() => window.__musicRunners.playback.startPlay(window.__id));
await sleep(2200);
await page.evaluate(setTempo(240, 1));
await sleep(1500);
// the playhead advances in the instance's beats: 4 per second at 240
const head = () => page.evaluate(() => window.__musicRunners.playback.playhead(window.__id));
const h0 = await head();
await sleep(250);
const h1 = await head();
const advanced = (((h1 - h0) % 4) + 4) % 4;
console.log("playhead", h0.toFixed(2), "->", h1.toFixed(2), "advanced", advanced.toFixed(2), "beats in 250ms");
assert.ok(Math.abs(advanced - 1) < 0.15, "playhead in the instance's beats");
await page.evaluate(() => window.__musicRunners.playback.stopInstance(window.__id));
await sleep(150);
const live = await onsBetween(t0);
const lateGaps = live.slice(-4).slice(1).map((t, i) => t - live.slice(-4)[i]);
console.log("live change gaps (last)", lateGaps.map((g) => g.toFixed(0)));
assert.ok(lateGaps.every((g) => Math.abs(g - 250) < 40), "live tempo change applies");
console.log("errors", errors);
assert.equal(errors.length, 0);
console.log("TEMPO OK");
await browser.close();
