// The arp runner against a fake Web MIDI output (no device needed): pattern
// validation, the chord under the cursor, the cursor change taking effect on
// the next cycle (with the "playing" line marking the old chord until then),
// waiting with no chord and restarting at once, index wrapping. Project
// "zz_arp" is never saved. With the dev server up:
//   NODE_PATH=$(npm root -g) node demo/arp.e2e.mjs [screenshot dir]
// Set PW_CHROMIUM_PATH when that Playwright has no browser of its own.
import { createRequire } from "node:module";
import path from "node:path";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");
const SHOTS = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !m.text().includes("404")) errors.push(m.text().slice(0, 200)); });
await page.addInitScript(() => {
  const sent = [];
  window.__midiSent = sent;
  class Port extends EventTarget {
    constructor(id, name, type) { super(); Object.assign(this, { id, name, type, manufacturer: "fake", state: "connected", connection: "closed", version: "1" }); }
    async open() { this.connection = "open"; return this; }
    async close() { this.connection = "closed"; return this; }
    send(data) { sent.push({ t: performance.now(), bytes: Array.from(data) }); }
  }
  const access = new EventTarget();
  access.inputs = new Map();
  access.outputs = new Map([["out1", new Port("out1", "Fake Synth", "output")]]);
  access.sysexEnabled = false;
  navigator.requestMIDIAccess = async () => access;
});
await page.route("**/api/projects/zz_arp", (r) => r.request().method() === "PUT" ? r.fulfill({ status: 200, body: "{}" }) : r.fulfill({ status: 404, body: "" }));
await page.goto("http://localhost:5190/?project=zz_arp");
await page.waitForFunction(() => window.__musicRunners?.editor);
await sleep(500);

// --- an arp from the sidebar, two chords: C E G over beats 0-4, D F A C over 4-8
await page.locator(".runner-group[data-runner-type=arp] .runner-group__add").click();
await sleep(300);
const id = await page.evaluate(async () => {
  const mr = window.__musicRunners; const ed = mr.editor;
  await mr.midi.ensureMidi();
  mr.clock.setBpm(240); // a 4-beat cycle is one second
  const [id] = ed.getSelectedShapeIds();
  const chord = (pitches, position, prefix) => pitches.map((pitch, i) => ({ id: `${prefix}${i}`, pitch, position, duration: 4, velocity: 90 }));
  mr.clips.setClipNotes(id, [...chord([60, 64, 67], 0, "a"), ...chord([62, 65, 69, 72], 4, "b")]);
  ed.updateShape({ id, type: ed.getShape(id).type, x: 0, y: 0, props: { midiOutputName: "Fake Synth" } });
  ed.setCamera({ x: 20, y: 20, z: 1 });
  return id;
});
await sleep(600);
const state = () => page.evaluate((id) => {
  const mr = window.__musicRunners;
  const rt = mr.stores.playbackStore.instances[id];
  return {
    mode: rt?.mode, error: rt?.error,
    generated: rt?.generated ? rt.generated.notes.map((n) => n.pitch) : null,
    start: rt?.generated?.start,
    markers: JSON.parse(JSON.stringify(mr.playback.markersFor(id))),
    cursor: mr.editor.getShape(id).meta.cursor ?? 0,
    params: JSON.parse(JSON.stringify(mr.editor.getShape(id).props.params)),
  };
}, id);
const noteOnsSince = (t0) => page.evaluate((t0) => window.__midiSent.filter((m) => m.t >= t0 && (m.bytes[0] & 0xf0) === 0x90 && m.bytes[2] > 0).map((m) => m.bytes[1]), t0);
const now = () => page.evaluate(() => performance.now());

// A known view on the source roll: 12 beats, pitches 76 down
await page.evaluate((id) => window.__musicRunners.sourceRollHandles.get(id).setView({ quarterNoteWidth: 70, noteHeight: 12, startBeat: 0, topRow: 127 - 76 }), id);
await sleep(200);

// --- the pattern field: bad input is refused with a message, good input commits
const field = page.locator(".runner-shape__param--text input");
await field.fill("0 a 2");
await field.press("Enter");
await sleep(100);
assert.match(await page.locator(".runner-shape__param-error").innerText(), /"a"/, "a non-index atom is rejected");
assert.equal((await state()).params.pattern, "0 1 2 <3 -1>", "the last good pattern stays");
await field.fill("0 [1");
await field.press("Enter");
await sleep(100);
assert.ok(await page.locator(".runner-shape__param-error").isVisible(), "a parse error is shown");
await field.fill("0 1 2 -1");
await field.press("Enter");
await sleep(100);
assert.equal(await page.locator(".runner-shape__param-error").count(), 0);
assert.equal((await state()).params.pattern, "0 1 2 -1");

// --- Run: the chord under the cursor (beat 0)
const row = page.locator(`.runner-row[data-shape-id="${id}"]`);
let t0 = await now();
await row.locator("button[title^='Run']").click();
await sleep(400);
let s = await state();
console.log("run", JSON.stringify(s));
assert.equal(s.mode, "run");
assert.deepEqual(s.generated, [60, 64, 67, 67], "0 1 2 -1 over C E G (-1 wraps to the top)");
assert.deepEqual(s.markers.map((m) => [m.id, m.position]), [["playing", 0]]);
assert.ok((await noteOnsSince(t0)).includes(60), "notes are sent");

