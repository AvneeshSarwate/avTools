// End-to-end check of live recording and MPE playback against a fake Web MIDI
// (one input, one output, both in the page), so no device or permission is
// needed. With the dev server up (npm run dev):
//   NODE_PATH=$(npm root -g) node demo/recording.e2e.mjs [screenshot dir]
// Set PW_CHROMIUM_PATH when that Playwright has no browser of its own. It
// uses project "zz_rec_e2e" and deletes it afterwards.
import { createRequire } from "node:module";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");

const here = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = process.argv[2] ?? path.join(here, "screenshots");
const PROJECT = "zz_rec_e2e";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1300, height: 950 } });
page.on("pageerror", (err) => console.error("PAGE ERROR", err));
page.on("console", (msg) => { if (msg.type() === "error") console.error("CONSOLE", msg.text()); });

await page.addInitScript(() => {
  const sent = [];
  window.__midiSent = sent;
  class Port extends EventTarget {
    constructor(id, name, type) { super(); Object.assign(this, { id, name, type, manufacturer: "fake", state: "connected", connection: "closed", version: "1" }); }
    async open() { this.connection = "open"; return this; }
    async close() { this.connection = "closed"; return this; }
    send(data) { sent.push({ t: performance.now(), bytes: Array.from(data) }); }
  }
  const input = new Port("in1", "Fake MPE Controller", "input");
  const output = new Port("out1", "Fake Synth", "output");
  window.__midiIn = (bytes) => {
    const event = new Event("midimessage");
    event.data = Uint8Array.from(bytes);
    Object.defineProperty(event, "timeStamp", { value: performance.now() });
    input.dispatchEvent(event);
  };
  const access = new EventTarget();
  access.inputs = new Map([["in1", input]]);
  access.outputs = new Map([["out1", output]]);
  access.sysexEnabled = false;
  navigator.requestMIDIAccess = async () => access;
});

await page.goto(`http://localhost:5190/?project=${PROJECT}`);
await page.waitForFunction(() => window.__musicRunners?.editor);
await sleep(800);

const shapeId = await page.evaluate(async () => {
  const mr = window.__musicRunners;
  await mr.midi.ensureMidi();
  mr.clock.setBpm(120);
  const id = mr.shapes.createInstance(mr.editor, "variants");
  const shape = mr.editor.getShape(id);
  mr.editor.updateShape({ id, type: shape.type, props: { midiOutputName: "Fake Synth", midiInputName: "Fake MPE Controller", mpe: true } });
  mr.editor.zoomToFit();
  return id;
});
await sleep(600);
const state = () => page.evaluate((id) => {
  const mr = window.__musicRunners;
  const shape = mr.editor.getShape(id);
  const bank = mr.stores.banksStore.banks[shape.props.bankId];
  return { props: shape.props, bank: JSON.parse(JSON.stringify(bank)), rec: JSON.parse(JSON.stringify(mr.stores.recordingStore.byShape[id] ?? null)), runtime: JSON.parse(JSON.stringify(mr.stores.playbackStore.instances[id] ?? null)) };
}, shapeId);
const midiIn = (bytes) => page.evaluate((b) => window.__midiIn(b), bytes);
const sentSince = (t) => page.evaluate((t0) => window.__midiSent.filter((m) => m.t >= t0), t);
const pageNow = () => page.evaluate(() => performance.now());

let s = await state();
assert.equal(s.rec?.listening, "Fake MPE Controller", "input opened");

// --- thru + held-key preview
let t0 = await pageNow();
await midiIn([0x91, 60, 100]);
await sleep(100);
await midiIn([0xE1, 0x00, 0x50]); // bend up on channel 1
await sleep(100);
await page.screenshot({ path: `${SHOTS}/rec-01-held-key.png` });
await midiIn([0x81, 60, 0]);
let sent = await sentSince(t0);
assert.ok(sent.some((m) => m.bytes[0] === 0x91 && m.bytes[1] === 60), "thru note-on on channel 1 (MPE keeps channels)");
assert.ok(sent.some((m) => m.bytes[0] === 0xE1), "thru bend");
assert.ok(sent.some((m) => m.bytes[0] === 0x81 && m.bytes[1] === 60), "thru note-off");
await midiIn([0xE1, 0x00, 0x40]); // bend back to centre

