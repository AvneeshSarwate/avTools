// Clicks in the source roll:
// - a double click on the grid adds a note and leaves it selected;
// - holding the second press and dragging draws the new note's end out
//   (one undo step);
// - with several notes selected, a click (no drag) on one of them selects just
//   it; dragging it still moves the whole selection.
// Project "zz_click" is never saved. With the dev server up:
//   NODE_PATH=$(npm root -g) node demo/click-edit.e2e.mjs
// Set PW_CHROMIUM_PATH when that Playwright has no browser of its own.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const { chromium } = createRequire(import.meta.url)("playwright");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(() => { navigator.requestMIDIAccess = async () => Object.assign(new EventTarget(), { inputs: new Map(), outputs: new Map() }); });
await page.route("**/api/projects/zz_click", (r) => r.request().method() === "PUT" ? r.fulfill({ status: 200, body: "{}" }) : r.fulfill({ status: 404, body: "" }));
await page.goto("http://localhost:5190/?project=zz_click");
await page.waitForFunction(() => window.__musicRunners?.editor);
await sleep(500);
await page.evaluate(() => {
  const mr = window.__musicRunners, ed = mr.editor;
  const id = mr.shapes.createInstance(ed, "variants", { x: 0, y: 0 });
  const s = ed.getShape(id);
  ed.updateShape({ id, type: s.type, props: { showGenerated: false } });
  mr.clips.setClipNotes(id, [60, 64, 67].map((p, i) => ({ id: "n" + i, pitch: p, position: i, duration: 0.5, velocity: 100 })));
  ed.selectNone(); ed.setCamera({ x: -s.x + 20, y: -s.y + 20, z: 1 }); window.__id = id;
});
await sleep(800);
const handle = (fn, arg) => page.evaluate(({ fn, arg }) => window.__musicRunners.sourceRollHandles.get(window.__id)[fn](...(arg ?? [])), { fn, arg });
await handle("fitToContent");
await sleep(300);
const shape = page.locator(".runner-shape").first();
const box = await shape.locator(".pr-container").first().boundingBox();
const view = await handle("getView");
const at = (beat, pitch) => ({ x: box.x + 1 + (beat - view.startBeat) * view.quarterNoteWidth, y: box.y + 1 + (127 - pitch - view.topRow) * view.noteHeight + view.noteHeight / 2 });
const notes = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__musicRunners.stores.clipsStore.clips[window.__id].notes)));
const selected = () => handle("getSelectedIds");

// 1. double click on the grid: a new note, selected
let p = at(0.6, 62);
await page.mouse.dblclick(p.x, p.y);
await sleep(150);
let all = await notes();
assert.equal(all.length, 4, "double click adds one note");
const added = all.find((n) => !["n0", "n1", "n2"].includes(n.id));
console.log("added", added.pitch, added.position, added.duration);
assert.equal(added.pitch, 62);
assert.deepEqual(await selected(), [added.id], "the new note is selected");

// 2. double press, hold and drag: the note's end follows
p = at(0.1, 65);
await page.mouse.move(p.x, p.y);
await page.mouse.down(); await page.mouse.up();
await sleep(60);
await page.mouse.down();
await page.mouse.move(p.x + view.quarterNoteWidth * 1.5, p.y, { steps: 8 });
await page.mouse.up();
await sleep(150);
all = await notes();
assert.equal(all.length, 5, "one more note");
const drawn = all.find((n) => n.pitch === 65);
console.log("drawn", drawn.position, drawn.duration);
assert.equal(drawn.position, 0, "starts where pressed (snapped)");
assert.ok(drawn.duration >= 1.5, "its end followed the drag");
assert.deepEqual(await selected(), [drawn.id], "the drawn note is selected");
await shape.locator(".pr-undo").click();
await sleep(150);
assert.equal((await notes()).length, 4, "one undo removes the drawn note");

// 3. a click on one note of a selection selects just that note
await handle("selectNotes", [["n0", "n1", "n2"]]);
await sleep(100);
p = at(1.25, 64);
await page.mouse.click(p.x, p.y);
await sleep(150);
assert.deepEqual(await selected(), ["n1"], "click on a selected note: just that one");
// dragging one note of a selection still moves them all, and keeps the selection
await handle("selectNotes", [["n0", "n1", "n2"]]);
await sleep(600);
p = at(1.25, 64);
await page.mouse.move(p.x, p.y);
await page.mouse.down();
await page.mouse.move(p.x + view.quarterNoteWidth, p.y, { steps: 6 });
await page.mouse.up();
await sleep(150);
const moved = (await notes()).filter((n) => ["n0", "n1", "n2"].includes(n.id)).map((n) => n.position).sort();
console.log("after group drag", moved);
assert.deepEqual(moved, [1, 2, 3], "the group moved");
assert.deepEqual((await selected()).sort(), ["n0", "n1", "n2"], "the selection stays after a drag");
console.log("errors", errors);
assert.equal(errors.length, 0);
console.log("CLICK EDIT OK");
await browser.close();
