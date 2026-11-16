// Auditioning: moving a selection replays all its notes (drag across a pitch
// row, arrow up/down, pressing a note of the group), and a marquee plays notes
// as it reaches them. Checks the note-ons sent to a fake Web MIDI output.
// Project "zz_audition" is never saved. With the dev server up:
//   NODE_PATH=$(npm root -g) node demo/audition.e2e.mjs
// Set PW_CHROMIUM_PATH when that Playwright has no browser of its own.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(() => {
  const sent = [];
  window.__midiSent = sent;
  class Port extends EventTarget { constructor(id, name, type) { super(); Object.assign(this, { id, name, type, manufacturer: "fake", state: "connected", connection: "closed" }); } async open() {} async close() {} send(d) { sent.push(Array.from(d)); } }
  const access = new EventTarget();
  access.inputs = new Map();
  access.outputs = new Map([["out1", new Port("out1", "IAC Driver Bus 1", "output")]]);
  navigator.requestMIDIAccess = async () => access;
});
await page.route("**/api/projects/zz_audition", (r) => r.request().method() === "PUT" ? r.fulfill({ status: 200, body: "{}" }) : r.fulfill({ status: 404, body: "" }));
await page.goto("http://localhost:5190/?project=zz_audition");
await page.waitForFunction(() => window.__musicRunners?.editor);
await sleep(500);
await page.evaluate(async () => {
  const mr = window.__musicRunners; const ed = mr.editor;
  await mr.midi.ensureMidi();
  const id = mr.shapes.createInstance(ed, "variants", { x: 0, y: 0 });
  const s = ed.getShape(id);
  ed.updateShape({ id, type: s.type, props: { midiOutputName: "IAC Driver Bus 1", showGenerated: false } });
  mr.clips.setClipNotes(s.id, [60, 64, 67, 71].map((p, i) => ({ id: "n" + i, pitch: p, position: i * 2, duration: 1, velocity: 100 })));
  ed.selectNone(); ed.setCamera({ x: 20, y: 40, z: 1 }); window.__id = id;
});
await sleep(800);
await page.evaluate(() => window.__musicRunners.sourceRollHandles.get(window.__id).fitToContent());
await sleep(300);
const shape = page.locator(".runner-shape").first();
const container = shape.locator(".pr-container").first();
const box = await container.boundingBox();
const view = await page.evaluate(() => window.__musicRunners.sourceRollHandles.get(window.__id).getView());
const at = (beat, pitch) => ({ x: box.x + 1 + (beat - view.startBeat) * view.quarterNoteWidth, y: box.y + 1 + (127 - pitch - view.topRow) * view.noteHeight + view.noteHeight / 2 });
const noteOns = () => page.evaluate(() => window.__midiSent.filter((m) => (m[0] & 0xf0) === 0x90 && m[2] > 0).map((m) => m[1]));
const reset = () => page.evaluate(() => { window.__midiSent.length = 0; });

// 1. select three notes, press one of them: the group plays
await page.evaluate(() => window.__musicRunners.sourceRollHandles.get(window.__id).selectNotes(["n0", "n1", "n2"]));
await reset();
let p = at(2.5, 64);
await page.mouse.move(p.x, p.y);
await page.mouse.down();
await sleep(100);
assert.deepEqual((await noteOns()).sort(), [60, 64, 67], "pressing a note of the group plays the group");
// 2. drag the group up two rows: each row replays all three at the new pitches
await reset();
await page.mouse.move(p.x, p.y - view.noteHeight, { steps: 4 });
await page.mouse.move(p.x, p.y - view.noteHeight * 2, { steps: 4 });
await page.mouse.up();
await sleep(100);
let ons = await noteOns();
console.log("drag note-ons", ons);
for (const pitch of [61, 65, 68, 62, 66, 69]) assert.ok(ons.includes(pitch), `moved note ${pitch} played`);
// 3. arrow down replays the selection
await reset();
await page.keyboard.press("ArrowDown");
await sleep(100);
assert.deepEqual((await noteOns()).sort(), [61, 65, 68], "arrow down replays the selection");
// 4. marquee left to right across all four: each plays as it is reached, once
await page.evaluate(() => window.__musicRunners.sourceRollHandles.get(window.__id).selectNotes([]));
await reset();
const from = { x: box.x + 4, y: box.y + 4 };
// Stay inside the grid (the stage only sees the pointer over it)
const to = { x: box.x + box.width - 4, y: box.y + 230 };
await page.mouse.move(from.x, from.y);
await page.mouse.down();
const order = [];
for (let i = 1; i <= 20; i++) {
  await page.mouse.move(from.x + ((to.x - from.x) * i) / 20, to.y);
  for (const pitch of await noteOns()) if (!order.includes(pitch)) order.push(pitch);
}
await page.mouse.up();
ons = await noteOns();
console.log("marquee note-ons in order", ons);
// (steps 2-3 moved the first three notes to 61, 65, 68)
assert.deepEqual(order, [61, 65, 68, 71], "each note plays when the marquee reaches it, left to right");
assert.equal(ons.length, 4, "no repeats while the notes stay inside");
console.log("errors", errors);
assert.equal(errors.length, 0);
console.log("AUDITION OK");
await browser.close();