// --- free take on the empty bank
await page.click(".runner-shape__rec");
await sleep(300);
s = await state();
assert.equal(s.rec.recording, "free");
// note 1: channel 1, pitch 60, bend ramp up 2 semitones (48 range -> 8192*2/48 = 341), pressure ramp
await midiIn([0xD1, 20]);
await midiIn([0x91, 60, 110]);
for (let i = 1; i <= 10; i++) {
  const bend = 8192 + Math.round((341 * i) / 10);
  await midiIn([0xE1, bend & 0x7f, bend >> 7]);
  await midiIn([0xD1, 20 + i * 8]);
  await midiIn([0xB1, 74, 64 + i * 3]);
  await sleep(40);
}
// note 2 overlapping on channel 2
await midiIn([0x92, 64, 90]);
await sleep(200);
await page.screenshot({ path: `${SHOTS}/rec-02-recording-live.png` });
await midiIn([0x81, 60, 0]);
await sleep(300);
await midiIn([0x82, 64, 0]);
await sleep(200);
await page.click(".runner-shape__rec");
await sleep(400);
s = await state();
console.log("free take notes", JSON.stringify(s.bank.notes, null, 0).slice(0, 900));
console.log("loopLength", s.bank.loopLength, "status", s.rec.status);
assert.equal(s.rec.recording, null);
assert.equal(s.bank.notes.length, 2);
const n1 = s.bank.notes.find((n) => n.pitch === 60);
const n2 = s.bank.notes.find((n) => n.pitch === 64);
assert.ok(n1.mpePitch && n1.mpePitch.points.at(-1).pitchOffset > 1.9, "bend curve recorded in semitones");
assert.ok(n1.mpePressure && n1.mpePressure.points.at(-1).value > 90, "pressure curve");
assert.ok(n1.mpeTimbre, "timbre curve");
assert.ok(!n2.mpePitch, "flat note has no curve");
assert.ok(n2.position > n1.position, "second note later");
assert.equal(s.bank.loopLength, 4, "free take rounded up to one bar");
await page.screenshot({ path: `${SHOTS}/rec-03-after-take.png` });

// --- MPE playback
t0 = await pageNow();
await page.evaluate((id) => window.__musicRunners.playback.startPlay(id), shapeId);
await sleep(1500);
sent = await sentSince(t0);
const ons = sent.filter((m) => (m.bytes[0] & 0xf0) === 0x90);
console.log("note-ons", ons.map((m) => m.bytes));
assert.ok(ons.length >= 2);
assert.notEqual(ons[0].bytes[0] & 0x0f, ons[1].bytes[0] & 0x0f, "overlapping notes on different member channels");
const ch1 = ons.find((m) => m.bytes[1] === 60).bytes[0] & 0x0f;
assert.ok(ch1 >= 1, "member channel, not master");
const bends = sent.filter((m) => m.bytes[0] === (0xE0 | ch1)).map((m) => ((m.bytes[2] << 7) | m.bytes[1]) - 8192);
console.log("bends on note channel", bends.length, bends.slice(0, 3), bends.slice(-3));
assert.ok(bends.length > 3 && Math.max(...bends) > 300, "bend curve streamed");
const firstBendIdx = sent.findIndex((m) => m.bytes[0] === (0xE0 | ch1));
const onIdx = sent.findIndex((m) => m.bytes[0] === (0x90 | ch1) && m.bytes[1] === 60);
assert.ok(firstBendIdx < onIdx, "initial bend before note-on");
assert.ok(sent.some((m) => m.bytes[0] === (0xD0 | ch1)), "pressure sent");
assert.ok(sent.some((m) => m.bytes[0] === (0xB0 | ch1) && m.bytes[1] === 74), "timbre sent");

// --- overdub while playing
await page.click(".runner-shape__rec");
await sleep(50);
s = await state();
assert.equal(s.rec.recording, "overdub");
await midiIn([0x93, 67, 80]);
await sleep(250);
await page.screenshot({ path: `${SHOTS}/rec-04-overdub-live.png` });
await midiIn([0x83, 67, 0]);
const expected = await page.evaluate((id) => {
  const mr = window.__musicRunners; const rt = mr.stores.playbackStore.instances[id];
  return ((mr.clock.nowBeats() - rt.loopStartBeats) * rt.loopSpeed) % rt.loopLength;
}, shapeId);
await sleep(100);
await page.click(".runner-shape__rec");
await sleep(300);
s = await state();
const n3 = s.bank.notes.find((n) => n.pitch === 67);
console.log("overdub note", n3, "expected end near", expected);
assert.ok(n3 && Math.abs(n3.position + n3.duration - expected) < 0.25, "overdub lands at loop position");
assert.equal(s.bank.notes.length, 3);

// --- undo the overdub as one step
await page.click(".pr-control-panel button[title*='Undo'], .pr-control-panel button:has-text('Undo')");
await sleep(300);
s = await state();
assert.equal(s.bank.notes.length, 2, "undo removes the take");
await page.evaluate(() => window.__musicRunners.playback.stopAll());
await sleep(200);
await page.screenshot({ path: `${SHOTS}/rec-05-after-undo.png` });

// --- reload: props and expression persist
await page.evaluate(() => window.__musicRunners.project.saveProject());
await sleep(500);
await page.reload();
await page.waitForFunction(() => window.__musicRunners?.editor);
await sleep(1200);
s = await state();
assert.equal(s.props.mpe, true);
assert.equal(s.props.midiInputName, "Fake MPE Controller");
assert.ok(s.bank.notes.find((n) => n.pitch === 60).mpePitch, "curves survive save/load");
await page.screenshot({ path: `${SHOTS}/rec-06-reloaded.png` });
console.log("ALL OK");
await browser.close();
await rm(path.join(here, "..", "projects", PROJECT), { recursive: true, force: true });
