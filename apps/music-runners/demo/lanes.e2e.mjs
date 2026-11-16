// Piano roll expression editing: velocity lane (marker drag, group drag,
// undo, lane-bar field, Alt-drag on a note), the keyboard column (held key
// sends note-on/off), MPE mode (notes stay put, add/snap/root/delete pitch
// points, range-select + Delete in a lane, undo, add + drag a lane point).
// Fake Web MIDI; project "zz_lanes" is never saved. With the dev server up:
//   NODE_PATH=$(npm root -g) node demo/lanes.e2e.mjs [screenshot dir]
// Set PW_CHROMIUM_PATH when that Playwright has no browser of its own.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");
const OUT = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "screenshots");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
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
await page.route("**/api/projects/zz_lanes", (r) => r.request().method() === "PUT" ? r.fulfill({ status: 200, body: "{}" }) : r.fulfill({ status: 404, body: "" }));
await page.goto("http://localhost:5190/?project=zz_lanes");
await page.waitForFunction(() => window.__musicRunners?.editor);
await sleep(500);
const ctx = await page.evaluate(async () => {
  const mr = window.__musicRunners;
  const ed = mr.editor;
  await mr.midi.ensureMidi();
  const id = mr.shapes.createInstance(ed, "variants", { x: 0, y: 0 });
  const s = ed.getShape(id);
  const notes = [60, 64, 67, 72].map((p, i) => ({ id: "n" + i, pitch: p, position: i * 2, duration: 1.5, velocity: 64 }));
  notes[2].mpePressure = { points: [{ time: 0, value: 20 }, { time: 0.5, value: 110 }, { time: 1, value: 60 }] };
  mr.clips.setClipNotes(s.id, notes);
  ed.updateShape({ id, type: s.type, props: { showGenerated: false } });
  ed.selectNone();
  ed.setCamera({ x: -s.x + 20, y: -s.y + 20, z: 1 });
  window.__id = id;
  return { id, clipId: s.id };
});
await sleep(800);
await page.evaluate(() => window.__musicRunners.sourceRollHandles.get(window.__id).fitToContent());
await sleep(300);
const notes = () => page.evaluate((b) => JSON.parse(JSON.stringify(window.__musicRunners.stores.clipsStore.clips[b].notes)), ctx.clipId);
const note = async (id) => (await notes()).find((n) => n.id === id);
const shape = page.locator(".runner-shape").first();
const container = shape.locator(".pr-container").first();
const GRID_H = 240, LANE_H = 64, PAD = 6;
// Page point for a beat and a stage y (CSS px within the stage).
async function at(beat, stageY) {
  const box = await container.boundingBox();
  const view = await page.evaluate(() => window.__musicRunners.sourceRollHandles.get(window.__id).getView());
  return { x: box.x + 1 + (beat - view.startBeat) * view.quarterNoteWidth, y: box.y + 1 + stageY, view };
}
async function rowY(pitch) {
  const view = await page.evaluate(() => window.__musicRunners.sourceRollHandles.get(window.__id).getView());
  return (127 - pitch - view.topRow) * view.noteHeight + view.noteHeight / 2;
}
const laneY = (laneIndex, value, min = 1) => GRID_H + laneIndex * LANE_H + PAD + (1 - (value - min) / (127 - min)) * (LANE_H - 2 * PAD);
async function drag(from, to, opts = {}) {
  if (opts.modifier) await page.keyboard.down(opts.modifier);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  if (opts.modifier) await page.keyboard.up(opts.modifier);
  await sleep(80);
}
async function click(p) {
  await page.mouse.click(p.x, p.y);
  await sleep(80);
}