// --- moving the cursor (a click on the empty grid at beat 5) takes effect on the next cycle
const clickGridAt = async (beat, pitch) => {
  const handle = await page.evaluate((id) => window.__musicRunners.sourceRollHandles.get(id).getView(), id);
  const canvas = page.locator(".runner-section").first().locator(".konvajs-content canvas").first();
  const box = await canvas.boundingBox();
  const x = (beat - handle.startBeat) * handle.quarterNoteWidth + 2;
  const y = (127 - pitch - handle.topRow + 0.5) * handle.noteHeight;
  assert.ok(x > 0 && x < box.width && y > 0 && y < box.height, `beat ${beat} pitch ${pitch} is on screen (${x}, ${y})`);
  await page.mouse.click(box.x + x, box.y + y);
};
// wait for the start of a cycle so the switch is clearly pending
await page.waitForFunction((id) => { const rt = window.__musicRunners.stores.playbackStore.instances[id]; return rt.loopCount >= 2; }, id);
await sleep(100);
await clickGridAt(5, 63);
await sleep(100);
s = await state();
console.log("after cursor move", JSON.stringify(s));
assert.equal(s.cursor, 5, "the click moved the cursor");
assert.deepEqual(s.generated, [60, 64, 67, 67], "still the old chord this cycle");
assert.deepEqual(s.markers.map((m) => m.position), [0], "the playing line stays on the old chord");
if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "arp-pending.png") });
await page.waitForFunction((id) => window.__musicRunners.stores.playbackStore.instances[id].generated?.notes[0]?.pitch === 62, id, { timeout: 2000 });
s = await state();
assert.deepEqual(s.generated, [62, 65, 69, 72], "the next cycle plays D F A C");
assert.deepEqual(s.markers.map((m) => m.position), [5], "the playing line moved to the new chord");
assert.equal(s.start, 5, "the generated loop sits at the cursor");
if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "arp-switched.png") });

// --- no notes under the cursor: quiet after the cycle ends, then waiting
await clickGridAt(10, 63);
await page.waitForFunction((id) => window.__musicRunners.stores.playbackStore.instances[id].generated === null, id, { timeout: 2000 });
await sleep(300);
t0 = await now();
await sleep(500);
s = await state();
assert.equal(s.mode, "run", "still running, waiting");
assert.deepEqual(s.markers, [], "no playing line while waiting");
assert.deepEqual(await noteOnsSince(t0), [], "nothing is sent while waiting");
assert.equal(await row.locator(".runner-row__status").innerText(), "waiting");

// --- back over a chord: starts at once, not on the old cycle grid
t0 = await now();
await clickGridAt(2, 63);
await page.waitForFunction((id) => window.__musicRunners.stores.playbackStore.instances[id].generated !== null, id, { timeout: 500 });
const restartMs = (await now()) - t0;
console.log("restart after", Math.round(restartMs), "ms");
await sleep(50);
assert.ok((await noteOnsSince(t0)).includes(60), "the first note sounds right away");
assert.deepEqual((await state()).markers.map((m) => m.position), [2]);

// --- wrapping with a shift, through Regenerate (cycle 0 at the cursor)
await page.evaluate((id) => {
  const ed = window.__musicRunners.editor; const shape = ed.getShape(id);
  ed.updateShape({ id, type: shape.type, props: { params: { ...shape.props.params, pattern: "0 3 -4 -1", wrapShift: 12 } } });
  window.__musicRunners.playback.regenerate(id);
}, id);
const preview = await page.evaluate((id) => window.__musicRunners.stores.playbackStore.instances[id].preview.notes.map((n) => n.pitch), id);
assert.deepEqual(preview, [60, 72, 43, 55], "3 wraps up an octave; -1 is the top note an octave down, -4 two octaves down");

// --- cycles: alternation advances per cycle; polyphony and rests
const cycles = await page.evaluate(async () => {
  const { arpCycle, parseArpPattern } = await import("/src/runners/arp/pattern.ts");
  const steps = (text, cycle) => arpCycle(parseArpPattern(text).pattern, cycle).map((s) => [+s.begin.toFixed(4), +s.duration.toFixed(4), s.index]);
  return { alt0: steps("0 <1 2>", 0), alt1: steps("0 <1 2>", 1), poly: steps("[0,2] ~ 1", 0) };
});
assert.deepEqual(cycles.alt0, [[0, 0.5, 0], [0.5, 0.5, 1]]);
assert.deepEqual(cycles.alt1, [[0, 0.5, 0], [0.5, 0.5, 2]]);
assert.deepEqual(cycles.poly, [[0, 0.3333, 0], [0, 0.3333, 2], [0.6667, 0.3333, 1]]);

await row.locator("button[title='stop']").click();
await sleep(200);
s = await state();
assert.equal(s.mode, "idle");
assert.deepEqual(s.markers, []);
console.log("errors", errors);
assert.equal(errors.length, 0);
console.log("ARP OK");
await browser.close();
