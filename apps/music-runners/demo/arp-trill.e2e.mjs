// Arp notes trigger trills like variants notes: a chord note tagged "trill
// trigger" sends a trill event to the arp's arrow targets each time an arp
// note drawn from it plays, with that arp note's pitch. Untagged chord notes
// send nothing.
// Project "zz_arptrill" is never saved. With the dev server up:
//   NODE_PATH=$(npm root -g) node demo/arp-trill.e2e.mjs
// Set PW_CHROMIUM_PATH when that Playwright has no browser of its own.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
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
await page.route("**/api/projects/zz_arptrill", (r) => r.request().method() === "PUT" ? r.fulfill({ status: 200, body: "{}" }) : r.fulfill({ status: 404, body: "" }));
await page.goto("http://localhost:5190/?project=zz_arptrill");
await page.waitForFunction(() => window.__musicRunners?.editor);
await sleep(500);
const ids = await page.evaluate(async () => {
  const mr = window.__musicRunners, ed = mr.editor;
  await mr.midi.ensureMidi();
  const a = mr.shapes.createInstance(ed, "arp", { x: 0, y: 0 });
  const b = mr.shapes.createInstance(ed, "extender", { x: 1200, y: 0 });
  for (const id of [a, b]) {
    const s = ed.getShape(id);
    ed.updateShape({ id, type: s.type, props: { midiOutputName: "Port A", tempo: 480 } });
  }
  // C E G at the cursor (beat 0); E (index 1) is a trill trigger asking for 3
  mr.clips.setClipNotes(a, [
    { id: "c", pitch: 60, position: 0, duration: 4, velocity: 100 },
    { id: "e", pitch: 64, position: 0, duration: 4, velocity: 90, metadata: { trill: { probability: 1, notes: [3] } } },
    { id: "g", pitch: 67, position: 0, duration: 4, velocity: 100 },
  ]);
  mr.clips.setClipNotes(b, [{ id: "x", pitch: 50, position: 0, duration: 0.5, velocity: 100 }]);
  mr.clips.setClipLoopLength(b, 2);
  const s = ed.getShape(a);
  ed.updateShape({ id: a, type: s.type, props: { params: { ...s.props.params, pattern: "0 1 2 1" } } });
  const arrow = "shape:arrow_at";
  ed.run(() => {
    ed.createShape({ id: arrow, type: "arrow", x: 0, y: 0, props: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } } });
    ed.createBindings([
      { type: "arrow", fromId: arrow, toId: a, props: { terminal: "start", normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false } },
      { type: "arrow", fromId: arrow, toId: b, props: { terminal: "end", normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false } },
    ]);
  });
  return { a, b };
});
await sleep(400);
// The arp offers the trill trigger tag
const tagLabels = await page.evaluate(async () => (await import("/src/runners/arp/runner.ts")).arpRunner.tags.map((t) => t.label));
assert.deepEqual(tagLabels, ["trill trigger"]);
await page.evaluate(({ a, b }) => { window.__musicRunners.playback.startRun(b); window.__musicRunners.playback.startRun(a); }, ids);
// 4-beat cycle at 480 bpm = 0.5 s: about 6 cycles, two E notes per cycle
await sleep(3000);
await page.evaluate(({ a, b }) => { window.__musicRunners.playback.stopInstance(a); window.__musicRunners.playback.stopInstance(b); }, ids);
const got = await page.evaluate((b) => JSON.parse(JSON.stringify(window.__musicRunners.stores.eventLogStore.byShape[b] ?? [])), ids.b);
console.log("trill events", got.length, JSON.stringify(got.slice(0, 3).map((e) => e.event)));
assert.ok(got.length >= 4, "two per cycle, over several cycles");
assert.ok(got.every((e) => e.event.type === "trill" && e.event.pitch === 64 && e.event.count === 3 && e.event.velocity === 90), "only E fires, with its pitch, velocity and requested count");
console.log("errors", errors);
assert.equal(errors.length, 0);
console.log("ARP TRILL OK");
await browser.close();