// ---------- Notes mode: velocity lane ----------
// select n1 and n2, drag n1's marker up by ~20 velocity
await page.evaluate(() => window.__musicRunners.sourceRollHandles.get(window.__id).selectNotes(["n1", "n2"]));
await sleep(100);
let p = await at(2, laneY(0, 64));
await drag(p, { x: p.x, y: p.y - 10 });
let n1 = await note("n1"), n2 = await note("n2"), n0 = await note("n0");
console.log("velocities after marker drag", n0.velocity, n1.velocity, n2.velocity);
assert.ok(n1.velocity > 70 && n1.velocity === n2.velocity, "selected markers move together");
assert.equal(n0.velocity, 64, "unselected unchanged");
// undo is one step
await shape.locator(".pr-undo").click();
await sleep(100);
assert.equal((await note("n1")).velocity, 64, "undo restores");
// lane bar field sets the selection
const field = shape.locator(".pr-velocity-value");
await field.dblclick();
await page.keyboard.type("100");
await page.keyboard.press("Enter");
await sleep(100);
assert.equal((await note("n1")).velocity, 100);
assert.equal((await note("n2")).velocity, 100);
// Alt-drag on a note changes velocity, does not move it
p = await at(0.5, await rowY(60));
await drag(p, { x: p.x + 40, y: p.y - 30 }, { modifier: "Alt" });
n0 = await note("n0");
console.log("alt-drag n0", n0.velocity, n0.position, n0.pitch);
assert.ok(n0.velocity > 64 && n0.position === 0 && n0.pitch === 60, "Alt-drag = velocity");
await page.screenshot({ path: `${OUT}/lanes-test-notes.png` });

// ---------- keyboard column ----------
const gutter = shape.locator(".pr-gutter").first();
const gbox = await gutter.boundingBox();
await page.evaluate(() => { window.__midiSent.length = 0; });
const keyY = gbox.y + 1 + await rowY(67);
await page.mouse.move(gbox.x + gbox.width - 8, keyY);
await page.mouse.down();
await sleep(150);
let sent = await page.evaluate(() => window.__midiSent.slice());
assert.ok(sent.some((m) => (m[0] & 0xf0) === 0x90 && m[1] === 67), "key press sends note-on");
assert.ok(!sent.some((m) => (m[0] & 0xf0) === 0x80), "held: no note-off yet");
await page.screenshot({ path: `${OUT}/lanes-test-key.png`, clip: { x: gbox.x - 10, y: gbox.y, width: 200, height: 260 } });
await page.mouse.up();
await sleep(100);
sent = await page.evaluate(() => window.__midiSent.slice());
assert.ok(sent.some((m) => (m[0] & 0xf0) === 0x80 && m[1] === 67), "release sends note-off");

// ---------- MPE mode ----------
await shape.locator(".pr-mode-mpe").click();
await sleep(200);
await page.evaluate(() => window.__musicRunners.sourceRollHandles.get(window.__id).selectNotes(["n2"]));
await sleep(150);
// drag on a note in MPE mode does not move it
const before = await note("n2");
p = await at(4.3, await rowY(67) + 6);
// click on the dashed pitch line (no points yet) adds a point, then drag it up 2 rows
const view = (await at(0, 0)).view;
p = await at(4.6, await rowY(67));
await drag(p, { x: p.x, y: p.y - view.noteHeight * 2 }, { modifier: "Meta" });
let n2now = await note("n2");
console.log("pitch points", JSON.stringify(n2now.mpePitch));
assert.equal(n2now.position, before.position);
assert.equal(n2now.pitch, before.pitch, "notes do not move in MPE mode");
assert.equal(n2now.mpePitch.points.length, 1);
assert.equal(n2now.mpePitch.points[0].pitchOffset, 2, "Cmd snaps pitch to semitones");
// R toggles rooted on the selected point
await page.keyboard.press("r");
await sleep(80);
assert.equal((await note("n2")).mpePitch.points[0].rooted, true);
// click on the point deletes it
const pt = await at(4 + n2now.mpePitch.points[0].time * 1.5, (await rowY(67)) - 2 * view.noteHeight);
await click(pt);
assert.equal((await note("n2")).mpePitch, undefined, "click on a point deletes it");
// range select in the pressure lane over the second half, then Delete
const r0 = await at(4.6, laneY(0, 30, 0));
const r1 = await at(5.6, laneY(0, 30, 0));
await drag(r0, r1);
await page.screenshot({ path: `${OUT}/lanes-test-range.png` });
await page.keyboard.press("Delete");
await sleep(80);
const pressure = (await note("n2")).mpePressure.points.map((q) => q.value);
console.log("pressure after range delete", pressure);
assert.deepEqual(pressure, [20], "range grabbed the points in the range");
// undo restores them, and the notes count is unchanged
await shape.locator(".pr-undo").click();
await sleep(80);
assert.equal((await note("n2")).mpePressure.points.length, 3);
assert.equal((await notes()).length, 4, "Delete in MPE mode never deletes notes");
// add a pressure point by clicking the line, drag it
const lineX = 4 + 0.25 * 1.5;
const lineVal = 20 + (110 - 20) * 0.5;
p = await at(lineX, laneY(0, lineVal, 0));
await drag(p, { x: p.x, y: p.y - 15 });
const pts = (await note("n2")).mpePressure.points;
console.log("pressure after add+drag", JSON.stringify(pts));
assert.equal(pts.length, 4);
assert.ok(pts[1].value > lineVal + 10);
await shape.screenshot({ path: `${OUT}/lanes-test-mpe.png` });

