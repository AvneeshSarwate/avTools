// The Generated roll shows the roll-over: the note the extender holds past
// the loop end is drawn running past it in its own pass, and in the next pass
// its remaining tail is drawn from the loop's start (from the previous
// buffer, runtime.carried), coloured as sounding, not as unplayed.
// Project "zz_carry" is never saved. With the dev server up:
//   NODE_PATH=$(npm root -g) node demo/extender-carry.e2e.mjs [screenshot dir]
// Set PW_CHROMIUM_PATH when that Playwright has no browser of its own.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import path from "node:path";
const { chromium } = createRequire(import.meta.url)("playwright");
const SHOTS = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1300, height: 1100 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(() => {
  class Port extends EventTarget {
    constructor() { super(); Object.assign(this, { id: "a", name: "Port A", type: "output", manufacturer: "fake", state: "connected", connection: "closed" }); }
    async open() {} async close() {} send() {}
  }
  const access = new EventTarget();
  access.inputs = new Map();
  access.outputs = new Map([["a", new Port()]]);
  navigator.requestMIDIAccess = async () => access;
});
await page.route("**/api/projects/zz_carry", (r) => r.request().method() === "PUT" ? r.fulfill({ status: 200, body: "{}" }) : r.fulfill({ status: 404, body: "" }));
await page.goto("http://localhost:5190/?project=zz_carry");
await page.waitForFunction(() => window.__musicRunners?.editor);
await sleep(500);
// 8-beat loop at 480 bpm (1 s): four 1.5-beat notes, one extended by 8 each pass
await page.evaluate(async () => {
  const mr = window.__musicRunners, ed = mr.editor;
  await mr.midi.ensureMidi();
  const id = mr.shapes.createInstance(ed, "extender", { x: 0, y: 0 });
  const s = ed.getShape(id);
  ed.updateShape({ id, type: s.type, props: { midiOutputName: "Port A", tempo: 480, showGenerated: true } });
  mr.clips.setClipLoopLength(id, 8);
  mr.clips.setClipNotes(id, [0, 2, 4, 6].map((p, i) => ({ id: "n" + i, pitch: 60 + i * 3, position: p, duration: 1.5, velocity: 100 })));
  window.__id = id;
  ed.zoomToFit();
});
await sleep(400);
const runtime = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__musicRunners.stores.playbackStore.instances[window.__id])));
await page.evaluate(() => window.__musicRunners.playback.startRun(window.__id));
await page.waitForFunction(() => window.__musicRunners.stores.playbackStore.instances[window.__id]?.loopCount === 1);
let r = await runtime();
assert.deepEqual(r.carried, [], "nothing carried into the first pass");
const first = r.generated.notes.find((n) => n.metadata?.extended);
assert.ok(first && first.duration === 9.5, "one note held a loop longer");
await page.waitForFunction(() => window.__musicRunners.stores.playbackStore.instances[window.__id]?.loopCount === 2);
r = await runtime();
console.log("loop 1 extended", first.pitch, first.position, first.duration, "-> loop 2 carried", JSON.stringify(r.carried.map((n) => [n.pitch, n.position, n.duration])));
const tail = r.carried.find((n) => n.pitch === first.pitch);
assert.ok(tail, "its tail is carried into the next pass");
assert.equal(tail.position, 0, "from the loop's start");
assert.equal(tail.duration, first.position + 9.5 - 8, "for what is left of it");
assert.ok(tail.metadata.carried && tail.metadata.extended, "marked carried, keeps the extended colour");
assert.ok(!r.generated.notes.some((n) => n.metadata?.carried), "carried notes are display only, not in the loop that plays");
await sleep(150);
if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "extender-carry.png") });
await page.evaluate(() => window.__musicRunners.playback.stopInstance(window.__id));
await sleep(200);
r = await runtime();
await page.evaluate(() => window.__musicRunners.playback.startRun(window.__id));
await page.waitForFunction(() => window.__musicRunners.stores.playbackStore.instances[window.__id]?.loopCount === 1);
r = await runtime();
assert.deepEqual(r.carried, [], "a new run starts with nothing carried");
await page.evaluate(() => window.__musicRunners.playback.stopInstance(window.__id));
console.log("errors", errors);
assert.equal(errors.length, 0);
console.log("EXTENDER CARRY OK");
await browser.close();
