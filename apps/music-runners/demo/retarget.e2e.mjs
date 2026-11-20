// Switching an instance's output mid-run takes effect at the next note, not
// at the next loop: notes go to the new port from then on, and a note that
// was sounding on the old port gets its note-off there.
// Project "zz_retarget" is never saved. With the dev server up:
//   NODE_PATH=$(npm root -g) node demo/retarget.e2e.mjs
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
  const sent = (window.__sent = []);
  class Port extends EventTarget {
    constructor(id, name, type) { super(); Object.assign(this, { id, name, type, manufacturer: "fake", state: "connected", connection: "closed" }); }
    async open() {} async close() {}
    send(d) { sent.push({ port: this.name, t: performance.now(), bytes: Array.from(d) }); }
  }
  const access = new EventTarget();
  access.inputs = new Map();
  access.outputs = new Map([["a", new Port("a", "Port A", "output")], ["b", new Port("b", "Port B", "output")]]);
  navigator.requestMIDIAccess = async () => access;
});
await page.route("**/api/projects/zz_retarget", (r) => r.request().method() === "PUT" ? r.fulfill({ status: 200, body: "{}" }) : r.fulfill({ status: 404, body: "" }));
await page.goto("http://localhost:5190/?project=zz_retarget");
await page.waitForFunction(() => window.__musicRunners?.editor);
await sleep(500);
// 16 one-beat notes at 240 bpm: a 4 s loop, a note every 250 ms, each held 200 ms
await page.evaluate(async () => {
  const mr = window.__musicRunners, ed = mr.editor;
  await mr.midi.ensureMidi();
  const id = mr.shapes.createInstance(ed, "variants", { x: 0, y: 0 });
  const s = ed.getShape(id);
  ed.updateShape({ id, type: s.type, props: { midiOutputName: "Port A", tempo: 240 } });
  mr.clips.setClipLoopLength(id, 16);
  mr.clips.setClipNotes(id, Array.from({ length: 16 }, (_, i) => ({ id: "n" + i, pitch: 60 + i, position: i, duration: 0.8, velocity: 100 })));
  window.__id = id;
});
await sleep(500);
await page.evaluate(() => window.__musicRunners.playback.startPlay(window.__id));
await sleep(900);
// mid-note on port A: switch to port B
const switchAt = await page.evaluate(() => {
  const ed = window.__musicRunners.editor, s = ed.getShape(window.__id);
  ed.updateShape({ id: s.id, type: s.type, props: { midiOutputName: "Port B" } });
  return performance.now();
});
await sleep(1000);
await page.evaluate(() => window.__musicRunners.playback.stopInstance(window.__id));
await sleep(200);
const sent = await page.evaluate(() => window.__sent);
const ons = (port) => sent.filter((m) => m.port === port && (m.bytes[0] & 0xf0) === 0x90 && m.bytes[2] > 0);
const offs = (port) => sent.filter((m) => m.port === port && ((m.bytes[0] & 0xf0) === 0x80 || ((m.bytes[0] & 0xf0) === 0x90 && m.bytes[2] === 0)));
const firstB = ons("Port B")[0];
console.log("A ons", ons("Port A").map((m) => m.bytes[1]), "B ons", ons("Port B").map((m) => m.bytes[1]));
console.log("first B note-on", firstB ? (firstB.t - switchAt).toFixed(0) + "ms after the switch" : "none");
assert.ok(firstB, "notes go to the new port");
assert.ok(firstB.t - switchAt < 300, "at the next note (one step is 250 ms), not the next loop (4 s)");
assert.ok(ons("Port A").every((m) => m.t < switchAt), "no notes to the old port after the switch");
const lastA = ons("Port A").at(-1);
assert.ok(offs("Port A").some((m) => m.bytes[1] === lastA.bytes[1] && m.t > switchAt), "the note sounding at the switch is released on the old port");
for (const on of ons("Port B")) assert.ok(offs("Port B").some((m) => m.bytes[1] === on.bytes[1] && m.t > on.t), `B note ${on.bytes[1]} released on B`);
console.log("errors", errors);
assert.equal(errors.length, 0);
console.log("RETARGET OK");
await browser.close();