// ---------- hover zones, segment drag, Edit Value ----------
await page.evaluate((b) => {
  const mr = window.__musicRunners;
  const clip = mr.stores.clipsStore.clips[b];
  mr.clips.setClipNotes(b, clip.notes.map((n) => n.id === "n2"
    ? { ...JSON.parse(JSON.stringify(n)), mpePressure: { points: [{ time: 0, value: 20 }, { time: 0.5, value: 110 }, { time: 1, value: 60 }] } }
    : JSON.parse(JSON.stringify(n))));
}, ctx.clipId);
await sleep(200);
await page.evaluate(() => window.__musicRunners.sourceRollHandles.get(window.__id).selectNotes(["n2"]));
await sleep(100);
// Hover a point: tooltip with its value (visual check)
const hoverP = await at(4 + 0.5 * 1.5, laneY(0, 110, 0));
await page.mouse.move(hoverP.x, hoverP.y);
await sleep(120);
await shape.screenshot({ path: `${OUT}/lanes-hover-point.png` });
// Within the tight zone of the line: the click adds a point locked to the line,
// not at the pointer's height
const lineP = await at(4 + 0.25 * 1.5, laneY(0, 65, 0) - 3);
await page.mouse.move(lineP.x, lineP.y);
await sleep(120);
await shape.screenshot({ path: `${OUT}/lanes-hover-line.png` });
await click(lineP);
let pp = (await note("n2")).mpePressure.points;
console.log("after locked add", JSON.stringify(pp));
assert.equal(pp.length, 4);
assert.ok(Math.abs(pp[1].value - 65) <= 6, "added on the line, not at the pointer");
// Undo that, then grab the segment between (0.5,110) and (1,60) 8px off it and drag down
await shape.locator(".pr-undo").click();
await sleep(100);
const segP = await at(4 + 0.75 * 1.5, laneY(0, 85, 0) - 8);
await page.mouse.move(segP.x, segP.y);
await sleep(120);
await shape.screenshot({ path: `${OUT}/lanes-hover-segment.png` });
await drag(segP, { x: segP.x, y: segP.y + 10 });
pp = (await note("n2")).mpePressure.points;
console.log("after segment drag", JSON.stringify(pp));
assert.equal(pp.length, 3, "segment drag adds no points");
assert.equal(pp[0].value, 20, "points outside the segment stay");
const d1 = 110 - pp[1].value, d2 = 60 - pp[2].value;
assert.ok(d1 > 10 && d1 === d2, "both end points move by the same delta");
// Right-click a point: Edit Value
const firstP = await at(4, laneY(0, 20, 0));
await page.mouse.click(firstP.x, firstP.y, { button: "right" });
await sleep(150);
assert.equal(await page.locator(".pr-expression-menu").count(), 1, "menu opens");
assert.equal(await page.evaluate(() => document.querySelectorAll("[data-radix-menu-content], .tlui-menu").length), 0, "no tldraw context menu");
await page.screenshot({ path: `${OUT}/lanes-menu.png` });
await page.locator(".pr-expression-menu .ui-chooser__option", { hasText: "Edit Value" }).click();
await page.keyboard.press("ControlOrMeta+a");
await page.keyboard.type("42");
await page.keyboard.press("Enter");
await sleep(120);
assert.equal((await note("n2")).mpePressure.points[0].value, 42, "Edit Value sets it exactly");
assert.equal(await page.locator(".pr-expression-menu").count(), 0, "menu closes");
// Pitch point: add on the dashed line, then right-click > Root
const pitchP = await at(4 + 0.5 * 1.5, await rowY(67));
await click(pitchP);
assert.equal((await note("n2")).mpePitch.points.length, 1);
await page.mouse.click(pitchP.x, pitchP.y, { button: "right" });
await sleep(120);
await page.locator(".pr-expression-menu .ui-chooser__option", { hasText: /^Root$/ }).click();
await sleep(100);
assert.equal((await note("n2")).mpePitch.points[0].rooted, true, "Root from the menu");
// Edit the pitch value with the "st" suffix
await page.mouse.click(pitchP.x, pitchP.y, { button: "right" });
await sleep(120);
await page.locator(".pr-expression-menu .ui-chooser__option", { hasText: "Edit Value" }).click();
await page.keyboard.press("ControlOrMeta+a");
await page.keyboard.type("+2.73 st");
await page.keyboard.press("Enter");
await sleep(100);
assert.equal((await note("n2")).mpePitch.points[0].pitchOffset, 2.73);
// MPE mode resizes notes from their edges (the envelope's points stay put)
{
  const n2b = await note("n2");
  const qw = (await at(0, 0)).view.quarterNoteWidth;
  const endP = await at(n2b.position + n2b.duration, await rowY(67));
  endP.x -= 2;
  await page.mouse.move(endP.x, endP.y);
  await sleep(100);
  assert.equal(await page.evaluate(() => document.querySelector(".runner-shape .konvajs-content").style.cursor), "ew-resize", "edge cursor in MPE mode");
  await drag(endP, { x: endP.x + qw, y: endP.y });
  const n2r = await note("n2");
  console.log("MPE resize end", n2r.position, n2r.duration);
  assert.equal(n2r.duration, n2b.duration + 1, "right edge drag lengthens the note in MPE mode");
  assert.equal(n2r.position, n2b.position);
  assert.deepEqual(n2r.mpePitch, n2b.mpePitch, "envelope unchanged");
  // an unselected note's left edge
  const n1b = await note("n1");
  const startP = await at(n1b.position, await rowY(64));
  startP.x += 2;
  await drag(startP, { x: startP.x + qw / 2, y: startP.y });
  const n1r = await note("n1");
  console.log("MPE resize start", n1r.position, n1r.duration);
  assert.equal(n1r.position, n1b.position + 0.5);
  assert.equal(n1r.duration, n1b.duration - 0.5);
  await shape.locator(".pr-undo").click();
  await shape.locator(".pr-undo").click();
  await sleep(100);
  assert.equal((await note("n2")).duration, n2b.duration, "undo restores");
  await page.evaluate(() => window.__musicRunners.sourceRollHandles.get(window.__id).selectNotes(["n2"]));
  await sleep(80);
}
// Velocity marker: right-click > Edit Value (Notes mode)
await shape.locator(".pr-mode-notes").click();
await sleep(150);
const vP = await at(6, laneY(0, (await note("n3")).velocity));
await page.mouse.click(vP.x, vP.y, { button: "right" });
await sleep(120);
await page.locator(".pr-expression-menu .ui-chooser__option", { hasText: "Edit Value" }).click();
await page.keyboard.press("ControlOrMeta+a");
await page.keyboard.type("33");
await page.keyboard.press("Enter");
await sleep(100);
assert.equal((await note("n3")).velocity, 33, "velocity Edit Value");
console.log("errors", errors);
assert.equal(errors.length, 0);
console.log("LANES OK");
await browser.close();
